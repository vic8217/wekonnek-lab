import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RiderLocation } from '@prisma/client';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveLocation(data: {
    riderId: string;
    orderId?: string;
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
  }): Promise<RiderLocation> {
    return this.prisma.riderLocation.create({ data });
  }

  async getLatestLocation(riderId: string): Promise<RiderLocation | null> {
    return this.prisma.riderLocation.findFirst({
      where: { riderId },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getLocationHistory(
    riderId: string,
    orderId?: string,
    limit = 100,
  ): Promise<RiderLocation[]> {
    const where: any = { riderId };
    if (orderId) where.orderId = orderId;

    return this.prisma.riderLocation.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
  }

  async getActiveRiders(): Promise<
    { riderId: string; lat: number; lng: number; recordedAt: Date }[]
  > {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    return this.prisma.$queryRaw<
      { riderId: string; lat: number; lng: number; recordedAt: Date }[]
    >`
      SELECT DISTINCT ON (rider_id)
        rider_id AS "riderId",
        lat,
        lng,
        recorded_at AS "recordedAt"
      FROM rider_locations
      WHERE recorded_at > ${fiveMinAgo}
      ORDER BY rider_id, recorded_at DESC
    `;
  }

  async getOrderTrail(orderId: string): Promise<RiderLocation[]> {
    return this.prisma.riderLocation.findMany({
      where: { orderId },
      orderBy: { recordedAt: 'asc' },
    });
  }

  /**
   * Latest canonical sample for one WkOrder. Never reads the legacy orderId
   * column, so an orders_v2 trail cannot leak into this contract.
   */
  async getLatestByWkOrderId(wkOrderId: number) {
    return this.prisma.riderLocation.findFirst({
      where: { wkOrderId },
      orderBy: { recordedAt: 'desc' },
      select: {
        riderId: true,
        lat: true,
        lng: true,
        accuracy: true,
        heading: true,
        speed: true,
        recordedAt: true,
      },
    });
  }
}
