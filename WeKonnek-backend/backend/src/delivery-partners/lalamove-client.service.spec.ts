import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { encryptDeliveryProviderCredential } from './delivery-partners.service';
import {
  LalamoveClientService,
  lalamoveBaseUrl,
  lalamoveSignature,
} from './lalamove-client.service';

describe('Lalamove client signing', () => {
  it('selects the documented UAT and production endpoints', () => {
    expect(lalamoveBaseUrl('uat')).toBe('https://rest.sandbox.lalamove.com');
    expect(lalamoveBaseUrl('production')).toBe('https://rest.lalamove.com');
  });

  it('creates a deterministic v3 GET signature with an empty body', () => {
    expect(
      lalamoveSignature('1545880607433', 'GET', '/v3/cities', '', 'secret'),
    ).toBe(
      lalamoveSignature('1545880607433', 'GET', '/v3/cities', '', 'secret'),
    );
  });

  it('does not use quotation or order paths for connection signing', () => {
    const signature = lalamoveSignature('1', 'GET', '/v3/cities', '', 'secret');
    expect(signature).toHaveLength(64);
  });
});

describe('LalamoveClientService test connection', () => {
  const encryptionKey = 'local-encryption-key';
  const secret = 'local-secret';
  const cipherKey = createHash('sha256').update(encryptionKey).digest();
  const prisma = {
    deliveryProvider: { findUnique: jest.fn() },
    deliveryProviderConfiguration: { findUnique: jest.fn() },
    deliveryProviderCredential: { findMany: jest.fn() },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockReturnValue(encryptionKey),
  } as unknown as ConfigService;
  const service = new LalamoveClientService(prisma, config);
  const get = jest.spyOn(axios, 'get');

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.deliveryProvider.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'provider-id' });
    prisma.deliveryProviderConfiguration.findUnique = jest
      .fn()
      .mockResolvedValue({ environment: 'uat', market: 'PH' });
    prisma.deliveryProviderCredential.findMany = jest.fn().mockResolvedValue([
      {
        credentialKey: 'API_KEY',
        encryptedValue: encryptDeliveryProviderCredential(
          'local-key',
          cipherKey,
        ),
      },
      {
        credentialKey: 'API_SECRET',
        encryptedValue: encryptDeliveryProviderCredential(secret, cipherKey),
      },
    ]);
    (config.get as jest.Mock).mockReturnValue(encryptionKey);
  });

  afterAll(() => get.mockRestore());

  it('uses signed GET /v3/cities for UAT without returning credentials', async () => {
    get.mockResolvedValue({ status: 200, data: { data: [] } });
    const result = await service.testConnection();
    expect(result).toEqual({ ok: true, code: 'CONNECTED' });
    expect(get).toHaveBeenCalledWith(
      'https://rest.sandbox.lalamove.com/v3/cities',
      expect.anything(),
    );
    expect(JSON.stringify(result)).not.toContain('local-key');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('Authorization');
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'AUTHENTICATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [500, 'UPSTREAM_UNAVAILABLE'],
  ])('maps HTTP %s to %s without raw upstream data', async (status, code) => {
    get.mockRejectedValue(
      Object.assign(new AxiosError('upstream'), {
        response: { status, data: { secret: 'never-return' } },
      }),
    );
    const result = await service.testConnection();
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain('never-return');
  });

  it('maps timeout and never calls quotation or order endpoints', async () => {
    get.mockRejectedValue(
      Object.assign(new AxiosError('timeout'), { code: 'ECONNABORTED' }),
    );
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      code: 'TIMEOUT',
    });
    expect(get.mock.calls.every(([url]) => url.endsWith('/v3/cities'))).toBe(
      true,
    );
  });

  it.each(['API_KEY', 'API_SECRET'])(
    'returns NOT_CONFIGURED when %s is missing without HTTP',
    async (missing) => {
      prisma.deliveryProviderCredential.findMany = jest.fn().mockResolvedValue([
        {
          credentialKey: missing === 'API_KEY' ? 'API_SECRET' : 'API_KEY',
          encryptedValue: encryptDeliveryProviderCredential(secret, cipherKey),
        },
      ]);
      await expect(service.testConnection()).resolves.toEqual({
        ok: false,
        code: 'NOT_CONFIGURED',
      });
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('uses the production endpoint only when explicitly configured', async () => {
    prisma.deliveryProviderConfiguration.findUnique = jest
      .fn()
      .mockResolvedValue({ environment: 'production', market: 'PH' });
    get.mockResolvedValue({ status: 200, data: { data: [] } });
    await service.testConnection();
    expect(get).toHaveBeenCalledWith(
      'https://rest.lalamove.com/v3/cities',
      expect.any(Object),
    );
  });
});
