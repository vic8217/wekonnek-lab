import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementPartyRole,
  CustodyEventType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';

/**
 * Custody evidence complements Stage 0 fulfillment — it does NOT mutate
 * fulfillment status. Callers must use FulfillmentTransitionService for that.
 */
@Injectable()
export class CustodyEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
  ) {}

  async record(input: {
    actorUserId: string;
    eventType: CustodyEventType;
    wkOrderId?: number;
    fulfillmentId?: string;
    agreementId?: string;
    fromPartyRole?: AgreementPartyRole;
    toPartyRole?: AgreementPartyRole;
    fromUserId?: string;
    toUserId?: string;
    evidenceIds?: string[];
    correlationId?: string;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date;
    /** Optional outer transaction (Stage 3A atomic handoff). */
    tx?: Prisma.TransactionClient;
  }) {
    const db = input.tx ?? this.prisma;
    if (!input.wkOrderId && !input.fulfillmentId) {
      throw new BadRequestException(
        'wkOrderId or fulfillmentId is required for custody events',
      );
    }

    let wkOrderId = input.wkOrderId ?? null;
    let fulfillmentId = input.fulfillmentId ?? null;
    let merchantId: number | null = null;
    let customerId: string | null = null;
    let activeRiderId: string | null = null;

    if (fulfillmentId) {
      const fulfillment = await db.orderFulfillment.findUnique({
        where: { id: fulfillmentId },
      });
      if (!fulfillment) throw new NotFoundException('Fulfillment not found');
      wkOrderId = fulfillment.wkOrderId ?? wkOrderId;
      merchantId = fulfillment.merchantId;
      customerId = fulfillment.customerId;
      activeRiderId = fulfillment.activeRiderId;
    } else if (wkOrderId != null) {
      const order = await db.wkOrder.findUnique({
        where: { id: wkOrderId },
      });
      if (!order) throw new NotFoundException('Order not found');
      merchantId = order.merchantId;
      customerId = order.userId;
      const fulfillment = await db.orderFulfillment.findUnique({
        where: { wkOrderId },
      });
      if (fulfillment) {
        fulfillmentId = fulfillment.id;
        activeRiderId = fulfillment.activeRiderId;
      }
    }

    await this.assertActorAuthorized({
      actorUserId: input.actorUserId,
      merchantId,
      customerId,
      activeRiderId,
      eventType: input.eventType,
      db,
    });

    // Party labels are descriptive only. Any supplied user identity must be a
    // persisted party for this order, even when the client omits/mislabels role.
    const merchantUsers = merchantId == null
      ? null
      : await db.merchant.findUnique({
          where: { id: merchantId },
          select: {
            userId: true,
            merchantStaff: { where: { isActive: true }, select: { userId: true } },
          },
        });
    const knownPartyUserIds = new Set(
      [
        customerId,
        activeRiderId,
        merchantUsers?.userId,
        ...(merchantUsers?.merchantStaff.map((staff) => staff.userId) ?? []),
      ].filter((id): id is string => Boolean(id)),
    );
    for (const userId of [input.fromUserId, input.toUserId]) {
      if (userId && !knownPartyUserIds.has(userId)) {
        throw new ForbiddenException(
          'Custody party user must match a persisted order relationship',
        );
      }
    }

    if (input.agreementId) {
      const agreement = await db.agreement.findUnique({
        where: { id: input.agreementId },
        select: { wkOrderId: true },
      });
      if (!agreement || agreement.wkOrderId !== wkOrderId) {
        throw new BadRequestException(
          'agreementId must belong to the custody event order',
        );
      }
    }
    if (input.evidenceIds?.length) {
      const evidence = await db.agreementEvidence.findMany({
        where: { id: { in: input.evidenceIds } },
        select: { id: true, wkOrderId: true, agreementId: true },
      });
      if (
        evidence.length !== input.evidenceIds.length ||
        evidence.some(
          (row) =>
            row.wkOrderId !== wkOrderId ||
            (input.agreementId != null && row.agreementId !== input.agreementId),
        )
      ) {
        throw new BadRequestException(
          'Custody evidence must belong to the same order and agreement',
        );
      }
    }

    // Do not trust client-supplied party user ids unless they match persisted relationships
    if (input.toUserId && activeRiderId && input.toPartyRole === 'RIDER') {
      if (input.toUserId !== activeRiderId) {
        throw new ForbiddenException(
          'toUserId rider must match active fulfillment assignment',
        );
      }
    }
    if (input.fromUserId && input.fromPartyRole === 'CUSTOMER') {
      if (input.fromUserId !== customerId) {
        throw new ForbiddenException('fromUserId customer mismatch');
      }
    }

    const event = await db.custodyEvent.create({
      data: {
        id: randomUUID(),
        wkOrderId: wkOrderId ?? undefined,
        fulfillmentId: fulfillmentId ?? undefined,
        agreementId: input.agreementId,
        eventType: input.eventType,
        fromPartyRole: input.fromPartyRole,
        toPartyRole: input.toPartyRole,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt ?? new Date(),
        correlationId: input.correlationId,
        metadata: {
          ...(typeof input.metadata === 'object' && input.metadata
            ? (input.metadata as object)
            : {}),
          fulfillmentStatusUnchanged: true,
        },
        evidences: input.evidenceIds?.length
          ? {
              create: input.evidenceIds.map((evidenceId) => ({
                id: randomUUID(),
                evidenceId,
              })),
            }
          : undefined,
      },
      include: { evidences: true },
    });

    await this.events.record({
      tx: input.tx,
      aggregateType: 'AGREEMENT',
      aggregateId: input.agreementId ?? event.id,
      wkOrderId: wkOrderId ?? undefined,
      fulfillmentId: fulfillmentId ?? undefined,
      actorId: input.actorUserId,
      action: 'CUSTODY_EVENT_RECORDED',
      correlationId: input.correlationId,
      metadata: {
        custodyEventId: event.id,
        eventType: event.eventType,
        note: 'Does not mutate fulfillment state machine',
      },
    });

    return event;
  }

  async listForOrder(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    await this.assertActorAuthorized({
      actorUserId,
      merchantId: order.merchantId,
      customerId: order.userId,
      activeRiderId: (
        await this.prisma.orderFulfillment.findUnique({
          where: { wkOrderId },
          select: { activeRiderId: true },
        })
      )?.activeRiderId ?? null,
      eventType: CustodyEventType.GOODS_PREPARED,
      readOnly: true,
    });
    return this.prisma.custodyEvent.findMany({
      where: { wkOrderId },
      include: { evidences: true },
      orderBy: { occurredAt: 'asc' },
    });
  }

  private async assertActorAuthorized(input: {
    actorUserId: string;
    merchantId: number | null;
    customerId: string | null;
    activeRiderId: string | null;
    eventType: CustodyEventType;
    readOnly?: boolean;
    db?: Prisma.TransactionClient | PrismaService;
  }) {
    const db = input.db ?? this.prisma;
    if (input.customerId === input.actorUserId) {
      if (input.readOnly) return;
      const allowed: CustodyEventType[] = [
        CustodyEventType.CUSTOMER_RECEIVED,
        CustodyEventType.RETURN_INITIATED,
      ];
      if (!allowed.includes(input.eventType)) {
        throw new ForbiddenException(
          'Customer cannot record this custody event type',
        );
      }
      return;
    }

    if (input.activeRiderId === input.actorUserId) {
      if (input.readOnly) return;
      const allowed: CustodyEventType[] = [
        CustodyEventType.RIDER_RECEIVED,
        CustodyEventType.IN_TRANSIT,
        CustodyEventType.CUSTOMER_RECEIVED,
        CustodyEventType.RETURN_RECEIVED,
      ];
      if (!allowed.includes(input.eventType)) {
        throw new ForbiddenException(
          'Rider cannot record this custody event type',
        );
      }
      return;
    }

    if (input.merchantId != null) {
      const op = await db.merchant.findFirst({
        where: {
          id: input.merchantId,
          OR: [
            { userId: input.actorUserId },
            {
              merchantStaff: {
                some: { userId: input.actorUserId, isActive: true },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (op) {
        if (!input.readOnly) {
          const allowed: CustodyEventType[] = [
            CustodyEventType.GOODS_PREPARED,
            CustodyEventType.MERCHANT_RELEASED,
            CustodyEventType.RETURN_RECEIVED,
          ];
          if (!allowed.includes(input.eventType)) {
            throw new ForbiddenException(
              'Merchant cannot record this custody event type',
            );
          }
        }
        return;
      }
    }

    throw new ForbiddenException('Not authorized for custody events on this order');
  }
}
