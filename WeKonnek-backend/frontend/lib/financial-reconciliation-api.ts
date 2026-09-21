/**
 * Stage13C admin financial reconciliation API client.
 * Uses fetch + getToken() (wk_admin_token). Not lib/api.ts axios.
 */
import { getToken } from '@/hooks/use-auth';
import {
  type FinancialRailId,
  type PublicApiError,
  type QueueSearchItem,
  type ReconciliationFindingCode,
  type ReconciliationRelation,
  type ReconciliationState,
  type SearchQueryMap,
  mapPublicApiError,
  searchParamsFromQuery,
} from './financial-reconciliation-presentation';

const BACKEND = '/api/backend';

export type FinancialReconciliationSearchResponse = {
  items: QueueSearchItem[];
  nextCursor: string | null;
  scanned: number;
  exhausted: boolean;
};

export type FinancialPartyDto = {
  type: string;
  userId: string | null;
  merchantId: number | null;
};

export type RelatedFinancialItemDto = {
  rail: FinancialRailId | string;
  obligationId: string;
  relation: ReconciliationRelation | string;
  fromRail?: string;
  fromObligationId?: string;
};

export type FinancialObligationDto = {
  rail: FinancialRailId | string;
  obligationId: string;
  wkOrderId: number;
  debtor: FinancialPartyDto;
  creditor: FinancialPartyDto;
  originalPrincipal: string;
  settledAmount: string;
  remainingAmount: string;
  collectibleRemaining?: string;
  currency: string;
  financialState: string;
  flags: {
    disputed?: boolean;
    nonExecutable?: boolean;
    collectionRestricted?: boolean;
    reconciliationRequired?: boolean;
  };
  reasonCode?: string;
  disputeState?: string;
  reconciliationState: ReconciliationState | string;
  relatedItems: RelatedFinancialItemDto[];
  createdAt: string;
  lastFinancialActivityAt?: string;
  sourceType?: string;
  sourceId?: string;
  economicLossId?: string;
  determinationId?: string;
  riderAdvanceId?: string;
  returnFinancialDeterminationId?: string;
  sourceRefs?: {
    settlementIds?: string[];
    acknowledgedSettlementIds?: string[];
    coverageIds?: string[];
    successorDeterminationId?: string;
  };
};

export type ReconciliationFindingDto = {
  findingKey: string;
  code: ReconciliationFindingCode | string;
  reconciliationState: ReconciliationState | string;
  checkOutcome: string;
  involvedItems: Array<{ rail: string; obligationId: string }>;
  explanationCode: string;
  wkOrderId?: number;
  subjectMatch?: string;
  expectedRelationship?: string;
  observedRelationship?: string;
  evidenceRefs?: string[];
};

export type FinancialReconciliationDetailDto = {
  wkOrderId: number;
  items: FinancialObligationDto[];
  findings: ReconciliationFindingDto[];
  relatedItems: RelatedFinancialItemDto[];
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
};

export class FinancialReconciliationApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly inlinePeriod: boolean;
  readonly resetCursor: boolean;

  constructor(error: PublicApiError) {
    super(error.message);
    this.name = 'FinancialReconciliationApiError';
    this.status = error.status;
    this.code = error.code;
    this.inlinePeriod = error.inlinePeriod;
    this.resetCursor = error.resetCursor;
  }
}

function readErrorBody(data: unknown): { code?: unknown; message?: unknown } {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const nested =
    record.message && typeof record.message === 'object'
      ? (record.message as Record<string, unknown>)
      : null;
  return {
    code: typeof record.code === 'string' ? record.code : nested?.code,
    message:
      typeof record.message === 'string'
        ? record.message
        : typeof nested?.message === 'string'
          ? nested.message
          : undefined,
  };
}

async function adminGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BACKEND}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new FinancialReconciliationApiError(
      mapPublicApiError(response.status, readErrorBody(data)),
    );
  }
  return data as T;
}

export function serializeSearchQuery(
  query: SearchQueryMap,
  cursor?: string | null,
): string {
  return searchParamsFromQuery(query, cursor).toString();
}

export async function searchFinancialReconciliation(
  query: SearchQueryMap,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<FinancialReconciliationSearchResponse> {
  const qs = serializeSearchQuery(query, cursor);
  const data = await adminGet<FinancialReconciliationSearchResponse>(
    `/admin/financial-reconciliation?${qs}`,
    signal,
  );
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor: data.nextCursor ?? null,
    scanned: typeof data.scanned === 'number' ? data.scanned : 0,
    exhausted: Boolean(data.exhausted),
  };
}

export async function fetchOrderFinancialReconciliation(
  wkOrderId: number,
  signal?: AbortSignal,
): Promise<FinancialReconciliationDetailDto> {
  const data = await adminGet<FinancialReconciliationDetailDto>(
    `/orders/${wkOrderId}/financial-reconciliation`,
    signal,
  );
  return {
    wkOrderId: data.wkOrderId,
    items: Array.isArray(data.items) ? data.items : [],
    findings: Array.isArray(data.findings) ? data.findings : [],
    relatedItems: Array.isArray(data.relatedItems) ? data.relatedItems : [],
    hasOutstanding: Boolean(data.hasOutstanding),
    hasDispute: Boolean(data.hasDispute),
    hasReconciliationIssue: Boolean(data.hasReconciliationIssue),
  };
}
