import {
  readAccuraMerchantAppUrl,
  validateAccuraHandoffRedirectUrl,
} from './accura-handoff';

describe('ACCURA merchant handoff URL config', () => {
  const env = (value?: string) => (key: string) =>
    key === 'ACCURA_MERCHANT_APP_URL' ? value : undefined;

  it('accepts an origin and keeps it separate from API base URL', () => {
    expect(
      readAccuraMerchantAppUrl(env('https://merchant.example.test/app')),
    ).toBe('https://merchant.example.test');
    expect(readAccuraMerchantAppUrl(env('not-a-url'))).toBeNull();
    expect(
      readAccuraMerchantAppUrl(env('ftp://merchant.example.test')),
    ).toBeNull();
  });

  it('requires HTTPS in production', () => {
    expect(
      readAccuraMerchantAppUrl(env('http://localhost:3001'), 'development'),
    ).toBe('http://localhost:3001');
    expect(
      readAccuraMerchantAppUrl(
        env('http://merchant.example.test'),
        'production',
      ),
    ).toBeNull();
    expect(
      readAccuraMerchantAppUrl(
        env('https://merchant.example.test'),
        'production',
      ),
    ).toBe('https://merchant.example.test');
  });

  it('accepts only COMPLETE_SETUP consume URLs with a code query', () => {
    const origin = 'https://merchant.example.test';
    const valid =
      'https://merchant.example.test/handoff/complete-setup?code=abcdefghijklmnopqrstuvwxyz0123456789-_ABC';
    expect(validateAccuraHandoffRedirectUrl(valid, origin)).toBe(valid);
    expect(
      validateAccuraHandoffRedirectUrl(
        'https://evil.example/handoff/complete-setup?code=abcdefghijklmnopqrstuvwxyz012345',
        origin,
      ),
    ).toBeNull();
    expect(
      validateAccuraHandoffRedirectUrl(
        'https://merchant.example.test/setup?code=abcdefghijklmnopqrstuvwxyz012345',
        origin,
      ),
    ).toBeNull();
    expect(
      validateAccuraHandoffRedirectUrl(
        'https://merchant.example.test/handoff/complete-setup?code=short',
        origin,
      ),
    ).toBeNull();
    expect(
      validateAccuraHandoffRedirectUrl(
        'https://merchant.example.test/handoff/complete-setup?code=abcdefghijklmnopqrstuvwxyz012345&next=/admin',
        origin,
      ),
    ).toBeNull();
    expect(
      validateAccuraHandoffRedirectUrl(
        'https://user:secret@merchant.example.test/handoff/complete-setup?code=abcdefghijklmnopqrstuvwxyz012345',
        origin,
      ),
    ).toBeNull();
  });
});
