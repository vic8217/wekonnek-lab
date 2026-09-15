# ADR 0005 — Rider Advance Authorization & Obligation (Stage 4A)

- **Status:** Accepted (architecture); Stage 4 overall acceptance deferred
- **Date:** 2026-09-15
- **Baselines:** Stage 0–3 (`9b35fae`, `ce17630`, `3971197`, `85456e6`)

## Purpose

Enable **cash-only** merchants with explicit `allowRiderAdvance=ON` so a
**customer** may authorize the **currently assigned rider** to use the rider’s
**own money** up to a maximum, then create a customer→rider reimbursement
obligation for the **actual** acknowledged amount.

## Explicit non-goals

WeKonnek is **not** the advancing party. Not PayCools. Not wallet advance.
Not Stage 3 goods release. Not automated reimbursement collection.

## Separations

| Concept | Distinct from |
|---------|----------------|
| Rider Advance authorization | Fulfillment assignment |
| Actual advance claim | Vendor acknowledgment |
| Vendor cash ack | Stage 3 MERCHANT_RELEASED / picked_up |
| Reimbursement principal | Authorized maximum (ceiling only) |
| Convenience fee (extension) | Merchandise / delivery fee / advance principal |
| Payment ownership (Stage 1) | Rider→vendor cash path |

## Eligibility

1. Enabled `MerchantPaymentMethod` kind `CASH`
2. `Merchant.allowRiderAdvance = true`

## Lifecycle

`PROPOSED → CUSTOMER_AUTHORIZED → RIDER_ACCEPTED → ADVANCE_RECORDED →
VENDOR_ACKNOWLEDGED → REIMBURSEMENT_DUE` (+ `DISPUTED` / `CANCELLED` /
`REIMBURSED` extension)

## Stage 3 integration

For orders with an active Rider Advance, pickup confirm requires status in
`VENDOR_ACKNOWLEDGED | REIMBURSEMENT_DUE | REIMBURSED`. Non-RA orders unchanged.

## Reassignment

Assignment version bound. New rider does not inherit prior acceptance;
authorization is cancelled/superseded and must be re-authorized.

## Agreement

Uses Stage 2 `AgreementType.RIDER_ADVANCE` via controlled `RiderAdvanceService`
only — not generic agreement CRUD.

## Client architecture (production)

| Actor | Production client | Stage 4A API surface |
|-------|-------------------|----------------------|
| Customer | Native Android/iOS **and** customer web/PWA | Same authorize/amend/get/cancel APIs |
| Rider | Native Android/iOS **only** | Same accept/record/get APIs (no `/pwa` vs `/native` split) |
| Merchant | Merchant PWA/web | Vendor acknowledgment API |
| Coordinator / Admin | PWA/web | Audit/read per existing policy |

Any rider-facing PWA in the repo is **temporary development/UAT only** — not
production rider architecture. Temporary UAT and future native rider use the
**same** canonical backend contract.

### Authority

All eligibility, assignment currency, maximums, vendor ack, pickup permission,
and reimbursement principal are **server-authoritative**. No React/PWA local
state is trusted for security or financial correctness. Identities come from
JWT bearer (`JwtAuthGuard` / `ExtractJwt.fromAuthHeaderAsBearerToken`) — not
cookies for API authorization.

### Canonical rider native flow

```
GET  /orders/:orderId/rider-advance
POST /rider-advances/:id/accept
     (rider pays merchant with own cash)
POST /rider-advances/:id/record-advance
     (poll/get until REIMBURSEMENT_DUE / vendor ack)
POST /orders/:orderId/pickup-token   (Stage 3)
     (display QR; merchant PWA confirms → picked_up)
```

### Native-distinguishable outcomes (examples)

| Outcome | Signal |
|---------|--------|
| Success | `200/201`, resource status advanced |
| Idempotent retry | `{ idempotent: true }` |
| Stale assignment | `ASSIGNMENT_CHANGED` / `ASSIGNMENT_STALE` |
| Max exceeded | `EXCEEDS_AUTHORIZED_MAXIMUM` |
| Vendor ack required (pickup) | `RIDER_ADVANCE_VENDOR_ACK_REQUIRED` |
| Amount mismatch | `{ mismatch: true }`, status `DISPUTED` |
| Not allowed | status-gated `BadRequest` / `Forbidden` |
| Auth disabled / ineligible | `RIDER_ADVANCE_DISABLED` / `CASH_METHOD_REQUIRED` |

Customer native and customer web share one authorize path; merchant ack remains
Merchant PWA calling the same backend-enforced endpoint.

## Stage 4 PostgreSQL acceptance notes

Dedicated DB: `wekonnek_stage4_test` / role `wekonnek_stage4_test`.

`prisma db push` does **not** reproduce these migration raw invariants; they were
applied to `wekonnek_stage4_test` only after identity verification:

1. CHECK `rider_advances_authorized_maximum_nonneg_check`
2. CHECK `rider_advances_actual_nonneg_check`
3. CHECK `rider_advances_actual_lte_max_check` (`actual <= authorized maximum`)
4. CHECK `rider_advances_vendor_ack_nonneg_check`
5. Partial unique `rider_advances_active_wk_order_id_key` (`status <> CANCELLED`)
6. Stage 3 pickup partial unique `pickup_handoff_tokens_active_fulfillment_purpose_key`
   (required for Stage 3 pickup tests on the Stage 4 schema)
