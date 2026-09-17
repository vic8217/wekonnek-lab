import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryAttemptOutcome,
  FulfillmentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryEvidenceKind,
  OperationsRecoveryEventType,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  OperationsRecoveryVerificationCode,
  Prisma,
  RedeliveryAuthorizationStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { withSerializableRetry as runSerializableRetry } from '../prisma/serializable-retry';
import {
  CONTACT_EVIDENCE_KINDS,
  CUSTODY_INVESTIGATION_VERIFICATION_CODES,
  evaluateClosurePolicy,
  evaluateOpeningTriggerEligibility,
  isInvestigativeOpenWhileRedeliveryActive,
  MAX_DELIVERY_ATTEMPTS,
  OPERATIONS_RECOVERY_ACTIVE_STATUSES,
} from './operations-recovery.policy';

type AdminActor = { type: 'SYSTEM_ADMIN'; id: string };

@Injectable()
export class OperationsRecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    return runSerializableRetry(run, attempts);
  }

  /**
   * Lock order (Stage 11 — compatible with Stages 5A/7/8/9/10):
   * 1. orders (wkOrder)
   * 2. order_fulfillments
   * 3. operations_recoveries
   * Secondary under fulfillment: operational_cases, delivery_attempts (read),
   * never lock Stage 5A/7 tokens before order+fulfillment.
   */
  private async lockOrderAndFulfillment(
    tx: Prisma.TransactionClient,
    wkOrderId: number,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "orders" WHERE id = ${wkOrderId} FOR UPDATE
    `;
    const order = await tx.wkOrder.findUnique({ where: { id: wkOrderId } });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    const fulfillment = await tx.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    if (!fulfillment) {
      throw new NotFoundException({
        code: 'FULFILLMENT_MISSING',
        message: 'Fulfillment missing for order',
      });
    }
    await tx.$queryRaw`
      SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
    `;
    const locked = await tx.orderFulfillment.findUnique({
      where: { id: fulfillment.id },
    });
    if (!locked) {
      throw new NotFoundException({
        code: 'FULFILLMENT_MISSING',
        message: 'Fulfillment missing',
      });
    }
    return { order, fulfillment: locked };
  }

  private async lockRecovery(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "operations_recoveries" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.operationsRecovery.findUnique({ where: { id } });
  }

  private stablePayloadHash(parts: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex')
      .slice(0, 64);
  }

  private truncKey(key?: string | null): string | null {
    if (!key) return null;
    return key.slice(0, 64);
  }

  private async requireAdmin(actorUserId: string): Promise<AdminActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!user || (user.role !== UserRole.admin && user.role !== UserRole.staff)) {
      throw new ForbiddenException({
        code: 'OPERATIONS_RECOVERY_FORBIDDEN',
        message: 'Only SYSTEM_ADMIN may manage operations recovery',
      });
    }
    return { type: 'SYSTEM_ADMIN', id: actorUserId };
  }

  private assertActive(recovery: {
    status: OperationsRecoveryStatus;
  }) {
    if (
      !(OPERATIONS_RECOVERY_ACTIVE_STATUSES as readonly string[]).includes(
        recovery.status,
      )
    ) {
      throw new ConflictException({
        code: 'OPERATIONS_RECOVERY_TERMINAL',
        message: `Recovery is terminal (${recovery.status})`,
      });
    }
  }

  private async countFailedAttempts(
    tx: Prisma.TransactionClient,
    fulfillmentId: string,
  ): Promise<number> {
    return tx.deliveryAttempt.count({
      where: {
        fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
  }

  private async hasReturnReceived(
    tx: Prisma.TransactionClient,
    fulfillmentId: string,
  ): Promise<boolean> {
    const n = await tx.custodyEvent.count({
      where: { fulfillmentId, eventType: 'RETURN_RECEIVED' },
    });
    return n > 0;
  }

  private serializeRecovery(r: {
    id: string;
    wkOrderId: number;
    fulfillmentId: string;
    status: OperationsRecoveryStatus;
    openingTriggerCode: OperationsRecoveryTrigger;
    currentDisposition: OperationsRecoveryDisposition | null;
    attemptBudgetExhausted: boolean;
    failedAttemptCountAtOpen: number;
    correlationId: string;
    notes: string | null;
    closedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      wkOrderId: r.wkOrderId,
      fulfillmentId: r.fulfillmentId,
      status: r.status,
      openingTriggerCode: r.openingTriggerCode,
      currentDisposition: r.currentDisposition,
      attemptBudgetExhausted: r.attemptBudgetExhausted,
      failedAttemptCountAtOpen: r.failedAttemptCountAtOpen,
      correlationId: r.correlationId,
      notes: r.notes,
      closedAt: r.closedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
    };
  }

  private minimalRecovery(r: {
    id: string;
    wkOrderId: number;
    status: OperationsRecoveryStatus;
    currentDisposition: OperationsRecoveryDisposition | null;
    openingTriggerCode: OperationsRecoveryTrigger;
  }) {
    return {
      id: r.id,
      wkOrderId: r.wkOrderId,
      status: r.status,
      currentDisposition: r.currentDisposition,
      openingTriggerCode: r.openingTriggerCode,
    };
  }

  // ─── open ───────────────────────────────────────────────

  async open(input: {
    wkOrderId: number;
    actorUserId: string;
    openingTriggerCode: OperationsRecoveryTrigger | string;
    correlationId: string;
    notes?: string;
    sourceOperationalCaseId?: string;
    sourceDeliveryAttemptId?: string;
    sourceRedeliveryAuthorizationId?: string;
    stage9DeterminationId?: string;
    idempotencyKey?: string;
  }) {
    if (!input.correlationId?.trim()) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'correlationId is required',
      });
    }
    const actor = await this.requireAdmin(input.actorUserId);
    const trigger = input.openingTriggerCode as OperationsRecoveryTrigger;
    if (!Object.values(OperationsRecoveryTrigger).includes(trigger)) {
      throw new BadRequestException({
        code: 'OPERATIONS_RECOVERY_TRIGGER_INVALID',
        message: 'Invalid openingTriggerCode',
      });
    }
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      wkOrderId: input.wkOrderId,
      action: 'open',
      trigger,
      notes: input.notes ?? null,
      sourceOperationalCaseId: input.sourceOperationalCaseId ?? null,
      sourceDeliveryAttemptId: input.sourceDeliveryAttemptId ?? null,
      sourceRedeliveryAuthorizationId:
        input.sourceRedeliveryAuthorizationId ?? null,
      stage9DeterminationId: input.stage9DeterminationId ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.operationsRecovery.findFirst({
        where: {
          openedByActorId: actor.id,
          openIdempotencyKey: idemKey,
        },
      });
      if (prior) {
        if (prior.wkOrderId !== input.wkOrderId) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
            message:
              'Idempotency key already used for a different order by this actor',
          });
        }
        if (prior.openPayloadHash !== payloadHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'OPERATIONS_RECOVERY_OPENED',
          idempotent: true,
          recovery: this.serializeRecovery(prior),
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            input.wkOrderId,
          );
          if (!order.userId || !fulfillment.merchantId) {
            throw new BadRequestException({
              code: 'OPERATIONS_RECOVERY_BINDINGS_INCOMPLETE',
              message: 'Order missing customer or merchant binding',
            });
          }

          const failedAttemptCount = await this.countFailedAttempts(
            tx,
            fulfillment.id,
          );
          const hasReturnReceived = await this.hasReturnReceived(
            tx,
            fulfillment.id,
          );
          const eligibility = evaluateOpeningTriggerEligibility(trigger, {
            fulfillmentStatus: fulfillment.status,
            pendingCustodyIncomingRiderId:
              fulfillment.pendingCustodyIncomingRiderId,
            physicalCustodianRiderId: fulfillment.physicalCustodianRiderId,
            activeRiderId: fulfillment.activeRiderId,
            failedAttemptCount,
            hasReturnReceived,
            notes: input.notes,
          });
          if (!eligibility.ok) {
            throw new ForbiddenException({
              code: eligibility.code,
              message: eligibility.message,
            });
          }

          // Stage 10↔11 mutual exclusivity: ordinary opens rejected while
          // Stage 10 redelivery is ACTIVATED. Investigative triggers may open
          // for investigation only (cannot manufacture another delivery path).
          await tx.$queryRaw`
            SELECT id FROM "redelivery_authorizations"
            WHERE fulfillment_id = ${fulfillment.id}::uuid
              AND status = 'ACTIVATED'
            FOR UPDATE
          `;
          const activatedRedelivery = await tx.redeliveryAuthorization.findFirst(
            {
              where: {
                fulfillmentId: fulfillment.id,
                status: RedeliveryAuthorizationStatus.ACTIVATED,
              },
              select: { id: true },
            },
          );
          if (
            activatedRedelivery &&
            !isInvestigativeOpenWhileRedeliveryActive(trigger)
          ) {
            throw new ForbiddenException({
              code: 'REDELIVERY_ACTIVE',
              message:
                'Activated Stage 10 redelivery is executing; ordinary Stage 11 open is blocked',
            });
          }

          const existingActive = await tx.operationsRecovery.findFirst({
            where: {
              fulfillmentId: fulfillment.id,
              status: {
                in: [
                  OperationsRecoveryStatus.OPEN,
                  OperationsRecoveryStatus.INVESTIGATING,
                  OperationsRecoveryStatus.DISPOSITION_SELECTED,
                ],
              },
            },
          });
          if (existingActive) {
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_ALREADY_ACTIVE',
              message: 'One active recovery already exists for this fulfillment',
            });
          }

          if (idemKey) {
            const racePrior = await tx.operationsRecovery.findFirst({
              where: {
                openedByActorId: actor.id,
                openIdempotencyKey: idemKey,
              },
            });
            if (racePrior) {
              if (racePrior.wkOrderId !== input.wkOrderId) {
                throw new ConflictException({
                  code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
                  message:
                    'Idempotency key already used for a different order by this actor',
                });
              }
              if (racePrior.openPayloadHash !== payloadHash) {
                throw new ConflictException({
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message: 'Idempotency key reused with different payload',
                });
              }
              return {
                code: 'OPERATIONS_RECOVERY_OPENED',
                idempotent: true,
                recovery: this.serializeRecovery(racePrior),
              };
            }
          }

          let sourceCaseId = input.sourceOperationalCaseId ?? null;
          let sourceAttemptId = input.sourceDeliveryAttemptId ?? null;
          if (!sourceCaseId) {
            const opCase = await tx.operationalCase.findFirst({
              where: {
                fulfillmentId: fulfillment.id,
                caseType: 'DELIVERY_FAILURE',
              },
              orderBy: { openedAt: 'desc' },
            });
            if (opCase) {
              sourceCaseId = opCase.id;
              sourceAttemptId = sourceAttemptId ?? opCase.deliveryAttemptId;
            }
          }

          const attemptBudgetExhausted =
            failedAttemptCount >= MAX_DELIVERY_ATTEMPTS;

          const id = randomUUID();
          const recovery = await tx.operationsRecovery.create({
            data: {
              id,
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              customerId: order.userId,
              merchantId: fulfillment.merchantId,
              openingTriggerCode: trigger,
              openedByActorType: actor.type,
              openedByActorId: actor.id,
              correlationId: input.correlationId.slice(0, 64),
              physicalCustodianRiderIdAtOpen:
                fulfillment.physicalCustodianRiderId,
              activeRiderIdAtOpen: fulfillment.activeRiderId,
              pendingCustodyIncomingRiderIdAtOpen:
                fulfillment.pendingCustodyIncomingRiderId,
              attemptBudgetExhausted,
              failedAttemptCountAtOpen: failedAttemptCount,
              sourceOperationalCaseId: sourceCaseId,
              sourceDeliveryAttemptId: sourceAttemptId,
              sourceRedeliveryAuthorizationId:
                input.sourceRedeliveryAuthorizationId ?? null,
              stage9DeterminationId: input.stage9DeterminationId ?? null,
              status: OperationsRecoveryStatus.OPEN,
              notes: input.notes?.slice(0, 2000) ?? null,
              openIdempotencyKey: idemKey,
              openPayloadHash: idemKey ? payloadHash : null,
            },
          });

          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.CASE_OPENED,
              fromStatus: null,
              toStatus: OperationsRecoveryStatus.OPEN,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.notes ?? null,
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                openingTriggerCode: trigger,
                attemptBudgetExhausted,
                failedAttemptCountAtOpen: failedAttemptCount,
              },
            },
          });

          await tx.orderDomainEvent.create({
            data: {
              eventId: randomUUID().replace(/-/g, '').slice(0, 64),
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: fulfillment.id,
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              actorId: actor.id,
              actorType: actor.type,
              action: 'OPERATIONS_RECOVERY_OPENED',
              previousState: null,
              newState: OperationsRecoveryStatus.OPEN,
              reason: trigger,
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                operationsRecoveryId: recovery.id,
                openingTriggerCode: trigger,
              },
            },
          });

          return {
            code: 'OPERATIONS_RECOVERY_OPENED',
            idempotent: false,
            recovery: this.serializeRecovery(recovery),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── startInvestigation ─────────────────────────────────

  async startInvestigation(input: {
    recoveryId: string;
    actorUserId: string;
    correlationId?: string;
    reason?: string;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          await this.lockOrderAndFulfillment(tx, loaded.wkOrderId);
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          if (recovery.status === OperationsRecoveryStatus.INVESTIGATING) {
            return {
              code: 'OPERATIONS_RECOVERY_INVESTIGATING',
              idempotent: true,
              recovery: this.serializeRecovery(recovery),
            };
          }
          if (recovery.status !== OperationsRecoveryStatus.OPEN) {
            throw new ConflictException({
              code: 'INVALID_OPERATIONS_RECOVERY_STATE',
              message: 'Investigation can only start from OPEN',
            });
          }
          const updated = await tx.operationsRecovery.update({
            where: { id: recovery.id },
            data: { status: OperationsRecoveryStatus.INVESTIGATING },
          });
          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.INVESTIGATION_STARTED,
              fromStatus: OperationsRecoveryStatus.OPEN,
              toStatus: OperationsRecoveryStatus.INVESTIGATING,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.reason ?? null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });
          return {
            code: 'OPERATIONS_RECOVERY_INVESTIGATING',
            idempotent: false,
            recovery: this.serializeRecovery(updated),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── addEvidence ────────────────────────────────────────

  async addEvidence(input: {
    recoveryId: string;
    actorUserId: string;
    evidenceKind: OperationsRecoveryEvidenceKind | string;
    notes?: string;
    storageReference?: string;
    contentHash?: string;
    contentType?: string;
    supersedesEvidenceId?: string;
    correlationId?: string;
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const kind = input.evidenceKind as OperationsRecoveryEvidenceKind;
    if (!Object.values(OperationsRecoveryEvidenceKind).includes(kind)) {
      throw new BadRequestException({
        code: 'OPERATIONS_RECOVERY_EVIDENCE_KIND_INVALID',
        message: 'Invalid evidenceKind',
      });
    }
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'addEvidence',
      kind,
      notes: input.notes ?? null,
      storageReference: input.storageReference ?? null,
      supersedesEvidenceId: input.supersedesEvidenceId ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.operationsRecoveryEvidence.findFirst({
        where: {
          submittedByActorId: actor.id,
          idempotencyKey: idemKey,
        },
      });
      if (prior) {
        const parent = await this.prisma.operationsRecovery.findUnique({
          where: { id: prior.operationsRecoveryId },
        });
        if (!parent || parent.id !== input.recoveryId) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
            message: 'Evidence idempotency key scoped to another recovery',
          });
        }
        if (prior.payloadHash !== payloadHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'OPERATIONS_RECOVERY_EVIDENCE_ADDED',
          idempotent: true,
          evidenceId: prior.id,
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          await this.lockOrderAndFulfillment(tx, loaded.wkOrderId);
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          this.assertActive(recovery);

          const evidenceId = randomUUID();
          await tx.operationsRecoveryEvidence.create({
            data: {
              id: evidenceId,
              operationsRecoveryId: recovery.id,
              evidenceKind: kind,
              storageReference: input.storageReference?.slice(0, 1000) ?? null,
              contentHash: input.contentHash?.slice(0, 64) ?? null,
              contentType: input.contentType?.slice(0, 120) ?? null,
              notes: input.notes?.slice(0, 2000) ?? null,
              metadata: input.metadata ?? undefined,
              supersedesEvidenceId: input.supersedesEvidenceId ?? null,
              submittedByActorType: actor.type,
              submittedByActorId: actor.id,
              idempotencyKey: idemKey,
              payloadHash: idemKey ? payloadHash : null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });
          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.EVIDENCE_ADDED,
              fromStatus: recovery.status,
              toStatus: recovery.status,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.notes ?? null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
              metadata: { evidenceId, evidenceKind: kind },
            },
          });
          return {
            code: 'OPERATIONS_RECOVERY_EVIDENCE_ADDED',
            idempotent: false,
            evidenceId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── addVerification ────────────────────────────────────

  async addVerification(input: {
    recoveryId: string;
    actorUserId: string;
    verificationCode: OperationsRecoveryVerificationCode | string;
    notes?: string;
    correlationId?: string;
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const code = input.verificationCode as OperationsRecoveryVerificationCode;
    if (!Object.values(OperationsRecoveryVerificationCode).includes(code)) {
      throw new BadRequestException({
        code: 'OPERATIONS_RECOVERY_VERIFICATION_INVALID',
        message: 'Invalid verificationCode',
      });
    }
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'addVerification',
      code,
      notes: input.notes ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.operationsRecoveryVerification.findFirst({
        where: {
          verifiedByActorId: actor.id,
          idempotencyKey: idemKey,
        },
      });
      if (prior) {
        if (prior.operationsRecoveryId !== input.recoveryId) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
            message: 'Verification idempotency key scoped to another recovery',
          });
        }
        if (prior.payloadHash !== payloadHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'OPERATIONS_RECOVERY_VERIFICATION_RECORDED',
          idempotent: true,
          verificationId: prior.id,
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          await this.lockOrderAndFulfillment(tx, loaded.wkOrderId);
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          this.assertActive(recovery);

          const verificationId = randomUUID();
          await tx.operationsRecoveryVerification.create({
            data: {
              id: verificationId,
              operationsRecoveryId: recovery.id,
              verificationCode: code,
              notes: input.notes?.slice(0, 2000) ?? null,
              metadata: input.metadata ?? undefined,
              verifiedByActorType: actor.type,
              verifiedByActorId: actor.id,
              idempotencyKey: idemKey,
              payloadHash: idemKey ? payloadHash : null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });
          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.VERIFICATION_RECORDED,
              fromStatus: recovery.status,
              toStatus: recovery.status,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.notes ?? null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
              metadata: { verificationId, verificationCode: code },
            },
          });
          return {
            code: 'OPERATIONS_RECOVERY_VERIFICATION_RECORDED',
            idempotent: false,
            verificationId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── selectDisposition ──────────────────────────────────

  async selectDisposition(input: {
    recoveryId: string;
    actorUserId: string;
    disposition: OperationsRecoveryDisposition | string;
    reason: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    if (!input.reason?.trim() || !input.correlationId?.trim()) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }
    const actor = await this.requireAdmin(input.actorUserId);
    const disposition = input.disposition as OperationsRecoveryDisposition;
    if (!Object.values(OperationsRecoveryDisposition).includes(disposition)) {
      throw new BadRequestException({
        code: 'OPERATIONS_RECOVERY_DISPOSITION_INVALID',
        message: 'Invalid disposition',
      });
    }
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'selectDisposition',
      disposition,
      reason: input.reason,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          await this.lockOrderAndFulfillment(tx, loaded.wkOrderId);
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          this.assertActive(recovery);

          if (
            idemKey &&
            recovery.dispositionIdempotencyKey === idemKey &&
            recovery.dispositionPayloadHash === payloadHash &&
            recovery.currentDisposition === disposition
          ) {
            return {
              code: 'OPERATIONS_RECOVERY_DISPOSITION_SELECTED',
              idempotent: true,
              recovery: this.serializeRecovery(recovery),
            };
          }
          if (
            idemKey &&
            recovery.dispositionIdempotencyKey === idemKey &&
            recovery.dispositionPayloadHash !== payloadHash
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
              message: 'Idempotency key reused with different payload',
            });
          }

          if (
            recovery.status !== OperationsRecoveryStatus.INVESTIGATING &&
            recovery.status !== OperationsRecoveryStatus.DISPOSITION_SELECTED
          ) {
            throw new ConflictException({
              code: 'INVALID_OPERATIONS_RECOVERY_STATE',
              message:
                'Disposition requires INVESTIGATING (or re-select while DISPOSITION_SELECTED)',
            });
          }

          const fromStatus = recovery.status;
          const updated = await tx.operationsRecovery.update({
            where: { id: recovery.id },
            data: {
              status: OperationsRecoveryStatus.DISPOSITION_SELECTED,
              currentDisposition: disposition,
              dispositionIdempotencyKey: idemKey,
              dispositionPayloadHash: idemKey ? payloadHash : null,
            },
          });
          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.DISPOSITION_SELECTED,
              fromStatus,
              toStatus: OperationsRecoveryStatus.DISPOSITION_SELECTED,
              disposition,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.reason.slice(0, 2000),
              correlationId: input.correlationId.slice(0, 64),
            },
          });
          return {
            code: 'OPERATIONS_RECOVERY_DISPOSITION_SELECTED',
            idempotent: false,
            recovery: this.serializeRecovery(updated),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── clearPendingCustodyTransferIntent ──────────────────

  async clearPendingCustodyTransferIntent(input: {
    recoveryId: string;
    actorUserId: string;
    reason: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    if (!input.reason?.trim() || !input.correlationId?.trim()) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }
    const actor = await this.requireAdmin(input.actorUserId);
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'clearPendingCustodyTransferIntent',
      reason: input.reason,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          const { fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            loaded.wkOrderId,
          );
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          this.assertActive(recovery);

          if (
            recovery.currentDisposition !==
            OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER
          ) {
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_DISPOSITION_REQUIRED',
              message:
                'clearPendingCustodyTransferIntent requires CLEAR_PENDING_CUSTODY_TRANSFER disposition',
            });
          }

          if (
            idemKey &&
            recovery.clearPendingIdempotencyKey === idemKey &&
            recovery.clearPendingPayloadHash === payloadHash
          ) {
            return {
              code: 'PENDING_CUSTODY_TRANSFER_CLEARED',
              idempotent: true,
              physicalCustodianRiderId: fulfillment.physicalCustodianRiderId,
              pendingCustodyIncomingRiderId:
                fulfillment.pendingCustodyIncomingRiderId,
            };
          }
          if (
            idemKey &&
            recovery.clearPendingIdempotencyKey === idemKey &&
            recovery.clearPendingPayloadHash !== payloadHash
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
              message: 'Idempotency key reused with different payload',
            });
          }

          const beforePending = {
            pendingCustodyIncomingRiderId:
              fulfillment.pendingCustodyIncomingRiderId,
            pendingCustodyFromAssignmentVersion:
              fulfillment.pendingCustodyFromAssignmentVersion,
            pendingCustodyRequestedAt: fulfillment.pendingCustodyRequestedAt,
          };

          if (fulfillment.pendingCustodyIncomingRiderId == null) {
            // Idempotent no-op clear when already null (after prior clear).
            await tx.operationsRecovery.update({
              where: { id: recovery.id },
              data: {
                clearPendingIdempotencyKey: idemKey,
                clearPendingPayloadHash: idemKey ? payloadHash : null,
              },
            });
            return {
              code: 'PENDING_CUSTODY_TRANSFER_CLEARED',
              idempotent: true,
              physicalCustodianRiderId: fulfillment.physicalCustodianRiderId,
              pendingCustodyIncomingRiderId: null,
            };
          }

          const custodianBefore = fulfillment.physicalCustodianRiderId;

          await tx.orderFulfillment.update({
            where: { id: fulfillment.id },
            data: {
              pendingCustodyIncomingRiderId: null,
              pendingCustodyFromAssignmentVersion: null,
              pendingCustodyRequestedAt: null,
            },
          });

          const after = await tx.orderFulfillment.findUnique({
            where: { id: fulfillment.id },
          });
          if (!after || after.physicalCustodianRiderId !== custodianBefore) {
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_CUSTODIAN_MUTATED',
              message: 'Physical custodian must be preserved during pending clear',
            });
          }

          await tx.operationsRecovery.update({
            where: { id: recovery.id },
            data: {
              clearPendingIdempotencyKey: idemKey,
              clearPendingPayloadHash: idemKey ? payloadHash : null,
            },
          });

          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.PENDING_CUSTODY_CLEARED,
              fromStatus: recovery.status,
              toStatus: recovery.status,
              disposition:
                OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.reason.slice(0, 2000),
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                before: beforePending,
                after: {
                  pendingCustodyIncomingRiderId: null,
                  pendingCustodyFromAssignmentVersion: null,
                  pendingCustodyRequestedAt: null,
                },
                physicalCustodianRiderId: custodianBefore,
              },
            },
          });

          await tx.orderDomainEvent.create({
            data: {
              eventId: randomUUID().replace(/-/g, '').slice(0, 64),
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: fulfillment.id,
              wkOrderId: recovery.wkOrderId,
              fulfillmentId: fulfillment.id,
              actorId: actor.id,
              actorType: actor.type,
              action: 'PENDING_CUSTODY_TRANSFER_INTENT_CLEARED',
              previousState: beforePending.pendingCustodyIncomingRiderId,
              newState: null,
              reason: input.reason.slice(0, 255),
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                operationsRecoveryId: recovery.id,
                before: beforePending,
                after: {
                  pendingCustodyIncomingRiderId: null,
                },
                physicalCustodianRiderId: custodianBefore,
              },
            },
          });

          return {
            code: 'PENDING_CUSTODY_TRANSFER_CLEARED',
            idempotent: false,
            physicalCustodianRiderId: custodianBefore,
            pendingCustodyIncomingRiderId: null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── close ──────────────────────────────────────────────

  async close(input: {
    recoveryId: string;
    actorUserId: string;
    reason?: string;
    correlationId: string;
    explicitConclusionAcknowledged?: boolean;
    idempotencyKey?: string;
  }) {
    if (!input.correlationId?.trim()) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'correlationId is required',
      });
    }
    const actor = await this.requireAdmin(input.actorUserId);
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'close',
      reason: input.reason ?? null,
      explicitConclusionAcknowledged:
        input.explicitConclusionAcknowledged === true,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          const { fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            loaded.wkOrderId,
          );
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }

          if (recovery.status === OperationsRecoveryStatus.CLOSED) {
            if (
              idemKey &&
              recovery.closeIdempotencyKey === idemKey &&
              recovery.closePayloadHash === payloadHash
            ) {
              return {
                code: 'OPERATIONS_RECOVERY_CLOSED',
                idempotent: true,
                recovery: this.serializeRecovery(recovery),
              };
            }
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_TERMINAL',
              message: 'Recovery already CLOSED',
            });
          }
          this.assertActive(recovery);

          if (
            recovery.status !==
              OperationsRecoveryStatus.DISPOSITION_SELECTED ||
            !recovery.currentDisposition
          ) {
            throw new ConflictException({
              code: 'INVALID_OPERATIONS_RECOVERY_STATE',
              message: 'Close requires DISPOSITION_SELECTED',
            });
          }

          if (
            idemKey &&
            recovery.closeIdempotencyKey === idemKey &&
            recovery.closePayloadHash !== payloadHash
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
              message: 'Idempotency key reused with different payload',
            });
          }

          const hasPendingCleared =
            (await tx.operationsRecoveryEvent.count({
              where: {
                operationsRecoveryId: recovery.id,
                eventType:
                  OperationsRecoveryEventType.PENDING_CUSTODY_CLEARED,
              },
            })) > 0;
          const hasContactEvidence =
            (await tx.operationsRecoveryEvidence.count({
              where: {
                operationsRecoveryId: recovery.id,
                evidenceKind: { in: CONTACT_EVIDENCE_KINDS },
              },
            })) > 0;
          const hasCustodyVerification =
            (await tx.operationsRecoveryVerification.count({
              where: {
                operationsRecoveryId: recovery.id,
                verificationCode: {
                  in: CUSTODY_INVESTIGATION_VERIFICATION_CODES,
                },
              },
            })) > 0;
          const hasReturnReceived = await this.hasReturnReceived(
            tx,
            fulfillment.id,
          );

          const policy = evaluateClosurePolicy({
            disposition: recovery.currentDisposition,
            pendingCustodyIncomingRiderId:
              fulfillment.pendingCustodyIncomingRiderId,
            hasPendingCustodyClearedEvent: hasPendingCleared,
            hasContactEvidence,
            hasCustodyInvestigationVerification: hasCustodyVerification,
            hasReturnReceived,
            closeReason: input.reason,
            explicitConclusionAcknowledged:
              input.explicitConclusionAcknowledged === true,
          });
          if (!policy.ok) {
            throw new ForbiddenException({
              code: policy.code,
              message: policy.message,
            });
          }

          const updated = await tx.operationsRecovery.update({
            where: { id: recovery.id },
            data: {
              status: OperationsRecoveryStatus.CLOSED,
              closedAt: new Date(),
              closedByActorType: actor.type,
              closedByActorId: actor.id,
              closeReason: input.reason?.slice(0, 2000) ?? null,
              closeIdempotencyKey: idemKey,
              closePayloadHash: idemKey ? payloadHash : null,
            },
          });

          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.CLOSED,
              fromStatus: recovery.status,
              toStatus: OperationsRecoveryStatus.CLOSED,
              disposition: recovery.currentDisposition,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.reason?.slice(0, 2000) ?? null,
              correlationId: input.correlationId.slice(0, 64),
            },
          });

          await tx.orderDomainEvent.create({
            data: {
              eventId: randomUUID().replace(/-/g, '').slice(0, 64),
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: fulfillment.id,
              wkOrderId: recovery.wkOrderId,
              fulfillmentId: fulfillment.id,
              actorId: actor.id,
              actorType: actor.type,
              action: 'OPERATIONS_RECOVERY_CLOSED',
              previousState: recovery.status,
              newState: OperationsRecoveryStatus.CLOSED,
              reason: recovery.currentDisposition,
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                operationsRecoveryId: recovery.id,
                disposition: recovery.currentDisposition,
              },
            },
          });

          return {
            code: 'OPERATIONS_RECOVERY_CLOSED',
            idempotent: false,
            recovery: this.serializeRecovery(updated),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── cancel ─────────────────────────────────────────────

  async cancel(input: {
    recoveryId: string;
    actorUserId: string;
    reason: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    if (!input.reason?.trim() || !input.correlationId?.trim()) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }
    const actor = await this.requireAdmin(input.actorUserId);
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      recoveryId: input.recoveryId,
      action: 'cancel',
      reason: input.reason,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const loaded = await tx.operationsRecovery.findUnique({
            where: { id: input.recoveryId },
          });
          if (!loaded) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }
          await this.lockOrderAndFulfillment(tx, loaded.wkOrderId);
          const recovery = await this.lockRecovery(tx, input.recoveryId);
          if (!recovery) {
            throw new NotFoundException({
              code: 'OPERATIONS_RECOVERY_NOT_FOUND',
              message: 'Recovery not found',
            });
          }

          if (recovery.status === OperationsRecoveryStatus.CANCELLED) {
            if (
              idemKey &&
              recovery.cancelIdempotencyKey === idemKey &&
              recovery.cancelPayloadHash === payloadHash
            ) {
              return {
                code: 'OPERATIONS_RECOVERY_CANCELLED',
                idempotent: true,
                recovery: this.serializeRecovery(recovery),
              };
            }
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_TERMINAL',
              message: 'Recovery already CANCELLED',
            });
          }
          if (recovery.status === OperationsRecoveryStatus.CLOSED) {
            throw new ConflictException({
              code: 'OPERATIONS_RECOVERY_TERMINAL',
              message: 'CLOSED recovery cannot be cancelled',
            });
          }

          // Approved cancel condition: no Stage 11 irreversible physical claim.
          // Pending clear is administrative intent-only (not custody proof); cancel
          // remains allowed after clear. Fabricated custody events are never emitted.
          const updated = await tx.operationsRecovery.update({
            where: { id: recovery.id },
            data: {
              status: OperationsRecoveryStatus.CANCELLED,
              cancelledAt: new Date(),
              cancelledByActorType: actor.type,
              cancelledByActorId: actor.id,
              cancelReason: input.reason.slice(0, 2000),
              cancelIdempotencyKey: idemKey,
              cancelPayloadHash: idemKey ? payloadHash : null,
            },
          });
          await tx.operationsRecoveryEvent.create({
            data: {
              id: randomUUID(),
              operationsRecoveryId: recovery.id,
              eventType: OperationsRecoveryEventType.CANCELLED,
              fromStatus: recovery.status,
              toStatus: OperationsRecoveryStatus.CANCELLED,
              actorType: actor.type,
              actorId: actor.id,
              reason: input.reason.slice(0, 2000),
              correlationId: input.correlationId.slice(0, 64),
            },
          });
          return {
            code: 'OPERATIONS_RECOVERY_CANCELLED',
            idempotent: false,
            recovery: this.serializeRecovery(updated),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── get / list ─────────────────────────────────────────

  async getById(recoveryId: string, actorUserId: string) {
    const recovery = await this.prisma.operationsRecovery.findUnique({
      where: { id: recoveryId },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
        verifications: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!recovery) {
      throw new NotFoundException({
        code: 'OPERATIONS_RECOVERY_NOT_FOUND',
        message: 'Recovery not found',
      });
    }
    const viewer = await this.resolveViewer(recovery.wkOrderId, actorUserId);
    if (viewer === 'DENIED') {
      throw new ForbiddenException({
        code: 'OPERATIONS_RECOVERY_FORBIDDEN',
        message: 'Not authorized',
      });
    }
    if (viewer === 'ADMIN') {
      return { code: 'OPERATIONS_RECOVERY', recovery };
    }
    return {
      code: 'OPERATIONS_RECOVERY',
      recovery: this.minimalRecovery(recovery),
    };
  }

  async listForOrder(wkOrderId: number, actorUserId: string) {
    const viewer = await this.resolveViewer(wkOrderId, actorUserId);
    if (viewer === 'DENIED') {
      throw new ForbiddenException({
        code: 'OPERATIONS_RECOVERY_FORBIDDEN',
        message: 'Not authorized',
      });
    }
    const rows = await this.prisma.operationsRecovery.findMany({
      where: { wkOrderId },
      orderBy: { createdAt: 'desc' },
      include:
        viewer === 'ADMIN'
          ? {
              events: { orderBy: { createdAt: 'asc' } },
              evidence: { orderBy: { createdAt: 'asc' } },
              verifications: { orderBy: { createdAt: 'asc' } },
            }
          : undefined,
    });
    if (viewer === 'ADMIN') {
      return { code: 'OPERATIONS_RECOVERIES', recoveries: rows };
    }
    return {
      code: 'OPERATIONS_RECOVERIES',
      recoveries: rows.map((r) => this.minimalRecovery(r)),
    };
  }

  private async resolveViewer(
    wkOrderId: number,
    actorUserId: string,
  ): Promise<'ADMIN' | 'PARTY' | 'DENIED'> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!user) return 'DENIED';
    if (user.role === UserRole.admin || user.role === UserRole.staff) {
      return 'ADMIN';
    }
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: { fulfillment: true },
    });
    if (!order) return 'DENIED';
    if (order.userId === actorUserId) return 'PARTY';
    if (order.fulfillment?.activeRiderId === actorUserId) return 'PARTY';
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: order.merchantId },
    });
    if (merchant?.userId === actorUserId) return 'PARTY';
    return 'DENIED';
  }
}
