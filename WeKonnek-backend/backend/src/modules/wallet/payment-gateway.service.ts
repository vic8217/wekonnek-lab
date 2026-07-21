import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletPaymentGateway as PaymentGateway } from '@prisma/client';

// ──────────────────────────────────────────────
//  PAYMENT GATEWAY ABSTRACTION
//  Supports: PayMongo, Maya Business, Xendit
// ──────────────────────────────────────────────

export interface CreatePaymentSource {
  gateway: PaymentGateway;
  amount: number; // in PHP
  description: string;
  paymentMethod: string; // gcash, grab_pay, card, bank
  redirectSuccess: string;
  redirectFailed: string;
  metadata?: Record<string, any>;
}

export interface PaymentSourceResult {
  gatewayTransactionId: string;
  paymentUrl: string; // URL to redirect user for payment
  status: string;
}

export interface CashOutRequest {
  gateway: PaymentGateway;
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  description: string;
}

export interface CashOutResult {
  gatewayTransactionId: string;
  status: string;
}

export interface WebhookPayload {
  gateway: PaymentGateway;
  body: any;
  headers: Record<string, string>;
}

export interface WebhookResult {
  transactionId: string;
  status: 'completed' | 'failed';
  amount: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class PaymentGatewayService {
  constructor(private readonly config: ConfigService) {}

  // ─── CREATE PAYMENT (TOP-UP) ─────────────────
  async createPayment(data: CreatePaymentSource): Promise<PaymentSourceResult> {
    switch (data.gateway) {
      case PaymentGateway.paymongo:
        return this.createPayMongoPayment(data);
      case PaymentGateway.maya:
        return this.createMayaPayment(data);
      case PaymentGateway.xendit:
        return this.createXenditPayment(data);
      default:
        throw new BadRequestException('Unsupported payment gateway');
    }
  }

  // ─── CASH-OUT / DISBURSEMENT ─────────────────
  async createCashOut(data: CashOutRequest): Promise<CashOutResult> {
    switch (data.gateway) {
      case PaymentGateway.paymongo:
        throw new BadRequestException('PayMongo does not support direct disbursements');
      case PaymentGateway.maya:
        return this.createMayaCashOut(data);
      case PaymentGateway.xendit:
        return this.createXenditCashOut(data);
      default:
        throw new BadRequestException('Unsupported cash-out gateway');
    }
  }

  // ─── VERIFY WEBHOOK ──────────────────────────
  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    switch (payload.gateway) {
      case PaymentGateway.paymongo:
        return this.verifyPayMongoWebhook(payload);
      case PaymentGateway.maya:
        return this.verifyMayaWebhook(payload);
      case PaymentGateway.xendit:
        return this.verifyXenditWebhook(payload);
      default:
        throw new BadRequestException('Unsupported gateway webhook');
    }
  }

  // ══════════════════════════════════════════════
  //  PAYMONGO IMPLEMENTATION
  //  Docs: https://developers.paymongo.com
  // ══════════════════════════════════════════════
  private async createPayMongoPayment(data: CreatePaymentSource): Promise<PaymentSourceResult> {
    const secretKey = this.config.get<string>('PAYMONGO_SECRET_KEY');
    const baseUrl = 'https://api.paymongo.com/v1';

    // Map our payment methods to PayMongo source types
    const typeMap: Record<string, string> = {
      gcash: 'gcash',
      grab_pay: 'grab_pay',
      card: 'card',
    };

    const sourceType = typeMap[data.paymentMethod] || 'gcash';

    // Create a checkout session (PayMongo's recommended approach)
    const response = await fetch(`${baseUrl}/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            description: data.description,
            line_items: [
              {
                currency: 'PHP',
                amount: Math.round(data.amount * 100), // PayMongo uses centavos
                name: data.description,
                quantity: 1,
              },
            ],
            payment_method_types: [sourceType],
            success_url: data.redirectSuccess,
            cancel_url: data.redirectFailed,
            metadata: data.metadata || {},
          },
        },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new BadRequestException(
        `PayMongo error: ${result.errors?.[0]?.detail || 'Unknown error'}`,
      );
    }

    return {
      gatewayTransactionId: result.data.id,
      paymentUrl: result.data.attributes.checkout_url,
      status: result.data.attributes.status,
    };
  }

  // ══════════════════════════════════════════════
  //  MAYA BUSINESS IMPLEMENTATION
  //  Docs: https://developers.maya.ph
  // ══════════════════════════════════════════════
  private async createMayaPayment(data: CreatePaymentSource): Promise<PaymentSourceResult> {
    const publicKey = this.config.get<string>('MAYA_PUBLIC_KEY');
    const baseUrl = 'https://pg.maya.ph/checkout/v1';

    const response = await fetch(`${baseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(publicKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        totalAmount: {
          value: data.amount,
          currency: 'PHP',
        },
        requestReferenceNumber: `WHP-${Date.now()}`,
        redirectUrl: {
          success: data.redirectSuccess,
          failure: data.redirectFailed,
          cancel: data.redirectFailed,
        },
        metadata: data.metadata || {},
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new BadRequestException(
        `Maya error: ${result.message || 'Unknown error'}`,
      );
    }

    return {
      gatewayTransactionId: result.checkoutId,
      paymentUrl: result.redirectUrl,
      status: 'pending',
    };
  }

  // ══════════════════════════════════════════════
  //  XENDIT IMPLEMENTATION
  //  Docs: https://docs.xendit.co
  // ══════════════════════════════════════════════
  private async createXenditPayment(data: CreatePaymentSource): Promise<PaymentSourceResult> {
    const secretKey = this.config.get<string>('XENDIT_SECRET_KEY');
    const baseUrl = 'https://api.xendit.co';

    // Map our payment methods to Xendit payment method types
    const paymentMethodMap: Record<string, string[]> = {
      gcash: ['EWALLET'],
      grab_pay: ['EWALLET'],
      card: ['CARD'],
      bank: ['BANK_TRANSFER'],
    };

    const response = await fetch(`${baseUrl}/v2/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        external_id: `WHP-${Date.now()}`,
        amount: data.amount,
        currency: 'PHP',
        description: data.description,
        payment_methods: paymentMethodMap[data.paymentMethod] || ['EWALLET'],
        success_redirect_url: data.redirectSuccess,
        failure_redirect_url: data.redirectFailed,
        metadata: data.metadata || {},
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new BadRequestException(
        `Xendit error: ${result.message || 'Unknown error'}`,
      );
    }

    return {
      gatewayTransactionId: result.id,
      paymentUrl: result.invoice_url,
      status: result.status,
    };
  }

  // ─── MAYA CASH-OUT (Disbursement) ────────────
  private async createMayaCashOut(data: CashOutRequest): Promise<CashOutResult> {
    const secretKey = this.config.get<string>('MAYA_SECRET_KEY');
    const baseUrl = 'https://pg.maya.ph/payouts/v2';

    const response = await fetch(`${baseUrl}/payouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        totalAmount: { value: data.amount, currency: 'PHP' },
        fundSource: { id: 'default' },
        channel: { name: data.bankCode },
        beneficiary: {
          accountNumber: data.accountNumber,
          name: data.accountName,
        },
        requestReferenceNumber: `WHP-CO-${Date.now()}`,
      }),
    });

    const result = await response.json();
    return {
      gatewayTransactionId: result.id || `maya-${Date.now()}`,
      status: result.status || 'pending',
    };
  }

  // ─── XENDIT CASH-OUT (Disbursement) ──────────
  private async createXenditCashOut(data: CashOutRequest): Promise<CashOutResult> {
    const secretKey = this.config.get<string>('XENDIT_SECRET_KEY');
    const baseUrl = 'https://api.xendit.co';

    const response = await fetch(`${baseUrl}/disbursements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(secretKey + ':').toString('base64')}`,
      },
      body: JSON.stringify({
        external_id: `WHP-CO-${Date.now()}`,
        amount: data.amount,
        bank_code: data.bankCode,
        account_holder_name: data.accountName,
        account_number: data.accountNumber,
        description: data.description,
      }),
    });

    const result = await response.json();
    return {
      gatewayTransactionId: result.id || `xendit-${Date.now()}`,
      status: result.status || 'PENDING',
    };
  }

  // ─── WEBHOOK VERIFICATION ────────────────────
  private async verifyPayMongoWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    // PayMongo sends event.data.attributes
    const event = payload.body;
    const paymentData = event?.data?.attributes;
    const status = paymentData?.status === 'paid' ? 'completed' : 'failed';

    return {
      transactionId: event?.data?.id || '',
      status,
      amount: (paymentData?.amount || 0) / 100, // Convert from centavos
      metadata: paymentData?.metadata,
    };
  }

  private async verifyMayaWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const event = payload.body;
    const status =
      event?.status === 'PAYMENT_SUCCESS' ? 'completed' : 'failed';

    return {
      transactionId: event?.id || '',
      status,
      amount: event?.totalAmount?.value || 0,
      metadata: event?.metadata,
    };
  }

  private async verifyXenditWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const event = payload.body;
    const status = event?.status === 'PAID' ? 'completed' : 'failed';

    return {
      transactionId: event?.id || '',
      status,
      amount: event?.amount || 0,
      metadata: event?.metadata,
    };
  }
}
