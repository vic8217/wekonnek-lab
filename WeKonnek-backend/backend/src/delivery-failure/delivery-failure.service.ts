import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerDeliveryHandoffTokenStatus,
  DeliveryAttemptCustomerResponse,
  DeliveryAttemptEvidenceKind,
  DeliveryAttemptLocationProvenance,
  DeliveryAttemptOutcome,
  DeliveryFailureReasonCode,
  FulfillmentStatus,
  OperationalCaseEventType,
  OperationalCaseStatus,
  OperationalCaseType,
  OperationalDisposition,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuthActorService } from '../fulfillment/auth-actor.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_DELIVERY_ATTEMPTS } from '../redelivery/redelivery.policy';

const FAILURE_REASON_CODES = new Set<string>(
  Object.values(DeliveryFailureReasonCode),
);

const CUSTOMER_RESPONSES = new Set<string>(
  Object.values(DeliveryAttemptCustomerResponse),
);

const EVIDENCE_KINDS = new Set<string>(
  Object.values(DeliveryAttemptEvidenceKind),
);

const DISPOSITIONS = new Set<string>(Object.values(OperationalDisposition));

export type DeliveryFailureEvidenceInput = {
  evidenceKind: DeliveryAttemptEvidenceKind | string;
  storageReference?: string;
  contentHash?: string;
  contentType?: string;
  sizeBytes?: number;
  agreementEvidenceId?: string;
  metadata?: Record<string, unknown>;
};

function stablePayloadHash(parts: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex');
}

@Injectable()
export class DeliveryFailureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly authActors: AuthActorService,
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

  async reportFailure(input: {
    wkOrderId: number;
    actorUserId: string;
    riderId?: string;
    failureReasonCode: DeliveryFailureReasonCode | string;
    customerResponse?: DeliveryAttemptCustomerResponse | string;
    notes?: string;
    occurredAt?: string | Date;
    correlationId?: string;
    idempotencyKey?: string;
    locationLatitude?: string | number;
    locationLongitude?: string | number;
    locationProvenance?: DeliveryAttemptLocationProvenance | string;
    evidences?: DeliveryFailureEvidenceInput[];
  }) {
    if (input.riderId && input.riderId !== input.actorUserId) {
      throw new ForbiddenException({
        code: 'RIDER_SPOOF_REJECTED',
        message: 'Rider identity is derived from authentication',
      });
    }

    const reason = String(input.failureReasonCode ?? '');
    if (!FAILURE_REASON_CODES.has(reason)) {
      throw new BadRequestException({
        code: 'INVALID_FAILURE_REASON',
        message: 'Unknown delivery failure reason code',
      });
    }
    const notes = input.notes != null ? String(input.notes).trim() : '';
    if (reason === DeliveryFailureReasonCode.OTHER && !notes) {
      throw new ForbiddenException({
        code: 'DELIVERY_FAILURE_NOTES_REQUIRED',
        message: 'Notes are required when failureReasonCode is OTHER',
      });
    }

    const customerResponseRaw = String(
      input.customerResponse ?? DeliveryAttemptCustomerResponse.NONE,
    );
    if (!CUSTOMER_RESPONSES.has(customerResponseRaw)) {
      throw new BadRequestException({
        code: 'INVALID_CUSTOMER_RESPONSE',
        message: 'Unknown customerResponse value',
      });
    }
    const customerResponse =
      customerResponseRaw as DeliveryAttemptCustomerResponse;

    const hasLat = input.locationLatitude != null && input.locationLatitude !== '';
    const hasLng =
      input.locationLongitude != null && input.locationLongitude !== '';
    if (hasLat !== hasLng) {
      throw new BadRequestException({
        code: 'INVALID_LOCATION',
        message: 'locationLatitude and locationLongitude must be provided together',
      });
    }
    let locationProvenance: DeliveryAttemptLocationProvenance | null = null;
    if (hasLat && hasLng) {
      const prov = String(
        input.locationProvenance ??
          DeliveryAttemptLocationProvenance.RIDER_DEVICE_REPORTED,
      );
      if (prov !== DeliveryAttemptLocationProvenance.RIDER_DEVICE_REPORTED) {
        throw new BadRequestException({
          code: 'INVALID_LOCATION_PROVENANCE',
          message: 'Only RIDER_DEVICE_REPORTED location provenance is supported',
        });
      }
      locationProvenance = DeliveryAttemptLocationProvenance.RIDER_DEVICE_REPORTED;
    }

    const evidences = input.evidences ?? [];
    for (const ev of evidences) {
      if (!EVIDENCE_KINDS.has(String(ev.evidenceKind))) {
        throw new BadRequestException({
          code: 'INVALID_EVIDENCE_KIND',
          message: 'Unknown evidenceKind',
        });
      }
    }

    const payloadHash = stablePayloadHash({
      // Idempotency is scoped to the target marketplace order as well as the
      // rider's failure payload; never reuse a cached attempt cross-order.
      wkOrderId: input.wkOrderId,
      failureReasonCode: reason,
      customerResponse,
      notes: notes || null,
      occurredAt:
        input.occurredAt instanceof Date
          ? input.occurredAt.toISOString()
          : input.occurredAt ?? null,
      locationLatitude: hasLat ? String(input.locationLatitude) : null,
      locationLongitude: hasLng ? String(input.locationLongitude) : null,
      locationProvenance,
      evidences: evidences.map((e) => ({
        evidenceKind: e.evidenceKind,
        storageReference: e.storageReference ?? null,
        contentHash: e.contentHash ?? null,
        contentType: e.contentType ?? null,
        sizeBytes: e.sizeBytes ?? null,
        agreementEvidenceId: e.agreementEvidenceId ?? null,
      })),
    });

    const idempotencyKey = input.idempotencyKey
      ? String(input.idempotencyKey).slice(0, 64)
      : undefined;

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
          if (!fulfillment || fulfillment.wkOrderId == null) {
            throw new ForbiddenException({
              code: 'FULFILLMENT_MISSING',
              message: 'Marketplace fulfillment required',
            });
          }

          await tx.$queryRaw`
            SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
          `;
          const locked = await tx.orderFulfillment.findUniqueOrThrow({
            where: { id: fulfillment.id },
          });

          if (idempotencyKey) {
            const prior = await tx.deliveryAttempt.findFirst({
              where: {
                reportedByActorId: input.actorUserId,
                idempotencyKey,
              },
              include: {
                operationalCase: true,
                evidences: true,
              },
            });
            if (prior) {
              if (prior.requestPayloadHash !== payloadHash) {
                throw new ForbiddenException({
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message:
                    'Idempotency key was already used with a different payload',
                });
              }
              return {
                code: 'DELIVERY_FAILURE_RECORDED' as const,
                idempotent: true,
                attempt: prior,
                case: prior.operationalCase,
              };
            }
          }

          if (locked.status !== FulfillmentStatus.in_transit) {
            if (locked.status === FulfillmentStatus.delivery_failed) {
              throw new ForbiddenException({
                code: 'ATTEMPT_ALREADY_RECORDED',
                message: 'Delivery failure already recorded for this fulfillment',
              });
            }
            throw new ForbiddenException({
              code: 'INVALID_FULFILLMENT_STATE',
              message: 'Fulfillment must be in_transit to report delivery failure',
            });
          }

          if (locked.activeRiderId !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'NOT_ACTIVE_RIDER',
              message: 'Only the active rider may report delivery failure',
            });
          }
          const custodian =
            locked.physicalCustodianRiderId ?? locked.activeRiderId;
          if (custodian !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'NOT_PHYSICAL_CUSTODIAN',
              message:
                'Only the physical custodian rider may report delivery failure',
            });
          }
          if (locked.pendingCustodyIncomingRiderId) {
            throw new ForbiddenException({
              code: 'CUSTODY_TRANSFER_PENDING',
              message:
                'Cannot report delivery failure while rider custody transfer is pending',
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
              code: 'NOT_ACTIVE_RIDER',
              message: 'Active assignment matching assignmentVersion required',
            });
          }

          const maxRow = await tx.deliveryAttempt.aggregate({
            where: { fulfillmentId: locked.id },
            _max: { attemptNumber: true },
          });
          const attemptNumber = (maxRow._max.attemptNumber ?? 0) + 1;
          const attemptId = randomUUID();
          const caseId = randomUUID();
          const now = new Date();
          const occurredAt = input.occurredAt
            ? new Date(input.occurredAt)
            : now;

          const attempt = await tx.deliveryAttempt.create({
            data: {
              id: attemptId,
              wkOrderId: order.id,
              fulfillmentId: locked.id,
              attemptNumber,
              riderId: input.actorUserId,
              riderAssignmentId: assignment.id,
              assignmentVersion: locked.assignmentVersion,
              physicalCustodianRiderId: custodian,
              outcome: DeliveryAttemptOutcome.FAILED,
              failureReasonCode: reason as DeliveryFailureReasonCode,
              customerResponse,
              occurredAt,
              reportedAt: now,
              reportedByActorType: 'RIDER',
              reportedByActorId: input.actorUserId,
              notes: notes || null,
              correlationId: input.correlationId,
              idempotencyKey,
              requestPayloadHash: payloadHash,
              locationLatitude: hasLat
                ? new Prisma.Decimal(String(input.locationLatitude))
                : null,
              locationLongitude: hasLng
                ? new Prisma.Decimal(String(input.locationLongitude))
                : null,
              locationProvenance,
            },
          });

          if (evidences.length) {
            await tx.deliveryAttemptEvidence.createMany({
              data: evidences.map((e) => ({
                id: randomUUID(),
                deliveryAttemptId: attemptId,
                evidenceKind: e.evidenceKind as DeliveryAttemptEvidenceKind,
                storageReference: e.storageReference ?? null,
                contentHash: e.contentHash ?? null,
                contentType: e.contentType ?? null,
                sizeBytes: e.sizeBytes ?? null,
                agreementEvidenceId: e.agreementEvidenceId ?? null,
                metadata: {
                  ...(e.metadata ?? {}),
                  reportedBy: 'RIDER',
                  customerResponseProvenance: 'RIDER_REPORTED',
                },
                submittedBy: input.actorUserId,
              })),
            });
          }

          const opCase = await tx.operationalCase.create({
            data: {
              id: caseId,
              wkOrderId: order.id,
              fulfillmentId: locked.id,
              deliveryAttemptId: attemptId,
              caseType: OperationalCaseType.DELIVERY_FAILURE,
              status: OperationalCaseStatus.OPEN,
              openedAt: now,
              openedByActorType: 'RIDER',
              openedByActorId: input.actorUserId,
              correlationId: input.correlationId,
            },
          });

          await tx.operationalCaseEvent.create({
            data: {
              id: randomUUID(),
              operationalCaseId: caseId,
              eventType: OperationalCaseEventType.CASE_OPENED,
              fromStatus: null,
              toStatus: OperationalCaseStatus.OPEN,
              actorType: 'RIDER',
              actorId: input.actorUserId,
              reason: `stage8_delivery_failure:${reason}`,
              correlationId: input.correlationId,
              metadata: {
                deliveryAttemptId: attemptId,
                failureReasonCode: reason,
                customerResponse,
                customerResponseProvenance: 'RIDER_REPORTED',
                reportedBy: 'RIDER',
              },
            },
          });

          await this.transitions.transitionInTx(
            tx,
            {
              fulfillmentId: locked.id,
              targetStatus: 'delivery_failed',
              actor: {
                id: input.actorUserId,
                type: 'INTERNAL_SERVICE',
              },
              reason: 'stage8_delivery_failure',
              correlationId: input.correlationId,
            },
            'delivery_failed',
          );

          // Stage 10: revoke ACTIVE Stage 5A delivery tokens on failure.
          const activeTokens = await tx.customerDeliveryHandoffToken.findMany({
            where: {
              fulfillmentId: locked.id,
              status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
            },
          });
          for (const token of activeTokens) {
            await tx.customerDeliveryHandoffToken.update({
              where: { id: token.id },
              data: {
                status: CustomerDeliveryHandoffTokenStatus.REVOKED,
                revokedAt: now,
                revokeReason: 'stage8_delivery_failure',
              },
            });
          }

          // After attempt MAX failed → ops recovery required on the case.
          if (attemptNumber >= MAX_DELIVERY_ATTEMPTS) {
            await tx.operationalCase.update({
              where: { id: caseId },
              data: {
                currentDisposition:
                  OperationalDisposition.OPERATIONS_RECOVERY_REQUIRED,
              },
            });
            await tx.operationalCaseEvent.create({
              data: {
                id: randomUUID(),
                operationalCaseId: caseId,
                eventType: OperationalCaseEventType.DISPOSITION_SELECTED,
                fromStatus: OperationalCaseStatus.OPEN,
                toStatus: OperationalCaseStatus.OPEN,
                disposition:
                  OperationalDisposition.OPERATIONS_RECOVERY_REQUIRED,
                actorType: 'INTERNAL_SERVICE',
                actorId: input.actorUserId,
                reason: 'stage10_redelivery_attempt_limit_reached',
                correlationId: input.correlationId,
                metadata: {
                  attemptNumber,
                  maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
                  code: 'REDELIVERY_ATTEMPT_LIMIT_REACHED',
                },
              },
            });
          }

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: locked.id,
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            actorId: input.actorUserId,
            actorType: 'RIDER',
            action: 'DELIVERY_ATTEMPT_FAILED',
            previousState: FulfillmentStatus.in_transit,
            newState: FulfillmentStatus.delivery_failed,
            reason: `stage8_delivery_failure:${reason}`,
            correlationId: input.correlationId,
            metadata: {
              deliveryAttemptId: attemptId,
              attemptNumber,
              failureReasonCode: reason,
              customerResponse,
              customerResponseProvenance: 'RIDER_REPORTED',
              operationalCaseId: caseId,
              deliveryTokensRevoked: activeTokens.length,
              attemptLimitReached: attemptNumber >= MAX_DELIVERY_ATTEMPTS,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: locked.id,
            wkOrderId: order.id,
            fulfillmentId: locked.id,
            actorId: input.actorUserId,
            actorType: 'RIDER',
            action: 'DELIVERY_FAILURE_CASE_OPENED',
            newState: OperationalCaseStatus.OPEN,
            reason: 'stage8_delivery_failure',
            correlationId: input.correlationId,
            metadata: {
              operationalCaseId: caseId,
              deliveryAttemptId: attemptId,
              caseType: OperationalCaseType.DELIVERY_FAILURE,
            },
          });

          const withEvidence = await tx.deliveryAttempt.findUniqueOrThrow({
            where: { id: attemptId },
            include: { evidences: true, operationalCase: true },
          });

          return {
            code: 'DELIVERY_FAILURE_RECORDED' as const,
            idempotent: false,
            attempt: withEvidence,
            case: withEvidence.operationalCase ?? opCase,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async selectDisposition(input: {
    caseId: string;
    actorUserId: string;
    disposition: OperationalDisposition | string;
    reason: string;
    correlationId: string;
  }) {
    const actor = await this.authActors.resolve({
      id: input.actorUserId,
      role: undefined,
    });
    if (actor.type !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only SYSTEM_ADMIN may select operational disposition',
      });
    }

    const reason = String(input.reason ?? '').trim();
    const correlationId = String(input.correlationId ?? '').trim();
    if (!reason || !correlationId) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }
    const disposition = String(input.disposition ?? '');
    if (!DISPOSITIONS.has(disposition)) {
      throw new BadRequestException({
        code: 'INVALID_DISPOSITION',
        message: 'Unknown operational disposition',
      });
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const opCase = await tx.operationalCase.findUnique({
            where: { id: input.caseId },
          });
          if (!opCase) throw new NotFoundException('Operational case not found');

          await tx.$queryRaw`
            SELECT id FROM "order_fulfillments" WHERE id = ${opCase.fulfillmentId}::uuid FOR UPDATE
          `;
          const lockedCase = await tx.operationalCase.findUniqueOrThrow({
            where: { id: input.caseId },
          });
          if (lockedCase.status !== OperationalCaseStatus.OPEN) {
            throw new ForbiddenException({
              code: 'INVALID_CASE_STATE',
              message: 'Disposition may only be selected while case is OPEN',
            });
          }

          const updated = await tx.operationalCase.update({
            where: { id: lockedCase.id },
            data: {
              status: OperationalCaseStatus.DISPOSITION_SELECTED,
              currentDisposition: disposition as OperationalDisposition,
            },
          });

          await tx.operationalCaseEvent.create({
            data: {
              id: randomUUID(),
              operationalCaseId: lockedCase.id,
              eventType: OperationalCaseEventType.DISPOSITION_SELECTED,
              fromStatus: OperationalCaseStatus.OPEN,
              toStatus: OperationalCaseStatus.DISPOSITION_SELECTED,
              disposition: disposition as OperationalDisposition,
              actorType: 'SYSTEM_ADMIN',
              actorId: input.actorUserId,
              reason,
              correlationId,
            },
          });

          let returnTransition: unknown = null;
          if (disposition === OperationalDisposition.RETURN_TO_MERCHANT) {
            const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
              where: { id: lockedCase.fulfillmentId },
            });
            if (fulfillment.status === FulfillmentStatus.delivery_failed) {
              returnTransition = await this.transitions.transitionInTx(
                tx,
                {
                  fulfillmentId: fulfillment.id,
                  targetStatus: 'returning',
                  actor: {
                    id: input.actorUserId,
                    type: 'INTERNAL_SERVICE',
                  },
                  reason: 'stage8_return_disposition',
                  correlationId,
                },
                'returning',
              );

              await this.events.record({
                tx,
                aggregateType: 'ORDER_FULFILLMENT',
                aggregateId: lockedCase.fulfillmentId,
                wkOrderId: lockedCase.wkOrderId,
                fulfillmentId: lockedCase.fulfillmentId,
                actorId: input.actorUserId,
                actorType: 'SYSTEM_ADMIN',
                action: 'RETURN_DISPOSITION_SELECTED',
                previousState: FulfillmentStatus.delivery_failed,
                newState: FulfillmentStatus.returning,
                reason,
                correlationId,
                metadata: {
                  operationalCaseId: lockedCase.id,
                  disposition,
                },
              });
            }
          }

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: lockedCase.fulfillmentId,
            wkOrderId: lockedCase.wkOrderId,
            fulfillmentId: lockedCase.fulfillmentId,
            actorId: input.actorUserId,
            actorType: 'SYSTEM_ADMIN',
            action: 'DELIVERY_FAILURE_DISPOSITION_SELECTED',
            previousState: OperationalCaseStatus.OPEN,
            newState: OperationalCaseStatus.DISPOSITION_SELECTED,
            reason,
            correlationId,
            metadata: {
              operationalCaseId: lockedCase.id,
              disposition,
              // RESCHEDULE_REQUESTED: record only — no auto return to in_transit
              rescheduleAutoRedelivery: false,
            },
          });

          return {
            code: 'DISPOSITION_SELECTED' as const,
            case: updated,
            returnTransition,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async resolveCase(input: {
    caseId: string;
    actorUserId: string;
    reason: string;
    correlationId: string;
  }) {
    const actor = await this.authActors.resolve({
      id: input.actorUserId,
    });
    if (actor.type !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only SYSTEM_ADMIN may resolve operational cases',
      });
    }

    const reason = String(input.reason ?? '').trim();
    const correlationId = String(input.correlationId ?? '').trim();
    if (!reason || !correlationId) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const opCase = await tx.operationalCase.findUnique({
            where: { id: input.caseId },
          });
          if (!opCase) throw new NotFoundException('Operational case not found');
          if (
            opCase.status === OperationalCaseStatus.RESOLVED ||
            opCase.status === OperationalCaseStatus.CANCELLED
          ) {
            throw new ForbiddenException({
              code: 'INVALID_CASE_STATE',
              message: 'Case is already terminal',
            });
          }

          const fromStatus = opCase.status;
          const now = new Date();
          const updated = await tx.operationalCase.update({
            where: { id: opCase.id },
            data: {
              status: OperationalCaseStatus.RESOLVED,
              resolvedAt: now,
              resolvedByActorType: 'SYSTEM_ADMIN',
              resolvedByActorId: input.actorUserId,
              resolutionReason: reason,
            },
          });

          await tx.operationalCaseEvent.create({
            data: {
              id: randomUUID(),
              operationalCaseId: opCase.id,
              eventType: OperationalCaseEventType.CASE_RESOLVED,
              fromStatus,
              toStatus: OperationalCaseStatus.RESOLVED,
              disposition: opCase.currentDisposition,
              actorType: 'SYSTEM_ADMIN',
              actorId: input.actorUserId,
              reason,
              correlationId,
              metadata: {
                // Does not fabricate custody, payment, or rider-advance mutations
                custodyUnchanged: true,
                paymentUnchanged: true,
                riderAdvanceUnchanged: true,
              },
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: opCase.fulfillmentId,
            wkOrderId: opCase.wkOrderId,
            fulfillmentId: opCase.fulfillmentId,
            actorId: input.actorUserId,
            actorType: 'SYSTEM_ADMIN',
            action: 'DELIVERY_FAILURE_CASE_RESOLVED',
            previousState: fromStatus,
            newState: OperationalCaseStatus.RESOLVED,
            reason,
            correlationId,
            metadata: { operationalCaseId: opCase.id },
          });

          return { code: 'CASE_RESOLVED' as const, case: updated };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async listAttempts(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    const role = await this.resolveViewerRole(order, fulfillment, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Not authorized to view delivery attempts',
      });
    }

    const attempts = await this.prisma.deliveryAttempt.findMany({
      where: { wkOrderId },
      orderBy: { attemptNumber: 'asc' },
      include: {
        evidences:
          role === 'ADMIN' || role === 'ACTIVE_RIDER'
            ? true
            : { select: { id: true, evidenceKind: true, createdAt: true } },
      },
    });

    if (role === 'ADMIN' || role === 'ACTIVE_RIDER') {
      return { orderId: wkOrderId, attempts };
    }
    // Customer / merchant: redact storage refs and precise location
    return {
      orderId: wkOrderId,
      attempts: attempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        outcome: a.outcome,
        failureReasonCode: a.failureReasonCode,
        customerResponse: a.customerResponse,
        occurredAt: a.occurredAt,
        reportedAt: a.reportedAt,
        notes: role === 'MERCHANT' ? a.notes : undefined,
        locationPresent:
          a.locationLatitude != null && a.locationLongitude != null,
        evidences: Array.isArray(a.evidences)
          ? a.evidences.map((e: { id: string; evidenceKind: string; createdAt: Date }) => ({
              id: e.id,
              evidenceKind: e.evidenceKind,
              createdAt: e.createdAt,
            }))
          : [],
      })),
    };
  }

  async getCase(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    const role = await this.resolveViewerRole(order, fulfillment, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Not authorized to view operational case',
      });
    }

    const opCase = await this.prisma.operationalCase.findFirst({
      where: {
        wkOrderId,
        caseType: OperationalCaseType.DELIVERY_FAILURE,
        status: {
          in: [
            OperationalCaseStatus.OPEN,
            OperationalCaseStatus.DISPOSITION_SELECTED,
            OperationalCaseStatus.RESOLVED,
          ],
        },
      },
      orderBy: { openedAt: 'desc' },
      include: {
        events: role === 'ADMIN',
        deliveryAttempt:
          role === 'ADMIN' || role === 'ACTIVE_RIDER'
            ? true
            : {
                select: {
                  id: true,
                  attemptNumber: true,
                  outcome: true,
                  failureReasonCode: true,
                  customerResponse: true,
                  occurredAt: true,
                },
              },
      },
    });

    return { orderId: wkOrderId, case: opCase };
  }

  private async resolveViewerRole(
    order: { id: number; userId: string; merchantId: number },
    fulfillment: { activeRiderId: string | null } | null,
    actorUserId: string,
  ): Promise<
    'CUSTOMER' | 'MERCHANT' | 'ACTIVE_RIDER' | 'ADMIN' | 'DENIED'
  > {
    if (actorUserId === order.userId) return 'CUSTOMER';
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (user?.role === UserRole.admin || user?.role === UserRole.staff) {
      return 'ADMIN';
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: order.merchantId,
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
    if (merchant) return 'MERCHANT';
    if (fulfillment?.activeRiderId === actorUserId) return 'ACTIVE_RIDER';
    // Also allow the reporting rider on attempts
    const reported = await this.prisma.deliveryAttempt.findFirst({
      where: { wkOrderId: order.id, riderId: actorUserId },
      select: { id: true },
    });
    if (reported) return 'ACTIVE_RIDER';
    return 'DENIED';
  }
}
