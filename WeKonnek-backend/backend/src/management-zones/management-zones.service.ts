import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

type CoverageInput = {
  regionCode: string;
  regionName: string;
  provinceCode?: string | null;
  provinceName?: string | null;
  cityMunicipalityCode: string;
  cityMunicipalityName: string;
  congressionalDistrict: string;
  areas: { code: string; name: string }[];
};

@Injectable()
export class ManagementZonesService {
  private locationCache: { expires: number; data: unknown } | null = null;
  private barangayCache = new Map<string, { expires: number; data: unknown }>();
  private boundaryCache = new Map<string, { expires: number; data: unknown }>();
  private readonly locationCachePath = join(process.cwd(), '.cache', 'psgc-locations.json');
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.managementZone.findMany({
      include: { coverages: { orderBy: [{ regionName: 'asc' }, { cityMunicipalityName: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: Record<string, unknown>) {
    const name = String(input.name || '').trim();
    const code = String(input.code || '').trim().toUpperCase();
    const coverages = this.validateCoverages(input.coverages);
    if (!name || !code) throw new BadRequestException('Zone name and code are required');
    if (!coverages.length) throw new BadRequestException('Assign at least one city/municipality and district');
    await this.assertCoverageAvailability(coverages);
    return this.prisma.managementZone.create({
      data: {
        name, code,
        description: input.description ? String(input.description).trim() : null,
        isActive: input.isActive !== false,
        coverages: { create: coverages },
      },
      include: { coverages: true },
    });
  }

  async update(id: string, input: Record<string, unknown>) {
    const coverages = input.coverages === undefined ? undefined : this.validateCoverages(input.coverages);
    if (coverages) await this.assertCoverageAvailability(coverages, id);
    return this.prisma.$transaction(async (tx) => {
      if (coverages) await tx.managementZoneCoverage.deleteMany({ where: { zoneId: id } });
      return tx.managementZone.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: String(input.name).trim() }),
          ...(input.code !== undefined && { code: String(input.code).trim().toUpperCase() }),
          ...(input.description !== undefined && { description: input.description ? String(input.description).trim() : null }),
          ...(input.isActive !== undefined && { isActive: Boolean(input.isActive) }),
          ...(coverages && { coverages: { create: coverages } }),
        },
        include: { coverages: true },
      });
    });
  }

  remove(id: string) { return this.prisma.managementZone.delete({ where: { id } }); }

  async philippineLocations() {
    if (this.locationCache && this.locationCache.expires > Date.now()) return this.locationCache.data;
    const diskCache = await this.readLocationDiskCache();
    if (diskCache && diskCache.cachedAt > Date.now() - 30 * 24 * 60 * 60 * 1000) {
      this.locationCache = { expires: Date.now() + 24 * 60 * 60 * 1000, data: diskCache.data };
      return diskCache.data;
    }
    try {
      const base = 'https://psgc.gitlab.io/api';
      const [regions, provinces, localities] = await Promise.all([
        this.requestJson(`${base}/regions/`),
        this.requestJson(`${base}/provinces/`),
        this.requestJson(`${base}/cities-municipalities/`),
      ]);
      const data = {
        source: 'Philippine Standard Geographic Code (PSGC)',
        regions, provinces, localities,
      };
      this.locationCache = { expires: Date.now() + 24 * 60 * 60 * 1000, data };
      await this.writeLocationDiskCache(data);
      return data;
    } catch {
      if (diskCache) return diskCache.data;
      throw new ServiceUnavailableException('Philippine location reference is temporarily unavailable');
    }
  }

  private async requestJson(url: string) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await axios.get(url, { timeout: 30_000 });
        return response.data;
      } catch (error) {
        lastError = error;
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
    throw lastError;
  }

  private async readLocationDiskCache(): Promise<{ cachedAt: number; data: unknown } | null> {
    try {
      const value = JSON.parse(await readFile(this.locationCachePath, 'utf8')) as { cachedAt?: unknown; data?: unknown };
      return typeof value.cachedAt === 'number' && value.data ? { cachedAt: value.cachedAt, data: value.data } : null;
    } catch { return null; }
  }

  private async writeLocationDiskCache(data: unknown) {
    try {
      await mkdir(dirname(this.locationCachePath), { recursive: true });
      await writeFile(this.locationCachePath, JSON.stringify({ cachedAt: Date.now(), data }), 'utf8');
    } catch { /* In-memory caching still works on read-only deployments. */ }
  }

  async barangays(localityCode: string) {
    if (!/^\d{9}$/.test(localityCode)) throw new BadRequestException('Invalid city/municipality code');
    const cached = this.barangayCache.get(localityCode);
    if (cached && cached.expires > Date.now()) return cached.data;
    try {
      const response = await axios.get(`https://psgc.gitlab.io/api/cities-municipalities/${localityCode}/barangays/`, { timeout: 15_000 });
      const data = response.data;
      this.barangayCache.set(localityCode, { expires: Date.now() + 24 * 60 * 60 * 1000, data });
      return data;
    } catch {
      throw new ServiceUnavailableException('Barangay reference is temporarily unavailable');
    }
  }

  async geographicBoundaries(areaList: string, cityName: string) {
    const names = String(areaList || '').split(',').map(name => name.trim()).filter(Boolean).slice(0, 8);
    const city = String(cityName || '').trim();
    const validPlaceName = /^[\p{L} .()'-]+$/u;
    if (!city || !validPlaceName.test(city) || !names.length || names.some(name => !validPlaceName.test(name))) throw new BadRequestException('Invalid geographic area names');
    // PSGC labels cities as "City of Parañaque (City)", while the geocoder
    // indexes the locality under the shorter "Parañaque" name.
    const geocoderCity = city.replace(/^City of\s+/i, '').replace(/\s+\(City\)$/i, '').trim();
    const results: { name: string; geojson: unknown }[] = [];
    for (const name of names) {
      const key = `${city}:${name}`.toLowerCase();
      const cached = this.boundaryCache.get(key);
      if (cached && cached.expires > Date.now()) {
        results.push({ name, geojson: cached.data });
        continue;
      }
      try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
          params: { q: `${name}, ${geocoderCity}, Philippines`, format: 'jsonv2', polygon_geojson: 1, limit: 1 },
          headers: { 'User-Agent': 'WeKonnek/1.0 (geographic zone mapping)' }, timeout: 20_000,
        });
        const geometry = response.data?.[0]?.geojson;
        if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
          this.boundaryCache.set(key, { expires: Date.now() + 7 * 24 * 60 * 60 * 1000, data: geometry });
          results.push({ name, geojson: geometry });
        }
      } catch {
        // Keep the map usable with its center marker when an individual
        // OpenStreetMap boundary cannot be resolved.
      }
    }
    return results;
  }

  private validateCoverages(value: unknown): CoverageInput[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = item as Partial<CoverageInput>;
      if (!row.regionCode || !row.regionName || !row.cityMunicipalityCode || !row.cityMunicipalityName || !row.congressionalDistrict) {
        throw new BadRequestException('Every coverage row requires a region, locality, and city council district');
      }
      return {
        regionCode: String(row.regionCode), regionName: String(row.regionName),
        provinceCode: row.provinceCode ? String(row.provinceCode) : null,
        provinceName: row.provinceName ? String(row.provinceName) : null,
        cityMunicipalityCode: String(row.cityMunicipalityCode), cityMunicipalityName: String(row.cityMunicipalityName),
        congressionalDistrict: String(row.congressionalDistrict),
        areas: Array.isArray(row.areas) ? row.areas.map((area) => {
          const value = area as { code?: unknown; name?: unknown };
          if (!value.code || !value.name) throw new BadRequestException('Every selected area requires a code and name');
          return { code: String(value.code), name: String(value.name) };
        }) : [],
      };
    });
  }

  private async assertCoverageAvailability(coverages: CoverageInput[], excludeZoneId?: string) {
    const existing = await this.prisma.managementZoneCoverage.findMany({
      where: excludeZoneId ? { zoneId: { not: excludeZoneId } } : undefined,
      include: { zone: { select: { name: true } } },
    });
    for (const incoming of coverages) {
      const incomingAreas = incoming.areas.map(area => area.code);
      for (const assigned of existing) {
        if (assigned.cityMunicipalityCode !== incoming.cityMunicipalityCode || assigned.congressionalDistrict !== incoming.congressionalDistrict) continue;
        const assignedAreas = Array.isArray(assigned.areas)
          ? assigned.areas.flatMap(area => area && typeof area === 'object' && 'code' in area ? [String(area.code)] : [])
          : [];
        if (!incomingAreas.length || !assignedAreas.length) {
          throw new BadRequestException(`${incoming.cityMunicipalityName} · ${incoming.congressionalDistrict} is already covered by ${assigned.zone.name}`);
        }
        const overlap = incoming.areas.find(area => assignedAreas.includes(area.code));
        if (overlap) throw new BadRequestException(`${overlap.name} is already covered by ${assigned.zone.name}`);
      }
    }
  }
}
