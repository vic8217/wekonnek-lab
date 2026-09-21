/**
 * Stage14B-1 domain GET clients. Admin token via getToken().
 * No mutation helpers. Money fields remain server strings.
 */
import { getToken } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from './financial-reconciliation-api';
import { mapPublicApiError } from './financial-reconciliation-presentation';

const BACKEND = '/api/backend';

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

export async function adminDomainGet<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
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

export type ExceptionClaimRecord = {
  id: string;
  wkOrderId: number;
  operationsRecoveryId?: string | null;
  status?: string;
  claimType?: string;
  subjectRef?: string;
  currency?: string;
  policyVersionId?: string | null;
  policyHash?: string | null;
  economicLossId?: string | null;
  economicLoss?: Record<string, unknown> | null;
  evidence?: unknown[];
  verifications?: unknown[];
  verifiedFacts?: unknown[];
  determinations?: Array<Record<string, unknown>>;
  obligations?: Array<Record<string, unknown>>;
  events?: unknown[];
  [key: string]: unknown;
};

export type ExceptionClaimsListResponse = {
  code?: string;
  claims?: ExceptionClaimRecord[];
};

export type ExceptionClaimResponse = {
  code?: string;
  claim?: ExceptionClaimRecord;
};

export type ReturnFinancialResolutionDto = {
  wkOrderId?: number;
  returnFinancialStatus?: string | null;
  outcome?: string | null;
  path?: string | null;
  determinationId?: string | null;
  snapshotPrincipal?: string | null;
  snapshotReimbursed?: string | null;
  historicalReimbursementStatus?: string | null;
  customerReimbursedAmount?: string | null;
  customerCollectibleRemaining?: string | null;
  currentCollectionStatus?: string | null;
  financialBlockingReasons?: string[];
  merchantToRiderRepayment?: Record<string, unknown> | null;
  merchantToCustomerRefund?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type RiderAdvanceReimbursementDto = {
  principal?: string;
  settledAmount?: string;
  remainingAmount?: string;
  currency?: string;
  reimbursementStatus?: string;
  creditorRiderId?: string;
  creditor?: { id?: string };
  settlements?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type ExceptionSettlementSummaryDto = {
  obligation?: Record<string, unknown> | null;
  settlements?: unknown[];
  principal?: unknown;
  settledAmount?: unknown;
  remainingAmount?: unknown;
  derivedState?: string;
  [key: string]: unknown;
};

export async function fetchExceptionClaimsForOrder(
  wkOrderId: number,
  signal?: AbortSignal,
): Promise<ExceptionClaimRecord[]> {
  const data = await adminDomainGet<ExceptionClaimsListResponse>(
    `/orders/${wkOrderId}/exception-claims`,
    signal,
  );
  return Array.isArray(data.claims) ? data.claims : [];
}

export async function fetchExceptionClaim(
  id: string,
  signal?: AbortSignal,
): Promise<ExceptionClaimRecord | null> {
  const data = await adminDomainGet<ExceptionClaimResponse>(
    `/exception-claims/${id}`,
    signal,
  );
  return data.claim ?? null;
}

export async function fetchReturnFinancialResolution(
  wkOrderId: number,
  signal?: AbortSignal,
): Promise<ReturnFinancialResolutionDto> {
  return adminDomainGet(
    `/orders/${wkOrderId}/return-financial-resolution`,
    signal,
  );
}

export async function fetchRiderAdvanceReimbursement(
  wkOrderId: number,
  signal?: AbortSignal,
): Promise<RiderAdvanceReimbursementDto> {
  return adminDomainGet(
    `/orders/${wkOrderId}/rider-advance/reimbursement`,
    signal,
  );
}

export async function fetchExceptionObligationSettlementSummary(
  obligationId: string,
  signal?: AbortSignal,
): Promise<ExceptionSettlementSummaryDto> {
  return adminDomainGet(
    `/exception-financial-obligations/${obligationId}/settlement-summary`,
    signal,
  );
}
