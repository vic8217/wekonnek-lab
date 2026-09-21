/**
 * Stage14B-2A System Admin evidentiary POSTs only.
 * No determination, settlement, coverage, or Stage9 mutation helpers.
 */
import { getToken } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from './financial-reconciliation-api';
import { mapLiabilityAdminError } from './exception-liability-admin-presentation';

const BACKEND = '/api/backend';

export const LIABILITY_ADMIN_POST_PATHS = {
  addEvidence: (claimId: string) => `/exception-claims/${claimId}/evidence`,
  captureOrderTermsEvidence: (claimId: string) =>
    `/exception-claims/${claimId}/order-terms-evidence`,
  verifyEvidence: (claimId: string, evidenceId: string) =>
    `/exception-claims/${claimId}/evidence/${evidenceId}/verify`,
  createVerifiedFact: (claimId: string) =>
    `/exception-claims/${claimId}/verified-facts`,
} as const;

export type AddEvidenceInput = {
  evidenceKind: string;
  visibility?: string;
  notes?: string;
  storageReference?: string;
  contentHash?: string;
  contentType?: string;
  correlationId?: string;
  idempotencyKey?: string;
};

export type CaptureOrderTermsInput = {
  correlationId: string;
  idempotencyKey?: string;
};

export type VerifyEvidenceInput = {
  verificationStatus: string;
  notes?: string;
  correlationId?: string;
  idempotencyKey?: string;
};

export type CreateVerifiedFactInput = {
  factType: string;
  statement: string;
  subjectRef?: string;
  attributedPartyType?: string | null;
  attributedPartyUserId?: string | null;
  attributedMerchantId?: number | null;
  supportingEvidenceId?: string | null;
  correlationId?: string;
  idempotencyKey?: string;
};

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

export async function adminLiabilityPost<T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = readErrorBody(data);
    throw new FinancialReconciliationApiError({
      status: response.status,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      message: mapLiabilityAdminError(response.status, parsed),
      inlinePeriod: false,
      resetCursor: false,
    });
  }
  return data as T;
}

function omitEmpty(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null || value === '') continue;
    next[key] = value;
  }
  return next;
}

export async function addEvidence(
  claimId: string,
  input: AddEvidenceInput,
  signal?: AbortSignal,
) {
  return adminLiabilityPost(
    LIABILITY_ADMIN_POST_PATHS.addEvidence(claimId),
    omitEmpty({
      evidenceKind: input.evidenceKind,
      visibility: input.visibility,
      notes: input.notes,
      storageReference: input.storageReference,
      contentHash: input.contentHash,
      contentType: input.contentType,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    }),
    signal,
  );
}

export async function captureOrderTermsEvidence(
  claimId: string,
  input: CaptureOrderTermsInput,
  signal?: AbortSignal,
) {
  return adminLiabilityPost(
    LIABILITY_ADMIN_POST_PATHS.captureOrderTermsEvidence(claimId),
    omitEmpty({
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    }),
    signal,
  );
}

export async function verifyEvidence(
  claimId: string,
  evidenceId: string,
  input: VerifyEvidenceInput,
  signal?: AbortSignal,
) {
  return adminLiabilityPost(
    LIABILITY_ADMIN_POST_PATHS.verifyEvidence(claimId, evidenceId),
    omitEmpty({
      verificationStatus: input.verificationStatus,
      notes: input.notes,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    }),
    signal,
  );
}

export async function createVerifiedFact(
  claimId: string,
  input: CreateVerifiedFactInput,
  signal?: AbortSignal,
) {
  return adminLiabilityPost(
    LIABILITY_ADMIN_POST_PATHS.createVerifiedFact(claimId),
    omitEmpty({
      factType: input.factType,
      statement: input.statement,
      subjectRef: input.subjectRef,
      attributedPartyType: input.attributedPartyType,
      attributedPartyUserId: input.attributedPartyUserId,
      attributedMerchantId: input.attributedMerchantId,
      supportingEvidenceId: input.supportingEvidenceId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    }),
    signal,
  );
}
