import { assertAccuraEnvironmentBinding, readAccuraEnv } from './accura-env';

describe('ACCURA environment binding', () => {
  it('reads ACCURA_ENV aliases', () => {
    expect(readAccuraEnv((k) => (k === 'ACCURA_ENV' ? 'uat' : undefined))).toBe(
      'UAT',
    );
    expect(
      readAccuraEnv((k) => (k === 'ACCURA_ENV' ? 'PRODUCTION' : undefined)),
    ).toBe('PRODUCTION');
    expect(readAccuraEnv(() => undefined)).toBeNull();
  });

  it('rejects Production env with UAT/sandbox API URL', () => {
    expect(
      assertAccuraEnvironmentBinding({
        env: 'PRODUCTION',
        apiBaseUrl: 'https://accura-sandbox.example.test',
        merchantAppUrl: 'https://merchant.example.test',
      }).ok,
    ).toBe(false);
  });

  it('rejects Production env with http API', () => {
    expect(
      assertAccuraEnvironmentBinding({
        env: 'PRODUCTION',
        apiBaseUrl: 'http://accura.example.test',
        merchantAppUrl: 'https://merchant.example.test',
      }),
    ).toMatchObject({ ok: false, reason: 'PRODUCTION_API_REQUIRES_HTTPS' });
  });

  it('accepts consistent UAT binding', () => {
    expect(
      assertAccuraEnvironmentBinding({
        env: 'UAT',
        apiBaseUrl: 'https://accura-sandbox.example.test',
        merchantAppUrl: 'http://localhost:3001',
      }),
    ).toMatchObject({ ok: true, env: 'UAT' });
  });

  it('rejects UAT env with production URL marker', () => {
    expect(
      assertAccuraEnvironmentBinding({
        env: 'UAT',
        apiBaseUrl: 'https://api.production.accura.example',
        merchantAppUrl: 'https://merchant.example.test',
      }).ok,
    ).toBe(false);
  });
});
