import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_ONLY_VISIBILITY_COPY,
  CLAIM_EVIDENCE_KINDS,
  CLAIM_VERIFICATION_STATUSES,
  DEFAULT_EVIDENCE_VISIBILITY,
  MANUAL_EVIDENCE_KINDS,
  SUBJECT_MATCH_INVESTIGATION_COPY,
  VERIFIED_FACT_TYPES,
  attributionFromOptionKey,
  claimRefreshDecision,
  claimWorkspacePanelKey,
  collectAuthoritativeFactAttributionOptions,
  completeGesture,
  evidenceHasVerifiedConclusion,
  factTypeForbidsAttribution,
  findRowByIdempotencyKey,
  isActiveClaimStatus,
  isAmbiguousMutationFailure,
  isCurrentClaimOwner,
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
const CANDIDATE_FILES = [
  API,
  './exception-liability-admin-presentation.ts',
  PAGE,
  EVIDENCE_PANEL,
  VERIFY_PANEL,
  FACT_PANEL,
  '../app/admin/exception-claims/[id]/claim-event-timeline.tsx',
];

const FORBIDDEN_POSTS = [
  '/determinations',
  '/propose',
  '/finalize',
  '/adjustments',
  '/settlements/claim',
  '/settlements/cash',
  '/acknowledge',
  'ensureSeededPolicy',
  'type="file"',
  'input type="file"',
];

test('API helpers expose only evidentiary POST paths', () => {
  const src = read(API);
  assert.equal(src.includes('export async function addEvidence'), true);
  assert.equal(src.includes('export async function captureOrderTermsEvidence'), true);
  assert.equal(src.includes('export async function verifyEvidence'), true);
  assert.equal(src.includes('export async function createVerifiedFact'), true);
  assert.equal(src.includes("method: 'POST'"), true);
  assert.equal(src.includes('/exception-claims/${claimId}/evidence'), true);
  assert.equal(src.includes('/exception-claims/${claimId}/order-terms-evidence'), true);
  assert.equal(
    src.includes('/exception-claims/${claimId}/evidence/${evidenceId}/verify'),
    true,
  );
  assert.equal(src.includes('/exception-claims/${claimId}/verified-facts'), true);
  assert.equal(src.includes('Authorization'), true);
  assert.equal(src.includes('idempotencyKey'), true);
  assert.equal(src.includes('correlationId'), true);
  assert.equal(src.includes('mapLiabilityAdminError'), true);
  for (const token of FORBIDDEN_POSTS) {
    assert.equal(src.includes(token), false, token);
  }
  assert.equal(src.includes('export async function createDetermination'), false);
  assert.equal(src.includes('finalizeDetermination'), false);
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
  assert.equal(page.includes('does not create, propose, finalize, or adjust determinations'), true);
  assert.equal(page.includes('cannot claim, acknowledge, reject, record cash'), true);
  assert.equal(page.includes('Open Liability Claim'), false);
  assert.equal(page.includes('Import Coverage'), false);
  assert.equal(page.includes('Create Determination'), false);
  assert.equal(page.includes('Resolve Duplicate'), false);
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
