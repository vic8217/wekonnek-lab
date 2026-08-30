/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
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
  it('reuses readiness rules when checking whether a source is operational', async () => {
    const ready = new PaymentPartnerConfigService(
      {} as never,
      {
        get: (key: string) => envValues[key],
      } as never,
    );
    jest.spyOn(ready, 'getActiveProvider').mockResolvedValue({
      providerCode: 'PAYCOOLS',
      environment: 'uat',
      defaultQrExpirySeconds: 600,
    });
    await expect(ready.isSourceOperational('RESTAURANT_ORDER')).resolves.toBe(
      true,
    );
    jest
      .spyOn(ready, 'getActiveProvider')
      .mockRejectedValue(new Error('unavailable'));
    await expect(ready.isSourceOperational('RESTAURANT_ORDER')).resolves.toBe(
      false,
    );
  });

  it('keeps UAT and production fallback configuration isolated', () => {
    expect((service as any).fallback('uat').baseUrl).toBe(
      'https://env-uat.test',
    );
    expect((service as any).fallback('production').baseUrl).toBe('');
  });
});

function completeEnvironmentRow(
  service: PaymentPartnerConfigService,
  overrides: Record<string, unknown> = {},
) {
  return {
    baseUrl: 'https://db.test',
    appId: 'db-id',
    appName: 'DB',
    encryptedMerchantPrivateKey: (service as any).encrypt('db-private'),
    encryptedCallbackSecret: (service as any).encrypt('db-secret'),
    channelCode: 'QRPH_DYNAMIC_QR',
    healthcheckUrl: '',
    ipWhitelistRequired: false,
    publicKeyRegistered: true,
    callbackRegistered: true,
    ipWhitelistConfirmed: false,
    ...overrides,
  };
}

function completePlatformConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    providerCode: 'PAYCOOLS',
    enabled: true,
    environment: 'uat',
    dynamicQrEnabled: true,
    defaultQrExpirySeconds: 600,
    uatLastConnectionTestSuccessful: null,
    uatLastConnectionTestAt: null,
    uatLastConnectionTestErrorCode: null,
    prodLastConnectionTestSuccessful: null,
    prodLastConnectionTestAt: null,
    prodLastConnectionTestErrorCode: null,
    sources: [{ sourceType: 'RESTAURANT_ORDER', enabled: true }],
    ...overrides,
  };
}

function serviceWithPrisma(
  config: Record<string, unknown>,
  row: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
) {
  return new PaymentPartnerConfigService(
    {
      paymentPartnerConfiguration: {
        upsert: jest.fn().mockResolvedValue(config),
      },
      payCoolsEnvironmentConfiguration: {
        upsert: jest.fn().mockResolvedValue(row),
      },
    } as never,
    {
      get: (key: string) => extraEnv[key] ?? envValues[key],
    } as never,
  );
}

describe('PaymentPartnerConfigService connection readiness', () => {
  const service = new PaymentPartnerConfigService(
    {} as never,
    { get: (key: string) => envValues[key] } as never,
  );

  it('does not treat CONNECTION_TEST as missing when healthcheck URL is blank', () => {
    const result = (service as any).readiness(
      completePlatformConfig(),
      completeEnvironmentRow(service),
      'uat',
    );
    expect(result.connection.status).toBe('NOT_APPLICABLE');
    expect(result.connection.healthcheckConfigured).toBe(false);
    expect(result.connection.detail).toBe('No healthcheck configured');
    expect(result.missing).not.toContain('CONNECTION_TEST');
    expect(result.ready).toBe(true);
    expect(result.operationallyActive).toBe(true);
  });

  it('treats whitespace-only healthcheck URL as not configured', () => {
    const result = (service as any).readiness(
      completePlatformConfig(),
      completeEnvironmentRow(service, { healthcheckUrl: '   ' }),
      'uat',
    );
    expect(result.connection.status).toBe('NOT_APPLICABLE');
    expect(result.missing).not.toContain('CONNECTION_TEST');
    expect(result.operationallyActive).toBe(true);
  });

  it('still requires a successful connection test when a healthcheck URL is configured', () => {
    const result = (service as any).readiness(
      completePlatformConfig(),
      completeEnvironmentRow(service, {
        healthcheckUrl: 'https://health.test',
      }),
      'uat',
    );
    expect(result.connection.status).toBe('READY_TO_TEST');
    expect(result.connection.healthcheckConfigured).toBe(true);
    expect(result.missing).toContain('CONNECTION_TEST');
    expect(result.ready).toBe(false);
    expect(result.operationallyActive).toBe(false);
  });

  it('treats a successful configured healthcheck as HEALTHY', () => {
    const result = (service as any).readiness(
      completePlatformConfig({
        uatLastConnectionTestSuccessful: true,
        uatLastConnectionTestAt: new Date('2026-08-30T00:00:00.000Z'),
      }),
      completeEnvironmentRow(service, {
        healthcheckUrl: 'https://health.test',
      }),
      'uat',
    );
    expect(result.connection.status).toBe('HEALTHY');
    expect(result.missing).not.toContain('CONNECTION_TEST');
    expect(result.operationallyActive).toBe(true);
  });

  it('keeps a failed configured healthcheck as ERROR and not operational', () => {
    const result = (service as any).readiness(
      completePlatformConfig({
        uatLastConnectionTestSuccessful: false,
        uatLastConnectionTestAt: new Date('2026-08-30T00:00:00.000Z'),
      }),
      completeEnvironmentRow(service, {
        healthcheckUrl: 'https://health.test',
      }),
      'uat',
    );
    expect(result.connection.status).toBe('ERROR');
    expect(result.missing).toContain('CONNECTION_TEST');
    expect(result.operationallyActive).toBe(false);
  });

  it('still requires the remaining readiness items when healthcheck URL is blank', () => {
    const result = (service as any).readiness(
      completePlatformConfig({ enabled: true, dynamicQrEnabled: false }),
      completeEnvironmentRow(service, {
        publicKeyRegistered: false,
        callbackRegistered: false,
        ipWhitelistRequired: true,
        ipWhitelistConfirmed: false,
      }),
      'uat',
    );
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'PUBLIC_KEY_REGISTRATION',
        'CALLBACK_REGISTRATION',
        'IP_WHITELIST',
        'DYNAMIC_QR',
      ]),
    );
    expect(result.missing).not.toContain('CONNECTION_TEST');
    expect(result.ready).toBe(false);
    expect(result.operationallyActive).toBe(false);
  });

  it('still requires credentials even when healthcheck URL is blank', () => {
    const isolated = new PaymentPartnerConfigService(
      {} as never,
      { get: () => undefined } as never,
    );
    const result = (isolated as any).readiness(
      completePlatformConfig(),
      {
        healthcheckUrl: '',
        publicKeyRegistered: true,
        callbackRegistered: true,
      },
      'production',
    );
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'BASE_URL',
        'APP_ID',
        'APP_NAME',
        'PRIVATE_KEY',
        'CALLBACK_SECRET',
      ]),
    );
    expect(result.missing).not.toContain('CONNECTION_TEST');
    expect(result.connection.status).toBe('NOT_APPLICABLE');
    expect(result.operationallyActive).toBe(false);
  });

  it('isolates UAT and production connection-test results', () => {
    const config = completePlatformConfig({
      uatLastConnectionTestSuccessful: true,
      uatLastConnectionTestAt: new Date('2026-08-30T00:00:00.000Z'),
      prodLastConnectionTestSuccessful: false,
      prodLastConnectionTestAt: new Date('2026-08-30T00:00:00.000Z'),
    });
    const row = completeEnvironmentRow(service, {
      healthcheckUrl: 'https://health.test',
    });
    const uat = (service as any).readiness(config, row, 'uat');
    const production = (service as any).readiness(config, row, 'production');
    expect(uat.connection.status).toBe('HEALTHY');
    expect(uat.operationallyActive).toBe(true);
    expect(production.connection.status).toBe('ERROR');
    expect(production.missing).toContain('CONNECTION_TEST');
    expect(production.operationallyActive).toBe(false);
  });

  it('does not apply a UAT healthcheck env fallback to production', () => {
    const withUatHealth = new PaymentPartnerConfigService(
      {} as never,
      {
        get: (key: string) =>
          key === 'PAYCOOLS_UAT_HEALTHCHECK_URL'
            ? 'https://uat-health.test'
            : envValues[key],
      } as never,
    );
    const uat = (withUatHealth as any).readiness(
      completePlatformConfig(),
      completeEnvironmentRow(withUatHealth, { healthcheckUrl: '' }),
      'uat',
    );
    const production = (withUatHealth as any).readiness(
      completePlatformConfig({ environment: 'production' }),
      completeEnvironmentRow(withUatHealth, { healthcheckUrl: '' }),
      'production',
    );
    expect(uat.connection.status).toBe('READY_TO_TEST');
    expect(uat.missing).toContain('CONNECTION_TEST');
    expect(production.connection.status).toBe('NOT_APPLICABLE');
    expect(production.missing).not.toContain('CONNECTION_TEST');
  });

  it('makes a source operational without a healthcheck once other readiness items pass', async () => {
    const config = completePlatformConfig();
    const row = completeEnvironmentRow(service);
    const operational = serviceWithPrisma(config, row);
    await expect(
      operational.getActiveProvider('RESTAURANT_ORDER'),
    ).resolves.toMatchObject({
      providerCode: 'PAYCOOLS',
      environment: 'uat',
    });
    await expect(
      operational.isSourceOperational('RESTAURANT_ORDER'),
    ).resolves.toBe(true);
  });

  it('still hides a source when a configured healthcheck has not passed', async () => {
    const operational = serviceWithPrisma(
      completePlatformConfig(),
      completeEnvironmentRow(service, {
        healthcheckUrl: 'https://health.test',
      }),
    );
    await expect(
      operational.getActiveProvider('RESTAURANT_ORDER'),
    ).rejects.toThrow('This payment method is currently unavailable');
    await expect(
      operational.isSourceOperational('RESTAURANT_ORDER'),
    ).resolves.toBe(false);
  });

  it('still hides a source when other readiness requirements fail', async () => {
    const blocked = serviceWithPrisma(
      completePlatformConfig({ dynamicQrEnabled: false }),
      completeEnvironmentRow(service, { publicKeyRegistered: false }),
    );
    await expect(blocked.isSourceOperational('RESTAURANT_ORDER')).resolves.toBe(
      false,
    );
  });

  it('does not invent a PayCools health endpoint when healthcheck URL is blank', async () => {
    const operational = serviceWithPrisma(
      completePlatformConfig(),
      completeEnvironmentRow(service),
    );
    await expect(operational.testConnection('actor-1')).rejects.toThrow(
      /documented PayCools health-check endpoint/,
    );
  });

  it('still hides a disabled source even when platform readiness is complete', async () => {
    const disabledSource = serviceWithPrisma(
      completePlatformConfig({
        sources: [{ sourceType: 'RESTAURANT_ORDER', enabled: false }],
      }),
      completeEnvironmentRow(service),
    );
    await expect(
      disabledSource.getActiveProvider('RESTAURANT_ORDER'),
    ).rejects.toThrow('This payment method is currently unavailable');
    await expect(
      disabledSource.isSourceOperational('RESTAURANT_ORDER'),
    ).resolves.toBe(false);
  });
});
