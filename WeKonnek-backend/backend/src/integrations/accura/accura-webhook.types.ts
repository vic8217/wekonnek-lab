export const ACCURA_WEBHOOK_VERSION = 'ACCURA-WEBHOOK-V1';
export const ACCURA_INVOICE_ISSUED_EVENT = 'invoice.issued';
export const ACCURA_SOURCE_SYSTEM = 'WEKONNEK';
export const ACCURA_INVOICE_ISSUED_STATUS = 'ISSUED';
export const DEFAULT_ACCURA_WEBHOOK_TOLERANCE_SECONDS = 300;

export const ACCURA_EVENT_ID_HEADER = 'x-accura-event-id';
export const ACCURA_TIMESTAMP_HEADER = 'x-accura-timestamp';
export const ACCURA_SIGNATURE_HEADER = 'x-accura-signature';

export type AccuraWebhookHeaders = {
  eventId?: string;
  timestamp?: string;
  signature?: string;
};

export type AccuraInvoiceIssuedData = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  documentHash: string;
  sourceSystem: string;
  externalOrderId: string;
  externalOrderCode?: string;
  externalClientReference?: string;
  verificationUrl?: string;
};

export type AccuraWebhookEnvelope = {
  version: string;
  eventId: string;
  eventType: string;
  createdAt: string;
  data: Record<string, unknown>;
};

export type AccuraWebhookHandleInput = {
  rawBody: Buffer;
  headers: AccuraWebhookHeaders;
  now?: Date;
};

export type AccuraWebhookResult = {
  outcome: 'processed' | 'duplicate' | 'ignored';
  eventId: string;
  eventType: string;
  wkOrderId?: number;
  orderCode?: string;
  accuraInvoiceId?: string;
  accuraInvoiceNumber?: string;
};
