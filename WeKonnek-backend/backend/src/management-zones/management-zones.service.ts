import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import { PDFParse } from 'pdf-parse';
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

type RegionImportRow = {
  regionCode: string;
  regionName: string;
  cityMunicipalityCode: string;
  cityMunicipalityName: string;
  localCouncilDistrict: string;
  areas: { code: string; name: string }[];
};

const NCR_LOCALITIES: Record<string, string> = {
  Manila: '133900000', 'Quezon City': '137404000', Caloocan: '137501000', Makati: '137602000',
  Marikina: '137402000', Paranaque: '137604000', 'Parañaque': '137604000', Valenzuela: '137504000',
  Pasig: '137403000', Mandaluyong: '137401000', Pasay: '137605000', 'Las Pinas': '137601000',
  'Las Piñas': '137601000', Muntinlupa: '137603000', Malabon: '137502000', Navotas: '137503000',
  'San Juan': '137405000', Taguig: '137607000', Pateros: '137606000',
};

@Injectable()
export class ManagementZonesService {
  private locationCache: { expires: number; data: unknown } | null = null;
  private barangayCache = new Map<string, { expires: number; data: unknown }>();
  private boundaryCache = new Map<string, { expires: number; data: unknown }>();
  private readonly locationCachePath = join(process.cwd(), '.cache', 'psgc-locations.json');
  constructor(private readonly prisma: PrismaService) {}

  async regionImportTemplate() {
    const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    document.fontSize(18).text('WEKONNEK Region / Council District Import Template');
    document.moveDown(0.5).fontSize(10).fillColor('#475569').text('Use one row per local council district. Export the completed document as a text-based PDF (not a scanned image). Separate covered areas or barangays with semicolons.');
    document.moveDown().fillColor('#111827').font('Helvetica-Bold').text('Required table columns');
    document.font('Helvetica').text('City / Municipality | Council District | Area / Barangays Covered | Barangay / Coverage Reference | Council Seats | Congressional Reference');
    document.moveDown().font('Helvetica-Bold').text('Example rows');
    document.font('Helvetica').text('Manila | 3rd | Binondo; Quiapo; San Nicolas; Santa Cruz | Barangays 268-394 | 6 | 3rd Legislative District');
    document.text('Pasig | 1st | Bagong Ilog; Buting; Kapitolyo; Oranbo | Named barangays | 6 | Lone Legislative District');
    document.moveDown().font('Helvetica-Bold').text('Region metadata');
    document.font('Helvetica').text('Region: National Capital Region (NCR)');
    document.text('PSGC region code: 130000000');
    document.moveDown().fontSize(9).fillColor('#64748b').text('The importer resolves supported NCR locality names to PSGC locality codes. Review every parsed row before importing. Existing assigned coverage is skipped, never overwritten.');
    document.end();
    return completed;
  }

  async previewRegionPdf(buffer: Buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const rows = this.parseRegionText(result.text);
      if (!rows.length) throw new BadRequestException('No supported region rows were found. Use the downloadable text-based PDF template.');
      return { regionName: 'National Capital Region (NCR)', rows, count: rows.length };
    } finally {
      await parser.destroy();
    }
  }

  async importRegionRows(value: unknown) {
    if (!Array.isArray(value) || !value.length) throw new BadRequestException('No reviewed region rows were supplied');
    const rows = value.map(row => this.validateRegionImportRow(row));
    const result = { created: 0, skipped: 0, errors: [] as string[] };
    for (const row of rows) {
      const code = `NCR-${row.cityMunicipalityCode}-${row.localCouncilDistrict.replace(/[^a-z0-9]+/gi, '').toUpperCase()}`;
      const existing = await this.prisma.managementZone.findUnique({ where: { code }, select: { id: true } });
      if (existing) { result.skipped += 1; continue; }
      try {
        await this.create({
          name: `${row.cityMunicipalityName} · ${row.localCouncilDistrict}`,
          code,
          description: `Imported regional council coverage for ${row.cityMunicipalityName}`,
          isActive: true,
          coverages: [{
            regionCode: row.regionCode, regionName: row.regionName,
            provinceCode: null, provinceName: null,
            cityMunicipalityCode: row.cityMunicipalityCode,
            cityMunicipalityName: row.cityMunicipalityName,
            congressionalDistrict: row.localCouncilDistrict,
            areas: row.areas,
          }],
        });
        result.created += 1;
      } catch (error) {
        result.errors.push(`${row.cityMunicipalityName} · ${row.localCouncilDistrict}: ${error instanceof Error ? error.message : 'Unable to import'}`);
      }
    }
    return result;
  }

  private parseRegionText(text: string): RegionImportRow[] {
    const names = Object.keys(NCR_LOCALITIES).sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const start = new RegExp(`^(${names.join('|')})\\s+(1st|2nd|3rd|4th|5th|6th|7th|8th|Lone)\\s+(.+)$`, 'i');
    const ignored = /^(WEKONNEK |City \/ Municipality|District$|Area \/ Barangays|Seats$|Congressional Reference|-- \d+ of \d+ --)/i;
    const records: { city: string; district: string; content: string }[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line || ignored.test(line)) continue;
      const match = line.match(start);
      if (match) records.push({ city: match[1], district: match[2], content: match[3] });
      else if (records.length) records[records.length - 1].content += ` ${line}`;
    }
    return records.flatMap(record => {
      const localityCode = NCR_LOCALITIES[record.city];
      if (!localityCode) return [];
      const content = record.content
        .replace(/\s+(?:\d+\s+named barangays|Named barangays|Barangays?\s+\d|\d+\s+traditional district barangays).*$/i, '')
        .trim();
      if (!content) return [];
      const district = /^Lone$/i.test(record.district) ? 'Lone District' : `${record.district} District`;
      const areas = content.split(';').map(name => name.trim()).filter(Boolean).map(name => ({
        code: `${localityCode}-${district}-${name}`.normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(),
        name,
      }));
      return [{ regionCode: '130000000', regionName: 'National Capital Region (NCR)', cityMunicipalityCode: localityCode, cityMunicipalityName: record.city, localCouncilDistrict: district, areas }];
    });
  }

  private validateRegionImportRow(value: unknown): RegionImportRow {
    const row = value as Partial<RegionImportRow>;
    if (!row.regionCode || !row.regionName || !row.cityMunicipalityCode || !row.cityMunicipalityName || !row.localCouncilDistrict || !Array.isArray(row.areas)) {
      throw new BadRequestException('Every import row requires region, locality, council district, and areas');
    }
    return {
      regionCode: String(row.regionCode), regionName: String(row.regionName),
      cityMunicipalityCode: String(row.cityMunicipalityCode), cityMunicipalityName: String(row.cityMunicipalityName),
      localCouncilDistrict: String(row.localCouncilDistrict),
      areas: row.areas.map(area => ({ code: String(area.code), name: String(area.name) })),
    };
  }

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
