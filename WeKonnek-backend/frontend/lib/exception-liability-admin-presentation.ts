/**
 * Stage14B-2A evidentiary presentation. No financial arithmetic.
 * Backend remains authority for every mutation.
 */

export const ACTIVE_EXCEPTION_CLAIM_STATUSES = [
  'OPEN',
  'EVIDENCE_REVIEW',
  'VERIFIED',
  'DETERMINATION_PROPOSED',
] as const;

export const CLAIM_EVIDENCE_KINDS = [
  'PHOTO_REFERENCE',
  'DOCUMENT_REFERENCE',
  'STATEMENT',
  'CUSTODY_TRAIL_REFERENCE',
  'SYSTEM_RECORD',
  'ORDER_TERMS_SNAPSHOT',
  'DELIVERY_ATTEMPT_REFERENCE',
  'OPERATIONS_RECOVERY_REFERENCE',
  'OTHER',
] as const;

export const MANUAL_EVIDENCE_KINDS = CLAIM_EVIDENCE_KINDS.filter(
  (kind) => kind !== 'ORDER_TERMS_SNAPSHOT',
);

export const CLAIM_EVIDENCE_VISIBILITIES = [
  'ADMIN_ONLY',
  'CLAIM_PARTIES',
  'ALL_ORDER_PARTIES',
] as const;

export const CLAIM_VERIFICATION_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'INCONCLUSIVE',
] as const;

export const VERIFIED_FACT_TYPES = [
  'GOODS_LOST_CONFIRMED',
  'GOODS_DAMAGED_CONFIRMED',
  'CUSTODY_LAST_HOLDER_CONFIRMED',
  'RETURN_NOT_COMPLETED_CONFIRMED',
  'PAYMENT_NOT_COLLECTED_CONFIRMED',
  'PARTY_NEGLIGENCE_CONFIRMED',
  'NO_PARTY_FAULT_CONFIRMED',
  'GOODS_NON_CONFORMANCE_CONFIRMED',
  'GOODS_CONFORMANCE_CONFIRMED',
  'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED',
  'OTHER',
] as const;

export const NON_ATTRIBUTING_FACT_TYPES = [
  'GOODS_CONFORMANCE_CONFIRMED',
  'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED',
] as const;

export const FACT_ATTRIBUTION_PARTY_TYPES = [
  'CUSTOMER',
  'MERCHANT',
  'RIDER',
] as const;

export const DEFAULT_EVIDENCE_VISIBILITY = 'ADMIN_ONLY' as const;

export const SENSITIVE_INFORMATION_COPY =
  'Do not enter passwords, credentials, full payment credentials, unnecessary personal information, or other secrets in evidence notes or metadata.';

export const ADMIN_ONLY_VISIBILITY_COPY =
  'ADMIN_ONLY is the default. It is not published to order parties. Current staff claim GET still returns the full admin graph, so this is not a staff-secret classification.';

export const SUBJECT_MATCH_INVESTIGATION_COPY =
  'Verified facts support investigation only. They do not resolve Stage13B subject matching. SUBJECT_MATCH_UNKNOWN remains a detector finding.';

export const COVERAGE_INVESTIGATION_COPY =
  'Coverage rows are read-only. Evidence and facts do not import, rewrite, or repair coverage.';

export type MutationPhase =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'error'
  | 'reconciling';

export function isActiveClaimStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    (ACTIVE_EXCEPTION_CLAIM_STATUSES as readonly string[]).includes(status)
  );
}

export function isManualEvidenceKind(value: string): boolean {
  return (MANUAL_EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function isEvidenceVisibility(value: string): boolean {
  return (CLAIM_EVIDENCE_VISIBILITIES as readonly string[]).includes(value);
}

export function isVerificationStatus(value: string): boolean {
  return (CLAIM_VERIFICATION_STATUSES as readonly string[]).includes(value);
}

export function isVerifiedFactType(value: string): boolean {
  return (VERIFIED_FACT_TYPES as readonly string[]).includes(value);
}

export function factTypeForbidsAttribution(factType: string): boolean {
  return (NON_ATTRIBUTING_FACT_TYPES as readonly string[]).includes(factType);
}

export function isFactAttributionPartyType(value: string): boolean {
  return (FACT_ATTRIBUTION_PARTY_TYPES as readonly string[]).includes(value);
}

export function asRecordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null,
  );
}

export function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function evidenceHasVerifiedConclusion(
  evidenceId: string,
  verifications: Array<Record<string, unknown>>,
): boolean {
  return verifications.some(
    (row) =>
      stringField(row, 'evidenceId') === evidenceId &&
      stringField(row, 'verificationStatus') === 'VERIFIED',
  );
}

export function verifiedSupportingEvidence(
  evidence: Array<Record<string, unknown>>,
  verifications: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return evidence.filter((row) => {
    const id = stringField(row, 'id');
    return id != null && evidenceHasVerifiedConclusion(id, verifications);
  });
}

export function findRowByIdempotencyKey(
  rows: Array<Record<string, unknown>>,
  idempotencyKey: string,
): Record<string, unknown> | null {
  return (
    rows.find((row) => stringField(row, 'idempotencyKey') === idempotencyKey) ??
    null
  );
}

export function sameActorIds(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && left === right;
}

export function verificationIndependenceNote(
  evidenceActorId: unknown,
  verificationActorId: unknown,
): string {
  if (sameActorIds(evidenceActorId, verificationActorId)) {
    return 'Recorded by the same System Admin who added the evidence. This is not independent verification.';
  }
  return 'This is a Stage12 evidence verification conclusion, not settlement.';
}

export function createGestureIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Gesture identity is not payload identity.
 * A completed key is forgotten. Identical later content is a new gesture.
 * An in-flight or ambiguous gesture reuses its key only while the active
 * fingerprint still matches.
 */
export type GestureStatus = 'in_flight' | 'ambiguous';

export type ActiveGesture = {
  key: string;
  fingerprint: string;
  status: GestureStatus;
};

export function submitGesture(
  active: ActiveGesture | null,
  fingerprint: string,
): { active: ActiveGesture; reused: boolean } {
  if (
    active &&
    (active.status === 'in_flight' || active.status === 'ambiguous') &&
    active.fingerprint === fingerprint
  ) {
    return {
      active: { ...active, status: 'in_flight' },
      reused: true,
    };
  }
  return {
    active: {
      key: createGestureIdempotencyKey(),
      fingerprint,
      status: 'in_flight',
    },
    reused: false,
  };
}

export function markGestureAmbiguous(
  active: ActiveGesture | null,
): ActiveGesture | null {
  if (!active) return null;
  return { ...active, status: 'ambiguous' };
}

export function completeGesture(_active: ActiveGesture | null): null {
  return null;
}

export function normalizeExpectedWkOrderId(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export type RouteContext = {
  claimId: string;
  expectedWkOrderId: string | null;
};

export function sameRouteContext(left: RouteContext, right: RouteContext): boolean {
  return (
    left.claimId === right.claimId &&
    left.expectedWkOrderId === right.expectedWkOrderId
  );
}

export function claimWorkspacePanelKey(
  claimId: string,
  expectedWkOrderId: unknown,
  panel: string,
): string {
  return `${claimId}:${normalizeExpectedWkOrderId(expectedWkOrderId) ?? ''}:${panel}`;
}

export type ClaimOwner = {
  claimId: string;
  expectedWkOrderId: string | null;
  epoch: number;
};

export function isCurrentClaimOwner(input: {
  owner: ClaimOwner;
  routeClaimId: string;
  routeExpectedWkOrderId: string | null;
  routeEpoch: number;
}): boolean {
  return (
    sameRouteContext(
      {
        claimId: input.owner.claimId,
        expectedWkOrderId: input.owner.expectedWkOrderId,
      },
      {
        claimId: input.routeClaimId,
        expectedWkOrderId: input.routeExpectedWkOrderId,
      },
    ) && input.owner.epoch === input.routeEpoch
  );
}

export function mayAbortRouteLoad(input: {
  owner: RouteContext;
  route: RouteContext;
}): boolean {
  return sameRouteContext(input.owner, input.route);
}

export type OwnedApplyDecision = 'apply' | 'ignore';

export function ownedResultDecision(input: {
  owner: ClaimOwner;
  routeClaimId: string;
  routeExpectedWkOrderId: string | null;
  routeEpoch: number;
  loadGeneration: number;
  responseGeneration: number;
}): OwnedApplyDecision {
  if (
    !isCurrentClaimOwner({
      owner: input.owner,
      routeClaimId: input.routeClaimId,
      routeExpectedWkOrderId: input.routeExpectedWkOrderId,
      routeEpoch: input.routeEpoch,
    })
  ) {
    return 'ignore';
  }
  return claimRefreshDecision(input.loadGeneration, input.responseGeneration);
}

export type FactAttributionOption = {
  partyType: 'CUSTOMER' | 'MERCHANT' | 'RIDER';
  partyUserId: string | null;
  partyMerchantId: number | null;
  label: string;
  source: string;
  optionKey: string;
};

function integerId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') return optionalDigitId(value);
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

/**
 * Attribution options from frozen claim GET only.
 * Merchant: ORDER_TERMS_SNAPSHOT.metadata.merchantId and/or obligation
 * creditorMerchantId where creditorType=MERCHANT (server resolveCreditor).
 * Customer/Rider: obligation creditorUserId where creditorType matches
 * (server resolveCreditor). Debtor/allocation/fact IDs are not used.
 * More than one distinct id for a type → omit that type.
 */
export function collectAuthoritativeFactAttributionOptions(
  claim: Record<string, unknown>,
): FactAttributionOption[] {
  const snapshotMerchantIds: number[] = [];
  for (const row of asRecordList(claim.evidence)) {
    if (stringField(row, 'evidenceKind') !== 'ORDER_TERMS_SNAPSHOT') continue;
    const metadata =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : null;
    const merchantId = integerId(metadata?.merchantId);
    if (merchantId != null) snapshotMerchantIds.push(merchantId);
  }

  const customerIds: string[] = [];
  const riderIds: string[] = [];
  const creditorMerchantIds: number[] = [];
  for (const row of asRecordList(claim.obligations)) {
    const creditorType = stringField(row, 'creditorType');
    if (creditorType === 'CUSTOMER') {
      const id = stringField(row, 'creditorUserId');
      if (id) customerIds.push(id);
    }
    if (creditorType === 'RIDER') {
      const id = stringField(row, 'creditorUserId');
      if (id) riderIds.push(id);
    }
    if (creditorType === 'MERCHANT') {
      const id = integerId(row.creditorMerchantId);
      if (id != null) creditorMerchantIds.push(id);
    }
  }

  const options: FactAttributionOption[] = [];
  const customers = uniqueStrings(customerIds);
  if (customers.length === 1) {
    const id = customers[0];
    options.push({
      partyType: 'CUSTOMER',
      partyUserId: id,
      partyMerchantId: null,
      label: 'Customer',
      source: 'obligations[].creditorUserId where creditorType=CUSTOMER',
      optionKey: `CUSTOMER:${id}`,
    });
  }

  const merchants = uniqueNumbers([
    ...snapshotMerchantIds,
    ...creditorMerchantIds,
  ]);
  if (merchants.length === 1) {
    const id = merchants[0];
    const fromSnapshot = snapshotMerchantIds.includes(id);
    options.push({
      partyType: 'MERCHANT',
      partyUserId: null,
      partyMerchantId: id,
      label: `Merchant (${id})`,
      source: fromSnapshot
        ? 'evidence ORDER_TERMS_SNAPSHOT metadata.merchantId'
        : 'obligations[].creditorMerchantId where creditorType=MERCHANT',
      optionKey: `MERCHANT:${id}`,
    });
  }

  const riders = uniqueStrings(riderIds);
  if (riders.length === 1) {
    const id = riders[0];
    options.push({
      partyType: 'RIDER',
      partyUserId: id,
      partyMerchantId: null,
      label: 'Rider',
      source: 'obligations[].creditorUserId where creditorType=RIDER',
      optionKey: `RIDER:${id}`,
    });
  }

  return options;
}

export function attributionFromOptionKey(
  optionKey: string,
  options: FactAttributionOption[],
): Pick<
  FactAttributionOption,
  'partyType' | 'partyUserId' | 'partyMerchantId'
> | null {
  return options.find((row) => row.optionKey === optionKey) ?? null;
}

export function createCorrelationId(): string {
  return `s14b2a-${crypto.randomUUID()}`;
}

/** Identifier parsing only. Not financial arithmetic. */
export function optionalDigitId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function mapLiabilityAdminError(
  status: number,
  body: { code?: unknown; message?: unknown },
): string {
  const code = typeof body.code === 'string' ? body.code : '';
  const backendMessage =
    typeof body.message === 'string' && body.message.trim()
      ? body.message
      : '';
  const detail = [code, backendMessage].filter(Boolean).join(': ');

  if (status === 401) {
    return detail || 'Authentication required.';
  }
  if (status === 403) {
    return detail || 'Not authorized, or a Stage12 prerequisite was not met.';
  }
  if (status === 404) {
    return detail || 'The claim, evidence, or related record was not found.';
  }
  if (status === 409) {
    return (
      detail ||
      'Claim state or idempotency conflict. Reload the claim before continuing.'
    );
  }
  if (status >= 500) {
    return detail || 'Unexpected server error. The claim was not assumed changed.';
  }
  return detail || 'Request was not accepted.';
}

export function isAmbiguousMutationFailure(status: number | null): boolean {
  if (status == null) return true;
  return status >= 500 || status === 0;
}

export type ClaimRefreshDecision = 'apply' | 'ignore';

export function claimRefreshDecision(
  currentGeneration: number,
  responseGeneration: number,
): ClaimRefreshDecision {
  return currentGeneration === responseGeneration ? 'apply' : 'ignore';
}
