import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUEUE_FILTERS,
  searchParamsFromQuery,
  serializeQueueFilters,
} from './financial-reconciliation-presentation.ts';

test('search query serializer includes supported frozen params only', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const serialized = serializeQueueFilters(
    {
      ...DEFAULT_QUEUE_FILTERS,
      rail: 'EXCEPTION_FINANCIAL',
      obligationId: 'obl-9',
      reviewStatus: 'none',
      outstanding: 'no',
      disputed: 'yes',
      findingCode: 'SUCCESSOR_CYCLE_DETECTED',
      reconciliationState: 'SOURCE_INCONSISTENCY',
      wkOrderId: '7',
    },
    now,
  );
  assert.equal(serialized.ok, true);
  if (!serialized.ok) return;
  const params = searchParamsFromQuery(serialized.query, 'cursor-1');
  assert.ok(params.get('since'));
  assert.ok(params.get('until'));
  assert.equal(params.get('wkOrderId'), '7');
  assert.equal(params.get('rail'), 'EXCEPTION_FINANCIAL');
  assert.equal(params.get('obligationId'), 'obl-9');
  assert.equal(params.get('hasOutstanding'), 'false');
  assert.equal(params.get('hasDispute'), 'true');
  assert.equal(params.get('hasReconciliationIssue'), 'false');
  assert.equal(params.get('findingCode'), 'SUCCESSOR_CYCLE_DETECTED');
  assert.equal(params.get('reconciliationState'), 'SOURCE_INCONSISTENCY');
  assert.equal(params.get('limit'), '20');
  assert.equal(params.get('cursor'), 'cursor-1');
  assert.equal(params.has('page'), false);
});

test('serializer omits undefined optional filters', () => {
  const now = new Date(2026, 8, 19, 12, 0, 0);
  const serialized = serializeQueueFilters(DEFAULT_QUEUE_FILTERS, now);
  assert.equal(serialized.ok, true);
  if (!serialized.ok) return;
  const params = searchParamsFromQuery(serialized.query);
  assert.equal(params.has('rail'), false);
  assert.equal(params.has('obligationId'), false);
  assert.equal(params.has('wkOrderId'), false);
  assert.equal(params.has('hasOutstanding'), false);
  assert.equal(params.has('cursor'), false);
});
