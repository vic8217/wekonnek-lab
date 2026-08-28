import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const LALAMOVE = 'LALAMOVE';
const PROVIDERS = [
  { code: LALAMOVE, name: 'Lalamove', providerType: 'THIRD_PARTY' },
  { code: 'HOPPHER', name: 'Hoppher', providerType: 'THIRD_PARTY' },
  { code: 'MERCHANT', name: 'Merchant Delivery', providerType: 'MERCHANT' },
];
const DEFAULT_AVAILABILITY = {
  RESTAURANT_ORDER: true,
  RETAIL_ORDER: true,
  GROCERY_ORDER: true,
  BAZAAR: false,
  SCHEDULED_DELIVERY: false,
};

@Injectable()
export class DeliveryPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // This is the same AES-256-GCM packed-value pattern used by Social Auth.
  private key() {
    const value = this.config.get<string>('INTEGRATION_ENCRYPTION_KEY');
    if (!value)
      throw new BadRequestException(
        'INTEGRATION_ENCRYPTION_KEY must be configured before saving provider secrets',
      );
    return createHash('sha256').update(value).digest();
  }
  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private async ensureProviders() {
    await Promise.all(
      PROVIDERS.map((provider) =>
        this.prisma.deliveryProvider.upsert({
          where: { code: provider.code },
          update: {},
          create: provider,
        }),
      ),
    );
  }
  private async lalamove() {
    await this.ensureProviders();
    const provider = await this.prisma.deliveryProvider.findUniqueOrThrow({
      where: { code: LALAMOVE },
    });
    const configuration =
      await this.prisma.deliveryProviderConfiguration.upsert({
        where: { providerId: provider.id },
        update: {},
        create: { providerId: provider.id, availableFor: DEFAULT_AVAILABILITY },
      });
    return { provider, configuration };
  }
  private async safeLalamove() {
    const { provider, configuration } = await this.lalamove();
    const credentials = await this.prisma.deliveryProviderCredential.findMany({
      where: { providerId: provider.id },
      select: { credentialKey: true },
    });
    const keys = new Set(
      credentials.map((credential) => credential.credentialKey),
    );
    return {
      provider: {
        code: provider.code,
        name: provider.name,
        enabled: provider.enabled,
      },
      configuration: {
        ...configuration,
        platformMarkup: configuration.platformMarkup.toString(),
        maximumCustomerFee:
          configuration.maximumCustomerFee?.toString() ?? null,
      },
      credentials: {
        apiKeyConfigured: keys.has('API_KEY'),
        apiSecretConfigured: keys.has('API_SECRET'),
      },
      connection: {
        status: 'NOT_TESTED',
        testedAt: null,
        message: 'Not Tested',
      },
    };
  }

  async list() {
    await this.ensureProviders();
    const providers = await this.prisma.deliveryProvider.findMany({
      orderBy: { name: 'asc' },
    });
    return {
      providers: providers.map((provider) => ({
        code: provider.code,
        name: provider.name,
        enabled: provider.enabled,
        status: provider.code === LALAMOVE ? 'NOT_TESTED' : 'COMING_SOON',
        configurable: provider.code === LALAMOVE,
      })),
    };
  }
  getLalamove() {
    return this.safeLalamove();
  }

  async updateLalamove(body: Record<string, unknown>, actorId: string) {
    const { provider, configuration } = await this.lalamove();
    const data: Prisma.DeliveryProviderConfigurationUpdateInput = {};
    const providerData: Prisma.DeliveryProviderUpdateInput = {};
    const changes: Record<string, unknown> = {};
    if (body.environment !== undefined) {
      if (body.environment !== 'uat' && body.environment !== 'production')
        throw new BadRequestException('Environment must be uat or production');
      if (
        body.environment === 'production' &&
        body.confirmation !== 'CONFIRM LALAMOVE CHANGE'
      )
        throw new BadRequestException(
          'Production environment changes require confirmation',
        );
      data.environment = body.environment;
      changes.environment = body.environment;
    }
    for (const key of [
      'enabled',
      'showAtCheckout',
      'automaticSelectionEnabled',
    ] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean')
          throw new BadRequestException(`${key} must be a boolean`);
        if (key === 'enabled') providerData.enabled = body[key];
        else data[key] = body[key];
        changes[key] = body[key];
      }
    }
    for (const key of ['platformMarkup', 'maximumCustomerFee'] as const)
      if (body[key] !== undefined) {
        if (body[key] === null && key === 'maximumCustomerFee') {
          data[key] = null;
          changes[key] = null;
          continue;
        }
        const value = new Prisma.Decimal(String(body[key]));
        if (value.isNegative() || !value.isFinite())
          throw new BadRequestException(`${key} must be a non-negative number`);
        data[key] = value;
        changes[key] = value.toString();
      }
    if (body.availableFor !== undefined) {
      if (
        !body.availableFor ||
        typeof body.availableFor !== 'object' ||
        Array.isArray(body.availableFor)
      )
        throw new BadRequestException('availableFor must be an object');
      data.availableFor = body.availableFor;
      changes.availableFor = body.availableFor;
    }
    if (!Object.keys(data).length && !Object.keys(providerData).length)
      throw new BadRequestException(
        'No delivery provider configuration changes supplied',
      );
    if (providerData.enabled === true) {
      const credentials = await this.prisma.deliveryProviderCredential.findMany(
        {
          where: { providerId: provider.id },
          select: { credentialKey: true },
        },
      );
      const keys = new Set(
        credentials.map((credential) => credential.credentialKey),
      );
      if (!keys.has('API_KEY') || !keys.has('API_SECRET'))
        throw new BadRequestException(
          'Save API key and API secret before enabling Lalamove',
        );
    }
    if (Object.keys(providerData).length)
      await this.prisma.deliveryProvider.update({
        where: { id: provider.id },
        data: providerData,
      });
    if (Object.keys(data).length)
      await this.prisma.deliveryProviderConfiguration.update({
        where: { id: configuration.id },
        data,
      });
    await this.prisma.deliveryProviderAuditLog.create({
      data: {
        providerId: provider.id,
        actorId,
        action: 'LALAMOVE_CONFIGURATION_UPDATED',
        changes: changes as Prisma.InputJsonValue,
      },
    });
    return this.safeLalamove();
  }

  async updateLalamoveCredentials(
    body: Record<string, unknown>,
    actorId: string,
  ) {
    const { provider } = await this.lalamove();
    const entries = [
      ['API_KEY', body.apiKey],
      ['API_SECRET', body.apiSecret],
    ] as const;
    const supplied = entries.filter(
      (entry): entry is readonly ['API_KEY' | 'API_SECRET', string] =>
        typeof entry[1] === 'string' && Boolean(entry[1].trim()),
    );
    if (!supplied.length)
      throw new BadRequestException(
        'Provide at least one non-empty credential',
      );
    await Promise.all(
      supplied.map(([credentialKey, value]) =>
        this.prisma.deliveryProviderCredential.upsert({
          where: {
            providerId_credentialKey: {
              providerId: provider.id,
              credentialKey,
            },
          },
          update: { encryptedValue: this.encrypt(value.trim()) },
          create: {
            providerId: provider.id,
            credentialKey,
            encryptedValue: this.encrypt(value.trim()),
          },
        }),
      ),
    );
    await this.prisma.deliveryProviderAuditLog.create({
      data: {
        providerId: provider.id,
        actorId,
        action: 'LALAMOVE_CREDENTIALS_UPDATED',
        changes: {
          apiKeyUpdated: supplied.some(([key]) => key === 'API_KEY'),
          apiSecretUpdated: supplied.some(([key]) => key === 'API_SECRET'),
        },
      },
    });
    return this.safeLalamove();
  }
}
