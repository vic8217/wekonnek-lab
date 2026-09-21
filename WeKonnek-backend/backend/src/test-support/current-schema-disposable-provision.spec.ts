/**
 * Fail-closed unit proofs for current-schema disposable provisioning.
 * No live PostgreSQL. Does not create wekonnek_stage13b3_test.
 */
import {
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
} from './acceptance-database';
import {
  CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES,
  CURRENT_SCHEMA_POST_TEMPLATE_MIGRATION_PROBES,
  assertAdminConnectionIsLocal,
  assertCurrentSchemaProvisionTarget,
  listPrismaMigrationNames,
  quotePgIdent,
  selectCurrentSchemaTemplate,
} from './current-schema-disposable-provision';
import { isRecognizedCurrentSchemaDisposableName } from './test-database-guard';

describe('current-schema disposable provision policy', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['NODE_ENV', ACCEPTANCE_DESTRUCTIVE_OK_ENV]) {
      saved[k] = process.env[k];
    }
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('accepts Stage13B-3B / Terra grammar-valid names', () => {
    for (const db of [
      'wekonnek_stage13b3_b_cursor_test',
      'wekonnek_stage13b3_b_cursor_regression_test',
      'wekonnek_stage13b3_b_cursor_repro_test',
      'wekonnek_stage13b3_b_terra_test',
    ]) {
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(true);
      expect(() => assertCurrentSchemaProvisionTarget(db)).not.toThrow();
    }
  });

  it('never lists wekonnek_stage13b3_test as a template candidate', () => {
    expect(CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES).toEqual([
      'wekonnek_stage13b2_test',
      'wekonnek_stage13b1_test',
      'wekonnek_stage13a_test',
      'wekonnek_stage12_test',
    ]);
    expect(CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES).not.toContain(
      'wekonnek_stage13b3_test',
    );
  });

  it('selects wekonnek_stage13b2_test even if wekonnek_stage13b3_test exists', () => {
    expect(
      selectCurrentSchemaTemplate([
        'wekonnek_stage13b3_test',
        'wekonnek_stage13b3_cursor_test',
        'wekonnek_stage13b2_test',
        'wekonnek_stage6_test',
      ]),
    ).toBe('wekonnek_stage13b2_test');
  });

  it('does not use wekonnek_stage13b3_test when it is the only 13B-3 name present', () => {
    expect(() =>
      selectCurrentSchemaTemplate([
        'wekonnek_stage13b3_test',
        'wekonnek_stage6_test',
      ]),
    ).toThrow(/no canonical current-schema template parent/);
  });

  it('rejects historical, production-like, development-like, staging-like, and malformed names', () => {
    const denied = [
      'wekonnek_stage5b_test',
      'wekonnek_stage6_test',
      'wekonnek_stage13b3_prod_test',
      'wekonnek_stage13b3_production_test',
      'wekonnek_stage13b3_dev_test',
      'wekonnek_stage13b3_development_test',
      'wekonnek_stage13b3_staging_test',
      'wekonnek_stage13b3b_cursor_test',
      'wekonnek_stage13b3_b_terra',
      'postgres',
      'wekonnek',
    ];
    for (const db of denied) {
      expect(() => assertCurrentSchemaProvisionTarget(db)).toThrow(/provision refused/);
    }
  });

  it('rejects provisioning onto a canonical parent', () => {
    expect(() =>
      assertCurrentSchemaProvisionTarget('wekonnek_stage13b2_test'),
    ).toThrow(/canonical current-schema parent/);
  });

  it('rejects when NODE_ENV is not test or destructive opt-in is missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertCurrentSchemaProvisionTarget('wekonnek_stage13b3_b_terra_test'),
    ).toThrow(/NODE_ENV=test/);
    process.env.NODE_ENV = 'test';
    delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
    expect(() =>
      assertCurrentSchemaProvisionTarget('wekonnek_stage13b3_b_terra_test'),
    ).toThrow(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
  });

  it('quotes only safe identifiers', () => {
    expect(quotePgIdent('wekonnek_stage13b3_b_terra_test')).toBe(
      '"wekonnek_stage13b3_b_terra_test"',
    );
    expect(() => quotePgIdent('wekonnek_stage13b3;drop')).toThrow(/safe PostgreSQL/);
  });

  it('admits wekonnek_stage13b3_test as a disposable name but never as TEMPLATE', () => {
    expect(isRecognizedCurrentSchemaDisposableName('wekonnek_stage13b3_test')).toBe(
      true,
    );
    expect(() =>
      assertCurrentSchemaProvisionTarget('wekonnek_stage13b3_test'),
    ).not.toThrow();
    expect(selectCurrentSchemaTemplate(['wekonnek_stage13b2_test'])).toBe(
      'wekonnek_stage13b2_test',
    );
  });

  it('accepts Stage14A disposable names without using them as templates', () => {
    expect(isRecognizedCurrentSchemaDisposableName('wekonnek_stage14a_cursor_test')).toBe(
      true,
    );
    expect(isRecognizedCurrentSchemaDisposableName('wekonnek_stage14a_terra_test')).toBe(
      true,
    );
    expect(CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES).not.toContain(
      'wekonnek_stage14a_cursor_test',
    );
  });

  it('rejects unrecognized remote/non-local admin hosts without connecting', () => {
    expect(() =>
      assertAdminConnectionIsLocal(
        'postgresql://wekonnek@db.example.com:5432/postgres',
      ),
    ).toThrow(/not a local PostgreSQL target/);
    expect(() =>
      assertAdminConnectionIsLocal(
        'postgresql://wekonnek@127.0.0.1:5432/postgres',
      ),
    ).not.toThrow();
  });

  it('repository migration list includes frozen Stage15A and Stage15C', () => {
    const names = listPrismaMigrationNames();
    expect(names).toContain(
      '20260919120000_stage14a_financial_reconciliation_review',
    );
    expect(names).toContain(
      '20260921120000_stage15a_trusted_evidence_provenance',
    );
    expect(names).toContain(
      '20260921200000_stage15c_successor_chain_authority',
    );
    expect(
      Object.keys(CURRENT_SCHEMA_POST_TEMPLATE_MIGRATION_PROBES),
    ).toEqual(
      expect.arrayContaining([
        '20260919120000_stage14a_financial_reconciliation_review',
        '20260921120000_stage15a_trusted_evidence_provenance',
        '20260921200000_stage15c_successor_chain_authority',
      ]),
    );
  });
});
