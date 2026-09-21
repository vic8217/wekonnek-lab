/**
 * Stage15B explicit acceptance DB override — fail-closed harness proofs.
 * Does not connect to wekonnek_stage12_test.
 */
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DB_OVERRIDE_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  applyExplicitStage15bAcceptanceOverride,
  assertNotQuarantinedAcceptanceOverrideDatabase,
  assertRuntimeDatabaseIdentityMatchesApproved,
  isApprovedStage15bOverrideDatabase,
  isApprovedStage15cOverrideDatabase,
  loadDotenvIgnoringDatabaseAuthority,
  pinExplicitStage15bAcceptanceOverrideAfterDotenv,
  resolveStage12ExpectedDatabase,
} from './acceptance-database';
import { resolve } from 'path';
import {
  isStage15bAcceptanceDatabase,
  loadStage15bTestEnv,
  loadStageTestEnv,
} from './load-stage-test-env';

describe('Stage15B explicit acceptance DB override', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    ACCEPTANCE_DATABASE_URL_ENV,
    ACCEPTANCE_DESTRUCTIVE_OK_ENV,
    ACCEPTANCE_DB_OVERRIDE_ENV,
    'DATABASE_URL',
    'WEKONNEK_CURRENT_SCHEMA_REGRESSION',
    'TEST_DATABASE_URL',
    'TEST_DATABASE_ADMIN_URL',
    'NODE_ENV',
    'JWT_SECRET',
  ];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      if (k === 'NODE_ENV') process.env.NODE_ENV = 'test';
      else delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const approvedUrl =
    'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage15b_terra_regression_test';
  const historicalUrl =
    'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage12_test';

  function enableOverride(url: string | undefined) {
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DB_OVERRIDE_ENV] = '1';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    if (url !== undefined) process.env[ACCEPTANCE_DATABASE_URL_ENV] = url;
  }

  it('grammar admits Stage15B terra regression disposable names only', () => {
    expect(
      isApprovedStage15bOverrideDatabase(
        'wekonnek_stage15b_terra_regression_test',
      ),
    ).toBe(true);
    expect(
      isApprovedStage15bOverrideDatabase('wekonnek_stage15b_terra_test'),
    ).toBe(true);
    expect(isApprovedStage15bOverrideDatabase('wekonnek_stage12_test')).toBe(
      false,
    );
    expect(
      isApprovedStage15bOverrideDatabase('wekonnek_stage13b2_test'),
    ).toBe(false);
    expect(
      isApprovedStage15bOverrideDatabase('wekonnek_stage15a_cursor_test'),
    ).toBe(false);
    expect(isApprovedStage15bOverrideDatabase('wekonnek_production')).toBe(
      false,
    );
    expect(isApprovedStage15bOverrideDatabase('wekonnek_lab_test')).toBe(false);
    expect(
      isApprovedStage15bOverrideDatabase('wekonnek_stage15b_terra_regression_01'),
    ).toBe(false);
    expect(
      isApprovedStage15cOverrideDatabase('wekonnek_stage15c_cursor_test'),
    ).toBe(true);
    expect(
      isApprovedStage15cOverrideDatabase('wekonnek_stage15c_topology_audit'),
    ).toBe(false);
    expect(
      isApprovedStage15cOverrideDatabase('wekonnek_stage15b_cursor_test'),
    ).toBe(false);
  });

  it('historical env override: approved Stage15B URL survives .env.stage12.test', () => {
    enableOverride(approvedUrl);
    process.env.DATABASE_URL = approvedUrl;
    process.env.TEST_DATABASE_URL = historicalUrl;
    const db = pinExplicitStage15bAcceptanceOverrideAfterDotenv(() => {
      process.env.DATABASE_URL = historicalUrl;
      process.env[ACCEPTANCE_DATABASE_URL_ENV] = historicalUrl;
      process.env.TEST_DATABASE_URL = historicalUrl;
      process.env.TEST_DATABASE_ADMIN_URL = historicalUrl;
      process.env.JWT_SECRET = 'historical-jwt';
    });
    expect(db).toBe('wekonnek_stage15b_terra_regression_test');
    expect(process.env.DATABASE_URL).toBe(approvedUrl);
    expect(process.env[ACCEPTANCE_DATABASE_URL_ENV]).toBe(approvedUrl);
    expect(process.env.TEST_DATABASE_URL).toBeUndefined();
    expect(process.env.TEST_DATABASE_ADMIN_URL).toBeUndefined();
    expect(process.env.JWT_SECRET).toBe('historical-jwt');
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage15b_terra_regression_test',
    );
    expect(process.env.DATABASE_URL).not.toContain('wekonnek_stage12_test');
  });

  it('loadStageTestEnv pin: historical file cannot reroute Prisma', () => {
    enableOverride(approvedUrl);
    process.env.DATABASE_URL = approvedUrl;
    const ok = loadStageTestEnv('.env.stage12.test');
    expect(ok).toBe(true);
    expect(process.env.DATABASE_URL).toContain(
      'wekonnek_stage15b_terra_regression_test',
    );
    expect(process.env.DATABASE_URL).not.toContain('wekonnek_stage12_test');
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage15b_terra_regression_test',
    );
  });

  it('missing approved DB URL fails closed with no historical fallback', () => {
    enableOverride(undefined);
    process.env.DATABASE_URL = historicalUrl;
    expect(() => applyExplicitStage15bAcceptanceOverride()).toThrow(
      /absent|refuse historical/,
    );
    expect(() => loadStageTestEnv('.env.stage12.test')).toThrow(
      /absent|refuse historical/,
    );
    expect(process.env.DATABASE_URL).toBe(historicalUrl);
  });

  it('unsafe historical name fails closed before destructive work', () => {
    enableOverride(historicalUrl);
    let destructive = false;
    expect(() => {
      applyExplicitStage15bAcceptanceOverride();
      destructive = true;
    }).toThrow(/not an approved Stage15B|quarantined/);
    expect(destructive).toBe(false);

    enableOverride(
      'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage13b2_test',
    );
    expect(() => applyExplicitStage15bAcceptanceOverride()).toThrow(
      /not an approved Stage15B/,
    );
  });

  it('identity mismatch fails closed', () => {
    expect(() =>
      assertRuntimeDatabaseIdentityMatchesApproved(
        'wekonnek_stage12_test',
        'wekonnek_stage15b_terra_regression_test',
        'mismatch',
      ),
    ).toThrow(/does not match approved/);
    expect(() =>
      assertRuntimeDatabaseIdentityMatchesApproved(
        null,
        'wekonnek_stage15b_terra_regression_test',
        'mismatch',
      ),
    ).toThrow(/empty/);
    expect(() =>
      assertRuntimeDatabaseIdentityMatchesApproved(
        'wekonnek_stage15b_terra_regression_test',
        'wekonnek_stage15b_terra_regression_test',
        'mismatch',
      ),
    ).not.toThrow();
  });

  it('historical Stage12 mode remains available without the override flag', () => {
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(process.env[ACCEPTANCE_DB_OVERRIDE_ENV]).toBeUndefined();
    expect(resolveStage12ExpectedDatabase()).toBe('wekonnek_stage12_test');
  });

  const stage15cUrl =
    'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage15c_cursor_repair_test';
  const stage15bUrl = approvedUrl;

  it('A: Stage15B frozen loader + explicit override + safe Stage15C DB accepts', () => {
    enableOverride(stage15cUrl);
    process.env.DATABASE_URL = stage15cUrl;
    const ok = loadStageTestEnv('.env.stage15b.test');
    expect(ok).toBe(true);
    expect(process.env.DATABASE_URL).toBe(stage15cUrl);
    expect(
      isStage15bAcceptanceDatabase('wekonnek_stage15c_cursor_repair_test'),
    ).toBe(true);
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage15c_cursor_repair_test',
    );
  });

  it('B: Stage15B loader + Stage15C DB without explicit override fail-closed', () => {
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.DATABASE_URL = stage15cUrl;
    expect(
      isStage15bAcceptanceDatabase('wekonnek_stage15c_cursor_repair_test'),
    ).toBe(false);
    const ok = loadStage15bTestEnv();
    if (ok) {
      const db = process.env.DATABASE_URL
        ? process.env.DATABASE_URL
        : '';
      expect(db).not.toContain('wekonnek_stage15c_cursor_repair_test');
    }
  });

  it('C: explicit override + wekonnek_stage12_test rejects', () => {
    enableOverride(historicalUrl);
    expect(() => applyExplicitStage15bAcceptanceOverride()).toThrow(
      /not an approved Stage15B|quarantined/,
    );
  });

  it('D: explicit override + arbitrary foo_test rejects', () => {
    enableOverride('postgresql://victor:secret@127.0.0.1:5432/foo_test');
    expect(() => applyExplicitStage15bAcceptanceOverride()).toThrow(
      /not an approved Stage15B/,
    );
  });

  it('E: approved Stage15C URL survives historical Stage15B dotenv', () => {
    enableOverride(stage15cUrl);
    process.env.DATABASE_URL = stage15cUrl;
    const db = pinExplicitStage15bAcceptanceOverrideAfterDotenv(() => {
      process.env.DATABASE_URL = stage15bUrl;
      process.env[ACCEPTANCE_DATABASE_URL_ENV] = stage15bUrl;
    });
    expect(db).toBe('wekonnek_stage15c_cursor_repair_test');
    expect(process.env.DATABASE_URL).toBe(stage15cUrl);
    expect(process.env[ACCEPTANCE_DATABASE_URL_ENV]).toBe(stage15cUrl);
  });

  it('F: approved URL DB A vs current_database DB B rejects', () => {
    expect(() =>
      assertRuntimeDatabaseIdentityMatchesApproved(
        'wekonnek_stage15c_cursor_test',
        'wekonnek_stage15c_cursor_repair_test',
        'mismatch',
      ),
    ).toThrow(/does not match approved/);
  });

  const finalRegressionUrl =
    'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage15c_cursor_final_regression_test';

  it('Stage12 dotenv cannot redirect an approved Stage15C final regression DB', () => {
    enableOverride(finalRegressionUrl);
    process.env.DATABASE_URL = finalRegressionUrl;
    process.env.TEST_DATABASE_URL = historicalUrl;
    const ok = loadStageTestEnv('.env.stage12.test');
    expect(ok).toBe(true);
    expect(process.env.DATABASE_URL).toBe(finalRegressionUrl);
    expect(process.env[ACCEPTANCE_DATABASE_URL_ENV]).toBe(finalRegressionUrl);
    expect(process.env.DATABASE_URL).not.toContain('wekonnek_stage12_test');
    expect(process.env.TEST_DATABASE_URL).toBeUndefined();
    expect(resolveStage12ExpectedDatabase()).toBe(
      'wekonnek_stage15c_cursor_final_regression_test',
    );
  });

  it('historical Stage12 dotenv parser cannot write DATABASE_URL under override', () => {
    enableOverride(finalRegressionUrl);
    process.env.DATABASE_URL = finalRegressionUrl;
    loadDotenvIgnoringDatabaseAuthority(
      resolve(__dirname, '../../.env.stage12.test'),
    );
    expect(process.env.DATABASE_URL).toBe(finalRegressionUrl);
    expect(process.env.DATABASE_URL).not.toContain('wekonnek_stage12_test');
  });

  it('quarantined wekonnek_stage12_test override is rejected before any connection', () => {
    expect(() =>
      assertNotQuarantinedAcceptanceOverrideDatabase(
        'wekonnek_stage12_test',
        'quarantine',
      ),
    ).toThrow(/quarantined/);
    enableOverride(historicalUrl);
    expect(() => applyExplicitStage15bAcceptanceOverride()).toThrow(
      /quarantined|not an approved/,
    );
  });
});
