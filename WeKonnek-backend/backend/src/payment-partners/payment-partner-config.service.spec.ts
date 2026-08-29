import { PaymentPartnerConfigService } from './payment-partner-config.service';

const envValues: Record<string, string> = {
  INTEGRATION_ENCRYPTION_KEY: 'test-encryption-key',
  PAYCOOLS_UAT_BASE_URL: 'https://env-uat.test',
  PAYCOOLS_UAT_APP_ID: 'env-uat-id',
  PAYCOOLS_UAT_APP_NAME: 'Env UAT',
  PAYCOOLS_UAT_PRIVATE_KEY_BASE64: 'env-private',
  PAYCOOLS_UAT_CALLBACK_SECRET: 'env-secret',
};

describe('PaymentPartnerConfigService PayCools DB configuration', () => {
  const service = new PaymentPartnerConfigService(
    {} as never,
    { get: (key: string) => envValues[key] } as never,
  );
  it('encrypts private keys and callback secrets at rest', () => {
    const privateKey = (service as any).encrypt('merchant-private-key');
    const callbackSecret = (service as any).encrypt('callback-secret');
    expect(privateKey).not.toContain('merchant-private-key');
    expect(callbackSecret).not.toContain('callback-secret');
    expect((service as any).decrypt(privateKey)).toBe('merchant-private-key');
    expect((service as any).decrypt(callbackSecret)).toBe('callback-secret');
  });
  it('uses the temporary environment fallback only for missing DB configuration', () => {
    expect((service as any).effective(null, 'uat')).toMatchObject({
      baseUrl: 'https://env-uat.test',
      appId: 'env-uat-id',
      usingEnvFallback: true,
    });
  });
  it('makes configured DB values take precedence over environment fallback', () => {
    const runtime = (service as any).effective(
      {
        baseUrl: 'https://db.test/',
        appId: 'db-id',
        appName: 'DB',
        encryptedMerchantPrivateKey: (service as any).encrypt('db-private'),
        encryptedCallbackSecret: (service as any).encrypt('db-secret'),
        channelCode: 'DB_CHANNEL',
        healthcheckUrl: 'https://health.test',
        ipWhitelistRequired: true,
      },
      'uat',
    );
    expect(runtime).toMatchObject({
      baseUrl: 'https://db.test',
      appId: 'db-id',
      privateKeyBase64: 'db-private',
      callbackSecret: 'db-secret',
      channelCode: 'DB_CHANNEL',
      usingEnvFallback: false,
    });
  });
  it('never includes encrypted values in the admin-safe response', () => {
    const encryptedPrivate = (service as any).encrypt('sensitive-key-material');
    const encryptedSecret = (service as any).encrypt(
      'sensitive-callback-material',
    );
    const safe = (service as any).safeEnvironment(
      {
        baseUrl: 'https://db.test',
        encryptedMerchantPrivateKey: encryptedPrivate,
        encryptedCallbackSecret: encryptedSecret,
      },
      'uat',
    );
    expect(safe).not.toHaveProperty('encryptedMerchantPrivateKey');
    expect(safe).not.toHaveProperty('encryptedCallbackSecret');
    expect(JSON.stringify(safe)).not.toContain(encryptedPrivate);
    expect(JSON.stringify(safe)).not.toContain(encryptedSecret);
    expect(safe).toMatchObject({
      privateKeyConfigured: true,
      callbackSecretConfigured: true,
    });
  });
  it('keeps UAT and production fallback configuration isolated', () => {
    expect((service as any).fallback('uat').baseUrl).toBe(
      'https://env-uat.test',
    );
    expect((service as any).fallback('production').baseUrl).toBe('');
  });
});
