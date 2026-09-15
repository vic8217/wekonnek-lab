# ADR 0002 — Payment Ownership Separation (Stage 1A)

- **Status:** Accepted (architecture); Stage 1 overall acceptance deferred to Terra
- **Date:** 2026-09-15
- **Baseline:** Stage 0 `stage0-fulfillment-foundation` / `9b35fae`

## Rule

Before initiating any payment mechanism, the backend derives:

`beneficiary ∈ { MERCHANT, PLATFORM }` and `purpose`

from trusted domain subjects — never from client claims.

## Critical guard

WeKonnek centrally configured PayCools **MUST NOT** initiate `MERCHANT_ORDER` payments.

Platform charges (subscription, listing fees, wallet reload) may continue to use WeKonnek PayCools.

## Models

- `MerchantPaymentMethod` — merchant/shop acceptance config (CASH, MERCHANT_QR, BANK_TRANSFER)
- `OrderPaymentAllocation` — issuance-time component ownership snapshot
- `MerchantPaymentEvidence` — customer proof → merchant verify/reject
- `WkOrder.merchantPaymentStatus` — merchant-direct payment lifecycle

## Authority

`PaymentRoutingService` is the single decision layer.

## Non-goals

Rider Advance, Trust Trade 2.0, pickup QR, delivery confirmation, merchant PayCools onboarding, split-payment processing, migration-baseline debt.
