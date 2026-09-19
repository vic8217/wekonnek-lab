/**
 * Stage13B-2 bounded order-level read context.
 * RepeatableRead transaction client only. No writes. No N+1. Single order.
 */
import {
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  LiabilityDeterminationStatus,
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  RiderAdvanceCollectionRestrictionStatus,
} from '@prisma/client';
import { ReconciliationDb } from './rider-advance-reimbursement.adapter';

export const PATH_RIDER_ADVANCE = 'RIDER_ADVANCE';
export const PATH_ORDINARY_MERCHANT_PAYMENT = 'ORDINARY_MERCHANT_PAYMENT';

export type DetectorReturnObligation = {
  id: string;
  type: ReturnFinancialObligationType | string;
  principal: Prisma.Decimal;
  currency: string;
  creditorUserId: string;
};

export type DetectorReturnDetermination = {
  id: string;
  path: string;
  riderAdvanceId: string | null;
  snapshotPrincipal: Prisma.Decimal | null;
  snapshotReimbursed: Prisma.Decimal | null;
  merchantToRiderAmount: Prisma.Decimal | null;
  merchantToCustomerAmount: Prisma.Decimal | null;
  currency: string;
  obligations: DetectorReturnObligation[];
};

export type DetectorRestriction = {
  id: string;
  riderAdvanceId: string;
  returnFinancialDeterminationId: string;
  restrictedAmount: Prisma.Decimal;
  status: RiderAdvanceCollectionRestrictionStatus | string;
};

export type DetectorRiderAdvance = {
  id: string;
  riderId: string;
  reimbursementPrincipal: Prisma.Decimal | null;
  currency: string;
  status: string;
};

export type DetectorEconomicLoss = {
  id: string;
  lossKind: EconomicLossKind;
  subjectRef: string;
  currency: string;
  compensableAmount: Prisma.Decimal;
};

export type DetectorCoverage = {
  id: string;
  economicLossId: string;
  sourceKind: EconomicLossCoverageSourceKind;
  sourceRef: string;
  stage9ObligationId: string | null;
  subjectRefSnapshot: string;
  amount: Prisma.Decimal;
  currency: string;
  createdAt: Date;
};

export type DetectorLiabilityDetermination = {
  id: string;
  economicLossId: string;
  status: LiabilityDeterminationStatus | string;
  adjustmentOfDeterminationId: string | null;
  obligationIds: string[];
};

export type ReconciliationReadContext = {
  wkOrderId: number;
  riderAdvances: DetectorRiderAdvance[];
  returnDeterminations: DetectorReturnDetermination[];
  restrictions: DetectorRestriction[];
  economicLosses: DetectorEconomicLoss[];
  coverages: DetectorCoverage[];
  liabilityDeterminations: DetectorLiabilityDetermination[];
};

/**
 * Bounded extra reads for detectors. Call inside the same RepeatableRead
 * transaction as the Stage13B-1 adapters.
 *
 * Query shape (single wkOrderId):
 *  1. riderAdvance.findMany
 *  2. returnFinancialDetermination.findMany FINALIZED + obligations
 *  3. riderAdvanceCollectionRestriction.findMany
 *  4. economicLoss.findMany
 *  5. economicLossCoverage.findMany by loss ids
 *  6. liabilityDetermination.findMany by loss ids + obligation ids
 */
export async function loadReconciliationReadContext(
  db: ReconciliationDb,
  wkOrderId: number,
): Promise<ReconciliationReadContext> {
  const [riderAdvances, returnDeterminations, restrictions, economicLosses] =
    await Promise.all([
      db.riderAdvance.findMany({
        where: { wkOrderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          riderId: true,
          reimbursementPrincipal: true,
          currency: true,
          status: true,
        },
      }),
      db.returnFinancialDetermination.findMany({
        where: {
          wkOrderId,
          status: ReturnFinancialDeterminationStatus.FINALIZED,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          path: true,
          riderAdvanceId: true,
          snapshotPrincipal: true,
          snapshotReimbursed: true,
          merchantToRiderAmount: true,
          merchantToCustomerAmount: true,
          currency: true,
          obligations: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              type: true,
              principal: true,
              currency: true,
              creditorUserId: true,
            },
          },
        },
      }),
      db.riderAdvanceCollectionRestriction.findMany({
        where: { wkOrderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          riderAdvanceId: true,
          returnFinancialDeterminationId: true,
          restrictedAmount: true,
          status: true,
        },
      }),
      db.economicLoss.findMany({
        where: { wkOrderId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          lossKind: true,
          subjectRef: true,
          currency: true,
          compensableAmount: true,
        },
      }),
    ]);

  const lossIds = economicLosses.map((l) => l.id);
  const [coverages, liabilityDeterminations] =
    lossIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.economicLossCoverage.findMany({
            where: { economicLossId: { in: lossIds } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              economicLossId: true,
              sourceKind: true,
              sourceRef: true,
              stage9ObligationId: true,
              subjectRefSnapshot: true,
              amount: true,
              currency: true,
              createdAt: true,
            },
          }),
          db.liabilityDetermination.findMany({
            where: { economicLossId: { in: lossIds } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              economicLossId: true,
              status: true,
              adjustmentOfDeterminationId: true,
              obligations: { select: { id: true } },
            },
          }),
        ]);

  return {
    wkOrderId,
    riderAdvances,
    returnDeterminations,
    restrictions,
    economicLosses,
    coverages,
    liabilityDeterminations: liabilityDeterminations.map((d) => ({
      id: d.id,
      economicLossId: d.economicLossId,
      status: d.status,
      adjustmentOfDeterminationId: d.adjustmentOfDeterminationId,
      obligationIds: d.obligations.map((o) => o.id),
    })),
  };
}
