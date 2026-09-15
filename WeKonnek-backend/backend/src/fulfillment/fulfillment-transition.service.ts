import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FulfillmentStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertOperationAllowed,
  AuthActor,
} from './fulfillment-authorization';
import {
  assertFulfillmentTransition,
  fromOrderStatus,
  FulfillmentLifecycleStatus,
  TERMINAL_FULFILLMENT_STATUSES,
  toFulfillmentStatus,
  toOrderStatus,
} from './fulfillment-state-machine';
import { OrderDomainEventService } from './order-domain-event.service';
import { RiderAssignmentService } from './rider-assignment.service';

export interface TransitionInput {
  fulfillmentId?: string;
  orderV2Id?: string;
  wkOrderId?: number;
  targetStatus: FulfillmentLifecycleStatus | OrderStatus | FulfillmentStatus;
  actor: AuthActor;
  reason?: string;
  correlationId?: string;
  expectedVersion?: number;
  /** Optional rider id when transitioning to rider_assigned */
  riderId?: string;
  allowReassignment?: boolean;
  /**
   * Merchant ids the actor may operate. When omitted for merchant actors,
   * authorization falls back to merchantId match on the fulfillment only if
   * actorMerchantIds is later populated by callers.
   */
  actorMerchantIds?: number[];
  merchantOwnerUserId?: string | null;
}

@Injectable()
export class FulfillmentTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly assignments: RiderAssignmentService,
  ) {}

  /**
   * Single authoritative path for fulfillment status changes.
   * REST / WebSocket / future QR must call this — not duplicate transition rules.
   */
  async transition(input: TransitionInput) {
    const target = fromOrderStatus(String(input.targetStatus));

    if (target === 'rider_assigned') {
      if (!input.riderId) {
        throw new BadRequestException(
          'riderId is required when transitioning to rider_assigned',
        );
      }
      return this.assignments.assign({
        fulfillmentId: input.fulfillmentId,
        orderV2Id: input.orderV2Id,
        riderId: input.riderId,
        actor: input.actor,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        correlationId: input.correlationId,
        allowReassignment: input.allowReassignment,
        actorMerchantIds: input.actorMerchantIds,
        merchantOwnerUserId: input.merchantOwnerUserId,
      });
    }

    return this.prisma.$transaction(
      async (tx) => this.runTransitionInTx(tx, input, target),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Transition helper for callers that already hold a Serializable transaction
   * (e.g. Stage 3A pickup handoff atomic confirm).
   */
  async transitionInTx(
    tx: Prisma.TransactionClient,
    input: TransitionInput,
    target: FulfillmentLifecycleStatus,
  ) {
    return this.runTransitionInTx(tx, input, target);
  }

  private async runTransitionInTx(
    tx: Prisma.TransactionClient,
    input: TransitionInput,
    target: FulfillmentLifecycleStatus,
  ) {
    const fulfillment = await this.resolveAndLock(tx, input);
    const from = fromOrderStatus(fulfillment.status);

    // Idempotent duplicate transition
    if (from === target) {
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: fulfillment.id,
        fulfillmentId: fulfillment.id,
        wkOrderId: fulfillment.wkOrderId,
        orderV2Id: fulfillment.orderV2Id,
        actorId: input.actor.id,
        actorType: input.actor.type,
        action: 'FULFILLMENT_TRANSITION_IDEMPOTENT',
        previousState: from,
        newState: target,
        reason: input.reason,
        correlationId: input.correlationId,
      });
      return { fulfillment, idempotent: true };
    }

    if (TERMINAL_FULFILLMENT_STATUSES.has(from)) {
      throw new BadRequestException(
        `Fulfillment is terminal (${from}); cannot transition to ${target}`,
      );
    }

    assertFulfillmentTransition(from, target);

    const operation =
      target === 'cancelled' ? 'cancel' : ('transition' as const);

    assertOperationAllowed(
      input.actor,
      operation,
      {
        customerId: fulfillment.customerId,
        merchantId: fulfillment.merchantId,
        shopId: fulfillment.shopId,
        activeRiderId: fulfillment.activeRiderId,
        status: from,
        actorMerchantIds: input.actorMerchantIds,
        merchantOwnerUserId: input.merchantOwnerUserId,
      },
      target,
    );

    if (
      input.expectedVersion != null &&
      input.expectedVersion !== fulfillment.assignmentVersion
    ) {
      throw new ConflictException(
        `Fulfillment version conflict: expected ${input.expectedVersion}, current ${fulfillment.assignmentVersion}`,
      );
    }

    // Cancellation race: if another txn already moved status, serializable retry / fail
    const data: Prisma.OrderFulfillmentUpdateInput = {
      status: toFulfillmentStatus(target),
    };
    if (target === 'cancelled') data.cancelledAt = new Date();
    if (target === 'delivered') data.deliveredAt = new Date();

    const updated = await tx.orderFulfillment.update({
      where: { id: fulfillment.id },
      data,
    });

    if (fulfillment.orderV2Id) {
      await tx.order.update({
        where: { id: fulfillment.orderV2Id },
        data: { status: toOrderStatus(target) },
      });
    }

    await this.events.record({
      tx,
      aggregateType: 'ORDER_FULFILLMENT',
      aggregateId: fulfillment.id,
      fulfillmentId: fulfillment.id,
      wkOrderId: fulfillment.wkOrderId,
      orderV2Id: fulfillment.orderV2Id,
      actorId: input.actor.id,
      actorType: input.actor.type,
      action: 'FULFILLMENT_STATUS_CHANGED',
      previousState: from,
      newState: target,
      reason: input.reason,
      correlationId: input.correlationId,
      metadata: {
        // Explicit: delivery is not payment collection
        paymentStatusUnchanged: true,
      },
    });

    return { fulfillment: updated, idempotent: false };
  }

  private async resolveAndLock(
    tx: Prisma.TransactionClient,
    input: TransitionInput,
  ) {
    if (input.fulfillmentId) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "order_fulfillments" WHERE id = ${input.fulfillmentId}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Fulfillment not found');
      return tx.orderFulfillment.findUniqueOrThrow({
        where: { id: input.fulfillmentId },
      });
    }

    if (input.orderV2Id) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "orders_v2" WHERE id = ${input.orderV2Id}::uuid FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('Order not found');

      let fulfillment = await tx.orderFulfillment.findUnique({
        where: { orderV2Id: input.orderV2Id },
      });
      if (!fulfillment) {
        const order = await tx.order.findUnique({
          where: { id: input.orderV2Id },
        });
        if (!order) throw new NotFoundException('Order not found');
        fulfillment = await tx.orderFulfillment.create({
          data: {
            id: randomUUID(),
            orderV2Id: order.id,
            status: order.status as FulfillmentStatus,
            activeRiderId: order.riderId,
            assignmentVersion: order.assignmentVersion,
            deliveryPin: order.deliveryPin,
            deliveryProofPhoto: order.deliveryProofPhoto,
            customerId: order.customerId,
          },
        });
      } else {
        await tx.$queryRaw`
          SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
        `;
        fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        });
      }
      return fulfillment;
    }

    if (input.wkOrderId != null) {
      const fulfillment = await tx.orderFulfillment.findUnique({
        where: { wkOrderId: input.wkOrderId },
      });
      if (!fulfillment) {
        throw new NotFoundException(
          'No fulfillment linked to this commerce order',
        );
      }
      await tx.$queryRaw`
        SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
      `;
      return tx.orderFulfillment.findUniqueOrThrow({
        where: { id: fulfillment.id },
      });
    }

    throw new BadRequestException(
      'fulfillmentId, orderV2Id, or wkOrderId is required',
    );
  }
}
