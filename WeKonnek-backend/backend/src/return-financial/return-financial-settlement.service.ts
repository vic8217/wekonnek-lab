import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReturnFinancialObligationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialSettlementMethod,
  ReturnFinancialSettlementStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

@Injectable()
export class ReturnFinancialSettlementService {
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

  async getObligation(obligationId: string, actorUserId: string) {
    const obl = await this.prisma.returnFinancialObligation.findUnique({
      where: { id: obligationId },
      include: { determination: true },
    });
    if (!obl) throw new NotFoundException('Obligation not found');
    await this.assertCanViewObligation(obl, actorUserId);
    const totals = await this.computeObligationTotals(this.prisma, obl.id, obl.principal);
    return { obligation: obl, ...totals };
  }

  private async assertCanViewObligation(
    obl: {
      creditorUserId: string;
      merchantId: number;
      wkOrderId: number;
      type: ReturnFinancialObligationType;
    },
    actorUserId: string,
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (actor?.role === UserRole.admin) return 'ADMIN';
    if (obl.creditorUserId === actorUserId) return 'CREDITOR';
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: obl.merchantId, userId: actorUserId },
    });
    if (merchant) return 'MERCHANT';
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: obl.wkOrderId },
    });
    if (
      order?.userId === actorUserId &&
      obl.type === ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND
    ) {
      return 'CUSTOMER';
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Not authorized to view this obligation',
    });
  }

  async computeObligationTotals(
    db: Prisma.TransactionClient | PrismaService,
    obligationId: string,
    principal: Prisma.Decimal,
  ) {
    const rows = await db.returnFinancialSettlement.findMany({
      where: {
        obligationId,
        status: ReturnFinancialSettlementStatus.ACKNOWLEDGED,
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
    const remaining = MONEY(principal).sub(settled).toDecimalPlaces(2);
    return {
      principal: MONEY(principal),
      settledAmount: settled,
      remainingAmount: remaining.lt(0) ? MONEY(0) : remaining,
    };
  }

  private async refreshObligationStatus(
    tx: Prisma.TransactionClient,
    obligationId: string,
    principal: Prisma.Decimal,
  ) {
    const totals = await this.computeObligationTotals(tx, obligationId, principal);
    let status: ReturnFinancialObligationStatus =
      ReturnFinancialObligationStatus.OPEN;
    if (totals.settledAmount.gte(totals.principal) && totals.principal.gt(0)) {
      status = ReturnFinancialObligationStatus.SETTLED;
    } else if (totals.settledAmount.gt(0)) {
      status = ReturnFinancialObligationStatus.PARTIALLY_SETTLED;
    }
    await tx.returnFinancialObligation.update({
      where: { id: obligationId },
      data: { status },
    });
    return { ...totals, status };
  }

  /** Merchant owner claims DIRECT_TRANSFER; creditor records CASH. */
  async createSettlement(input: {
    obligationId: string;
    actorUserId: string;
    method: ReturnFinancialSettlementMethod | string;
    amount: string | number;
    externalReference?: string;
    proofStorageReference?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const method = String(input.method) as ReturnFinancialSettlementMethod;
    if (
      method !== ReturnFinancialSettlementMethod.CASH &&
      method !== ReturnFinancialSettlementMethod.DIRECT_TRANSFER
    ) {
      throw new BadRequestException({
        code: 'INVALID_METHOD',
        message: 'method must be CASH or DIRECT_TRANSFER',
      });
    }
    const amount = MONEY(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'amount must be positive',
      });
    }

    const idemKey =
      method === ReturnFinancialSettlementMethod.CASH
        ? input.idempotencyKey
          ? { cashIdempotencyKey: input.idempotencyKey }
          : null
        : input.idempotencyKey
          ? { claimIdempotencyKey: input.idempotencyKey }
          : null;

          if (idemKey) {
      const prior = await this.prisma.returnFinancialSettlement.findFirst({
        where: idemKey,
      });
      if (prior) {
        // Authorize before cache disclosure; cross-obligation key ≠ cache hit
        if (prior.obligationId !== input.obligationId) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
            message:
              'Idempotency key is bound to a different obligation and cannot be reused cross-order',
          });
        }
        const obl = await this.prisma.returnFinancialObligation.findUniqueOrThrow({
          where: { id: prior.obligationId },
        });
        await this.assertSettlementActor(obl, input.actorUserId, method, 'create');
        if (method === ReturnFinancialSettlementMethod.DIRECT_TRANSFER) {
          const merchant = await this.prisma.merchant.findFirst({
            where: { id: obl.merchantId, userId: input.actorUserId },
          });
          if (!merchant) {
            throw new ForbiddenException({
              code: 'NOT_MERCHANT_OWNER',
              message: 'Only merchant owner may claim direct transfer',
            });
          }
        }
        const totals = await this.computeObligationTotals(
          this.prisma,
          obl.id,
          obl.principal,
        );
        return { settlement: prior, ...totals, idempotent: true };
      }
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_obligations"
            WHERE id = ${input.obligationId}::uuid FOR UPDATE
          `;
          const obl = await tx.returnFinancialObligation.findUnique({
            where: { id: input.obligationId },
          });
          if (!obl) throw new NotFoundException('Obligation not found');
          if (
            obl.status === ReturnFinancialObligationStatus.CANCELLED ||
            obl.status === ReturnFinancialObligationStatus.SETTLED
          ) {
            throw new BadRequestException({
              code: 'OBLIGATION_NOT_SETTLEABLE',
              message: `Obligation not settleable in status ${obl.status}`,
            });
          }

          await this.assertSettlementActor(obl, input.actorUserId, method, 'create');

          const totals = await this.computeObligationTotals(
            tx,
            obl.id,
            obl.principal,
          );
          if (amount.gt(totals.remainingAmount)) {
            throw new BadRequestException({
              code: 'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
              message: 'Settlement amount exceeds remaining obligation',
            });
          }

          const now = new Date();
          const fingerprint = createHash('sha256')
            .update(
              JSON.stringify({
                obligationId: obl.id,
                method,
                amount: amount.toFixed(2),
                externalReference: input.externalReference ?? null,
              }),
            )
            .digest('hex');

          if (method === ReturnFinancialSettlementMethod.CASH) {
            // Creditor cash receipt is immediately ACKNOWLEDGED
            const settlement = await tx.returnFinancialSettlement.create({
              data: {
                id: randomUUID(),
                obligationId: obl.id,
                wkOrderId: obl.wkOrderId,
                method,
                status: ReturnFinancialSettlementStatus.ACKNOWLEDGED,
                currency: obl.currency,
                claimedAmount: amount,
                acknowledgedAmount: amount,
                claimedAt: now,
                claimedByUserId: input.actorUserId,
                acknowledgedAt: now,
                acknowledgedByUserId: input.actorUserId,
                cashIdempotencyKey: input.idempotencyKey,
                payloadFingerprint: fingerprint,
                correlationId: input.correlationId,
              },
            });
            const after = await this.refreshObligationStatus(
              tx,
              obl.id,
              obl.principal,
            );
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(obl.wkOrderId),
              wkOrderId: obl.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'RETURN_FINANCIAL_SETTLEMENT_ACKNOWLEDGED',
              previousState: null,
              newState: settlement.status,
              correlationId: input.correlationId,
              metadata: {
                settlementId: settlement.id,
                method: 'CASH',
                amount: amount.toFixed(2),
              },
            });
            if (after.status === ReturnFinancialObligationStatus.SETTLED) {
              await this.events.record({
                tx,
                aggregateType: 'WK_ORDER',
                aggregateId: String(obl.wkOrderId),
                wkOrderId: obl.wkOrderId,
                actorId: input.actorUserId,
                actorType: 'SYSTEM',
                action: 'RETURN_FINANCIAL_OBLIGATION_SETTLED',
                previousState: obl.status,
                newState: after.status,
                correlationId: input.correlationId,
                metadata: { obligationId: obl.id },
              });
            }
            return { settlement, ...after, idempotent: false };
          }

          // DIRECT_TRANSFER claim — merchant claims; does not reduce until ack
          const merchant = await tx.merchant.findFirst({
            where: { id: obl.merchantId, userId: input.actorUserId },
          });
          if (!merchant) {
            throw new ForbiddenException({
              code: 'NOT_MERCHANT_OWNER',
              message: 'Only merchant owner may claim direct transfer',
            });
          }

          const settlement = await tx.returnFinancialSettlement.create({
            data: {
              id: randomUUID(),
              obligationId: obl.id,
              wkOrderId: obl.wkOrderId,
              method,
              status: ReturnFinancialSettlementStatus.CLAIMED,
              currency: obl.currency,
              claimedAmount: amount,
              claimedAt: now,
              claimedByUserId: input.actorUserId,
              externalReference: input.externalReference,
              proofStorageReference: input.proofStorageReference,
              claimIdempotencyKey: input.idempotencyKey,
              payloadFingerprint: fingerprint,
              correlationId: input.correlationId,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(obl.wkOrderId),
            wkOrderId: obl.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'MERCHANT_OWNER',
            action: 'RETURN_FINANCIAL_SETTLEMENT_CLAIMED',
            previousState: null,
            newState: settlement.status,
            correlationId: input.correlationId,
            metadata: {
              settlementId: settlement.id,
              amount: amount.toFixed(2),
            },
          });

          return { settlement, ...totals, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async assertSettlementActor(
    obl: {
      creditorUserId: string;
      merchantId: number;
      type: ReturnFinancialObligationType;
    },
    actorUserId: string,
    method: ReturnFinancialSettlementMethod,
    action: 'create' | 'ack' | 'reject',
  ) {
    if (method === ReturnFinancialSettlementMethod.CASH || action !== 'create') {
      // Creditor only for cash / ack / reject
      if (obl.creditorUserId !== actorUserId) {
        throw new ForbiddenException({
          code: 'NOT_FINANCIAL_CREDITOR',
          message:
            'Only the obligation creditor may record cash receipt or acknowledge/reject',
        });
      }
      return;
    }
    // DIRECT_TRANSFER create: merchant owner (checked in txn)
  }

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
      const prior = await this.prisma.returnFinancialSettlement.findFirst({
        where: { ackIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        const obl = await this.prisma.returnFinancialObligation.findUniqueOrThrow({
          where: { id: prior.obligationId },
        });
        if (obl.creditorUserId !== input.actorUserId) {
          throw new ForbiddenException({
            code: 'NOT_FINANCIAL_CREDITOR',
            message: 'Not the financial creditor',
          });
        }
        const totals = await this.computeObligationTotals(
          this.prisma,
          obl.id,
          obl.principal,
        );
        return { settlement: prior, ...totals, idempotent: true };
      }
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_settlements"
            WHERE id = ${input.settlementId}::uuid FOR UPDATE
          `;
          const settlement = await tx.returnFinancialSettlement.findUnique({
            where: { id: input.settlementId },
          });
          if (!settlement) throw new NotFoundException('Settlement not found');

          await tx.$queryRaw`
            SELECT id FROM "return_financial_obligations"
            WHERE id = ${settlement.obligationId}::uuid FOR UPDATE
          `;
          const obl = await tx.returnFinancialObligation.findUniqueOrThrow({
            where: { id: settlement.obligationId },
          });

          if (obl.creditorUserId !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'NOT_FINANCIAL_CREDITOR',
              message: 'Only the obligation creditor may acknowledge',
            });
          }

          if (
            settlement.status === ReturnFinancialSettlementStatus.ACKNOWLEDGED
          ) {
            if (
              settlement.acknowledgedAmount &&
              MONEY(settlement.acknowledgedAmount).eq(ack)
            ) {
              const totals = await this.computeObligationTotals(
                tx,
                obl.id,
                obl.principal,
              );
              return { settlement, ...totals, idempotent: true };
            }
            throw new ConflictException({
              code: 'SETTLEMENT_ALREADY_RESOLVED',
              message: 'Settlement already acknowledged',
            });
          }
          if (settlement.status === ReturnFinancialSettlementStatus.REJECTED) {
            throw new ConflictException({
              code: 'SETTLEMENT_ALREADY_RESOLVED',
              message: 'Settlement already rejected',
            });
          }
          if (settlement.status !== ReturnFinancialSettlementStatus.CLAIMED) {
            throw new BadRequestException({
              code: 'INVALID_SETTLEMENT_STATUS',
              message: `Cannot acknowledge settlement in ${settlement.status}`,
            });
          }
          if (
            settlement.method !== ReturnFinancialSettlementMethod.DIRECT_TRANSFER
          ) {
            throw new BadRequestException('Only DIRECT_TRANSFER claims acknowledge this way');
          }
          if (!settlement.claimedAmount || ack.gt(MONEY(settlement.claimedAmount))) {
            throw new BadRequestException({
              code: 'AMOUNT_EXCEEDS_CLAIM',
              message: 'Acknowledged amount exceeds claimed amount',
            });
          }

          const totals = await this.computeObligationTotals(
            tx,
            obl.id,
            obl.principal,
          );
          if (ack.gt(totals.remainingAmount)) {
            throw new BadRequestException({
              code: 'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
              message: 'Acknowledged amount exceeds remaining obligation',
            });
          }

          const updated = await tx.returnFinancialSettlement.update({
            where: { id: settlement.id },
            data: {
              status: ReturnFinancialSettlementStatus.ACKNOWLEDGED,
              acknowledgedAmount: ack,
              acknowledgedAt: new Date(),
              acknowledgedByUserId: input.actorUserId,
              ackIdempotencyKey: input.idempotencyKey,
              correlationId: input.correlationId ?? settlement.correlationId,
            },
          });

          const after = await this.refreshObligationStatus(
            tx,
            obl.id,
            obl.principal,
          );

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(obl.wkOrderId),
            wkOrderId: obl.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'SYSTEM',
            action: 'RETURN_FINANCIAL_SETTLEMENT_ACKNOWLEDGED',
            previousState: settlement.status,
            newState: updated.status,
            correlationId: input.correlationId,
            metadata: {
              settlementId: updated.id,
              acknowledgedAmount: ack.toFixed(2),
            },
          });

          if (after.status === ReturnFinancialObligationStatus.SETTLED) {
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(obl.wkOrderId),
              wkOrderId: obl.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'RETURN_FINANCIAL_OBLIGATION_SETTLED',
              previousState: obl.status,
              newState: after.status,
              correlationId: input.correlationId,
              metadata: { obligationId: obl.id },
            });
          }

          return { settlement: updated, ...after, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async reject(input: {
    settlementId: string;
    actorUserId: string;
    reason?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.returnFinancialSettlement.findFirst({
        where: { rejectIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        const obl = await this.prisma.returnFinancialObligation.findUniqueOrThrow({
          where: { id: prior.obligationId },
        });
        if (obl.creditorUserId !== input.actorUserId) {
          throw new ForbiddenException({
            code: 'NOT_FINANCIAL_CREDITOR',
            message: 'Not the financial creditor',
          });
        }
        return { settlement: prior, idempotent: true };
      }
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_settlements"
            WHERE id = ${input.settlementId}::uuid FOR UPDATE
          `;
          const settlement = await tx.returnFinancialSettlement.findUnique({
            where: { id: input.settlementId },
          });
          if (!settlement) throw new NotFoundException('Settlement not found');

          const obl = await tx.returnFinancialObligation.findUniqueOrThrow({
            where: { id: settlement.obligationId },
          });
          if (obl.creditorUserId !== input.actorUserId) {
            throw new ForbiddenException({
              code: 'NOT_FINANCIAL_CREDITOR',
              message: 'Only the obligation creditor may reject',
            });
          }

          if (settlement.status === ReturnFinancialSettlementStatus.REJECTED) {
            return { settlement, idempotent: true };
          }
          if (settlement.status !== ReturnFinancialSettlementStatus.CLAIMED) {
            throw new ConflictException({
              code: 'SETTLEMENT_ALREADY_RESOLVED',
              message: `Cannot reject settlement in ${settlement.status}`,
            });
          }

          const updated = await tx.returnFinancialSettlement.update({
            where: { id: settlement.id },
            data: {
              status: ReturnFinancialSettlementStatus.REJECTED,
              rejectedAt: new Date(),
              rejectedByUserId: input.actorUserId,
              rejectionReason: input.reason,
              rejectIdempotencyKey: input.idempotencyKey,
              correlationId: input.correlationId ?? settlement.correlationId,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(obl.wkOrderId),
            wkOrderId: obl.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'SYSTEM',
            action: 'RETURN_FINANCIAL_SETTLEMENT_REJECTED',
            previousState: settlement.status,
            newState: updated.status,
            correlationId: input.correlationId,
            metadata: { settlementId: updated.id, reason: input.reason },
          });

          return { settlement: updated, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}
