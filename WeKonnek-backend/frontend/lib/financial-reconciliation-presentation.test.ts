import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUEUE_FILTERS,
  FINDING_DISPLAY,
  FINANCIAL_RAILS,
  RAIL_LABELS,
  RECONCILIATION_FINDING_CODES,
  RECONCILIATION_STATES,
  SEARCH_MAX_INCLUSIVE_DAYS,
  SEARCH_MAX_LOOKBACK_MS,
  STATE_LABELS,
  appendUniqueOrders,
  applyDetailFailure,
  applyDetailSuccess,
  applyQueueFailure,
  applyQueueSuccess,
  attentionBadges,
  beginDetailGeneration,
  beginQueueGeneration,
  filterFingerprint,
  findingTitle,
  formatMoneyAmount,
  hasDerivedQueueFilters,
  inclusiveLocalDayCount,
  isAbortError,
  isCurrentGeneration,
  isFinancialReconciliationAdmin,
  mapPublicApiError,
  nextGeneration,
  queueCardHasMoneyFields,
  queueCardView,
  queueEmptyCopy,
  queueEmptyKind,
  railLabel,
  searchParamsFromQuery,
  serializeDateWindow,
  serializeQueueFilters,
  startOfLocalDay,
  stateLabel,
  type DetailAuthoritySnapshot,
  type QueueAuthoritySnapshot,
} from './financial-reconciliation-presentation.ts';

test('admin gate admits admin only', () => {
  assert.equal(isFinancialReconciliationAdmin('admin'), true);
  assert.equal(isFinancialReconciliationAdmin('staff'), false);
  assert.equal(isFinancialReconciliationAdmin('merchant'), false);
  assert.equal(isFinancialReconciliationAdmin(undefined), false);
});

test('all frozen rails have display labels', () => {
  for (const rail of FINANCIAL_RAILS) {
    assert.ok(RAIL_LABELS[rail]);
    assert.notEqual(railLabel(rail), rail);
  }
  assert.equal(railLabel('RIDER_ADVANCE_REIMBURSEMENT'), 'Rider Advance');
  assert.equal(railLabel('RETURN_FINANCIAL'), 'Return Financial');
  assert.equal(railLabel('EXCEPTION_FINANCIAL'), 'Exception Liability');
});

test('all frozen finding codes have titles', () => {
  assert.equal(RECONCILIATION_FINDING_CODES.length, 21);
  for (const code of RECONCILIATION_FINDING_CODES) {
    assert.ok(FINDING_DISPLAY[code].title);
    assert.ok(FINDING_DISPLAY[code].explanation);
    assert.notEqual(findingTitle(code), '');
  }
});

test('all frozen reconciliation states have labels and never say financially correct', () => {
  for (const state of RECONCILIATION_STATES) {
    const label = stateLabel(state);
    assert.ok(STATE_LABELS[state]);
    assert.equal(/financially correct|certified|safe|resolved/i.test(label), false);
  }
  assert.equal(stateLabel('CLEAR'), 'No detected issue');
});

test('attention badges use frozen booleans only', () => {
  assert.deepEqual(
    attentionBadges({
      hasOutstanding: true,
      hasDispute: true,
      hasReconciliationIssue: true,
    }).map((b) => b.label),
    ['Needs review', 'Outstanding', 'Disputed'],
  );
  assert.deepEqual(
    attentionBadges({
      hasOutstanding: false,
      hasDispute: false,
      hasReconciliationIssue: false,
    }).map((b) => b.label),
    ['No detected reconciliation issue'],
  );
});

test('queue card view contains no money fields', () => {
  const card = queueCardView({
    wkOrderId: 12,
    rails: ['RIDER_ADVANCE_REIMBURSEMENT'],
    hasOutstanding: true,
    hasDispute: false,
    hasReconciliationIssue: true,
    reconciliationStates: ['REVIEW_REQUIRED'],
    findingCodes: ['RA_RETURN_RESTRICTION_MISSING', 'CURRENCY_MISMATCH', 'COVERAGE_SOURCE_MISSING'],
    itemCount: 2,
    sourceActivityAt: '2026-09-19T06:00:00.000Z',
  });
  assert.equal(queueCardHasMoneyFields(card), false);
  assert.equal('originalPrincipal' in card, false);
  assert.equal('settledAmount' in card, false);
  assert.equal('remainingAmount' in card, false);
  assert.equal(card.findingTitles.length, 2);
  assert.equal(card.extraFindings, 1);
  assert.equal(card.railLabels[0], 'Rider Advance');
});

test('money formatting does not use arithmetic', () => {
  assert.equal(formatMoneyAmount('1234.50'), '1,234.50');
  assert.equal(formatMoneyAmount('100.00'), '100.00');
  assert.equal(formatMoneyAmount('not-a-number'), 'not-a-number');
});

test('today preset serializes the current local day only', () => {
  const now = new Date(2026, 8, 19, 15, 30, 0);
  const window = serializeDateWindow('today', '', '', now);
  assert.equal(window.ok, true);
  if (!window.ok) return;
  const since = new Date(window.since);
  const until = new Date(window.until);
  assert.equal(since.getFullYear(), 2026);
  assert.equal(since.getMonth(), 8);
  assert.equal(since.getDate(), 19);
  assert.equal(since.getHours(), 0);
  assert.equal(until.getDate(), 19);
  assert.equal(inclusiveLocalDayCount(since, until), 1);
  assert.equal(now.getTime() - since.getTime() <= SEARCH_MAX_LOOKBACK_MS, true);
});

test('7-day preset is seven inclusive local days ending today', () => {
  const now = new Date(2026, 8, 19, 15, 30, 0);
  const window = serializeDateWindow('7d', '', '', now);
  assert.equal(window.ok, true);
  if (!window.ok) return;
  const since = new Date(window.since);
  const until = new Date(window.until);
  assert.equal(since.getDate(), 13);
  assert.equal(until.getDate(), 19);
  assert.equal(inclusiveLocalDayCount(since, until), 7);
  assert.equal(now.getTime() - since.getTime() <= SEARCH_MAX_LOOKBACK_MS, true);
});

test('14-day preset is fourteen inclusive local days ending today', () => {
  const now = new Date(2026, 8, 19, 15, 30, 0);
  const window = serializeDateWindow('14d', '', '', now);
  assert.equal(window.ok, true);
  if (!window.ok) return;
  assert.equal(inclusiveLocalDayCount(new Date(window.since), new Date(window.until)), 14);
});

test('30-day preset is thirty inclusive local days ending today', () => {
  const now = new Date(2026, 8, 19, 15, 30, 0);
  const window = serializeDateWindow('30d', '', '', now);
  assert.equal(window.ok, true);
  if (!window.ok) return;
  assert.equal(inclusiveLocalDayCount(new Date(window.since), new Date(window.until)), 30);
  assert.equal(now.getTime() - Date.parse(window.since) <= SEARCH_MAX_LOOKBACK_MS, true);
});

test('valid custom range serializes selected start and end without clamping', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const window = serializeDateWindow('custom', '2026-09-10', '2026-09-19', now);
  assert.equal(window.ok, true);
  if (!window.ok) return;
  const since = new Date(window.since);
  const until = new Date(window.until);
  assert.equal(since.getDate(), 10);
  assert.equal(until.getDate(), 19);
  assert.equal(inclusiveLocalDayCount(since, until), 10);
});

test('exact 30-day custom range is valid and the next day is invalid', () => {
  const now = new Date(2026, 8, 19, 15, 30, 0);
  assert.equal(SEARCH_MAX_INCLUSIVE_DAYS, 30);
  assert.equal(
    inclusiveLocalDayCount(startOfLocalDay(new Date(2026, 7, 21)), startOfLocalDay(now)),
    30,
  );
  assert.equal(
    inclusiveLocalDayCount(startOfLocalDay(new Date(2026, 7, 20)), startOfLocalDay(now)),
    31,
  );
  const exact = serializeDateWindow('custom', '2026-08-21', '2026-09-19', now);
  assert.equal(exact.ok, true);
  const over = serializeDateWindow('custom', '2026-08-20', '2026-09-19', now);
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.match(over.message, /cannot exceed 30 days/i);
  }
});

test('custom range from today to a far-future end is rejected', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const future = serializeDateWindow('custom', '2026-09-19', '2027-12-31', now);
  assert.equal(future.ok, false);
  if (!future.ok) {
    assert.match(future.message, /future/i);
  }
});

test('historical custom range over 30 days is a validation error, not a silent clamp', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const overlong = serializeDateWindow('custom', '2026-01-01', '2026-03-01', now);
  assert.equal(overlong.ok, false);
  if (!overlong.ok) {
    assert.match(overlong.message, /cannot exceed 30 days/i);
  }
  assert.equal('since' in overlong, false);
  assert.equal('until' in overlong, false);
});

test('custom start older than backend 30-day lookback is rejected without clamping', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const historical = serializeDateWindow('custom', '2026-07-01', '2026-07-15', now);
  assert.equal(historical.ok, false);
  if (!historical.ok) {
    assert.match(historical.message, /30 days before today/i);
  }
});

test('reversed custom dates are rejected before search', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const inverted = serializeDateWindow('custom', '2026-09-19', '2026-09-01', now);
  assert.equal(inverted.ok, false);
  if (!inverted.ok) {
    assert.match(inverted.message, /start date must be on or before end date/i);
  }
});

test('invalid custom dates are rejected', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  assert.equal(serializeDateWindow('custom', '', '', now).ok, false);
  assert.equal(serializeDateWindow('custom', 'not-a-date', '2026-09-19', now).ok, false);
  assert.equal(serializeDateWindow('custom', '2026-09-19', '2026-13-40', now).ok, false);
});

test('queue filter serialization omits empty filters and requires rail with obligation', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const base = serializeQueueFilters(DEFAULT_QUEUE_FILTERS, now);
  assert.equal(base.ok, true);
  if (!base.ok) return;
  assert.equal('since' in base.query, true);
  assert.equal('until' in base.query, true);
  assert.equal('rail' in base.query, false);
  assert.equal('hasOutstanding' in base.query, false);
  assert.equal('cursor' in base.query, false);

  const missingRail = serializeQueueFilters(
    { ...DEFAULT_QUEUE_FILTERS, obligationId: 'abc' },
    now,
  );
  assert.equal(missingRail.ok, false);

  const exact = serializeQueueFilters(
    {
      ...DEFAULT_QUEUE_FILTERS,
      rail: 'RETURN_FINANCIAL',
      obligationId: 'obl-1',
      reviewStatus: 'needs',
      outstanding: 'yes',
      disputed: 'no',
      findingCode: 'RA_RETURN_RESTRICTION_MISSING',
      reconciliationState: 'REVIEW_REQUIRED',
      wkOrderId: '42',
    },
    now,
  );
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.query.rail, 'RETURN_FINANCIAL');
  assert.equal(exact.query.obligationId, 'obl-1');
  assert.equal(exact.query.hasReconciliationIssue, 'true');
  assert.equal(exact.query.hasOutstanding, 'true');
  assert.equal(exact.query.hasDispute, 'false');
  assert.equal(exact.query.wkOrderId, '42');
  assert.equal(exact.query.limit, '20');
});

test('search params omit undefined filters and attach cursor only when provided', () => {
  const params = searchParamsFromQuery({ since: 'a', until: 'b' });
  assert.equal(params.get('cursor'), null);
  assert.equal(params.get('rail'), null);
  const withCursor = searchParamsFromQuery({ since: 'a' }, 'opaque');
  assert.equal(withCursor.get('cursor'), 'opaque');
  assert.notEqual(
    filterFingerprint({ since: 'a', rail: 'X' }),
    filterFingerprint({ since: 'a' }),
  );
});

test('zero-match continuation is not a terminal empty state', () => {
  const kind = queueEmptyKind({
    accumulatedCount: 0,
    lastBatchCount: 0,
    nextCursor: 'next',
    exhausted: false,
    hasDerivedFilters: true,
  });
  assert.equal(kind, 'batch');
  assert.equal(queueEmptyCopy(kind), 'No matching cases in this batch.');
});

test('exhausted empty states distinguish period vs filtered search', () => {
  assert.equal(
    queueEmptyKind({
      accumulatedCount: 0,
      lastBatchCount: 0,
      nextCursor: null,
      exhausted: true,
      hasDerivedFilters: false,
    }),
    'period',
  );
  assert.equal(
    queueEmptyCopy('period'),
    'No financial reconciliation cases were found for this period.',
  );
  assert.equal(
    queueEmptyKind({
      accumulatedCount: 0,
      lastBatchCount: 0,
      nextCursor: null,
      exhausted: true,
      hasDerivedFilters: true,
    }),
    'filtered',
  );
  assert.equal(
    queueEmptyCopy('filtered'),
    'No matching reconciliation cases were found.',
  );
  assert.equal(hasDerivedQueueFilters(DEFAULT_QUEUE_FILTERS), false);
  assert.equal(
    hasDerivedQueueFilters({ ...DEFAULT_QUEUE_FILTERS, reviewStatus: 'needs' }),
    true,
  );
});

test('continuation deduplicates by wkOrderId', () => {
  const result = appendUniqueOrders(
    [{ wkOrderId: 1 }, { wkOrderId: 2 }],
    [{ wkOrderId: 2 }, { wkOrderId: 3 }],
  );
  assert.deepEqual(
    result.items.map((row) => row.wkOrderId),
    [1, 2, 3],
  );
  assert.equal(result.added, 1);
  assert.equal(result.duplicatesSkipped, 1);
});

test('cursor reset is required when filters change', () => {
  const first = filterFingerprint({ since: 'a', until: 'b' });
  const second = filterFingerprint({ since: 'a', until: 'c' });
  assert.notEqual(first, second);
});

test('public API errors do not leak internals and map cursor mismatch to reset', () => {
  const denied = mapPublicApiError(403, { message: 'secret token xyz' });
  assert.equal(denied.message, 'Access denied. System admin only.');
  const cursor = mapPublicApiError(400, { code: 'CURSOR_FILTER_MISMATCH' });
  assert.equal(cursor.resetCursor, true);
  const bounds = mapPublicApiError(400, { code: 'SEARCH_BOUNDS_REQUIRED' });
  assert.equal(bounds.inlinePeriod, true);
});

test('queue page does not import the order detail client', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(dir, '../app/admin/financial-reconciliation/page.tsx'),
    'utf8',
  );
  assert.equal(src.includes('fetchOrderFinancialReconciliation'), false);
  assert.equal(src.includes('/orders/'), false);
  assert.equal(src.includes('isCurrentGeneration'), true);
  assert.equal(src.includes('nextGeneration'), true);
});

function emptyQueue(): QueueAuthoritySnapshot {
  return {
    generation: 0,
    items: [],
    nextCursor: null,
    exhausted: false,
    scanned: null,
    lastBatchCount: 0,
    loading: false,
    continuing: false,
    inlineError: null,
    loadError: null,
  };
}

test('queue request A is ignored after newer request B succeeds', () => {
  let state = emptyQueue();
  state = beginQueueGeneration(state, 'replace');
  const generationA = state.generation;
  state = beginQueueGeneration(state, 'replace');
  const generationB = state.generation;
  assert.equal(generationB, nextGeneration(generationA));
  assert.equal(isCurrentGeneration(state.generation, generationA), false);
  state = applyQueueSuccess(state, generationB, {
    mode: 'replace',
    items: [{ wkOrderId: 2 }],
    nextCursor: 'cursor-b',
    exhausted: false,
    scanned: 4,
  });
  state = applyQueueSuccess(state, generationA, {
    mode: 'replace',
    items: [{ wkOrderId: 1 }],
    nextCursor: 'cursor-a',
    exhausted: true,
    scanned: 9,
  });
  assert.deepEqual(
    state.items.map((row) => row.wkOrderId),
    [2],
  );
  assert.equal(state.nextCursor, 'cursor-b');
  assert.equal(state.exhausted, false);
  assert.equal(state.scanned, 4);
  assert.equal(state.loading, false);
  assert.equal(state.loadError, null);
});

test('queue stale failure does not replace newer success', () => {
  let state = emptyQueue();
  state = beginQueueGeneration(state, 'replace');
  const generationA = state.generation;
  state = beginQueueGeneration(state, 'replace');
  const generationB = state.generation;
  state = applyQueueSuccess(state, generationB, {
    mode: 'replace',
    items: [{ wkOrderId: 8 }],
    nextCursor: 'cursor-b',
    exhausted: false,
    scanned: 3,
  });
  state = applyQueueFailure(state, generationA, {
    loadError: 'stale failure',
    resetCursor: true,
  });
  assert.deepEqual(
    state.items.map((row) => row.wkOrderId),
    [8],
  );
  assert.equal(state.nextCursor, 'cursor-b');
  assert.equal(state.loadError, null);
  assert.equal(state.loading, false);
});

test('stale continue-search response is ignored after filters restart', () => {
  let state = emptyQueue();
  state = beginQueueGeneration(state, 'replace');
  const initial = state.generation;
  state = applyQueueSuccess(state, initial, {
    mode: 'replace',
    items: [{ wkOrderId: 1 }],
    nextCursor: 'cursor-1',
    exhausted: false,
    scanned: 2,
  });
  state = beginQueueGeneration(state, 'append');
  const continuation = state.generation;
  assert.equal(state.continuing, true);
  state = beginQueueGeneration(state, 'replace');
  const restarted = state.generation;
  state = applyQueueSuccess(state, restarted, {
    mode: 'replace',
    items: [{ wkOrderId: 9 }],
    nextCursor: 'cursor-new',
    exhausted: false,
    scanned: 5,
  });
  state = applyQueueSuccess(state, continuation, {
    mode: 'append',
    items: [{ wkOrderId: 1 }, { wkOrderId: 2 }],
    nextCursor: 'cursor-stale',
    exhausted: true,
    scanned: 99,
  });
  assert.deepEqual(
    state.items.map((row) => row.wkOrderId),
    [9],
  );
  assert.equal(state.nextCursor, 'cursor-new');
  assert.equal(state.exhausted, false);
  assert.equal(state.scanned, 5);
  assert.equal(state.continuing, false);
});

test('stale queue finally does not clear loading owned by a newer request', () => {
  let state = emptyQueue();
  state = beginQueueGeneration(state, 'replace');
  const generationA = state.generation;
  state = beginQueueGeneration(state, 'replace');
  assert.equal(state.loading, true);
  state = applyQueueFailure(state, generationA, { loadError: 'late' });
  assert.equal(state.loading, true);
  assert.equal(state.loadError, null);
  assert.equal(state.generation, nextGeneration(generationA));
});

test('detail refresh B remains after stale initial A resolves', () => {
  let state: DetailAuthoritySnapshot<{ wkOrderId: number }> = {
    generation: 0,
    detail: null,
    error: null,
    loading: false,
    updatedAt: null,
  };
  state = beginDetailGeneration(state);
  const generationA = state.generation;
  state = beginDetailGeneration(state);
  const generationB = state.generation;
  state = applyDetailSuccess(state, generationB, { wkOrderId: 20 }, 'b-time');
  state = applyDetailSuccess(state, generationA, { wkOrderId: 10 }, 'a-time');
  assert.equal(state.detail?.wkOrderId, 20);
  assert.equal(state.updatedAt, 'b-time');
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
});

test('stale detail failure does not replace newer success', () => {
  let state: DetailAuthoritySnapshot<{ wkOrderId: number }> = {
    generation: 0,
    detail: null,
    error: null,
    loading: false,
    updatedAt: null,
  };
  state = beginDetailGeneration(state);
  const generationA = state.generation;
  state = beginDetailGeneration(state);
  const generationB = state.generation;
  state = applyDetailSuccess(state, generationB, { wkOrderId: 44 }, 'b-time');
  state = applyDetailFailure(state, generationA, 'stale detail error');
  assert.equal(state.detail?.wkOrderId, 44);
  assert.equal(state.error, null);
  assert.equal(state.updatedAt, 'b-time');
  assert.equal(state.loading, false);
});

test('stale detail failure does not clear loading owned by a newer request', () => {
  let state: DetailAuthoritySnapshot<{ wkOrderId: number }> = {
    generation: 0,
    detail: null,
    error: null,
    loading: false,
    updatedAt: null,
  };
  state = beginDetailGeneration(state);
  const generationA = state.generation;
  state = beginDetailGeneration(state);
  state = applyDetailFailure(state, generationA, 'late');
  assert.equal(state.loading, true);
  assert.equal(state.error, null);
});

test('abort errors are recognized without treating other failures as aborts', () => {
  assert.equal(isAbortError({ name: 'AbortError' }), true);
  assert.equal(isAbortError(new Error('network')), false);
  assert.equal(isAbortError(null), false);
});

test('detail page guards refresh and initial load with generation ownership', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(dir, '../app/admin/financial-reconciliation/[wkOrderId]/page.tsx'),
    'utf8',
  );
  assert.equal(src.includes('isCurrentGeneration'), true);
  assert.equal(src.includes('nextGeneration'), true);
  assert.equal(src.includes('setLoading(false)'), true);
});
