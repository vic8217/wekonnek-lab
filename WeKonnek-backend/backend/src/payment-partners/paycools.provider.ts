import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import {
  signPhilippinePayCoolsPayload,
  verifyPhilippinePayCoolsCallback,
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
    if (
      !runtime.baseUrl ||
      !runtime.appId ||
      !runtime.appName ||
      !runtime.privateKeyBase64
    ) {
      throw new BadRequestException({
        code: 'PAYCOOLS_NOT_CONFIGURED',
        message: 'PayCools create-payment credentials are incomplete.',
      });
    }
    const request = {
      appId: runtime.appId,
      appName: runtime.appName,
      amount: input.amountMinor,
      callbackUrl: input.notifyUrl || runtime.notifyUrl,
      channelCode: runtime.channelCode,
      mchOrderId: input.reference,
    };
    const body = JSON.stringify({
      ...request,
      sign: signPhilippinePayCoolsPayload(request, runtime.privateKeyBase64),
    });
    const response = await fetch(`${runtime.baseUrl}/api/v1/qrcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      code?: number | string;
      message?: string;
      data?: {
        qrcodeId?: string;
        qrcodeContent?: string;
        qrLink?: string;
        status?: string;
      };
    };
    if (
      !response.ok ||
      String(payload.code) !== '1000' ||
      !payload.data?.qrcodeId
    ) {
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
      `paycools_qr_created reference=${input.reference} qrCodeId=${payload.data.qrcodeId}`,
    );
    return {
      providerQrCodeId: payload.data.qrcodeId,
      paymentUrl: payload.data.qrLink || null,
      qrData: payload.data.qrcodeContent || null,
      status: payload.data.status || 'ACTIVE',
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
    if (!runtime.callbackSecret) {
      this.logger.warn(
        'paycools_callback_rejected reason=missing_callback_secret',
      );
      throw new UnauthorizedException({
        code: 'PAYCOOLS_CALLBACK_SECRET_MISSING',
        message:
          'PayCools Philippine QRPH callback verification requires PAYCOOLS_<ENV>_CALLBACK_SECRET.',
      });
    }
    const payload = this.parseCallback(body);
    const valid = verifyPhilippinePayCoolsCallback(
      payload,
      runtime.callbackSecret,
    );
    if (!valid) {
      this.logger.warn('paycools_callback_rejected reason=invalid_signature');
      throw new UnauthorizedException('Invalid PayCools callback signature');
    }
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

  private parseCallback(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object')
      throw new UnauthorizedException('Invalid PayCools callback');
    const record = body as Record<string, unknown>;
    if (typeof record.sign !== 'string' || !record.sign)
      throw new UnauthorizedException('PayCools callback is missing sign');
    return record;
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
