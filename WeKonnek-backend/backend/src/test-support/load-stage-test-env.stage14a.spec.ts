import {
  isStage14aAcceptanceDatabase,
  loadStage14aTestEnv,
} from './load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from './acceptance-database';

describe('Stage14A dedicated env routing', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'DATABASE_URL',
    'WEKONNEK_ACCEPTANCE_DATABASE_URL',
    'WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK',
    'WEKONNEK_CURRENT_SCHEMA_REGRESSION',
    'NODE_ENV',
  ];

  beforeEach(() => {
    for (const key of keys) saved[key] = process.env[key];
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts only wekonnek_stage14a_* disposable names', () => {
    expect(isStage14aAcceptanceDatabase('wekonnek_stage14a_cursor_test')).toBe(
      true,
    );
    expect(
      isStage14aAcceptanceDatabase('wekonnek_stage14a_cursor_repair_test'),
    ).toBe(true);
    expect(
      isStage14aAcceptanceDatabase(
        'wekonnek_stage13b3_b_cursor_regression_test',
      ),
    ).toBe(false);
    expect(isStage14aAcceptanceDatabase('wekonnek_stage13b3_cursor_test')).toBe(
      false,
    );
    expect(isStage14aAcceptanceDatabase('wekonnek_stage13a_test')).toBe(false);
    expect(isStage14aAcceptanceDatabase('wekonnek_stage13b2_test')).toBe(false);
  });

  it('does not adopt a Stage13B-3B regression URL as the Stage14A success target', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL =
      'postgresql://victor@127.0.0.1:5432/wekonnek_stage13b3_b_cursor_regression_test';
    process.env.DATABASE_URL =
      'postgresql://victor@127.0.0.1:5432/wekonnek_stage13b3_b_cursor_regression_test';
    const ok = loadStage14aTestEnv();
    if (ok) {
      const db = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL!).database;
      expect(db.startsWith('wekonnek_stage14a_')).toBe(true);
      expect(db.startsWith('wekonnek_stage13b3_')).toBe(false);
    } else {
      expect(ok).toBe(false);
    }
  });
});
