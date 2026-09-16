import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  FulfillmentStatus,
  OrderDomainActorType,
  OrderStatus,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import {
  assertOperationAllowed,
  AuthActor,
} from './fulfillment-authorization';
import { OrderDomainEventService } from './order-domain-event.service';

export interface AssignRiderInput {
  fulfillmentId?: string;
  orderV2Id?: string;
  riderId: string;
  actor: AuthActor;
  reason?: string;
  /** When set, must match current assignmentVersion (optimistic lock). */
  expectedVersion?: number;
  correlationId?: string;
  /** When true, supersede existing ACTIVE assignment. */
  allowReassignment?: boolean;
  actorMerchantIds?: number[];
  merchantOwnerUserId?: string | null;
}

@Injectable()
export class RiderAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    @Inject(forwardRef(() => RiderAdvanceService))
    private readonly riderAdvance: RiderAdvanceService,
  ) {}

  async assign(input: AssignRiderInput) {
    return this.prisma.$transaction(
      async (tx) => this.assignInTx(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async assignInTx(tx: Prisma.TransactionClient, input: AssignRiderInput) {
    const fulfillment = await this.lockFulfillment(tx, input);
    const previousStatus = fulfillment.status;
    const previousRiderId = fulfillment.activeRiderId;
    const currentVersion = fulfillment.assignmentVersion;

    assertOperationAllowed(
      input.actor,
      previousRiderId && previousRiderId !== input.riderId
        ? 'unassign_rider'
        : 'assign_rider',
      {
        customerId: fulfillment.customerId,
        merchantId: fulfillment.merchantId,
        shopId: fulfillment.shopId,
        activeRiderId: fulfillment.activeRiderId,
        status: fulfillment.status,
        actorMerchantIds: input.actorMerchantIds,
        merchantOwnerUserId: input.merchantOwnerUserId,
      },
    );

    if (
      input.expectedVersion != null &&
      input.expectedVersion !== currentVersion
    ) {
      throw new ConflictException(
        `Assignment version conflict: expected ${input.expectedVersion}, current ${currentVersion}`,
      );
    }

    if (
      previousStatus === 'cancelled' ||
      previousStatus === 'delivered' ||
      previousStatus === 'returned'
    ) {
      throw new BadRequestException(
        `Cannot assign rider while fulfillment is ${previousStatus}`,
      );
    }

    const prePickupStatuses: FulfillmentStatus[] = [
      FulfillmentStatus.ready_for_pickup,
      FulfillmentStatus.rider_assigned,
    ];
    const midDeliveryStatuses: FulfillmentStatus[] = [
      FulfillmentStatus.picked_up,
      FulfillmentStatus.in_transit,
      FulfillmentStatus.delivery_failed,
      FulfillmentStatus.returning,
    ];
    const assignable = [...prePickupStatuses, ...midDeliveryStatuses];
    if (!assignable.includes(previousStatus)) {
      throw new BadRequestException(
        `Cannot assign rider from status ${previousStatus}`,
      );
    }
    const isMidDelivery = midDeliveryStatuses.includes(previousStatus);

    const rider = await tx.user.findUnique({
      where: { id: input.riderId },
      select: { id: true, role: true, isActive: true },
    });
    if (!rider || !rider.isActive) {
      throw new NotFoundException('Rider not found');
    }
    if (rider.role !== UserRole.rider && rider.role !== UserRole.driver) {
      throw new BadRequestException('Target user is not a rider');
    }

    // Idempotent: same active rider already assigned (pre-pickup path)
    if (
      previousRiderId === input.riderId &&
      previousStatus === FulfillmentStatus.rider_assigned
    ) {
      const active = await tx.riderAssignment.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          riderId: input.riderId,
          status: RiderAssignmentStatus.ACTIVE,
        },
      });
      return {
        fulfillment,
        assignment: active,
        idempotent: true,
      };
    }
    // Idempotent mid-delivery: same rider already active
    if (previousRiderId === input.riderId && isMidDelivery) {
      const active = await tx.riderAssignment.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          riderId: input.riderId,
          status: RiderAssignmentStatus.ACTIVE,
        },
      });
      return {
        fulfillment,
        assignment: active,
        idempotent: true,
      };
    }

    if (previousRiderId && previousRiderId !== input.riderId) {
      if (!input.allowReassignment) {
        throw new ConflictException(
          'Fulfillment already has an active rider; set allowReassignment to replace',
        );
      }

      // Stage 5A/6: invalidate active delivery/return handoff capabilities
      await this.revokeActiveDeliveryTokensInTx(tx, {
        fulfillmentId: fulfillment.id,
        reason: 'rider_reassigned',
        actorId: input.actor.id,
        correlationId: input.correlationId,
      });
      await this.revokeActiveReturnTokensInTx(tx, {
        fulfillmentId: fulfillment.id,
        reason: 'rider_reassigned',
        actorId: input.actor.id,
        correlationId: input.correlationId,
      });
      await this.revokeActiveRiderCustodyTokensInTx(tx, {
        fulfillmentId: fulfillment.id,
        reason: 'rider_reassignment_superseded',
        actorId: input.actor.id,
        correlationId: input.correlationId,
      });

      // Stage 7: mid-possession reassignment must NOT flip physical custody.
      // Record pending incoming rider; outgoing remains active assignee/custodian
      // until secure rider-to-rider handoff confirmation.
      if (isMidDelivery) {
        const custodian =
          fulfillment.physicalCustodianRiderId ?? previousRiderId;
        const updatedPending = await tx.orderFulfillment.update({
          where: { id: fulfillment.id },
          data: {
            physicalCustodianRiderId: custodian,
            pendingCustodyIncomingRiderId: input.riderId,
            pendingCustodyFromAssignmentVersion: currentVersion,
            pendingCustodyRequestedAt: new Date(),
          },
        });
        await this.events.record({
          tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: fulfillment.id,
          fulfillmentId: fulfillment.id,
          wkOrderId: fulfillment.wkOrderId,
          orderV2Id: fulfillment.orderV2Id,
          actorId: input.actor.id,
          actorType: input.actor.type,
          action: 'RIDER_CUSTODY_TRANSFER_PENDING',
          previousState: previousStatus,
          newState: previousStatus,
          reason: input.reason,
          correlationId: input.correlationId,
          metadata: {
            outgoingRiderId: previousRiderId,
            incomingRiderId: input.riderId,
            assignmentVersion: currentVersion,
            physicalCustodianRiderId: custodian,
            midDeliveryReassignment: true,
            assignmentUnchangedUntilCustodyConfirm: true,
            paymentUnchanged: true,
            riderAdvanceUnchanged: true,
          },
        });
        const active = await tx.riderAssignment.findFirst({
          where: {
            fulfillmentId: fulfillment.id,
            riderId: previousRiderId,
            status: RiderAssignmentStatus.ACTIVE,
          },
        });
        return {
          fulfillment: updatedPending,
          assignment: active,
          idempotent: false,
          pendingCustodyTransfer: true as const,
          outgoingRiderId: previousRiderId,
          incomingRiderId: input.riderId,
        };
      }

      // Pre-pickup: Stage 3 defense-in-depth — revoke ACTIVE pickup tokens
      // (assignment/version checks already invalidate, but revoke is explicit).
      await this.revokeActivePickupTokensInTx(tx, {
        fulfillmentId: fulfillment.id,
        reason: 'rider_reassigned',
        actorId: input.actor.id,
        correlationId: input.correlationId,
      });

      await tx.riderAssignment.updateMany({
        where: {
          fulfillmentId: fulfillment.id,
          status: RiderAssignmentStatus.ACTIVE,
        },
        data: {
          status: RiderAssignmentStatus.SUPERSEDED,
          unassignedAt: new Date(),
          reason: input.reason ?? 'reassigned',
        },
      });
      // Stage 4A / 5A: old Rider Advance must not transfer to new rider.
      await this.riderAdvance.invalidateOnReassignmentInTx(tx, {
        fulfillmentId: fulfillment.id,
        previousRiderId,
        newRiderId: input.riderId,
        actorId: input.actor.id,
        correlationId: input.correlationId,
      });
    }

    const nextVersion = currentVersion + 1;
    const assignment = await tx.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        orderV2Id: fulfillment.orderV2Id ?? undefined,
        riderId: input.riderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: nextVersion,
        assignedBy: input.actor.id ?? undefined,
        assignedByType: input.actor.type,
        reason: input.reason ?? undefined,
      },
    });

    const nextStatus = isMidDelivery
      ? previousStatus
      : FulfillmentStatus.rider_assigned;

    const updated = await tx.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        activeRiderId: input.riderId,
        assignmentVersion: nextVersion,
        status: nextStatus,
        // Pre-pickup / first assign: no rider-to-rider custody pending.
        pendingCustodyIncomingRiderId: null,
        pendingCustodyFromAssignmentVersion: null,
        pendingCustodyRequestedAt: null,
      },
    });

    if (fulfillment.orderV2Id) {
      const v2 = await tx.order.findUnique({
        where: { id: fulfillment.orderV2Id },
        select: { assignmentVersion: true },
      });
      if (
        input.expectedVersion != null &&
        v2 &&
        v2.assignmentVersion !== input.expectedVersion &&
        v2.assignmentVersion !== currentVersion
      ) {
        throw new ConflictException('orders_v2 assignment version conflict');
      }
      await tx.order.update({
        where: { id: fulfillment.orderV2Id },
        data: {
          riderId: input.riderId,
          status: nextStatus as OrderStatus,
          assignmentVersion: nextVersion,
        },
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
      action:
        previousRiderId && previousRiderId !== input.riderId
          ? 'RIDER_REASSIGNED'
          : 'RIDER_ASSIGNED',
      previousState: previousStatus,
      newState: nextStatus,
      reason: input.reason,
      correlationId: input.correlationId,
      metadata: {
        previousRiderId,
        riderId: input.riderId,
        assignmentVersion: nextVersion,
        midDeliveryReassignment: isMidDelivery,
      },
    });

    return { fulfillment: updated, assignment, idempotent: false };
  }

  /** Stage 5A: revoke ACTIVE customer delivery handoff tokens (table may be absent on older DBs). */
  private async revokeActiveDeliveryTokensInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      reason: string;
      actorId?: string | null;
      correlationId?: string;
    },
  ) {
    // Avoid aborting the ambient transaction when Stage 5A table is absent
    // (Stage 0–4 dedicated DBs). to_regclass is safe (returns null).
    const reg = await tx.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.customer_delivery_handoff_tokens')::text AS reg
    `;
    if (!reg[0]?.reg) return;

    const prior = await tx.customerDeliveryHandoffToken.findMany({
      where: {
        fulfillmentId: input.fulfillmentId,
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    for (const token of prior) {
      await tx.customerDeliveryHandoffToken.update({
        where: { id: token.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokeReason: input.reason,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: input.fulfillmentId,
        fulfillmentId: input.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorId,
        actorType: 'SYSTEM',
        action: 'DELIVERY_TOKEN_REVOKED',
        correlationId: input.correlationId,
        metadata: {
          tokenId: token.id,
          reason: input.reason,
          assignmentVersion: token.assignmentVersion,
        },
      });
    }
  }

  /** Stage 6: revoke ACTIVE merchant return handoff tokens (absent on older DBs). */
  private async revokeActiveReturnTokensInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      reason: string;
      actorId?: string | null;
      correlationId?: string;
    },
  ) {
    const reg = await tx.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.merchant_return_handoff_tokens')::text AS reg
    `;
    if (!reg[0]?.reg) return;

    const prior = await tx.merchantReturnHandoffToken.findMany({
      where: {
        fulfillmentId: input.fulfillmentId,
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    for (const token of prior) {
      await tx.merchantReturnHandoffToken.update({
        where: { id: token.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokeReason: input.reason,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: input.fulfillmentId,
        fulfillmentId: input.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorId,
        actorType: 'SYSTEM',
        action: 'RETURN_HANDOFF_REVOKED',
        correlationId: input.correlationId,
        metadata: {
          tokenId: token.id,
          reason: input.reason,
          assignmentVersion: token.assignmentVersion,
        },
      });
    }
  }

  /** Stage 3 defense-in-depth: revoke ACTIVE pickup tokens on pre-pickup reassignment. */
  private async revokeActivePickupTokensInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      reason: string;
      actorId?: string | null;
      correlationId?: string;
    },
  ) {
    const reg = await tx.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.pickup_handoff_tokens')::text AS reg
    `;
    if (!reg[0]?.reg) return;

    const prior = await tx.pickupHandoffToken.findMany({
      where: {
        fulfillmentId: input.fulfillmentId,
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    for (const token of prior) {
      await tx.pickupHandoffToken.update({
        where: { id: token.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokeReason: input.reason,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: input.fulfillmentId,
        fulfillmentId: input.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorId,
        actorType: 'SYSTEM',
        action: 'PICKUP_TOKEN_REVOKED',
        correlationId: input.correlationId,
        metadata: {
          tokenId: token.id,
          reason: input.reason,
          assignmentVersion: token.assignmentVersion,
        },
      });
    }
  }

  /** Stage 7: revoke ACTIVE rider-to-rider custody handoff tokens. */
  private async revokeActiveRiderCustodyTokensInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      reason: string;
      actorId?: string | null;
      correlationId?: string;
    },
  ) {
    const reg = await tx.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.rider_custody_handoff_tokens')::text AS reg
    `;
    if (!reg[0]?.reg) return;

    const prior = await tx.riderCustodyHandoffToken.findMany({
      where: {
        fulfillmentId: input.fulfillmentId,
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    for (const token of prior) {
      await tx.riderCustodyHandoffToken.update({
        where: { id: token.id },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokeReason: input.reason,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: input.fulfillmentId,
        fulfillmentId: input.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorId,
        actorType: 'SYSTEM',
        action: 'RIDER_CUSTODY_HANDOFF_REVOKED',
        correlationId: input.correlationId,
        metadata: {
          tokenId: token.id,
          reason: input.reason,
          sourceAssignmentVersion: token.sourceAssignmentVersion,
        },
      });
    }
  }

  /**
   * Stage 7: after incoming rider confirms physical receipt, activate assignment
   * for the incoming rider and clear pending custody transfer intent.
   */
  async finalizeMidPossessionTransferInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      outgoingRiderId: string;
      incomingRiderId: string;
      actor: AuthActor;
      reason?: string;
      correlationId?: string;
      expectedSourceAssignmentVersion: number;
    },
  ) {
    await tx.$queryRaw`
      SELECT id FROM "order_fulfillments" WHERE id = ${input.fulfillmentId}::uuid FOR UPDATE
    `;
    const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
      where: { id: input.fulfillmentId },
    });
    if (fulfillment.activeRiderId !== input.outgoingRiderId) {
      throw new ConflictException({
        code: 'OUTGOING_RIDER_STALE',
        message: 'Outgoing rider is no longer the active assignee',
      });
    }
    if (
      fulfillment.pendingCustodyIncomingRiderId !== input.incomingRiderId ||
      fulfillment.pendingCustodyFromAssignmentVersion !==
        input.expectedSourceAssignmentVersion
    ) {
      throw new ConflictException({
        code: 'PENDING_CUSTODY_TRANSFER_STALE',
        message: 'Pending custody transfer no longer matches this handoff',
      });
    }
    if (
      fulfillment.physicalCustodianRiderId != null &&
      fulfillment.physicalCustodianRiderId !== input.outgoingRiderId
    ) {
      throw new ConflictException({
        code: 'PHYSICAL_CUSTODIAN_MISMATCH',
        message: 'Outgoing rider is not the proven physical custodian',
      });
    }

    // Stage 4A/5A RA side-effects on delivery reassignment (creditor preserved when established).
    await this.riderAdvance.invalidateOnReassignmentInTx(tx, {
      fulfillmentId: fulfillment.id,
      previousRiderId: input.outgoingRiderId,
      newRiderId: input.incomingRiderId,
      actorId: input.actor.id,
      correlationId: input.correlationId,
    });

    await tx.riderAssignment.updateMany({
      where: {
        fulfillmentId: fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
      data: {
        status: RiderAssignmentStatus.SUPERSEDED,
        unassignedAt: new Date(),
        reason: input.reason ?? 'rider_custody_handoff_confirmed',
      },
    });

    const nextVersion = fulfillment.assignmentVersion + 1;
    const assignment = await tx.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        orderV2Id: fulfillment.orderV2Id ?? undefined,
        riderId: input.incomingRiderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: nextVersion,
        assignedBy: input.actor.id ?? undefined,
        assignedByType: input.actor.type,
        reason: input.reason ?? 'rider_custody_handoff_confirmed',
      },
    });

    const updated = await tx.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        activeRiderId: input.incomingRiderId,
        assignmentVersion: nextVersion,
        physicalCustodianRiderId: input.incomingRiderId,
        pendingCustodyIncomingRiderId: null,
        pendingCustodyFromAssignmentVersion: null,
        pendingCustodyRequestedAt: null,
      },
    });

    if (fulfillment.orderV2Id) {
      await tx.order.update({
        where: { id: fulfillment.orderV2Id },
        data: {
          riderId: input.incomingRiderId,
          assignmentVersion: nextVersion,
        },
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
      action: 'RIDER_REASSIGNED',
      previousState: fulfillment.status,
      newState: fulfillment.status,
      reason: input.reason ?? 'rider_custody_handoff_confirmed',
      correlationId: input.correlationId,
      metadata: {
        previousRiderId: input.outgoingRiderId,
        riderId: input.incomingRiderId,
        assignmentVersion: nextVersion,
        midDeliveryReassignment: true,
        custodyConfirmed: true,
        paymentUnchanged: true,
        riderAdvanceCreditorUnchanged: true,
      },
    });

    return { fulfillment: updated, assignment, assignmentVersion: nextVersion };
  }

  private async lockFulfillment(
    tx: Prisma.TransactionClient,
    input: AssignRiderInput,
  ) {
    if (input.fulfillmentId) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "order_fulfillments" WHERE id = ${input.fulfillmentId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException('Fulfillment not found');
      const fulfillment = await tx.orderFulfillment.findUnique({
        where: { id: input.fulfillmentId },
      });
      if (!fulfillment) throw new NotFoundException('Fulfillment not found');
      return fulfillment;
    }

    if (input.orderV2Id) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "orders_v2" WHERE id = ${input.orderV2Id}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException('Order not found');

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

    throw new BadRequestException('fulfillmentId or orderV2Id is required');
  }
}
