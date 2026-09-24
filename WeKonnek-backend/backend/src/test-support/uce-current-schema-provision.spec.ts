/**
 * UCE-H1 provisioning policy. Unit-only. Does not create or drop databases.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertSafeLocalAcceptanceHost,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import { assertCurrentSchemaProvisionTarget } from './current-schema-disposable-provision';
import {
  isRecognizedCurrentSchemaDisposableName,
  isRecognizedUceDisposableName,
} from './test-database-guard';
import {
  UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES,
  UCE_FORBIDDEN_TEMPLATE_DATABASES,
  UCE_RESET_OK_ENV,
  assertUceProvisioningAllowed,
  assertUceResetAllowed,
  selectUceCurrentSchemaTemplate,
  uceSafeConnectionDiagnostics,
} from './uce-current-schema-provision';

describe('UCE-H1 current-schema UCE provision policy', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['NODE_ENV', ACCEPTANCE_DESTRUCTIVE_OK_ENV, UCE_RESET_OK_ENV]) {
      saved[k] = process.env[k];
    }
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    delete process.env[UCE_RESET_OK_ENV];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('reuses H0 recognition and does not duplicate UCE grammar in this module', () => {
    const src = readFileSync(join(__dirname, 'uce-current-schema-provision.ts'), 'utf8');
    expect(src).toContain('assertRecognizedUceDisposableName');
    expect(src).toContain('assertUceDisposableIdentity');
    expect(src).toContain("from './test-database-guard'");
    expect(src).not.toMatch(/wekonnek_uce\(\?:/);
    expect(isRecognizedUceDisposableName('wekonnek_uce1_cursor_test')).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_uce_h1_cursor_test')).toBe(
      true,
    );
    expect(
      isRecognizedCurrentSchemaDisposableName('wekonnek_uce1_cursor_test'),
    ).toBe(false);
    expect(
      isRecognizedCurrentSchemaDisposableName('wekonnek_uce_h1_cursor_test'),
    ).toBe(false);
  });

  it('allows recognized UCE-1 / H1 names when opt-in and NODE_ENV=test', () => {
    expect(() =>
      assertUceProvisioningAllowed('wekonnek_uce1_cursor_test'),
    ).not.toThrow();
    expect(() =>
      assertUceProvisioningAllowed('wekonnek_uce1_terra_test'),
    ).not.toThrow();
    expect(() =>
      assertUceProvisioningAllowed('wekonnek_uce_h1_cursor_test'),
    ).not.toThrow();
    expect(() =>
      assertCurrentSchemaProvisionTarget('wekonnek_uce1_cursor_test'),
    ).toThrow(/not a recognized current-schema disposable name/);
  });

  it('rejects invalid UCE names and system/quarantined identities', () => {
    for (const db of [
      'wekonnek_uce1',
      'wekonnek_uce1_cursor_test_backup',
      'postgres',
      'template0',
      'template1',
      'wekonnek_stage0_test',
      'wekonnek_stage3_custody_uat',
      'wekonnek_stage12_test',
      'wekonnek_stage15c_cursor_config_final_test',
      'wekonnek_stage13b2_cursor_test',
    ]) {
      expect(() => assertUceProvisioningAllowed(db)).toThrow(/uce provision refused|not a recognized UCE/);
    }
  });

  it('rejects when NODE_ENV is not test, opt-in is missing, or approved name differs', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertUceProvisioningAllowed('wekonnek_uce1_cursor_test'),
    ).toThrow(/NODE_ENV=test/);
    process.env.NODE_ENV = 'test';
    delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
    expect(() =>
      assertUceProvisioningAllowed('wekonnek_uce1_cursor_test'),
    ).toThrow(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    expect(() =>
      assertUceProvisioningAllowed(
        'wekonnek_uce1_cursor_test',
        'wekonnek_uce1_terra_test',
      ),
    ).toThrow(/does not match approved/);
  });

  it('does not authorize drop from H0 recognition alone', () => {
    expect(() =>
      assertUceResetAllowed('wekonnek_uce_h1_cursor_test'),
    ).toThrow(/WEKONNEK_UCE_RESET_OK=1/);
    process.env[UCE_RESET_OK_ENV] = '1';
    expect(() =>
      assertUceResetAllowed('wekonnek_uce_h1_cursor_test'),
    ).not.toThrow();
  });

  it('selects 13B-2/13B-1/13A templates and never Stage12 or quarantined DBs', () => {
    expect(UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES).toEqual([
      'wekonnek_stage13b2_test',
      'wekonnek_stage13b1_test',
      'wekonnek_stage13a_test',
    ]);
    expect(UCE_FORBIDDEN_TEMPLATE_DATABASES.has('wekonnek_stage12_test')).toBe(
      true,
    );
    expect(
      UCE_FORBIDDEN_TEMPLATE_DATABASES.has('wekonnek_stage3_custody_uat'),
    ).toBe(true);
    expect(
      UCE_FORBIDDEN_TEMPLATE_DATABASES.has(
        'wekonnek_stage15c_cursor_config_final_test',
      ),
    ).toBe(true);
    expect(
      selectUceCurrentSchemaTemplate([
        'wekonnek_stage12_test',
        'wekonnek_stage13b2_test',
        'wekonnek_stage3_custody_uat',
      ]),
    ).toBe('wekonnek_stage13b2_test');
    expect(() =>
      selectUceCurrentSchemaTemplate([
        'wekonnek_stage12_test',
        'wekonnek_stage6_test',
        'wekonnek_stage15c_cursor_config_final_test',
      ]),
    ).toThrow(/no accepted UCE current-schema template parent/);
  });

  it('rejects remote admin hosts without connecting', () => {
    expect(() =>
      assertSafeLocalAcceptanceHost(
        parseAcceptanceDatabaseUrl(
          'postgresql://wekonnek@db.prod.example.com:5432/wekonnek_uce_h1_cursor_test',
        ),
        'uce',
      ),
    ).toThrow(/not a local PostgreSQL target/);
    const local = parseAcceptanceDatabaseUrl(
      'postgresql://wekonnek@127.0.0.1:5432/postgres',
    );
    expect(() => assertSafeLocalAcceptanceHost(local, 'uce')).not.toThrow();
  });

  it('safe diagnostics omit passwords', () => {
    const diag = uceSafeConnectionDiagnostics(
      'postgresql://wekonnek:s3cret@127.0.0.1:5432/postgres',
      'wekonnek_uce_h1_cursor_test',
      { database: 'postgres', user: 'wekonnek' },
    );
    expect(JSON.stringify(diag)).not.toMatch(/s3cret/);
    expect(diag.host).toBe('127.0.0.1');
    expect(diag.port).toBe('5432');
    expect(diag.approvedDatabase).toBe('wekonnek_uce_h1_cursor_test');
    expect(diag.currentDatabase).toBe('postgres');
    expect(diag.currentUser).toBe('wekonnek');
  });
});
