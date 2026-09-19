/**
 * Stage13B-3B admin discovery DTOs.
 * Search is NOT financial authority. No money totals.
 *
 * sourceActivityAt is a DISCOVERY CLOCK from candidate source
 * createdAt/updatedAt. It is NOT lastFinancialActivityAt, settlement
 * time, detector time, or liability time.
 */
import {
  FinancialRailId,
  ReconciliationFindingCode,
  ReconciliationState,
} from './financial-reconciliation.types';

export type FinancialReconciliationSearchResultDto = {
  wkOrderId: number;
  rails: FinancialRailId[];
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
  reconciliationStates: ReconciliationState[];
  findingCodes: ReconciliationFindingCode[];
  itemCount: number;
  sourceActivityAt: string;
};

export type FinancialReconciliationSearchResponseDto = {
  items: FinancialReconciliationSearchResultDto[];
  nextCursor: string | null;
  scanned: number;
  exhausted: boolean;
};
