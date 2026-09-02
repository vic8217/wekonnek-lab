export const ACCURA_INVOICE_CREATE_PATH = '/api/v1/integrations/invoices';
export const ACCURA_CLIENT_FETCH = 'ACCURA_CLIENT_FETCH';
export const DEFAULT_ACCURA_API_TIMEOUT_MS = 10_000;
export const ACCURA_IDEMPOTENCY_KEY_PREFIX = 'wekonnek:wkorder:';
export const ACCURA_IDEMPOTENCY_KEY_SUFFIX = ':accura-invoice';

export type AccuraInvoiceLineInput = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountAmount: string;
  taxClass: 'NON_VAT';
  productReference?: string;
};

export type AccuraInvoiceIssueRequest = {
  sourceSystem: 'WEKONNEK';
  branchId: string;
  seriesId: string;
  items: AccuraInvoiceLineInput[];
  buyer?: Record<string, string>;
  payment?: Record<string, string | number>;
  idempotencyKey: string;
  externalOrderId: string;
  externalOrderCode: string;
  externalClientReference: string;
};

/** Canonical WeKonnek ↔ ACCURA delegated merchant reference. */
export function accuraExternalClientReference(merchantId: number): string {
  return `merchant-${merchantId}`;
}

export const getAccuraExternalClientReference = accuraExternalClientReference;

export const ACCURA_PERMANENT_ISSUANCE_CODES = new Set([
  'UNAUTHORIZED_CLIENT',
  'SCOPE_REQUIRED',
  'PLATFORM_INVOICE_SCOPE_REQUIRED',
  'PLATFORM_CLIENT_REFERENCE_REQUIRED',
  'PLATFORM_DELEGATION_NOT_FOUND',
  'PLATFORM_DELEGATION_REVOKED',
  'DELEGATION_NOT_FOUND',
  'DELEGATION_REVOKED',
  'BRANCH_NOT_OWNED_BY_DELEGATED_CLIENT',
  'BRANCH_NOT_ALLOWED',
  'COMPANY_NOT_ALLOWED',
  'CLIENT_ACCOUNT_NOT_ACTIVE',
  'CLIENT_ACCOUNT_SUSPENDED',
  'CLIENT_ACCOUNT_TERMINATED',
  'IDEMPOTENCY_KEY_REUSED',
]);

export type AccuraInvoiceIssueResponse = {
  invoiceId: string;
  officialNumber: string;
  status: string;
  issuedAt: string;
  grandTotal?: string | number;
  documentHash: string;
  externalOrderId: string | null;
  externalOrderCode: string | null;
};

export type AccuraIssuanceCategory =
  | 'ISSUED'
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'NOT_ELIGIBLE'
  | 'AUTH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER'
  | 'REJECTED';

export type AccuraIssuanceOutcome =
  | {
      ok: true;
      category: 'ISSUED';
      retryable: false;
      wkOrderId: number;
      orderCode: string;
      invoiceId: string;
      officialNumber: string;
      status: string;
      issuedAt: string;
      documentHash: string;
      externalOrderId: string;
      externalOrderCode: string | null;
      httpStatus?: number;
    }
  | {
      ok: false;
      category: Exclude<AccuraIssuanceCategory, 'ISSUED'>;
      retryable: boolean;
      wkOrderId?: number;
      orderCode?: string;
      message: string;
      httpStatus?: number;
    };

export function accuraInvoiceIdempotencyKey(wkOrderId: number): string {
  return `${ACCURA_IDEMPOTENCY_KEY_PREFIX}${wkOrderId}${ACCURA_IDEMPOTENCY_KEY_SUFFIX}`;
}

export function accuraBasicAuthorization(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}
