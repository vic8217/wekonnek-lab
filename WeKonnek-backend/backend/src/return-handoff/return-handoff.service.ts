import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentStatus,
  MerchantReturnHandoffPurpose,
  MerchantReturnHandoffTokenStatus,
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
  DEFAULT_RETURN_HANDOFF_TTL_SECONDS,
  RETURN_OTP_MAX_ATTEMPTS,
  encodeReturnQrPayload,
  generateReturnOtp,
  generateReturnSecret,
  hashReturnOtp,
  hashReturnSecret,
  otpsMatch,
  parseReturnQrPayload,
  secretsMatch,
} from './return-token';

type SafeFailure = { ok: false; code: string; message: string };

type TokenRow = {
  id: string;
  tokenHash: string;
  otpHash: string;
  purpose: MerchantReturnHandoffPurpose;
  status: MerchantReturnHandoffTokenStatus;
  expiresAt: Date;
  wkOrderId: number;
  fulfillmentId: string;
  merchantId: number;
  returnRiderId: string;
  riderAssignmentId: string;
  assignmentVersion: number;
  otpFailedAttempts: number;
  otpLockedUntil: Date | null;
  merchantConfirmedByUserId: string | null;
  custodyEventId: string | null;
  confirmIdempotencyKey: string | null;
};

@Injectable()
export class ReturnHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly custody: CustodyEventService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly config: ConfigService,
  ) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await run();
      } catch (err) {
        last = err;
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2034' ||
            (err.code === 'P2010' &&
              /could not serialize|40001|concurrent update/i.test(
                err.message,
              )));
        if (!retryable || i === attempts - 1) throw err;
      }
    }
    throw last;
  }

  ttlSeconds(): number {
    const raw = Number(
      this.config.get<string>('RETURN_HANDOFF_TTL_SECONDS') ??
        DEFAULT_RETURN_HANDOFF_TTL_SECONDS,
    );
    if (!Number.isFinite(raw) || raw < 60 || raw > 3600) {
      return DEFAULT_RETURN_HANDOFF_TTL_SECONDS;
    }
    return Math.floor(raw);
  }

  async issueForOrder(input: {
    wkOrderId: number;
    actorUserId: string;
    riderId?: string;
    correlationId?: string;
  }) {
    if (input.riderId && input.riderId !== input.actorUserId) {
      throw new ForbiddenException({
        code: 'RIDER_SPOOF_REJECTED',
        message: 'Rider identity is derived from authentication',
      });
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
      async (tx) => {
        const order = await tx.wkOrder.findUnique({
          where: { id: input.wkOrderId },
        });
        if (!order) throw new NotFoundException('Order not found');

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

        if (locked.status !== FulfillmentStatus.returning) {
          throw new ForbiddenException({
            code: 'RETURN_HANDOFF_NOT_ALLOWED',
            message: 'Fulfillment must be returning to issue return capability',
          });
        }
        if (locked.activeRiderId !== input.actorUserId) {
          throw new ForbiddenException({
            code: 'NOT_ACTIVE_RETURN_RIDER',
            message: 'Only the active return rider may request return capability',
          });
        }
        assertPossessionDependentRiderAuthority({
          actorUserId: input.actorUserId,
          status: locked.status,
          activeRiderId: locked.activeRiderId,
          physicalCustodianRiderId: locked.physicalCustodianRiderId,
          pendingCustodyIncomingRiderId: locked.pendingCustodyIncomingRiderId,
          action: 'return_capability',
        });
        if (!locked.merchantId || locked.merchantId !== order.merchantId) {
          throw new ForbiddenException({
            code: 'MERCHANT_SCOPE_MISMATCH',
            message: 'Fulfillment merchant does not match order',
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

        const priorActive = await tx.merchantReturnHandoffToken.findMany({
          where: {
            fulfillmentId: locked.id,
            purpose: MerchantReturnHandoffPurpose.MERCHANT_RETURN_HANDOFF,
            status: MerchantReturnHandoffTokenStatus.ACTIVE,
          },
        });
        for (const prior of priorActive) {
          await tx.merchantReturnHandoffToken.update({
            where: { id: prior.id },
            data: {
              status: MerchantReturnHandoffTokenStatus.REVOKED,
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
            action: 'RETURN_HANDOFF_REVOKED',
            correlationId: input.correlationId,
            metadata: {
              tokenId: prior.id,
              reason: 'superseded_by_reissue',
              assignmentVersion: prior.assignmentVersion,
            },
          });
        }

        const secret = generateReturnSecret();
        const otp = generateReturnOtp();
        const tokenId = randomUUID();
        const expiresAt = new Date(Date.now() + this.ttlSeconds() * 1000);
        await tx.merchantReturnHandoffToken.create({
          data: {
            id: tokenId,
            tokenHash: hashReturnSecret(secret),
            otpHash: hashReturnOtp(otp),
            purpose: MerchantReturnHandoffPurpose.MERCHANT_RETURN_HANDOFF,
            status: MerchantReturnHandoffTokenStatus.ACTIVE,
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            merchantId: order.merchantId,
            returnRiderId: input.actorUserId,
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
          action: 'RETURN_HANDOFF_ISSUED',
          correlationId: input.correlationId,
          metadata: {
            tokenId,
            assignmentVersion: locked.assignmentVersion,
            expiresAt: expiresAt.toISOString(),
            ttlSeconds: this.ttlSeconds(),
          },
        });

        return {
          tokenId,
          qrPayload: encodeReturnQrPayload({ tokenId, secret }),
          otp,
          expiresAt: expiresAt.toISOString(),
          wkOrderId: order.id,
          fulfillmentId: locked.id,
          assignmentVersion: locked.assignmentVersion,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
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

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "merchant_return_handoff_tokens" WHERE id = ${resolved.token.id}::uuid FOR UPDATE
      `;
      const token = await tx.merchantReturnHandoffToken.findUniqueOrThrow({
        where: { id: resolved.token.id },
      });

      const merchantOk = await this.assertMerchantActor(
        tx,
        token.merchantId,
        input.actorUserId,
      );
      if (!merchantOk) {
        return this.deny({
          ok: false,
          code: 'WRONG_MERCHANT',
          message: 'Return handoff not authorized',
        });
      }

      if (resolved.mode === 'qr') {
        if (!secretsMatch(token.tokenHash, resolved.secret)) {
          return this.deny({
            ok: false,
            code: 'RETURN_TOKEN_INVALID',
            message: 'Return handoff not authorized',
          });
        }
      } else {
        const otpGate = this.assertOtpForPreview(token, resolved.otp);
        if (!otpGate.ok) return this.deny(otpGate);
      }

      const checks = await this.validateTokenState({
        token,
        consume: false,
        tx,
      });
      if (!checks.ok) return this.deny(checks);

      const order = await tx.wkOrder.findUniqueOrThrow({
        where: { id: token.wkOrderId },
        select: { orderCode: true },
      });
      const rider = await tx.user.findUnique({
        where: { id: token.returnRiderId },
        select: { id: true, firstName: true, lastName: true },
      });

      return {
        ok: true as const,
        preview: true as const,
        tokenId: token.id,
        orderCode: order.orderCode,
        physicalStatus: 'returning',
        expiresAt: token.expiresAt.toISOString(),
        returnRider: rider
          ? {
              id: rider.id,
              displayName:
                [rider.firstName, rider.lastName].filter(Boolean).join(' ') ||
                null,
            }
          : { id: token.returnRiderId },
      };
    });
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
      const prior = await this.prisma.merchantReturnHandoffToken.findUnique({
        where: { confirmIdempotencyKey: input.idempotencyKey },
      });
      if (prior?.status === MerchantReturnHandoffTokenStatus.CONSUMED) {
        const merchantOk = await this.assertMerchantActor(
          this.prisma,
          prior.merchantId,
          input.actorUserId,
        );
        if (!merchantOk) {
          return this.deny({
            ok: false,
            code: 'WRONG_MERCHANT',
            message: 'Return handoff not authorized',
          });
        }
        // An idempotency key is scoped to the capability that consumed it.
        // Re-authorizing the merchant alone is insufficient: a changed QR/OTP
        // must not be able to retrieve or reuse a prior confirmation result.
        if (!this.presentedCapabilityMatchesToken(prior, input)) {
          return this.deny({
            ok: false,
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message: 'Idempotency key was already used with different return handoff input',
          });
        }
        const f = await this.prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: prior.fulfillmentId },
        });
        return {
          ok: true as const,
          idempotent: true,
          tokenId: prior.id,
          wkOrderId: prior.wkOrderId,
          fulfillmentId: prior.fulfillmentId,
          custodyEventId: prior.custodyEventId,
          fulfillmentStatus: f.status,
        };
      }
    }

    const resolved = await this.resolveCapability(input, true);
    if (!resolved.ok) return this.deny(resolved);

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "merchant_return_handoff_tokens" WHERE id = ${resolved.token.id}::uuid FOR UPDATE
        `;
        const token = await tx.merchantReturnHandoffToken.findUniqueOrThrow({
          where: { id: resolved.token.id },
        });

        const merchantOk = await this.assertMerchantActor(
          tx,
          token.merchantId,
          input.actorUserId,
        );
        if (!merchantOk) {
          return this.deny({
            ok: false,
            code: 'WRONG_MERCHANT',
            message: 'Return handoff not authorized',
          });
        }

        if (token.status === MerchantReturnHandoffTokenStatus.CONSUMED) {
          const f = await tx.orderFulfillment.findUniqueOrThrow({
            where: { id: token.fulfillmentId },
          });
          return {
            ok: true as const,
            idempotent: true,
            tokenId: token.id,
            wkOrderId: token.wkOrderId,
            fulfillmentId: token.fulfillmentId,
            custodyEventId: token.custodyEventId,
            fulfillmentStatus: f.status,
          };
        }

        if (resolved.mode === 'qr') {
          if (!secretsMatch(token.tokenHash, resolved.secret)) {
            return this.deny({
              ok: false,
              code: 'RETURN_TOKEN_INVALID',
              message: 'Return handoff not authorized',
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
            actorType: 'MERCHANT_OWNER',
            action: 'RETURN_HANDOFF_REPLAY_REJECTED',
            correlationId: input.correlationId,
            metadata: { tokenId: token.id, reason: checks.code },
          });
          return this.deny(checks);
        }

        await tx.$queryRaw`
          SELECT id FROM "order_fulfillments" WHERE id = ${token.fulfillmentId}::uuid FOR UPDATE
        `;
        const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
          where: { id: token.fulfillmentId },
        });
        if (fulfillment.status !== FulfillmentStatus.returning) {
          return this.deny({
            ok: false,
            code:
              fulfillment.status === FulfillmentStatus.returned
                ? 'RETURN_ALREADY_COMPLETED'
                : 'RETURN_NOT_IN_PROGRESS',
            message: 'Fulfillment is not awaiting merchant return confirmation',
          });
        }
        if (
          fulfillment.activeRiderId !== token.returnRiderId ||
          fulfillment.assignmentVersion !== token.assignmentVersion
        ) {
          return this.deny({
            ok: false,
            code: 'RETURN_ASSIGNMENT_STALE',
            message: 'Return assignment changed; re-issue capability',
          });
        }
        const assignment = await tx.riderAssignment.findFirst({
          where: {
            id: token.riderAssignmentId,
            fulfillmentId: token.fulfillmentId,
            riderId: token.returnRiderId,
            status: RiderAssignmentStatus.ACTIVE,
            assignmentVersion: token.assignmentVersion,
          },
        });
        if (!assignment) {
          return this.deny({
            ok: false,
            code: 'RETURN_ASSIGNMENT_STALE',
            message: 'Return assignment is no longer active',
          });
        }

        const now = new Date();
        const custody = await this.custody.recordSecureMerchantReturnReceiptInTx({
          tx,
          actorUserId: input.actorUserId,
          wkOrderId: token.wkOrderId,
          fulfillmentId: token.fulfillmentId,
          fromUserId: token.returnRiderId,
          toUserId: input.actorUserId,
          correlationId: input.correlationId,
          metadata: {
            merchantReturnHandoffTokenId: token.id,
            assignmentVersion: token.assignmentVersion,
            merchantConfirmedReceipt: true,
            returnRiderPresentedCapability: true,
            paymentUnchanged: true,
            riderAdvanceUnchanged: true,
            noRefundImplied: true,
          },
        });

        const transition = await this.transitions.transitionInTx(
          tx,
          {
            fulfillmentId: token.fulfillmentId,
            targetStatus: 'returned',
            actor: {
              id: input.actorUserId,
              type: 'INTERNAL_SERVICE',
            },
            reason: 'merchant_return_handoff_confirmed',
            correlationId: input.correlationId,
            expectedVersion: token.assignmentVersion,
          },
          'returned',
        );

        await tx.merchantReturnHandoffToken.update({
          where: { id: token.id },
          data: {
            status: MerchantReturnHandoffTokenStatus.CONSUMED,
            consumedAt: now,
            consumedByUserId: input.actorUserId,
            merchantConfirmedAt: now,
            merchantConfirmedByUserId: input.actorUserId,
            custodyEventId: custody.id,
            confirmIdempotencyKey: input.idempotencyKey,
          },
        });

        await this.events.record({
          tx,
          aggregateType: 'ORDER_FULFILLMENT',
          aggregateId: token.fulfillmentId,
          fulfillmentId: token.fulfillmentId,
          wkOrderId: token.wkOrderId,
          actorId: input.actorUserId,
          actorType: 'MERCHANT_OWNER',
          action: 'RETURN_HANDOFF_CONFIRMED',
          previousState: FulfillmentStatus.returning,
          newState: transition.fulfillment.status,
          correlationId: input.correlationId,
          metadata: {
            tokenId: token.id,
            custodyEventId: custody.id,
            assignmentVersion: token.assignmentVersion,
            paymentUnchanged: true,
            riderAdvanceUnchanged: true,
            noRefundImplied: true,
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
    ),
    );
  }

  private async assertMerchantActor(
    db: Prisma.TransactionClient | PrismaService,
    merchantId: number,
    actorUserId: string,
  ) {
    const merchant = await db.merchant.findFirst({
      where: {
        id: merchantId,
        OR: [
          { userId: actorUserId },
          {
            merchantStaff: {
              some: { userId: actorUserId, isActive: true },
            },
          },
        ],
      },
      select: { id: true },
    });
    return Boolean(merchant);
  }

  private async resolveCapability(
    input: { qrPayload?: string; otp?: string; orderId?: number },
    _forConfirm: boolean,
  ): Promise<
    | { ok: true; mode: 'qr'; token: TokenRow; secret: string }
    | { ok: true; mode: 'otp'; token: TokenRow; otp: string }
    | SafeFailure
  > {
    if (input.qrPayload) {
      try {
        const parsed = parseReturnQrPayload(input.qrPayload);
        const token = await this.prisma.merchantReturnHandoffToken.findUnique({
          where: { id: parsed.tokenId },
        });
        if (!token) {
          return {
            ok: false,
            code: 'RETURN_TOKEN_INVALID',
            message: 'Return handoff not authorized',
          };
        }
        if (!secretsMatch(token.tokenHash, parsed.secret)) {
          return {
            ok: false,
            code: 'RETURN_TOKEN_INVALID',
            message: 'Return handoff not authorized',
          };
        }
        return { ok: true, mode: 'qr', token, secret: parsed.secret };
      } catch {
        return {
          ok: false,
          code: 'RETURN_TOKEN_INVALID',
          message: 'Invalid return handoff payload',
        };
      }
    }

    if (input.otp) {
      if (input.orderId == null) {
        return {
          ok: false,
          code: 'ORDER_ID_REQUIRED',
          message: 'orderId is required for OTP return confirmation',
        };
      }
      const token = await this.prisma.merchantReturnHandoffToken.findFirst({
        where: {
          wkOrderId: input.orderId,
          purpose: MerchantReturnHandoffPurpose.MERCHANT_RETURN_HANDOFF,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!token) {
        return {
          ok: false,
          code: 'RETURN_TOKEN_INVALID',
          message: 'Return handoff not authorized',
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

  private presentedCapabilityMatchesToken(
    token: Pick<TokenRow, 'id' | 'tokenHash' | 'otpHash' | 'wkOrderId'>,
    input: { qrPayload?: string; otp?: string; orderId?: number },
  ): boolean {
    if (input.qrPayload) {
      try {
        const parsed = parseReturnQrPayload(input.qrPayload);
        return (
          parsed.tokenId === token.id &&
          secretsMatch(token.tokenHash, parsed.secret)
        );
      } catch {
        return false;
      }
    }
    if (input.otp) {
      return (
        input.orderId === token.wkOrderId &&
        otpsMatch(token.otpHash, input.otp)
      );
    }
    return false;
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
        message: 'OTP attempts locked; re-issue capability',
      };
    }
    if (!otpsMatch(token.otpHash, otp)) {
      const attempts = token.otpFailedAttempts + 1;
      const locked =
        attempts >= RETURN_OTP_MAX_ATTEMPTS
          ? new Date(Date.now() + 15 * 60 * 1000)
          : null;
      await tx.merchantReturnHandoffToken.update({
        where: { id: token.id },
        data: {
          otpFailedAttempts: attempts,
          otpLockedUntil: locked ?? undefined,
        },
      });
      if (locked) {
        return {
          ok: false,
          code: 'OTP_LOCKED',
          message: 'OTP attempts locked; re-issue capability',
        };
      }
      return {
        ok: false,
        code: 'OTP_INVALID',
        message: 'Return handoff not authorized',
      };
    }
    return { ok: true };
  }

  /** Validation is a preview: it must not consume, lock, or otherwise mutate a capability. */
  private assertOtpForPreview(
    token: TokenRow,
    otp: string,
  ): { ok: true } | SafeFailure {
    if (token.otpLockedUntil && token.otpLockedUntil.getTime() > Date.now()) {
      return {
        ok: false,
        code: 'OTP_LOCKED',
        message: 'OTP attempts locked; re-issue capability',
      };
    }
    if (!otpsMatch(token.otpHash, otp)) {
      return {
        ok: false,
        code: 'OTP_INVALID',
        message: 'Return handoff not authorized',
      };
    }
    return { ok: true };
  }

  private async validateTokenState(input: {
    token: TokenRow;
    consume: boolean;
    tx: Prisma.TransactionClient;
  }): Promise<{ ok: true } | SafeFailure> {
    const { token } = input;
    if (token.status === MerchantReturnHandoffTokenStatus.REVOKED) {
      return {
        ok: false,
        code: 'RETURN_TOKEN_REVOKED',
        message: 'Return handoff not authorized',
      };
    }
    if (token.status === MerchantReturnHandoffTokenStatus.CONSUMED) {
      return {
        ok: false,
        code: 'RETURN_TOKEN_ALREADY_CONSUMED',
        message: 'Return handoff already completed',
      };
    }
    if (
      token.status === MerchantReturnHandoffTokenStatus.EXPIRED ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      if (token.status === MerchantReturnHandoffTokenStatus.ACTIVE) {
        await input.tx.merchantReturnHandoffToken.update({
          where: { id: token.id },
          data: { status: MerchantReturnHandoffTokenStatus.EXPIRED },
        });
      }
      return {
        ok: false,
        code: 'RETURN_TOKEN_EXPIRED',
        message: 'Return handoff expired',
      };
    }
    if (token.status !== MerchantReturnHandoffTokenStatus.ACTIVE) {
      return {
        ok: false,
        code: 'RETURN_TOKEN_INVALID',
        message: 'Return handoff not authorized',
      };
    }
    return { ok: true };
  }

  private deny(failure: SafeFailure) {
    return failure;
  }
}
