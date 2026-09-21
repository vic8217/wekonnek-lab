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

export const DETERMINATION_REVIEW_COPY =
  'Draft and Proposed determinations are review states. Financial obligations are not created until the server finalizes an eligible determination.';

export const DETERMINATION_DRAFT_IMMUTABLE_COPY =
  'This draft cannot be edited or replaced in the current workflow. Review carefully before proposing. Do not propose a draft that is incorrect merely to clear the active slot.';

export const DETERMINATION_PROPOSE_CONFIRM_COPY =
  'Proposing locks this determination for the next financial review step. It cannot be returned to Draft in the current workflow. This does not create a payment or obligation and does not finalize liability.';

export const DETERMINATION_SELF_LIABILITY_COPY =
  'At finalization, the server determines the creditor and whether an allocation produces a payable obligation.';

export const DETERMINATION_CREDITOR_COPY =
  'The server determines the creditor from the loss and order context. This workspace does not select a creditor.';

export const DETERMINATION_SELF_LIABILITY_OBSERVATION_COPY =
  'A debtor that is also the server-resolved creditor may cover part of the loss without creating a payable obligation for that allocation.';

export const DETERMINATION_UNPROVABLE_ALLOCATION_COPY =
  'The stored allocation cannot be verified against the current authoritative party information. Finalization is unavailable.';

export const DETERMINATION_RECORD_ORIGINAL_CONFIRM_COPY =
  'Finalizing makes this liability determination authoritative. The server may record coverage for the loss, create payable financial obligations for non-self allocations, resolve the creditor from the order/loss context, and mark the determination and claim finalized. The original determination cannot be edited afterward. Not every allocation creates an obligation.';

export const DETERMINATION_ADJUSTMENT_SEMANTICS_COPY =
  'An adjustment is additional recovery against remaining uncovered loss. It does not replace the prior finalized determination, reduce prior principal, reverse prior obligations, void prior coverage, or net prior settlement.';

export const DETERMINATION_ADJUSTMENT_IMMUTABLE_COPY =
  'The adjustment becomes an immutable Draft. It cannot be edited, cancelled, deleted or replaced in the current workflow. Do not create it unless the allocations are correct. Finalizing is not a way to clear a mistaken draft.';

export const DETERMINATION_RECORD_SUCCESSOR_CONFIRM_COPY =
  'This finalizes an additional recovery determination against remaining uncovered loss. The server may create additional coverage and financial obligations. It does not replace or reduce earlier finalized obligations.';

export const SUCCESSOR_SOURCE_INCONSISTENCY_CODES = [
  'SUCCESSOR_BRANCH_DETECTED',
  'SUCCESSOR_CYCLE_DETECTED',
] as const;

export const LIABILITY_DETERMINATION_ACTIVE_STATUSES = [
  'DRAFT',
  'PROPOSED',
] as const;

export const NON_CONFORMANCE_NON_GROUNDING_FACT_TYPES = [
  'GOODS_CONFORMANCE_CONFIRMED',
  'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED',
] as const;

export const NON_CONFORMANCE_MERCHANT_GROUNDING_FACT_TYPES = [
  'GOODS_NON_CONFORMANCE_CONFIRMED',
  'PARTY_NEGLIGENCE_CONFIRMED',
] as const;

export const NON_CONFORMANCE_RIDER_GROUNDING_FACT_TYPES = [
  'PARTY_NEGLIGENCE_CONFIRMED',
  'CUSTODY_LAST_HOLDER_CONFIRMED',
] as const;

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

export function findDeterminationByCreateKey(
  rows: Array<Record<string, unknown>>,
  idempotencyKey: string,
): Record<string, unknown> | null {
  return (
    rows.find(
      (row) => stringField(row, 'createIdempotencyKey') === idempotencyKey,
    ) ?? null
  );
}

export function isCreateDeterminationProven(input: {
  claimId: string;
  determinations: Array<Record<string, unknown>>;
  createIdempotencyKey: string;
}): boolean {
  const row = findDeterminationByCreateKey(
    input.determinations,
    input.createIdempotencyKey,
  );
  if (!row) return false;
  const ownerClaimId = stringField(row, 'exceptionClaimId');
  if (ownerClaimId != null && ownerClaimId !== input.claimId) return false;
  return true;
}

export function isEligibleDraftReviewProven(input: {
  claimId: string;
  determinationId: string;
  determinations: Array<Record<string, unknown>>;
  proposeIdempotencyKey?: string;
}): boolean {
  const row =
    input.determinations.find(
      (item) => stringField(item, 'id') === input.determinationId,
    ) ?? null;
  if (!row) return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  if (stringField(row, 'status') !== 'PROPOSED') return false;
  if (isSuccessorDetermination(row)) return false;
  const storedKey = stringField(row, 'proposeIdempotencyKey');
  if (
    storedKey &&
    input.proposeIdempotencyKey &&
    storedKey !== input.proposeIdempotencyKey
  ) {
    return false;
  }
  return true;
}

export type PostMutationRefreshOutcome =
  | 'discarded'
  | 'success'
  | 'unproven'
  | 'error';

/**
 * HTTP 2xx is transport success only. Workflow success is opt-in
 * authoritative graph proof. Frozen 14B-2A callers omit that opt-in.
 */
export function decidePostMutationRefreshOutcome(input: {
  discarded: boolean;
  hasLatest: boolean;
  requireAuthoritativeProof: boolean;
  confirmed: boolean;
}): PostMutationRefreshOutcome {
  if (input.discarded) return 'discarded';
  if (!input.hasLatest) return 'error';
  if (input.requireAuthoritativeProof) {
    return input.confirmed ? 'success' : 'unproven';
  }
  return 'success';
}

export function isSuccessorDetermination(row: Record<string, unknown>): boolean {
  return stringField(row, 'adjustmentOfDeterminationId') != null;
}

export function activeLiabilityDeterminations(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.filter((row) => {
    const status = stringField(row, 'status');
    return (
      status != null &&
      (LIABILITY_DETERMINATION_ACTIVE_STATUSES as readonly string[]).includes(
        status,
      )
    );
  });
}

export function canCreateLiabilityDraft(input: {
  claimStatus: unknown;
  facts: Array<Record<string, unknown>>;
  determinations: Array<Record<string, unknown>>;
  debtorOptions: FactAttributionOption[];
}): boolean {
  return (
    isActiveClaimStatus(input.claimStatus) &&
    input.facts.length > 0 &&
    activeLiabilityDeterminations(input.determinations).length === 0 &&
    input.debtorOptions.length > 0
  );
}

export function canSubmitEligibleLiabilityDraft(input: {
  claimId: string;
  claimStatus: unknown;
  determination: Record<string, unknown> | null;
}): boolean {
  const row = input.determination;
  if (!row) return false;
  if (!isActiveClaimStatus(input.claimStatus)) return false;
  if (stringField(row, 'status') !== 'DRAFT') return false;
  if (isSuccessorDetermination(row)) return false;
  const ownerClaimId = stringField(row, 'exceptionClaimId');
  return ownerClaimId === input.claimId;
}

export function collectAuthoritativeDebtorOptions(
  claim: Record<string, unknown>,
): FactAttributionOption[] {
  return collectAuthoritativeFactAttributionOptions(claim).map((row) => ({
    ...row,
    label:
      row.partyType === 'CUSTOMER'
        ? 'Customer'
        : row.partyType === 'MERCHANT'
          ? 'Merchant'
          : 'Rider',
  }));
}

/**
 * Stage14B-2C financial identity. Merchant authority is only the unique
 * same-claim MERCHANT obligation creditorMerchantId. ORDER_TERMS_SNAPSHOT
 * metadata is evidence, not a debtor identity source: generic
 * POST /evidence can reproduce evidenceKind + metadata.merchantId.
 */
export function collectFinalizationDebtorOptions(
  claim: Record<string, unknown>,
): FactAttributionOption[] {
  const parties = collectObligationPartyIds(claim);
  const options: FactAttributionOption[] = [];
  const customers = uniqueStrings(parties.customerIds);
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
  const merchants = uniqueNumbers(parties.creditorMerchantIds);
  if (merchants.length === 1) {
    const id = merchants[0];
    options.push({
      partyType: 'MERCHANT',
      partyUserId: null,
      partyMerchantId: id,
      label: `Merchant (${id})`,
      source: 'obligations[].creditorMerchantId where creditorType=MERCHANT',
      optionKey: `MERCHANT:${id}`,
    });
  }
  const riders = uniqueStrings(parties.riderIds);
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

export type FrozenAdjustmentMutation = {
  parentDeterminationId: string;
  allocations: Array<{
    partyType: string;
    partyUserId?: string | null;
    partyMerchantId?: number | null;
    amount: string;
    verifiedFactId?: string | null;
    basis?: string | null;
  }>;
  reason: string;
};

export function adjustmentGestureLocksPayload(
  gesture: ActiveGesture | null,
): boolean {
  return (
    gesture != null &&
    (gesture.status === 'in_flight' || gesture.status === 'ambiguous')
  );
}

export function resolveAdjustmentMutationPayload(input: {
  frozen: FrozenAdjustmentMutation | null;
  live: FrozenAdjustmentMutation;
}): FrozenAdjustmentMutation {
  return input.frozen ?? input.live;
}

/**
 * After the last awaited preflight (including live reconciliation),
 * re-check route ownership and only then POST. Discarded stale owners
 * must not mutate and must not paint success/error onto the new route.
 */
export async function mutateAfterOwnedPreflight<T>(input: {
  ownerIsCurrent: () => boolean;
  runPreflight: () => Promise<string | null>;
  mutate: () => Promise<T>;
}): Promise<
  | { status: 'discarded' }
  | { status: 'blocked'; message: string }
  | { status: 'posted'; value: T }
> {
  const blocked = await input.runPreflight();
  if (!input.ownerIsCurrent()) return { status: 'discarded' };
  if (blocked) return { status: 'blocked', message: blocked };
  const value = await input.mutate();
  return { status: 'posted', value };
}

export function isPositiveMoneyString(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(trimmed)) return false;
  if (/^0(?:\.0{1,2})?$/.test(trimmed)) return false;
  return true;
}

export function serverSnapshotShowsRemaining(value: unknown): boolean {
  return typeof value === 'string' && isPositiveMoneyString(value);
}

export function storedAllocationsAreBounded(
  allocations: Array<Record<string, unknown>>,
  debtorOptions: FactAttributionOption[],
): boolean {
  if (allocations.length === 0) return false;
  return allocations.every((row) => {
    const partyType = stringField(row, 'partyType');
    if (
      partyType !== 'CUSTOMER' &&
      partyType !== 'MERCHANT' &&
      partyType !== 'RIDER'
    ) {
      return false;
    }
    if (partyType === 'MERCHANT') {
      const merchantId = integerId(row.partyMerchantId);
      if (merchantId == null) return false;
      return debtorOptions.some(
        (option) =>
          option.partyType === 'MERCHANT' &&
          option.partyMerchantId === merchantId,
      );
    }
    const userId = stringField(row, 'partyUserId');
    if (!userId) return false;
    return debtorOptions.some(
      (option) => option.partyType === partyType && option.partyUserId === userId,
    );
  });
}

export type SuccessorTopologyReason =
  | 'ok'
  | 'empty'
  | 'cycle'
  | 'branch'
  | 'missing_parent'
  | 'disconnected'
  | 'multiple_tips'
  | 'no_tip';

export type SuccessorTopology = {
  safe: boolean;
  reason: SuccessorTopologyReason;
  tipId: string | null;
};

export function analyzeSuccessorTopology(
  determinations: Array<Record<string, unknown>>,
): SuccessorTopology {
  const rows = determinations.filter((row) => stringField(row, 'id') != null);
  if (rows.length === 0) {
    return { safe: false, reason: 'empty', tipId: null };
  }
  const byId = new Map(
    rows.map((row) => [stringField(row, 'id') as string, row]),
  );
  const children = new Map<string, string[]>();
  const roots: string[] = [];

  for (const row of rows) {
    const id = stringField(row, 'id') as string;
    const parentId = stringField(row, 'adjustmentOfDeterminationId');
    if (!parentId) {
      roots.push(id);
      continue;
    }
    if (!byId.has(parentId)) {
      return { safe: false, reason: 'missing_parent', tipId: null };
    }
    const list = children.get(parentId) ?? [];
    list.push(id);
    children.set(parentId, list);
  }

  for (const start of rows) {
    const seen = new Set<string>();
    let current = stringField(start, 'id');
    while (current) {
      if (seen.has(current)) {
        return { safe: false, reason: 'cycle', tipId: null };
      }
      seen.add(current);
      const node = byId.get(current);
      current = node ? stringField(node, 'adjustmentOfDeterminationId') : null;
    }
  }

  for (const kids of children.values()) {
    if (kids.length > 1) {
      return { safe: false, reason: 'branch', tipId: null };
    }
  }

  if (roots.length > 1) {
    return { safe: false, reason: 'disconnected', tipId: null };
  }
  if (roots.length === 0) {
    return { safe: false, reason: 'cycle', tipId: null };
  }

  const finalizedTips = rows.filter((row) => {
    const id = stringField(row, 'id') as string;
    return (
      stringField(row, 'status') === 'FINALIZED' &&
      (children.get(id) ?? []).length === 0
    );
  });
  if (finalizedTips.length === 0) {
    return { safe: false, reason: 'no_tip', tipId: null };
  }
  if (finalizedTips.length > 1) {
    return { safe: false, reason: 'multiple_tips', tipId: null };
  }
  return {
    safe: true,
    reason: 'ok',
    tipId: stringField(finalizedTips[0], 'id'),
  };
}

export function reconHasSuccessorSourceInconsistency(
  findings: unknown,
): boolean {
  if (!Array.isArray(findings)) return false;
  return findings.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const code = stringField(row as Record<string, unknown>, 'code');
    return (
      code != null &&
      (SUCCESSOR_SOURCE_INCONSISTENCY_CODES as readonly string[]).includes(code)
    );
  });
}

export function canRecordOriginalLiability(input: {
  claimId: string;
  determination: Record<string, unknown> | null;
  debtorOptions: FactAttributionOption[];
}): boolean {
  const row = input.determination;
  if (!row) return false;
  if (isSuccessorDetermination(row)) return false;
  if (stringField(row, 'status') !== 'PROPOSED') return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  return storedAllocationsAreBounded(
    asRecordList(row.allocations),
    input.debtorOptions,
  );
}

export function canCreateSuccessorAdjustment(input: {
  facts: Array<Record<string, unknown>>;
  determinations: Array<Record<string, unknown>>;
  debtorOptions: FactAttributionOption[];
}): boolean {
  if (input.facts.length === 0) return false;
  if (input.debtorOptions.length === 0) return false;
  if (activeLiabilityDeterminations(input.determinations).length > 0) {
    return false;
  }
  const topology = analyzeSuccessorTopology(input.determinations);
  if (!topology.safe || !topology.tipId) return false;
  const tip =
    input.determinations.find(
      (row) => stringField(row, 'id') === topology.tipId,
    ) ?? null;
  if (!tip || stringField(tip, 'status') !== 'FINALIZED') return false;
  return serverSnapshotShowsRemaining(tip.remainingAmountSnapshot);
}

export function canRecordSuccessorLiability(input: {
  claimId: string;
  determination: Record<string, unknown> | null;
  determinations: Array<Record<string, unknown>>;
  debtorOptions: FactAttributionOption[];
}): boolean {
  const row = input.determination;
  if (!row) return false;
  const detId = stringField(row, 'id');
  if (!detId) return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  if (stringField(row, 'status') !== 'DRAFT') return false;
  const parentId = stringField(row, 'adjustmentOfDeterminationId');
  if (!parentId) return false;
  const topology = analyzeSuccessorTopology(input.determinations);
  if (
    topology.reason === 'cycle' ||
    topology.reason === 'branch' ||
    topology.reason === 'missing_parent' ||
    topology.reason === 'disconnected' ||
    topology.reason === 'multiple_tips'
  ) {
    return false;
  }
  const parent =
    input.determinations.find((item) => stringField(item, 'id') === parentId) ??
    null;
  if (!parent || stringField(parent, 'status') !== 'FINALIZED') return false;
  const hasChild = input.determinations.some(
    (item) => stringField(item, 'adjustmentOfDeterminationId') === detId,
  );
  if (hasChild) return false;
  return storedAllocationsAreBounded(
    asRecordList(row.allocations),
    input.debtorOptions,
  );
}

export function isOriginalLiabilityRecordingProven(input: {
  claimId: string;
  determinationId: string;
  determinations: Array<Record<string, unknown>>;
  finalizeIdempotencyKey?: string;
}): boolean {
  const row =
    input.determinations.find(
      (item) => stringField(item, 'id') === input.determinationId,
    ) ?? null;
  if (!row) return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  if (stringField(row, 'status') !== 'FINALIZED') return false;
  if (isSuccessorDetermination(row)) return false;
  const storedKey = stringField(row, 'finalizeIdempotencyKey');
  if (
    storedKey &&
    input.finalizeIdempotencyKey &&
    storedKey !== input.finalizeIdempotencyKey
  ) {
    return false;
  }
  return true;
}

export function isSuccessorAdjustmentProven(input: {
  claimId: string;
  parentDeterminationId: string;
  determinations: Array<Record<string, unknown>>;
  createIdempotencyKey: string;
}): boolean {
  const row = findDeterminationByCreateKey(
    input.determinations,
    input.createIdempotencyKey,
  );
  if (!row) return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  return (
    stringField(row, 'adjustmentOfDeterminationId') ===
    input.parentDeterminationId
  );
}

export function isSuccessorLiabilityRecordingProven(input: {
  claimId: string;
  successorId: string;
  parentDeterminationId: string;
  determinations: Array<Record<string, unknown>>;
  finalizeIdempotencyKey?: string;
}): boolean {
  const row =
    input.determinations.find(
      (item) => stringField(item, 'id') === input.successorId,
    ) ?? null;
  if (!row) return false;
  if (stringField(row, 'exceptionClaimId') !== input.claimId) return false;
  if (stringField(row, 'status') !== 'FINALIZED') return false;
  if (
    stringField(row, 'adjustmentOfDeterminationId') !==
    input.parentDeterminationId
  ) {
    return false;
  }
  const storedKey = stringField(row, 'finalizeIdempotencyKey');
  if (
    storedKey &&
    input.finalizeIdempotencyKey &&
    storedKey !== input.finalizeIdempotencyKey
  ) {
    return false;
  }
  return true;
}

export function allocationGroundingFacts(input: {
  claimType: unknown;
  partyType: string;
  facts: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const facts = input.facts.filter((row) => stringField(row, 'id') != null);
  if (input.claimType !== 'GOODS_NON_CONFORMANCE') return facts;
  const allowed =
    input.partyType === 'MERCHANT'
      ? NON_CONFORMANCE_MERCHANT_GROUNDING_FACT_TYPES
      : input.partyType === 'RIDER'
        ? NON_CONFORMANCE_RIDER_GROUNDING_FACT_TYPES
        : null;
  return facts.filter((row) => {
    const factType = stringField(row, 'factType');
    if (!factType) return false;
    if (
      (NON_CONFORMANCE_NON_GROUNDING_FACT_TYPES as readonly string[]).includes(
        factType,
      )
    ) {
      return false;
    }
    if (!allowed) return true;
    return (allowed as readonly string[]).includes(factType);
  });
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

function collectObligationPartyIds(claim: Record<string, unknown>): {
  customerIds: string[];
  riderIds: string[];
  creditorMerchantIds: number[];
} {
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
  return { customerIds, riderIds, creditorMerchantIds };
}

/**
 * Attribution options from frozen claim GET only.
 * Merchant (2B draft / fact attribution): ORDER_TERMS_SNAPSHOT.metadata.merchantId
 * and/or obligation creditorMerchantId where creditorType=MERCHANT.
 * Stage14B-2C finalization does not use this merchant union.
 * Customer/Rider: obligation creditorUserId where creditorType matches.
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

  const parties = collectObligationPartyIds(claim);

  const options: FactAttributionOption[] = [];
  const customers = uniqueStrings(parties.customerIds);
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
    ...parties.creditorMerchantIds,
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

  const riders = uniqueStrings(parties.riderIds);
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
