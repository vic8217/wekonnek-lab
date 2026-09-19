import assert from 'node:assert/strict';
import test from 'node:test';
import { mapReviewApiError } from './financial-reconciliation-review-api.ts';

test('review API error mapper keeps admin-safe codes without financial copy', () => {
  assert.equal(
    mapReviewApiError(409, { message: 'STALE_FINDING' }),
    'This finding is no longer live on current reconciliation.',
  );
  assert.equal(
    mapReviewApiError(409, { message: 'FINDING_STILL_ACTIVE' }),
    'The finding is still active. Condition-cleared close is not allowed.',
  );
  assert.equal(
    mapReviewApiError(409, { message: 'REVIEW_VERSION_CONFLICT' }),
    'This follow-up was updated by another admin. Refresh and try again.',
  );
  assert.equal(
    mapReviewApiError(403, { message: 'forbidden' }),
    'Access denied. System admin only.',
  );
  assert.equal(
    /settled|paid|principal|override/i.test(
      mapReviewApiError(400, { message: 'REVIEW_ONLY_NOT_ALLOWED' }),
    ),
    false,
  );
});
