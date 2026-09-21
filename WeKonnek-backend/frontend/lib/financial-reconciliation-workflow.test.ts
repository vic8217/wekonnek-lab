import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECONCILIATION_FINDING_CODES,
  applyDetailFailure,
  applyDetailSuccess,
  beginDetailGeneration,
  isCurrentGeneration,
} from './financial-reconciliation-presentation.ts';
import type {
  FinancialObligationDto,
  FinancialReconciliationDetailDto,
} from './financial-reconciliation-api.ts';
import {
  ENGINEERING_ONLY_CODES,
  resolveAuthoritativeWorkflow,
  resolveExceptionClaimLinkage,
  type ReviewWorkflowInput,
} from './financial-reconciliation-workflow.ts';

function baseReview(
  code: string,
  extra: Partial<ReviewWorkflowInput> = {},
): ReviewWorkflowInput {
  return {
    findingKey: `key:${code}`,
    findingCode: code,
    wkOrderId: 10,
    needsRefresh: false,
    stale: false,
    findingActive: true,
    ...extra,
  };
}

function liveFor(
  code: string,
  involvedItems: Array<{ rail: string; obligationId: string }> = [],
  items: FinancialObligationDto[] = [],
): FinancialReconciliationDetailDto {
  return {
    wkOrderId: 10,
    items,
    findings: [
      {
        findingKey: `key:${code}`,
        code,
        reconciliationState: 'REVIEW_REQUIRED',
        checkOutcome: 'FAILED',
        involvedItems,
        explanationCode: code,
      },
    ],
    relatedItems: [],
    hasOutstanding: false,
    hasDispute: false,
    hasReconciliationIssue: true,
  };
}

const exceptionItem: FinancialObligationDto = {
  rail: 'EXCEPTION_FINANCIAL',
  obligationId: 'ex-obl-1',
  wkOrderId: 10,
  debtor: { type: 'MERCHANT', userId: null, merchantId: 1 },
  creditor: { type: 'RIDER', userId: 'r1', merchantId: null },
  originalPrincipal: '100.00',
  settledAmount: '0.00',
  remainingAmount: '100.00',
  currency: 'PHP',
  financialState: 'UNPAID',
  flags: {},
  reconciliationState: 'REVIEW_REQUIRED',
  relatedItems: [],
  createdAt: '2026-09-19T00:00:00.000Z',
  economicLossId: 'loss-1',
  determinationId: 'det-1',
};

test('unknown finding code fails closed', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('NOT_A_REAL_FINDING'),
    liveReconciliation: liveFor('NOT_A_REAL_FINDING'),
  });
  assert.equal(view.kind, 'UNSUPPORTED');
  assert.equal(view.destination, null);
  assert.equal(view.blocked, true);
  assert.match(view.safeAction, /Engineering review required/);
});

test('order mismatch fails closed', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('CURRENCY_MISMATCH'),
    liveReconciliation: { ...liveFor('CURRENCY_MISMATCH'), wkOrderId: 99 },
  });
  assert.equal(view.destination, null);
  assert.equal(view.blocked, true);
});

test('needsRefresh and stale block destinations', () => {
  const refresh = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING', { needsRefresh: true }),
    liveReconciliation: liveFor('STAGE9_COVERAGE_MISSING'),
  });
  assert.equal(refresh.kind, 'STALE');
  assert.equal(refresh.destination, null);
  assert.match(refresh.blockedReason ?? '', /Refresh this review/);

  const stale = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING', { stale: true }),
    liveReconciliation: liveFor('STAGE9_COVERAGE_MISSING'),
  });
  assert.equal(stale.kind, 'STALE');
  assert.equal(stale.destination, null);
});

test('absent live finding is inactive and does not route', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING'),
    liveReconciliation: {
      ...liveFor('STAGE9_COVERAGE_MISSING'),
      findings: [],
    },
  });
  assert.equal(view.kind, 'INACTIVE');
  assert.equal(view.destination, null);
  assert.match(view.blockedReason ?? '', /no longer active/);
});

test('engineering-only codes have no destination', () => {
  for (const code of ENGINEERING_ONLY_CODES) {
    const view = resolveAuthoritativeWorkflow({
      review: baseReview(code),
      liveReconciliation: liveFor(code),
    });
    assert.equal(view.kind, 'ENGINEERING', code);
    assert.equal(view.requiredActor, 'Engineering', code);
    assert.equal(view.destination, null, code);
    assert.equal(view.blocked, true, code);
    assert.match(view.safeAction, /No financial product action/, code);
  }
});

test('all 21 finding codes have explicit routing', () => {
  assert.equal(RECONCILIATION_FINDING_CODES.length, 21);
  for (const code of RECONCILIATION_FINDING_CODES) {
    const view = resolveAuthoritativeWorkflow({
      review: baseReview(code),
      liveReconciliation: liveFor(code, [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'ex-obl-1' }], [
        exceptionItem,
      ]),
      domainContext: {
        stage9ReturnFinancialStatus: 'PROPOSED',
        claims: [
          {
            id: 'claim-1',
            wkOrderId: 10,
            economicLossId: 'loss-1',
            determinations: [{ id: 'det-1' }],
            obligations: [{ id: 'ex-obl-1' }],
          },
        ],
      },
    });
    assert.ok(view.kind, code);
    assert.equal(view.destinationHref == null || view.destinationHref.startsWith('/admin/'), true, code);
    assert.equal(view.destinationHref?.includes('acknowledge') ?? false, false, code);
    assert.equal(view.destinationHref?.includes('cash-receipts') ?? false, false, code);
    assert.equal(view.destinationHref?.includes('finalize') ?? false, false, code);
    assert.equal(view.destinationHref?.includes('adjustments') ?? false, false, code);
  }
});

test('RA_RETURN_RESTRICTION_MISSING FINALIZED is engineering', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('RA_RETURN_RESTRICTION_MISSING'),
    liveReconciliation: liveFor('RA_RETURN_RESTRICTION_MISSING'),
    domainContext: { stage9ReturnFinancialStatus: 'FINALIZED' },
  });
  assert.equal(view.kind, 'ENGINEERING');
  assert.equal(view.destination, null);
  assert.match(view.notes.join(' '), /not waiting on rider/i);
});

test('RA_RETURN_RESTRICTION_MISSING pre-finalized inspects Stage9', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('RA_RETURN_RESTRICTION_MISSING'),
    liveReconciliation: liveFor('RA_RETURN_RESTRICTION_MISSING'),
    domainContext: { stage9ReturnFinancialStatus: 'PROPOSED' },
  });
  assert.equal(view.kind, 'STAGE9_RETURN_FINANCIAL');
  assert.equal(view.destination?.type, 'stage9_return_financial');
  assert.equal(view.destinationHref, '/admin/wk-orders/10/return-financial');
  assert.equal(view.requiredActor.includes('Rider'), false);
});

test('RA_RETURN_DOUBLE_COLLECTIBLE waits on merchant then rider via Stage9', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('RA_RETURN_DOUBLE_COLLECTIBLE'),
    liveReconciliation: liveFor('RA_RETURN_DOUBLE_COLLECTIBLE'),
  });
  assert.equal(view.kind, 'WAITING_ON_PARTY');
  assert.equal(view.requiredActor, 'Merchant → Rider');
  assert.equal(view.destination?.type, 'stage9_return_financial');
  assert.equal(view.destinationHref?.includes('rider-advance-reimbursement'), false);
  assert.match(view.notes.join(' '), /Do not recommend customer/);
  assert.match(view.notes.join(' '), /No admin ACK/);
});

test('Stage12 linkage none/one/many', () => {
  const finding = liveFor('STAGE9_COVERAGE_MISSING', [
    { rail: 'EXCEPTION_FINANCIAL', obligationId: 'ex-obl-1' },
  ], [exceptionItem]).findings[0];

  const none = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding,
    items: [exceptionItem],
    claims: [],
  });
  assert.equal(none.status, 'conflict');

  const one = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding,
    items: [exceptionItem],
    claims: [
      {
        id: 'claim-1',
        wkOrderId: 10,
        economicLossId: 'loss-1',
        determinations: [{ id: 'det-1' }],
        obligations: [{ id: 'ex-obl-1' }],
      },
    ],
  });
  assert.equal(one.status, 'one');
  if (one.status === 'one') assert.equal(one.claimId, 'claim-1');

  const many = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding,
    items: [exceptionItem],
    claims: [
      { id: 'claim-1', wkOrderId: 10, economicLossId: 'loss-1' },
      { id: 'claim-2', wkOrderId: 10, determinations: [{ id: 'det-1' }] },
    ],
  });
  assert.equal(many.status, 'conflict');

  const otherOrder = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding,
    items: [exceptionItem],
    claims: [{ id: 'claim-x', wkOrderId: 99, economicLossId: 'loss-1' }],
  });
  assert.equal(otherOrder.status, 'conflict');
});

test('STAGE9_COVERAGE_MISSING routes unique claim and blocks ambiguity', () => {
  const involved = [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'ex-obl-1' }];
  const one = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING'),
    liveReconciliation: liveFor('STAGE9_COVERAGE_MISSING', involved, [exceptionItem]),
    domainContext: {
      claims: [
        {
          id: 'claim-1',
          wkOrderId: 10,
          economicLossId: 'loss-1',
          determinations: [{ id: 'det-1' }],
          obligations: [{ id: 'ex-obl-1' }],
        },
      ],
    },
  });
  assert.equal(one.kind, 'STAGE12_CLAIM');
  assert.equal(one.destination?.type, 'stage12_claim');
  if (one.destination?.type === 'stage12_claim') {
    assert.equal(one.destination.claimId, 'claim-1');
  }
  assert.match(one.destinationHref ?? '', /expectedWkOrderId=10/);

  const zero = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING'),
    liveReconciliation: liveFor('STAGE9_COVERAGE_MISSING', involved, [exceptionItem]),
    domainContext: { claims: [] },
  });
  assert.equal(zero.blocked, true);
  assert.match(zero.blockedReason ?? '', /conflicting/);

  const many = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING'),
    liveReconciliation: liveFor('STAGE9_COVERAGE_MISSING', involved, [exceptionItem]),
    domainContext: {
      claims: [
        { id: 'claim-1', wkOrderId: 10, economicLossId: 'loss-1' },
        { id: 'claim-2', wkOrderId: 10, determinations: [{ id: 'det-1' }] },
      ],
    },
  });
  assert.equal(many.blocked, true);
  assert.match(many.blockedReason ?? '', /conflicting/);
});

test('SUBJECT_MATCH_UNKNOWN without claim remains review-only', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('SUBJECT_MATCH_UNKNOWN'),
    liveReconciliation: liveFor('SUBJECT_MATCH_UNKNOWN'),
    domainContext: { claims: [] },
  });
  assert.equal(view.kind, 'REVIEW_ONLY');
  assert.equal(view.destination, null);
});

test('SUCCESSOR_REVIEW_REQUIRED allows Stage12 read when linked', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('SUCCESSOR_REVIEW_REQUIRED'),
    liveReconciliation: liveFor(
      'SUCCESSOR_REVIEW_REQUIRED',
      [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'ex-obl-1' }],
      [exceptionItem],
    ),
    domainContext: {
      claims: [
        {
          id: 'claim-1',
          wkOrderId: 10,
          economicLossId: 'loss-1',
          determinations: [{ id: 'det-1' }],
          obligations: [{ id: 'ex-obl-1' }],
        },
      ],
    },
  });
  assert.equal(view.kind, 'REVIEW_ONLY');
  assert.equal(view.destination?.type, 'stage12_claim');
  assert.match(view.safeAction, /Review-only close remains available/);
});

test('SUCCESSOR_BRANCH and CYCLE are engineering only', () => {
  for (const code of ['SUCCESSOR_BRANCH_DETECTED', 'SUCCESSOR_CYCLE_DETECTED']) {
    const view = resolveAuthoritativeWorkflow({
      review: baseReview(code),
      liveReconciliation: liveFor(code),
    });
    assert.equal(view.kind, 'ENGINEERING');
    assert.equal(view.destination, null);
  }
});

test('workflow card generation ignores stale live reconciliation', () => {
  let state = {
    generation: 0,
    detail: null as ReturnType<typeof resolveAuthoritativeWorkflow> | null,
    error: null as string | null,
    loading: false,
    updatedAt: null as string | null,
  };
  state = beginDetailGeneration(state);
  const genA = state.generation;
  state = beginDetailGeneration(state);
  const genB = state.generation;
  const liveB = resolveAuthoritativeWorkflow({
    review: baseReview('RA_RETURN_DOUBLE_COLLECTIBLE'),
    liveReconciliation: liveFor('RA_RETURN_DOUBLE_COLLECTIBLE'),
  });
  state = applyDetailSuccess(state, genB, liveB, 'b');
  const liveA = resolveAuthoritativeWorkflow({
    review: baseReview('CURRENCY_MISMATCH'),
    liveReconciliation: liveFor('CURRENCY_MISMATCH'),
  });
  state = applyDetailSuccess(state, genA, liveA, 'a');
  assert.equal(isCurrentGeneration(state.generation, genA), false);
  assert.equal(state.detail?.kind, 'WAITING_ON_PARTY');
  state = applyDetailFailure(state, genA, 'old error');
  assert.equal(state.error, null);
});

function obligationOnlyItem(
  obligationId: string,
): FinancialObligationDto {
  return {
    rail: 'EXCEPTION_FINANCIAL',
    obligationId,
    wkOrderId: 10,
    debtor: { type: 'MERCHANT', userId: null, merchantId: 1 },
    creditor: { type: 'RIDER', userId: 'r1', merchantId: null },
    originalPrincipal: '100.00',
    settledAmount: '0.00',
    remainingAmount: '100.00',
    currency: 'PHP',
    financialState: 'UNPAID',
    flags: {},
    reconciliationState: 'REVIEW_REQUIRED',
    relatedItems: [],
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

function itemWithIds(ids: {
  obligationId: string;
  economicLossId?: string;
  determinationId?: string;
}): FinancialObligationDto {
  return {
    ...obligationOnlyItem(ids.obligationId),
    economicLossId: ids.economicLossId,
    determinationId: ids.determinationId,
  };
}

function linkageFinding(
  involved: Array<{ rail: string; obligationId: string }>,
  items: FinancialObligationDto[],
) {
  return liveFor('STAGE9_COVERAGE_MISSING', involved, items).findings[0];
}

const claimA = {
  id: 'claim-A',
  wkOrderId: 10,
  economicLossId: 'loss-A',
  determinations: [{ id: 'det-A' }, { id: 'det-A-successor' }],
  obligations: [{ id: 'obl-A' }, { id: 'obl-A2' }],
};

const claimB = {
  id: 'claim-B',
  wkOrderId: 10,
  economicLossId: 'loss-B',
  determinations: [{ id: 'det-B' }],
  obligations: [{ id: 'obl-B' }],
};

test('Stage12 linkage: consistent obligation+loss+determination selects Claim A', () => {
  const finding = linkageFinding(
    [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' }],
    [itemWithIds({ obligationId: 'obl-A', economicLossId: 'loss-A', determinationId: 'det-A' })],
  );
  const result = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding,
    items: [itemWithIds({ obligationId: 'obl-A', economicLossId: 'loss-A', determinationId: 'det-A' })],
    claims: [claimA, claimB],
  });
  assert.equal(result.status, 'one');
  if (result.status === 'one') assert.equal(result.claimId, 'claim-A');
});

test('Stage12 linkage conflicts when identifiers disagree', () => {
  const sourceInvolved = [{ rail: 'RETURN_FINANCIAL', obligationId: 'src-1' }];
  const cases: Array<{
    name: string;
    ids: { obligationId?: string; economicLossId?: string; determinationId?: string };
    involved?: Array<{ rail: string; obligationId: string }>;
    itemObligationId?: string;
  }> = [
    { name: 'obligation A + loss B', ids: { obligationId: 'obl-A', economicLossId: 'loss-B' } },
    { name: 'obligation A + det B', ids: { obligationId: 'obl-A', determinationId: 'det-B' } },
    {
      name: 'loss A + det B',
      ids: { economicLossId: 'loss-A', determinationId: 'det-B' },
      involved: sourceInvolved,
      itemObligationId: 'src-1',
    },
    {
      name: 'obligation A + loss A + det B',
      ids: { obligationId: 'obl-A', economicLossId: 'loss-A', determinationId: 'det-B' },
    },
    {
      name: 'obligation A + loss B + det A',
      ids: { obligationId: 'obl-A', economicLossId: 'loss-B', determinationId: 'det-A' },
    },
    {
      name: 'obligation B + loss A + det A',
      ids: { obligationId: 'obl-B', economicLossId: 'loss-A', determinationId: 'det-A' },
    },
    {
      name: 'three-way conflict',
      ids: { obligationId: 'obl-A', economicLossId: 'loss-B', determinationId: 'det-B' },
    },
  ];
  for (const testCase of cases) {
    const obligationId = testCase.itemObligationId ?? testCase.ids.obligationId ?? 'src-1';
    const item = itemWithIds({
      obligationId,
      economicLossId: testCase.ids.economicLossId,
      determinationId: testCase.ids.determinationId,
    });
    const involved =
      testCase.involved ??
      (testCase.ids.obligationId
        ? [{ rail: 'EXCEPTION_FINANCIAL', obligationId: testCase.ids.obligationId }]
        : sourceInvolved);
    const result = resolveExceptionClaimLinkage({
      reviewWkOrderId: 10,
      finding: linkageFinding(involved, [item]),
      items: [item],
      claims: [claimA, claimB],
    });
    assert.equal(result.status, 'conflict', testCase.name);
  }
});

test('Stage12 linkage blocks when a present identifier matches zero claims', () => {
  const oblUnknown = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' }],
      [itemWithIds({ obligationId: 'obl-A', economicLossId: 'loss-UNKNOWN' })],
    ),
    items: [itemWithIds({ obligationId: 'obl-A', economicLossId: 'loss-UNKNOWN' })],
    claims: [claimA, claimB],
  });
  assert.equal(oblUnknown.status, 'conflict');

  const lossUnknownDet = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'RETURN_FINANCIAL', obligationId: 'src-1' }],
      [itemWithIds({ obligationId: 'src-1', economicLossId: 'loss-A', determinationId: 'det-UNKNOWN' })],
    ),
    items: [itemWithIds({ obligationId: 'src-1', economicLossId: 'loss-A', determinationId: 'det-UNKNOWN' })],
    claims: [claimA, claimB],
  });
  assert.equal(lossUnknownDet.status, 'conflict');

  const detUnknownObl = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-UNKNOWN' }],
      [itemWithIds({ obligationId: 'obl-UNKNOWN', determinationId: 'det-A' })],
    ),
    items: [itemWithIds({ obligationId: 'obl-UNKNOWN', determinationId: 'det-A' })],
    claims: [claimA, claimB],
  });
  assert.equal(detUnknownObl.status, 'conflict');
});

test('Stage12 linkage unique single-identifier matches', () => {
  const onlyObl = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' }],
      [obligationOnlyItem('obl-A')],
    ),
    items: [obligationOnlyItem('obl-A')],
    claims: [claimA, claimB],
  });
  assert.equal(onlyObl.status, 'one');
  if (onlyObl.status === 'one') assert.equal(onlyObl.claimId, 'claim-A');

  const onlyLoss = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'RETURN_FINANCIAL', obligationId: 'src-1' }],
      [itemWithIds({ obligationId: 'src-1', economicLossId: 'loss-A' })],
    ),
    items: [itemWithIds({ obligationId: 'src-1', economicLossId: 'loss-A' })],
    claims: [claimA, claimB],
  });
  assert.equal(onlyLoss.status, 'one');
  if (onlyLoss.status === 'one') assert.equal(onlyLoss.claimId, 'claim-A');

  const onlyDet = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [{ rail: 'RETURN_FINANCIAL', obligationId: 'src-1' }],
      [itemWithIds({ obligationId: 'src-1', determinationId: 'det-A' })],
    ),
    items: [itemWithIds({ obligationId: 'src-1', determinationId: 'det-A' })],
    claims: [claimA, claimB],
  });
  assert.equal(onlyDet.status, 'one');
  if (onlyDet.status === 'one') assert.equal(onlyDet.claimId, 'claim-A');
});

test('Stage12 linkage successor determination on same claim remains unique', () => {
  const item = itemWithIds({
    obligationId: 'obl-A2',
    economicLossId: 'loss-A',
    determinationId: 'det-A-successor',
  });
  const result = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding([{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A2' }], [item]),
    items: [item],
    claims: [claimA, claimB],
  });
  assert.equal(result.status, 'one');
  if (result.status === 'one') assert.equal(result.claimId, 'claim-A');
});

test('Stage12 linkage two obligations on same claim are not ambiguous', () => {
  const items = [
    obligationOnlyItem('obl-A'),
    obligationOnlyItem('obl-A2'),
  ];
  const result = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [
        { rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' },
        { rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A2' },
      ],
      items,
    ),
    items,
    claims: [claimA, claimB],
  });
  assert.equal(result.status, 'one');
  if (result.status === 'one') assert.equal(result.claimId, 'claim-A');
});

test('Stage12 linkage two obligations on different claims conflict', () => {
  const items = [obligationOnlyItem('obl-A'), obligationOnlyItem('obl-B')];
  const result = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding(
      [
        { rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' },
        { rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-B' },
      ],
      items,
    ),
    items,
    claims: [claimA, claimB],
  });
  assert.equal(result.status, 'conflict');
});

test('Stage12 linkage ignores order membership without identifiers', () => {
  const result = resolveExceptionClaimLinkage({
    reviewWkOrderId: 10,
    finding: linkageFinding([], []),
    items: [],
    claims: [claimA],
  });
  assert.equal(result.status, 'none');
});

test('Stage12 conflict presentation uses bounded reason', () => {
  const view = resolveAuthoritativeWorkflow({
    review: baseReview('STAGE9_COVERAGE_MISSING'),
    liveReconciliation: liveFor(
      'STAGE9_COVERAGE_MISSING',
      [{ rail: 'EXCEPTION_FINANCIAL', obligationId: 'obl-A' }],
      [itemWithIds({ obligationId: 'obl-A', economicLossId: 'loss-B' })],
    ),
    domainContext: { claims: [claimA, claimB] },
  });
  assert.equal(view.blocked, true);
  assert.equal(view.destination, null);
  assert.equal(view.blockedReason, 'Authoritative Stage12 linkage is conflicting.');
});
