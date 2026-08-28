import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { createHash, createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { decryptDeliveryProviderCredential } from './delivery-partners.service';

const CITIES_PATH = '/v3/cities';
const UAT_BASE_URL = 'https://rest.sandbox.lalamove.com';
const PRODUCTION_BASE_URL = 'https://rest.lalamove.com';
const TIMEOUT_MS = 10_000;

export type LalamoveTestResult =
  | { ok: true; code: 'CONNECTED' }
  | {
      ok: false;
      code:
        | 'NOT_CONFIGURED'
        | 'AUTHENTICATION_FAILED'
        | 'TIMEOUT'
        | 'RATE_LIMITED'
        | 'UPSTREAM_UNAVAILABLE'
        | 'INVALID_CONFIGURATION'
        | 'INVALID_RESPONSE'
        | 'UNKNOWN_ERROR';
    };

export function lalamoveBaseUrl(environment: string): string {
  return environment === 'production' ? PRODUCTION_BASE_URL : UAT_BASE_URL;
}
export function lalamoveSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`)
    .digest('hex');
}

@Injectable()
export class LalamoveClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private key(): Buffer {
    const value = this.config.get<string>('INTEGRATION_ENCRYPTION_KEY');
    if (!value) throw new Error('Integration encryption key is not configured');
    return createHash('sha256').update(value).digest();
  }
  async testConnection(): Promise<LalamoveTestResult> {
    const provider = await this.prisma.deliveryProvider.findUnique({
      where: { code: 'LALAMOVE' },
    });
    if (!provider) return { ok: false, code: 'NOT_CONFIGURED' };
    const configuration =
      await this.prisma.deliveryProviderConfiguration.findUnique({
        where: { providerId: provider.id },
      });
    if (
      !configuration ||
      !['uat', 'production'].includes(configuration.environment)
    )
      return { ok: false, code: 'INVALID_CONFIGURATION' };
    const credentials = await this.prisma.deliveryProviderCredential.findMany({
      where: {
        providerId: provider.id,
        credentialKey: { in: ['API_KEY', 'API_SECRET'] },
      },
      select: { credentialKey: true, encryptedValue: true },
    });
    const values = new Map(
      credentials.map((item) => [item.credentialKey, item.encryptedValue]),
    );
    const apiKeyValue = values.get('API_KEY');
    const apiSecretValue = values.get('API_SECRET');
    if (!apiKeyValue || !apiSecretValue)
      return { ok: false, code: 'NOT_CONFIGURED' };
    let apiKey: string;
    let apiSecret: string;
    try {
      apiKey = decryptDeliveryProviderCredential(apiKeyValue, this.key());
      apiSecret = decryptDeliveryProviderCredential(apiSecretValue, this.key());
    } catch {
      return { ok: false, code: 'INVALID_CONFIGURATION' };
    }
    const timestamp = Date.now().toString();
    const signature = lalamoveSignature(
      timestamp,
      'GET',
      CITIES_PATH,
      '',
      apiSecret,
    );
    try {
      const response = await axios.get(
        `${lalamoveBaseUrl(configuration.environment)}${CITIES_PATH}`,
        {
          timeout: TIMEOUT_MS,
          headers: {
            Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
            Market: configuration.market,
            'Request-ID': randomUUID(),
          },
        },
      );
      return response.status >= 200 &&
        response.status < 300 &&
        response.data &&
        typeof response.data === 'object'
        ? { ok: true, code: 'CONNECTED' }
        : { ok: false, code: 'INVALID_RESPONSE' };
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNABORTED')
        return { ok: false, code: 'TIMEOUT' };
      const status = axiosError.response?.status;
      if (status === 401 || status === 403)
        return { ok: false, code: 'AUTHENTICATION_FAILED' };
      if (status === 429) return { ok: false, code: 'RATE_LIMITED' };
      if (status && status >= 500)
        return { ok: false, code: 'UPSTREAM_UNAVAILABLE' };
      return { ok: false, code: 'UNKNOWN_ERROR' };
    }
  }
}
