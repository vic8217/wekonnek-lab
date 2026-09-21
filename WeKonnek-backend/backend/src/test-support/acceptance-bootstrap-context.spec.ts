/**
 * AppModule ConfigModule ignoreEnvFile predicate — no I/O, no PostgreSQL.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isExplicitAcceptanceBootstrapContext } from '../acceptance-bootstrap-context';

describe('isExplicitAcceptanceBootstrapContext', () => {
  const url =
    'postgresql://victor:secret@127.0.0.1:5432/wekonnek_stage15c_cursor_config_final_test';

  it('A: test + override + URL → true', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'test',
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: url,
      }),
    ).toBe(true);
  });

  it('B: production + override + URL → false', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'production',
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: url,
      }),
    ).toBe(false);
  });

  it('C: development + override + URL → false', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'development',
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: url,
      }),
    ).toBe(false);
  });

  it('D: unset NODE_ENV + override + URL → false', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: url,
      }),
    ).toBe(false);
  });

  it('E: test + no override + URL → false', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'test',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: url,
      }),
    ).toBe(false);
  });

  it('F: test + override + missing URL → false', () => {
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'test',
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
      }),
    ).toBe(false);
    expect(
      isExplicitAcceptanceBootstrapContext({
        NODE_ENV: 'test',
        WEKONNEK_ACCEPTANCE_DB_OVERRIDE: '1',
        WEKONNEK_ACCEPTANCE_DATABASE_URL: '   ',
      }),
    ).toBe(false);
  });

  it('G: empty env (normal production/dev) → false', () => {
    expect(isExplicitAcceptanceBootstrapContext({})).toBe(false);
  });
});

describe('AppModule ConfigModule uses the bounded bootstrap predicate', () => {
  const src = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');

  it('does not gate ignoreEnvFile on the override flag alone', () => {
    expect(src).not.toMatch(
      /ignoreEnvFile:\s*process\.env\.WEKONNEK_ACCEPTANCE_DB_OVERRIDE\s*===\s*['"]1['"]/,
    );
    expect(src).toContain('isExplicitAcceptanceBootstrapContext');
  });
});
