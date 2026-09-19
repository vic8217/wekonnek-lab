/**
 * Stage14A operational review client. Admin token via getToken().
 * No financial fields. No detector recreation.
 */
import { getToken } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from './financial-reconciliation-api';
import { mapPublicApiError } from './financial-reconciliation-presentation';

const BACKEND = '/api/backend';

export type ReviewListItem = {
  id: string;
  wkOrderId: number;
  findingKey: string;
  findingCode: string;
  status: string;
  assignedAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
};

export type ReviewNote = {
  id: string;
  authorAdminUserId: string;
  body: string;
  createdAt: string;
};

export type ReviewEvent = {
  id: string;
  type: string;
  payload: unknown;
  actorAdminUserId: string;
  createdAt: string;
};

export type ReviewDetail = {
  id: string;
  wkOrderId: number;
  findingKey: string;
  findingCode: string;
  status: string;
  assignedAdminUserId: string | null;
  routeClassification: string | null;
  waitingPartyType: string | null;
  closeClassification: string | null;
  closeReason: string | null;
  priorReviewId: string | null;
  rowVersion: number;
  createdByAdminUserId: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  openingFingerprint: string;
  currentFingerprint: string;
  findingActive: boolean;
  stale: boolean;
  needsRefresh: boolean;
  allowedRouteClassifications: string[];
  reviewOnlyClosePermitted: boolean;
  notes: ReviewNote[];
  events: ReviewEvent[];
};

const REVIEW_ERROR_COPY: Record<string, string> = {
  STALE_FINDING: 'This finding is no longer live on current reconciliation.',
  FINDING_STILL_ACTIVE: 'The finding is still active. Condition-cleared close is not allowed.',
  REVIEW_VERSION_CONFLICT: 'This follow-up was updated by another admin. Refresh and try again.',
  NOTE_IDEMPOTENCY_CONFLICT: 'This note key was already used with different text.',
  REVIEW_ONLY_NOT_ALLOWED: 'Review-only close is not permitted for this finding.',
  INVALID_ASSIGNEE: 'Assignee must be an active system admin.',
  REVIEW_ALREADY_CLOSED: 'This follow-up is already closed.',
  ROUTE_NOT_ALLOWED_FOR_FINDING: 'That routing is not allowed for this finding.',
  FINDING_ALREADY_CLEARED: 'The finding is already absent. Use condition-cleared close.',
};

export function mapReviewApiError(
  status: number,
  body: { code?: unknown; message?: unknown },
): string {
  const mapped = mapPublicApiError(status, body);
  const token =
    (typeof body.code === 'string' && body.code) ||
    (typeof body.message === 'string' ? body.message.split(':')[0] : '');
  if (token && REVIEW_ERROR_COPY[token]) return REVIEW_ERROR_COPY[token];
  return mapped.message;
}

function readErrorBody(data: unknown): { code?: unknown; message?: unknown } {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new FinancialReconciliationApiError({
      ...mapPublicApiError(response.status, readErrorBody(data)),
      message: mapReviewApiError(response.status, readErrorBody(data)),
    });
  }
  return data as T;
}

export async function listFinancialReconciliationReviews(
  query: Record<string, string>,
): Promise<{ items: ReviewListItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const data = await adminFetch<{ items?: ReviewListItem[]; nextCursor?: string | null }>(
    `/admin/financial-reconciliation/reviews?${params.toString()}`,
  );
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor: data.nextCursor ?? null,
  };
}

export async function getFinancialReconciliationReview(
  id: string,
): Promise<ReviewDetail> {
  return adminFetch<ReviewDetail>(`/admin/financial-reconciliation/reviews/${id}`);
}

export async function createFinancialReconciliationReview(input: {
  wkOrderId: number;
  findingKey: string;
}): Promise<{ created: boolean; review: ReviewDetail }> {
  return adminFetch(`/admin/financial-reconciliation/reviews`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function assignFinancialReconciliationReview(
  id: string,
  input: { assignedAdminUserId: string | null; expectedVersion: number },
): Promise<ReviewDetail> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function addFinancialReconciliationReviewNote(
  id: string,
  input: { body: string; idempotencyKey: string },
): Promise<ReviewNote> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function refreshFinancialReconciliationReview(
  id: string,
): Promise<ReviewDetail> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/refresh`, {
    method: 'POST',
  });
}

export async function waitFinancialReconciliationReview(
  id: string,
  input: {
    waitingPartyType: 'CUSTOMER' | 'MERCHANT' | 'RIDER';
    expectedVersion: number;
    reason?: string;
  },
): Promise<ReviewDetail> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/waiting`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function escalateFinancialReconciliationReview(
  id: string,
  input: { reason: string; expectedVersion: number },
): Promise<ReviewDetail> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/escalate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function closeFinancialReconciliationReview(
  id: string,
  input: {
    mode: 'CONDITION_CLEARED' | 'REVIEW_ONLY';
    reason: string;
    expectedVersion: number;
  },
): Promise<ReviewDetail> {
  return adminFetch(`/admin/financial-reconciliation/reviews/${id}/close`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
