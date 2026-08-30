/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-base-to-string, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDER = 'PAYCOOLS';
const ENVIRONMENTS = ['uat', 'production'] as const;
type Environment = (typeof ENVIRONMENTS)[number];
const SOURCE_DEFAULTS: Record<string, boolean> = {
  RESTAURANT_ORDER: true,
  RETAIL_ORDER: true,
  ADVANCE_ORDER: true,
  TAKE_OUT: true,
  RESERVATION: true,
  MERCHANT_SUBSCRIPTION: true,
  DELIVERY_ORDER: false,
  SERVICE_BOOKING: false,
  BAZAAR_LISTING: false,
  PROPERTY_LISTING: false,
};
const MUTABLE_FIELDS = [
  'enabled',
  'environment',
  'dynamicQrEnabled',
  'defaultQrExpirySeconds',
  'refundEnabled',
  'payoutEnabled',
  'settlementMode',
] as const;
const ENV_FIELDS = [
  'baseUrl',
  'appId',
  'appName',
  'merchantPublicKey',
  'channelCode',
  'healthcheckUrl',
  'ipWhitelistRequired',
  'publicKeyRegistered',
  'callbackRegistered',
  'ipWhitelistConfirmed',
] as const;

@Injectable()
export class PaymentPartnerConfigService {
  constructor(
    private prisma: PrismaService,
    private env: ConfigService,
  ) {}
  private key() {
    const value = this.env.get<string>('INTEGRATION_ENCRYPTION_KEY');
    if (!value)
      throw new BadRequestException(
        'INTEGRATION_ENCRYPTION_KEY must be configured before saving PayCools secrets',
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
  private decrypt(value: string) {
    const [ivValue, tagValue, encrypted] = value.split('.');
    if (!ivValue || !tagValue || !encrypted)
      throw new BadRequestException('Stored PayCools secret is invalid');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
  private normalizeEnvironment(value: string): Environment {
    if (!ENVIRONMENTS.includes(value as Environment))
      throw new BadRequestException('Environment must be uat or production');
    return value as Environment;
  }
  private dbEnvironment(environment: Environment) {
    return environment === 'production' ? 'PRODUCTION' : 'UAT';
  }
  private prefix(environment: Environment) {
    return environment === 'production' ? 'PAYCOOLS_PROD' : 'PAYCOOLS_UAT';
  }
  private callbackUrls() {
    const base = (
      this.env.get<string>('PUBLIC_API_URL') || 'https://api.wekonnek.biz'
    ).replace(/\/$/, '');
    return { payment: `${base}/api/payments/callbacks/paycools/payment` };
  }
  private async ensureConfig() {
    return this.prisma.paymentPartnerConfiguration.upsert({
      where: { providerCode: PROVIDER },
      update: {},
      create: {
        providerCode: PROVIDER,
        enabled: false,
        environment: 'uat',
        dynamicQrEnabled: true,
        sources: {
          create: Object.entries(SOURCE_DEFAULTS).map(
            ([sourceType, enabled]) => ({
              providerCode: PROVIDER,
              sourceType,
              enabled,
            }),
          ),
        },
      },
      include: { sources: true, paycoolsEnvironments: true },
    });
  }
  private async ensureEnvironment(
    configurationId: string,
    environment: Environment,
  ) {
    return this.prisma.payCoolsEnvironmentConfiguration.upsert({
      where: {
        configurationId_environment: {
          configurationId,
          environment: this.dbEnvironment(environment),
        },
      },
      update: {},
      // Do not persist QRPH defaults merely by opening the admin page. The UI
      // may suggest them, but an administrator must explicitly save them.
      create: {
        configurationId,
        environment: this.dbEnvironment(environment),
        channelCode: '',
      },
    });
  }
  private fallback(environment: Environment) {
    const p = this.prefix(environment);
    return {
      baseUrl: (this.env.get<string>(`${p}_BASE_URL`) || '').replace(/\/$/, ''),
      appId: this.env.get<string>(`${p}_APP_ID`) || '',
      appName: this.env.get<string>(`${p}_APP_NAME`) || '',
      privateKeyBase64: this.env.get<string>(`${p}_PRIVATE_KEY_BASE64`) || '',
      callbackSecret: this.env.get<string>(`${p}_CALLBACK_SECRET`) || '',
      channelCode:
        this.env.get<string>(`${p}_CHANNEL_CODE`) || 'QRPH_DYNAMIC_QR',
      healthcheckUrl: this.env.get<string>(`${p}_HEALTHCHECK_URL`) || '',
      ipWhitelistRequired:
        this.env.get<string>(`${p}_IP_WHITELIST_REQUIRED`) === 'true',
    };
  }
  /** DB is primary. PAYCOOLS_<ENV>_* is a deprecated transition fallback for missing DB fields. */
  private effective(row: any, environment: Environment) {
    const fallback = this.fallback(environment);
    return {
      baseUrl: (row?.baseUrl || fallback.baseUrl).replace(/\/$/, ''),
      appId: row?.appId || fallback.appId,
      appName: row?.appName || fallback.appName,
      privateKeyBase64: row?.encryptedMerchantPrivateKey
        ? this.decrypt(row.encryptedMerchantPrivateKey)
        : fallback.privateKeyBase64,
      callbackSecret: row?.encryptedCallbackSecret
        ? this.decrypt(row.encryptedCallbackSecret)
        : fallback.callbackSecret,
      channelCode: row?.channelCode || fallback.channelCode,
      healthcheckUrl: row?.healthcheckUrl || fallback.healthcheckUrl,
      ipWhitelistRequired:
        row?.ipWhitelistRequired ?? fallback.ipWhitelistRequired,
      usingEnvFallback:
        !row?.baseUrl ||
        !row?.appId ||
        !row?.appName ||
        !row?.encryptedMerchantPrivateKey ||
        !row?.encryptedCallbackSecret,
    };
  }
  private appIdPreview(value: string) {
    if (!value) return '';
    return value.length <= 4 ? '••••' : `••••••••${value.slice(-4)}`;
  }
  private publicKeyFingerprint(value: string) {
    if (!value) return '';
    return createHash('sha256')
      .update(value, 'utf8')
      .digest('base64url')
      .slice(-12);
  }
  private safeEnvironment(
    row: any,
    environment: Environment,
    includeEditable = false,
  ) {
    const f = this.fallback(environment);
    return {
      environment,
      baseUrl: includeEditable ? row?.baseUrl || '' : undefined,
      appId: includeEditable ? row?.appId || '' : undefined,
      appIdPreview: this.appIdPreview(row?.appId || ''),
      appName: includeEditable ? row?.appName || '' : undefined,
      merchantPublicKey: includeEditable
        ? row?.merchantPublicKey || ''
        : undefined,
      merchantPublicKeyConfigured: Boolean(row?.merchantPublicKey),
      merchantPublicKeyFingerprint: this.publicKeyFingerprint(
        row?.merchantPublicKey || '',
      ),
      channelCode: includeEditable ? row?.channelCode || '' : undefined,
      healthcheckUrl: includeEditable ? row?.healthcheckUrl || '' : undefined,
      ipWhitelistRequired: row?.ipWhitelistRequired ?? false,
      publicKeyRegistered: row?.publicKeyRegistered ?? false,
      callbackRegistered: row?.callbackRegistered ?? false,
      ipWhitelistConfirmed: row?.ipWhitelistConfirmed ?? false,
      privateKeyConfigured: Boolean(
        row?.encryptedMerchantPrivateKey || f.privateKeyBase64,
      ),
      callbackSecretConfigured: Boolean(
        row?.encryptedCallbackSecret || f.callbackSecret,
      ),
      dbConfigurationComplete: Boolean(
        row?.baseUrl &&
        row?.appId &&
        row?.appName &&
        row?.encryptedMerchantPrivateKey &&
        row?.encryptedCallbackSecret,
      ),
      usingDeprecatedEnvFallback:
        !row?.baseUrl ||
        !row?.appId ||
        !row?.appName ||
        !row?.encryptedMerchantPrivateKey ||
        !row?.encryptedCallbackSecret,
      createdAt: row?.createdAt,
      updatedAt: row?.updatedAt,
    };
  }
  private readiness(config: any, row: any, environment: Environment) {
    const r = this.effective(row, environment);
    const credentials = {
      baseUrlConfigured: Boolean(r.baseUrl),
      appIdConfigured: Boolean(r.appId),
      appNameConfigured: Boolean(r.appName),
      privateKeyConfigured: Boolean(r.privateKeyBase64),
      callbackSecretConfigured: Boolean(r.callbackSecret),
    };
    const prefix = environment === 'production' ? 'prod' : 'uat';
    const successful = config[`${prefix}LastConnectionTestSuccessful`];
    const testAt = config[`${prefix}LastConnectionTestAt`];
    const connection = {
      status: !Object.values(credentials).every(Boolean)
        ? 'NOT_CONFIGURED'
        : successful === true
          ? 'HEALTHY'
          : testAt && successful === false
            ? 'ERROR'
            : 'READY_TO_TEST',
      lastConnectionTestAt: testAt,
      lastConnectionTestSuccessful: successful,
      lastConnectionTestErrorCode:
        config[`${prefix}LastConnectionTestErrorCode`],
    };
    const missing = [
      ...(!credentials.baseUrlConfigured ? ['BASE_URL'] : []),
      ...(!credentials.appIdConfigured ? ['APP_ID'] : []),
      ...(!credentials.appNameConfigured ? ['APP_NAME'] : []),
      ...(!credentials.privateKeyConfigured ? ['PRIVATE_KEY'] : []),
      ...(!credentials.callbackSecretConfigured ? ['CALLBACK_SECRET'] : []),
      ...(!row?.publicKeyRegistered ? ['PUBLIC_KEY_REGISTRATION'] : []),
      ...(!row?.callbackRegistered ? ['CALLBACK_REGISTRATION'] : []),
      ...(r.ipWhitelistRequired && !row?.ipWhitelistConfirmed
        ? ['IP_WHITELIST']
        : []),
      ...(connection.status !== 'HEALTHY' ? ['CONNECTION_TEST'] : []),
      ...(!config.dynamicQrEnabled ? ['DYNAMIC_QR'] : []),
    ];
    return {
      credentials,
      connection,
      missing,
      ready: missing.length === 0,
      operationallyActive: Boolean(config.enabled && missing.length === 0),
      ipWhitelistRequired: r.ipWhitelistRequired,
      usingDeprecatedEnvFallback: r.usingEnvFallback,
    };
  }
  paymentCallbackUrl() {
    return this.callbackUrls().payment;
  }
  async getPayCoolsRuntime() {
    const config = await this.ensureConfig();
    const environment = this.normalizeEnvironment(config.environment);
    const row = await this.ensureEnvironment(config.id, environment);
    const runtime = this.effective(row, environment);
    return {
      environment,
      defaultQrExpirySeconds: config.defaultQrExpirySeconds,
      ...runtime,
      notifyUrl: this.callbackUrls().payment,
    };
  }
  async get() {
    const config = await this.ensureConfig();
    const environment = this.normalizeEnvironment(config.environment);
    const rows = await Promise.all(
      ENVIRONMENTS.map((item) => this.ensureEnvironment(config.id, item)),
    );
    const active = rows.find(
      (row) => row.environment === this.dbEnvironment(environment),
    );
    const readiness = this.readiness(config, active, environment);
    const events = await this.prisma.paymentPartnerEvent.findMany({
      where: { configurationId: config.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      ...config,
      paycoolsEnvironments: rows.map((row, index) =>
        this.safeEnvironment(row, ENVIRONMENTS[index]),
      ),
      activeEnvironmentConfig: this.safeEnvironment(active, environment),
      credentials: readiness.credentials,
      connection: readiness.connection,
      configurationComplete: Object.values(readiness.credentials).every(
        Boolean,
      ),
      readiness: {
        missing: readiness.missing,
        ready: readiness.ready,
        operationallyActive: readiness.operationallyActive,
        ipWhitelistRequired: readiness.ipWhitelistRequired,
        usingDeprecatedEnvFallback: readiness.usingDeprecatedEnvFallback,
        uatStatus: !Object.values(readiness.credentials).every(Boolean)
          ? 'NOT_READY'
          : readiness.ready
            ? config.enabled
              ? 'ACTIVE'
              : 'READY'
            : 'READY_FOR_TESTING',
      },
      callbackUrls: this.callbackUrls(),
      events,
    };
  }
  async getEnvironment(environment: string) {
    const config = await this.ensureConfig();
    const env = this.normalizeEnvironment(environment);
    return this.safeEnvironment(
      await this.ensureEnvironment(config.id, env),
      env,
      true,
    );
  }
  async updateEnvironment(
    environment: string,
    body: Record<string, unknown>,
    actorId: string,
  ) {
    const config = await this.ensureConfig();
    const env = this.normalizeEnvironment(environment);
    const data: Record<string, unknown> = {};
    for (const key of ENV_FIELDS)
      if (body[key] !== undefined) data[key] = body[key];
    for (const key of ['baseUrl', 'healthcheckUrl'])
      if (
        data[key] !== undefined &&
        data[key] !== '' &&
        !/^https:\/\//.test(String(data[key]))
      )
        throw new BadRequestException(`${key} must use HTTPS`);
    if (data.channelCode !== undefined && !String(data.channelCode).trim())
      throw new BadRequestException('channelCode is required');
    const row = await this.prisma.payCoolsEnvironmentConfiguration.update({
      where: {
        configurationId_environment: {
          configurationId: config.id,
          environment: this.dbEnvironment(env),
        },
      },
      data,
    });
    await this.prisma.paymentPartnerAuditLog.create({
      data: {
        configurationId: config.id,
        actorId,
        action: 'PAYCOOLS_ENVIRONMENT_CONFIGURATION_UPDATED',
        changes: {
          environment: env,
          fields: Object.keys(data),
        } as Prisma.InputJsonValue,
      },
    });
    return this.safeEnvironment(row, env);
  }
  async replaceSecret(
    environment: string,
    field: 'merchantPrivateKey' | 'callbackSecret',
    value: unknown,
    actorId: string,
  ) {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException('A non-empty secret is required');
    const config = await this.ensureConfig();
    const env = this.normalizeEnvironment(environment);
    const data =
      field === 'merchantPrivateKey'
        ? { encryptedMerchantPrivateKey: this.encrypt(value.trim()) }
        : { encryptedCallbackSecret: this.encrypt(value.trim()) };
    const row = await this.prisma.payCoolsEnvironmentConfiguration.update({
      where: {
        configurationId_environment: {
          configurationId: config.id,
          environment: this.dbEnvironment(env),
        },
      },
      data,
    });
    await this.prisma.paymentPartnerAuditLog.create({
      data: {
        configurationId: config.id,
        actorId,
        action: 'PAYCOOLS_SECRET_REPLACED',
        changes: { environment: env, secret: field } as Prisma.InputJsonValue,
      },
    });
    return this.safeEnvironment(row, env);
  }
  async getActiveProvider(sourceType: string) {
    const config = await this.ensureConfig();
    const environment = this.normalizeEnvironment(config.environment);
    const row = await this.ensureEnvironment(config.id, environment);
    const source = config.sources.find(
      (entry) => entry.sourceType === sourceType,
    );
    const readiness = this.readiness(config, row, environment);
    if (
      !readiness.operationallyActive ||
      !config.dynamicQrEnabled ||
      !source?.enabled
    )
      throw new BadRequestException(
        'This payment method is currently unavailable',
      );
    return {
      providerCode: config.providerCode,
      environment,
      defaultQrExpirySeconds: config.defaultQrExpirySeconds,
    };
  }
  async update(
    body: Record<string, unknown>,
    actor: { id: string },
    context: { ip?: string; userAgent?: string },
  ) {
    const current = await this.ensureConfig();
    const data: Record<string, unknown> = {};
    for (const field of MUTABLE_FIELDS)
      if (body[field] !== undefined) data[field] = body[field];
    if (data.environment) this.normalizeEnvironment(String(data.environment));
    if (
      data.defaultQrExpirySeconds !== undefined &&
      (!Number.isInteger(data.defaultQrExpirySeconds) ||
        Number(data.defaultQrExpirySeconds) < 300 ||
        Number(data.defaultQrExpirySeconds) > 3600)
    )
      throw new BadRequestException(
        'QR expiry must be between 300 and 3600 seconds',
      );
    if (data.refundEnabled === true || data.payoutEnabled === true)
      throw new BadRequestException(
        'PayCools refunds and payouts are not implemented',
      );
    const target = this.normalizeEnvironment(
      String(data.environment || current.environment),
    );
    if (target !== current.environment) data.enabled = false;
    const targetRow = await this.ensureEnvironment(current.id, target);
    const readiness = this.readiness(
      { ...current, ...data },
      targetRow,
      target,
    );
    if (data.enabled === true && !readiness.ready)
      throw new BadRequestException({
        code: 'PAYCOOLS_NOT_READY',
        message:
          'PayCools cannot be enabled because configuration is incomplete.',
        missing: readiness.missing,
      });
    const sourceUpdates =
      body.sources && typeof body.sources === 'object'
        ? Object.entries(body.sources as Record<string, unknown>)
        : [];
    if (!Object.keys(data).length && !sourceUpdates.length)
      throw new BadRequestException('No supported settings supplied');
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length)
        await tx.paymentPartnerConfiguration.update({
          where: { id: current.id },
          data,
        });
      for (const [sourceType, enabled] of sourceUpdates) {
        if (!(sourceType in SOURCE_DEFAULTS) || typeof enabled !== 'boolean')
          throw new BadRequestException(`Unsupported source ${sourceType}`);
        await tx.paymentPartnerSourceConfig.upsert({
          where: {
            providerCode_sourceType: { providerCode: PROVIDER, sourceType },
          },
          update: { enabled },
          create: {
            configurationId: current.id,
            providerCode: PROVIDER,
            sourceType,
            enabled,
          },
        });
      }
      await tx.paymentPartnerAuditLog.create({
        data: {
          configurationId: current.id,
          actorId: actor.id,
          action: 'PAYCOOLS_CONFIGURATION_UPDATED',
          changes: {
            fields: [
              ...Object.keys(data),
              ...sourceUpdates.map(([key]) => `source:${key}`),
            ],
          } as Prisma.InputJsonValue,
          ipAddress: context.ip,
          userAgent: context.userAgent,
        },
      });
    });
    return this.get();
  }
  async testConnection(actorId: string) {
    const config = await this.ensureConfig();
    const environment = this.normalizeEnvironment(config.environment);
    const row = await this.ensureEnvironment(config.id, environment);
    const runtime = this.effective(row, environment);
    if (
      !runtime.baseUrl ||
      !runtime.appId ||
      !runtime.appName ||
      !runtime.privateKeyBase64 ||
      !runtime.callbackSecret
    )
      throw new BadRequestException({
        code: 'PAYCOOLS_NOT_CONFIGURED',
        message: 'Complete PayCools credentials before testing the connection.',
      });
    if (!runtime.healthcheckUrl)
      throw new NotImplementedException(
        'A documented PayCools health-check endpoint must be configured before connection testing is available',
      );
    const field = environment === 'production' ? 'prod' : 'uat';
    try {
      const response = await fetch(runtime.healthcheckUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const now = new Date();
      await this.prisma.paymentPartnerConfiguration.update({
        where: { id: config.id },
        data: {
          [`${field}LastConnectionTestAt`]: now,
          [`${field}LastConnectionTestSuccessful`]: true,
          [`${field}LastConnectionTestErrorCode`]: null,
          lastSuccessfulRequestAt: now,
        },
      });
      return this.get();
    } catch {
      await this.prisma.paymentPartnerConfiguration.update({
        where: { id: config.id },
        data: {
          [`${field}LastConnectionTestAt`]: new Date(),
          [`${field}LastConnectionTestSuccessful`]: false,
          [`${field}LastConnectionTestErrorCode`]: 'PROVIDER_UNAVAILABLE',
        },
      });
      throw new BadRequestException(
        'Connection test failed: provider unavailable',
      );
    }
  }
  reconcile() {
    throw new NotImplementedException(
      'PayCools reconciliation API specifications are required before reconciliation can run',
    );
  }
}
