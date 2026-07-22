import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
    try {
      const base = 'https://psgc.gitlab.io/api';
      const [regionsResponse, provincesResponse, localitiesResponse] = await Promise.all([
        fetch(`${base}/regions/`), fetch(`${base}/provinces/`), fetch(`${base}/cities-municipalities/`),
      ]);
      if (!regionsResponse.ok || !provincesResponse.ok || !localitiesResponse.ok) throw new Error('PSGC request failed');
      const data = {
        source: 'Philippine Standard Geographic Code (PSGC)',
        regions: await regionsResponse.json(),
        provinces: await provincesResponse.json(),
        localities: await localitiesResponse.json(),
      };
      this.locationCache = { expires: Date.now() + 24 * 60 * 60 * 1000, data };
      return data;
    } catch {
      throw new ServiceUnavailableException('Philippine location reference is temporarily unavailable');
    }
  }

  async barangays(localityCode: string) {
    if (!/^\d{9}$/.test(localityCode)) throw new BadRequestException('Invalid city/municipality code');
    const cached = this.barangayCache.get(localityCode);
    if (cached && cached.expires > Date.now()) return cached.data;
    try {
      const response = await fetch(`https://psgc.gitlab.io/api/cities-municipalities/${localityCode}/barangays/`);
      if (!response.ok) throw new Error('PSGC request failed');
      const data = await response.json();
      this.barangayCache.set(localityCode, { expires: Date.now() + 24 * 60 * 60 * 1000, data });
      return data;
    } catch {
      throw new ServiceUnavailableException('Barangay reference is temporarily unavailable');
    }
  }

  private validateCoverages(value: unknown): CoverageInput[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = item as Partial<CoverageInput>;
      if (!row.regionCode || !row.regionName || !row.cityMunicipalityCode || !row.cityMunicipalityName || !row.congressionalDistrict) {
        throw new BadRequestException('Every coverage row requires a region, locality, and congressional district');
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
}
