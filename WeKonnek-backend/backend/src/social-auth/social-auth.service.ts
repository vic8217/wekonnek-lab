import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDERS = ['GOOGLE', 'FACEBOOK', 'APPLE'] as const;
type Provider = (typeof PROVIDERS)[number];
const DEFAULT_SCOPES: Record<Provider, string[]> = { GOOGLE: ['openid', 'email', 'profile'], FACEBOOK: ['email', 'public_profile'], APPLE: ['name', 'email'] };

@Injectable()
export class SocialAuthProviderService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}
  private provider(value: string): Provider { const provider = value.toUpperCase() as Provider; if (!PROVIDERS.includes(provider)) throw new BadRequestException('Unsupported social login provider'); return provider; }
  private callback(provider: Provider) { const base = (this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000').replace(/\/$/, ''); return `${base}/api/auth/oauth/${provider.toLowerCase()}/callback`; }
  private key() { const value = this.config.get<string>('INTEGRATION_ENCRYPTION_KEY'); if (!value) throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY must be configured before saving provider secrets'); return createHash('sha256').update(value).digest(); }
  private encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; }
  decrypt(value: string) { const [ivValue, tagValue, encrypted] = value.split('.'); const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivValue, 'base64url')); decipher.setAuthTag(Buffer.from(tagValue, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'); }
  private safe(config: any) { return { ...config, encryptedClientSecret: undefined, encryptedPrivateKey: undefined, clientSecretConfigured: Boolean(config.encryptedClientSecret), privateKeyConfigured: Boolean(config.encryptedPrivateKey), callbackUrl: config.callbackUrl || this.callback(config.provider as Provider) }; }
  private async ensure(providerInput: string, environment = 'SANDBOX') { const provider = this.provider(providerInput); return this.prisma.socialAuthProvider.upsert({ where: { provider_environment: { provider, environment } }, update: {}, create: { provider, environment, callbackUrl: this.callback(provider), scopes: DEFAULT_SCOPES[provider] } }); }
  async list() { return Promise.all(PROVIDERS.map(async provider => this.safe(await this.ensure(provider)))); }
  async get(provider: string, environment = 'SANDBOX') { return this.safe(await this.ensure(provider, environment)); }
  async update(providerInput: string, body: any, actorId: string) {
    const provider = this.provider(providerInput); const environment = body.environment || 'SANDBOX';
    if (!['DEVELOPMENT', 'SANDBOX', 'PRODUCTION'].includes(environment)) throw new BadRequestException('Invalid environment');
    const current = await this.ensure(provider, environment); const data: any = { updatedById: actorId };
    for (const key of ['clientId', 'teamId', 'keyId', 'callbackUrl', 'enabled']) if (body[key] !== undefined) data[key] = body[key];
    if (body.scopes !== undefined) data.scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : DEFAULT_SCOPES[provider];
    if (body.clientSecret) data.encryptedClientSecret = this.encrypt(String(body.clientSecret));
    if (body.privateKey) data.encryptedPrivateKey = this.encrypt(String(body.privateKey));
    if (data.callbackUrl && !/^https?:\/\//.test(data.callbackUrl)) throw new BadRequestException('Callback URL must be an absolute URL');
    const configured = Boolean(data.clientId ?? current.clientId) && (provider === 'APPLE' ? Boolean(data.teamId ?? current.teamId) && Boolean(data.keyId ?? current.keyId) && Boolean(data.encryptedPrivateKey ?? current.encryptedPrivateKey) : Boolean(data.encryptedClientSecret ?? current.encryptedClientSecret));
    if (data.enabled && !configured) throw new BadRequestException('Save complete credentials before enabling this provider');
    const saved = await this.prisma.socialAuthProvider.update({ where: { id: current.id }, data: { ...data, status: configured ? current.status === 'NOT_TESTED' ? 'CONFIGURED' : current.status : 'NOT_TESTED' } });
    return this.safe(saved);
  }
  async setStatus(provider: string, enabled: boolean, actorId: string) { return this.update(provider, { enabled }, actorId); }
  async test(providerInput: string, actorId: string) { const provider = this.provider(providerInput); const config = await this.ensure(provider); const valid = Boolean(config.clientId) && (provider === 'APPLE' ? Boolean(config.teamId && config.keyId && config.encryptedPrivateKey) : Boolean(config.encryptedClientSecret)); const status = valid ? 'CONNECTED' : 'CONFIGURATION_ERROR'; const result = valid ? 'Configuration valid. Complete OAuth testing with the provider.' : 'Required credentials are missing.'; const saved = await this.prisma.socialAuthProvider.update({ where: { id: config.id }, data: { status, lastTestedAt: new Date(), lastTestResult: result, updatedById: actorId } }); return this.safe(saved); }
  async publicProviders() { const configs = await this.prisma.socialAuthProvider.findMany({ where: { environment: 'SANDBOX', enabled: true }, select: { provider: true, enabled: true } }); return { providers: configs }; }
  async active(providerInput: string) { const provider = this.provider(providerInput); const config = await this.prisma.socialAuthProvider.findFirst({ where: { provider, environment: 'SANDBOX', enabled: true } }); if (!config) throw new BadRequestException(`${provider[0]}${provider.slice(1).toLowerCase()} sign-in is currently unavailable.`); return config; }
  async oauthCredentials(providerInput: string) { const config = await this.active(providerInput); return { clientId: config.clientId!, clientSecret: config.encryptedClientSecret ? this.decrypt(config.encryptedClientSecret) : undefined, redirectUri: config.callbackUrl || this.callback(config.provider as Provider) }; }
}
