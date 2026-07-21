import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Zone, Prisma } from '@prisma/client';

/**
 * Zone Service — handles delivery zone identification, point-in-polygon detection,
 * and zone-based delivery fee calculation.
 *
 * Core capability:
 *   Given any lat/lng coordinate → identify the zone (district, barangay area)
 *   → calculate delivery fees based on zones of origin & destination.
 */
@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════
  //  ZONE LOOKUP — "Which zone is this coordinate in?"
  // ═══════════════════════════════════════════════════

  /**
   * Find which zone a coordinate falls in.
   * Uses ray-casting point-in-polygon algorithm.
   * If multiple zones match (overlapping), returns the one with highest priority.
   */
  async findZoneByCoordinates(
    lat: number,
    lng: number,
  ): Promise<Zone | null> {
    const activeZones = await this.prisma.zone.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    for (const zone of activeZones) {
      if (this.isPointInPolygon(lat, lng, zone.polygon as number[][])) {
        return zone;
      }
    }

    return null;
  }

  /**
   * Identify the zone and return a structured response.
   * This is the main API for the apps — pass any coordinate and get zone info.
   */
  async identifyZone(lat: number, lng: number) {
    const zone = await this.findZoneByCoordinates(lat, lng);

    if (!zone) {
      return {
        identified: false,
        message: 'Location is outside of supported delivery zones',
        lat,
        lng,
        zone: null,
      };
    }

    return {
      identified: true,
      lat,
      lng,
      zone: {
        id: zone.id,
        name: zone.name,
        code: zone.code,
        district: zone.district,
        city: zone.city,
        province: zone.province,
        barangays: zone.barangays,
        baseDeliveryFee: zone.baseDeliveryFee,
        estimatedDeliveryMinutes: zone.estimatedDeliveryMinutes,
        surgeMultiplier: zone.surgeMultiplier,
        color: zone.color,
      },
    };
  }

  // ═══════════════════════════════════════════════════
  //  DELIVERY FEE CALCULATION
  // ═══════════════════════════════════════════════════

  /**
   * Calculate delivery fee between two coordinates.
   *
   * Logic:
   *   1. Identify zones for pickup and delivery coordinates.
   *   2. If same zone: base fee of the zone.
   *   3. If different zones: average base fee + distance-based surcharge.
   *   4. Apply surge multiplier if active.
   */
  async calculateDeliveryFee(
    pickupLat: number,
    pickupLng: number,
    deliveryLat: number,
    deliveryLng: number,
  ) {
    const pickupZone = await this.findZoneByCoordinates(
      pickupLat,
      pickupLng,
    );
    const deliveryZone = await this.findZoneByCoordinates(
      deliveryLat,
      deliveryLng,
    );

    const distance = this.haversineDistance(
      pickupLat,
      pickupLng,
      deliveryLat,
      deliveryLng,
    );

    const defaultBaseFee = 49;
    const defaultPerKm = 12;

    let baseFee: number;
    let perKmRate: number;
    let surge: number;
    let isSameZone: boolean;

    if (pickupZone && deliveryZone) {
      isSameZone = pickupZone.id === deliveryZone.id;

      if (isSameZone) {
        baseFee = pickupZone.baseDeliveryFee;
        perKmRate = pickupZone.perKmRate;
        surge = pickupZone.surgeMultiplier;
      } else {
        baseFee =
          (pickupZone.baseDeliveryFee + deliveryZone.baseDeliveryFee) / 2;
        perKmRate =
          Math.max(pickupZone.perKmRate, deliveryZone.perKmRate) * 1.2;
        surge = Math.max(
          pickupZone.surgeMultiplier,
          deliveryZone.surgeMultiplier,
        );
      }
    } else {
      isSameZone = false;
      baseFee = defaultBaseFee;
      perKmRate = defaultPerKm;
      surge = 1.0;
    }

    const distanceFee = distance * perKmRate;
    const subtotal = baseFee + distanceFee;
    const total = Math.round(subtotal * surge);

    return {
      distance: Math.round(distance * 100) / 100,
      baseFee: Math.round(baseFee),
      distanceFee: Math.round(distanceFee),
      surgeMultiplier: surge,
      total,
      isSameZone,
      pickupZone: pickupZone
        ? {
            id: pickupZone.id,
            name: pickupZone.name,
            code: pickupZone.code,
            district: pickupZone.district,
          }
        : null,
      deliveryZone: deliveryZone
        ? {
            id: deliveryZone.id,
            name: deliveryZone.name,
            code: deliveryZone.code,
            district: deliveryZone.district,
          }
        : null,
      estimatedMinutes: isSameZone
        ? pickupZone?.estimatedDeliveryMinutes || 30
        : Math.round(
            ((pickupZone?.estimatedDeliveryMinutes || 30) +
              (deliveryZone?.estimatedDeliveryMinutes || 30)) /
              2 +
              distance * 3,
          ),
    };
  }

  // ═══════════════════════════════════════════════════
  //  CRUD
  // ═══════════════════════════════════════════════════

  async findAll(filters?: { city?: string; isActive?: boolean }): Promise<Zone[]> {
    const where: Prisma.ZoneWhereInput = {};
    if (filters?.city) where.city = filters.city;
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;

    return this.prisma.zone.findMany({
      where,
      orderBy: [{ city: 'asc' }, { district: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string): Promise<Zone> {
    const zone = await this.prisma.zone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Zone not found');
    return zone;
  }

  async findByCode(code: string): Promise<Zone> {
    const zone = await this.prisma.zone.findUnique({ where: { code } });
    if (!zone) throw new NotFoundException(`Zone ${code} not found`);
    return zone;
  }

  async create(data: Prisma.ZoneCreateInput): Promise<Zone> {
    const polygon = data.polygon as any;
    if (!polygon || polygon.length < 3) {
      throw new BadRequestException(
        'Polygon must have at least 3 coordinate pairs',
      );
    }
    if (!data.centerLat || !data.centerLng) {
      const center = this.calculatePolygonCenter(polygon);
      data.centerLat = center.lat;
      data.centerLng = center.lng;
    }

    return this.prisma.zone.create({ data });
  }

  async update(id: string, data: Prisma.ZoneUpdateInput): Promise<Zone> {
    await this.findById(id);

    const polygon = data.polygon as any;
    if (polygon && polygon.length >= 3) {
      const center = this.calculatePolygonCenter(polygon);
      data.centerLat = center.lat;
      data.centerLng = center.lng;
    }

    return this.prisma.zone.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.zone.delete({ where: { id } });
  }

  /** Set surge multiplier for a zone (e.g., during peak hours or bad weather) */
  async setSurge(id: string, multiplier: number): Promise<Zone> {
    if (multiplier < 1.0 || multiplier > 5.0) {
      throw new BadRequestException('Surge must be between 1.0 and 5.0');
    }
    await this.findById(id);
    return this.prisma.zone.update({
      where: { id },
      data: { surgeMultiplier: multiplier },
    });
  }

  /** Get all zones as GeoJSON FeatureCollection (for map rendering) */
  async getGeoJSON() {
    const zones = await this.prisma.zone.findMany({
      where: { isActive: true },
    });

    return {
      type: 'FeatureCollection',
      features: zones.map((zone) => ({
        type: 'Feature',
        properties: {
          id: zone.id,
          name: zone.name,
          code: zone.code,
          district: zone.district,
          city: zone.city,
          barangays: zone.barangays,
          baseDeliveryFee: zone.baseDeliveryFee,
          surgeMultiplier: zone.surgeMultiplier,
          color: zone.color,
          estimatedDeliveryMinutes: zone.estimatedDeliveryMinutes,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [(zone.polygon as number[][]).map(([lat, lng]) => [lng, lat])],
        },
      })),
    };
  }

  // ═══════════════════════════════════════════════════
  //  SEEDING — Pre-populate Manila districts
  // ═══════════════════════════════════════════════════

  async seedManilaDistricts(): Promise<{ seeded: number; skipped: number }> {
    const districts = this.getManilaDistrictData();
    let seeded = 0;
    let skipped = 0;

    for (const d of districts) {
      const exists = await this.prisma.zone.findUnique({
        where: { code: d.code! },
      });
      if (exists) {
        skipped++;
        continue;
      }

      await this.create(d as Prisma.ZoneCreateInput);
      seeded++;
    }

    return { seeded, skipped };
  }

  // ═══════════════════════════════════════════════════
  //  ALGORITHMS
  // ═══════════════════════════════════════════════════

  /**
   * Ray-casting algorithm for point-in-polygon detection.
   * Casts a ray from the point to the right and counts intersections.
   * Odd number of crossings = inside, even = outside.
   */
  private isPointInPolygon(
    lat: number,
    lng: number,
    polygon: number[][],
  ): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [yi, xi] = polygon[i]; // [lat, lng]
      const [yj, xj] = polygon[j];

      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /** Haversine formula — distance between two coordinates in km */
  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /** Calculate centroid of a polygon */
  private calculatePolygonCenter(polygon: number[][]): {
    lat: number;
    lng: number;
  } {
    let latSum = 0;
    let lngSum = 0;
    const n = polygon.length;

    for (const [lat, lng] of polygon) {
      latSum += lat;
      lngSum += lng;
    }

    return {
      lat: latSum / n,
      lng: lngSum / n,
    };
  }

  // ═══════════════════════════════════════════════════
  //  MANILA DISTRICT SEED DATA
  //  Approximate polygon boundaries for Manila's 6 districts.
  //  Coordinates are [latitude, longitude] pairs.
  // ═══════════════════════════════════════════════════

  private getManilaDistrictData(): Partial<Zone>[] {
    return [
      {
        name: 'District 1 — Tondo West',
        code: 'MNL-D1',
        district: 'District 1',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Tondo (Barangays 1-57)',
          'Balut',
          'Isla de Tanduay',
          'Vitas',
          'Magsaysay Village',
        ],
        polygon: [
          [14.6230, 120.9550],
          [14.6200, 120.9650],
          [14.6100, 120.9700],
          [14.6020, 120.9680],
          [14.5980, 120.9620],
          [14.5980, 120.9550],
          [14.6100, 120.9520],
          [14.6230, 120.9550],
        ],
        centerLat: 14.6095,
        centerLng: 120.9610,
        baseDeliveryFee: 45,
        perKmRate: 10,
        estimatedDeliveryMinutes: 25,
        color: '#E91E63',
        isActive: true,
        priority: 1,
      },
      {
        name: 'District 2 — Tondo East/San Andres',
        code: 'MNL-D2',
        district: 'District 2',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Tondo (Barangays 58-267)',
          'San Andres',
          'Santa Ana',
        ],
        polygon: [
          [14.6200, 120.9650],
          [14.6200, 120.9780],
          [14.6050, 120.9800],
          [14.5920, 120.9780],
          [14.5920, 120.9680],
          [14.6020, 120.9680],
          [14.6100, 120.9700],
          [14.6200, 120.9650],
        ],
        centerLat: 14.6058,
        centerLng: 120.9730,
        baseDeliveryFee: 45,
        perKmRate: 10,
        estimatedDeliveryMinutes: 25,
        color: '#9C27B0',
        isActive: true,
        priority: 1,
      },
      {
        name: 'District 3 — Binondo/Sta. Cruz/Quiapo/San Nicolas',
        code: 'MNL-D3',
        district: 'District 3',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Binondo',
          'Quiapo',
          'San Nicolas',
          'Santa Cruz',
        ],
        polygon: [
          [14.6050, 120.9800],
          [14.6050, 120.9860],
          [14.6020, 120.9920],
          [14.5990, 120.9920],
          [14.5960, 120.9900],
          [14.5930, 120.9870],
          [14.5920, 120.9830],
          [14.5920, 120.9780],
          [14.5960, 120.9780],
          [14.6020, 120.9800],
          [14.6050, 120.9800],
        ],
        centerLat: 14.5985,
        centerLng: 120.9852,
        baseDeliveryFee: 39,
        perKmRate: 8,
        estimatedDeliveryMinutes: 20,
        color: '#FF5722',
        isActive: true,
        priority: 2,
      },
      {
        name: 'District 4 — Sampaloc/San Miguel',
        code: 'MNL-D4',
        district: 'District 4',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Sampaloc',
          'San Miguel',
        ],
        polygon: [
          [14.6120, 120.9860],
          [14.6120, 120.9980],
          [14.6020, 121.0020],
          [14.5990, 120.9920],
          [14.6020, 120.9860],
          [14.6050, 120.9860],
          [14.6120, 120.9860],
        ],
        centerLat: 14.6057,
        centerLng: 120.9930,
        baseDeliveryFee: 45,
        perKmRate: 10,
        estimatedDeliveryMinutes: 25,
        color: '#4CAF50',
        isActive: true,
        priority: 1,
      },
      {
        name: 'District 5 — Ermita/Malate/Intramuros',
        code: 'MNL-D5',
        district: 'District 5',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Ermita',
          'Malate',
          'Intramuros',
          'Port Area',
          'Paco',
        ],
        polygon: [
          [14.5920, 120.9780],
          [14.5930, 120.9870],
          [14.5900, 120.9900],
          [14.5800, 120.9920],
          [14.5700, 120.9850],
          [14.5680, 120.9750],
          [14.5750, 120.9650],
          [14.5850, 120.9600],
          [14.5920, 120.9620],
          [14.5920, 120.9780],
        ],
        centerLat: 14.5820,
        centerLng: 120.9770,
        baseDeliveryFee: 49,
        perKmRate: 10,
        estimatedDeliveryMinutes: 25,
        color: '#2196F3',
        isActive: true,
        priority: 1,
      },
      {
        name: 'District 6 — Pandacan/Santa Ana',
        code: 'MNL-D6',
        district: 'District 6',
        city: 'Manila',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Pandacan',
          'Santa Ana (South)',
          'San Andres Bukid',
          'Santa Mesa',
        ],
        polygon: [
          [14.5990, 120.9920],
          [14.6020, 121.0020],
          [14.5950, 121.0080],
          [14.5850, 121.0050],
          [14.5750, 121.0000],
          [14.5750, 120.9920],
          [14.5800, 120.9920],
          [14.5900, 120.9900],
          [14.5990, 120.9920],
        ],
        centerLat: 14.5890,
        centerLng: 120.9970,
        baseDeliveryFee: 45,
        perKmRate: 10,
        estimatedDeliveryMinutes: 28,
        color: '#FF9800',
        isActive: true,
        priority: 1,
      },
      {
        name: 'Makati CBD',
        code: 'MKT-CBD',
        district: 'Poblacion/CBD',
        city: 'Makati',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Bel-Air',
          'Legazpi Village',
          'Salcedo Village',
          'Urdaneta',
          'San Lorenzo',
          'Poblacion',
        ],
        polygon: [
          [14.5650, 121.0150],
          [14.5650, 121.0300],
          [14.5520, 121.0320],
          [14.5450, 121.0280],
          [14.5450, 121.0150],
          [14.5550, 121.0120],
          [14.5650, 121.0150],
        ],
        centerLat: 14.5547,
        centerLng: 121.0244,
        baseDeliveryFee: 55,
        perKmRate: 12,
        estimatedDeliveryMinutes: 20,
        color: '#00BCD4',
        isActive: true,
        priority: 1,
      },
      {
        name: 'BGC — Bonifacio Global City',
        code: 'TGG-BGC',
        district: 'BGC',
        city: 'Taguig',
        province: 'Metro Manila',
        region: 'NCR',
        barangays: [
          'Fort Bonifacio',
          'Upper McKinley',
          'Lower McKinley',
        ],
        polygon: [
          [14.5550, 121.0440],
          [14.5550, 121.0580],
          [14.5420, 121.0600],
          [14.5370, 121.0520],
          [14.5400, 121.0440],
          [14.5480, 121.0410],
          [14.5550, 121.0440],
        ],
        centerLat: 14.5480,
        centerLng: 121.0500,
        baseDeliveryFee: 59,
        perKmRate: 12,
        estimatedDeliveryMinutes: 20,
        color: '#673AB7',
        isActive: true,
        priority: 1,
      },
    ];
  }
}
