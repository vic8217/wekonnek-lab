import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementEvidenceType,
  Prisma,
  RiderAdvanceSettlementMethod,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

type RaRow = {
  id: string;
  wkOrderId: number;
  customerId: string;
  riderId: string;
  merchantId: number;
  agreementId: string;
  agreementVersionId: string;
  status: RiderAdvanceStatus;
  currency: string;
  reimbursementPrincipal: Prisma.Decimal | null;
  reimbursedAt: Date | null;
};

type SettlementRow = {
  id: string;
  riderAdvanceId: string;
  wkOrderId: number;
  customerId: string;
  creditorRiderId: string;
  method: RiderAdvanceSettlementMethod;
  status: RiderAdvanceSettlementStatus;
  currency: string;
  claimedAmount: Prisma.Decimal | null;
  acknowledgedAmount: Prisma.Decimal | null;
  externalReference: string | null;
  proofStorageReference: string | null;
  claimEvidenceId: string | null;
  ackEvidenceId: string | null;
  rejectionReason: string | null;
  claimedAt: Date | null;
  acknowledgedAt: Date | null;
  rejectedAt: Date | null;
  claimIdempotencyKey: string | null;
  ackIdempotencyKey: string | null;
  cashIdempotencyKey: string | null;
  rejectIdempotencyKey: string | null;
  payloadFingerprint: string | null;
  correlationId: string | null;
  createdAt: Date;
};

@Injectable()
export class RiderAdvanceSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
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

  /**
   * GET /orders/:orderId/rider-advance/reimbursement
   * Privacy-scoped summary. Delivery Rider B does not receive settlement detail.
   */
  async getReimbursementForOrder(wkOrderId: number, actorUserId: string) {
    const ra = await this.prisma.riderAdvance.findFirst({
      where: { wkOrderId, status: { not: RiderAdvanceStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ra) throw new NotFoundException('Rider Advance not found');

    const role = await this.resolveViewerRole(ra, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'REIMBURSEMENT_FORBIDDEN',
        message: 'Not authorized to view reimbursement for this order',
      });
    }

    const totals = await this.computeTotals(this.prisma, ra);
    const settlements = await this.prisma.riderAdvanceSettlement.findMany({
      where: { riderAdvanceId: ra.id },
      orderBy: { createdAt: 'asc' },
    });

    return this.toSummaryResponse(ra, totals, settlements, role);
  }

  /**
   * Customer creates DIRECT_TRANSFER claim. Does NOT reduce debt.
   */
  async createDirectTransferClaim(input: {
    riderAdvanceId: string;
    actorUserId: string;
    amount: string | number;
    externalReference?: string;
    proofStorageReference?: string;
    idempotencyKey?: string;
    correlationId?: string;
    // Spoof fields ignored:
    creditorRiderId?: string;
    customerId?: string;
    principal?: string | number;
    acknowledgedAmount?: string | number;
  }) {
    const claimed = MONEY(input.amount);
    if (claimed.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'claimedAmount must be positive',
      });
    }

    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvanceSettlement.findUnique({
        where: { claimIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        this.assertFingerprint(
          prior.payloadFingerprint,
          this.claimFingerprint({
            method: RiderAdvanceSettlementMethod.DIRECT_TRANSFER,
            amount: claimed,
            externalReference: input.externalReference,
            proofStorageReference: input.proofStorageReference,
          }),
        );
        const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
          where: { id: prior.riderAdvanceId },
        });
        const totals = await this.computeTotals(this.prisma, ra);
        return {
          settlement: this.toSettlementDto(prior, 'CUSTOMER'),
          ...this.publicTotals(ra, totals),
          idempotent: true,
        };
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM "rider_advances"
              WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
            `;
            const ra = await tx.riderAdvance.findUnique({
              where: { id: input.riderAdvanceId },
            });
            if (!ra) throw new NotFoundException('Rider Advance not found');
            if (input.actorUserId !== ra.customerId) {
              throw new ForbiddenException({
                code: 'NOT_CUSTOMER',
                message: 'Only the order customer may create a transfer claim',
              });
            }
            this.assertPrincipalSettleable(ra);

            const totals = await this.computeTotals(tx, ra);
            if (claimed.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: 'AMOUNT_EXCEEDS_REMAINING',
                message: 'Claim amount exceeds remaining reimbursement',
              });
            }

            const now = new Date();
            const fingerprint = this.claimFingerprint({
              method: RiderAdvanceSettlementMethod.DIRECT_TRANSFER,
              amount: claimed,
              externalReference: input.externalReference,
              proofStorageReference: input.proofStorageReference,
            });

            let claimEvidenceId: string | null = null;
            if (input.externalReference || input.proofStorageReference) {
              const ev = await tx.agreementEvidence.create({
                data: {
                  id: randomUUID(),
                  agreementId: ra.agreementId,
                  agreementVersionId: ra.agreementVersionId,
                  wkOrderId: ra.wkOrderId,
                  evidenceType: input.proofStorageReference
                    ? AgreementEvidenceType.PAYMENT_PROOF
                    : AgreementEvidenceType.PAYMENT_REFERENCE,
                  storageReference: input.proofStorageReference ?? undefined,
                  contentHash: hashMeta({
                    kind: 'reimbursement_transfer_claim',
                    amount: claimed.toFixed(2),
                    externalReference: input.externalReference ?? null,
                  }),
                  submittedBy: input.actorUserId,
                  finalized: true,
                  metadata: {
                    kind: 'reimbursement_transfer_claim',
                    claimedAmount: claimed.toFixed(2),
                    externalReference: input.externalReference ?? null,
                    currency: ra.currency,
                  },
                  idempotencyKey: input.idempotencyKey
                    ? `ra-claim-ev-${input.idempotencyKey}`
                    : undefined,
                },
              });
              claimEvidenceId = ev.id;
            }

            const settlement = await tx.riderAdvanceSettlement.create({
              data: {
                id: randomUUID(),
                riderAdvanceId: ra.id,
                wkOrderId: ra.wkOrderId,
                customerId: ra.customerId,
                creditorRiderId: ra.riderId,
                method: RiderAdvanceSettlementMethod.DIRECT_TRANSFER,
                status: RiderAdvanceSettlementStatus.CLAIMED,
                currency: ra.currency,
                claimedAmount: claimed,
                claimedAt: now,
                claimedByUserId: input.actorUserId,
                externalReference: input.externalReference,
                proofStorageReference: input.proofStorageReference,
                claimEvidenceId,
                claimIdempotencyKey: input.idempotencyKey,
                payloadFingerprint: fingerprint,
                correlationId: input.correlationId,
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'CUSTOMER',
              action: 'REIMBURSEMENT_CLAIMED',
              previousState: ra.status,
              newState: ra.status,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                settlementId: settlement.id,
                method: settlement.method,
                claimedAmount: claimed.toFixed(2),
                remainingUnchanged: true,
              },
            });

            const after = await this.computeTotals(tx, ra);
            return {
              settlement: this.toSettlementDto(settlement, 'CUSTOMER'),
              ...this.publicTotals(ra, after),
              idempotent: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvanceSettlement.findUnique({
          where: { claimIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          this.assertFingerprint(
            prior.payloadFingerprint,
            this.claimFingerprint({
              method: RiderAdvanceSettlementMethod.DIRECT_TRANSFER,
              amount: claimed,
              externalReference: input.externalReference,
              proofStorageReference: input.proofStorageReference,
            }),
          );
          const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
            where: { id: prior.riderAdvanceId },
          });
          const totals = await this.computeTotals(this.prisma, ra);
          return {
            settlement: this.toSettlementDto(prior, 'CUSTOMER'),
            ...this.publicTotals(ra, totals),
            idempotent: true,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Creditor records cash received directly from customer.
   * Immediately ACKNOWLEDGED — contributes to settled total.
   */
  async createCashReceipt(input: {
    riderAdvanceId: string;
    actorUserId: string;
    amount: string | number;
    notes?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const amount = MONEY(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'amount must be positive',
      });
    }

    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvanceSettlement.findUnique({
        where: { cashIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        this.assertFingerprint(
          prior.payloadFingerprint,
          this.cashFingerprint(amount),
        );
        const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
          where: { id: prior.riderAdvanceId },
        });
        const totals = await this.computeTotals(this.prisma, ra);
        return {
          settlement: this.toSettlementDto(prior, 'CREDITOR'),
          ...this.publicTotals(ra, totals),
          idempotent: true,
        };
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM "rider_advances"
              WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
            `;
            const ra = await tx.riderAdvance.findUnique({
              where: { id: input.riderAdvanceId },
            });
            if (!ra) throw new NotFoundException('Rider Advance not found');
            this.assertIsCreditor(ra, input.actorUserId);
            this.assertPrincipalSettleable(ra);

            const totals = await this.computeTotals(tx, ra);
            if (amount.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: 'AMOUNT_EXCEEDS_REMAINING',
                message: 'Cash amount exceeds remaining reimbursement',
              });
            }

            const now = new Date();
            const fingerprint = this.cashFingerprint(amount);

            const ackEvidence = await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.RIDER_ACKNOWLEDGMENT,
                contentHash: hashMeta({
                  kind: 'reimbursement_cash_received',
                  amount: amount.toFixed(2),
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'reimbursement_cash_received',
                  acknowledgedAmount: amount.toFixed(2),
                  notes: input.notes ?? null,
                  currency: ra.currency,
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-cash-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            const settlement = await tx.riderAdvanceSettlement.create({
              data: {
                id: randomUUID(),
                riderAdvanceId: ra.id,
                wkOrderId: ra.wkOrderId,
                customerId: ra.customerId,
                creditorRiderId: ra.riderId,
                method: RiderAdvanceSettlementMethod.CASH,
                status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
                currency: ra.currency,
                claimedAmount: amount,
                acknowledgedAmount: amount,
                claimedAt: now,
                claimedByUserId: input.actorUserId,
                acknowledgedAt: now,
                acknowledgedByUserId: input.actorUserId,
                ackEvidenceId: ackEvidence.id,
                cashIdempotencyKey: input.idempotencyKey,
                payloadFingerprint: fingerprint,
                correlationId: input.correlationId,
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'RIDER',
              action: 'REIMBURSEMENT_CASH_RECEIVED',
              previousState: ra.status,
              newState: ra.status,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                settlementId: settlement.id,
                acknowledgedAmount: amount.toFixed(2),
              },
            });

            const completed = await this.maybeCompleteReimbursement(
              tx,
              ra,
              input.actorUserId,
              input.correlationId,
            );

            return {
              settlement: this.toSettlementDto(settlement, 'CREDITOR'),
              ...this.publicTotals(completed.ra, completed.totals),
              idempotent: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvanceSettlement.findUnique({
          where: { cashIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          this.assertFingerprint(
            prior.payloadFingerprint,
            this.cashFingerprint(amount),
          );
          const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
            where: { id: prior.riderAdvanceId },
          });
          const totals = await this.computeTotals(this.prisma, ra);
          return {
            settlement: this.toSettlementDto(prior, 'CREDITOR'),
            ...this.publicTotals(ra, totals),
            idempotent: true,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Creditor acknowledges (full or partial) a CLAIMED DIRECT_TRANSFER.
   */
  async acknowledge(input: {
    settlementId: string;
    actorUserId: string;
    acknowledgedAmount: string | number;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const ack = MONEY(input.acknowledgedAmount);
    if (ack.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'acknowledgedAmount must be positive',
      });
    }

    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvanceSettlement.findUnique({
        where: { ackIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        this.assertFingerprint(
          prior.payloadFingerprint,
          this.ackFingerprint(prior.id, ack),
        );
        const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
          where: { id: prior.riderAdvanceId },
        });
        const totals = await this.computeTotals(this.prisma, ra);
        return {
          settlement: this.toSettlementDto(prior, 'CREDITOR'),
          ...this.publicTotals(ra, totals),
          idempotent: true,
        };
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "rider_advance_settlements"
              WHERE id = ${input.settlementId}::uuid FOR UPDATE
            `;
            if (!locked.length) {
              throw new NotFoundException('Settlement not found');
            }
            const settlement =
              await tx.riderAdvanceSettlement.findUniqueOrThrow({
                where: { id: input.settlementId },
              });

            await tx.$queryRaw`
              SELECT id FROM "rider_advances"
              WHERE id = ${settlement.riderAdvanceId}::uuid FOR UPDATE
            `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: settlement.riderAdvanceId },
            });

            this.assertIsCreditor(ra, input.actorUserId);

            if (
              settlement.status === RiderAdvanceSettlementStatus.ACKNOWLEDGED
            ) {
              if (
                settlement.acknowledgedAmount &&
                MONEY(settlement.acknowledgedAmount).eq(ack)
              ) {
                const totals = await this.computeTotals(tx, ra);
                return {
                  settlement: this.toSettlementDto(settlement, 'CREDITOR'),
                  ...this.publicTotals(ra, totals),
                  idempotent: true,
                };
              }
              throw new ConflictException({
                code: 'CLAIM_ALREADY_RESOLVED',
                message: 'Settlement already acknowledged',
              });
            }
            if (settlement.status === RiderAdvanceSettlementStatus.REJECTED) {
              throw new ConflictException({
                code: 'CLAIM_ALREADY_RESOLVED',
                message: 'Settlement already rejected',
              });
            }
            if (settlement.status !== RiderAdvanceSettlementStatus.CLAIMED) {
              throw new BadRequestException({
                code: 'CLAIM_ALREADY_RESOLVED',
                message: `Cannot acknowledge settlement in status ${settlement.status}`,
              });
            }
            if (
              settlement.method !== RiderAdvanceSettlementMethod.DIRECT_TRANSFER
            ) {
              throw new BadRequestException(
                'Only DIRECT_TRANSFER claims can be acknowledged this way',
              );
            }

            this.assertPrincipalSettleable(ra);

            const totals = await this.computeTotals(tx, ra);
            if (
              !settlement.claimedAmount ||
              ack.gt(MONEY(settlement.claimedAmount))
            ) {
              throw new BadRequestException({
                code: 'AMOUNT_EXCEEDS_CLAIM',
                message:
                  'Acknowledged amount exceeds the customer direct-transfer claim',
              });
            }
            if (ack.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: 'AMOUNT_EXCEEDS_REMAINING',
                message: 'Acknowledged amount exceeds remaining reimbursement',
              });
            }

            const now = new Date();
            const ackEvidence = await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.RIDER_ACKNOWLEDGMENT,
                contentHash: hashMeta({
                  kind: 'reimbursement_acknowledged',
                  amount: ack.toFixed(2),
                  settlementId: settlement.id,
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'reimbursement_acknowledged',
                  settlementId: settlement.id,
                  claimedAmount: settlement.claimedAmount?.toFixed(2) ?? null,
                  acknowledgedAmount: ack.toFixed(2),
                  currency: ra.currency,
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-ack-settle-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            const updated = await tx.riderAdvanceSettlement.update({
              where: { id: settlement.id },
              data: {
                status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
                acknowledgedAmount: ack,
                acknowledgedAt: now,
                acknowledgedByUserId: input.actorUserId,
                ackEvidenceId: ackEvidence.id,
                ackIdempotencyKey: input.idempotencyKey,
                payloadFingerprint: this.ackFingerprint(settlement.id, ack),
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'RIDER',
              action: 'REIMBURSEMENT_ACKNOWLEDGED',
              previousState: RiderAdvanceSettlementStatus.CLAIMED,
              newState: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                settlementId: settlement.id,
                claimedAmount: settlement.claimedAmount?.toFixed(2) ?? null,
                acknowledgedAmount: ack.toFixed(2),
              },
            });

            const completed = await this.maybeCompleteReimbursement(
              tx,
              ra,
              input.actorUserId,
              input.correlationId,
            );

            return {
              settlement: this.toSettlementDto(updated, 'CREDITOR'),
              ...this.publicTotals(completed.ra, completed.totals),
              idempotent: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvanceSettlement.findUnique({
          where: { ackIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          this.assertFingerprint(
            prior.payloadFingerprint,
            this.ackFingerprint(prior.id, ack),
          );
          const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
            where: { id: prior.riderAdvanceId },
          });
          const totals = await this.computeTotals(this.prisma, ra);
          return {
            settlement: this.toSettlementDto(prior, 'CREDITOR'),
            ...this.publicTotals(ra, totals),
            idempotent: true,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Creditor rejects a CLAIMED DIRECT_TRANSFER. Debt unchanged.
   */
  async reject(input: {
    settlementId: string;
    actorUserId: string;
    reason?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvanceSettlement.findUnique({
        where: { rejectIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        this.assertFingerprint(
          prior.payloadFingerprint,
          this.rejectFingerprint(prior.id, input.reason),
        );
        const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
          where: { id: prior.riderAdvanceId },
        });
        const totals = await this.computeTotals(this.prisma, ra);
        return {
          settlement: this.toSettlementDto(prior, 'CREDITOR'),
          ...this.publicTotals(ra, totals),
          idempotent: true,
        };
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "rider_advance_settlements"
              WHERE id = ${input.settlementId}::uuid FOR UPDATE
            `;
            if (!locked.length) {
              throw new NotFoundException('Settlement not found');
            }
            const settlement =
              await tx.riderAdvanceSettlement.findUniqueOrThrow({
                where: { id: input.settlementId },
              });

            await tx.$queryRaw`
              SELECT id FROM "rider_advances"
              WHERE id = ${settlement.riderAdvanceId}::uuid FOR UPDATE
            `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: settlement.riderAdvanceId },
            });

            this.assertIsCreditor(ra, input.actorUserId);

            if (settlement.status === RiderAdvanceSettlementStatus.REJECTED) {
              const totals = await this.computeTotals(tx, ra);
              return {
                settlement: this.toSettlementDto(settlement, 'CREDITOR'),
                ...this.publicTotals(ra, totals),
                idempotent: true,
              };
            }
            if (
              settlement.status === RiderAdvanceSettlementStatus.ACKNOWLEDGED
            ) {
              throw new ConflictException({
                code: 'CLAIM_ALREADY_RESOLVED',
                message: 'Settlement already acknowledged',
              });
            }
            if (settlement.status !== RiderAdvanceSettlementStatus.CLAIMED) {
              throw new BadRequestException({
                code: 'CLAIM_ALREADY_RESOLVED',
                message: `Cannot reject settlement in status ${settlement.status}`,
              });
            }

            const now = new Date();
            await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.NOTE,
                contentHash: hashMeta({
                  kind: 'reimbursement_rejected',
                  settlementId: settlement.id,
                  reason: input.reason ?? null,
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'reimbursement_rejected',
                  settlementId: settlement.id,
                  reason: input.reason ?? null,
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-reject-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            const updated = await tx.riderAdvanceSettlement.update({
              where: { id: settlement.id },
              data: {
                status: RiderAdvanceSettlementStatus.REJECTED,
                rejectedAt: now,
                rejectedByUserId: input.actorUserId,
                rejectionReason: input.reason,
                rejectIdempotencyKey: input.idempotencyKey,
                payloadFingerprint: this.rejectFingerprint(
                  settlement.id,
                  input.reason,
                ),
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'RIDER',
              action: 'REIMBURSEMENT_REJECTED',
              previousState: RiderAdvanceSettlementStatus.CLAIMED,
              newState: RiderAdvanceSettlementStatus.REJECTED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                settlementId: settlement.id,
                reason: input.reason ?? null,
                debtUnchanged: true,
              },
            });

            const totals = await this.computeTotals(tx, ra);
            return {
              settlement: this.toSettlementDto(updated, 'CREDITOR'),
              ...this.publicTotals(ra, totals),
              idempotent: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvanceSettlement.findUnique({
          where: { rejectIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          this.assertFingerprint(
            prior.payloadFingerprint,
            this.rejectFingerprint(prior.id, input.reason),
          );
          const ra = await this.prisma.riderAdvance.findUniqueOrThrow({
            where: { id: prior.riderAdvanceId },
          });
          const totals = await this.computeTotals(this.prisma, ra);
          return {
            settlement: this.toSettlementDto(prior, 'CREDITOR'),
            ...this.publicTotals(ra, totals),
            idempotent: true,
          };
        }
      }
      throw err;
    }
  }

  // ─── Authority / totals ───────────────────────────────────────────

  /**
   * Creditor authority is RiderAdvance.riderId — NEVER activeRiderId.
   * Do not use assertAssignmentCurrent here.
   */
  private assertIsCreditor(ra: { riderId: string }, actorUserId: string) {
    if (actorUserId !== ra.riderId) {
      throw new ForbiddenException({
        code: 'NOT_CREDITOR',
        message:
          'Only the Rider Advance creditor (original advancing rider) may mutate settlement',
      });
    }
  }

  private assertPrincipalSettleable(
    ra:
      | RaRow
      | {
          status: RiderAdvanceStatus;
          reimbursementPrincipal: Prisma.Decimal | null;
        },
  ) {
    const principal = ra.reimbursementPrincipal;
    if (principal == null || MONEY(principal).lte(0)) {
      throw new BadRequestException({
        code: 'PRINCIPAL_NOT_ESTABLISHED',
        message: 'Reimbursement principal is not established',
      });
    }
    if (ra.status === RiderAdvanceStatus.REIMBURSED) {
      throw new BadRequestException({
        code: 'REIMBURSEMENT_NOT_DUE',
        message: 'Rider Advance is already fully reimbursed',
      });
    }
    const allowed =
      ra.status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
      ra.status === RiderAdvanceStatus.DISPUTED;
    if (!allowed) {
      throw new BadRequestException({
        code: 'REIMBURSEMENT_NOT_DUE',
        message: `Settlement not allowed in status ${ra.status}`,
      });
    }
  }

  async computeTotals(
    db: Prisma.TransactionClient | PrismaService,
    ra: { id: string; reimbursementPrincipal: Prisma.Decimal | null },
  ) {
    const principal = MONEY(ra.reimbursementPrincipal ?? 0);
    const rows = await db.riderAdvanceSettlement.findMany({
      where: {
        riderAdvanceId: ra.id,
        status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
      },
      select: { acknowledgedAmount: true },
    });
    let settled = MONEY(0);
    for (const row of rows) {
      if (row.acknowledgedAmount) {
        settled = settled.add(MONEY(row.acknowledgedAmount));
      }
    }
    settled = settled.toDecimalPlaces(2);
    const remaining = principal.sub(settled).toDecimalPlaces(2);
    return {
      principal,
      settledAmount: settled,
      remainingAmount: remaining.lt(0) ? MONEY(0) : remaining,
    };
  }

  private async maybeCompleteReimbursement(
    tx: Prisma.TransactionClient,
    ra: RaRow,
    actorUserId: string,
    correlationId?: string,
  ) {
    const totals = await this.computeTotals(tx, ra);
    if (!totals.settledAmount.eq(totals.principal) || totals.principal.lte(0)) {
      return { ra, totals };
    }
    if (ra.status === RiderAdvanceStatus.REIMBURSED && ra.reimbursedAt) {
      return { ra, totals };
    }

    const now = new Date();
    const updated = await tx.riderAdvance.update({
      where: { id: ra.id },
      data: {
        status: RiderAdvanceStatus.REIMBURSED,
        reimbursedAt: ra.reimbursedAt ?? now,
        version: { increment: 1 },
      },
    });

    // Emit completion exactly once on the authoritative transition.
    await this.events.record({
      tx,
      aggregateType: 'AGREEMENT',
      aggregateId: ra.agreementId,
      wkOrderId: ra.wkOrderId,
      actorId: actorUserId,
      actorType: 'SYSTEM',
      action: 'REIMBURSEMENT_COMPLETED',
      previousState: ra.status,
      newState: RiderAdvanceStatus.REIMBURSED,
      correlationId,
      metadata: {
        riderAdvanceId: ra.id,
        principal: totals.principal.toFixed(2),
        settledAmount: totals.settledAmount.toFixed(2),
      },
    });

    return { ra: updated, totals };
  }

  private async resolveViewerRole(
    ra: {
      customerId: string;
      riderId: string;
      merchantId: number;
      wkOrderId: number;
    },
    actorUserId: string,
  ): Promise<'CUSTOMER' | 'CREDITOR' | 'ADMIN' | 'DENIED'> {
    if (actorUserId === ra.customerId) return 'CUSTOMER';
    if (actorUserId === ra.riderId) return 'CREDITOR';
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (user?.role === UserRole.admin) return 'ADMIN';
    // Delivery Rider B / merchant / coordinator: no settlement detail
    return 'DENIED';
  }

  private publicTotals(
    ra: {
      status: RiderAdvanceStatus;
      currency: string;
      riderId: string;
      reimbursementPrincipal: Prisma.Decimal | null;
    },
    totals: {
      principal: Prisma.Decimal;
      settledAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
    },
  ) {
    return {
      principal: totals.principal.toFixed(2),
      settledAmount: totals.settledAmount.toFixed(2),
      remainingAmount: totals.remainingAmount.toFixed(2),
      currency: ra.currency,
      reimbursementStatus: ra.status,
      creditorRiderId: ra.riderId,
    };
  }

  private toSummaryResponse(
    ra: RaRow,
    totals: {
      principal: Prisma.Decimal;
      settledAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
    },
    settlements: SettlementRow[],
    role: 'CUSTOMER' | 'CREDITOR' | 'ADMIN',
  ) {
    return {
      ...this.publicTotals(ra, totals),
      creditor: { id: ra.riderId },
      settlements: settlements.map((s) => this.toSettlementDto(s, role)),
    };
  }

  private toSettlementDto(
    s: SettlementRow,
    role: 'CUSTOMER' | 'CREDITOR' | 'ADMIN',
  ) {
    const base = {
      id: s.id,
      method: s.method,
      status: s.status,
      claimedAmount: s.claimedAmount?.toFixed(2) ?? null,
      acknowledgedAmount: s.acknowledgedAmount?.toFixed(2) ?? null,
      createdAt: s.createdAt.toISOString(),
      acknowledgedAt: s.acknowledgedAt?.toISOString() ?? null,
      rejectedAt: s.rejectedAt?.toISOString() ?? null,
    };
    if (role === 'CUSTOMER') {
      return {
        ...base,
        externalReference: s.externalReference,
        // Customer sees own reference; not creditor private notes
      };
    }
    return {
      ...base,
      externalReference: s.externalReference,
      proofStorageReference: s.proofStorageReference,
      rejectionReason: s.rejectionReason,
    };
  }

  private claimFingerprint(input: {
    method: RiderAdvanceSettlementMethod;
    amount: Prisma.Decimal;
    externalReference?: string;
    proofStorageReference?: string;
  }) {
    return hashMeta({
      kind: 'claim',
      method: input.method,
      amount: input.amount.toFixed(2),
      externalReference: input.externalReference ?? null,
      proofStorageReference: input.proofStorageReference ?? null,
    });
  }

  private cashFingerprint(amount: Prisma.Decimal) {
    return hashMeta({ kind: 'cash', amount: amount.toFixed(2) });
  }

  private ackFingerprint(settlementId: string, amount: Prisma.Decimal) {
    return hashMeta({
      kind: 'ack',
      settlementId,
      amount: amount.toFixed(2),
    });
  }

  private rejectFingerprint(settlementId: string, reason?: string) {
    return hashMeta({
      kind: 'reject',
      settlementId,
      reason: reason ?? null,
    });
  }

  private assertFingerprint(stored: string | null, expected: string) {
    if (stored && stored !== expected) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key payload conflict',
      });
    }
  }
}

function hashMeta(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
