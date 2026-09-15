import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export const AGREEMENT_CANONICAL_SCHEMA = 'WEKONNEK-AGREEMENT-V1';

export type CanonicalAgreementTerms = {
  schema: typeof AGREEMENT_CANONICAL_SCHEMA;
  agreementType: 'MERCHANT_TRADE' | 'RIDER_ADVANCE';
  wkOrderId: number | null;
  orderCode: string | null;
  parties: Array<{
    role: 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'PLATFORM';
    userId: string | null;
    merchantId: number | null;
    historicalLabel: string | null;
  }>;
  merchandise: {
    items: Array<{
      productId: number | null;
      productName: string;
      variantId: number | null;
      quantity: number;
      unitPrice: string;
      subtotal: string;
    }>;
  };
  money: {
    currency: 'PHP';
    total: string;
    deliveryFee: string;
    discount: string;
    transactionFeeAmount: string;
  };
  paymentFacts: {
    method: string | null;
    status: string | null;
    reference: string | null;
    /** Snapshot only — ownership remains PaymentRoutingService / Stage 1 */
    note: 'payment_beneficiary_not_decided_by_agreement';
  };
  /** Future Rider Advance fields live here when activated; never mutate after accept. */
  riderAdvance: null | {
    maximumAuthorizedAdvance: string;
    purpose: string;
    assignedRiderUserId: string | null;
  };
  issuedAt: string;
};

function moneyString(value: unknown): string {
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value && typeof value === 'object' && 'toFixed' in value) {
    return (value as Prisma.Decimal).toFixed(2);
  }
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** Deterministic JSON: sorted object keys, array order preserved as provided. */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortValue(obj[key]);
  }
  return out;
}

export function sha256Hex(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export function buildMerchantTradeTerms(input: {
  wkOrderId: number;
  orderCode: string;
  buyerId: string;
  merchantId: number;
  merchantName: string;
  shopId: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  paymentRef: string | null;
  totalAmount: unknown;
  deliveryFee: unknown;
  discountAmount: unknown;
  transactionFeeAmount: unknown;
  items: Array<{
    productId: number | null;
    productName: string;
    variantId: number | null;
    quantity: number;
    price: unknown;
    subtotal: unknown;
  }>;
  issuedAt?: Date;
}): { terms: CanonicalAgreementTerms; canonicalJson: string; termsHash: string } {
  const terms: CanonicalAgreementTerms = {
    schema: AGREEMENT_CANONICAL_SCHEMA,
    agreementType: 'MERCHANT_TRADE',
    wkOrderId: input.wkOrderId,
    orderCode: input.orderCode,
    parties: (
      [
        {
          role: 'CUSTOMER' as const,
          userId: input.buyerId,
          merchantId: null,
          historicalLabel: null,
        },
        {
          role: 'MERCHANT' as const,
          userId: null,
          merchantId: input.merchantId,
          historicalLabel: input.merchantName,
        },
      ] satisfies CanonicalAgreementTerms['parties']
    ).sort((a, b) => a.role.localeCompare(b.role)),
    merchandise: {
      items: input.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: moneyString(item.price),
        subtotal: moneyString(item.subtotal),
      })),
    },
    money: {
      currency: 'PHP',
      total: moneyString(input.totalAmount),
      deliveryFee: moneyString(input.deliveryFee),
      discount: moneyString(input.discountAmount),
      transactionFeeAmount: moneyString(input.transactionFeeAmount),
    },
    paymentFacts: {
      method: input.paymentMethod,
      status: input.paymentStatus,
      reference: input.paymentRef,
      note: 'payment_beneficiary_not_decided_by_agreement',
    },
    riderAdvance: null,
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
  };
  const canonicalJson = canonicalizeJson(terms);
  return { terms, canonicalJson, termsHash: sha256Hex(canonicalJson) };
}

export type IntegrityResult =
  | { status: 'valid'; termsHash: string }
  | { status: 'invalid'; expected: string; actual: string }
  | { status: 'unsupported_schema'; schema: string };

export function verifyTermsIntegrity(
  termsSnapshot: unknown,
  storedHash: string,
): IntegrityResult {
  if (
    !termsSnapshot ||
    typeof termsSnapshot !== 'object' ||
    (termsSnapshot as { schema?: string }).schema !== AGREEMENT_CANONICAL_SCHEMA
  ) {
    return {
      status: 'unsupported_schema',
      schema: String((termsSnapshot as { schema?: string })?.schema ?? 'unknown'),
    };
  }
  const actual = sha256Hex(canonicalizeJson(termsSnapshot));
  if (actual !== storedHash) {
    return { status: 'invalid', expected: storedHash, actual };
  }
  return { status: 'valid', termsHash: actual };
}
