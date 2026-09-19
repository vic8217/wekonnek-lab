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

export type ReconciliationRelation =
  | 'SUCCESSOR'
  | 'SUCCESSOR_OF'
  | 'COLLECTION_TRANSFERRED_TO_RETURN'
  | 'ECONOMIC_LOSS_COVERED_BY_RETURN'
  | 'POTENTIAL_OVERLAP';

export type ReconciliationRelatedItem = {
  rail: FinancialRailId;
  obligationId: string;
  relation: ReconciliationRelation;
  fromRail?: FinancialRailId;
  fromObligationId?: string;
};

export type ReconciliationCheckOutcome =
  | 'PASSED'
  | 'FAILED'
  | 'NOT_APPLICABLE'
  | 'INSUFFICIENT_LINKAGE';

export type ReconciliationSubjectMatch =
  | 'EXACT'
  | 'CONTAINED'
  | 'RELATED'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE';

export const RECONCILIATION_FINDING_CODES = {
  RA_RETURN_RESTRICTION_MISSING: 'RA_RETURN_RESTRICTION_MISSING',
  RA_RETURN_RESTRICTION_AMOUNT_MISMATCH: 'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH',
  RA_RETURN_RESTRICTION_MULTIPLE: 'RA_RETURN_RESTRICTION_MULTIPLE',
  RA_RETURN_DOUBLE_COLLECTIBLE: 'RA_RETURN_DOUBLE_COLLECTIBLE',
  RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH: 'RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH',
  RA_RETURN_SNAPSHOT_ACK_MISMATCH: 'RA_RETURN_SNAPSHOT_ACK_MISMATCH',
  RA_RETURN_CREDITOR_MISMATCH: 'RA_RETURN_CREDITOR_MISMATCH',
  RA_RETURN_RA_MISSING: 'RA_RETURN_RA_MISSING',
  INSUFFICIENT_SOURCE_LINKAGE: 'INSUFFICIENT_SOURCE_LINKAGE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  COVERAGE_SOURCE_MISSING: 'COVERAGE_SOURCE_MISSING',
  STAGE9_COVERAGE_MISSING: 'STAGE9_COVERAGE_MISSING',
  STAGE9_COVERAGE_AMOUNT_MISMATCH: 'STAGE9_COVERAGE_AMOUNT_MISMATCH',
  COVERAGE_WRONG_LOSS: 'COVERAGE_WRONG_LOSS',
  COVERAGE_DUPLICATE_SEMANTIC: 'COVERAGE_DUPLICATE_SEMANTIC',
  COVERAGE_EXCEEDS_COMPENSABLE: 'COVERAGE_EXCEEDS_COMPENSABLE',
  SUBJECT_MATCH_UNKNOWN: 'SUBJECT_MATCH_UNKNOWN',
  EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE: 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
  SUCCESSOR_REVIEW_REQUIRED: 'SUCCESSOR_REVIEW_REQUIRED',
  SUCCESSOR_BRANCH_DETECTED: 'SUCCESSOR_BRANCH_DETECTED',
  SUCCESSOR_CYCLE_DETECTED: 'SUCCESSOR_CYCLE_DETECTED',
} as const;

export type ReconciliationFindingCode =
  (typeof RECONCILIATION_FINDING_CODES)[keyof typeof RECONCILIATION_FINDING_CODES];

export type ReconciliationFindingInvolvedItem = {
  rail: FinancialRailId;
  obligationId: string;
};

/**
 * Runtime-derived detector output. Not persisted. No clock identity field.
 * findingKey is deterministic (code + sorted involved items + source id).
 */
export type ReconciliationFinding = {
  findingKey: string;
  code: ReconciliationFindingCode;
  reconciliationState: ReconciliationState;
  wkOrderId: number;
  subjectMatch?: ReconciliationSubjectMatch;
  checkOutcome: ReconciliationCheckOutcome;
  involvedItems: ReconciliationFindingInvolvedItem[];
  expectedRelationship?: string;
  observedRelationship?: string;
  explanationCode: ReconciliationFindingCode;
  evidenceRefs: string[];
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
  findings: ReconciliationFinding[];
  relatedItems: ReconciliationRelatedItem[];
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
};
