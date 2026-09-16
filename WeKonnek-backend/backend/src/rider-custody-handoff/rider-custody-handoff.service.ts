import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustodyEventType,
  Prisma,
  RiderAssignmentStatus,
  RiderCustodyHandoffPurpose,
  RiderCustodyHandoffTokenStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { isMidPossessionStatus } from './possession-authority';
import {
  DEFAULT_RIDER_CUSTODY_TTL_SECONDS,
  RIDER_CUSTODY_OTP_MAX_ATTEMPTS,
  encodeRiderCustodyQrPayload,
  generateRiderCustodyOtp,
  generateRiderCustodySecret,
  hashRiderCustodyOtp,
  hashRiderCustodySecret,
  parseRiderCustodyQrPayload,
  riderCustodyOtpsMatch,
  riderCustodySecretsMatch,
} from './rider-custody-token';

type SafeFailure = { ok: false; code: string; message: string };

type TokenRow = {
  id: string;
  tokenHash: string;
  otpHash: string;
  purpose: RiderCustodyHandoffPurpose;
  status: RiderCustodyHandoffTokenStatus;
  expiresAt: Date;
  wkOrderId: number;
  fulfillmentId: string;
  outgoingRiderId: string;
  incomingRiderId: string;
  sourceRiderAssignmentId: string;
  sourceAssignmentVersion: number;
  targetAssignmentVersion: number | null;
  otpFailedAttempts: number;
  otpLockedUntil: Date | null;
  releaseCustodyEventId: string | null;
  receiptCustodyEventId: string | null;
  confirmIdempotencyKey: string | null;
};

@Injectable()
export class RiderCustodyHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly custody: CustodyEventService,
    private readonly assignments: RiderAssignmentService,
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
            err.code === 'P2002' ||
            (err.code === 'P2010' &&
              /could not serialize|40001|40P01|concurrent update|deadlock/i.test(
                err.message,
              )));
        if (!retryable || i === attempts - 1) throw err;
      }
    }
    throw last;
  }

  ttlSeconds(): number {
    const raw = Number(
      this.config.get<string>('RIDER_CUSTODY_HANDOFF_TTL_SECONDS') ??
        DEFAULT_RIDER_CUSTODY_TTL_SECONDS,
    );
    if (!Number.isFinite(raw) || raw < 60 || raw > 3600) {
      return DEFAULT_RIDER_CUSTODY_TTL_SECONDS;
    }
    return Math.floor(raw);
  }

  async issueForOrder(input: {
    wkOrderId: number;
    actorUserId: string;
    /** Ignored — JWT-derived only. Incoming is bound from pending field. */
    incomingRiderId?: string;
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

          if (!isMidPossessionStatus(locked.status)) {
            throw new ForbiddenException({
              code: 'RIDER_CUSTODY_HANDOFF_NOT_ALLOWED',
              message:
                'Fulfillment must be mid-possession to issue rider custody capability',
            });
          }
          if (!locked.pendingCustodyIncomingRiderId) {
            throw new ForbiddenException({
              code: 'NO_PENDING_CUSTODY_TRANSFER',
              message:
                'No pending rider custody transfer; reassignment must set pending incoming first',
            });
          }
          if (
            input.incomingRiderId &&
            input.incomingRiderId !== locked.pendingCustodyIncomingRiderId
          ) {
            throw new ForbiddenException({
              code: 'INCOMING_RIDER_SPOOF_REJECTED',
              message:
                'Incoming rider is bound from pending custody transfer, not request body',
            });
          }
          if (locked.activeRiderId !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'NOT_OUTGOING_CUSTODIAN',
              message:
                'Only the active outgoing rider (physical custodian) may issue rider custody capability',
            });
          }
          const custodian =
            locked.physicalCustodianRiderId ?? locked.activeRiderId;
          if (custodian !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'RIDER_NOT_PHYSICAL_CUSTODIAN',
              message:
                'Only the proven physical custodian may issue rider custody capability',
            });
          }

          const incomingRiderId = locked.pendingCustodyIncomingRiderId;
          if (incomingRiderId === input.actorUserId) {
            throw new ForbiddenException({
              code: 'SELF_TRANSFER_REJECTED',
              message: 'Outgoing and incoming riders must differ',
            });
          }

          const sourceVersion =
            locked.pendingCustodyFromAssignmentVersion ??
            locked.assignmentVersion;
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
              message: 'Active outgoing rider assignment not found',
            });
          }

          const priorActive = await tx.riderCustodyHandoffToken.findMany({
            where: {
              fulfillmentId: locked.id,
              purpose: RiderCustodyHandoffPurpose.RIDER_CUSTODY_HANDOFF,
              status: RiderCustodyHandoffTokenStatus.ACTIVE,
            },
          });
          for (const prior of priorActive) {
            await tx.riderCustodyHandoffToken.update({
              where: { id: prior.id },
              data: {
                status: RiderCustodyHandoffTokenStatus.REVOKED,
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
              action: 'RIDER_CUSTODY_HANDOFF_REVOKED',
              correlationId: input.correlationId,
              metadata: {
                tokenId: prior.id,
                reason: 'superseded_by_reissue',
                sourceAssignmentVersion: prior.sourceAssignmentVersion,
              },
            });
          }

          const secret = generateRiderCustodySecret();
          const otp = generateRiderCustodyOtp();
          const tokenId = randomUUID();
          const expiresAt = new Date(Date.now() + this.ttlSeconds() * 1000);
          await tx.riderCustodyHandoffToken.create({
            data: {
              id: tokenId,
              tokenHash: hashRiderCustodySecret(secret),
              otpHash: hashRiderCustodyOtp(otp),
              purpose: RiderCustodyHandoffPurpose.RIDER_CUSTODY_HANDOFF,
              status: RiderCustodyHandoffTokenStatus.ACTIVE,
              wkOrderId: order.id,
              fulfillmentId: locked.id,
              outgoingRiderId: input.actorUserId,
              incomingRiderId,
              sourceRiderAssignmentId: assignment.id,
              sourceAssignmentVersion: sourceVersion,
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
            action: 'RIDER_CUSTODY_HANDOFF_ISSUED',
            correlationId: input.correlationId,
            metadata: {
              tokenId,
              outgoingRiderId: input.actorUserId,
              incomingRiderId,
              sourceAssignmentVersion: sourceVersion,
              expiresAt: expiresAt.toISOString(),
              ttlSeconds: this.ttlSeconds(),
              paymentUnchanged: true,
              riderAdvanceUnchanged: true,
            },
          });

          return {
            tokenId,
            qrPayload: encodeRiderCustodyQrPayload({ tokenId, secret }),
            otp,
            expiresAt: expiresAt.toISOString(),
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            outgoingRiderId: input.actorUserId,
            incomingRiderId,
            sourceAssignmentVersion: sourceVersion,
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
        SELECT id FROM "rider_custody_handoff_tokens" WHERE id = ${resolved.token.id}::uuid FOR UPDATE
      `;
      const token = await tx.riderCustodyHandoffToken.findUniqueOrThrow({
        where: { id: resolved.token.id },
      });

      if (token.incomingRiderId !== input.actorUserId) {
        return this.deny({
          ok: false,
          code: 'WRONG_INCOMING_RIDER',
          message: 'Rider custody handoff not authorized',
        });
      }

      if (resolved.mode === 'qr') {
        if (!riderCustodySecretsMatch(token.tokenHash, resolved.secret)) {
          return this.deny({
            ok: false,
            code: 'RIDER_CUSTODY_TOKEN_INVALID',
            message: 'Rider custody handoff not authorized',
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
      const outgoing = await tx.user.findUnique({
        where: { id: token.outgoingRiderId },
        select: { id: true, firstName: true, lastName: true },
      });

      return {
        ok: true as const,
        preview: true as const,
        tokenId: token.id,
        orderCode: order.orderCode,
        purpose: token.purpose,
        expiresAt: token.expiresAt.toISOString(),
        outgoingRider: outgoing
          ? {
              id: outgoing.id,
              displayName:
                [outgoing.firstName, outgoing.lastName]
                  .filter(Boolean)
                  .join(' ') || null,
            }
          : { id: token.outgoingRiderId },
        incomingRiderId: token.incomingRiderId,
        sourceAssignmentVersion: token.sourceAssignmentVersion,
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
      const prior = await this.prisma.riderCustodyHandoffToken.findUnique({
        where: { confirmIdempotencyKey: input.idempotencyKey },
      });
      if (prior?.status === RiderCustodyHandoffTokenStatus.CONSUMED) {
        // Auth before idempotent disclosure.
        if (prior.incomingRiderId !== input.actorUserId) {
          return this.deny({
            ok: false,
            code: 'WRONG_INCOMING_RIDER',
            message: 'Rider custody handoff not authorized',
          });
        }
        if (!this.presentedCapabilityMatchesToken(prior, input)) {
          return this.deny({
            ok: false,
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message:
              'Idempotency key was already used with different rider custody handoff input',
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
          releaseCustodyEventId: prior.releaseCustodyEventId,
          receiptCustodyEventId: prior.receiptCustodyEventId,
          activeRiderId: f.activeRiderId,
          physicalCustodianRiderId: f.physicalCustodianRiderId,
          assignmentVersion: f.assignmentVersion,
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
            SELECT id FROM "rider_custody_handoff_tokens" WHERE id = ${resolved.token.id}::uuid FOR UPDATE
          `;
          const token = await tx.riderCustodyHandoffToken.findUniqueOrThrow({
            where: { id: resolved.token.id },
          });

          if (token.incomingRiderId !== input.actorUserId) {
            return this.deny({
              ok: false,
              code: 'WRONG_INCOMING_RIDER',
              message: 'Rider custody handoff not authorized',
            });
          }

          if (token.status === RiderCustodyHandoffTokenStatus.CONSUMED) {
            const f = await tx.orderFulfillment.findUniqueOrThrow({
              where: { id: token.fulfillmentId },
            });
            return {
              ok: true as const,
              idempotent: true,
              tokenId: token.id,
              wkOrderId: token.wkOrderId,
              fulfillmentId: token.fulfillmentId,
              releaseCustodyEventId: token.releaseCustodyEventId,
              receiptCustodyEventId: token.receiptCustodyEventId,
              activeRiderId: f.activeRiderId,
              physicalCustodianRiderId: f.physicalCustodianRiderId,
              assignmentVersion: f.assignmentVersion,
              fulfillmentStatus: f.status,
            };
          }

          if (resolved.mode === 'qr') {
            if (!riderCustodySecretsMatch(token.tokenHash, resolved.secret)) {
              return this.deny({
                ok: false,
                code: 'RIDER_CUSTODY_TOKEN_INVALID',
                message: 'Rider custody handoff not authorized',
              });
            }
          } else {
            const otpGate = await this.assertOtpUnderLock(
              tx,
              token,
              resolved.otp,
            );
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
              actorType: 'RIDER',
              action: 'RIDER_CUSTODY_HANDOFF_REPLAY_REJECTED',
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
          if (!isMidPossessionStatus(fulfillment.status)) {
            return this.deny({
              ok: false,
              code: 'FULFILLMENT_NOT_POSSESSION_ELIGIBLE',
              message: 'Fulfillment is not awaiting rider custody transfer',
            });
          }
          if (
            fulfillment.activeRiderId !== token.outgoingRiderId ||
            fulfillment.pendingCustodyIncomingRiderId !==
              token.incomingRiderId ||
            (fulfillment.pendingCustodyFromAssignmentVersion != null &&
              fulfillment.pendingCustodyFromAssignmentVersion !==
                token.sourceAssignmentVersion)
          ) {
            return this.deny({
              ok: false,
              code: 'PENDING_CUSTODY_TRANSFER_STALE',
              message: 'Pending custody transfer changed; re-issue capability',
            });
          }
          if (
            fulfillment.physicalCustodianRiderId != null &&
            fulfillment.physicalCustodianRiderId !== token.outgoingRiderId
          ) {
            return this.deny({
              ok: false,
              code: 'PHYSICAL_CUSTODIAN_MISMATCH',
              message: 'Outgoing rider is not the proven physical custodian',
            });
          }

          const now = new Date();
          const release = await this.custody.recordSecureRiderTransferInTx({
            tx,
            actorUserId: token.outgoingRiderId,
            eventType: CustodyEventType.RIDER_TRANSFER_RELEASED,
            wkOrderId: token.wkOrderId,
            fulfillmentId: token.fulfillmentId,
            fromUserId: token.outgoingRiderId,
            toUserId: token.incomingRiderId,
            correlationId: input.correlationId,
            metadata: {
              riderCustodyHandoffTokenId: token.id,
              sourceAssignmentVersion: token.sourceAssignmentVersion,
              outgoingRiderReleased: true,
              paymentUnchanged: true,
              riderAdvanceUnchanged: true,
            },
          });

          const receipt = await this.custody.recordSecureRiderTransferInTx({
            tx,
            actorUserId: input.actorUserId,
            eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
            wkOrderId: token.wkOrderId,
            fulfillmentId: token.fulfillmentId,
            fromUserId: token.outgoingRiderId,
            toUserId: token.incomingRiderId,
            correlationId: input.correlationId,
            metadata: {
              riderCustodyHandoffTokenId: token.id,
              sourceAssignmentVersion: token.sourceAssignmentVersion,
              incomingRiderConfirmedReceipt: true,
              paymentUnchanged: true,
              riderAdvanceUnchanged: true,
            },
          });

          const finalized =
            await this.assignments.finalizeMidPossessionTransferInTx(tx, {
              fulfillmentId: token.fulfillmentId,
              outgoingRiderId: token.outgoingRiderId,
              incomingRiderId: token.incomingRiderId,
              actor: { id: input.actorUserId, type: 'RIDER' },
              reason: 'rider_custody_handoff_confirmed',
              correlationId: input.correlationId,
              expectedSourceAssignmentVersion: token.sourceAssignmentVersion,
            });

          await tx.riderCustodyHandoffToken.update({
            where: { id: token.id },
            data: {
              status: RiderCustodyHandoffTokenStatus.CONSUMED,
              consumedAt: now,
              consumedByUserId: input.actorUserId,
              incomingConfirmedAt: now,
              releaseCustodyEventId: release.id,
              receiptCustodyEventId: receipt.id,
              targetAssignmentVersion: finalized.assignmentVersion,
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
            actorType: 'RIDER',
            action: 'RIDER_CUSTODY_HANDOFF_CONFIRMED',
            previousState: fulfillment.status,
            newState: finalized.fulfillment.status,
            correlationId: input.correlationId,
            metadata: {
              tokenId: token.id,
              releaseCustodyEventId: release.id,
              receiptCustodyEventId: receipt.id,
              outgoingRiderId: token.outgoingRiderId,
              incomingRiderId: token.incomingRiderId,
              sourceAssignmentVersion: token.sourceAssignmentVersion,
              targetAssignmentVersion: finalized.assignmentVersion,
              paymentUnchanged: true,
              riderAdvanceUnchanged: true,
            },
          });

          return {
            ok: true as const,
            idempotent: false,
            tokenId: token.id,
            wkOrderId: token.wkOrderId,
            fulfillmentId: token.fulfillmentId,
            releaseCustodyEventId: release.id,
            receiptCustodyEventId: receipt.id,
            activeRiderId: finalized.fulfillment.activeRiderId,
            physicalCustodianRiderId:
              finalized.fulfillment.physicalCustodianRiderId,
            assignmentVersion: finalized.assignmentVersion,
            fulfillmentStatus: finalized.fulfillment.status,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
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
        const parsed = parseRiderCustodyQrPayload(input.qrPayload);
        const token = await this.prisma.riderCustodyHandoffToken.findUnique({
          where: { id: parsed.tokenId },
        });
        if (!token) {
          return {
            ok: false,
            code: 'RIDER_CUSTODY_TOKEN_INVALID',
            message: 'Rider custody handoff not authorized',
          };
        }
        if (!riderCustodySecretsMatch(token.tokenHash, parsed.secret)) {
          return {
            ok: false,
            code: 'RIDER_CUSTODY_TOKEN_INVALID',
            message: 'Rider custody handoff not authorized',
          };
        }
        return { ok: true, mode: 'qr', token, secret: parsed.secret };
      } catch {
        return {
          ok: false,
          code: 'RIDER_CUSTODY_TOKEN_INVALID',
          message: 'Invalid rider custody handoff payload',
        };
      }
    }

    if (input.otp) {
      if (input.orderId == null) {
        return {
          ok: false,
          code: 'ORDER_ID_REQUIRED',
          message: 'orderId is required for OTP rider custody confirmation',
        };
      }
      const token = await this.prisma.riderCustodyHandoffToken.findFirst({
        where: {
          wkOrderId: input.orderId,
          purpose: RiderCustodyHandoffPurpose.RIDER_CUSTODY_HANDOFF,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!token) {
        return {
          ok: false,
          code: 'RIDER_CUSTODY_TOKEN_INVALID',
          message: 'Rider custody handoff not authorized',
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

  /** Exported for unit tests / idempotency checks. */
  presentedCapabilityMatchesToken(
    token: Pick<TokenRow, 'id' | 'tokenHash' | 'otpHash' | 'wkOrderId'>,
    input: { qrPayload?: string; otp?: string; orderId?: number },
  ): boolean {
    if (input.qrPayload) {
      try {
        const parsed = parseRiderCustodyQrPayload(input.qrPayload);
        return (
          parsed.tokenId === token.id &&
          riderCustodySecretsMatch(token.tokenHash, parsed.secret)
        );
      } catch {
        return false;
      }
    }
    if (input.otp) {
      return (
        input.orderId === token.wkOrderId &&
        riderCustodyOtpsMatch(token.otpHash, input.otp)
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
    if (!riderCustodyOtpsMatch(token.otpHash, otp)) {
      const attempts = token.otpFailedAttempts + 1;
      const locked =
        attempts >= RIDER_CUSTODY_OTP_MAX_ATTEMPTS
          ? new Date(Date.now() + 15 * 60 * 1000)
          : null;
      await tx.riderCustodyHandoffToken.update({
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
        message: 'Rider custody handoff not authorized',
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
    if (!riderCustodyOtpsMatch(token.otpHash, otp)) {
      return {
        ok: false,
        code: 'OTP_INVALID',
        message: 'Rider custody handoff not authorized',
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
    if (token.status === RiderCustodyHandoffTokenStatus.REVOKED) {
      return {
        ok: false,
        code: 'RIDER_CUSTODY_TOKEN_REVOKED',
        message: 'Rider custody handoff not authorized',
      };
    }
    if (token.status === RiderCustodyHandoffTokenStatus.CONSUMED) {
      return {
        ok: false,
        code: 'RIDER_CUSTODY_TOKEN_ALREADY_CONSUMED',
        message: 'Rider custody handoff already completed',
      };
    }
    if (
      token.status === RiderCustodyHandoffTokenStatus.EXPIRED ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      if (token.status === RiderCustodyHandoffTokenStatus.ACTIVE) {
        await input.tx.riderCustodyHandoffToken.update({
          where: { id: token.id },
          data: { status: RiderCustodyHandoffTokenStatus.EXPIRED },
        });
      }
      return {
        ok: false,
        code: 'RIDER_CUSTODY_TOKEN_EXPIRED',
        message: 'Rider custody handoff expired',
      };
    }
    if (token.status !== RiderCustodyHandoffTokenStatus.ACTIVE) {
      return {
        ok: false,
        code: 'RIDER_CUSTODY_TOKEN_INVALID',
        message: 'Rider custody handoff not authorized',
      };
    }
    return { ok: true };
  }

  private deny(failure: SafeFailure) {
    return failure;
  }
}
