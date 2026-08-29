export interface CreateProviderPaymentInput {
  reference: string;
  amountMinor: number;
  currency: string;
  notifyUrl: string;
  description?: string;
  expiresInSeconds?: number;
}

export interface CreateProviderPaymentResult {
  providerQrCodeId?: string;
  providerTransactionId?: string;
  paymentUrl?: string | null;
  qrData?: string | null;
  status: string;
  expiresAt?: Date;
}

export type VerifiedProviderPaymentStatus = 'PAID' | 'FAILED' | 'PENDING';

export interface VerifiedWebhookPayment {
  reference: string;
  providerTransactionId: string;
  amountMinor: number;
  currency?: string;
  status: VerifiedProviderPaymentStatus;
  eventName?: string;
}

export interface PaymentProvider {
  readonly providerName: string;
  createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<CreateProviderPaymentResult>;
  getPaymentStatus(providerReference: string): Promise<{ status: string }>;
  verifyWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedWebhookPayment>;
}
