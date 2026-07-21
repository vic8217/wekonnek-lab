import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Order,
  OrderStatus,
  OrderType,
  PaymentStatus,
  UserRole,
  Prisma,
} from '@prisma/client';
import { ZonesService } from '../zones/zones.service';
import { InvoicesService } from '../invoices/invoices.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { LoyaltyService } from '../loyalty/loyalty.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zonesService: ZonesService,
    private readonly invoicesService: InvoicesService,
    private readonly vouchersService: VouchersService,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  async create(
    data: Prisma.OrderUncheckedCreateInput & { voucherCode?: string },
  ): Promise<Order> {
    const count = await this.prisma.order.count();
    data.orderNumber = `ORD-${String(count + 1).padStart(6, '0')}`;

    const items = data.items as any[];
    if (items && items.length > 0) {
      data.subtotal = items.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0,
      );
    }

    data.deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();

    // ─── AUTO-DETECT ZONES ─────────────────────────
    const pickupAddr = data.pickupAddress as any;
    const deliveryAddr = data.deliveryAddress as any;

    if (pickupAddr?.lat && pickupAddr?.lng) {
      const pickupZone = await this.zonesService.findZoneByCoordinates(
        pickupAddr.lat,
        pickupAddr.lng,
      );
      if (pickupZone) {
        data.pickupZoneId = pickupZone.id;
        data.pickupZoneCode = pickupZone.code;
        data.pickupZoneName = pickupZone.name;
      }
    }

    if (deliveryAddr?.lat && deliveryAddr?.lng) {
      const deliveryZone = await this.zonesService.findZoneByCoordinates(
        deliveryAddr.lat,
        deliveryAddr.lng,
      );
      if (deliveryZone) {
        data.deliveryZoneId = deliveryZone.id;
        data.deliveryZoneCode = deliveryZone.code;
        data.deliveryZoneName = deliveryZone.name;
      }
    }

    data.isCrossZone =
      !!data.pickupZoneId &&
      !!data.deliveryZoneId &&
      data.pickupZoneId !== data.deliveryZoneId;

    if (!data.deliveryFee && pickupAddr?.lat && deliveryAddr?.lat) {
      const feeResult = await this.zonesService.calculateDeliveryFee(
        pickupAddr.lat,
        pickupAddr.lng,
        deliveryAddr.lat,
        deliveryAddr.lng,
      );
      data.deliveryFee = feeResult.total;
      data.estimatedDeliveryTime = `${feeResult.estimatedMinutes} min`;
    }

    // ─── VOUCHER DISCOUNT ──────────────────────────
    let voucherValidation: any = null;
    if (data.voucherCode && data.customerId) {
      voucherValidation = await this.vouchersService.validate(
        data.voucherCode,
        data.customerId,
        data.subtotal || 0,
        data.type,
        data.storeId ?? undefined,
      );
      if (voucherValidation.valid) {
        data.discount = voucherValidation.discountAmount;
        data.voucherCode = voucherValidation.voucher.code;
        data.voucherId = voucherValidation.voucher.id;
      } else {
        this.logger.warn(
          `Voucher "${data.voucherCode}" rejected: ${voucherValidation.reason}`,
        );
        data.discount = data.discount || 0;
      }
    }

    // ─── FINAL TOTAL ───────────────────────────────
    data.total =
      (data.subtotal || 0) + (data.deliveryFee || 0) - (data.discount || 0);

    // Remove the non-schema field before passing to Prisma
    const { voucherCode: _vc, ...createData } = data;
    const savedOrder = await this.prisma.order.create({ data: createData });

    if (voucherValidation?.valid) {
      await this.vouchersService.redeem(
        voucherValidation.voucher.id,
        savedOrder.customerId,
        savedOrder.id,
        voucherValidation.discountAmount,
      );
    }

    return savedOrder;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { customer: true, rider: true, store: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async findByCustomer(customerId: string): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { customerId },
      include: { store: true, rider: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRider(riderId: string): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { riderId },
      include: { customer: true, store: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPendingOrders(): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.pending },
      include: { customer: true, store: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(filters?: {
    type?: OrderType;
    status?: OrderStatus;
  }): Promise<Order[]> {
    const where: Prisma.OrderWhereInput = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;
    return this.prisma.order.findMany({
      where,
      include: { customer: true, store: true, rider: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await this.findById(id);

    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.pending]: [OrderStatus.confirmed, OrderStatus.cancelled],
      [OrderStatus.confirmed]: [OrderStatus.preparing, OrderStatus.cancelled],
      [OrderStatus.preparing]: [
        OrderStatus.ready_for_pickup,
        OrderStatus.cancelled,
      ],
      [OrderStatus.ready_for_pickup]: [
        OrderStatus.rider_assigned,
        OrderStatus.cancelled,
      ],
      [OrderStatus.rider_assigned]: [
        OrderStatus.picked_up,
        OrderStatus.cancelled,
      ],
      [OrderStatus.picked_up]: [OrderStatus.in_transit],
      [OrderStatus.in_transit]: [OrderStatus.delivered],
      [OrderStatus.delivered]: [],
      [OrderStatus.cancelled]: [],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${status}`,
      );
    }

    const savedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: { customer: true, rider: true, store: true },
    });

    // ─── AUTO-ASSIGN RIDER on READY_FOR_PICKUP ─────
    if (status === OrderStatus.ready_for_pickup) {
      try {
        const assigned = await this.autoAssignRider(id);
        if (assigned) {
          this.logger.log(
            `Auto-assigned rider ${assigned.riderId} to order ${savedOrder.orderNumber}`,
          );
          return assigned;
        }
      } catch (err) {
        this.logger.error(
          `Failed to auto-assign rider for order ${savedOrder.orderNumber}: ${err.message}`,
        );
      }
    }

    // ─── AUTO-GENERATE BIR E-INVOICE on DELIVERED ───
    if (status === OrderStatus.delivered) {
      try {
        await this.invoicesService.generateFromOrder(savedOrder);
        this.logger.log(
          `E-Invoice generated for order ${savedOrder.orderNumber}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to generate invoice for order ${savedOrder.orderNumber}: ${err.message}`,
        );
      }

      // ─── AWARD LOYALTY POINTS ────────────────────
      try {
        await this.loyaltyService.earnPoints(
          savedOrder.customerId,
          savedOrder.total,
          savedOrder.id,
        );
      } catch (err) {
        this.logger.error(
          `Failed to award loyalty points for order ${savedOrder.orderNumber}: ${err.message}`,
        );
      }
    }

    return savedOrder;
  }

  async assignRider(orderId: string, riderId: string): Promise<Order> {
    await this.findById(orderId);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { riderId, status: OrderStatus.rider_assigned },
      include: { customer: true, rider: true, store: true },
    });
  }

  async rateOrder(
    orderId: string,
    rating: number,
    review?: string,
  ): Promise<Order> {
    await this.findById(orderId);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { customerRating: rating, customerReview: review ?? '' },
    });
  }

  async updatePaymentStatus(
    orderId: string,
    paymentStatus: PaymentStatus,
    paymentRef?: string,
  ): Promise<Order> {
    await this.findById(orderId);
    const data: Prisma.OrderUpdateInput = { paymentStatus };
    if (paymentRef) data.paymentRef = paymentRef;
    return this.prisma.order.update({ where: { id: orderId }, data });
  }

  async estimateExpressDelivery(
    pickupLat: number,
    pickupLng: number,
    deliveryLat: number,
    deliveryLng: number,
    weight?: 'small' | 'medium' | 'large',
  ) {
    const feeResult = await this.zonesService.calculateDeliveryFee(
      pickupLat,
      pickupLng,
      deliveryLat,
      deliveryLng,
    );

    const weightSurcharge: Record<string, number> = {
      small: 0,
      medium: 30,
      large: 60,
    };
    const surcharge = weightSurcharge[weight ?? 'small'] ?? 0;

    return {
      baseDeliveryFee: feeResult.total,
      weightSurcharge: surcharge,
      totalFee: feeResult.total + surcharge,
      estimatedMinutes: feeResult.estimatedMinutes,
      estimatedTime: `${feeResult.estimatedMinutes} min`,
      breakdown: {
        pickup: { lat: pickupLat, lng: pickupLng, zone: feeResult['pickupZone'] ?? null },
        delivery: { lat: deliveryLat, lng: deliveryLng, zone: feeResult['deliveryZone'] ?? null },
        weight: weight ?? 'small',
        isCrossZone: feeResult['isCrossZone'] ?? false,
      },
    };
  }

  async autoAssignRider(orderId: string): Promise<Order | null> {
    const order = await this.findById(orderId);

    if (!order.pickupZoneId) {
      this.logger.warn(`Order ${orderId} has no pickup zone — skipping auto-assign`);
      return null;
    }

    const riders = await this.prisma.user.findMany({
      where: {
        role: UserRole.rider,
        isOnline: true,
        zones: { some: { zoneId: order.pickupZoneId } },
      },
    });

    if (riders.length === 0) {
      this.logger.warn(`No online riders in zone ${order.pickupZoneId} for order ${orderId}`);
      return null;
    }

    const pickupAddr = order.pickupAddress as any;
    const pickupLat = pickupAddr?.lat as number | undefined;
    const pickupLng = pickupAddr?.lng as number | undefined;

    let bestRider = riders[0];

    if (pickupLat && pickupLng) {
      let bestDistance = Infinity;
      for (const rider of riders) {
        if (rider.currentLat != null && rider.currentLng != null) {
          const dist = this.haversineDistance(
            pickupLat,
            pickupLng,
            rider.currentLat,
            rider.currentLng,
          );
          if (dist < bestDistance) {
            bestDistance = dist;
            bestRider = rider;
          }
        }
      }
    }

    return this.assignRider(orderId, bestRider.id);
  }

  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getStats() {
    const [totalOrders, pendingOrders, revenueResult] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.pending } }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: OrderStatus.delivered },
      }),
    ]);

    return {
      totalOrders,
      pendingOrders,
      totalRevenue: revenueResult._sum.total || 0,
    };
  }
}
