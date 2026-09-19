/**
 * Stage13B-2 current-schema identity policy — fail-closed unit proofs.
 */
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  applyAcceptanceDatabaseOverride,
  assertPrismaConnectedToStage13b1AcceptanceDb,
  assertSafeCurrentSchemaRegressionDatabase,
  assertSafeStage12AcceptanceDatabase,
  assertSafeStage13b1AcceptanceDatabase,
  assertSafeStage13b2AcceptanceDatabase,
  assertSuiteExpectedDatabase,
  isApprovedCurrentSchemaAcceptanceDatabase,
  isCurrentSchemaDisposableDatabase,
  isSafeLocalAcceptanceHost,
  isStage12DisposableAcceptanceDatabase,
  isStage13b2EphemeralDisposableDatabase,
  parseAcceptanceDatabaseUrl,
  resolveStage13b1ExpectedDatabase,
} from './acceptance-database';
import {
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B2_ACCEPTANCE_DATABASE,
  STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE,
  isRecognizedCurrentSchemaDisposableName,
} from './test-database-guard';

describe('Stage13B-2 current-schema disposable identity policy', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      ACCEPTANCE_DATABASE_URL_ENV,
      ACCEPTANCE_DESTRUCTIVE_OK_ENV,
      'DATABASE_URL',
      'WEKONNEK_CURRENT_SCHEMA_REGRESSION',
      'NODE_ENV',
    ]) {
      saved[k] = process.env[k];
    }
    delete process.env[ACCEPTANCE_DATABASE_URL_ENV];
    delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
    delete process.env.DATABASE_URL;
    delete process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function enableCurrentSchema(): void {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
  }

  it('accepts canonical Stage13B-2 disposable names', () => {
    expect(isCurrentSchemaDisposableDatabase(STAGE13B2_ACCEPTANCE_DATABASE)).toBe(
      true,
    );
    expect(
      isCurrentSchemaDisposableDatabase(
        STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE,
      ),
    ).toBe(true);
    enableCurrentSchema();
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE,
        'pos',
      ),
    ).not.toThrow();
  });

  it('accepts ephemeral Stage13B-2 slots including independent executor suffixes', () => {
    enableCurrentSchema();
    for (const db of [
      'wekonnek_stage13b2_test',
      'wekonnek_stage13b2_regression',
      'wekonnek_stage13b2_regression_test',
      'wekonnek_stage13b2_terra_test',
      'wekonnek_stage13b2_terra_regression',
      'wekonnek_stage13b2_terra_final_test',
      'wekonnek_stage13b2_terra_regression_final',
      'wekonnek_stage13b2_terra_final_regression',
      'wekonnek_stage13b2_cursor_regression',
      'wekonnek_stage13b2_cursor_repair_test',
      'wekonnek_stage13b2_cursor_repair_regression',
      'wekonnek_stage13b2_repair_test',
      'wekonnek_stage13b2_repair_regression',
    ]) {
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(true);
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(true);
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'pos'),
      ).not.toThrow();
      expect(isApprovedCurrentSchemaAcceptanceDatabase(db)).toBe(true);
    }
    expect(
      isStage13b2EphemeralDisposableDatabase('wekonnek_stage13b2_terra_test'),
    ).toBe(true);
  });

  it('Terra class: historical Stage13B-1 gate rejects Stage13B-2 terra DB', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage13b1AcceptanceDatabase(
        'wekonnek_stage13b2_terra_test',
        'Stage13B-1 postgres',
      ),
    ).toThrow(
      /Stage13B-1 postgres refused: database wekonnek_stage13b2_terra_test is not an approved Stage 13B-1 disposable acceptance target/,
    );
  });

  it('Terra class: current-schema Stage13B-1 suite gate accepts Stage13B-2 terra DB', () => {
    enableCurrentSchema();
    expect(() =>
      assertSuiteExpectedDatabase(
        'wekonnek_stage13b2_terra_test',
        'Stage13B-1 postgres',
        assertSafeStage13b1AcceptanceDatabase,
      ),
    ).not.toThrow();
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://victor@127.0.0.1:5432/wekonnek_stage13b2_terra_test';
    expect(resolveStage13b1ExpectedDatabase()).toBe(
      'wekonnek_stage13b2_terra_test',
    );
  });

  it('future Stage13B-3 / 13C current-schema names are admitted without editing frozen suites', () => {
    enableCurrentSchema();
    for (const db of [
      'wekonnek_stage13b3_test',
      'wekonnek_stage13b3_regression_test',
      'wekonnek_stage13b3_terra_test',
      'wekonnek_stage13b3_terra_regression_final',
      'wekonnek_stage13c_cursor_regression',
      'wekonnek_stage13c_cursor_final_test',
      'wekonnek_stage13c_independent_final_test',
    ]) {
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(true);
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(true);
      expect(() =>
        assertSuiteExpectedDatabase(
          db,
          'Stage13B-1 postgres',
          assertSafeStage13b1AcceptanceDatabase,
        ),
      ).not.toThrow();
    }
  });

  it('historical Stage13B-1 suite gate still rejects Stage13B-2 names when current-schema is off', () => {
    delete process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION;
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSuiteExpectedDatabase(
        'wekonnek_stage13b2_terra_test',
        'Stage13B-1 postgres',
        assertSafeStage13b1AcceptanceDatabase,
      ),
    ).toThrow(/not an approved Stage 13B-1/);
  });

  it('historical Stage12 gate does not admit Stage13B-2 names', () => {
    expect(
      isStage12DisposableAcceptanceDatabase(STAGE13B2_ACCEPTANCE_DATABASE),
    ).toBe(false);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase(
        'wekonnek_stage13b2_terra_test',
        'neg',
      ),
    ).toThrow(/not an approved Stage 12/);
  });

  it('frozen Stage13B-1 acceptance is not a Stage13B-2 historical target', () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage13b2AcceptanceDatabase(STAGE13B1_ACCEPTANCE_DATABASE, 'neg'),
    ).toThrow(/permanently forbidden|not an approved Stage 13B-2/);
  });

  it('rejects postgres, templates, production-like, arbitrary, and near-miss names', () => {
    enableCurrentSchema();
    for (const db of [
      'postgres',
      'template0',
      'template1',
      'wekonnek',
      'wekonnek_test',
      'wekonnek_regression',
      'wekonnek_dev',
      'wekonnek_development',
      'wekonnek_prod',
      'wekonnek_production',
      'wekonnek_live',
      'wekonnek_staging',
      'wekonnek_foo',
      'wekonnek_stage13b2',
      'wekonnek_stage13b2_final',
      'wekonnek_stage13b2_terra',
      'wekonnek_stage13b2_prod_test',
      'wekonnek_stage13b2_production_regression',
      'wekonnek_stage13b2_test_prod',
      'wekonnek_stage13b2_regression_prod',
      'wekonnek_stage13b2_production_regression_final',
      'wekonnek_stage13b2_live_test',
      'wekonnek_stage13b2_staging_regression',
      'wekonnek_stage13b2_dev_final_test',
      'wekonnek_stage7_test',
      'wekonnek_stage5b_test',
      'wekonnek_stage11_terra_test',
    ]) {
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(false);
      expect(isApprovedCurrentSchemaAcceptanceDatabase(db)).toBe(false);
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'neg'),
      ).toThrow(/permanently forbidden|not an approved/);
    }
  });

  it('missing NODE_ENV=test is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'production';
    expect(isApprovedCurrentSchemaAcceptanceDatabase('wekonnek_stage13b2_terra_test')).toBe(
      false,
    );
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        'wekonnek_stage13b2_terra_test',
        'neg',
      ),
    ).toThrow(/NODE_ENV=test/);
  });

  it('missing destructive opt-in is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
    process.env.NODE_ENV = 'test';
    expect(isApprovedCurrentSchemaAcceptanceDatabase('wekonnek_stage13b2_terra_test')).toBe(
      false,
    );
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        'wekonnek_stage13b2_terra_test',
        'neg',
      ),
    ).toThrow(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
  });

  it('missing current-schema flag is rejected', () => {
    delete process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION;
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    expect(isApprovedCurrentSchemaAcceptanceDatabase('wekonnek_stage13b2_terra_test')).toBe(
      false,
    );
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        'wekonnek_stage13b2_terra_test',
        'neg',
      ),
    ).toThrow(/WEKONNEK_CURRENT_SCHEMA_REGRESSION=1/);
  });

  it('remote PostgreSQL host is rejected', () => {
    enableCurrentSchema();
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@db.example.com:5432/wekonnek_stage13b2_terra_test';
    const parsed = parseAcceptanceDatabaseUrl(
      process.env[ACCEPTANCE_DATABASE_URL_ENV],
    );
    expect(isSafeLocalAcceptanceHost(parsed.host)).toBe(false);
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(
      /not a local PostgreSQL target/,
    );
  });

  it('identity mismatch between expected name and current_database() is rejected', async () => {
    enableCurrentSchema();
    const prisma = {
      $queryRaw: async () => [{ database: 'postgres', user: 'victor' }],
    } as never;
    await expect(
      assertPrismaConnectedToStage13b1AcceptanceDb(
        prisma,
        'wekonnek_stage13b2_repair_test',
        'mismatch',
      ),
    ).rejects.toThrow(/does not match expected disposable DB/);
  });

  it('does not special-case the word terra versus other slots', () => {
    expect(
      isStage13b2EphemeralDisposableDatabase('wekonnek_stage13b2_terra_test'),
    ).toBe(true);
    expect(
      isStage13b2EphemeralDisposableDatabase('wekonnek_stage13b2_repair_test'),
    ).toBe(true);
    expect(
      isStage13b2EphemeralDisposableDatabase('wekonnek_stage13b2_cursor_test'),
    ).toBe(true);
    expect(
      isRecognizedCurrentSchemaDisposableName('wekonnek_stage13b3_lab_test'),
    ).toBe(true);
    expect(
      isRecognizedCurrentSchemaDisposableName(
        'wekonnek_stage13b2_terra_regression_final',
      ),
    ).toBe(true);
    expect(
      isRecognizedCurrentSchemaDisposableName(
        'wekonnek_stage13b2_cursor_regression_final',
      ),
    ).toBe(true);
  });

  it('Terra exact identity wekonnek_stage13b2_terra_regression_final is accepted by general grammar', () => {
    enableCurrentSchema();
    const db = 'wekonnek_stage13b2_terra_regression_final';
    expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(true);
    expect(isCurrentSchemaDisposableDatabase(db)).toBe(true);
    expect(isApprovedCurrentSchemaAcceptanceDatabase(db)).toBe(true);
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(db, 'acceptance database override'),
    ).not.toThrow();
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      `postgresql://victor@127.0.0.1:5432/${db}`;
    expect(applyAcceptanceDatabaseOverride()).toBe(db);
    expect(resolveStage13b1ExpectedDatabase()).toBe(db);
  });

  it('token-boundary: contest/testing/mytest/regressionx are not acceptance markers', () => {
    enableCurrentSchema();
    for (const db of [
      'wekonnek_stage13b2_contest',
      'wekonnek_stage13b2_testing',
      'wekonnek_stage13b2_mytest',
      'wekonnek_stage13b2_regressionx',
      'wekonnek_stage13b2_terra_contest',
      'wekonnek_stage13b2_pretest_final',
    ]) {
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(false);
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(false);
    }
  });

  it('rejects malformed labels: empty, double separators, long, unsafe, uppercase', () => {
    enableCurrentSchema();
    const longLabel = `wekonnek_stage13b2_${'a'.repeat(26)}_test`;
    for (const db of [
      'wekonnek_stage13b2__test',
      'wekonnek_stage13b2_test_',
      'wekonnek_stage13b2__terra_test',
      'wekonnek_stage13b2_terra__test',
      longLabel,
      'wekonnek_stage13b2_terra-test',
      'wekonnek_stage13b2_Terra_test',
      'wekonnek_stage13b2_TEST',
      'wekonnek_stage13b2_terra.test',
      'wekonnek_stage13b2_terra/test',
    ]) {
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(false);
    }
  });

  it('historical Stage13B-1 still rejects Stage13B-2 terra_regression_final when current-schema is off', () => {
    delete process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION;
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSuiteExpectedDatabase(
        'wekonnek_stage13b2_terra_regression_final',
        'Stage13B-1 postgres',
        assertSafeStage13b1AcceptanceDatabase,
      ),
    ).toThrow(/not an approved Stage 13B-1/);
  });

  it('explicit current-schema override of *_regression_final is not rejected by the loader path', () => {
    enableCurrentSchema();
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://victor@127.0.0.1:5432/wekonnek_stage13b2_cursor_regression_final';
    expect(applyAcceptanceDatabaseOverride()).toBe(
      'wekonnek_stage13b2_cursor_regression_final',
    );
    expect(process.env.DATABASE_URL).toContain(
      'wekonnek_stage13b2_cursor_regression_final',
    );
  });
});
