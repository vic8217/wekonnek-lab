import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import {
  canonicalCallbackContent,
  looksLikePemKey,
  signPayCoolsParam,
  verifyPayCoolsSign,
} from './paycools.crypto';
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentResult,
  PaymentProvider,
  VerifiedWebhookPayment,
} from './payment-provider';

function scalar(value: unknown, fallback = ''): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return fallback;
}

@Injectable()
export class PayCoolsProvider implements PaymentProvider {
  readonly providerName = 'paycools';
  private readonly logger = new Logger(PayCoolsProvider.name);

  constructor(private readonly config: PaymentPartnerConfigService) {}

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<CreateProviderPaymentResult> {
    const runtime = await this.config.getPayCoolsRuntime();
    if (!runtime.baseUrl || !runtime.appId || !runtime.privateKeyBase64) {
      throw new BadRequestException({
        code: 'PAYCOOLS_NOT_CONFIGURED',
        message: 'PayCools create-payment credentials are incomplete.',
      });
    }
    const paramObject = {
      amount: input.amountMinor,
      channelCode: runtime.channelCode,
      mchOrderId: input.reference,
      notifyUrl: input.notifyUrl || runtime.notifyUrl,
      timestamp: Date.now(),
    };
    const param = JSON.stringify(paramObject);
    const body = JSON.stringify({
      appId: runtime.appId,
      param,
      sign: signPayCoolsParam(param, runtime.privateKeyBase64),
    });
    const response = await fetch(`${runtime.baseUrl}/open-api/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: {
        qrCodeId?: string;
        qrCodeContent?: string;
        qrCodeUrl?: string;
        paymentUrl?: string;
        qrStatus?: string;
      };
    };
    if (!response.ok || payload.code !== 10000 || !payload.data?.qrCodeId) {
      this.logger.warn(
        `paycools_create_rejected reference=${input.reference} http=${response.status}`,
      );
      throw new BadRequestException(
        payload.message || 'PayCools could not create a payment QR.',
      );
    }
    const expiresAt = input.expiresInSeconds
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : undefined;
    this.logger.log(
      `paycools_qr_created reference=${input.reference} qrCodeId=${payload.data.qrCodeId}`,
    );
    return {
      providerQrCodeId: payload.data.qrCodeId,
      paymentUrl: payload.data.paymentUrl || payload.data.qrCodeUrl || null,
      qrData: payload.data.qrCodeContent || null,
      status: payload.data.qrStatus || 'ACTIVE',
      expiresAt,
    };
  }

  getPaymentStatus(providerReference: string) {
    return Promise.resolve({
      status: providerReference ? 'UNKNOWN' : 'UNKNOWN',
    });
  }

  async verifyWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedWebhookPayment> {
    void headers;
    const runtime = await this.config.getPayCoolsRuntime();
    if (!looksLikePemKey(runtime.callbackPublicKeyBase64)) {
      this.logger.warn(
        'paycools_callback_rejected reason=missing_callback_public_key',
      );
      throw new UnauthorizedException({
        code: 'PAYCOOLS_CALLBACK_KEY_MISSING',
        message:
          'PayCools callback verification requires PAYCOOLS_<ENV>_CALLBACK_PUBLIC_KEY_BASE64 (PayCools RSA public key). CALLBACK_SECRET is not a signature algorithm.',
      });
    }
    const envelope = this.parseEnvelope(body);
    const valid = verifyPayCoolsSign(
      envelope.content,
      envelope.sign,
      runtime.callbackPublicKeyBase64,
    );
    if (!valid) {
      this.logger.warn('paycools_callback_rejected reason=invalid_signature');
      throw new UnauthorizedException('Invalid PayCools callback signature');
    }
    const payload = envelope.payload;
    const status = this.mapStatus(payload);
    const amountMinor = Number(payload.amount);
    const mchOrderId = scalar(payload.mchOrderId);
    if (!mchOrderId || !Number.isFinite(amountMinor)) {
      throw new BadRequestException(
        'PayCools callback is missing mchOrderId or amount',
      );
    }
    this.logger.log(
      `paycools_callback_verified reference=${mchOrderId} providerTransactionId=${scalar(payload.transactionId, 'none')} status=${status}`,
    );
    return {
      reference: mchOrderId,
      providerTransactionId:
        scalar(payload.transactionId) || scalar(payload.qrCodeId) || mchOrderId,
      amountMinor,
      currency: payload.currency ? scalar(payload.currency) : undefined,
      status,
      eventName: payload.eventName ? scalar(payload.eventName) : undefined,
    };
  }

  private parseEnvelope(body: unknown): {
    content: string;
    sign: string;
    payload: Record<string, unknown>;
  } {
    if (!body || typeof body !== 'object')
      throw new UnauthorizedException('Invalid PayCools callback');
    const record = body as Record<string, unknown>;
    if (typeof record.sign !== 'string' || !record.sign)
      throw new UnauthorizedException('PayCools callback is missing sign');
    if (typeof record.param === 'string') {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(record.param) as Record<string, unknown>;
      } catch {
        throw new UnauthorizedException(
          'PayCools callback param is not valid JSON',
        );
      }
      return { content: record.param, sign: record.sign, payload };
    }
    if (record.param && typeof record.param === 'object') {
      const payload = record.param as Record<string, unknown>;
      return {
        content: canonicalCallbackContent(payload),
        sign: record.sign,
        payload,
      };
    }
    return {
      content: canonicalCallbackContent(record),
      sign: record.sign,
      payload: record,
    };
  }

  private mapStatus(
    payload: Record<string, unknown>,
  ): VerifiedWebhookPayment['status'] {
    const event = scalar(payload.eventName || payload.event_name).toLowerCase();
    const raw = scalar(
      payload.transactionStatus || payload.status,
    ).toUpperCase();
    if (event.includes('failed') || raw === 'FAILED') return 'FAILED';
    if (
      event.includes('success') ||
      raw === 'PAID' ||
      raw === 'COMPLETE' ||
      raw === 'COMPLETED' ||
      raw === 'SUCCESS'
    ) {
      return 'PAID';
    }
    return 'PENDING';
  }
}
