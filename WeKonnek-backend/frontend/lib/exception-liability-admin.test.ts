import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_ONLY_VISIBILITY_COPY,
  allocationGroundingFacts,
  CLAIM_EVIDENCE_KINDS,
  CLAIM_VERIFICATION_STATUSES,
  DEFAULT_EVIDENCE_VISIBILITY,
  MANUAL_EVIDENCE_KINDS,
  SUBJECT_MATCH_INVESTIGATION_COPY,
  VERIFIED_FACT_TYPES,
  attributionFromOptionKey,
  canCreateLiabilityDraft,
  canSubmitEligibleLiabilityDraft,
  claimRefreshDecision,
  claimWorkspacePanelKey,
  collectAuthoritativeDebtorOptions,
  collectAuthoritativeFactAttributionOptions,
  completeGesture,
  decidePostMutationRefreshOutcome,
  evidenceHasVerifiedConclusion,
  factTypeForbidsAttribution,
  findDeterminationByCreateKey,
  findRowByIdempotencyKey,
  isActiveClaimStatus,
  isAmbiguousMutationFailure,
  isCreateDeterminationProven,
  isCurrentClaimOwner,
  isEligibleDraftReviewProven,
  isPositiveMoneyString,
  isSuccessorDetermination,
  mapLiabilityAdminError,
  markGestureAmbiguous,
  mayAbortRouteLoad,
  normalizeExpectedWkOrderId,
  optionalDigitId,
  ownedResultDecision,
  submitGesture,
  verifiedSupportingEvidence,
} from './exception-liability-admin-presentation.ts';

const dir = dirname(fileURLToPath(import.meta.url));

function read(relative: string): string {
  return readFileSync(join(dir, relative), 'utf8');
}

const API = './exception-liability-admin-api.ts';
const PAGE = '../app/admin/exception-claims/[id]/page.tsx';
const EVIDENCE_PANEL = '../app/admin/exception-claims/[id]/claim-evidence-panel.tsx';
const VERIFY_PANEL = '../app/admin/exception-claims/[id]/evidence-verification-panel.tsx';
const FACT_PANEL = '../app/admin/exception-claims/[id]/verified-facts-panel.tsx';
const DET_PANEL = '../app/admin/exception-claims/[id]/liability-determination-panel.tsx';
const CANDIDATE_FILES = [
  API,
  './exception-liability-admin-presentation.ts',
  PAGE,
  EVIDENCE_PANEL,
  VERIFY_PANEL,
  FACT_PANEL,
  DET_PANEL,
  '../app/admin/exception-claims/[id]/claim-event-timeline.tsx',
];

const FORBIDDEN_POSTS = [
  '/finalize',
  '/adjustments',
  '/settlements/claim',
  '/settlements/cash',
  '/acknowledge',
  'ensureSeededPolicy',
  'type="file"',
  'input type="file"',
];

test('API helpers expose evidentiary and 2B determination POST paths only', () => {
  const src = read(API);
  assert.equal(src.includes('export async function addEvidence'), true);
  assert.equal(src.includes('export async function captureOrderTermsEvidence'), true);
  assert.equal(src.includes('export async function verifyEvidence'), true);
  assert.equal(src.includes('export async function createVerifiedFact'), true);
  assert.equal(src.includes('export async function createDetermination'), true);
  assert.equal(src.includes('export async function proposeDetermination'), true);
  assert.equal(src.includes("method: 'POST'"), true);
  assert.equal(src.includes('/exception-claims/${claimId}/evidence'), true);
  assert.equal(src.includes('/exception-claims/${claimId}/order-terms-evidence'), true);
  assert.equal(
    src.includes('/exception-claims/${claimId}/evidence/${evidenceId}/verify'),
    true,
  );
  assert.equal(src.includes('/exception-claims/${claimId}/verified-facts'), true);
  assert.equal(src.includes('/exception-claims/${claimId}/determinations'), true);
  assert.equal(
    src.includes('/liability-determinations/${determinationId}/propose'),
    true,
  );
  assert.equal(src.includes('/finalize'), false);
  assert.equal(src.includes('/adjustments'), false);
  assert.equal(src.includes('export async function createDetermination'), true);
  assert.equal(src.includes('finalizeDetermination'), false);
  assert.equal(src.includes('createAdjustment'), false);
  assert.equal(src.includes('Authorization'), true);
  assert.equal(src.includes('idempotencyKey'), true);
  assert.equal(src.includes('correlationId'), true);
  assert.equal(src.includes('mapLiabilityAdminError'), true);
  for (const token of FORBIDDEN_POSTS) {
    assert.equal(src.includes(token), false, token);
  }
});

test('error mapper preserves backend codes including VERIFIED_EVIDENCE_REQUIRED', () => {
  assert.equal(
    mapLiabilityAdminError(401, { code: 'UNAUTHORIZED', message: 'jwt' }),
    'UNAUTHORIZED: jwt',
  );
  assert.equal(
    mapLiabilityAdminError(403, {
      code: 'VERIFIED_EVIDENCE_REQUIRED',
      message: 'A verified fact requires at least one VERIFIED evidence verification',
    }).includes('VERIFIED_EVIDENCE_REQUIRED'),
    true,
  );
  assert.equal(
    mapLiabilityAdminError(403, { code: 'VERIFIED_EVIDENCE_REQUIRED', message: 'x' }).includes(
      'Something went wrong',
    ),
    false,
  );
  assert.equal(mapLiabilityAdminError(404, {}).includes('not found'), true);
  assert.equal(mapLiabilityAdminError(409, { code: 'EXCEPTION_CLAIM_TERMINAL', message: 'Claim is terminal (FINALIZED)' }).includes('EXCEPTION_CLAIM_TERMINAL'), true);
  assert.equal(mapLiabilityAdminError(500, {}).includes('Unexpected'), true);
});

test('claim status gate admits only active investigation states', () => {
  for (const status of ['OPEN', 'EVIDENCE_REVIEW', 'VERIFIED', 'DETERMINATION_PROPOSED']) {
    assert.equal(isActiveClaimStatus(status), true, status);
  }
  for (const status of ['FINALIZED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
    assert.equal(isActiveClaimStatus(status), false, status);
  }
});

test('evidence kinds, default visibility, and reference-only UI', () => {
  assert.deepEqual([...CLAIM_EVIDENCE_KINDS], [
    'PHOTO_REFERENCE',
    'DOCUMENT_REFERENCE',
    'STATEMENT',
    'CUSTODY_TRAIL_REFERENCE',
    'SYSTEM_RECORD',
    'ORDER_TERMS_SNAPSHOT',
    'DELIVERY_ATTEMPT_REFERENCE',
    'OPERATIONS_RECOVERY_REFERENCE',
    'OTHER',
  ]);
  assert.equal(DEFAULT_EVIDENCE_VISIBILITY, 'ADMIN_ONLY');
  const panel = read(EVIDENCE_PANEL);
  assert.equal(panel.includes('DEFAULT_EVIDENCE_VISIBILITY'), true);
  assert.equal(panel.includes('ADMIN_ONLY'), true);
  assert.equal(panel.includes('type="file"'), false);
  assert.equal(panel.includes('drag'), false);
  assert.equal(panel.includes('Edit evidence'), false);
  assert.equal(panel.includes('Delete evidence'), false);
  assert.equal(panel.includes('Replace evidence'), false);
  assert.equal(panel.includes('reference, not an uploaded attachment'), true);
  assert.equal(panel.includes('SENSITIVE_INFORMATION_COPY'), true);
  assert.equal(panel.includes('Capture Order Terms Snapshot'), true);
  assert.equal(panel.includes('does not mutate the order'), true);
  assert.equal(panel.includes('A statement is evidence only'), true);
  for (const kind of MANUAL_EVIDENCE_KINDS) {
    assert.equal(panel.includes(kind) || read('./exception-liability-admin-presentation.ts').includes(kind), true);
  }
  const page = read(PAGE);
  assert.equal(page.includes('isActiveClaimStatus'), false);
  assert.equal(page.includes('FINALIZED'), false);
  assert.equal(panel.includes('not in an active investigation state'), true);
});

test('order-terms capture uses specialized endpoint and no item fields', () => {
  const page = read(PAGE);
  const panel = read(EVIDENCE_PANEL);
  assert.equal(page.includes('captureOrderTermsEvidence'), true);
  assert.equal(panel.includes('productName'), false);
  assert.equal(panel.includes('retype'), true);
  assert.equal(read(API).includes('order-terms-evidence'), true);
});

test('verification statuses, append-only, and no settlement wording', () => {
  assert.deepEqual([...CLAIM_VERIFICATION_STATUSES], [
    'PENDING',
    'VERIFIED',
    'REJECTED',
    'INCONCLUSIVE',
  ]);
  const src = read(VERIFY_PANEL);
  assert.equal(src.includes('CLAIM_VERIFICATION_STATUSES'), true);
  for (const status of CLAIM_VERIFICATION_STATUSES) {
    assert.equal(
      src.includes(status) ||
        read('./exception-liability-admin-presentation.ts').includes(`'${status}'`),
      true,
      status,
    );
  }
  assert.equal(src.includes('APPROVED'), false);
  assert.equal(src.includes('Record Verification'), true);
  assert.equal(
    src.includes('not independent verification') ||
      read('./exception-liability-admin-presentation.ts').includes(
        'This is not independent verification.',
      ),
    true,
  );
  assert.equal(src.includes('settle, acknowledge, or mark anyone paid'), true);
  assert.equal(src.includes('payment verified'), false);
  assert.equal(src.includes('merchant paid'), false);
  assert.equal(src.includes('Edit verification'), false);
});

test('verified facts require statement, verified support, no PLATFORM, append-only', () => {
  assert.equal(VERIFIED_FACT_TYPES.length, 11);
  assert.equal(factTypeForbidsAttribution('GOODS_CONFORMANCE_CONFIRMED'), true);
  assert.equal(factTypeForbidsAttribution('NON_CONFORMANCE_ALLEGATION_UNSUPPORTED'), true);
  assert.equal(factTypeForbidsAttribution('GOODS_NON_CONFORMANCE_CONFIRMED'), false);
  const unverified = verifiedSupportingEvidence(
    [{ id: 'e1' }, { id: 'e2' }],
    [{ evidenceId: 'e1', verificationStatus: 'PENDING' }],
  );
  assert.equal(unverified.length, 0);
  const verified = verifiedSupportingEvidence(
    [{ id: 'e1' }, { id: 'e2' }],
    [{ evidenceId: 'e2', verificationStatus: 'VERIFIED' }],
  );
  assert.equal(verified.length, 1);
  assert.equal(evidenceHasVerifiedConclusion('e2', [{ evidenceId: 'e2', verificationStatus: 'VERIFIED' }]), true);
  const panel = read(FACT_PANEL);
  for (const type of VERIFIED_FACT_TYPES) {
    assert.equal(panel.includes(type) || read('./exception-liability-admin-presentation.ts').includes(type), true);
  }
  assert.equal(panel.includes('PLATFORM'), false);
  assert.equal(panel.includes('inputMode'), false);
  assert.equal(panel.includes('Party user id'), false);
  assert.equal(panel.includes('attributionOptions'), true);
  assert.equal(panel.includes('required'), true);
  assert.equal(panel.includes('Select VERIFIED evidence'), true);
  assert.equal(panel.includes('Edit Fact'), false);
  assert.equal(panel.includes('Delete Fact'), false);
  assert.equal(panel.includes('latest-wins'), true);
  assert.equal(panel.includes('Multiple verified facts may require further review'), true);
  assert.equal(panel.includes('SUBJECT_MATCH_INVESTIGATION_COPY'), true);
});

test('subject match copy never claims facts resolve SUBJECT_MATCH_UNKNOWN', () => {
  for (const relative of CANDIDATE_FILES) {
    const src = read(relative);
    assert.equal(src.includes('to resolve SUBJECT_MATCH_UNKNOWN'), false, relative);
    assert.equal(src.includes('Create a verified fact to resolve'), false, relative);
  }
  assert.equal(
    SUBJECT_MATCH_INVESTIGATION_COPY.includes('do not resolve Stage13B subject matching'),
    true,
  );
});

test('coverage, determination, settlement, and Stage9 firewalls', () => {
  const page = read(PAGE);
  const api = read(API);
  assert.equal(
    page.includes('COVERAGE_INVESTIGATION_COPY') || page.includes('Coverage is not settlement'),
    true,
  );
  assert.equal(page.includes('cannot claim, acknowledge, reject, record cash'), true);
  assert.equal(page.includes('Open Liability Claim'), false);
  assert.equal(page.includes('Import Coverage'), false);
  assert.equal(page.includes('Create Determination'), false);
  assert.equal(page.includes('Resolve Duplicate'), false);
  assert.equal(page.includes('createDetermination'), true);
  assert.equal(page.includes('proposeDetermination'), true);
  assert.equal(page.includes('/finalize'), false);
  assert.equal(page.includes('/adjustments'), false);
  for (const token of FORBIDDEN_POSTS) {
    assert.equal(page.includes(token), false, `page ${token}`);
    assert.equal(api.includes(token), false, `api ${token}`);
  }
  assert.equal(page.includes('addEvidence'), true);
  assert.equal(page.includes('verifyEvidence'), true);
  assert.equal(page.includes('createVerifiedFact'), true);
  assert.equal(page.includes('captureOrderTermsEvidence'), true);
  assert.equal(ADMIN_ONLY_VISIBILITY_COPY.includes('not a staff-secret'), true);
});

test('no client financial arithmetic in 14B-2A candidate', () => {
  for (const relative of CANDIDATE_FILES) {
    const src = read(relative);
    assert.equal(src.includes('parseFloat'), false, relative);
    if (relative.endsWith('exception-liability-admin-presentation.ts')) {
      assert.equal(src.includes('optionalDigitId'), true);
      continue;
    }
    assert.equal(src.includes('parseInt('), false, relative);
    assert.equal(src.includes('Number('), false, relative);
  }
  assert.equal(optionalDigitId('12'), 12);
  assert.equal(optionalDigitId('12.5'), null);
});

test('gesture identity is not payload identity', () => {
  const first = submitGesture(null, 'A');
  assert.equal(first.reused, false);
  const inFlight = submitGesture(first.active, 'A');
  assert.equal(inFlight.reused, true);
  assert.equal(inFlight.active.key, first.active.key);

  const completed = completeGesture(first.active);
  const secondIdentical = submitGesture(completed, 'A');
  assert.equal(secondIdentical.reused, false);
  assert.notEqual(secondIdentical.active.key, first.active.key);

  const afterSuccess = submitGesture(completeGesture(first.active), 'B');
  const backToA = submitGesture(completeGesture(afterSuccess.active), 'A');
  assert.notEqual(backToA.active.key, first.active.key);

  const ambiguous = markGestureAmbiguous(first.active);
  const retryAmbiguous = submitGesture(ambiguous, 'A');
  assert.equal(retryAmbiguous.reused, true);
  assert.equal(retryAmbiguous.active.key, first.active.key);

  const orderOne = submitGesture(null, 'order-terms-capture');
  const orderTwo = submitGesture(completeGesture(orderOne.active), 'order-terms-capture');
  assert.notEqual(orderTwo.active.key, orderOne.active.key);

  const verifyOne = submitGesture(null, 'e1:VERIFIED:');
  const verifyTwo = submitGesture(completeGesture(verifyOne.active), 'e1:VERIFIED:');
  assert.notEqual(verifyTwo.active.key, verifyOne.active.key);

  const factOne = submitGesture(null, 'fact-A');
  const factTwo = submitGesture(completeGesture(factOne.active), 'fact-A');
  assert.notEqual(factTwo.active.key, factOne.active.key);

  const lost = markGestureAmbiguous(first.active);
  assert.equal(
    findRowByIdempotencyKey([{ id: 'e1' }], first.active.key),
    null,
  );
  const proven = findRowByIdempotencyKey(
    [{ id: 'e1', idempotencyKey: first.active.key }],
    first.active.key,
  );
  assert.equal(proven?.id, 'e1');
  const afterLostSuccess = submitGesture(completeGesture(lost), 'A');
  assert.notEqual(afterLostSuccess.active.key, first.active.key);
});

test('lost-success GET proof retires completed key for a later identical gesture', () => {
  const found = findRowByIdempotencyKey(
    [{ id: 'e1', idempotencyKey: 'k1' }],
    'k1',
  );
  assert.equal(found?.id, 'e1');
  assert.equal(findRowByIdempotencyKey([{ id: 'e1' }], 'k1'), null);
  assert.equal(isAmbiguousMutationFailure(null), true);
  assert.equal(isAmbiguousMutationFailure(500), true);
  assert.equal(isAmbiguousMutationFailure(409), false);
  const page = read(PAGE);
  assert.equal(page.includes('reconciling'), true);
  assert.equal(page.includes('findRowByIdempotencyKey'), true);
  assert.equal(page.includes('refreshAfterMutation'), true);
  assert.equal(read(EVIDENCE_PANEL).includes('completeGesture'), true);
  assert.equal(read(VERIFY_PANEL).includes('completeGesture'), true);
  assert.equal(read(FACT_PANEL).includes('completeGesture'), true);
});

function ownerOf(
  claimId: string,
  expected: string | null,
  epoch: number,
) {
  return { claimId, expectedWkOrderId: expected, epoch };
}

function currentAgainst(
  owner: ReturnType<typeof ownerOf>,
  routeClaimId: string,
  routeExpected: string | null,
  routeEpoch: number,
) {
  return isCurrentClaimOwner({
    owner,
    routeClaimId,
    routeExpectedWkOrderId: routeExpected,
    routeEpoch,
  });
}

function abortAgainst(
  owner: ReturnType<typeof ownerOf>,
  routeClaimId: string,
  routeExpected: string | null,
) {
  return mayAbortRouteLoad({
    owner: { claimId: owner.claimId, expectedWkOrderId: owner.expectedWkOrderId },
    route: { claimId: routeClaimId, expectedWkOrderId: routeExpected },
  });
}

function resultAgainst(
  owner: ReturnType<typeof ownerOf>,
  routeClaimId: string,
  routeExpected: string | null,
  routeEpoch: number,
  loadGeneration = 2,
  responseGeneration = 2,
) {
  return ownedResultDecision({
    owner,
    routeClaimId,
    routeExpectedWkOrderId: routeExpected,
    routeEpoch,
    loadGeneration,
    responseGeneration,
  });
}

test('claim ownership discards A after navigation to B', () => {
  const ownerA = ownerOf('claim-a', '10', 1);
  assert.equal(currentAgainst(ownerA, 'claim-b', '10', 2), false);
  assert.equal(abortAgainst(ownerA, 'claim-b', '10'), false);
  assert.equal(resultAgainst(ownerA, 'claim-b', '10', 2, 4, 3), 'ignore');
  assert.equal(resultAgainst(ownerA, 'claim-a', '10', 1), 'apply');
  assert.equal(claimRefreshDecision(2, 1), 'ignore');
  assert.equal(claimRefreshDecision(2, 2), 'apply');
  const page = read(PAGE);
  assert.equal(page.includes('isCurrentClaimOwner'), true);
  assert.equal(page.includes('mayAbortRouteLoad'), true);
  assert.equal(page.includes('ownedResultDecision'), true);
  assert.equal(page.includes('ownerIsCurrent'), true);
  assert.equal(page.includes('loadAbortRef'), true);
  assert.equal(page.includes('routeEpochRef'), true);
  assert.equal(page.includes("return 'discarded'"), true);
});

test('same claimId different expectedWkOrderId is a distinct route context before epoch change', () => {
  assert.equal(normalizeExpectedWkOrderId(undefined), null);
  assert.equal(normalizeExpectedWkOrderId(null), null);
  assert.equal(normalizeExpectedWkOrderId(''), null);
  assert.equal(normalizeExpectedWkOrderId('  '), null);
  assert.equal(normalizeExpectedWkOrderId('10'), '10');

  const ownerAX = ownerOf('claim-a', '10', 1);
  const sameEpoch = 1;
  assert.equal(currentAgainst(ownerAX, 'claim-a', '99', sameEpoch), false);
  assert.equal(currentAgainst(ownerAX, 'claim-a', null, sameEpoch), false);
  assert.equal(currentAgainst(ownerOf('claim-a', null, 1), 'claim-a', '99', 1), false);
  assert.equal(currentAgainst(ownerAX, 'claim-a', '10', sameEpoch), true);
  assert.equal(currentAgainst(ownerAX, 'claim-b', '10', sameEpoch), false);

  assert.equal(abortAgainst(ownerAX, 'claim-a', '99'), false);
  assert.equal(abortAgainst(ownerAX, 'claim-a', null), false);
  assert.equal(abortAgainst(ownerOf('claim-a', null, 1), 'claim-a', '99'), false);
  assert.equal(abortAgainst(ownerAX, 'claim-a', '10'), true);
  assert.equal(abortAgainst(ownerAX, 'claim-b', '10'), false);

  assert.equal(resultAgainst(ownerAX, 'claim-a', '99', sameEpoch), 'ignore');
  assert.equal(resultAgainst(ownerAX, 'claim-a', null, sameEpoch), 'ignore');
  assert.equal(resultAgainst(ownerOf('claim-a', null, 1), 'claim-a', '99', 1), 'ignore');
  assert.equal(resultAgainst(ownerAX, 'claim-a', '10', sameEpoch), 'apply');
  assert.equal(resultAgainst(ownerAX, 'claim-b', '10', sameEpoch), 'ignore');

  assert.equal(
    claimWorkspacePanelKey('claim-a', '10', 'evidence'),
    claimWorkspacePanelKey('claim-a', '10', 'evidence'),
  );
  assert.notEqual(
    claimWorkspacePanelKey('claim-a', '10', 'evidence'),
    claimWorkspacePanelKey('claim-a', '99', 'evidence'),
  );
  assert.notEqual(
    claimWorkspacePanelKey('claim-a', '10', 'evidence'),
    claimWorkspacePanelKey('claim-a', null, 'evidence'),
  );
  assert.equal(
    claimWorkspacePanelKey('claim-a', '', 'facts'),
    claimWorkspacePanelKey('claim-a', null, 'facts'),
  );

  const page = read(PAGE);
  assert.equal(page.includes('routeExpectedWkOrderIdRef.current = normalizedExpectedWkOrderId'), true);
  assert.equal(page.includes('claimWorkspacePanelKey'), true);
  assert.equal(page.includes('normalizeExpectedWkOrderId'), true);
  assert.match(page, /routeClaimIdRef\.current = id[\s\S]*routeExpectedWkOrderIdRef\.current = normalizedExpectedWkOrderId/);
  assert.equal(page.includes('if (!ownerIsCurrent(loadOwner)) return'), true);
});

test('authoritative attribution is bounded and fail-closed', () => {
  const empty = collectAuthoritativeFactAttributionOptions({
    evidence: [],
    obligations: [
      {
        debtorType: 'CUSTOMER',
        debtorUserId: 'foreign-customer',
        creditorType: 'MERCHANT',
        creditorMerchantId: 9,
      },
    ],
  });
  assert.equal(empty.some((row) => row.partyUserId === 'foreign-customer'), false);
  assert.equal(empty.some((row) => row.partyType === 'CUSTOMER'), false);
  assert.equal(empty.some((row) => row.partyType === 'MERCHANT' && row.partyMerchantId === 9), true);

  const snapshot = collectAuthoritativeFactAttributionOptions({
    evidence: [
      {
        evidenceKind: 'ORDER_TERMS_SNAPSHOT',
        metadata: { merchantId: 44 },
      },
    ],
    obligations: [],
  });
  assert.deepEqual(
    snapshot.map((row) => row.optionKey),
    ['MERCHANT:44'],
  );
  assert.equal(attributionFromOptionKey('MERCHANT:44', snapshot)?.partyMerchantId, 44);

  const customer = collectAuthoritativeFactAttributionOptions({
    obligations: [
      {
        creditorType: 'CUSTOMER',
        creditorUserId: 'cust-1',
      },
    ],
  });
  assert.equal(customer.some((row) => row.optionKey === 'CUSTOMER:cust-1'), true);
  assert.equal(customer.some((row) => row.partyUserId === 'foreign-uuid'), false);

  const ambiguousRiders = collectAuthoritativeFactAttributionOptions({
    obligations: [
      { creditorType: 'RIDER', creditorUserId: 'rider-a' },
      { creditorType: 'RIDER', creditorUserId: 'rider-b' },
    ],
  });
  assert.equal(ambiguousRiders.some((row) => row.partyType === 'RIDER'), false);

  const uniqueRider = collectAuthoritativeFactAttributionOptions({
    obligations: [{ creditorType: 'RIDER', creditorUserId: 'rider-a' }],
  });
  assert.equal(uniqueRider.some((row) => row.optionKey === 'RIDER:rider-a'), true);
  assert.equal(collectAuthoritativeFactAttributionOptions({}).length, 0);
  assert.equal(
    collectAuthoritativeFactAttributionOptions({
      obligations: [{ debtorType: 'RIDER', debtorUserId: 'foreign-rider' }],
      determinations: [
        {
          allocations: [{ partyType: 'CUSTOMER', partyUserId: 'foreign-customer' }],
        },
      ],
    }).length,
    0,
  );
  assert.equal(factTypeForbidsAttribution('GOODS_NON_CONFORMANCE_CONFIRMED'), false);

  const panel = read(FACT_PANEL);
  assert.equal(panel.includes('collectAuthoritativeFactAttributionOptions'), false);
  assert.equal(panel.includes('attributionOptions'), true);
  assert.equal(panel.includes('Party user id'), false);
  assert.equal(panel.includes('inputMode="numeric"'), false);
  assert.equal(panel.includes('PLATFORM'), false);
  assert.equal(read(PAGE).includes('collectAuthoritativeFactAttributionOptions'), true);
});

test('Stage14B-1 frozen read-only string assertion is historical, not 2A product copy', () => {
  const frozen = read('./authoritative-domain-presentation.test.ts');
  assert.equal(frozen.includes("'Add evidence'"), true);
  assert.equal(frozen.includes("'Verify evidence'"), true);
  assert.equal(frozen.includes("'Create fact'"), true);
  const page = read(PAGE);
  assert.equal(page.includes('Add evidence'), false);
  assert.equal(page.includes('Verify evidence'), false);
  assert.equal(page.includes('Create fact'), false);
  assert.equal(read(EVIDENCE_PANEL).includes('Record evidence'), true);
  assert.equal(read(VERIFY_PANEL).includes('Record Verification'), true);
  assert.equal(read(FACT_PANEL).includes('Conclude verified fact'), true);
});

test('role gate remains System Admin only on the claim workspace', () => {
  const page = read(PAGE);
  assert.equal(page.includes('isFinancialReconciliationAdmin'), true);
  assert.equal(page.includes('Access denied. System admin only.'), true);
  assert.equal(page.includes("userType === 'staff'"), false);
});

test('create draft happy path contract and eligibility', () => {
  const claim = {
    evidence: [{ evidenceKind: 'ORDER_TERMS_SNAPSHOT', metadata: { merchantId: 44 } }],
    obligations: [],
    verifiedFacts: [{ id: 'f1', factType: 'GOODS_LOST_CONFIRMED' }],
    determinations: [],
    status: 'OPEN',
  };
  const debtors = collectAuthoritativeDebtorOptions(claim);
  assert.equal(debtors.some((row) => row.optionKey === 'MERCHANT:44'), true);
  assert.equal(
    canCreateLiabilityDraft({
      claimStatus: 'OPEN',
      facts: claim.verifiedFacts,
      determinations: [],
      debtorOptions: debtors,
    }),
    true,
  );
  const api = read(API);
  assert.equal(api.includes("partyType: row.partyType"), true);
  assert.equal(api.includes('economicLossId'), false);
  assert.equal(api.includes('totalLiabilityAmount'), false);
  assert.equal(api.includes('policyVersionId'), false);
  const panel = read(DET_PANEL);
  assert.equal(panel.includes('Create Draft'), true);
  assert.equal(panel.includes('creditor'), false);
  assert.equal(read(PAGE).includes('preflight'), true);
  assert.equal(read(PAGE).includes('isCreateDeterminationProven'), true);
  assert.equal(read(PAGE).includes('requireAuthoritativeProof: true'), true);
});

test('no debtor identity disables create and has no free-text party fields', () => {
  const debtors = collectAuthoritativeDebtorOptions({ evidence: [], obligations: [] });
  assert.equal(debtors.length, 0);
  assert.equal(
    canCreateLiabilityDraft({
      claimStatus: 'OPEN',
      facts: [{ id: 'f1' }],
      determinations: [],
      debtorOptions: debtors,
    }),
    false,
  );
  const panel = read(DET_PANEL);
  assert.equal(panel.includes('No authoritative debtor identity'), true);
  assert.equal(panel.includes('Party user id'), false);
  assert.equal(panel.includes('inputMode="numeric"'), false);
  assert.equal(panel.includes('PLATFORM'), false);
});

test('debtor options are bounded and ignore fact attribution', () => {
  const fromFacts = collectAuthoritativeDebtorOptions({
    verifiedFacts: [
      {
        attributedPartyType: 'CUSTOMER',
        attributedPartyUserId: 'foreign-customer',
        attributedMerchantId: 99,
      },
    ],
    evidence: [],
    obligations: [],
  });
  assert.equal(fromFacts.length, 0);
  const snapshot = collectAuthoritativeDebtorOptions({
    evidence: [{ evidenceKind: 'ORDER_TERMS_SNAPSHOT', metadata: { merchantId: 44 } }],
    obligations: [],
  });
  assert.deepEqual(snapshot.map((row) => row.optionKey), ['MERCHANT:44']);
  const conflict = collectAuthoritativeDebtorOptions({
    evidence: [
      { evidenceKind: 'ORDER_TERMS_SNAPSHOT', metadata: { merchantId: 44 } },
      { evidenceKind: 'ORDER_TERMS_SNAPSHOT', metadata: { merchantId: 12 } },
    ],
    obligations: [],
  });
  assert.equal(conflict.some((row) => row.partyType === 'MERCHANT'), false);
  const panel = read(DET_PANEL);
  assert.equal(panel.includes('attributionFromOptionKey'), true);
  assert.equal(panel.includes('foreign-customer'), false);
});

test('positive money strings are lexical and not float math', () => {
  assert.equal(isPositiveMoneyString('1'), true);
  assert.equal(isPositiveMoneyString('1.00'), true);
  assert.equal(isPositiveMoneyString('1000.50'), true);
  assert.equal(isPositiveMoneyString('0'), false);
  assert.equal(isPositiveMoneyString('0.00'), false);
  assert.equal(isPositiveMoneyString('-1'), false);
  assert.equal(isPositiveMoneyString('1.000'), false);
  assert.equal(isPositiveMoneyString('1e2'), false);
  assert.equal(isPositiveMoneyString('NaN'), false);
  assert.equal(isPositiveMoneyString('Infinity'), false);
  assert.equal(isPositiveMoneyString('abc'), false);
  const panel = read(DET_PANEL);
  assert.equal(panel.includes('parseFloat'), false);
  assert.equal(panel.includes('toFixed'), false);
  assert.equal(panel.includes('isPositiveMoneyString'), true);
});

test('create determination gesture and lost-success use createIdempotencyKey', () => {
  const first = submitGesture(null, 'draft-A');
  assert.equal(submitGesture(first.active, 'draft-A').reused, true);
  const ambiguous = markGestureAmbiguous(first.active);
  assert.equal(submitGesture(ambiguous, 'draft-A').active.key, first.active.key);
  const found = findDeterminationByCreateKey(
    [{ id: 'd1', createIdempotencyKey: first.active.key, status: 'DRAFT' }],
    first.active.key,
  );
  assert.equal(found?.id, 'd1');
  assert.equal(
    findDeterminationByCreateKey([{ id: 'd2', createIdempotencyKey: 'other' }], first.active.key),
    null,
  );
  const later = submitGesture(completeGesture(first.active), 'draft-A');
  assert.notEqual(later.active.key, first.active.key);
});

test('create 409 is success only when active row key matches', () => {
  const matching = findDeterminationByCreateKey(
    [{ id: 'd1', status: 'DRAFT', createIdempotencyKey: 'k1' }],
    'k1',
  );
  assert.equal(matching?.id, 'd1');
  const conflict = findDeterminationByCreateKey(
    [{ id: 'd2', status: 'DRAFT', createIdempotencyKey: 'k-other' }],
    'k1',
  );
  assert.equal(conflict, null);
});

test('propose eligibility, successor firewall, and lost-success', () => {
  const draft = {
    id: 'det-1',
    status: 'DRAFT',
    exceptionClaimId: 'claim-a',
    adjustmentOfDeterminationId: null,
  };
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: draft,
    }),
    true,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, status: 'PROPOSED' },
    }),
    false,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, status: 'FINALIZED' },
    }),
    false,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, status: 'CANCELLED' },
    }),
    false,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, status: 'SUPERSEDED' },
    }),
    false,
  );
  assert.equal(
    isSuccessorDetermination({ adjustmentOfDeterminationId: 'parent' }),
    true,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, adjustmentOfDeterminationId: 'parent' },
    }),
    false,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'VERIFIED',
      determination: { ...draft, exceptionClaimId: 'claim-b' },
    }),
    false,
  );
  assert.equal(
    canSubmitEligibleLiabilityDraft({
      claimId: 'claim-a',
      claimStatus: 'FINALIZED',
      determination: draft,
    }),
    false,
  );
  const first = submitGesture(null, 'det-1');
  assert.equal(submitGesture(first.active, 'det-1').reused, true);
  const later = submitGesture(completeGesture(first.active), 'det-1');
  assert.notEqual(later.active.key, first.active.key);
  const panel = read(DET_PANEL);
  assert.equal(panel.includes('Confirm proposal'), true);
  assert.equal(panel.includes('DETERMINATION_PROPOSE_CONFIRM_COPY'), true);
  assert.equal(panel.includes('creates payment'), false);
  assert.equal(panel.includes('Edit Draft'), false);
  assert.equal(panel.includes('Delete Draft'), false);
  assert.equal(panel.includes('Replace Draft'), false);
  assert.equal(panel.includes('Cancel Draft'), false);
});

test('non-conformance grounding facts omit conformance and unsupported', () => {
  const facts = [
    { id: 'a', factType: 'GOODS_NON_CONFORMANCE_CONFIRMED' },
    { id: 'b', factType: 'GOODS_CONFORMANCE_CONFIRMED' },
    { id: 'c', factType: 'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED' },
    { id: 'd', factType: 'CUSTODY_LAST_HOLDER_CONFIRMED' },
  ];
  const merchant = allocationGroundingFacts({
    claimType: 'GOODS_NON_CONFORMANCE',
    partyType: 'MERCHANT',
    facts,
  });
  assert.deepEqual(merchant.map((row) => row.id), ['a']);
  const rider = allocationGroundingFacts({
    claimType: 'GOODS_NON_CONFORMANCE',
    partyType: 'RIDER',
    facts,
  });
  assert.deepEqual(rider.map((row) => row.id), ['d']);
});

test('determination panel remounts on expected-order context and reuses ownership', () => {
  assert.notEqual(
    claimWorkspacePanelKey('claim-a', '10', 'determination'),
    claimWorkspacePanelKey('claim-a', '99', 'determination'),
  );
  assert.equal(
    claimWorkspacePanelKey('claim-a', '10', 'determination'),
    claimWorkspacePanelKey('claim-a', '10', 'determination'),
  );
  const ownerAX = {
    claimId: 'claim-a',
    expectedWkOrderId: '10',
    epoch: 1,
  };
  assert.equal(
    isCurrentClaimOwner({
      owner: ownerAX,
      routeClaimId: 'claim-a',
      routeExpectedWkOrderId: '99',
      routeEpoch: 1,
    }),
    false,
  );
  assert.equal(
    mayAbortRouteLoad({
      owner: { claimId: 'claim-a', expectedWkOrderId: '10' },
      route: { claimId: 'claim-a', expectedWkOrderId: '99' },
    }),
    false,
  );
  assert.equal(
    isCurrentClaimOwner({
      owner: ownerAX,
      routeClaimId: 'claim-b',
      routeExpectedWkOrderId: '10',
      routeEpoch: 1,
    }),
    false,
  );
  const page = read(PAGE);
  assert.equal(page.includes("claimWorkspacePanelKey(id, expectedWkOrderId, 'determination')"), true);
  assert.equal(page.includes('preflight'), true);
});

test('2B finalize and adjustment firewalls', () => {
  for (const relative of [API, PAGE, DET_PANEL]) {
    const src = read(relative);
    assert.equal(src.includes('/finalize'), false, relative);
    assert.equal(src.includes('/adjustments'), false, relative);
    assert.equal(src.includes('Finalize'), false, relative);
    assert.equal(src.includes('Create Adjustment'), false, relative);
  }
});

test('create 2xx is proven only by matching createIdempotencyKey', () => {
  const gesture = submitGesture(null, 'draft-K1');
  const k1 = gesture.active.key;
  const proven = isCreateDeterminationProven({
    claimId: 'claim-a',
    determinations: [
      {
        id: 'd1',
        exceptionClaimId: 'claim-a',
        status: 'DRAFT',
        createIdempotencyKey: k1,
      },
    ],
    createIdempotencyKey: k1,
  });
  assert.equal(proven, true);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'success',
  );
  const retired = completeGesture(gesture.active);
  const later = submitGesture(retired, 'draft-K1');
  assert.notEqual(later.active.key, k1);
});

test('create 2xx without matching key is unproven and retains K1', () => {
  const gesture = submitGesture(null, 'draft-K1');
  const k1 = gesture.active.key;
  const proven = isCreateDeterminationProven({
    claimId: 'claim-a',
    determinations: [],
    createIdempotencyKey: k1,
  });
  assert.equal(proven, false);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'unproven',
  );
  const ambiguous = markGestureAmbiguous(gesture.active);
  const retry = submitGesture(ambiguous, 'draft-K1');
  assert.equal(retry.reused, true);
  assert.equal(retry.active.key, k1);
});

test('create 2xx unrelated DRAFT does not prove K1', () => {
  const gesture = submitGesture(null, 'draft-K1');
  const k1 = gesture.active.key;
  const proven = isCreateDeterminationProven({
    claimId: 'claim-a',
    determinations: [
      {
        id: 'd-other',
        exceptionClaimId: 'claim-a',
        status: 'DRAFT',
        createIdempotencyKey: 'K_OTHER',
      },
    ],
    createIdempotencyKey: k1,
  });
  assert.equal(proven, false);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'unproven',
  );
  const retry = submitGesture(markGestureAmbiguous(gesture.active), 'draft-K1');
  assert.equal(retry.active.key, k1);
});

test('propose 2xx is proven only by exact target PROPOSED on current claim', () => {
  const gesture = submitGesture(null, 'det-1');
  const k1 = gesture.active.key;
  const proven = isEligibleDraftReviewProven({
    claimId: 'claim-a',
    determinationId: 'det-1',
    determinations: [
      {
        id: 'det-1',
        exceptionClaimId: 'claim-a',
        status: 'PROPOSED',
        proposeIdempotencyKey: k1,
      },
    ],
    proposeIdempotencyKey: k1,
  });
  assert.equal(proven, true);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'success',
  );
  const later = submitGesture(completeGesture(gesture.active), 'det-1');
  assert.notEqual(later.active.key, k1);
});

test('propose 2xx still DRAFT is unproven and retains K1', () => {
  const gesture = submitGesture(null, 'det-1');
  const k1 = gesture.active.key;
  const proven = isEligibleDraftReviewProven({
    claimId: 'claim-a',
    determinationId: 'det-1',
    determinations: [
      {
        id: 'det-1',
        exceptionClaimId: 'claim-a',
        status: 'DRAFT',
      },
    ],
    proposeIdempotencyKey: k1,
  });
  assert.equal(proven, false);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'unproven',
  );
  const retry = submitGesture(markGestureAmbiguous(gesture.active), 'det-1');
  assert.equal(retry.reused, true);
  assert.equal(retry.active.key, k1);
});

test('propose 2xx wrong target cannot prove D1', () => {
  const proven = isEligibleDraftReviewProven({
    claimId: 'claim-a',
    determinationId: 'det-1',
    determinations: [
      { id: 'det-1', exceptionClaimId: 'claim-a', status: 'DRAFT' },
      { id: 'det-2', exceptionClaimId: 'claim-a', status: 'PROPOSED' },
    ],
    proposeIdempotencyKey: 'k1',
  });
  assert.equal(proven, false);
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: proven,
    }),
    'unproven',
  );
});

test('2xx proof is discarded when A/X becomes A/Y before apply', () => {
  const ownerAX = ownerOf('claim-a', '10', 1);
  assert.equal(currentAgainst(ownerAX, 'claim-a', '99', 1), false);
  assert.equal(
    resultAgainst(ownerAX, 'claim-a', '99', 1),
    'ignore',
  );
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: true,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: true,
    }),
    'discarded',
  );
  assert.equal(abortAgainst(ownerAX, 'claim-a', '99'), false);
});

test('2A runMutation 2xx still succeeds without determination-style proof', () => {
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: false,
      confirmed: false,
    }),
    'success',
  );
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: false,
    }),
    'unproven',
  );
  const page = read(PAGE);
  const twoASlice = page.slice(
    page.indexOf('onRecordEvidence'),
    page.indexOf('onCreateDraft'),
  );
  assert.equal(twoASlice.includes('requireAuthoritativeProof'), false);
  assert.equal(twoASlice.includes('addEvidence'), true);
  assert.equal(twoASlice.includes('captureOrderTermsEvidence'), true);
  assert.equal(twoASlice.includes('verifyEvidence'), true);
  assert.equal(twoASlice.includes('createVerifiedFact'), true);
  assert.equal(twoASlice.includes('findRowByIdempotencyKey'), true);
  const twoBSlice = page.slice(page.indexOf('onCreateDraft'));
  assert.equal(twoBSlice.includes('requireAuthoritativeProof: true'), true);
  assert.equal(twoBSlice.includes('isCreateDeterminationProven'), true);
  assert.equal(twoBSlice.includes('isEligibleDraftReviewProven'), true);
});

test('409 recovery still requires operation-specific confirm', () => {
  assert.equal(
    decidePostMutationRefreshOutcome({
      discarded: false,
      hasLatest: true,
      requireAuthoritativeProof: true,
      confirmed: true,
    }),
    'success',
  );
  assert.equal(
    isCreateDeterminationProven({
      claimId: 'claim-a',
      determinations: [
        { id: 'd1', exceptionClaimId: 'claim-a', createIdempotencyKey: 'k1' },
      ],
      createIdempotencyKey: 'k1',
    }),
    true,
  );
  assert.equal(
    isEligibleDraftReviewProven({
      claimId: 'claim-a',
      determinationId: 'det-1',
      determinations: [
        { id: 'det-1', exceptionClaimId: 'claim-a', status: 'PROPOSED' },
      ],
    }),
    true,
  );
});
