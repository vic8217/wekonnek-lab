/**
 * Stage13B-3B search policy / cursor unit tests. No database.
 */
import { toMoney } from './financial-reconciliation.policy';
import {
  applyCursor,
  CANDIDATE_SCAN_MAX,
  canonicalFilterFingerprint,
  decodeSearchCursor,
  encodeSearchCursor,
  mapSearchCard,
  matchesDerivedFilters,
  mergeSourceCandidates,
  nextCursorFor,
  parseSearchQuery,
  SEARCH_CURSOR_VERSION,
  SEARCH_RESULT_LIMIT_MAX,
} from './financial-reconciliation-search.policy';
import {
  FINANCIAL_RAIL_IDS,
  FinancialReconciliationItem,
  OrderFinancialReconciliation,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
} from './financial-reconciliation.types';

const NOW = new Date('2026-09-19T00:00:00.000Z');

function item(
  partial: Partial<FinancialReconciliationItem> & { obligationId: string },
): FinancialReconciliationItem {
  return {
    rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    wkOrderId: 1,
    debtor: { type: 'CUSTOMER', userId: 'cust', merchantId: null },
    creditor: { type: 'RIDER', userId: 'rider', merchantId: null },
    originalPrincipal: toMoney('1.00'),
    settledAmount: toMoney('0.00'),
    remainingAmount: toMoney('1.00'),
    currency: 'PHP',
    financialState: 'UNPAID',
    flags: {
      disputed: false,
      nonExecutable: false,
      collectionRestricted: false,
      reconciliationRequired: false,
    },
    sourceType: 'RIDER_ADVANCE',
    sourceId: partial.obligationId,
    reconciliationState: 'CLEAR',
    sourceRefs: {
      settlementIds: ['hidden-settle'],
      acknowledgedSettlementIds: [],
      coverageIds: [],
    },
    createdAt: NOW,
    relatedItems: [],
    ...partial,
  };
}

function view(
  partial: Partial<OrderFinancialReconciliation> & { wkOrderId: number },
): OrderFinancialReconciliation {
  const items = partial.items ?? [item({ obligationId: 'ra-1' })];
  return {
    items,
    directionalGroups: [],
    findings: [],
    relatedItems: [],
    hasOutstanding: true,
    hasDispute: false,
    hasReconciliationIssue: false,
    ...partial,
  };
}

describe('Stage13B-3B search policy', () => {
  const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('exposes immutable scan/result caps', () => {
    expect(CANDIDATE_SCAN_MAX).toBe(50);
    expect(SEARCH_RESULT_LIMIT_MAX).toBe(20);
    expect(SEARCH_CURSOR_VERSION).toBe(1);
  });

  it('unbounded search is SEARCH_BOUNDS_REQUIRED', () => {
    const parsed = parseSearchQuery({});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('SEARCH_BOUNDS_REQUIRED');
  });

  it('since scan is accepted', () => {
    const parsed = parseSearchQuery({ since: recentSince });
    expect(parsed.ok).toBe(true);
  });

  it('since older than 30 days is INVALID_DATE', () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const parsed = parseSearchQuery({ since: old });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_DATE');
  });

  it('until before since is INVALID_DATE', () => {
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const parsed = parseSearchQuery({ since, until });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_DATE');
  });

  it('malformed dates are INVALID_DATE', () => {
    const parsed = parseSearchQuery({ since: 'not-a-date' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_DATE');
  });

  it('invalid rail is INVALID_RAIL including PAYMENT', () => {
    const parsed = parseSearchQuery({ since: recentSince, rail: 'PAYMENT' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_RAIL');
  });

  it('invalid findingCode is INVALID_FINDING_CODE', () => {
    const parsed = parseSearchQuery({
      since: recentSince,
      findingCode: 'NOT_A_FINDING',
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_FINDING_CODE');
  });

  it('accepts frozen findingCode constants', () => {
    const parsed = parseSearchQuery({
      since: recentSince,
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    });
    expect(parsed.ok).toBe(true);
  });

  it('invalid reconciliationState is INVALID_RECONCILIATION_STATE', () => {
    const parsed = parseSearchQuery({
      since: recentSince,
      reconciliationState: 'TOTALLY_FINE',
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_RECONCILIATION_STATE');
  });

  it('obligationId without rail is INVALID_EXACT_KEY', () => {
    const parsed = parseSearchQuery({ obligationId: 'obl-1' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_EXACT_KEY');
  });

  it('exact wkOrderId does not require since', () => {
    const parsed = parseSearchQuery({ wkOrderId: '42' });
    expect(parsed.ok).toBe(true);
  });

  it('rail + obligationId does not require since', () => {
    const parsed = parseSearchQuery({
      rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      obligationId: 'ra-1',
    });
    expect(parsed.ok).toBe(true);
  });

  it('caps limit above 20 to 20', () => {
    const parsed = parseSearchQuery({ since: recentSince, limit: '99' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.filters.limit).toBe(20);
  });

  it('defaults limit to 20', () => {
    const parsed = parseSearchQuery({ since: recentSince });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.filters.limit).toBe(20);
  });

  it('ignores candidateScanMax as a client parameter', () => {
    const parsed = parseSearchQuery({
      since: recentSince,
      ...( { candidateScanMax: '500' } as Record<string, string> ),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.filters.limit).toBe(20);
      expect(
        JSON.stringify(parsed.value.filters),
      ).not.toContain('candidateScanMax');
    }
  });

  it('fingerprint is independent of query-parameter order', () => {
    const a = parseSearchQuery({
      since: recentSince,
      rail: RAIL_RETURN_FINANCIAL,
      hasOutstanding: 'true',
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    });
    const b = parseSearchQuery({
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
      hasOutstanding: 'true',
      rail: RAIL_RETURN_FINANCIAL,
      since: recentSince,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.fingerprint).toBe(b.value.fingerprint);
      expect(a.value.fingerprint).toBe(
        canonicalFilterFingerprint(a.value.filters),
      );
    }
  });

  it('cursor encode/decode round-trips opaque base64url JSON', () => {
    const cursor = {
      v: 1 as const,
      a: NOW.toISOString(),
      i: 9,
      f: 'a'.repeat(64),
    };
    const encoded = encodeSearchCursor(cursor);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(decodeSearchCursor(encoded)).toEqual(cursor);
  });

  it('malformed / wrong-version cursors are INVALID_CURSOR', () => {
    expect(parseSearchQuery({ since: recentSince, cursor: '%%%' }).ok).toBe(
      false,
    );
    const parsed = parseSearchQuery({ since: recentSince, cursor: '%%%' });
    if (!parsed.ok) expect(parsed.code).toBe('INVALID_CURSOR');

    const wrongV = Buffer.from(
      JSON.stringify({ v: 2, a: NOW.toISOString(), i: 1, f: 'a'.repeat(64) }),
      'utf8',
    ).toString('base64url');
    const badV = parseSearchQuery({ since: recentSince, cursor: wrongV });
    expect(badV.ok).toBe(false);
    if (!badV.ok) expect(badV.code).toBe('INVALID_CURSOR');
  });

  it('cursor reused with changed findingCode is CURSOR_FILTER_MISMATCH', () => {
    const first = parseSearchQuery({
      since: recentSince,
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cursor = nextCursorFor(
      { wkOrderId: 8, sourceActivityAt: NOW },
      first.value.fingerprint,
    );
    const replay = parseSearchQuery({
      since: recentSince,
      findingCode: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
      cursor,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('CURSOR_FILTER_MISMATCH');
  });

  it('cursor reused with changed rail is CURSOR_FILTER_MISMATCH', () => {
    const first = parseSearchQuery({
      since: recentSince,
      rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cursor = nextCursorFor(
      { wkOrderId: 8, sourceActivityAt: NOW },
      first.value.fingerprint,
    );
    const replay = parseSearchQuery({
      since: recentSince,
      rail: RAIL_RETURN_FINANCIAL,
      cursor,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('CURSOR_FILTER_MISMATCH');
  });

  it('cursor replay with the same filters succeeds', () => {
    const first = parseSearchQuery({ since: recentSince, hasDispute: 'true' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const cursor = nextCursorFor(
      { wkOrderId: 3, sourceActivityAt: NOW },
      first.value.fingerprint,
    );
    const replay = parseSearchQuery({
      since: recentSince,
      hasDispute: 'true',
      cursor,
    });
    expect(replay.ok).toBe(true);
  });

  it('merges multi-rail rows into one candidate using max activity', () => {
    const t1 = new Date('2026-09-18T01:00:00.000Z');
    const t2 = new Date('2026-09-18T02:00:00.000Z');
    const t3 = new Date('2026-09-18T03:00:00.000Z');
    const merged = mergeSourceCandidates([
      [{ wkOrderId: 10, sourceActivityAt: t1 }],
      [{ wkOrderId: 10, sourceActivityAt: t3 }],
      [{ wkOrderId: 10, sourceActivityAt: t2 }],
      [{ wkOrderId: 9, sourceActivityAt: t3 }],
    ]);
    expect(merged).toEqual([
      { wkOrderId: 10, sourceActivityAt: t3 },
      { wkOrderId: 9, sourceActivityAt: t3 },
    ]);
  });

  it('orders candidates by sourceActivityAt DESC, wkOrderId DESC', () => {
    const t = new Date('2026-09-18T01:00:00.000Z');
    const newer = new Date('2026-09-18T02:00:00.000Z');
    const merged = mergeSourceCandidates([
      [
        { wkOrderId: 2, sourceActivityAt: t },
        { wkOrderId: 5, sourceActivityAt: t },
        { wkOrderId: 1, sourceActivityAt: newer },
      ],
    ]);
    expect(merged.map((r) => r.wkOrderId)).toEqual([1, 5, 2]);
  });

  it('applyCursor continues strictly after the last evaluated candidate', () => {
    const t = new Date('2026-09-18T02:00:00.000Z');
    const older = new Date('2026-09-18T01:00:00.000Z');
    const candidates = [
      { wkOrderId: 5, sourceActivityAt: t },
      { wkOrderId: 4, sourceActivityAt: t },
      { wkOrderId: 3, sourceActivityAt: older },
    ];
    const rest = applyCursor(candidates, {
      v: 1,
      a: t.toISOString(),
      i: 5,
      f: 'f'.repeat(64),
    });
    expect(rest.map((r) => r.wkOrderId)).toEqual([4, 3]);
  });

  it('derived filters read frozen hasOutstanding/hasDispute/hasReconciliationIssue', () => {
    const outstanding = view({
      wkOrderId: 1,
      hasOutstanding: true,
      items: [item({ obligationId: 'a', remainingAmount: toMoney('5.00') })],
    });
    const settled = view({
      wkOrderId: 2,
      hasOutstanding: false,
      items: [item({ obligationId: 'b', remainingAmount: toMoney('0.00') })],
    });
    const filters = parseSearchQuery({
      since: recentSince,
      hasOutstanding: 'true',
    });
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    expect(matchesDerivedFilters(outstanding, filters.value.filters)).toBe(true);
    expect(matchesDerivedFilters(settled, filters.value.filters)).toBe(false);
  });

  it('hasDispute filter uses frozen hasDispute (RA disputed only)', () => {
    const disputed = view({
      wkOrderId: 1,
      hasDispute: true,
      items: [
        item({
          obligationId: 'ra',
          flags: {
            disputed: true,
            nonExecutable: false,
            collectionRestricted: false,
            reconciliationRequired: false,
          },
        }),
      ],
    });
    const filters = parseSearchQuery({ since: recentSince, hasDispute: 'true' });
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    expect(matchesDerivedFilters(disputed, filters.value.filters)).toBe(true);
    expect(
      matchesDerivedFilters(
        view({ wkOrderId: 2, hasDispute: false }),
        filters.value.filters,
      ),
    ).toBe(false);
  });

  it('findingCode / reconciliationState filters use frozen findings', () => {
    const flagged = view({
      wkOrderId: 1,
      hasReconciliationIssue: true,
      findings: [
        {
          findingKey: 'k',
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
          reconciliationState: 'OVERLAP_REVIEW_REQUIRED',
          wkOrderId: 1,
          checkOutcome: 'FAILED',
          involvedItems: [],
          explanationCode:
            RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
          evidenceRefs: [],
        },
      ],
    });
    const code = parseSearchQuery({
      since: recentSince,
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    });
    const state = parseSearchQuery({
      since: recentSince,
      reconciliationState: 'OVERLAP_REVIEW_REQUIRED',
    });
    expect(code.ok && state.ok).toBe(true);
    if (!code.ok || !state.ok) return;
    expect(matchesDerivedFilters(flagged, code.value.filters)).toBe(true);
    expect(matchesDerivedFilters(flagged, state.value.filters)).toBe(true);
    expect(
      matchesDerivedFilters(view({ wkOrderId: 2 }), code.value.filters),
    ).toBe(false);
  });

  it('mapSearchCard omits money, sourceRefs, evidenceRefs, and party PII', () => {
    const card = mapSearchCard(
      view({
        wkOrderId: 7,
        hasOutstanding: true,
        hasDispute: false,
        hasReconciliationIssue: true,
        items: [
          item({
            obligationId: 'ra',
            rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
          }),
          item({
            obligationId: 'ret',
            rail: RAIL_RETURN_FINANCIAL,
            reconciliationState: 'CLEAR',
          }),
          item({
            obligationId: 'ex',
            rail: RAIL_EXCEPTION_FINANCIAL,
          }),
        ],
        findings: [
          {
            findingKey: 'k',
            code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
            reconciliationState: 'OVERLAP_REVIEW_REQUIRED',
            wkOrderId: 7,
            checkOutcome: 'FAILED',
            involvedItems: [],
            explanationCode:
              RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
            evidenceRefs: ['secret-evidence'],
          },
        ],
      }),
      NOW,
    );
    expect(card).not.toBeNull();
    expect(card!.wkOrderId).toBe(7);
    expect(card!.rails).toEqual([...FINANCIAL_RAIL_IDS]);
    expect(card!.itemCount).toBe(3);
    expect(card!.sourceActivityAt).toBe(NOW.toISOString());
    expect(card!.findingCodes).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    ]);
    expect(card!.reconciliationStates).toEqual([
      'CLEAR',
      'OVERLAP_REVIEW_REQUIRED',
    ]);
    const json = JSON.stringify(card);
    expect(json).not.toContain('originalPrincipal');
    expect(json).not.toContain('settledAmount');
    expect(json).not.toContain('remainingAmount');
    expect(json).not.toContain('collectibleRemaining');
    expect(json).not.toContain('sourceRefs');
    expect(json).not.toContain('evidenceRefs');
    expect(json).not.toContain('hidden-settle');
    expect(json).not.toContain('secret-evidence');
    expect(json).not.toContain('cust');
    expect(json).not.toContain('rider');
    expect(json).not.toContain('lastFinancialActivityAt');
  });

  it('mapSearchCard returns null when frozen forOrder has no items', () => {
    expect(
      mapSearchCard(view({ wkOrderId: 1, items: [] }), NOW),
    ).toBeNull();
  });
});
