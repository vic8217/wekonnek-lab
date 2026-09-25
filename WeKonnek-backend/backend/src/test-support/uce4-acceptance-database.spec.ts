import { ACCEPTANCE_DESTRUCTIVE_OK_ENV } from './acceptance-database';
import { isRecognizedUceDisposableName } from './test-database-guard';
import {
  UCE4_LIVE_ENV,
  UCE4_TEST_DATABASE_URL_ENV,
  assertUce4LiveIdentity,
  assertUce4NonSuperuserRole,
  evaluateUce4AcceptanceGate,
  resolveUce4AcceptanceDatabase,
} from './uce4-acceptance-database';

const CURSOR_URL =
  'postgresql://victor@localhost/wekonnek_uce4_cursor_test?host=/var/run/postgresql';
const TERRA_URL =
  'postgresql://reviewer@127.0.0.1/wekonnek_uce4_terra_test';

function ready(url: string | undefined) {
  return {
    NODE_ENV: 'test',
    [UCE4_LIVE_ENV]: '1',
    [ACCEPTANCE_DESTRUCTIVE_OK_ENV]: '1',
    [UCE4_TEST_DATABASE_URL_ENV]: url,
  };
}

describe('UCE-4 acceptance database gate', () => {
  it('accepts the Cursor disposable and derives a local postgres admin URL', () => {
    const target = resolveUce4AcceptanceDatabase(CURSOR_URL);
    expect(target.database).toBe('wekonnek_uce4_cursor_test');
    expect(target.adminConnectionString).toContain('/postgres?');
    expect(isRecognizedUceDisposableName(target.database)).toBe(true);
  });

  it('accepts the Terra disposable', () => {
    const target = resolveUce4AcceptanceDatabase(TERRA_URL);
    expect(target.database).toBe('wekonnek_uce4_terra_test');
    expect(isRecognizedUceDisposableName('wekonnek_uce4_terra_test')).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_uce1_cursor_test')).toBe(true);
  });

  it('skips when no acceptance intent is present', () => {
    expect(evaluateUce4AcceptanceGate({})).toEqual({ mode: 'skip' });
  });

  it('refuses a missing URL when live acceptance is requested', () => {
    const gate = evaluateUce4AcceptanceGate(ready(undefined));
    expect(gate.mode).toBe('refuse');
    if (gate.mode === 'refuse') {
      expect(gate.reason).toMatch(/UCE4_TEST_DATABASE_URL is required/);
      expect(gate.reason).toMatch(/refuse to fall back/);
    }
  });

  it('refuses live acceptance without the destructive opt-in', () => {
    const gate = evaluateUce4AcceptanceGate({
      [UCE4_LIVE_ENV]: '1',
      [UCE4_TEST_DATABASE_URL_ENV]: CURSOR_URL,
    });
    expect(gate.mode).toBe('refuse');
    if (gate.mode === 'refuse') {
      expect(gate.reason).toMatch(/WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1/);
    }
  });

  it('refuses a URL when the live opt-in is absent', () => {
    const gate = evaluateUce4AcceptanceGate({
      [ACCEPTANCE_DESTRUCTIVE_OK_ENV]: '1',
      [UCE4_TEST_DATABASE_URL_ENV]: TERRA_URL,
    });
    expect(gate.mode).toBe('refuse');
    if (gate.mode === 'refuse') expect(gate.reason).toMatch(/WEKONNEK_UCE4_LIVE=1/);
  });

  it.each([
    'not-a-url',
    'http://localhost/wekonnek_uce4_cursor_test',
    'postgresql://localhost',
  ])('rejects malformed URL %s', (url) => {
    expect(() => resolveUce4AcceptanceDatabase(url)).toThrow(/malformed database URL/);
  });

  it.each([
    'postgresql://localhost/wekonnek_custom',
    'postgresql://localhost/wekonnek_uce1_cursor_test',
    'postgresql://localhost/wekonnek_uce4_cursor_test_backup',
    'postgresql://localhost/wekonnek_uce4_admin_test',
  ])('rejects arbitrary database %s', (url) => {
    expect(() => resolveUce4AcceptanceDatabase(url)).toThrow(/not an approved UCE-4 disposable/);
  });

  it.each([
    'postgresql://localhost/wekonnek_stage12_test',
    'postgresql://localhost/wekonnek_stage3_custody_uat',
    'postgresql://localhost/wekonnek_stage15c_cursor_config_final_test',
    'postgresql://localhost/wekonnek_stage5_test',
  ])('rejects historical database %s', (url) => {
    expect(() => resolveUce4AcceptanceDatabase(url)).toThrow(/not an approved UCE-4 disposable/);
  });

  it.each([
    'postgresql://localhost/wekonnek',
    'postgresql://localhost/wekonnek_prod',
    'postgresql://localhost/wekonnek_production',
    'postgresql://localhost/postgres',
    'postgresql://localhost/template0',
    'postgresql://localhost/template1',
  ])('rejects production-like database %s', (url) => {
    expect(() => resolveUce4AcceptanceDatabase(url)).toThrow(/not an approved UCE-4 disposable/);
  });

  it('rejects a remote host even when the database name is approved', () => {
    expect(() =>
      resolveUce4AcceptanceDatabase(
        'postgresql://victor@db.prod.example.com/wekonnek_uce4_cursor_test',
      ),
    ).toThrow(/not a local PostgreSQL target/);
  });

  it('rejects a live identity that does not match the configured target', () => {
    expect(() =>
      assertUce4LiveIdentity(
        { database: 'wekonnek_uce4_terra_test', user: 'victor' },
        'wekonnek_uce4_cursor_test',
      ),
    ).toThrow(/does not match approved UCE disposable wekonnek_uce4_cursor_test/);
  });

  it('accepts a live identity that matches the configured target', () => {
    expect(() =>
      assertUce4LiveIdentity(
        { database: 'wekonnek_uce4_cursor_test', user: 'victor' },
        'wekonnek_uce4_cursor_test',
      ),
    ).not.toThrow();
  });

  it('rejects a superuser and the postgres role', () => {
    expect(() =>
      assertUce4NonSuperuserRole({ user: 'victor', rolsuper: true }),
    ).toThrow(/superuser/);
    expect(() =>
      assertUce4NonSuperuserRole({ user: 'postgres', rolsuper: false }),
    ).toThrow(/non-superuser/);
    expect(() =>
      assertUce4NonSuperuserRole({ user: 'victor', rolsuper: false }),
    ).not.toThrow();
  });
});
