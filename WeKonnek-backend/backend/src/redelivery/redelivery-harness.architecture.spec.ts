import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FORBIDDEN_APPEND_ONLY_CLEANUP_PATTERNS } from '../test-support/append-only-fixture-cleanup';

describe('Stage 10 redelivery postgres harness (append-only isolation)', () => {
  it('does not DELETE delivery_attempts or disable Stage 8 append-only triggers in cleanup', () => {
    const src = readFileSync(
      resolve(__dirname, './redelivery.postgres.spec.ts'),
      'utf8',
    );
    for (const pattern of FORBIDDEN_APPEND_ONLY_CLEANUP_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
    // Orphan / no-op cleanup must be documented in the fixture file.
    expect(src).toMatch(/append-only|orphan|no delete of delivery_attempts/i);
  });

  it('Stage 8 delivery-failure fixture cleanup also preserves append-only history', () => {
    const src = readFileSync(
      resolve(__dirname, '../delivery-failure/delivery-failure.postgres.spec.ts'),
      'utf8',
    );
    for (const pattern of FORBIDDEN_APPEND_ONLY_CLEANUP_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
  });
});
