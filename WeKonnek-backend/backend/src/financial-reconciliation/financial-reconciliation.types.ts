import { Prisma } from '@prisma/client';

/**
 * Stage13B-1 canonical READ representation.
 * Not persisted. Not a financial authority. Adapters derive from frozen rails.
 */

export const RAIL_RIDER_ADVANCE_REIMBURSEMENT =
  'RIDER_ADVANCE_REIMBURSEMENT' as const;
export const RAIL_RETURN_FINANCIAL = 'RETURN_FINANCIAL' as const;
export const RAIL_EXCEPTION_FINANCIAL = 'EXCEPTION_FINANCIAL' as const;

export type FinancialRailId =
  | typeof RAIL_RIDER_ADVANCE_REIMBURSEMENT
  | typeof RAIL_RETURN_FINANCIAL
  | typeof RAIL_EXCEPTION_FINANCIAL;

export const FINANCIAL_RAIL_IDS: readonly FinancialRailId[] = [
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RAIL_RETURN_FINANCIAL,
  RAIL_EXCEPTION_FINANCIAL,
];

export type ReconciliationPartyType = 'CUSTOMER' | 'MERCHANT' | 'RIDER';

/**
 * Normalized read-only party. Merchant economic identity is merchantId.
 * userId is never substituted for merchantId. PLATFORM is not a party.
 */
export type NormalizedParty = {
  type: ReconciliationPartyType;
  userId: string | null;
  merchantId: number | null;
};

export type DerivedFinancialState =
  | 'UNPAID'
  | 'PARTIALLY_SETTLED'
  | 'SETTLED';

export type ReconciliationState =
  | 'CLEAR'
  | 'SUCCESSOR_REVIEW_REQUIRED'
  | 'OVERLAP_REVIEW_REQUIRED'
  | 'COVERAGE_REVIEW_REQUIRED'
  | 'SOURCE_INCONSISTENCY'
  | 'REVIEW_REQUIRED';

export type ReconciliationFlags = {
  disputed: boolean;
  nonExecutable: boolean;
  collectionRestricted: boolean;
  reconciliationRequired: boolean;
};

export type ReconciliationRelatedItem = {
  rail: FinancialRailId;
  obligationId: string;
  relation: 'SUCCESSOR' | 'SUCCESSOR_OF';
};

export type ReconciliationSourceRefs = {
  settlementIds: string[];
  acknowledgedSettlementIds: string[];
  coverageIds: string[];
  successorDeterminationId?: string;
};

export type FinancialReconciliationItem = {
  rail: FinancialRailId;
  obligationId: string;
  wkOrderId: number;
  debtor: NormalizedParty;
  creditor: NormalizedParty;
  originalPrincipal: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  collectibleRemaining?: Prisma.Decimal;
  currency: string;
  financialState: DerivedFinancialState;
  flags: ReconciliationFlags;
  reasonCode?: string;
  sourceType: string;
  sourceId: string;
  economicLossId?: string;
  determinationId?: string;
  riderAdvanceId?: string;
  returnFinancialDeterminationId?: string;
  disputeState?: string;
  reconciliationState: ReconciliationState;
  relatedItems?: ReconciliationRelatedItem[];
  sourceRefs: ReconciliationSourceRefs;
  createdAt: Date;
  lastFinancialActivityAt?: Date;
};

export type DirectionalGroupKey = {
  currency: string;
  debtorType: ReconciliationPartyType;
  debtorUserId: string | null;
  debtorMerchantId: number | null;
  creditorType: ReconciliationPartyType;
  creditorUserId: string | null;
  creditorMerchantId: number | null;
  rail: FinancialRailId;
};

export type DirectionalGroup = {
  key: DirectionalGroupKey;
  originalPrincipal: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  itemIds: string[];
};

export type OrderFinancialReconciliation = {
  wkOrderId: number;
  items: FinancialReconciliationItem[];
  directionalGroups: DirectionalGroup[];
};
