/**
 * Stage 12 acceptance harness isolation — unit + fail-closed safety proofs.
 * Does NOT claim Stage 12 product freeze readiness.
 */
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertSafeStage12AcceptanceDatabase,
  applyAcceptanceDatabaseOverride,
  getExplicitAcceptanceDatabaseUrl,
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
} from './test-database-guard';
import { loadStageTestEnv } from './load-stage-test-env';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('Stage 12 acceptance harness isolation', () => {
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

  it('A: default Stage12 expected DB is wekonnek_stage12_test', () => {
    expect(resolveStage12ExpectedDatabase()).toBe(STAGE12_ACCEPTANCE_DATABASE);
  });

  it('B: explicit Terra override wekonnek_stage12_terra_final_test is accepted', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_terra_final_test';
    expect(applyAcceptanceDatabaseOverride()).toBe(
      'wekonnek_stage12_terra_final_test',
    );
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage12_terra_final_test',
    );
    expect(process.env.DATABASE_URL).toContain(
      'wekonnek_stage12_terra_final_test',
    );
  });

  it('H: malformed override fails closed', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = 'not-a-url';
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(/malformed/);
  });

  it('H2: empty database path fails closed', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = 'postgresql://u:p@127.0.0.1:5432/';
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(/no database name/);
  });

  it('I: production-like DB name rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase('wekonnek_production', 'neg'),
    ).toThrow(/permanently forbidden|not an approved/);
    expect(() =>
      assertSafeStage12AcceptanceDatabase('wekonnek', 'neg'),
    ).toThrow(/permanently forbidden/);
  });

  it('J: postgres rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase('postgres', 'neg'),
    ).toThrow(/permanently forbidden/);
  });

  it('K: template0/template1 rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase('template0', 'neg'),
    ).toThrow(/permanently forbidden/);
    expect(() =>
      assertSafeStage12AcceptanceDatabase('template1', 'neg'),
    ).toThrow(/permanently forbidden/);
  });

  it('L: historical frozen Stage DB rejected', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    for (const db of [
      'wekonnek_stage9_test',
      'wekonnek_stage11_test',
      'wekonnek_stage11_regression_test',
      'wekonnek_stage0_test',
    ]) {
      expect(() => assertSafeStage12AcceptanceDatabase(db, 'neg')).toThrow(
        /permanently forbidden|not an approved/,
      );
      expect(ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(db)).toBe(true);
    }
  });

  it('M: missing destructive opt-in rejected for disposable target', () => {
    expect(() =>
      assertSafeStage12AcceptanceDatabase(
        'wekonnek_stage12_terra_harness_test',
        'neg',
      ),
    ).toThrow(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
  });

  it('N: explicit override survives dotenv loading', () => {
    const stagePath = resolve(__dirname, '../../.env.stage12.test');
    if (!existsSync(stagePath)) {
      // Without the stage file, still prove snapshot/restore semantics.
      process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
      process.env[ACCEPTANCE_DATABASE_URL_ENV] =
        'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_terra_final_test';
      process.env.DATABASE_URL =
        'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_test';
      const snap = snapshotAcceptanceOverrideEnv();
      process.env.DATABASE_URL =
        'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_test';
      process.env[ACCEPTANCE_DATABASE_URL_ENV] =
        'postgresql://evil:pw@127.0.0.1:5432/wekonnek_stage12_test';
      restoreAcceptanceOverrideEnv(snap);
      applyAcceptanceDatabaseOverride();
      expect(resolveStage12ExpectedDatabase()).toBe(
        'wekonnek_stage12_terra_final_test',
      );
      return;
    }

    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage12_terra_final_test';
    const ok = loadStageTestEnv('.env.stage12.test');
    expect(ok).toBe(true);
    expect(getExplicitAcceptanceDatabaseUrl()).toContain(
      'wekonnek_stage12_terra_final_test',
    );
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage12_terra_final_test',
    );
    // dotenv may have pointed at shared Stage12 DB; override must win.
    expect(process.env.DATABASE_URL).toContain(
      'wekonnek_stage12_terra_final_test',
    );
  });

  it('O: credentials are redacted in diagnostic URLs', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://user:SuperSecretPass@127.0.0.1:5432/wekonnek_stage12_terra_x',
    );
    expect(redacted).not.toContain('SuperSecretPass');
    expect(redacted).toContain('***');
    expect(redacted).toContain('wekonnek_stage12_terra_x');
  });

  it('negative safety: forbidden DB never reaches destructive allow', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:secret@127.0.0.1:5432/wekonnek_stage11_test';
    let destructiveSqlAttempted = false;
    const attemptDestructive = () => {
      destructiveSqlAttempted = true;
    };
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(
      /permanently forbidden|not an approved/,
    );
    // Gate failed before any caller could run TRUNCATE/DROP/migration.
    expect(destructiveSqlAttempted).toBe(false);
    expect(() => attemptDestructive()).not.toThrow();
    // Reset flag proof pattern: initialization must throw first.
    destructiveSqlAttempted = false;
    try {
      applyAcceptanceDatabaseOverride();
      attemptDestructive();
    } catch {
      /* expected */
    }
    expect(destructiveSqlAttempted).toBe(false);
  });

  it('canonical disposable names are recognized', () => {
    expect(isStage12DisposableAcceptanceDatabase(STAGE12_ACCEPTANCE_DATABASE)).toBe(
      true,
    );
    expect(
      isStage12DisposableAcceptanceDatabase(
        STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
      ),
    ).toBe(true);
    expect(
      isStage12DisposableAcceptanceDatabase('wekonnek_stage12_terra_abc'),
    ).toBe(true);
    expect(isStage12DisposableAcceptanceDatabase('wekonnek_stage12_other')).toBe(
      false,
    );
    expect(
      isStage12DisposableAcceptanceDatabase('wekonnek_stage13b1_terra_regression'),
    ).toBe(false);
    expect(
      isStage12DisposableAcceptanceDatabase('wekonnek_stage13b1_repair_test'),
    ).toBe(false);
  });

  it('parseAcceptanceDatabaseUrl extracts database name', () => {
    const p = parseAcceptanceDatabaseUrl(
      'postgresql://victor:pw@localhost:5432/wekonnek_stage12_terra_final_test',
    );
    expect(p.database).toBe('wekonnek_stage12_terra_final_test');
    expect(p.redactedUrl).not.toContain('pw');
  });
});
