/**
 * Stage13B-1 current-schema identity policy — fail-closed unit proofs.
 * Harness infrastructure only. Does not claim product freeze readiness.
 */
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  applyAcceptanceDatabaseOverride,
  assertHistoricalStageDatabase,
  assertSafeCurrentSchemaRegressionDatabase,
  assertSafeStage12AcceptanceDatabase,
  isCurrentSchemaDisposableDatabase,
  isSafeLocalAcceptanceHost,
  isStage12DisposableAcceptanceDatabase,
  parseAcceptanceDatabaseUrl,
  resolveStage12ExpectedDatabase,
  resolveStage13aExpectedDatabase,
} from './acceptance-database';
import {
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
  isStage13b1EphemeralDisposableDatabase,
} from './test-database-guard';

describe('Stage13B-1 current-schema disposable identity policy', () => {
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

  function enableCurrentSchema(url: string): void {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = url;
    process.env.NODE_ENV = 'test';
  }

  it('accepts canonical Stage13B-1 disposable current-schema DB', () => {
    enableCurrentSchema(
      `postgresql://victor@127.0.0.1:5432/${STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE}`,
    );
    expect(applyAcceptanceDatabaseOverride()).toBe(
      STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
    );
    expect(resolveStage12ExpectedDatabase()).toBe(
      STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
    );
    expect(resolveStage13aExpectedDatabase()).toBe(
      STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
    );
    expect(
      isCurrentSchemaDisposableDatabase(STAGE13B1_ACCEPTANCE_DATABASE),
    ).toBe(true);
    expect(
      isCurrentSchemaDisposableDatabase(
        STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
      ),
    ).toBe(true);
  });

  it('accepts independently named valid disposable current-schema DBs', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    for (const db of [
      'wekonnek_stage13b1_terra_test',
      'wekonnek_stage13b1_terra_regression',
      'wekonnek_stage13b1_repair_test',
      'wekonnek_stage13b1_repair_regression',
      'wekonnek_stage13b1_cursor_final_test',
    ]) {
      expect(isStage13b1EphemeralDisposableDatabase(db)).toBe(true);
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(true);
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'pos'),
      ).not.toThrow();
    }
  });

  it('historical Stage5B DB is accepted in historical mode', () => {
    expect(() =>
      assertHistoricalStageDatabase(STAGE7_ACCEPTANCE_DATABASE, {
        label: 'Stage 5B HTTP',
        historicalDatabases: [
          STAGE7_ACCEPTANCE_DATABASE,
          'wekonnek_stage7_regression_test',
        ],
        historicalUsers: new Set(['victor', STAGE7_ACCEPTANCE_DATABASE]),
        user: 'victor',
      }),
    ).not.toThrow();
  });

  it('wrong historical DB is rejected in historical mode', () => {
    expect(() =>
      assertHistoricalStageDatabase('wekonnek_stage13b1_terra_regression', {
        label: 'Stage 5B HTTP',
        historicalDatabases: [STAGE7_ACCEPTANCE_DATABASE],
      }),
    ).toThrow(/historical acceptance requires database/);
  });

  it('historical Stage12 gate does not admit Stage13B-1 names', () => {
    expect(
      isStage12DisposableAcceptanceDatabase(
        'wekonnek_stage13b1_terra_regression',
      ),
    ).toBe(false);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertSafeStage12AcceptanceDatabase(
        'wekonnek_stage13b1_repair_regression',
        'neg',
      ),
    ).toThrow(/not an approved Stage 12/);
  });

  it('production-like DB is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    for (const db of [
      'wekonnek_production',
      'wekonnek_prod',
      'wekonnek',
    ]) {
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(false);
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'neg'),
      ).toThrow(/permanently forbidden|not an approved/);
    }
  });

  it('generic development DB is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    for (const db of ['wekonnek_dev', 'wekonnek_development', 'wekonnek_lab']) {
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'neg'),
      ).toThrow(/permanently forbidden|not an approved/);
    }
  });

  it('postgres is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase('postgres', 'neg'),
    ).toThrow(/permanently forbidden/);
  });

  it('template DBs are rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase('template0', 'neg'),
    ).toThrow(/permanently forbidden/);
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase('template1', 'neg'),
    ).toThrow(/permanently forbidden/);
  });

  it('arbitrary wekonnek DB is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    for (const db of [
      'wekonnek_random',
      'wekonnek_stage13b1',
      'wekonnek_stage13b1_other',
      'wekonnek_stage13b1_prod_test',
      'wekonnek_stage13b1_production_regression',
    ]) {
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(false);
      expect(() =>
        assertSafeCurrentSchemaRegressionDatabase(db, 'neg'),
      ).toThrow(/not an approved|permanently forbidden/);
    }
  });

  it('current-schema flag absent → override rejected', () => {
    delete process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION;
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        'wekonnek_stage13b1_repair_regression',
        'neg',
      ),
    ).toThrow(/WEKONNEK_CURRENT_SCHEMA_REGRESSION=1/);
  });

  it('NODE_ENV != test is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
        'neg',
      ),
    ).toThrow(/NODE_ENV=test/);
    delete process.env.NODE_ENV;
    expect(() =>
      assertSafeCurrentSchemaRegressionDatabase(
        STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
        'neg',
      ),
    ).toThrow(/NODE_ENV=test/);
  });

  it('unsafe/remote connection is rejected', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] =
      'postgresql://u:s@db.example.com:5432/wekonnek_stage13b1_repair_regression';
    const parsed = parseAcceptanceDatabaseUrl(
      process.env[ACCEPTANCE_DATABASE_URL_ENV],
    );
    expect(isSafeLocalAcceptanceHost(parsed.host)).toBe(false);
    expect(() => applyAcceptanceDatabaseOverride()).toThrow(
      /not a local PostgreSQL target/,
    );
    expect(isSafeLocalAcceptanceHost('127.0.0.1')).toBe(true);
    expect(isSafeLocalAcceptanceHost('localhost')).toBe(true);
  });

  it('does not special-case the word terra versus other slots', () => {
    expect(isStage13b1EphemeralDisposableDatabase('wekonnek_stage13b1_terra_test')).toBe(
      true,
    );
    expect(
      isStage13b1EphemeralDisposableDatabase('wekonnek_stage13b1_repair_test'),
    ).toBe(true);
    expect(
      isStage13b1EphemeralDisposableDatabase('wekonnek_stage13b1_cursor_test'),
    ).toBe(true);
  });

  it('default tip without override remains Stage13A regression', () => {
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.NODE_ENV = 'test';
    expect(resolveStage12ExpectedDatabase()).toBe(
      STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
    );
  });
});
