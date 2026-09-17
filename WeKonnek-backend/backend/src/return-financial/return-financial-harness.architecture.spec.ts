import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FORBIDDEN_STAGE9_FIXTURE_CLEANUP_PATTERNS } from '../test-support/append-only-fixture-cleanup';

const FIXTURE_SPECS = [
  './return-financial.postgres.spec.ts',
  './return-financial.http.int.spec.ts',
] as const;

describe('Stage 9 return-financial harness (append-only isolation)', () => {
  for (const relative of FIXTURE_SPECS) {
    it(`${relative} does not disable triggers or DELETE protected Stage 9 financial history`, () => {
      const src = readFileSync(resolve(__dirname, relative), 'utf8');
      for (const pattern of FORBIDDEN_STAGE9_FIXTURE_CLEANUP_PATTERNS) {
        expect(src).not.toMatch(pattern);
      }
      expect(src).toMatch(/append-only|orphan|Do not\s+DISABLE TRIGGER/i);
    });
  }
});

describe('Stage 11 operations-recovery HTTP harness (append-only isolation)', () => {
  it('http.int afterAll does not DISABLE TRIGGER USER on Stage 8/11 protected tables', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../operations-recovery/operations-recovery.http.int.spec.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/DISABLE\s+TRIGGER\s+USER/i);
    expect(src).not.toMatch(/deliveryAttempt\.deleteMany/);
    expect(src).toMatch(/append-only|orphan|Do not\s+DISABLE TRIGGER/i);
  });
});
