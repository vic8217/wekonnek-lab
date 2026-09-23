/**
 * UCE-H0 disposable-name grammar. Unit-only. Does not create, drop, truncate,
 * or migrate databases.
 */
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertRuntimeDatabaseIdentityMatchesApproved,
  assertSafeCurrentSchemaRegressionDatabase,
  assertSafeLocalAcceptanceHost,
  isApprovedCurrentSchemaAcceptanceDatabase,
  isCurrentSchemaDisposableDatabase,
  isSafeLocalAcceptanceHost,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import { assertCurrentSchemaProvisionTarget } from './current-schema-disposable-provision';
import {
  STAGE12_ACCEPTANCE_DATABASE,
  assertDisposableCleanupDatabase,
  assertUceDisposableIdentity,
  isRecognizedCurrentSchemaDisposableName,
  isRecognizedUceDisposableName,
  assertRecognizedUceDisposableName,
} from './test-database-guard';

const POSITIVE_UCE_NAMES = [
  'wekonnek_uce1_cursor_test',
  'wekonnek_uce1_terra_test',
  'wekonnek_uce1b_cursor_test',
  'wekonnek_uce2_terra_test',
  'wekonnek_uce3a_cursor_test',
  'wekonnek_uce3a_terra_test',
  'wekonnek_uce3b_cursor_test',
  'wekonnek_uce4_terra_test',
  'wekonnek_uce5_cursor_test',
  'wekonnek_uce6_cursor_test',
  'wekonnek_uce7_terra_test',
  'wekonnek_uce_c1_cursor_test',
  'wekonnek_uce_h0_cursor_test',
  'wekonnek_uce_h1_terra_test',
] as const;

const NEGATIVE_UCE_NAMES = [
  'wekonnek_uce1',
  'wekonnek_uce1_test',
  'wekonnek_uce1_prod',
  'wekonnek_uce1_production',
  'wekonnek_uce1_cursor',
  'wekonnek_uce1_cursor_dev',
  'wekonnek_uce1_cursor_test_backup',
  'wekonnek_uce1_cursor_test_prod',
  'wekonnek_uce1_cursor_test2',
  'wekonnek_uce1_admin_test',
  'wekonnek_uce1_root_test',
  'wekonnek_uce999_cursor_test',
  'wekonnek_uce8_cursor_test',
  'wekonnek_uce3_cursor_test',
  'wekonnek_ucec1_cursor_test',
  'wekonnek_uceh1_terra_test',
  'wekonnek_uce_1_cursor_test',
  'WEKONNEK_UCE1_CURSOR_TEST',
  'wekonnek-uce1-cursor-test',
  'wekonnek_uce1_cursor_TEST',
  'wekonnek_uce1_cursor_test.extra',
  'wekonnek_uce1_cursor_test/anything',
  'wekonnek_uce1_cursor_test ',
  ' wekonnek_uce1_cursor_test',
  'postgres',
  'template0',
  'template1',
  'wekonnek',
  'wekonnek_prod',
  'wekonnek_production',
  'wekonnek_stage0_test',
  'wekonnek_stage3_test',
  'wekonnek_stage3_custody_uat',
  'wekonnek_stage6_test',
  'wekonnek_stage12_test',
  'wekonnek_stage15c_cursor_config_final_test',
] as const;

describe('UCE-H0 disposable database name grammar', () => {
  it('accepts only canonical wekonnek_uce{id}_{cursor|terra}_test names', () => {
    for (const db of POSITIVE_UCE_NAMES) {
      expect(isRecognizedUceDisposableName(db)).toBe(true);
      expect(() => assertRecognizedUceDisposableName(db, 'uce')).not.toThrow();
    }
  });

  it('rejects truncated, production-looking, executor-wrong, and extra-suffix names', () => {
    for (const db of NEGATIVE_UCE_NAMES) {
      expect(isRecognizedUceDisposableName(db)).toBe(false);
      expect(() => assertRecognizedUceDisposableName(db, 'uce')).toThrow(
        /not a recognized UCE disposable name/,
      );
    }
  });

  it('does not admit UCE names through the frozen current-schema grammar', () => {
    for (const db of POSITIVE_UCE_NAMES) {
      expect(isRecognizedCurrentSchemaDisposableName(db)).toBe(false);
      expect(isCurrentSchemaDisposableDatabase(db)).toBe(false);
    }
  });

  it('does not grant current-schema provision or cleanup from UCE name recognition', () => {
    const savedNode = process.env.NODE_ENV;
    const savedOk = process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    try {
      for (const db of [
        'wekonnek_uce1_cursor_test',
        'wekonnek_uce_h0_cursor_test',
      ] as const) {
        expect(() => assertCurrentSchemaProvisionTarget(db)).toThrow(
          /not a recognized current-schema disposable name/,
        );
        expect(() => assertDisposableCleanupDatabase(db)).toThrow(/cleanup refused/);
        expect(isApprovedCurrentSchemaAcceptanceDatabase(db)).toBe(false);
        expect(() =>
          assertSafeCurrentSchemaRegressionDatabase(db, 'uce'),
        ).toThrow();
      }
    } finally {
      if (savedNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNode;
      if (savedOk === undefined) delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
      else process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = savedOk;
    }
  });

  it('preserves existing current-schema disposable names exactly', () => {
    expect(
      isRecognizedCurrentSchemaDisposableName('wekonnek_stage13b2_cursor_test'),
    ).toBe(true);
    expect(
      isRecognizedCurrentSchemaDisposableName('wekonnek_stage14a_terra_test'),
    ).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_stage13b2_cursor_test')).toBe(
      false,
    );
    expect(isRecognizedUceDisposableName('wekonnek_stage14a_terra_test')).toBe(
      false,
    );
  });

  it('does not lift quarantined or historical names', () => {
    for (const db of [
      STAGE12_ACCEPTANCE_DATABASE,
      'wekonnek_stage3_custody_uat',
      'wekonnek_stage15c_cursor_config_final_test',
      'wekonnek_stage0_test',
      'wekonnek_stage6_test',
    ]) {
      expect(isRecognizedUceDisposableName(db)).toBe(false);
    }
    expect(ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has('postgres')).toBe(true);
    expect(ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has('template0')).toBe(true);
    expect(ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has('template1')).toBe(true);
    expect(ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has('wekonnek_stage0_test')).toBe(
      true,
    );
  });

  it('name matching does not substitute for local host / production firewall', () => {
    expect(isSafeLocalAcceptanceHost('127.0.0.1')).toBe(true);
    expect(isSafeLocalAcceptanceHost('localhost')).toBe(true);
    expect(isSafeLocalAcceptanceHost('db.prod.example.com')).toBe(false);
    expect(isSafeLocalAcceptanceHost('10.0.0.8')).toBe(false);
    const remote = parseAcceptanceDatabaseUrl(
      'postgresql://u:p@db.prod.example.com:5432/wekonnek_uce1_cursor_test',
    );
    expect(remote.database).toBe('wekonnek_uce1_cursor_test');
    expect(isRecognizedUceDisposableName(remote.database)).toBe(true);
    expect(() =>
      assertSafeLocalAcceptanceHost(remote, 'uce'),
    ).toThrow(/not a local PostgreSQL target/);
  });

  it('requires live current_database() to equal the approved UCE name', () => {
    assertUceDisposableIdentity(
      { database: 'wekonnek_uce1_cursor_test', user: 'wekonnek' },
      'wekonnek_uce1_cursor_test',
      'uce',
    );
    expect(() =>
      assertUceDisposableIdentity(
        { database: 'postgres', user: 'wekonnek' },
        'wekonnek_uce1_cursor_test',
        'uce',
      ),
    ).toThrow(/current_database=postgres/);
    expect(() =>
      assertUceDisposableIdentity(
        { database: 'wekonnek_uce1_cursor_test', user: 'wekonnek' },
        'wekonnek_uce1_cursor_test_backup',
        'uce',
      ),
    ).toThrow(/not a recognized UCE disposable name/);
    expect(() =>
      assertRuntimeDatabaseIdentityMatchesApproved(
        'wekonnek_stage12_test',
        'wekonnek_uce1_cursor_test',
        'uce',
      ),
    ).toThrow(/does not match approved/);
  });
});
