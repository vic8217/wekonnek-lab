/**
 * Stage13B-1 Exception Financial (Stage12 principal / Stage13A ACK) read adapter.
 *
 * One item per ExceptionFinancialObligation.
 * Principal is the frozen obligation principal (never rewritten).
 * Settled = Σ ACKNOWLEDGED.acknowledgedAmount only.
 * Coverage is attached as sourceRefs.coverageIds and MUST NOT change money.
 *
 * FINALIZED successor (adjustmentOfDeterminationId) flags the original:
 *   nonExecutable, reconciliationRequired, SUCCESSOR_REVIEW_REQUIRED
 * Historical principal and ACK are preserved. ACK is never moved or netted.
 */
import {
  ExceptionFinancialObligationStatus,
  ExceptionFinancialSettlementStatus,
  LiabilityDeterminationStatus,
  Prisma,
} from '@prisma/client';
import {
  deriveFinancialState,
  flagsFromState,
  lastActivityAt,
  partyFromFields,
  remainingAmount,
  sumAcknowledgedAmounts,
  toMoney,
} from './financial-reconciliation.policy';
import { ReconciliationDb } from './rider-advance-reimbursement.adapter';
import {
  FinancialReconciliationItem,
  RAIL_EXCEPTION_FINANCIAL,
  ReconciliationRelatedItem,
  ReconciliationState,
} from './financial-reconciliation.types';

export type ExceptionSettlementReadRow = {
  id: string;
  status: ExceptionFinancialSettlementStatus | string;
  acknowledgedAmount: Prisma.Decimal | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

export type ExceptionObligationReadRow = {
  id: string;
  liabilityDeterminationId: string;
  exceptionClaimId: string;
  economicLossId: string;
  wkOrderId: number;
  debtorType: string;
  debtorUserId: string | null;
  debtorMerchantId: number | null;
  creditorType: string;
  creditorUserId: string | null;
  creditorMerchantId: number | null;
  principal: Prisma.Decimal;
  currency: string;
  status: ExceptionFinancialObligationStatus | string;
  reason: string | null;
  createdAt: Date;
  settlements: ExceptionSettlementReadRow[];
};

export type ExceptionSuccessorContext = {
  successorDeterminationId: string | null;
  successorObligationIds: string[];
};

export function buildExceptionFinancialItem(
  obl: ExceptionObligationReadRow,
  successor: ExceptionSuccessorContext,
  coverageIds: string[],
): FinancialReconciliationItem {
  const principal = toMoney(obl.principal);
  const settled = sumAcknowledgedAmounts(obl.settlements);
  const remaining = remainingAmount(principal, settled);
  const reservedNonExecutable =
    obl.status === ExceptionFinancialObligationStatus.CANCELLED ||
    obl.status === ExceptionFinancialObligationStatus.WRITTEN_OFF;
  const successorBlocks = successor.successorDeterminationId != null;
  const nonExecutable = reservedNonExecutable || successorBlocks;
  const reconciliationState: ReconciliationState = successorBlocks
    ? 'SUCCESSOR_REVIEW_REQUIRED'
    : 'CLEAR';

  const relatedItems: ReconciliationRelatedItem[] | undefined = successorBlocks
    ? successor.successorObligationIds.map((id) => ({
        rail: RAIL_EXCEPTION_FINANCIAL,
        obligationId: id,
        relation: 'SUCCESSOR' as const,
      }))
    : undefined;

  return {
    rail: RAIL_EXCEPTION_FINANCIAL,
    obligationId: obl.id,
    wkOrderId: obl.wkOrderId,
    debtor: partyFromFields({
      type: obl.debtorType,
      userId: obl.debtorUserId,
      merchantId: obl.debtorMerchantId,
    }),
    creditor: partyFromFields({
      type: obl.creditorType,
      userId: obl.creditorUserId,
      merchantId: obl.creditorMerchantId,
    }),
    originalPrincipal: principal,
    settledAmount: settled,
    remainingAmount: remaining,
    currency: obl.currency,
    financialState: deriveFinancialState(principal, settled),
    flags: flagsFromState({
      nonExecutable,
      reconciliationState,
    }),
    reasonCode: obl.reason ?? undefined,
    sourceType: 'EXCEPTION_FINANCIAL_OBLIGATION',
    sourceId: obl.id,
    economicLossId: obl.economicLossId,
    determinationId: obl.liabilityDeterminationId,
    reconciliationState,
    relatedItems:
      relatedItems && relatedItems.length > 0 ? relatedItems : undefined,
    sourceRefs: {
      settlementIds: obl.settlements.map((s) => s.id),
      acknowledgedSettlementIds: obl.settlements
        .filter(
          (s) => s.status === ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
        )
        .map((s) => s.id),
      coverageIds,
      successorDeterminationId: successor.successorDeterminationId ?? undefined,
    },
    createdAt: obl.createdAt,
    lastFinancialActivityAt: lastActivityAt(obl.createdAt, obl.settlements),
  };
}

export async function loadExceptionFinancialItems(
  db: ReconciliationDb,
  wkOrderId: number,
): Promise<FinancialReconciliationItem[]> {
  const obligations = await db.exceptionFinancialObligation.findMany({
    where: { wkOrderId },
    orderBy: { createdAt: 'asc' },
    include: {
      settlements: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (obligations.length === 0) return [];

  const determinationIds = [
    ...new Set(obligations.map((o) => o.liabilityDeterminationId)),
  ];
  const successors = await db.liabilityDetermination.findMany({
    where: {
      adjustmentOfDeterminationId: { in: determinationIds },
      status: LiabilityDeterminationStatus.FINALIZED,
    },
    select: {
      id: true,
      adjustmentOfDeterminationId: true,
      obligations: { select: { id: true } },
    },
  });
  const successorBySource = new Map<string, ExceptionSuccessorContext>();
  for (const s of successors) {
    if (!s.adjustmentOfDeterminationId) continue;
    const prev = successorBySource.get(s.adjustmentOfDeterminationId);
    const obligationIds = s.obligations.map((o) => o.id);
    if (!prev) {
      successorBySource.set(s.adjustmentOfDeterminationId, {
        successorDeterminationId: s.id,
        successorObligationIds: obligationIds,
      });
    } else {
      prev.successorObligationIds.push(...obligationIds);
    }
  }

  const lossIds = [...new Set(obligations.map((o) => o.economicLossId))];
  const coverages = await db.economicLossCoverage.findMany({
    where: { economicLossId: { in: lossIds } },
    select: { id: true, economicLossId: true },
  });
  const coverageIdsByLoss = new Map<string, string[]>();
  for (const c of coverages) {
    const list = coverageIdsByLoss.get(c.economicLossId) ?? [];
    list.push(c.id);
    coverageIdsByLoss.set(c.economicLossId, list);
  }

  return obligations.map((obl) =>
    buildExceptionFinancialItem(
      obl,
      successorBySource.get(obl.liabilityDeterminationId) ?? {
        successorDeterminationId: null,
        successorObligationIds: [],
      },
      coverageIdsByLoss.get(obl.economicLossId) ?? [],
    ),
  );
}
