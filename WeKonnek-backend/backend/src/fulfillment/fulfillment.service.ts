import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from './order-domain-event.service';

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
  ) {}

  /**
   * Ensure a canonical OrderFulfillment exists for a marketplace WkOrder.
   * Does not alter checkout; callers invoke when delivery fulfillment begins.
   */
  async ensureForWkOrder(
    wkOrderId: number,
    options: {
      actorId?: string | null;
      correlationId?: string;
      tx?: Prisma.TransactionClient;
    } = {},
  ) {
    const client = options.tx ?? this.prisma;
    const existing = await client.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    if (existing) return existing;

    const order = await client.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Commerce order not found');
    if (order.orderType === 'pickup' || order.orderType === 'dine_in' || order.orderType === 'in_store') {
      throw new BadRequestException(
        `Order type ${order.orderType} does not use delivery fulfillment`,
      );
    }

    const created = await client.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: order.merchantId,
        shopId: order.shopId,
        customerId: order.userId,
        status: FulfillmentStatus.pending,
        deliveryPin: String(Math.floor(1000 + Math.random() * 9000)),
      },
    });

    await this.events.record({
      tx: options.tx,
      aggregateType: 'ORDER_FULFILLMENT',
      aggregateId: created.id,
      fulfillmentId: created.id,
      wkOrderId: order.id,
      actorId: options.actorId,
      actorType: 'SYSTEM',
      action: 'FULFILLMENT_CREATED',
      previousState: null,
      newState: created.status,
      correlationId: options.correlationId,
      metadata: { orderType: order.orderType },
    });

    return created;
  }

  async findById(id: string) {
    const row = await this.prisma.orderFulfillment.findUnique({
      where: { id },
      include: { assignments: { orderBy: { assignedAt: 'desc' } } },
    });
    if (!row) throw new NotFoundException('Fulfillment not found');
    return row;
  }
}
