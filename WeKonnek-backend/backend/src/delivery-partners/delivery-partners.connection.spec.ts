import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryPartnersService } from './delivery-partners.service';
import { LalamoveClientService } from './lalamove-client.service';

describe('DeliveryPartnersService connection persistence', () => {
  const provider = {
    id: 'provider-id',
    code: 'LALAMOVE',
    name: 'Lalamove',
    enabled: false,
  };
  const configuration = {
    id: 'config-id',
    providerId: 'provider-id',
    environment: 'uat',
    availableFor: {},
  };
  const updateConfiguration = jest.fn();
  const createAudit = jest.fn();
  const prisma = {
    deliveryProvider: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
    deliveryProviderConfiguration: {
      upsert: jest.fn(),
      update: updateConfiguration,
    },
    deliveryProviderAuditLog: { create: createAudit },
  } as unknown as PrismaService;
  const client = {
    testConnection: jest.fn(),
  } as unknown as LalamoveClientService;
  const service = new DeliveryPartnersService(
    prisma,
    {} as ConfigService,
    client,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.deliveryProviderConfiguration.update = updateConfiguration;
    prisma.deliveryProviderAuditLog.create = createAudit;
    prisma.deliveryProvider.upsert = jest.fn().mockResolvedValue(provider);
    prisma.deliveryProvider.findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(provider);
    prisma.deliveryProviderConfiguration.upsert = jest
      .fn()
      .mockResolvedValue(configuration);
  });

  it('persists CONNECTED status, clears errors, and writes a safe audit event', async () => {
    client.testConnection = jest
      .fn()
      .mockResolvedValue({ ok: true, code: 'CONNECTED' });
    const result = await service.testLalamoveConnection('actor-id');
    expect(result).toMatchObject({ ok: true, status: 'CONNECTED' });
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledTimes(1);
  });

  it('persists sanitized FAILED status without updating last successful API time', async () => {
    client.testConnection = jest
      .fn()
      .mockResolvedValue({ ok: false, code: 'AUTHENTICATION_FAILED' });
    const result = await service.testLalamoveConnection('actor-id');
    expect(result).toMatchObject({
      ok: false,
      status: 'FAILED',
      code: 'AUTHENTICATION_FAILED',
    });
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledTimes(1);
  });
});
