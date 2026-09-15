# Payment vs Fulfillment Separation (Stage 0A)

## Rule

Fulfillment events (`delivered`, rider custody changes) are **not** authoritative proof that money was received.

Payment status lives on:

- `WkOrder.paymentStatus` / `paymentMethod` / platform payment tables
- Explicit payment provider settlement (`markPaidByGateway`, PayCools callbacks)
- Future explicit collection events (not redesigned in Stage 0A)

## Legacy behavior (preserved)

For marketplace `WkOrder` only, when commerce status becomes `completed` or `delivered` and `paymentMethod` is `cod` | `cash` | `manual`, Stage 0A still sets `paymentStatus = paid` via `evaluateLegacyCodPaidOnCommerceComplete` and records:

`OrderDomainEvent.action = LEGACY_COD_MARK_PAID_ON_COMPLETE`

This protects Accura enqueue and existing merchant ledger assumptions.

## Not legacy

`orders_v2` / `OrderFulfillment` delivery does **not** set payment status.

## Follow-up

Merchant payment redesign should replace the legacy helper with explicit collection acknowledgements.
