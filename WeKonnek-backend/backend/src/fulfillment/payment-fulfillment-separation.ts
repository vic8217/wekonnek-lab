/**
 * Payment vs fulfillment separation (Stage 0A).
 *
 * Delivery / completion of fulfillment is NOT authoritative proof that money
 * was received. Explicit payment or collection events own paymentStatus.
 *
 * Legacy behavior (preserved for backward compatibility with Accura enqueue,
 * merchant sales ledger, and dine-in flows): when a WkOrder using cod/cash/manual
 * reaches commerce status `completed` or `delivered`, paymentStatus may still be
 * set to `paid`. That path MUST go through applyLegacyCodPaidOnCommerceComplete
 * and emit a domain event with action LEGACY_COD_MARK_PAID_ON_COMPLETE.
 *
 * Do not treat orders_v2 `delivered` as payment settlement in Stage 0A.
 */

export const LEGACY_COD_PAYMENT_METHODS = new Set(['cod', 'cash', 'manual']);
export const LEGACY_COD_COMPLETE_STATUSES = new Set(['completed', 'delivered']);

export interface LegacyCodMarkResult {
  /** Whether legacy auto-paid should apply */
  shouldMarkPaid: boolean;
  /** Reason code for audit */
  reason: 'LEGACY_COD_MARK_PAID_ON_COMPLETE' | null;
}

export function evaluateLegacyCodPaidOnCommerceComplete(input: {
  nextCommerceStatus: string;
  paymentMethod: string;
  currentPaymentStatus: string;
}): LegacyCodMarkResult {
  const shouldMarkPaid =
    LEGACY_COD_COMPLETE_STATUSES.has(input.nextCommerceStatus) &&
    LEGACY_COD_PAYMENT_METHODS.has(input.paymentMethod) &&
    input.currentPaymentStatus !== 'paid';

  return {
    shouldMarkPaid,
    reason: shouldMarkPaid ? 'LEGACY_COD_MARK_PAID_ON_COMPLETE' : null,
  };
}

/**
 * Explicit collection event shape for future merchant payment redesign.
 * Not persisted as a separate table in Stage 0A — recorded via OrderDomainEvent.
 */
export interface PaymentCollectionEventDraft {
  wkOrderId: number;
  amount?: number;
  method: string;
  source:
    | 'gateway'
    | 'explicit_collection'
    | 'legacy_fulfillment_complete';
  actorId?: string | null;
  correlationId?: string | null;
}
