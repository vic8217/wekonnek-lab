/**
 * Stage13B-1 Return Financial read adapter.
 *
 * Executable items: ReturnFinancialObligation whose determination is FINALIZED.
 * PENDING / PROPOSED / ACKNOWLEDGED / DISPUTED / CANCELLED determinations do
 * not contribute executable principal.
 *
 * One item per obligation. Directions are never collapsed.
 * Remaining = max(0, obligation.principal − Σ Stage9 ACK).
 * Stage5B ACK is not subtracted again (already encoded in P−R / R at FINALIZE).
 *
 * Creditor rider is obligation.creditorUserId (RA rider at finalize).
 */
import {
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialSettlementStatus,
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
  RAIL_RETURN_FINANCIAL,
} from './financial-reconciliation.types';

export type ReturnFinancialSettlementReadRow = {
  id: string;
  status: ReturnFinancialSettlementStatus | string;
  acknowledgedAmount: Prisma.Decimal | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

export type ReturnFinancialObligationReadRow = {
  id: string;
  determinationId: string;
  wkOrderId: number;
  merchantId: number;
  type: string;
  debtorType: string;
  debtorUserId: string | null;
  debtorMerchantId: number | null;
  creditorType: string;
  creditorUserId: string;
  principal: Prisma.Decimal;
  currency: string;
  reason: string | null;
  createdAt: Date;
  settlements: ReturnFinancialSettlementReadRow[];
};

export function isExecutableReturnDetermination(status: string): boolean {
  return status === ReturnFinancialDeterminationStatus.FINALIZED;
}

export function buildReturnFinancialItem(
  obl: ReturnFinancialObligationReadRow,
  riderAdvanceId: string | null,
): FinancialReconciliationItem {
  const principal = toMoney(obl.principal);
  const settled = sumAcknowledgedAmounts(obl.settlements);
  const remaining = remainingAmount(principal, settled);

  return {
    rail: RAIL_RETURN_FINANCIAL,
    obligationId: obl.id,
    wkOrderId: obl.wkOrderId,
    debtor: partyFromFields({
      type: obl.debtorType,
      userId: obl.debtorUserId,
      merchantId: obl.debtorMerchantId ?? obl.merchantId,
    }),
    creditor: partyFromFields({
      type: obl.creditorType,
      userId: obl.creditorUserId,
      merchantId: null,
    }),
    originalPrincipal: principal,
    settledAmount: settled,
    remainingAmount: remaining,
    currency: obl.currency,
    financialState: deriveFinancialState(principal, settled),
    flags: flagsFromState({ reconciliationState: 'CLEAR' }),
    reasonCode: obl.reason ?? obl.type,
    sourceType: 'RETURN_FINANCIAL_OBLIGATION',
    sourceId: obl.id,
    determinationId: obl.determinationId,
    riderAdvanceId: riderAdvanceId ?? undefined,
    returnFinancialDeterminationId: obl.determinationId,
    reconciliationState: 'CLEAR',
    sourceRefs: {
      settlementIds: obl.settlements.map((s) => s.id),
      acknowledgedSettlementIds: obl.settlements
        .filter((s) => s.status === ReturnFinancialSettlementStatus.ACKNOWLEDGED)
        .map((s) => s.id),
      coverageIds: [],
    },
    createdAt: obl.createdAt,
    lastFinancialActivityAt: lastActivityAt(obl.createdAt, obl.settlements),
  };
}

export async function loadReturnFinancialItems(
  db: ReconciliationDb,
  wkOrderId: number,
): Promise<FinancialReconciliationItem[]> {
  const determinations = await db.returnFinancialDetermination.findMany({
    where: {
      wkOrderId,
      status: ReturnFinancialDeterminationStatus.FINALIZED,
    },
    orderBy: { createdAt: 'asc' },
    include: {
      obligations: {
        orderBy: { createdAt: 'asc' },
        include: { settlements: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });

  const items: FinancialReconciliationItem[] = [];
  for (const det of determinations) {
    if (!isExecutableReturnDetermination(det.status)) continue;
    for (const obl of det.obligations) {
      items.push(buildReturnFinancialItem(obl, det.riderAdvanceId));
    }
  }
  return items;
}
