/**
 * Stage13B-1 Rider Advance reimbursement read adapter.
 *
 * Inclusion (executable items):
 *   reimbursementPrincipal != null AND reimbursementPrincipal > 0
 *   AND status != CANCELLED
 *
 * Omitted from executable items:
 *   CANCELLED rows (non-financial after cancel)
 *   reimbursementPrincipal null (not yet an executable principal — never invented)
 *   reimbursementPrincipal <= 0
 *
 * Multiple RiderAdvance rows on one wkOrderId are NEVER collapsed and NEVER
 * reduced to findFirst/latest. Each qualifying row is its own item.
 *
 * PostgreSQL partial unique index rider_advances_active_wk_order_id_key
 * allows at most one non-CANCELLED row per wk_order_id. CANCELLED historical
 * rows may coexist. findMany still loads every row so a cancelled sibling
 * cannot hide an active obligation (and we never merge principals).
 *
 * Creditor is RiderAdvance.riderId — never fulfillment active/custodian rider.
 * Collection restriction reduces collectibleRemaining only.
 */
import {
  Prisma,
  RiderAdvanceStatus,
  RiderAdvanceSettlementStatus,
  RiderAdvanceCollectionRestrictionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  collectibleRemainingAmount,
  customerParty,
  deriveFinancialState,
  flagsFromState,
  lastActivityAt,
  remainingAmount,
  riderParty,
  sumAcknowledgedAmounts,
  sumActiveRestrictedAmounts,
  toMoney,
} from './financial-reconciliation.policy';
import {
  FinancialReconciliationItem,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

export type ReconciliationDb = PrismaService | Prisma.TransactionClient;

export type RiderAdvanceSettlementReadRow = {
  id: string;
  status: RiderAdvanceSettlementStatus | string;
  acknowledgedAmount: Prisma.Decimal | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

export type RiderAdvanceRestrictionReadRow = {
  id: string;
  status: RiderAdvanceCollectionRestrictionStatus | string;
  restrictedAmount: Prisma.Decimal;
};

export type RiderAdvanceReadRow = {
  id: string;
  wkOrderId: number;
  customerId: string;
  riderId: string;
  reimbursementPrincipal: Prisma.Decimal | null;
  currency: string;
  status: RiderAdvanceStatus | string;
  disputeReason: string | null;
  createdAt: Date;
  settlements: RiderAdvanceSettlementReadRow[];
  collectionRestrictions: RiderAdvanceRestrictionReadRow[];
};

export function isExecutableRiderAdvance(ra: {
  reimbursementPrincipal: Prisma.Decimal | null;
  status: string;
}): boolean {
  if (ra.status === RiderAdvanceStatus.CANCELLED) return false;
  if (ra.reimbursementPrincipal == null) return false;
  return toMoney(ra.reimbursementPrincipal).gt(0);
}

export function buildRiderAdvanceReimbursementItem(
  ra: RiderAdvanceReadRow,
): FinancialReconciliationItem | null {
  if (!isExecutableRiderAdvance(ra)) return null;

  const principal = toMoney(ra.reimbursementPrincipal);
  const settled = sumAcknowledgedAmounts(ra.settlements);
  const remaining = remainingAmount(principal, settled);
  const restricted = sumActiveRestrictedAmounts(ra.collectionRestrictions);
  const collectible = collectibleRemainingAmount(
    principal,
    settled,
    restricted,
  );
  const disputed = ra.status === RiderAdvanceStatus.DISPUTED;
  const collectionRestricted = restricted.gt(0);

  return {
    rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    obligationId: ra.id,
    wkOrderId: ra.wkOrderId,
    debtor: customerParty(ra.customerId),
    creditor: riderParty(ra.riderId),
    originalPrincipal: principal,
    settledAmount: settled,
    remainingAmount: remaining,
    collectibleRemaining: collectible,
    currency: ra.currency,
    financialState: deriveFinancialState(principal, settled),
    flags: flagsFromState({
      disputed,
      collectionRestricted,
      reconciliationState: 'CLEAR',
    }),
    reasonCode: ra.status,
    sourceType: 'RIDER_ADVANCE',
    sourceId: ra.id,
    riderAdvanceId: ra.id,
    disputeState: disputed ? (ra.disputeReason ?? ra.status) : ra.status,
    reconciliationState: 'CLEAR',
    sourceRefs: {
      settlementIds: ra.settlements.map((s) => s.id),
      acknowledgedSettlementIds: ra.settlements
        .filter((s) => s.status === RiderAdvanceSettlementStatus.ACKNOWLEDGED)
        .map((s) => s.id),
      coverageIds: [],
    },
    createdAt: ra.createdAt,
    lastFinancialActivityAt: lastActivityAt(ra.createdAt, ra.settlements),
  };
}

export async function loadRiderAdvanceReimbursementItems(
  db: ReconciliationDb,
  wkOrderId: number,
): Promise<FinancialReconciliationItem[]> {
  const rows = await db.riderAdvance.findMany({
    where: { wkOrderId },
    orderBy: { createdAt: 'asc' },
    include: {
      settlements: { orderBy: { createdAt: 'asc' } },
      collectionRestrictions: { orderBy: { createdAt: 'asc' } },
    },
  });
  const items: FinancialReconciliationItem[] = [];
  for (const ra of rows) {
    const item = buildRiderAdvanceReimbursementItem(ra);
    if (item) items.push(item);
  }
  return items;
}
