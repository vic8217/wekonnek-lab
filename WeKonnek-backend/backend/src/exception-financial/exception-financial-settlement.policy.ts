/**
 * Stage 13A Exception Obligation Settlement — policy helpers & error codes.
 *
 * Financial authority is derived: Σ ACKNOWLEDGED.acknowledgedAmount vs
 * ExceptionFinancialObligation.principal. Persisted obligation.status is a
 * DB-constrained derived settlement mirror (OPEN / PARTIALLY_SETTLED /
 * SETTLED) for Stage12 EXCEPTION_OBLIGATION_PENDING compatibility.
 * CANCELLED / WRITTEN_OFF have no current authoritative writer.
 */
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export const EXCEPTION_FINANCIAL_SETTLEMENT_CODES = {
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_METHOD: 'INVALID_METHOD',
  NOT_OBLIGATION_DEBTOR: 'NOT_OBLIGATION_DEBTOR',
  NOT_OBLIGATION_CREDITOR: 'NOT_OBLIGATION_CREDITOR',
  OBLIGATION_NOT_EXECUTABLE: 'OBLIGATION_NOT_EXECUTABLE',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  SETTLEMENT_AMOUNT_EXCEEDS_REMAINING: 'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
  AMOUNT_EXCEEDS_CLAIM: 'AMOUNT_EXCEEDS_CLAIM',
  SETTLEMENT_ALREADY_RESOLVED: 'SETTLEMENT_ALREADY_RESOLVED',
  INVALID_SETTLEMENT_STATUS: 'INVALID_SETTLEMENT_STATUS',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  PLATFORM_FIREWALL: 'PLATFORM_FIREWALL',
  ADMIN_CANNOT_FABRICATE_ACK: 'ADMIN_CANNOT_FABRICATE_ACK',
  FORBIDDEN_VIEW: 'FORBIDDEN_VIEW',
  CASH_DEBTOR_SELF_ACK_FORBIDDEN: 'CASH_DEBTOR_SELF_ACK_FORBIDDEN',
} as const;

/** @deprecated Prefer EXCEPTION_FINANCIAL_SETTLEMENT_CODES; short alias for services. */
export const CODES = EXCEPTION_FINANCIAL_SETTLEMENT_CODES;

export type DerivedSettlementState =
  | 'UNPAID'
  | 'PARTIALLY_SETTLED'
  | 'SETTLED';

const MONEY = (v: Prisma.Decimal.Value): Prisma.Decimal =>
  new Prisma.Decimal(v ?? 0).toDecimalPlaces(2);

export { MONEY as toSettlementMoney };

/**
 * Transfer methods that create CLAIMED rows (debtor claims; creditor ACK/REJECT).
 * CASH is intentionally excluded — creditor records receipt as ACKNOWLEDGED.
 */
export const TRANSFER_METHODS = new Set([
  'DIRECT_TRANSFER',
  'BANK_TRANSFER',
  'MERCHANT_QR',
] as const);

export type TransferSettlementMethod =
  | 'DIRECT_TRANSFER'
  | 'BANK_TRANSFER'
  | 'MERCHANT_QR';

/** Methods that imply WeKonnek custody — Stage13A records external settlement only. */
const PLATFORM_CUSTODY_METHOD_RE =
  /WALLET|ESCROW|PLATFORM_BALANCE|PLATFORM_HELD|WEKONNEK_WALLET|HELD_FUNDS/i;

export function isPlatformCustodyMethod(method: string): boolean {
  return PLATFORM_CUSTODY_METHOD_RE.test(method);
}

export function computeDerivedSettlementState(
  principal: Prisma.Decimal.Value,
  settledAmount: Prisma.Decimal.Value,
): DerivedSettlementState {
  const p = MONEY(principal);
  const s = MONEY(settledAmount);
  if (s.lte(0)) return 'UNPAID';
  if (p.gt(0) && s.gte(p)) return 'SETTLED';
  return 'PARTIALLY_SETTLED';
}

/** Stable JSON stringify (sorted object keys) for fingerprinting. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(',')}}`;
}

export function fingerprintClaimPayload(input: {
  obligationId: string;
  debtorType: string;
  debtorUserId: string | null;
  debtorMerchantId: number | null;
  creditorType: string;
  creditorUserId: string | null;
  creditorMerchantId: number | null;
  amount: Prisma.Decimal.Value;
  currency: string;
  method: string;
  externalReference?: string | null;
}): string {
  return createHash('sha256')
    .update(
      stableJson({
        obligationId: input.obligationId,
        debtorType: input.debtorType,
        debtorUserId: input.debtorUserId,
        debtorMerchantId: input.debtorMerchantId,
        creditorType: input.creditorType,
        creditorUserId: input.creditorUserId,
        creditorMerchantId: input.creditorMerchantId,
        amount: MONEY(input.amount).toFixed(2),
        currency: input.currency,
        method: input.method,
        externalReference: input.externalReference ?? null,
      }),
    )
    .digest('hex');
}

export function fingerprintAckPayload(input: {
  settlementId: string;
  acknowledgedAmount: Prisma.Decimal.Value;
}): string {
  return createHash('sha256')
    .update(
      stableJson({
        kind: 'ack',
        settlementId: input.settlementId,
        acknowledgedAmount: MONEY(input.acknowledgedAmount).toFixed(2),
      }),
    )
    .digest('hex');
}

export function fingerprintRejectPayload(input: {
  settlementId: string;
  reason?: string | null;
}): string {
  return createHash('sha256')
    .update(
      stableJson({
        kind: 'reject',
        settlementId: input.settlementId,
        reason: input.reason ?? null,
      }),
    )
    .digest('hex');
}

export function fingerprintCancelPayload(settlementId: string): string {
  return createHash('sha256')
    .update(stableJson({ kind: 'cancel', settlementId }))
    .digest('hex');
}

export function fingerprintEvidencePayload(input: {
  settlementId: string;
  kind: string;
  storageReference: string;
  note?: string | null;
}): string {
  return createHash('sha256')
    .update(
      stableJson({
        kind: 'evidence',
        settlementId: input.settlementId,
        evidenceKind: input.kind,
        storageReference: input.storageReference,
        note: input.note ?? null,
      }),
    )
    .digest('hex');
}
