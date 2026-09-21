/**
 * Stage14B-1 read-only authoritative workflow routing.
 * Presentation only. Not a detector. Not a financial writer.
 */
import type {
  FinancialObligationDto,
  FinancialReconciliationDetailDto,
  ReconciliationFindingDto,
} from './financial-reconciliation-api';

const KNOWN_FINDING_CODES = [
  'RA_RETURN_RESTRICTION_MISSING',
  'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH',
  'RA_RETURN_RESTRICTION_MULTIPLE',
  'RA_RETURN_DOUBLE_COLLECTIBLE',
  'RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH',
  'RA_RETURN_SNAPSHOT_ACK_MISMATCH',
  'RA_RETURN_CREDITOR_MISMATCH',
  'RA_RETURN_RA_MISSING',
  'INSUFFICIENT_SOURCE_LINKAGE',
  'CURRENCY_MISMATCH',
  'COVERAGE_SOURCE_MISSING',
  'STAGE9_COVERAGE_MISSING',
  'STAGE9_COVERAGE_AMOUNT_MISMATCH',
  'COVERAGE_WRONG_LOSS',
  'COVERAGE_DUPLICATE_SEMANTIC',
  'COVERAGE_EXCEEDS_COMPENSABLE',
  'SUBJECT_MATCH_UNKNOWN',
  'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
  'SUCCESSOR_REVIEW_REQUIRED',
  'SUCCESSOR_BRANCH_DETECTED',
  'SUCCESSOR_CYCLE_DETECTED',
] as const;

export type KnownFindingCode = (typeof KNOWN_FINDING_CODES)[number];

export const ENGINEERING_ONLY_CODES: readonly KnownFindingCode[] = [
  'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH',
  'RA_RETURN_RESTRICTION_MULTIPLE',
  'RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH',
  'RA_RETURN_SNAPSHOT_ACK_MISMATCH',
  'RA_RETURN_CREDITOR_MISMATCH',
  'RA_RETURN_RA_MISSING',
  'INSUFFICIENT_SOURCE_LINKAGE',
  'CURRENCY_MISMATCH',
  'COVERAGE_SOURCE_MISSING',
  'COVERAGE_DUPLICATE_SEMANTIC',
  'COVERAGE_EXCEEDS_COMPENSABLE',
  'SUCCESSOR_BRANCH_DETECTED',
  'SUCCESSOR_CYCLE_DETECTED',
];

const ENGINEERING_SET = new Set<string>(ENGINEERING_ONLY_CODES);
const KNOWN_CODES = new Set<string>(KNOWN_FINDING_CODES);

export type WorkflowKind =
  | 'STALE'
  | 'INACTIVE'
  | 'UNSUPPORTED'
  | 'ENGINEERING'
  | 'STAGE12_CLAIM'
  | 'STAGE9_RETURN_FINANCIAL'
  | 'WAITING_ON_PARTY'
  | 'REVIEW_ONLY';

export type WorkflowDestination =
  | { type: 'stage12_claim'; claimId: string; expectedWkOrderId: number }
  | { type: 'stage9_return_financial'; wkOrderId: number }
  | { type: 'stage13a_obligation'; obligationId: string; expectedWkOrderId: number }
  | null;

export type AuthoritativeWorkflowView = {
  kind: WorkflowKind;
  title: string;
  requiredActor: string;
  safeAction: string;
  liveStatus: string;
  destination: WorkflowDestination;
  destinationHref: string | null;
  destinationLabel: string | null;
  blocked: boolean;
  blockedReason: string | null;
  notes: string[];
};

export type ExceptionClaimLinkageInput = {
  id: string;
  wkOrderId: number;
  economicLossId?: string | null;
  economicLoss?: { id?: string | null } | null;
  determinations?: Array<{ id?: string | null }> | null;
  obligations?: Array<{ id?: string | null }> | null;
};

export type ReviewWorkflowInput = {
  findingKey: string;
  findingCode: string;
  wkOrderId: number;
  needsRefresh: boolean;
  stale: boolean;
  findingActive: boolean;
};

export type WorkflowDomainContext = {
  stage9ReturnFinancialStatus?: string | null;
  claims?: ExceptionClaimLinkageInput[];
};

export type ClaimLinkage =
  | { status: 'none'; claimIds: [] }
  | { status: 'conflict'; claimIds: [] }
  | { status: 'one'; claimIds: [string]; claimId: string }
  | { status: 'many'; claimIds: string[] };

export function isEngineeringOnlyCode(code: string): boolean {
  return ENGINEERING_SET.has(code);
}

export function workflowDestinationHref(
  destination: WorkflowDestination,
): string | null {
  if (!destination) return null;
  if (destination.type === 'stage12_claim') {
    return `/admin/exception-claims/${destination.claimId}?expectedWkOrderId=${destination.expectedWkOrderId}`;
  }
  if (destination.type === 'stage9_return_financial') {
    return `/admin/wk-orders/${destination.wkOrderId}/return-financial`;
  }
  return `/admin/exception-financial-obligations/${destination.obligationId}?expectedWkOrderId=${destination.expectedWkOrderId}`;
}

function blocked(
  kind: WorkflowKind,
  title: string,
  requiredActor: string,
  safeAction: string,
  liveStatus: string,
  blockedReason: string,
  notes: string[] = [],
): AuthoritativeWorkflowView {
  return {
    kind,
    title,
    requiredActor,
    safeAction,
    liveStatus,
    destination: null,
    destinationHref: null,
    destinationLabel: null,
    blocked: true,
    blockedReason,
    notes,
  };
}

function withDestination(
  view: Omit<AuthoritativeWorkflowView, 'destinationHref'>,
): AuthoritativeWorkflowView {
  return {
    ...view,
    destinationHref: workflowDestinationHref(view.destination),
  };
}

function engineeringView(
  liveStatus: string,
  extraNotes: string[] = [],
): AuthoritativeWorkflowView {
  return {
    kind: 'ENGINEERING',
    title: 'Engineering investigation',
    requiredActor: 'Engineering',
    safeAction: 'Escalate to engineering. No financial product action is available.',
    liveStatus,
    destination: null,
    destinationHref: null,
    destinationLabel: null,
    blocked: true,
    blockedReason: 'Data integrity / engineering review. Authoritative financial action: none available.',
    notes: [
      'Category: Data integrity / engineering review',
      ...extraNotes,
    ],
  };
}

function nonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function claimEconomicLossId(claim: ExceptionClaimLinkageInput): string | null {
  if (nonEmptyId(claim.economicLossId)) return claim.economicLossId;
  const nested = claim.economicLoss?.id;
  return nonEmptyId(nested) ? nested : null;
}

function claimObligationIds(claim: ExceptionClaimLinkageInput): string[] {
  return (claim.obligations ?? []).map((row) => row.id).filter(nonEmptyId);
}

function claimDeterminationIds(claim: ExceptionClaimLinkageInput): string[] {
  return (claim.determinations ?? []).map((row) => row.id).filter(nonEmptyId);
}

function intersectClaimSets(
  current: Set<string> | null,
  next: Set<string>,
): Set<string> {
  if (current == null) return new Set(next);
  const out = new Set<string>();
  for (const id of current) {
    if (next.has(id)) out.add(id);
  }
  return out;
}

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.filter(nonEmptyId))];
}

/**
 * Conservative Stage12 claim linkage.
 * Obligation match: finding EXCEPTION_FINANCIAL involved obligationId equals
 * claim.obligations[].id (the claim's obligation collection).
 * Loss match: recon item.economicLossId equals claim.economicLossId, else
 * claim.economicLoss.id.
 * Determination match: item.determinationId equals claim.determinations[].id
 * (any determination on the claim, including successor rows).
 * Each present identifier is an independent constraint; sets are intersected.
 * A present identifier that matches zero claims blocks. Conflicting claim
 * sets block. Order membership alone is not linkage.
 */
export function resolveExceptionClaimLinkage(input: {
  reviewWkOrderId: number;
  finding: ReconciliationFindingDto;
  items: FinancialObligationDto[];
  claims: ExceptionClaimLinkageInput[];
}): ClaimLinkage {
  const sameOrder = input.claims.filter(
    (claim) => claim.wkOrderId === input.reviewWkOrderId,
  );
  const involvedExceptionIds = uniqueIds(
    input.finding.involvedItems
      .filter((item) => item.rail === 'EXCEPTION_FINANCIAL')
      .map((item) => item.obligationId),
  );
  const involvedAnyIds = uniqueIds(
    input.finding.involvedItems.map((item) => item.obligationId),
  );
  const identifierItems = input.items.filter(
    (item) =>
      item.wkOrderId === input.reviewWkOrderId &&
      involvedAnyIds.includes(item.obligationId),
  );
  const lossIds = uniqueIds(identifierItems.map((item) => item.economicLossId));
  const determinationIds = uniqueIds(
    identifierItems.map((item) => item.determinationId),
  );

  const constraints: string[][] = [];
  let unmatchedPresent = false;

  const apply = (matchingIds: string[]) => {
    if (matchingIds.length === 0) {
      unmatchedPresent = true;
      return;
    }
    constraints.push(matchingIds);
  };

  for (const obligationId of involvedExceptionIds) {
    apply(
      sameOrder
        .filter((claim) => claimObligationIds(claim).includes(obligationId))
        .map((claim) => claim.id),
    );
  }
  for (const lossId of lossIds) {
    apply(
      sameOrder
        .filter((claim) => claimEconomicLossId(claim) === lossId)
        .map((claim) => claim.id),
    );
  }
  for (const determinationId of determinationIds) {
    apply(
      sameOrder
        .filter((claim) =>
          claimDeterminationIds(claim).includes(determinationId),
        )
        .map((claim) => claim.id),
    );
  }

  if (involvedExceptionIds.length === 0 && lossIds.length === 0 && determinationIds.length === 0) {
    return { status: 'none', claimIds: [] };
  }
  if (unmatchedPresent) {
    return { status: 'conflict', claimIds: [] };
  }

  let intersection: Set<string> | null = null;
  for (const matching of constraints) {
    intersection = intersectClaimSets(intersection, new Set(matching));
  }
  const claimIds = intersection ? [...intersection] : [];
  if (claimIds.length === 0) return { status: 'conflict', claimIds: [] };
  if (claimIds.length === 1) {
    return { status: 'one', claimIds: [claimIds[0]], claimId: claimIds[0] };
  }
  return { status: 'many', claimIds };
}

function stage12FromLinkage(
  linkage: ClaimLinkage,
  wkOrderId: number,
  liveStatus: string,
  title: string,
  requiredActor: string,
  safeAction: string,
  notes: string[],
  kind: WorkflowKind = 'STAGE12_CLAIM',
): AuthoritativeWorkflowView {
  if (linkage.status === 'none') {
    return blocked(
      kind,
      title,
      requiredActor,
      'Inspect operational review only. Do not open a liability claim from this detector.',
      liveStatus,
      'No authoritative Stage12 claim is currently linked.',
      [
        ...notes,
        'No eligible authoritative liability claim is currently linked.',
        'A Stage12 claim may only be opened through legitimate Stage11 eligibility.',
      ],
    );
  }
  if (linkage.status === 'conflict') {
    return blocked(
      kind,
      title,
      requiredActor,
      'Inspect operational review. Do not pick a claim automatically.',
      liveStatus,
      'Authoritative Stage12 linkage is conflicting.',
      notes,
    );
  }
  if (linkage.status === 'many') {
    return blocked(
      kind,
      title,
      requiredActor,
      'Inspect operational review. Do not pick a claim automatically.',
      liveStatus,
      'Multiple authoritative Stage12 claims match this reconciliation item.',
      notes,
    );
  }
  return withDestination({
    kind,
    title,
    requiredActor,
    safeAction,
    liveStatus,
    destination: {
      type: 'stage12_claim',
      claimId: linkage.claimId,
      expectedWkOrderId: wkOrderId,
    },
    destinationLabel: 'Open liability claim',
    blocked: false,
    blockedReason: null,
    notes,
  });
}

function stage9Inspect(
  wkOrderId: number,
  liveStatus: string,
  title: string,
  requiredActor: string,
  safeAction: string,
  notes: string[],
  kind: WorkflowKind,
): AuthoritativeWorkflowView {
  return withDestination({
    kind,
    title,
    requiredActor,
    safeAction,
    liveStatus,
    destination: { type: 'stage9_return_financial', wkOrderId },
    destinationLabel: 'View return financial resolution',
    blocked: false,
    blockedReason: null,
    notes,
  });
}

export function resolveAuthoritativeWorkflow(input: {
  review: ReviewWorkflowInput;
  liveReconciliation: FinancialReconciliationDetailDto;
  domainContext?: WorkflowDomainContext;
}): AuthoritativeWorkflowView {
  const { review, liveReconciliation } = input;
  const domain = input.domainContext ?? {};

  if (!KNOWN_CODES.has(review.findingCode)) {
    return blocked(
      'UNSUPPORTED',
      'Unsupported reconciliation finding',
      'Engineering',
      'Unsupported reconciliation finding. Engineering review required.',
      'Unknown finding code',
      'Unsupported reconciliation finding. Engineering review required.',
    );
  }

  if (liveReconciliation.wkOrderId !== review.wkOrderId) {
    return blocked(
      'UNSUPPORTED',
      'Order mismatch',
      'Engineering',
      'Do not open an authoritative record.',
      'Live reconciliation order does not match this follow-up.',
      'Live reconciliation order does not match this follow-up.',
    );
  }

  if (review.needsRefresh || review.stale) {
    return blocked(
      'STALE',
      'Refresh required',
      'System Admin',
      'Refresh this follow-up before opening the authoritative workflow.',
      'Reconciliation changed since this follow-up last refreshed.',
      'Reconciliation changed. Refresh this review before opening the authoritative workflow.',
    );
  }

  const finding = liveReconciliation.findings.find(
    (row) => row.findingKey === review.findingKey,
  );
  if (!finding) {
    return blocked(
      'INACTIVE',
      'Condition no longer active',
      'System Admin',
      'This reconciliation condition is no longer active. Use condition-cleared close if appropriate.',
      'Finding is not present on live reconciliation.',
      'This reconciliation condition is no longer active.',
      ['Viewing a domain page does not close this follow-up.'],
    );
  }

  if (finding.code !== review.findingCode) {
    return engineeringView(
      'Live finding code does not match this follow-up.',
      ['Fail closed: do not route from a mismatched finding code.'],
    );
  }

  const liveStatus = `Live finding ${finding.code} is active.`;
  const linkage = resolveExceptionClaimLinkage({
    reviewWkOrderId: review.wkOrderId,
    finding,
    items: liveReconciliation.items,
    claims: domain.claims ?? [],
  });
  const stage9Status = domain.stage9ReturnFinancialStatus ?? null;

  switch (finding.code) {
    case 'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH':
    case 'RA_RETURN_RESTRICTION_MULTIPLE':
    case 'RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH':
    case 'RA_RETURN_SNAPSHOT_ACK_MISMATCH':
    case 'RA_RETURN_CREDITOR_MISMATCH':
    case 'RA_RETURN_RA_MISSING':
    case 'INSUFFICIENT_SOURCE_LINKAGE':
    case 'CURRENCY_MISMATCH':
    case 'COVERAGE_SOURCE_MISSING':
    case 'COVERAGE_DUPLICATE_SEMANTIC':
    case 'COVERAGE_EXCEEDS_COMPENSABLE':
      return engineeringView(liveStatus);

    case 'SUCCESSOR_BRANCH_DETECTED':
      return engineeringView(liveStatus, [
        'Successor topology is branched. Do not choose a financial branch from this follow-up.',
      ]);

    case 'SUCCESSOR_CYCLE_DETECTED':
      return engineeringView(liveStatus, [
        'Successor topology is cyclic. Do not perform financial workflow actions from this follow-up.',
      ]);

    case 'RA_RETURN_RESTRICTION_MISSING':
      if (stage9Status === 'FINALIZED') {
        return engineeringView(liveStatus, [
          'Stage9 is already FINALIZED. No party writer can create the missing restriction.',
          'This is not waiting on rider, customer, or merchant.',
        ]);
      }
      return stage9Inspect(
        review.wkOrderId,
        liveStatus,
        'Return financial resolution',
        'Merchant / System Admin adjudication (inspect only in this stage)',
        'Inspect return determination. Restriction cannot be patched from admin UI.',
        [
          'Pre-finalization inspect only. Stage14B-1 does not expose finalize.',
          'Never treat missing restriction as a rider cash/ACK task.',
        ],
        'STAGE9_RETURN_FINANCIAL',
      );

    case 'RA_RETURN_DOUBLE_COLLECTIBLE':
      return stage9Inspect(
        review.wkOrderId,
        liveStatus,
        'Return financial resolution',
        'Merchant → Rider',
        'Inspect return financial settlement status. Waiting on party action.',
        [
          'Preferred clearing path is merchant→rider Stage9 settlement (merchant claims transfer, rider acknowledges).',
          'Do not recommend customer Rider Advance reimbursement as a fix.',
          'System Admin inspect only. No admin ACK.',
        ],
        'WAITING_ON_PARTY',
      );

    case 'STAGE9_COVERAGE_MISSING':
      return stage12FromLinkage(
        linkage,
        review.wkOrderId,
        liveStatus,
        'Stage12 liability review',
        'System Admin',
        'Review the authoritative claim. Stage9 coverage is imported during legitimate Stage12 determination finalization.',
        [
          'Do not import, create, or correct coverage from this follow-up.',
          'Opening this page does not clear the finding.',
        ],
      );

    case 'STAGE9_COVERAGE_AMOUNT_MISMATCH':
    case 'COVERAGE_WRONG_LOSS':
      return stage12FromLinkage(
        linkage,
        review.wkOrderId,
        liveStatus,
        'Stage12 liability review',
        'System Admin',
        'Investigation required. Inspect coverage and loss records. Do not correct coverage here.',
        ['Coverage is not settlement. No coverage mutation in Stage14B-1.'],
      );

    case 'SUBJECT_MATCH_UNKNOWN':
      if (linkage.status === 'none') {
        return {
          kind: 'REVIEW_ONLY',
          title: 'Review only',
          requiredActor: 'System Admin',
          safeAction:
            'Review topology / subject state. Review-only close remains available under frozen Stage14A policy.',
          liveStatus,
          destination: null,
          destinationHref: null,
          destinationLabel: null,
          blocked: true,
          blockedReason: 'No authoritative Stage12 claim is currently linked.',
          notes: [
            'Do not invent a matcher override.',
            'No eligible authoritative liability claim is currently linked.',
          ],
        };
      }
      return stage12FromLinkage(
        linkage,
        review.wkOrderId,
        liveStatus,
        'Stage12 liability review',
        'System Admin',
        'Review verified facts and subject evidence.',
        ['Do not invent a matcher override.'],
        'REVIEW_ONLY',
      );

    case 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE':
      return stage12FromLinkage(
        linkage,
        review.wkOrderId,
        liveStatus,
        'Stage12 liability review',
        'Debtor / Creditor (settlement) · System Admin (inspect)',
        'Inspect both authoritative obligations. Do not net or merge them.',
        [
          'Keep both obligations visible.',
          'Admin inspect only. Settlement ACK remains the economic creditor.',
        ],
      );

    case 'SUCCESSOR_REVIEW_REQUIRED':
      return stage12FromLinkage(
        linkage,
        review.wkOrderId,
        liveStatus,
        'Stage12 liability review',
        'System Admin',
        'Review original finalized determination and successor adjustment. Review-only close remains available.',
        [
          'Do not suggest editing either determination.',
          'Language: original determination and successor adjustment — not replacement balance.',
        ],
        'REVIEW_ONLY',
      );

    default:
      return blocked(
        'UNSUPPORTED',
        'Unsupported reconciliation finding',
        'Engineering',
        'Unsupported reconciliation finding. Engineering review required.',
        liveStatus,
        'Unsupported reconciliation finding. Engineering review required.',
      );
  }
}
