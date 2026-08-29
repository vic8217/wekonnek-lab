import { PaymentPartnerConfigService } from './payment-partner-config.service';

describe('PaymentPartnerConfigService Philippine QRPH credentials', () => {
  it('does not require a callback public key for UAT readiness credentials', () => {
    const values: Record<string, string> = {
      PAYCOOLS_UAT_BASE_URL: 'https://api-uat.paycools.com',
      PAYCOOLS_UAT_APP_ID: 'synthetic-app-id',
      PAYCOOLS_UAT_APP_NAME: 'Synthetic UAT App',
      PAYCOOLS_UAT_PRIVATE_KEY_BASE64: 'synthetic-private-key',
      PAYCOOLS_UAT_CALLBACK_SECRET: 'synthetic-callback-secret',
    };
    const service = new PaymentPartnerConfigService(
      {} as never,
      { get: (key: string) => values[key] } as never,
    );

    expect((service as any).credentials('uat')).toEqual({
      baseUrlConfigured: true,
      appIdConfigured: true,
      appNameConfigured: true,
      privateKeyConfigured: true,
      callbackSecretConfigured: true,
    });
  });
});
