/**
 * Stage13B-3A HTTP DTO boundary.
 * Never serialize frozen OrderFinancialReconciliation / FinancialReconciliationItem
 * directly to participants. Amounts are decimal strings (toFixed(2)).
 */
import {
  DerivedFinancialState,
  DirectionalGroupKey,
  FinancialRailId,
  ReconciliationCheckOutcome,
  ReconciliationFindingCode,
  ReconciliationFindingInvolvedItem,
  ReconciliationFlags,
  ReconciliationPartyType,
  ReconciliationRelation,
  ReconciliationSourceRefs,
  ReconciliationState,
} from './financial-reconciliation.types';

export type FinancialPartyDto = {
  type: ReconciliationPartyType;
  userId: string | null;
  merchantId: number | null;
};

export type RelatedFinancialItemDto = {
  rail: FinancialRailId;
  obligationId: string;
  relation: ReconciliationRelation;
  fromRail?: FinancialRailId;
  fromObligationId?: string;
};

export type FinancialObligationDto = {
  rail: FinancialRailId;
  obligationId: string;
  wkOrderId: number;
  debtor: FinancialPartyDto;
  creditor: FinancialPartyDto;
  originalPrincipal: string;
  settledAmount: string;
  remainingAmount: string;
  collectibleRemaining?: string;
  currency: string;
  financialState: DerivedFinancialState;
  flags: ReconciliationFlags;
  reasonCode?: string;
  disputeState?: string;
  reconciliationState: ReconciliationState;
  relatedItems: RelatedFinancialItemDto[];
  createdAt: string;
  lastFinancialActivityAt?: string;
  sourceType?: string;
  sourceId?: string;
  economicLossId?: string;
  determinationId?: string;
  riderAdvanceId?: string;
  returnFinancialDeterminationId?: string;
  sourceRefs?: ReconciliationSourceRefs;
};

export type ReconciliationFindingDto = {
  findingKey: string;
  code: ReconciliationFindingCode;
  reconciliationState: ReconciliationState;
  checkOutcome: ReconciliationCheckOutcome;
  involvedItems: ReconciliationFindingInvolvedItem[];
  explanationCode: ReconciliationFindingCode;
  wkOrderId?: number;
  subjectMatch?: string;
  expectedRelationship?: string;
  observedRelationship?: string;
  evidenceRefs?: string[];
};

export type DirectionalGroupDto = {
  key: DirectionalGroupKey;
  originalPrincipal: string;
  settledAmount: string;
  remainingAmount: string;
  itemIds: string[];
};

export type FinancialReconciliationResponseDto = {
  wkOrderId: number;
  items: FinancialObligationDto[];
  directionalGroups: DirectionalGroupDto[];
  findings: ReconciliationFindingDto[];
  relatedItems: RelatedFinancialItemDto[];
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
};
