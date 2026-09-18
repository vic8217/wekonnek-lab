import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExceptionFinancialObligationStatus,
  ExceptionFinancialSettlementEvidenceKind,
  ExceptionFinancialSettlementMethod,
  ExceptionFinancialSettlementStatus,
  ExceptionLiablePartyType,
  LiabilityDeterminationStatus,
  OrderDomainActorType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { withSerializableRetry as runSerializableRetry } from '../prisma/serializable-retry';
import {
  CODES,
  DerivedSettlementState,
  TRANSFER_METHODS,
  computeDerivedSettlementState,
  fingerprintAckPayload,
  fingerprintCancelPayload,
  fingerprintClaimPayload,
  fingerprintRejectPayload,
  isPlatformCustodyMethod,
  toSettlementMoney,
} from './exception-financial-settlement.policy';

const toMoney = toSettlementMoney;

type ObligationPartyFields = {
  debtorType: ExceptionLiablePartyType;
  debtorUserId: string | null;
  debtorMerchantId: number | null;
  creditorType: ExceptionLiablePartyType;
  creditorUserId: string | null;
  creditorMerchantId: number | null;
};

type ObligationRow = ObligationPartyFields & {
  id: string;
  liabilityDeterminationId: string;
  wkOrderId: number;
  principal: Prisma.Decimal;
  currency: string;
  status: ExceptionFinancialObligationStatus;
};

type ViewerRole = 'DEBTOR' | 'CREDITOR' | 'ADMIN' | 'DENIED';

const ALLOWED_PARTY_TYPES = new Set<string>([
  ExceptionLiablePartyType.CUSTOMER,
  ExceptionLiablePartyType.MERCHANT,
  ExceptionLiablePartyType.RIDER,
]);

@Injectable()
export class ExceptionFinancialSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    return runSerializableRetry(run, attempts);
  }

  private truncKey(key?: string | null): string | null {
    if (!key) return null;
    return key.slice(0, 64);
  }

  // ─── locking (Stage13A: obligation first, then settlement) ─────────

  private async lockObligation(
    tx: Prisma.TransactionClient,
    obligationId: string,
  ): Promise<ObligationRow> {
    await tx.$queryRaw`
      SELECT id FROM "exception_financial_obligations"
      WHERE id = ${obligationId}::uuid FOR UPDATE
    `;
    const obl = await tx.exceptionFinancialObligation.findUnique({
      where: { id: obligationId },
    });
    if (!obl) {
      throw new NotFoundException({
        code: 'OBLIGATION_NOT_FOUND',
        message: 'Exception financial obligation not found',
      });
    }
    return obl;
  }

  private async lockSettlement(
    tx: Prisma.TransactionClient,
    settlementId: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "exception_financial_settlements"
      WHERE id = ${settlementId}::uuid FOR UPDATE
    `;
    const settlement = await tx.exceptionFinancialSettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    return settlement;
  }

  // ─── party / auth helpers ──────────────────────────────────────────

  private actorTypeForParty(
    partyType: ExceptionLiablePartyType,
  ): OrderDomainActorType {
    switch (partyType) {
      case ExceptionLiablePartyType.CUSTOMER:
        return OrderDomainActorType.CUSTOMER;
      case ExceptionLiablePartyType.MERCHANT:
        return OrderDomainActorType.MERCHANT_OWNER;
      case ExceptionLiablePartyType.RIDER:
        return OrderDomainActorType.RIDER;
      default:
        throw new BadRequestException({
          code: CODES.PLATFORM_FIREWALL,
          message: `Party type ${partyType} is not permitted for settlement`,
        });
    }
  }

  private async actorMatchesParty(
    db: Prisma.TransactionClient | PrismaService,
    actorUserId: string,
    party: {
      type: ExceptionLiablePartyType;
      userId: string | null;
      merchantId: number | null;
    },
  ): Promise<boolean> {
    if (party.type === ExceptionLiablePartyType.MERCHANT) {
      if (party.merchantId == null) return false;
      const merchant = await db.merchant.findFirst({
        where: { id: party.merchantId, userId: actorUserId },
        select: { id: true },
      });
      return !!merchant;
    }
    return party.userId != null && party.userId === actorUserId;
  }

  private async resolveViewerRole(
    obl: ObligationPartyFields,
    actorUserId: string,
  ): Promise<ViewerRole> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (!user) return 'DENIED';
    if (user.role === UserRole.admin) return 'ADMIN';

    const isDebtor = await this.actorMatchesParty(this.prisma, actorUserId, {
      type: obl.debtorType,
      userId: obl.debtorUserId,
      merchantId: obl.debtorMerchantId,
    });
    if (isDebtor) return 'DEBTOR';

    const isCreditor = await this.actorMatchesParty(this.prisma, actorUserId, {
      type: obl.creditorType,
      userId: obl.creditorUserId,
      merchantId: obl.creditorMerchantId,
    });
    if (isCreditor) return 'CREDITOR';

    return 'DENIED';
  }

  private assertCanView(role: ViewerRole) {
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: CODES.FORBIDDEN_VIEW,
        message: 'Not authorized to view this settlement',
      });
    }
  }

  private async assertNotAdminFabricating(
    actorUserId: string,
  ): Promise<{ role: UserRole | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (user?.role === UserRole.admin) {
      throw new ForbiddenException({
        code: CODES.ADMIN_CANNOT_FABRICATE_ACK,
        message:
          'SYSTEM_ADMIN may inspect settlements but cannot claim, cash-ack, acknowledge, or reject',
      });
    }
    return { role: user?.role ?? null };
  }

  private assertPlatformFirewall(obl: ObligationPartyFields, method: string) {
    if (isPlatformCustodyMethod(method)) {
      throw new BadRequestException({
        code: CODES.PLATFORM_FIREWALL,
        message:
          'WeKonnek does not take custody of funds; wallet/escrow/platform methods are forbidden',
      });
    }
    if (
      !ALLOWED_PARTY_TYPES.has(obl.debtorType) ||
      !ALLOWED_PARTY_TYPES.has(obl.creditorType)
    ) {
      throw new BadRequestException({
        code: CODES.PLATFORM_FIREWALL,
        message: 'Settlement parties must be CUSTOMER, MERCHANT, or RIDER',
      });
    }
  }

  private async assertObligationExecutable(
    tx: Prisma.TransactionClient,
    obl: ObligationRow,
  ) {
    if (
      obl.status === ExceptionFinancialObligationStatus.CANCELLED ||
      obl.status === ExceptionFinancialObligationStatus.WRITTEN_OFF
    ) {
      throw new BadRequestException({
        code: CODES.OBLIGATION_NOT_EXECUTABLE,
        message: `Obligation not executable in status ${obl.status}`,
      });
    }

    // Fail closed on successor FINALIZED adjustments — do not invent netting.
    const successor = await tx.liabilityDetermination.findFirst({
      where: {
        adjustmentOfDeterminationId: obl.liabilityDeterminationId,
        status: LiabilityDeterminationStatus.FINALIZED,
      },
      select: { id: true },
    });
    if (successor) {
      throw new ConflictException({
        code: CODES.RECONCILIATION_REQUIRED,
        message:
          'A FINALIZED successor LiabilityDetermination adjusts this obligation upstream; Stage13A settlement is refused pending reconciliation',
      });
    }
  }

  private snapshotFromObligation(obl: ObligationRow) {
    return {
      debtorTypeSnapshot: obl.debtorType,
      debtorUserIdSnapshot: obl.debtorUserId,
      debtorMerchantIdSnapshot: obl.debtorMerchantId,
      creditorTypeSnapshot: obl.creditorType,
      creditorUserIdSnapshot: obl.creditorUserId,
      creditorMerchantIdSnapshot: obl.creditorMerchantId,
    };
  }

  private claimFingerprintFor(
    obl: ObligationRow,
    method: string,
    amount: Prisma.Decimal,
    externalReference?: string | null,
  ) {
    return fingerprintClaimPayload({
      obligationId: obl.id,
      debtorType: obl.debtorType,
      debtorUserId: obl.debtorUserId,
      debtorMerchantId: obl.debtorMerchantId,
      creditorType: obl.creditorType,
      creditorUserId: obl.creditorUserId,
      creditorMerchantId: obl.creditorMerchantId,
      amount,
      currency: obl.currency,
      method,
      externalReference,
    });
  }

  private assertFingerprint(stored: string | null, expected: string) {
    if (stored && stored !== expected) {
      throw new ConflictException({
        code: CODES.IDEMPOTENCY_CONFLICT,
        message: 'Idempotency key payload conflict',
      });
    }
  }

  // ─── totals / derived state ────────────────────────────────────────

  async computeObligationTotals(
    db: Prisma.TransactionClient | PrismaService,
    obligationId: string,
    principal: Prisma.Decimal,
  ) {
    const rows = await db.exceptionFinancialSettlement.findMany({
      where: {
        obligationId,
        status: ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
      },
      select: { acknowledgedAmount: true },
    });
    let settled = toMoney(0);
    for (const row of rows) {
      if (row.acknowledgedAmount) {
        settled = settled.add(toMoney(row.acknowledgedAmount));
      }
    }
    settled = settled.toDecimalPlaces(2);
    const remaining = toMoney(principal).sub(settled).toDecimalPlaces(2);
    const principalM = toMoney(principal);
    const derivedState = computeDerivedSettlementState(principalM, settled);
    return {
      principal: principalM,
      settledAmount: settled,
      remainingAmount: remaining.lt(0) ? toMoney(0) : remaining,
      derivedState,
    };
  }

  /**
   * Derived settlement mirror for frozen Stage12 EXCEPTION_OBLIGATION_PENDING
   * (OPEN | PARTIALLY_SETTLED). PostgreSQL rejects CANCELLED / WRITTEN_OFF
   * and any mirror value that does not match Σ ACK vs principal.
   * Financial authority remains Σ ACKNOWLEDGED vs principal.
   * Never writes CANCELLED or WRITTEN_OFF.
   */
  private async syncObligationStatusMirror(
    tx: Prisma.TransactionClient,
    obligationId: string,
    principal: Prisma.Decimal,
  ) {
    const totals = await this.computeObligationTotals(
      tx,
      obligationId,
      principal,
    );
    let status: ExceptionFinancialObligationStatus =
      ExceptionFinancialObligationStatus.OPEN;
    if (totals.derivedState === 'SETTLED') {
      status = ExceptionFinancialObligationStatus.SETTLED;
    } else if (totals.derivedState === 'PARTIALLY_SETTLED') {
      status = ExceptionFinancialObligationStatus.PARTIALLY_SETTLED;
    }
    await tx.exceptionFinancialObligation.update({
      where: { id: obligationId },
      data: { status },
    });
    return totals;
  }

  private resultShape(
    settlement: unknown,
    totals: {
      principal: Prisma.Decimal;
      settledAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
      derivedState: DerivedSettlementState;
    },
    opts?: { idempotent?: boolean; evidence?: unknown },
  ) {
    return {
      settlement,
      principal: totals.principal,
      settledAmount: totals.settledAmount,
      remainingAmount: totals.remainingAmount,
      derivedState: totals.derivedState,
      ...(opts?.idempotent != null ? { idempotent: opts.idempotent } : {}),
      ...(opts?.evidence !== undefined ? { evidence: opts.evidence } : {}),
    };
  }

  // ─── claimTransfer ─────────────────────────────────────────────────

  async claimTransfer(input: {
    obligationId: string;
    actorUserId: string;
    method: ExceptionFinancialSettlementMethod | string;
    amount: string | number;
    externalReference?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const methodRaw = String(input.method);
    if (isPlatformCustodyMethod(methodRaw)) {
      throw new BadRequestException({
        code: CODES.PLATFORM_FIREWALL,
        message:
          'WeKonnek does not take custody of funds; wallet/escrow/platform methods are forbidden',
      });
    }
    if (!TRANSFER_METHODS.has(methodRaw as never)) {
      throw new BadRequestException({
        code: CODES.INVALID_METHOD,
        message:
          'method must be DIRECT_TRANSFER, BANK_TRANSFER, or MERCHANT_QR',
      });
    }
    const method = methodRaw as ExceptionFinancialSettlementMethod;
    const amount = toMoney(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: CODES.INVALID_AMOUNT,
        message: 'amount must be positive',
      });
    }

    // Auth BEFORE idempotency disclosure.
    await this.assertNotAdminFabricating(input.actorUserId);
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUnique({
        where: { id: input.obligationId },
      });
    if (!oblPreview) {
      throw new NotFoundException({
        code: 'OBLIGATION_NOT_FOUND',
        message: 'Exception financial obligation not found',
      });
    }
    this.assertPlatformFirewall(oblPreview, method);
    const isDebtor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.debtorType,
        userId: oblPreview.debtorUserId,
        merchantId: oblPreview.debtorMerchantId,
      },
    );
    if (!isDebtor) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_DEBTOR,
        message: 'Only the obligation debtor may create a transfer claim',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const expectedFp = this.claimFingerprintFor(
      oblPreview,
      method,
      amount,
      input.externalReference,
    );

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
        where: { claimIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.obligationId !== input.obligationId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'Idempotency key is bound to a different obligation and cannot be reused',
          });
        }
        this.assertFingerprint(prior.payloadFingerprint, expectedFp);
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(prior, totals, { idempotent: true });
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const obl = await this.lockObligation(tx, input.obligationId);
            this.assertPlatformFirewall(obl, method);
            await this.assertObligationExecutable(tx, obl);

            const stillDebtor = await this.actorMatchesParty(
              tx,
              input.actorUserId,
              {
                type: obl.debtorType,
                userId: obl.debtorUserId,
                merchantId: obl.debtorMerchantId,
              },
            );
            if (!stillDebtor) {
              throw new ForbiddenException({
                code: CODES.NOT_OBLIGATION_DEBTOR,
                message: 'Only the obligation debtor may create a transfer claim',
              });
            }

            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            if (amount.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: CODES.SETTLEMENT_AMOUNT_EXCEEDS_REMAINING,
                message: 'Settlement amount exceeds remaining obligation',
              });
            }

            const now = new Date();
            const fingerprint = this.claimFingerprintFor(
              obl,
              method,
              amount,
              input.externalReference,
            );

            const settlement = await tx.exceptionFinancialSettlement.create({
              data: {
                id: randomUUID(),
                obligationId: obl.id,
                wkOrderId: obl.wkOrderId,
                ...this.snapshotFromObligation(obl),
                method,
                status: ExceptionFinancialSettlementStatus.CLAIMED,
                currency: obl.currency,
                claimedAmount: amount,
                claimedAt: now,
                claimedByType: this.actorTypeForParty(obl.debtorType),
                claimedById: input.actorUserId,
                externalReference: input.externalReference?.slice(0, 120),
                claimIdempotencyKey: idemKey,
                payloadFingerprint: fingerprint,
                correlationId: input.correlationId?.slice(0, 64),
              },
            });

            return this.resultShape(settlement, totals, { idempotent: false });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
          where: { claimIdempotencyKey: idemKey },
        });
        if (prior) {
          if (prior.obligationId !== input.obligationId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'Idempotency key is bound to a different obligation and cannot be reused',
            });
          }
          this.assertFingerprint(prior.payloadFingerprint, expectedFp);
          const obl = await this.prisma.exceptionFinancialObligation.findUniqueOrThrow(
            { where: { id: prior.obligationId } },
          );
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(prior, totals, { idempotent: true });
        }
      }
      throw err;
    }
  }

  // ─── recordCashReceipt ─────────────────────────────────────────────

  async recordCashReceipt(input: {
    obligationId: string;
    actorUserId: string;
    amount: string | number;
    externalReference?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const amount = toMoney(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: CODES.INVALID_AMOUNT,
        message: 'amount must be positive',
      });
    }

    await this.assertNotAdminFabricating(input.actorUserId);
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUnique({
        where: { id: input.obligationId },
      });
    if (!oblPreview) {
      throw new NotFoundException({
        code: 'OBLIGATION_NOT_FOUND',
        message: 'Exception financial obligation not found',
      });
    }
    this.assertPlatformFirewall(
      oblPreview,
      ExceptionFinancialSettlementMethod.CASH,
    );

    const isCreditor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.creditorType,
        userId: oblPreview.creditorUserId,
        merchantId: oblPreview.creditorMerchantId,
      },
    );
    const isDebtor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.debtorType,
        userId: oblPreview.debtorUserId,
        merchantId: oblPreview.debtorMerchantId,
      },
    );
    if (isDebtor && !isCreditor) {
      throw new ForbiddenException({
        code: CODES.CASH_DEBTOR_SELF_ACK_FORBIDDEN,
        message: 'Debtor cannot self-acknowledge cash receipt',
      });
    }
    if (!isCreditor) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_CREDITOR,
        message: 'Only the obligation creditor may record cash receipt',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const expectedFp = this.claimFingerprintFor(
      oblPreview,
      ExceptionFinancialSettlementMethod.CASH,
      amount,
      input.externalReference,
    );

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
        where: { cashIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.obligationId !== input.obligationId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'Idempotency key is bound to a different obligation and cannot be reused',
          });
        }
        this.assertFingerprint(prior.payloadFingerprint, expectedFp);
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(prior, totals, { idempotent: true });
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const obl = await this.lockObligation(tx, input.obligationId);
            this.assertPlatformFirewall(
              obl,
              ExceptionFinancialSettlementMethod.CASH,
            );
            await this.assertObligationExecutable(tx, obl);

            const stillCreditor = await this.actorMatchesParty(
              tx,
              input.actorUserId,
              {
                type: obl.creditorType,
                userId: obl.creditorUserId,
                merchantId: obl.creditorMerchantId,
              },
            );
            if (!stillCreditor) {
              throw new ForbiddenException({
                code: CODES.NOT_OBLIGATION_CREDITOR,
                message: 'Only the obligation creditor may record cash receipt',
              });
            }

            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            if (amount.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: CODES.SETTLEMENT_AMOUNT_EXCEEDS_REMAINING,
                message: 'Cash amount exceeds remaining obligation',
              });
            }

            const now = new Date();
            const fingerprint = this.claimFingerprintFor(
              obl,
              ExceptionFinancialSettlementMethod.CASH,
              amount,
              input.externalReference,
            );

            const settlement = await tx.exceptionFinancialSettlement.create({
              data: {
                id: randomUUID(),
                obligationId: obl.id,
                wkOrderId: obl.wkOrderId,
                ...this.snapshotFromObligation(obl),
                method: ExceptionFinancialSettlementMethod.CASH,
                status: ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
                currency: obl.currency,
                claimedAmount: amount,
                acknowledgedAmount: amount,
                claimedAt: now,
                claimedByType: this.actorTypeForParty(obl.creditorType),
                claimedById: input.actorUserId,
                acknowledgedAt: now,
                acknowledgedByType: this.actorTypeForParty(obl.creditorType),
                acknowledgedById: input.actorUserId,
                externalReference: input.externalReference?.slice(0, 120),
                cashIdempotencyKey: idemKey,
                payloadFingerprint: fingerprint,
                correlationId: input.correlationId?.slice(0, 64),
              },
            });

            const after = await this.syncObligationStatusMirror(
              tx,
              obl.id,
              obl.principal,
            );
            return this.resultShape(settlement, after, { idempotent: false });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
          where: { cashIdempotencyKey: idemKey },
        });
        if (prior) {
          if (prior.obligationId !== input.obligationId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'Idempotency key is bound to a different obligation and cannot be reused',
            });
          }
          this.assertFingerprint(prior.payloadFingerprint, expectedFp);
          const obl =
            await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
              where: { id: prior.obligationId },
            });
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(prior, totals, { idempotent: true });
        }
      }
      throw err;
    }
  }

  // ─── acknowledge ───────────────────────────────────────────────────

  async acknowledge(input: {
    settlementId: string;
    actorUserId: string;
    acknowledgedAmount: string | number;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const ack = toMoney(input.acknowledgedAmount);
    if (ack.lte(0)) {
      throw new BadRequestException({
        code: CODES.INVALID_AMOUNT,
        message: 'acknowledgedAmount must be positive',
      });
    }

    await this.assertNotAdminFabricating(input.actorUserId);

    const settlementPreview =
      await this.prisma.exceptionFinancialSettlement.findUnique({
        where: { id: input.settlementId },
      });
    if (!settlementPreview) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
        where: { id: settlementPreview.obligationId },
      });

    const isCreditor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.creditorType,
        userId: oblPreview.creditorUserId,
        merchantId: oblPreview.creditorMerchantId,
      },
    );
    if (!isCreditor) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_CREDITOR,
        message: 'Only the obligation creditor may acknowledge',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const expectedFp = fingerprintAckPayload({
      settlementId: input.settlementId,
      acknowledgedAmount: ack,
    });

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
        where: { ackIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.id !== input.settlementId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'ACK idempotency key is bound to a different settlement and cannot be reused',
          });
        }
        this.assertFingerprint(prior.payloadFingerprint, expectedFp);
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(prior, totals, { idempotent: true });
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const obl = await this.lockObligation(
              tx,
              settlementPreview.obligationId,
            );
            const settlement = await this.lockSettlement(
              tx,
              input.settlementId,
            );

            await this.assertObligationExecutable(tx, obl);

            const stillCreditor = await this.actorMatchesParty(
              tx,
              input.actorUserId,
              {
                type: obl.creditorType,
                userId: obl.creditorUserId,
                merchantId: obl.creditorMerchantId,
              },
            );
            if (!stillCreditor) {
              throw new ForbiddenException({
                code: CODES.NOT_OBLIGATION_CREDITOR,
                message: 'Only the obligation creditor may acknowledge',
              });
            }

            if (
              settlement.status ===
              ExceptionFinancialSettlementStatus.ACKNOWLEDGED
            ) {
              if (
                settlement.acknowledgedAmount &&
                toMoney(settlement.acknowledgedAmount).eq(ack)
              ) {
                const totals = await this.computeObligationTotals(
                  tx,
                  obl.id,
                  obl.principal,
                );
                return this.resultShape(settlement, totals, {
                  idempotent: true,
                });
              }
              throw new ConflictException({
                code: CODES.SETTLEMENT_ALREADY_RESOLVED,
                message: 'Settlement already acknowledged',
              });
            }
            if (
              settlement.status ===
                ExceptionFinancialSettlementStatus.REJECTED ||
              settlement.status === ExceptionFinancialSettlementStatus.CANCELLED
            ) {
              throw new ConflictException({
                code: CODES.SETTLEMENT_ALREADY_RESOLVED,
                message: `Settlement already ${settlement.status.toLowerCase()}`,
              });
            }
            if (
              settlement.status !== ExceptionFinancialSettlementStatus.CLAIMED
            ) {
              throw new BadRequestException({
                code: CODES.INVALID_SETTLEMENT_STATUS,
                message: `Cannot acknowledge settlement in ${settlement.status}`,
              });
            }
            if (!TRANSFER_METHODS.has(settlement.method as never)) {
              throw new BadRequestException({
                code: CODES.INVALID_METHOD,
                message: 'Only transfer claims acknowledge this way',
              });
            }
            if (
              !settlement.claimedAmount ||
              ack.gt(toMoney(settlement.claimedAmount))
            ) {
              throw new BadRequestException({
                code: CODES.AMOUNT_EXCEEDS_CLAIM,
                message: 'Acknowledged amount exceeds claimed amount',
              });
            }

            // Under lock: recompute Σ ACK and reject overpayment.
            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            if (ack.gt(totals.remainingAmount)) {
              throw new BadRequestException({
                code: CODES.SETTLEMENT_AMOUNT_EXCEEDS_REMAINING,
                message: 'Acknowledged amount exceeds remaining obligation',
              });
            }

            const updated = await tx.exceptionFinancialSettlement.update({
              where: { id: settlement.id },
              data: {
                status: ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
                acknowledgedAmount: ack,
                acknowledgedAt: new Date(),
                acknowledgedByType: this.actorTypeForParty(obl.creditorType),
                acknowledgedById: input.actorUserId,
                ackIdempotencyKey: idemKey,
                payloadFingerprint: expectedFp,
                correlationId:
                  input.correlationId?.slice(0, 64) ?? settlement.correlationId,
              },
            });

            const after = await this.syncObligationStatusMirror(
              tx,
              obl.id,
              obl.principal,
            );
            return this.resultShape(updated, after, { idempotent: false });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
          where: { ackIdempotencyKey: idemKey },
        });
        if (prior) {
          if (prior.id !== input.settlementId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'ACK idempotency key is bound to a different settlement and cannot be reused',
            });
          }
          this.assertFingerprint(prior.payloadFingerprint, expectedFp);
          const obl =
            await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
              where: { id: prior.obligationId },
            });
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(prior, totals, { idempotent: true });
        }
      }
      throw err;
    }
  }

  // ─── reject ────────────────────────────────────────────────────────

  async reject(input: {
    settlementId: string;
    actorUserId: string;
    reason?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    await this.assertNotAdminFabricating(input.actorUserId);

    const settlementPreview =
      await this.prisma.exceptionFinancialSettlement.findUnique({
        where: { id: input.settlementId },
      });
    if (!settlementPreview) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
        where: { id: settlementPreview.obligationId },
      });

    const isCreditor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.creditorType,
        userId: oblPreview.creditorUserId,
        merchantId: oblPreview.creditorMerchantId,
      },
    );
    if (!isCreditor) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_CREDITOR,
        message: 'Only the obligation creditor may reject',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const expectedFp = fingerprintRejectPayload({
      settlementId: input.settlementId,
      reason: input.reason,
    });

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
        where: { rejectIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.id !== input.settlementId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'Reject idempotency key is bound to a different settlement and cannot be reused',
          });
        }
        this.assertFingerprint(prior.payloadFingerprint, expectedFp);
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(prior, totals, { idempotent: true });
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const obl = await this.lockObligation(
              tx,
              settlementPreview.obligationId,
            );
            const settlement = await this.lockSettlement(
              tx,
              input.settlementId,
            );

            const stillCreditor = await this.actorMatchesParty(
              tx,
              input.actorUserId,
              {
                type: obl.creditorType,
                userId: obl.creditorUserId,
                merchantId: obl.creditorMerchantId,
              },
            );
            if (!stillCreditor) {
              throw new ForbiddenException({
                code: CODES.NOT_OBLIGATION_CREDITOR,
                message: 'Only the obligation creditor may reject',
              });
            }

            if (
              settlement.status === ExceptionFinancialSettlementStatus.REJECTED
            ) {
              const totals = await this.computeObligationTotals(
                tx,
                obl.id,
                obl.principal,
              );
              return this.resultShape(settlement, totals, { idempotent: true });
            }
            if (
              settlement.status ===
                ExceptionFinancialSettlementStatus.ACKNOWLEDGED ||
              settlement.status === ExceptionFinancialSettlementStatus.CANCELLED
            ) {
              throw new ConflictException({
                code: CODES.SETTLEMENT_ALREADY_RESOLVED,
                message: `Cannot reject settlement in ${settlement.status}`,
              });
            }
            if (
              settlement.status !== ExceptionFinancialSettlementStatus.CLAIMED
            ) {
              throw new BadRequestException({
                code: CODES.INVALID_SETTLEMENT_STATUS,
                message: `Cannot reject settlement in ${settlement.status}`,
              });
            }

            const updated = await tx.exceptionFinancialSettlement.update({
              where: { id: settlement.id },
              data: {
                status: ExceptionFinancialSettlementStatus.REJECTED,
                rejectedAt: new Date(),
                rejectedByType: this.actorTypeForParty(obl.creditorType),
                rejectedById: input.actorUserId,
                rejectionReason: input.reason?.slice(0, 255) ?? null,
                rejectIdempotencyKey: idemKey,
                payloadFingerprint: expectedFp,
                correlationId:
                  input.correlationId?.slice(0, 64) ?? settlement.correlationId,
              },
            });

            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            return this.resultShape(updated, totals, { idempotent: false });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
          where: { rejectIdempotencyKey: idemKey },
        });
        if (prior) {
          if (prior.id !== input.settlementId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'Reject idempotency key is bound to a different settlement and cannot be reused',
            });
          }
          this.assertFingerprint(prior.payloadFingerprint, expectedFp);
          const obl =
            await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
              where: { id: prior.obligationId },
            });
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(prior, totals, { idempotent: true });
        }
      }
      throw err;
    }
  }

  // ─── cancelClaim ───────────────────────────────────────────────────

  async cancelClaim(input: {
    settlementId: string;
    actorUserId: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    await this.assertNotAdminFabricating(input.actorUserId);

    const settlementPreview =
      await this.prisma.exceptionFinancialSettlement.findUnique({
        where: { id: input.settlementId },
      });
    if (!settlementPreview) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
        where: { id: settlementPreview.obligationId },
      });

    // Only the claimer (debtor who created the claim) may cancel.
    if (settlementPreview.claimedById !== input.actorUserId) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_DEBTOR,
        message: 'Only the claimer (debtor) who created the claim may cancel it',
      });
    }
    const isDebtor = await this.actorMatchesParty(
      this.prisma,
      input.actorUserId,
      {
        type: oblPreview.debtorType,
        userId: oblPreview.debtorUserId,
        merchantId: oblPreview.debtorMerchantId,
      },
    );
    if (!isDebtor) {
      throw new ForbiddenException({
        code: CODES.NOT_OBLIGATION_DEBTOR,
        message: 'Only the obligation debtor may cancel a transfer claim',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const expectedFp = fingerprintCancelPayload(input.settlementId);

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
        where: { cancelIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.id !== input.settlementId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'Cancel idempotency key is bound to a different settlement and cannot be reused',
          });
        }
        this.assertFingerprint(prior.payloadFingerprint, expectedFp);
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(prior, totals, { idempotent: true });
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const obl = await this.lockObligation(
              tx,
              settlementPreview.obligationId,
            );
            const settlement = await this.lockSettlement(
              tx,
              input.settlementId,
            );

            if (settlement.claimedById !== input.actorUserId) {
              throw new ForbiddenException({
                code: CODES.NOT_OBLIGATION_DEBTOR,
                message:
                  'Only the claimer (debtor) who created the claim may cancel it',
              });
            }

            if (
              settlement.status === ExceptionFinancialSettlementStatus.CANCELLED
            ) {
              const totals = await this.computeObligationTotals(
                tx,
                obl.id,
                obl.principal,
              );
              return this.resultShape(settlement, totals, { idempotent: true });
            }
            if (
              settlement.status !== ExceptionFinancialSettlementStatus.CLAIMED
            ) {
              throw new ConflictException({
                code: CODES.SETTLEMENT_ALREADY_RESOLVED,
                message: `Cannot cancel settlement in ${settlement.status}`,
              });
            }

            const updated = await tx.exceptionFinancialSettlement.update({
              where: { id: settlement.id },
              data: {
                status: ExceptionFinancialSettlementStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByType: this.actorTypeForParty(obl.debtorType),
                cancelledById: input.actorUserId,
                cancelIdempotencyKey: idemKey,
                payloadFingerprint: expectedFp,
                correlationId:
                  input.correlationId?.slice(0, 64) ?? settlement.correlationId,
              },
            });

            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            return this.resultShape(updated, totals, { idempotent: false });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.exceptionFinancialSettlement.findFirst({
          where: { cancelIdempotencyKey: idemKey },
        });
        if (prior) {
          if (prior.id !== input.settlementId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'Cancel idempotency key is bound to a different settlement and cannot be reused',
            });
          }
          this.assertFingerprint(prior.payloadFingerprint, expectedFp);
          const obl =
            await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
              where: { id: prior.obligationId },
            });
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(prior, totals, { idempotent: true });
        }
      }
      throw err;
    }
  }

  // ─── attachEvidence ────────────────────────────────────────────────

  async attachEvidence(input: {
    settlementId: string;
    actorUserId: string;
    kind: ExceptionFinancialSettlementEvidenceKind | string;
    storageReference: string;
    note?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const kindRaw = String(input.kind);
    if (
      !(
        Object.values(ExceptionFinancialSettlementEvidenceKind) as string[]
      ).includes(kindRaw)
    ) {
      throw new BadRequestException({
        code: CODES.INVALID_METHOD,
        message: `Invalid evidence kind ${kindRaw}`,
      });
    }
    const kind = kindRaw as ExceptionFinancialSettlementEvidenceKind;
    const storageReference = input.storageReference?.trim();
    if (!storageReference) {
      throw new BadRequestException({
        code: CODES.INVALID_AMOUNT,
        message: 'storageReference is required',
      });
    }

    const settlementPreview =
      await this.prisma.exceptionFinancialSettlement.findUnique({
        where: { id: input.settlementId },
      });
    if (!settlementPreview) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    const oblPreview =
      await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
        where: { id: settlementPreview.obligationId },
      });

    // Auth before idempotency disclosure (parties or admin who can view).
    const viewer = await this.resolveViewerRole(oblPreview, input.actorUserId);
    this.assertCanView(viewer);

    const idemKey = this.truncKey(input.idempotencyKey);

    if (idemKey) {
      const prior = await this.prisma.exceptionFinancialSettlementEvidence.findFirst(
        {
          where: { idempotencyKey: idemKey },
        },
      );
      if (prior) {
        if (prior.settlementId !== input.settlementId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message:
              'Evidence idempotency key is bound to a different settlement and cannot be reused',
          });
        }
        // Replay when storage/kind match the prior row semantics.
        if (
          prior.kind !== kind ||
          prior.storageReference !== storageReference.slice(0, 1000) ||
          (prior.note ?? null) !== (input.note?.slice(0, 2000) ?? null)
        ) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CONFLICT,
            message: 'Idempotency key payload conflict',
          });
        }
        const totals = await this.computeObligationTotals(
          this.prisma,
          oblPreview.id,
          oblPreview.principal,
        );
        return this.resultShape(settlementPreview, totals, {
          idempotent: true,
          evidence: prior,
        });
      }
    }

    const uploadedByType =
      viewer === 'ADMIN'
        ? OrderDomainActorType.SYSTEM_ADMIN
        : viewer === 'DEBTOR'
          ? this.actorTypeForParty(oblPreview.debtorType)
          : this.actorTypeForParty(oblPreview.creditorType);

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            // Obligation first, then settlement — evidence does not change status.
            const obl = await this.lockObligation(
              tx,
              settlementPreview.obligationId,
            );
            const settlement = await this.lockSettlement(
              tx,
              input.settlementId,
            );

            const evidence =
              await tx.exceptionFinancialSettlementEvidence.create({
                data: {
                  id: randomUUID(),
                  settlementId: settlement.id,
                  kind,
                  storageReference: storageReference.slice(0, 1000),
                  note: input.note?.slice(0, 2000) ?? null,
                  uploadedByType,
                  uploadedById: input.actorUserId,
                  correlationId: input.correlationId?.slice(0, 64) ?? null,
                  idempotencyKey: idemKey,
                },
              });

            const totals = await this.computeObligationTotals(
              tx,
              obl.id,
              obl.principal,
            );
            return this.resultShape(settlement, totals, {
              idempotent: false,
              evidence,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        idemKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior =
          await this.prisma.exceptionFinancialSettlementEvidence.findFirst({
            where: { idempotencyKey: idemKey },
          });
        if (prior) {
          if (prior.settlementId !== input.settlementId) {
            throw new ConflictException({
              code: CODES.IDEMPOTENCY_CONFLICT,
              message:
                'Evidence idempotency key is bound to a different settlement and cannot be reused',
            });
          }
          const settlement =
            await this.prisma.exceptionFinancialSettlement.findUniqueOrThrow({
              where: { id: prior.settlementId },
            });
          const obl =
            await this.prisma.exceptionFinancialObligation.findUniqueOrThrow({
              where: { id: settlement.obligationId },
            });
          const totals = await this.computeObligationTotals(
            this.prisma,
            obl.id,
            obl.principal,
          );
          return this.resultShape(settlement, totals, {
            idempotent: true,
            evidence: prior,
          });
        }
      }
      throw err;
    }
  }

  // ─── reads ─────────────────────────────────────────────────────────

  async getSettlement(settlementId: string, actorUserId: string) {
    const settlement =
      await this.prisma.exceptionFinancialSettlement.findUnique({
        where: { id: settlementId },
        include: { evidence: { orderBy: { createdAt: 'asc' } } },
      });
    if (!settlement) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Exception financial settlement not found',
      });
    }
    const obl = await this.prisma.exceptionFinancialObligation.findUniqueOrThrow(
      {
        where: { id: settlement.obligationId },
      },
    );
    const viewer = await this.resolveViewerRole(obl, actorUserId);
    this.assertCanView(viewer);

    const totals = await this.computeObligationTotals(
      this.prisma,
      obl.id,
      obl.principal,
    );
    return this.resultShape(settlement, totals, {
      evidence: settlement.evidence,
    });
  }

  async getObligationSettlementSummary(
    obligationId: string,
    actorUserId: string,
  ) {
    const obl = await this.prisma.exceptionFinancialObligation.findUnique({
      where: { id: obligationId },
    });
    if (!obl) {
      throw new NotFoundException({
        code: 'OBLIGATION_NOT_FOUND',
        message: 'Exception financial obligation not found',
      });
    }
    const viewer = await this.resolveViewerRole(obl, actorUserId);
    this.assertCanView(viewer);

    const totals = await this.computeObligationTotals(
      this.prisma,
      obl.id,
      obl.principal,
    );
    const settlements = await this.prisma.exceptionFinancialSettlement.findMany(
      {
        where: { obligationId: obl.id },
        orderBy: { createdAt: 'asc' },
        include: { evidence: { orderBy: { createdAt: 'asc' } } },
      },
    );

    return {
      obligation: obl,
      settlements,
      principal: totals.principal,
      settledAmount: totals.settledAmount,
      remainingAmount: totals.remainingAmount,
      derivedState: totals.derivedState,
    };
  }
}
