import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
      previousStatus === 'delivered'
    ) {
      throw new BadRequestException(
        `Cannot assign rider while fulfillment is ${previousStatus}`,
      );
    }

    if (
      previousStatus !== FulfillmentStatus.ready_for_pickup &&
      previousStatus !== FulfillmentStatus.rider_assigned
    ) {
      throw new BadRequestException(
        `Cannot assign rider from status ${previousStatus}; expected ready_for_pickup or rider_assigned`,
      );
    }

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

    // Idempotent: same active rider already assigned
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

    if (previousRiderId && previousRiderId !== input.riderId) {
      if (!input.allowReassignment) {
        throw new ConflictException(
          'Fulfillment already has an active rider; set allowReassignment to replace',
        );
      }
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

    const updated = await tx.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        activeRiderId: input.riderId,
        assignmentVersion: nextVersion,
        status: FulfillmentStatus.rider_assigned,
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
          status: OrderStatus.rider_assigned,
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
      newState: FulfillmentStatus.rider_assigned,
      reason: input.reason,
      correlationId: input.correlationId,
      metadata: {
        previousRiderId,
        riderId: input.riderId,
        assignmentVersion: nextVersion,
      },
    });

    return { fulfillment: updated, assignment, idempotent: false };
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
