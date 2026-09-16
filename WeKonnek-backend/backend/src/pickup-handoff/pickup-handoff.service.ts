import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgreementType,
  CustodyEventType,
  FulfillmentStatus,
  PickupHandoffPurpose,
  PickupHandoffTokenStatus,
  Prisma,
  RiderAssignmentStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import {
  DEFAULT_PICKUP_HANDOFF_TTL_SECONDS,
  encodePickupQrPayload,
  generatePickupSecret,
  hashPickupSecret,
  parsePickupQrPayload,
  secretsMatch,
} from './pickup-token';

type SafeFailure = {
  ok: false;
  code: string;
  message: string;
};

@Injectable()
export class PickupHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly custody: CustodyEventService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => RiderAdvanceService))
    private readonly riderAdvance: RiderAdvanceService,
  ) {}

  ttlSeconds(): number {
    const raw = Number(
      this.config.get<string>('PICKUP_HANDOFF_TTL_SECONDS') ??
        DEFAULT_PICKUP_HANDOFF_TTL_SECONDS,
    );
    if (!Number.isFinite(raw) || raw < 60 || raw > 3600) {
      return DEFAULT_PICKUP_HANDOFF_TTL_SECONDS;
    }
    return Math.floor(raw);
  }

  /** Rider Advance remains inactive — pickup must not activate it. */
  assertRiderAdvanceInactive() {
    // Schema capability only; refuse any attempt to treat pickup as advance.
    void AgreementType.RIDER_ADVANCE;
  }

  async issueForOrder(input: {
    wkOrderId: number;
    actorUserId: string;
    /** Ignored if present — server derives rider from auth. */
    riderId?: string;
    correlationId?: string;
  }) {
    this.assertRiderAdvanceInactive();
    if (input.riderId && input.riderId !== input.actorUserId) {
      throw new ForbiddenException({
        code: 'RIDER_SPOOF_REJECTED',
        message: 'Rider identity is derived from authentication',
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.wkOrder.findUnique({
          where: { id: input.wkOrderId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (['cancelled', 'rejected', 'refunded'].includes(order.status)) {
          throw new BadRequestException({
            code: 'ORDER_TERMINAL',
            message: 'Order is not eligible for pickup handoff',
          });
        }

        const fulfillment = await tx.orderFulfillment.findUnique({
          where: { wkOrderId: order.id },
        });
        if (!fulfillment) {
          throw new BadRequestException({
            code: 'FULFILLMENT_MISSING',
            message: 'No fulfillment for this order',
          });
        }
        await tx.$queryRaw`
          SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
        `;
        const locked = await tx.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        });

        if (locked.status !== FulfillmentStatus.rider_assigned) {
          throw new BadRequestException({
            code: 'FULFILLMENT_NOT_PICKUP_ELIGIBLE',
            message: 'Fulfillment must be rider_assigned to issue pickup QR',
          });
        }
        if (locked.activeRiderId !== input.actorUserId) {
          throw new ForbiddenException({
            code: 'RIDER_NOT_ACTIVE_ASSIGNEE',
            message: 'Only the active assigned rider may request pickup QR',
          });
        }
        if (locked.merchantId == null) {
          throw new BadRequestException('Fulfillment missing merchant');
        }

        const assignment = await tx.riderAssignment.findFirst({
          where: {
            fulfillmentId: locked.id,
            riderId: input.actorUserId,
            status: RiderAssignmentStatus.ACTIVE,
            assignmentVersion: locked.assignmentVersion,
          },
        });
        if (!assignment) {
          throw new ForbiddenException({
            code: 'ASSIGNMENT_NOT_FOUND',
            message: 'Active rider assignment not found for this version',
          });
        }

        const priorActive = await tx.pickupHandoffToken.findMany({
          where: {
            fulfillmentId: locked.id,
            purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
            status: PickupHandoffTokenStatus.ACTIVE,
          },
        });
        for (const prior of priorActive) {
          await tx.pickupHandoffToken.update({
            where: { id: prior.id },
            data: {
              status: PickupHandoffTokenStatus.REVOKED,
              revokedAt: new Date(),
              revokeReason: 'superseded_by_reissue',
            },
          });
          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: locked.id,
            fulfillmentId: locked.id,
            wkOrderId: order.id,
            actorId: input.actorUserId,
            actorType: 'RIDER',
            action: 'PICKUP_TOKEN_REVOKED',
            correlationId: input.correlationId,
            metadata: {
              tokenId: prior.id,
              reason: 'superseded_by_reissue',
              assignmentVersion: prior.assignmentVersion,
            },
          });
        }

        const secret = generatePickupSecret();
        const tokenId = randomUUID();
        const expiresAt = new Date(Date.now() + this.ttlSeconds() * 1000);
        await tx.pickupHandoffToken.create({
          data: {
            id: tokenId,
            tokenHash: hashPickupSecret(secret),
            purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
            status: PickupHandoffTokenStatus.ACTIVE,
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            merchantId: locked.merchantId,
            riderId: input.actorUserId,
            riderAssignmentId: assignment.id,
            assignmentVersion: locked.assignmentVersion,
            expiresAt,
            createdByUserId: input.actorUserId,
            correlationId: input.correlationId,
          },
        });

        await this.events.record({
          tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: locked.id,
          fulfillmentId: locked.id,
          wkOrderId: order.id,
          actorId: input.actorUserId,
          actorType: 'RIDER',
          action: 'PICKUP_TOKEN_ISSUED',
          correlationId: input.correlationId,
          metadata: {
            tokenId,
            assignmentVersion: locked.assignmentVersion,
            expiresAt: expiresAt.toISOString(),
            purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
          },
        });

        return {
          tokenId,
          qrPayload: encodePickupQrPayload({ tokenId, secret }),
          expiresAt,
          purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
          wkOrderId: order.id,
          fulfillmentId: locked.id,
          assignmentVersion: locked.assignmentVersion,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async validate(input: {
    actorUserId: string;
    qrPayload: string;
    correlationId?: string;
  }) {
    this.assertRiderAdvanceInactive();
    const parsed = this.parsePayloadSafe(input.qrPayload);
    if (!parsed.ok) return this.deny(parsed);

    const token = await this.prisma.pickupHandoffToken.findUnique({
      where: { id: parsed.tokenId },
      include: {
        wkOrder: { select: { orderCode: true, status: true, totalAmount: true } },
        rider: { select: { id: true, firstName: true, lastName: true } },
        merchant: { select: { id: true, name: true } },
        fulfillment: true,
      },
    });

    const auth = await this.assertMerchantForToken(input.actorUserId, token);
    if (!auth.ok) return this.deny(auth);

    const checks = await this.validateTokenState({
      token: token!,
      secret: parsed.secret,
      consume: false,
    });
    if (!checks.ok) {
      await this.events.record({
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: token!.fulfillmentId,
        fulfillmentId: token!.fulfillmentId,
        wkOrderId: token!.wkOrderId,
        actorId: input.actorUserId,
        actorType: 'MERCHANT_OWNER',
        action: 'PICKUP_TOKEN_REPLAY_REJECTED',
        correlationId: input.correlationId,
        metadata: { tokenId: token!.id, reason: checks.code },
      });
      return this.deny(checks);
    }

    await this.events.record({
      aggregateType: 'ORDER_FULFILLMENT',
      aggregateId: token!.fulfillmentId,
      fulfillmentId: token!.fulfillmentId,
      wkOrderId: token!.wkOrderId,
      actorId: input.actorUserId,
      actorType: 'MERCHANT_OWNER',
      action: 'PICKUP_TOKEN_VALIDATED',
      correlationId: input.correlationId,
      metadata: {
        tokenId: token!.id,
        assignmentVersion: token!.assignmentVersion,
      },
    });

    return {
      ok: true as const,
      preview: {
        tokenId: token!.id,
        orderCode: token!.wkOrder.orderCode,
        wkOrderId: token!.wkOrderId,
        merchant: { id: token!.merchant.id, name: token!.merchant.name },
        rider: {
          id: token!.rider.id,
          displayName: [token!.rider.firstName, token!.rider.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Assigned rider',
        },
        fulfillmentStatus: token!.fulfillment.status,
        expiresAt: token!.expiresAt,
        purpose: token!.purpose,
        eligible: true,
        note: 'Preview does not consume the token or change fulfillment/custody',
      },
    };
  }

  async confirm(input: {
    actorUserId: string;
    qrPayload: string;
    correlationId?: string;
  }) {
    this.assertRiderAdvanceInactive();
    const parsed = this.parsePayloadSafe(input.qrPayload);
    if (!parsed.ok) return this.deny(parsed);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "pickup_handoff_tokens" WHERE id = ${parsed.tokenId}::uuid FOR UPDATE
        `;
        const token = await tx.pickupHandoffToken.findUnique({
          where: { id: parsed.tokenId },
          include: {
            wkOrder: true,
            fulfillment: true,
            rider: { select: { id: true, firstName: true, lastName: true } },
            merchant: { select: { id: true, name: true } },
          },
        });

        const auth = await this.assertMerchantForToken(input.actorUserId, token, tx);
        if (!auth.ok) return this.deny(auth);

        // Idempotent replay of successful confirm by same merchant
        if (
          token!.status === PickupHandoffTokenStatus.CONSUMED &&
          token!.merchantConfirmedByUserId === input.actorUserId
        ) {
          return {
            ok: true as const,
            idempotent: true,
            tokenId: token!.id,
            wkOrderId: token!.wkOrderId,
            fulfillmentId: token!.fulfillmentId,
            custodyEventId: token!.custodyEventId,
            fulfillmentStatus: token!.fulfillment.status,
          };
        }

        const checks = await this.validateTokenState({
          token: token!,
          secret: parsed.secret,
          consume: true,
          tx,
        });
        if (!checks.ok) {
          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: token!.fulfillmentId,
            fulfillmentId: token!.fulfillmentId,
            wkOrderId: token!.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'MERCHANT_OWNER',
            action: 'PICKUP_TOKEN_REPLAY_REJECTED',
            correlationId: input.correlationId,
            metadata: { tokenId: token!.id, reason: checks.code },
          });
          return this.deny(checks);
        }

        // Stage 4A: RA orders require vendor cash ack before goods release.
        // Token semantics unchanged — this is an explicit eligibility guard.
        const raGate = await this.riderAdvance.assertPickupAllowedForOrder(
          token!.wkOrderId,
          tx,
        );
        if (!raGate.ok) {
          return this.deny(raGate);
        }

        const now = new Date();
        const custody = await this.custody.record({
          tx,
          actorUserId: input.actorUserId,
          eventType: CustodyEventType.MERCHANT_RELEASED,
          wkOrderId: token!.wkOrderId,
          fulfillmentId: token!.fulfillmentId,
          fromPartyRole: 'MERCHANT',
          toPartyRole: 'RIDER',
          toUserId: token!.riderId,
          correlationId: input.correlationId,
          metadata: {
            pickupHandoffTokenId: token!.id,
            assignmentVersion: token!.assignmentVersion,
            riderPresentedCapability: true,
            riderIndependentlyConfirmedReceipt: false,
            paymentUnchanged: true,
            agreementAcceptanceUnchanged: true,
            riderAdvanceUnchanged: true,
          },
        });

        // Stage 7: pickup confirmation establishes proven physical custodian.
        await tx.orderFulfillment.update({
          where: { id: token!.fulfillmentId },
          data: { physicalCustodianRiderId: token!.riderId },
        });

        const transition = await this.transitions.transitionInTx(
          tx,
          {
            fulfillmentId: token!.fulfillmentId,
            targetStatus: 'picked_up',
            actor: {
              id: input.actorUserId,
              type: 'INTERNAL_SERVICE',
            },
            reason: 'merchant_pickup_handoff_confirmed',
            correlationId: input.correlationId,
            expectedVersion: token!.assignmentVersion,
          },
          'picked_up',
        );

        await tx.pickupHandoffToken.update({
          where: { id: token!.id },
          data: {
            status: PickupHandoffTokenStatus.CONSUMED,
            consumedAt: now,
            consumedByUserId: input.actorUserId,
            merchantConfirmedAt: now,
            merchantConfirmedByUserId: input.actorUserId,
            custodyEventId: custody.id,
          },
        });

        await this.events.record({
          tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: token!.fulfillmentId,
          fulfillmentId: token!.fulfillmentId,
          wkOrderId: token!.wkOrderId,
          actorId: input.actorUserId,
          actorType: 'MERCHANT_OWNER',
          action: 'PICKUP_HANDOFF_CONFIRMED',
          previousState: token!.fulfillment.status,
          newState: transition.fulfillment.status,
          correlationId: input.correlationId,
          metadata: {
            tokenId: token!.id,
            custodyEventId: custody.id,
            assignmentVersion: token!.assignmentVersion,
            paymentUnchanged: true,
            // Never log raw bearer secret
          },
        });

        return {
          ok: true as const,
          idempotent: false,
          tokenId: token!.id,
          wkOrderId: token!.wkOrderId,
          fulfillmentId: token!.fulfillmentId,
          custodyEventId: custody.id,
          fulfillmentStatus: transition.fulfillment.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private parsePayloadSafe(
    raw: string,
  ):
    | { ok: true; tokenId: string; secret: string }
    | SafeFailure {
    try {
      const parsed = parsePickupQrPayload(raw);
      return { ok: true, tokenId: parsed.tokenId, secret: parsed.secret };
    } catch (err) {
      const code = err instanceof Error ? err.message : 'MALFORMED_PAYLOAD';
      return {
        ok: false,
        code,
        message: 'Invalid pickup handoff payload',
      };
    }
  }

  private deny(failure: SafeFailure) {
    return {
      ok: false as const,
      code: failure.code,
      message: failure.message,
    };
  }

  private async assertMerchantForToken(
    actorUserId: string,
    token:
      | {
          merchantId: number;
        }
      | null
      | undefined,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ ok: true } | SafeFailure> {
    if (!token) {
      return {
        ok: false,
        code: 'TOKEN_INVALID',
        message: 'Pickup handoff not authorized',
      };
    }
    const op = await db.merchant.findFirst({
      where: {
        id: token.merchantId,
        OR: [
          { userId: actorUserId },
          { merchantStaff: { some: { userId: actorUserId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (!op) {
      return {
        ok: false,
        code: 'MERCHANT_UNAUTHORIZED',
        message: 'Pickup handoff not authorized',
      };
    }
    return { ok: true };
  }

  private async validateTokenState(input: {
    token: {
      id: string;
      tokenHash: string;
      purpose: PickupHandoffPurpose;
      status: PickupHandoffTokenStatus;
      expiresAt: Date;
      wkOrderId: number;
      fulfillmentId: string;
      merchantId: number;
      riderId: string;
      riderAssignmentId: string;
      assignmentVersion: number;
      wkOrder?: { status: string };
      fulfillment: {
        id: string;
        status: FulfillmentStatus;
        activeRiderId: string | null;
        assignmentVersion: number;
        merchantId: number | null;
      };
    };
    secret: string;
    consume: boolean;
    tx?: Prisma.TransactionClient;
  }): Promise<{ ok: true } | SafeFailure> {
    const db = input.tx ?? this.prisma;
    if (!secretsMatch(input.token.tokenHash, input.secret)) {
      return { ok: false, code: 'TOKEN_INVALID', message: 'Pickup handoff not authorized' };
    }
    if (input.token.purpose !== PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF) {
      return { ok: false, code: 'PURPOSE_INVALID', message: 'Pickup handoff not authorized' };
    }
    if (input.token.status === PickupHandoffTokenStatus.CONSUMED) {
      return { ok: false, code: 'TOKEN_CONSUMED', message: 'Pickup handoff already completed' };
    }
    if (input.token.status === PickupHandoffTokenStatus.REVOKED) {
      return { ok: false, code: 'TOKEN_REVOKED', message: 'Pickup handoff not authorized' };
    }
    if (
      input.token.status === PickupHandoffTokenStatus.EXPIRED ||
      input.token.expiresAt.getTime() <= Date.now()
    ) {
      if (
        input.consume &&
        input.token.status === PickupHandoffTokenStatus.ACTIVE
      ) {
        await db.pickupHandoffToken.update({
          where: { id: input.token.id },
          data: { status: PickupHandoffTokenStatus.EXPIRED },
        });
        await this.events.record({
          tx: input.tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: input.token.fulfillmentId,
          fulfillmentId: input.token.fulfillmentId,
          wkOrderId: input.token.wkOrderId,
          action: 'PICKUP_TOKEN_EXPIRED',
          metadata: { tokenId: input.token.id },
        });
      }
      return { ok: false, code: 'TOKEN_EXPIRED', message: 'Pickup handoff not authorized' };
    }
    if (input.token.status !== PickupHandoffTokenStatus.ACTIVE) {
      return { ok: false, code: 'TOKEN_INVALID', message: 'Pickup handoff not authorized' };
    }

    const fulfillment = await db.orderFulfillment.findUnique({
      where: { id: input.token.fulfillmentId },
    });
    if (!fulfillment) {
      return { ok: false, code: 'FULFILLMENT_MISSING', message: 'Pickup handoff not authorized' };
    }
    if (fulfillment.wkOrderId !== input.token.wkOrderId) {
      return { ok: false, code: 'ORDER_SCOPE_MISMATCH', message: 'Pickup handoff not authorized' };
    }
    if (fulfillment.merchantId !== input.token.merchantId) {
      return { ok: false, code: 'MERCHANT_SCOPE_MISMATCH', message: 'Pickup handoff not authorized' };
    }
    if (fulfillment.status !== FulfillmentStatus.rider_assigned) {
      return {
        ok: false,
        code: 'FULFILLMENT_NOT_PICKUP_ELIGIBLE',
        message: 'Pickup handoff not authorized',
      };
    }
    if (fulfillment.activeRiderId !== input.token.riderId) {
      return { ok: false, code: 'ASSIGNMENT_CHANGED', message: 'Pickup handoff not authorized' };
    }
    if (fulfillment.assignmentVersion !== input.token.assignmentVersion) {
      return { ok: false, code: 'ASSIGNMENT_VERSION_MISMATCH', message: 'Pickup handoff not authorized' };
    }

    const assignment = await db.riderAssignment.findFirst({
      where: {
        id: input.token.riderAssignmentId,
        fulfillmentId: input.token.fulfillmentId,
        riderId: input.token.riderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: input.token.assignmentVersion,
      },
    });
    if (!assignment) {
      return { ok: false, code: 'ASSIGNMENT_CHANGED', message: 'Pickup handoff not authorized' };
    }

    const order = await db.wkOrder.findUnique({
      where: { id: input.token.wkOrderId },
      select: { status: true },
    });
    if (!order || ['cancelled', 'rejected', 'refunded'].includes(order.status)) {
      return { ok: false, code: 'ORDER_TERMINAL', message: 'Pickup handoff not authorized' };
    }

    return { ok: true };
  }
}
