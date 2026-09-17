import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustodyEventType,
  CustomerDeliveryHandoffPurpose,
  CustomerDeliveryHandoffTokenStatus,
  FulfillmentStatus,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertPossessionDependentRiderAuthority } from '../rider-custody-handoff/possession-authority';
import {
  DEFAULT_DELIVERY_HANDOFF_TTL_SECONDS,
  DELIVERY_OTP_MAX_ATTEMPTS,
  encodeDeliveryQrPayload,
  generateDeliveryOtp,
  generateDeliverySecret,
  hashDeliveryOtp,
  hashDeliverySecret,
  otpsMatch,
  parseDeliveryQrPayload,
  secretsMatch,
} from './delivery-token';

type SafeFailure = {
  ok: false;
  code: string;
  message: string;
};

type TokenRow = {
  id: string;
  tokenHash: string;
  otpHash: string;
  purpose: CustomerDeliveryHandoffPurpose;
  status: CustomerDeliveryHandoffTokenStatus;
  expiresAt: Date;
  wkOrderId: number;
  fulfillmentId: string;
  customerId: string;
  deliveryRiderId: string;
  riderAssignmentId: string;
  assignmentVersion: number;
  otpFailedAttempts: number;
  otpLockedUntil: Date | null;
  customerConfirmedByUserId: string | null;
  custodyEventId: string | null;
  confirmIdempotencyKey: string | null;
};

@Injectable()
export class DeliveryHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly custody: CustodyEventService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly config: ConfigService,
  ) {}

  ttlSeconds(): number {
    const raw = Number(
      this.config.get<string>('DELIVERY_HANDOFF_TTL_SECONDS') ??
        DEFAULT_DELIVERY_HANDOFF_TTL_SECONDS,
    );
    if (!Number.isFinite(raw) || raw < 60 || raw > 3600) {
      return DEFAULT_DELIVERY_HANDOFF_TTL_SECONDS;
    }
    return Math.floor(raw);
  }

  async issueForOrder(input: {
    wkOrderId: number;
    actorUserId: string;
    /** Ignored — JWT-derived only. */
    riderId?: string;
    /** Ignored — server-derived from order. */
    customerId?: string;
    correlationId?: string;
  }) {
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
          throw new ForbiddenException({
            code: 'ORDER_TERMINAL',
            message: 'Order is not eligible for delivery handoff',
          });
        }

        const fulfillment = await tx.orderFulfillment.findUnique({
          where: { wkOrderId: order.id },
        });
        if (!fulfillment) {
          throw new ForbiddenException({
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

        if (locked.status !== FulfillmentStatus.in_transit) {
          throw new ForbiddenException({
            code: 'FULFILLMENT_NOT_DELIVERY_ELIGIBLE',
            message: 'Fulfillment must be in_transit to issue delivery capability',
          });
        }
        if (locked.activeRiderId !== input.actorUserId) {
          throw new ForbiddenException({
            code: 'RIDER_NOT_ACTIVE_ASSIGNEE',
            message: 'Only the active delivery rider may request delivery capability',
          });
        }
        assertPossessionDependentRiderAuthority({
          actorUserId: input.actorUserId,
          status: locked.status,
          activeRiderId: locked.activeRiderId,
          physicalCustodianRiderId: locked.physicalCustodianRiderId,
          pendingCustodyIncomingRiderId: locked.pendingCustodyIncomingRiderId,
          action: 'delivery_capability',
        });
        if (!locked.customerId || locked.customerId !== order.userId) {
          throw new ForbiddenException({
            code: 'CUSTOMER_SCOPE_MISMATCH',
            message: 'Fulfillment customer does not match order',
          });
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

        const priorActive = await tx.customerDeliveryHandoffToken.findMany({
          where: {
            fulfillmentId: locked.id,
            purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
            status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
          },
        });
        for (const prior of priorActive) {
          await tx.customerDeliveryHandoffToken.update({
            where: { id: prior.id },
            data: {
              status: CustomerDeliveryHandoffTokenStatus.REVOKED,
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
            action: 'DELIVERY_TOKEN_REVOKED',
            correlationId: input.correlationId,
            metadata: {
              tokenId: prior.id,
              reason: 'superseded_by_reissue',
              assignmentVersion: prior.assignmentVersion,
            },
          });
        }

        const secret = generateDeliverySecret();
        const otp = generateDeliveryOtp();
        const tokenId = randomUUID();
        const expiresAt = new Date(Date.now() + this.ttlSeconds() * 1000);
        await tx.customerDeliveryHandoffToken.create({
          data: {
            id: tokenId,
            tokenHash: hashDeliverySecret(secret),
            otpHash: hashDeliveryOtp(otp),
            purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
            status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            customerId: order.userId,
            deliveryRiderId: input.actorUserId,
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
          action: 'DELIVERY_TOKEN_ISSUED',
          correlationId: input.correlationId,
          metadata: {
            tokenId,
            assignmentVersion: locked.assignmentVersion,
            expiresAt: expiresAt.toISOString(),
            purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
            // Never log raw secret / OTP
          },
        });

        return {
          tokenId,
          qrPayload: encodeDeliveryQrPayload({ tokenId, secret }),
          otp,
          expiresAt,
          purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
          wkOrderId: order.id,
          fulfillmentId: locked.id,
          assignmentVersion: locked.assignmentVersion,
          note: 'Legacy deliveryPin is not used on the secured delivery path',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async validate(input: {
    actorUserId: string;
    qrPayload?: string;
    otp?: string;
    orderId?: number;
    correlationId?: string;
  }) {
    const resolved = await this.resolveCapability(input, false);
    if (!resolved.ok) return this.deny(resolved);

    const { token } = resolved;
    if (token.customerId !== input.actorUserId) {
      return this.deny({
        ok: false,
        code: 'CUSTOMER_UNAUTHORIZED',
        message: 'Delivery handoff not authorized',
      });
    }

    if (resolved.mode === 'otp') {
      if (
        token.otpLockedUntil &&
        token.otpLockedUntil.getTime() > Date.now()
      ) {
        return this.deny({
          ok: false,
          code: 'OTP_LOCKED',
          message: 'Delivery handoff not authorized',
        });
      }
      if (!otpsMatch(token.otpHash, resolved.otp)) {
        const attempts = token.otpFailedAttempts + 1;
        await this.prisma.customerDeliveryHandoffToken.update({
          where: { id: token.id },
          data: {
            otpFailedAttempts: attempts,
            otpLockedUntil:
              attempts >= DELIVERY_OTP_MAX_ATTEMPTS
                ? token.expiresAt
                : token.otpLockedUntil,
          },
        });
        return this.deny({
          ok: false,
          code:
            attempts >= DELIVERY_OTP_MAX_ATTEMPTS
              ? 'OTP_LOCKED'
              : 'TOKEN_INVALID',
          message: 'Delivery handoff not authorized',
        });
      }
    }

    const checks = await this.validateTokenState({
      token,
      consume: false,
    });
    if (!checks.ok) {
      await this.events.record({
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: token.fulfillmentId,
        fulfillmentId: token.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorUserId,
        actorType: 'CUSTOMER',
        action: 'DELIVERY_TOKEN_REPLAY_REJECTED',
        correlationId: input.correlationId,
        metadata: { tokenId: token.id, reason: checks.code },
      });
      return this.deny(checks);
    }

    const fulfillment = await this.prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: token.fulfillmentId },
    });
    const order = await this.prisma.wkOrder.findUniqueOrThrow({
      where: { id: token.wkOrderId },
      select: { orderCode: true },
    });

    await this.events.record({
      aggregateType: 'ORDER_FULFILLMENT',
      aggregateId: token.fulfillmentId,
      fulfillmentId: token.fulfillmentId,
      wkOrderId: token.wkOrderId,
      actorId: input.actorUserId,
      actorType: 'CUSTOMER',
      action: 'DELIVERY_TOKEN_VALIDATED',
      correlationId: input.correlationId,
      metadata: {
        tokenId: token.id,
        assignmentVersion: token.assignmentVersion,
      },
    });

    return {
      ok: true as const,
      preview: {
        tokenId: token.id,
        orderCode: order.orderCode,
        wkOrderId: token.wkOrderId,
        fulfillmentStatus: fulfillment.status,
        expiresAt: token.expiresAt,
        purpose: token.purpose,
        eligible: true,
        note: 'Preview does not consume the token or change fulfillment/custody',
      },
    };
  }

  async confirm(input: {
    actorUserId: string;
    qrPayload?: string;
    otp?: string;
    orderId?: number;
    correlationId?: string;
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.customerDeliveryHandoffToken.findUnique({
        where: { confirmIdempotencyKey: input.idempotencyKey },
        include: { fulfillment: true },
      });
      if (prior) {
        if (prior.customerConfirmedByUserId !== input.actorUserId) {
          throw new ConflictException('Idempotency key payload conflict');
        }
        return {
          ok: true as const,
          idempotent: true,
          tokenId: prior.id,
          wkOrderId: prior.wkOrderId,
          fulfillmentId: prior.fulfillmentId,
          custodyEventId: prior.custodyEventId,
          fulfillmentStatus: prior.fulfillment.status,
        };
      }
    }

    const resolved = await this.resolveCapability(input, true);
    if (!resolved.ok) return this.deny(resolved);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "customer_delivery_handoff_tokens" WHERE id = ${resolved.token.id}::uuid FOR UPDATE
        `;
        const token = await tx.customerDeliveryHandoffToken.findUniqueOrThrow({
          where: { id: resolved.token.id },
          include: { fulfillment: true },
        });

        if (token.customerId !== input.actorUserId) {
          return this.deny({
            ok: false,
            code: 'CUSTOMER_UNAUTHORIZED',
            message: 'Delivery handoff not authorized',
          });
        }

        if (
          token.status === CustomerDeliveryHandoffTokenStatus.CONSUMED &&
          token.customerConfirmedByUserId === input.actorUserId
        ) {
          return {
            ok: true as const,
            idempotent: true,
            tokenId: token.id,
            wkOrderId: token.wkOrderId,
            fulfillmentId: token.fulfillmentId,
            custodyEventId: token.custodyEventId,
            fulfillmentStatus: token.fulfillment.status,
          };
        }

        // Re-validate secret/otp under lock
        if (resolved.mode === 'qr') {
          if (!secretsMatch(token.tokenHash, resolved.secret)) {
            return this.deny({
              ok: false,
              code: 'TOKEN_INVALID',
              message: 'Delivery handoff not authorized',
            });
          }
        } else {
          const otpGate = await this.assertOtpUnderLock(tx, token, resolved.otp);
          if (!otpGate.ok) return this.deny(otpGate);
        }

        const checks = await this.validateTokenState({
          token,
          consume: true,
          tx,
        });
        if (!checks.ok) {
          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: token.fulfillmentId,
            fulfillmentId: token.fulfillmentId,
            wkOrderId: token.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'CUSTOMER',
            action: 'DELIVERY_TOKEN_REPLAY_REJECTED',
            correlationId: input.correlationId,
            metadata: { tokenId: token.id, reason: checks.code },
          });
          return this.deny(checks);
        }

        const now = new Date();
        const custody = await this.custody.record({
          tx,
          actorUserId: input.actorUserId,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
          wkOrderId: token.wkOrderId,
          fulfillmentId: token.fulfillmentId,
          fromPartyRole: 'RIDER',
          toPartyRole: 'CUSTOMER',
          fromUserId: token.deliveryRiderId,
          toUserId: token.customerId,
          correlationId: input.correlationId,
          metadata: {
            customerDeliveryHandoffTokenId: token.id,
            assignmentVersion: token.assignmentVersion,
            customerAuthenticatedConfirmation: true,
            paymentUnchanged: true,
            agreementAcceptanceUnchanged: true,
            riderAdvanceUnchanged: true,
            reimbursementNotSettled: true,
          },
        });

        const transition = await this.transitions.transitionInTx(
          tx,
          {
            fulfillmentId: token.fulfillmentId,
            targetStatus: 'delivered',
            actor: {
              id: input.actorUserId,
              type: 'INTERNAL_SERVICE',
            },
            reason: 'customer_delivery_handoff_confirmed',
            correlationId: input.correlationId,
            expectedVersion: token.assignmentVersion,
          },
          'delivered',
        );

        await tx.customerDeliveryHandoffToken.update({
          where: { id: token.id },
          data: {
            status: CustomerDeliveryHandoffTokenStatus.CONSUMED,
            consumedAt: now,
            consumedByUserId: input.actorUserId,
            customerConfirmedAt: now,
            customerConfirmedByUserId: input.actorUserId,
            custodyEventId: custody.id,
            confirmIdempotencyKey: input.idempotencyKey,
          },
        });

        // Stage 10: SUCCESSFUL_HANDOFF DeliveryAttempt only for ACTIVATED redelivery legs.
        const activatedRedelivery = await tx.redeliveryAuthorization.findFirst({
          where: {
            fulfillmentId: token.fulfillmentId,
            status: 'ACTIVATED',
          },
          orderBy: { activatedAt: 'desc' },
        });
        if (activatedRedelivery) {
          const existingSuccess = await tx.deliveryAttempt.findFirst({
            where: {
              fulfillmentId: token.fulfillmentId,
              attemptNumber: activatedRedelivery.targetAttemptNumber,
              outcome: 'SUCCESSFUL_HANDOFF',
            },
          });
          if (!existingSuccess) {
            const assignment = await tx.riderAssignment.findFirst({
              where: {
                fulfillmentId: token.fulfillmentId,
                riderId: token.deliveryRiderId,
                status: 'ACTIVE',
                assignmentVersion: token.assignmentVersion,
              },
            });
            if (assignment) {
              const custodian =
                token.fulfillment.physicalCustodianRiderId ??
                token.deliveryRiderId;
              await tx.deliveryAttempt.create({
                data: {
                  id: randomUUID(),
                  wkOrderId: token.wkOrderId,
                  fulfillmentId: token.fulfillmentId,
                  attemptNumber: activatedRedelivery.targetAttemptNumber,
                  riderId: token.deliveryRiderId,
                  riderAssignmentId: assignment.id,
                  assignmentVersion: token.assignmentVersion,
                  physicalCustodianRiderId: custodian,
                  outcome: 'SUCCESSFUL_HANDOFF',
                  occurredAt: now,
                  reportedAt: now,
                  reportedByActorType: 'CUSTOMER',
                  reportedByActorId: input.actorUserId,
                  notes: 'stage10_redelivery_successful_handoff',
                  correlationId: input.correlationId,
                  requestPayloadHash: `stage10:${activatedRedelivery.id}`,
                },
              });
            }
          }
        }

        await this.events.record({
          tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: token.fulfillmentId,
          fulfillmentId: token.fulfillmentId,
          wkOrderId: token.wkOrderId,
          actorId: input.actorUserId,
          actorType: 'CUSTOMER',
          action: 'CUSTOMER_DELIVERY_HANDOFF_CONFIRMED',
          previousState: token.fulfillment.status,
          newState: transition.fulfillment.status,
          correlationId: input.correlationId,
          metadata: {
            tokenId: token.id,
            custodyEventId: custody.id,
            assignmentVersion: token.assignmentVersion,
            paymentUnchanged: true,
            riderAdvanceUnchanged: true,
            reimbursementNotSettled: true,
            stage10SuccessfulHandoff: Boolean(activatedRedelivery),
            redeliveryAuthorizationId: activatedRedelivery?.id ?? null,
          },
        });

        return {
          ok: true as const,
          idempotent: false,
          tokenId: token.id,
          wkOrderId: token.wkOrderId,
          fulfillmentId: token.fulfillmentId,
          custodyEventId: custody.id,
          fulfillmentStatus: transition.fulfillment.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async revoke(input: {
    tokenId: string;
    actorUserId: string;
    reason?: string;
    correlationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "customer_delivery_handoff_tokens" WHERE id = ${input.tokenId}::uuid FOR UPDATE
      `;
      const token = await tx.customerDeliveryHandoffToken.findUnique({
        where: { id: input.tokenId },
      });
      if (!token) throw new NotFoundException('Delivery handoff not found');

      const actor = await tx.user.findUnique({
        where: { id: input.actorUserId },
        select: { role: true },
      });
      const isAdmin =
        actor?.role === UserRole.admin || actor?.role === UserRole.staff;
      const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
        where: { id: token.fulfillmentId },
      });
      const isActiveRider =
        fulfillment.activeRiderId === input.actorUserId &&
        token.deliveryRiderId === input.actorUserId;
      if (!isAdmin && !isActiveRider) {
        throw new ForbiddenException('Not authorized to revoke delivery handoff');
      }
      if (token.status !== CustomerDeliveryHandoffTokenStatus.ACTIVE) {
        return { ok: true as const, idempotent: true, tokenId: token.id };
      }
      await tx.customerDeliveryHandoffToken.update({
        where: { id: token.id },
        data: {
          status: CustomerDeliveryHandoffTokenStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: input.reason ?? 'revoked',
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: token.fulfillmentId,
        fulfillmentId: token.fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: input.actorUserId,
        actorType: isAdmin ? 'SYSTEM_ADMIN' : 'RIDER',
        action: 'DELIVERY_TOKEN_REVOKED',
        correlationId: input.correlationId,
        metadata: { tokenId: token.id, reason: input.reason ?? 'revoked' },
      });
      return { ok: true as const, idempotent: false, tokenId: token.id };
    });
  }

  private async resolveCapability(
    input: {
      qrPayload?: string;
      otp?: string;
      orderId?: number;
    },
    _forConfirm: boolean,
  ): Promise<
    | { ok: true; mode: 'qr'; token: TokenRow; secret: string }
    | { ok: true; mode: 'otp'; token: TokenRow; otp: string }
    | SafeFailure
  > {
    if (input.qrPayload) {
      try {
        const parsed = parseDeliveryQrPayload(input.qrPayload);
        const token = await this.prisma.customerDeliveryHandoffToken.findUnique({
          where: { id: parsed.tokenId },
        });
        if (!token) {
          return {
            ok: false,
            code: 'TOKEN_INVALID',
            message: 'Delivery handoff not authorized',
          };
        }
        if (!secretsMatch(token.tokenHash, parsed.secret)) {
          return {
            ok: false,
            code: 'TOKEN_INVALID',
            message: 'Delivery handoff not authorized',
          };
        }
        return { ok: true, mode: 'qr', token, secret: parsed.secret };
      } catch (err) {
        const code = err instanceof Error ? err.message : 'MALFORMED_PAYLOAD';
        return {
          ok: false,
          code,
          message: 'Invalid delivery handoff payload',
        };
      }
    }

    if (input.otp) {
      if (input.orderId == null) {
        return {
          ok: false,
          code: 'ORDER_ID_REQUIRED',
          message: 'orderId is required for OTP delivery confirmation',
        };
      }
      // Resolve ACTIVE token by order (not by otp hash) so failed attempts throttle.
      const token = await this.prisma.customerDeliveryHandoffToken.findFirst({
        where: {
          wkOrderId: input.orderId,
          purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
          status: {
            in: [
              CustomerDeliveryHandoffTokenStatus.ACTIVE,
              CustomerDeliveryHandoffTokenStatus.CONSUMED,
              CustomerDeliveryHandoffTokenStatus.REVOKED,
              CustomerDeliveryHandoffTokenStatus.EXPIRED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!token) {
        return {
          ok: false,
          code: 'TOKEN_INVALID',
          message: 'Delivery handoff not authorized',
        };
      }
      return { ok: true, mode: 'otp', token, otp: input.otp };
    }

    return {
      ok: false,
      code: 'CAPABILITY_REQUIRED',
      message: 'qrPayload or otp is required',
    };
  }

  private async assertOtpUnderLock(
    tx: Prisma.TransactionClient,
    token: TokenRow,
    otp: string,
  ): Promise<{ ok: true } | SafeFailure> {
    if (token.otpLockedUntil && token.otpLockedUntil.getTime() > Date.now()) {
      return {
        ok: false,
        code: 'OTP_LOCKED',
        message: 'Delivery handoff not authorized',
      };
    }
    if (!otpsMatch(token.otpHash, otp)) {
      const attempts = token.otpFailedAttempts + 1;
      const locked =
        attempts >= DELIVERY_OTP_MAX_ATTEMPTS
          ? token.expiresAt
          : token.otpLockedUntil;
      await tx.customerDeliveryHandoffToken.update({
        where: { id: token.id },
        data: {
          otpFailedAttempts: attempts,
          otpLockedUntil: locked,
        },
      });
      return {
        ok: false,
        code:
          attempts >= DELIVERY_OTP_MAX_ATTEMPTS
            ? 'OTP_LOCKED'
            : 'TOKEN_INVALID',
        message: 'Delivery handoff not authorized',
      };
    }
    return { ok: true };
  }

  private deny(failure: SafeFailure) {
    return {
      ok: false as const,
      code: failure.code,
      message: failure.message,
    };
  }

  private async validateTokenState(input: {
    token: TokenRow;
    consume: boolean;
    tx?: Prisma.TransactionClient;
  }): Promise<{ ok: true } | SafeFailure> {
    const db = input.tx ?? this.prisma;
    if (
      input.token.purpose !==
      CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF
    ) {
      return {
        ok: false,
        code: 'PURPOSE_INVALID',
        message: 'Delivery handoff not authorized',
      };
    }
    if (input.token.status === CustomerDeliveryHandoffTokenStatus.CONSUMED) {
      return {
        ok: false,
        code: 'TOKEN_CONSUMED',
        message: 'Delivery handoff already completed',
      };
    }
    if (input.token.status === CustomerDeliveryHandoffTokenStatus.REVOKED) {
      return {
        ok: false,
        code: 'TOKEN_REVOKED',
        message: 'Delivery handoff not authorized',
      };
    }
    if (
      input.token.status === CustomerDeliveryHandoffTokenStatus.EXPIRED ||
      input.token.expiresAt.getTime() <= Date.now()
    ) {
      if (
        input.consume &&
        input.token.status === CustomerDeliveryHandoffTokenStatus.ACTIVE
      ) {
        await db.customerDeliveryHandoffToken.update({
          where: { id: input.token.id },
          data: { status: CustomerDeliveryHandoffTokenStatus.EXPIRED },
        });
        await this.events.record({
          tx: input.tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: input.token.fulfillmentId,
          fulfillmentId: input.token.fulfillmentId,
          wkOrderId: input.token.wkOrderId,
          action: 'DELIVERY_TOKEN_EXPIRED',
          metadata: { tokenId: input.token.id },
        });
      }
      return {
        ok: false,
        code: 'TOKEN_EXPIRED',
        message: 'Delivery handoff not authorized',
      };
    }
    if (input.token.status !== CustomerDeliveryHandoffTokenStatus.ACTIVE) {
      return {
        ok: false,
        code: 'TOKEN_INVALID',
        message: 'Delivery handoff not authorized',
      };
    }
    if (
      input.token.otpLockedUntil &&
      input.token.otpLockedUntil.getTime() > Date.now()
    ) {
      return {
        ok: false,
        code: 'OTP_LOCKED',
        message: 'Delivery handoff not authorized',
      };
    }

    const fulfillment = await db.orderFulfillment.findUnique({
      where: { id: input.token.fulfillmentId },
    });
    if (!fulfillment) {
      return {
        ok: false,
        code: 'FULFILLMENT_MISSING',
        message: 'Delivery handoff not authorized',
      };
    }
    if (fulfillment.wkOrderId !== input.token.wkOrderId) {
      return {
        ok: false,
        code: 'ORDER_SCOPE_MISMATCH',
        message: 'Delivery handoff not authorized',
      };
    }
    if (fulfillment.customerId !== input.token.customerId) {
      return {
        ok: false,
        code: 'CUSTOMER_SCOPE_MISMATCH',
        message: 'Delivery handoff not authorized',
      };
    }
    if (fulfillment.status !== FulfillmentStatus.in_transit) {
      return {
        ok: false,
        code: 'FULFILLMENT_NOT_DELIVERY_ELIGIBLE',
        message: 'Delivery handoff not authorized',
      };
    }
    if (fulfillment.activeRiderId !== input.token.deliveryRiderId) {
      return {
        ok: false,
        code: 'ASSIGNMENT_CHANGED',
        message: 'Delivery handoff not authorized',
      };
    }
    if (fulfillment.assignmentVersion !== input.token.assignmentVersion) {
      return {
        ok: false,
        code: 'ASSIGNMENT_VERSION_MISMATCH',
        message: 'Delivery handoff not authorized',
      };
    }

    const assignment = await db.riderAssignment.findFirst({
      where: {
        id: input.token.riderAssignmentId,
        fulfillmentId: input.token.fulfillmentId,
        riderId: input.token.deliveryRiderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: input.token.assignmentVersion,
      },
    });
    if (!assignment) {
      return {
        ok: false,
        code: 'ASSIGNMENT_CHANGED',
        message: 'Delivery handoff not authorized',
      };
    }

    const order = await db.wkOrder.findUnique({
      where: { id: input.token.wkOrderId },
      select: { status: true, userId: true },
    });
    if (
      !order ||
      ['cancelled', 'rejected', 'refunded'].includes(order.status) ||
      order.userId !== input.token.customerId
    ) {
      return {
        ok: false,
        code: 'ORDER_TERMINAL',
        message: 'Delivery handoff not authorized',
      };
    }

    return { ok: true };
  }
}
