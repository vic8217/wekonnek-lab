/**
 * Legacy Stage0–11 current-schema harness normalization — permanent guards.
 * Harness infrastructure only. Does not claim product freeze readiness.
 */
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertHistoricalStageDatabase,
  assertSafeDisposableAcceptanceDatabase,
  assertSafeStage12AcceptanceDatabase,
  applyAcceptanceDatabaseOverride,
  getAcceptanceDatabaseTarget,
  isStage12DisposableAcceptanceDatabase,
  parseAcceptanceDatabaseUrl,
  redactDatabaseUrl,
  resolveStage12ExpectedDatabase,
  restoreAcceptanceOverrideEnv,
  snapshotAcceptanceOverrideEnv,
} from './acceptance-database';
import {
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE7_ACCEPTANCE_DATABASE,
} from './test-database-guard';
import { loadStageTestEnv } from './load-stage-test-env';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('Legacy Stage0–11 current-schema harness normalization', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      ACCEPTANCE_DATABASE_URL_ENV,
      ACCEPTANCE_DESTRUCTIVE_OK_ENV,
      'DATABASE_URL',
      'WEKONNEK_CURRENT_SCHEMA_REGRESSION',
    ]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('1: historical Stage4 acceptance still names wekonnek_stage4_test', () => {
    expect(() =>
      assertHistoricalStageDatabase('wekonnek_stage4_test', {
        label: 'Stage 4A',
        historicalDatabases: ['wekonnek_stage4_test'],
        historicalUsers: new Set(['wekonnek_stage4_test']),
        user: 'wekonnek_stage4_test',
      }),
    ).not.toThrow();
  });

  it('2: historical Stage4 rejects unrelated arbitrary DB', () => {
    expect(() =>
      assertHistoricalStageDatabase('wekonnek_stage12_terra_x', {
        label: 'Stage 4A',
        historicalDatabases: ['wekonnek_stage4_test'],
      }),
    ).toThrow(/historical acceptance requires database/);
  });

  it('3: Stage4 current-schema accepts explicit fresh disposable override', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_cursor_regression_test';
    expect(applyAcceptanceDatabaseOverride()).toBe(
      'wekonnek_stage12_cursor_regression_test',
    );
    expect(getAcceptanceDatabaseTarget()).toBe(
      'wekonnek_stage12_cursor_regression_test',
    );
  });

  it('4: Stage5A historical mode remains protected', () => {
    expect(() =>
      assertHistoricalStageDatabase('wekonnek_stage12_test', {
        label: 'Stage 5A',
        historicalDatabases: ['wekonnek_stage5_test'],
      }),
    ).toThrow(/historical acceptance requires database/);
    expect(() =>
      assertHistoricalStageDatabase('wekonnek_stage5_test', {
        label: 'Stage 5A',
        historicalDatabases: ['wekonnek_stage5_test'],
      }),
    ).not.toThrow();
  });

  it('5: Stage5A current-schema mode accepts override', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage12_terra_regression_test';
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage12_terra_regression_test',
    );
  });

  it('6: Stage5B current-schema mode accepts override', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage12_terra_regression_test';
    expect(isStage12DisposableAcceptanceDatabase(
      resolveStage12ExpectedDatabase(),
    )).toBe(true);
  });

  it('7: Stage6 current-schema mode accepts override', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage12_cursor_regression_test';
    expect(getAcceptanceDatabaseTarget()).toBe(
      'wekonnek_stage12_cursor_regression_test',
    );
  });

  it('8b: Stage5B current-schema accepts Stage13B-1 disposable identity', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage13b1_repair_regression';
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage13b1_repair_regression',
    );
    expect(isStage12DisposableAcceptanceDatabase(
      'wekonnek_stage13b1_repair_regression',
    )).toBe(false);
  });

  it('8: Stage7–11 representative current-schema suites accept override', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage12_terra_final_test';
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage12_terra_final_test',
    );
    // Historical Stage7 name is not the current-schema target.
    expect(resolveStage12ExpectedDatabase()).not.toBe(STAGE7_ACCEPTANCE_DATABASE);
  });

  it('9: explicit override survives every relevant dotenv loader', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_terra_regression_test';
    const stage4 = resolve(__dirname, '../../.env.stage4.test');
    if (!existsSync(stage4)) {
      const snap = snapshotAcceptanceOverrideEnv();
      process.env.DATABASE_URL =
        'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage4_test';
      restoreAcceptanceOverrideEnv(snap);
      applyAcceptanceDatabaseOverride();
      expect(resolveStage12ExpectedDatabase()).toBe(
        'wekonnek_stage12_terra_regression_test',
      );
      return;
    }
    for (const f of [
      '.env.stage4.test',
      '.env.stage5.test',
      '.env.stage6.test',
      '.env.stage7.test',
      '.env.stage8.test',
      '.env.stage9.test',
      '.env.stage10.test',
      '.env.stage11.test',
      '.env.stage12.regression.test',
    ]) {
      if (!existsSync(resolve(__dirname, '../..', f))) continue;
      process.env[ACCEPTANCE_DATABASE_URL_ENV] =
        'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_terra_regression_test';
      process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
      process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
      expect(loadStageTestEnv(f)).toBe(true);
      expect(resolveStage12ExpectedDatabase()).toBe(
        'wekonnek_stage12_terra_regression_test',
      );
      expect(process.env.DATABASE_URL).toContain(
        'wekonnek_stage12_terra_regression_test',
      );
    }
  });

  it('10: Prisma/raw target agreement is expressible via shared resolve', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage12_cursor_regression_test';
    const target = getAcceptanceDatabaseTarget();
    const parsed = parseAcceptanceDatabaseUrl(
      process.env[ACCEPTANCE_DATABASE_URL_ENV]!,
    );
    expect(parsed.database).toBe(target);
  });

  it('11: missing destructive opt-in fails before destructive SQL', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    expect(() =>
      assertSafeDisposableAcceptanceDatabase(
        'wekonnek_stage12_cursor_regression_test',
        'neg',
      ),
    ).toThrow(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
  });

  it('12: production/dev/postgres/template DB rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    for (const db of [
      'postgres',
      'template0',
      'template1',
      'wekonnek_prod',
      'wekonnek_dev',
      'wekonnek',
    ]) {
      expect(() => assertSafeStage12AcceptanceDatabase(db, 'neg')).toThrow(
        /permanently forbidden|not an approved/,
      );
    }
  });

  it('13: known historical DB cannot be current-schema acceptance target', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage4_test';
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(
      /permanently forbidden|not an approved/,
    );
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@127.0.0.1:5432/wekonnek_stage11_test';
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(
      /permanently forbidden|not an approved/,
    );
  });

  it('14: unknown arbitrary DB rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase('wekonnek_random_db', 'neg'),
    ).toThrow(/not an approved/);
    expect(isStage12DisposableAcceptanceDatabase('wekonnek_stage12_other')).toBe(
      false,
    );
  });

  it('15: no credential-bearing URL appears in error/redaction output', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://user:SuperSecretPass@127.0.0.1:5432/wekonnek_stage12_cursor_x',
    );
    expect(redacted).not.toContain('SuperSecretPass');
    expect(redacted).toContain('***');
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:SuperSecretPass@127.0.0.1:5432/wekonnek_stage4_test';
    try {
      applyAcceptanceDatabaseOverride();
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain('SuperSecretPass');
    }
  });

  it('default tip regression target without override', () => {
    delete process.env.DATABASE_URL;
    delete process.env[ACCEPTANCE_DATABASE_URL_ENV];
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(resolveStage12ExpectedDatabase()).toBe(
      STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
    );
    expect(STAGE12_ACCEPTANCE_DATABASE).toBe('wekonnek_stage12_test');
    expect(STAGE13A_ACCEPTANCE_DATABASE).toBe('wekonnek_stage13a_test');
  });
});
