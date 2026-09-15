# ADR 0004 — Secure Merchant–Rider Pickup Handoff (Stage 3A)

- **Status:** Accepted (architecture); Stage 3 overall acceptance deferred
- **Date:** 2026-09-15
- **Baselines:** Stage 0 `9b35fae`, Stage 1 `ce17630`, Stage 2 `3971197`

## Purpose

Issue a short-lived, order-bound, assignment-bound, purpose-bound, single-use
pickup capability so an authenticated merchant operator can confirm release of
goods to the currently assigned rider.

## Threat model

- Screenshot / replay of QR after consumption, expiry, reassignment, or cancel
- Wrong merchant / wrong order redirection via client body
- Rider spoofing (`riderId` in request)
- Concurrent double-confirm
- Token enumeration / private data leakage on failed validate

## Canonical entities

- `WkOrder` — commerce
- `OrderFulfillment` + `RiderAssignment` — Stage 0 fulfillment / assignment
- `PickupHandoffToken` — capability (hash only; raw secret never stored)
- `CustodyEvent` (`MERCHANT_RELEASED`) — Stage 2 evidence
- `FulfillmentTransitionService` — `rider_assigned → picked_up`

## Explicit separations

| Concept | Not equal to |
|---------|----------------|
| CUSTODY EVENT | FULFILLMENT STATE |
| PICKUP CONFIRMATION | PAYMENT CONFIRMATION |
| PICKUP CONFIRMATION | RIDER ADVANCE / vendor cash ack |

## Token lifecycle

`ACTIVE` → `CONSUMED` | `EXPIRED` | `REVOKED`

Issuance policy: at most one `ACTIVE` token per `(fulfillment, purpose)`.
A new request revokes the prior ACTIVE token and issues a fresh secret.

## Assignment binding

Token stores `riderAssignmentId` + `assignmentVersion`. Confirm fails if the
current fulfillment active assignment/version differs — even if TTL remains.

## Merchant authorization

Owner or active merchant staff for the order’s merchant. Customer/rider/other
merchants denied. No private preview before merchant authorization succeeds.

## Atomicity

Confirm runs in one Serializable transaction:
consume token → custody `MERCHANT_RELEASED` → `transitionInTx(picked_up)` via
`INTERNAL_SERVICE` (Stage 0 allows system actors for `picked_up`; merchants
cannot call the fulfillment API directly for that transition).

## Rider Advance / payment / agreement

Inactive. No advance fields, payment mutation, or agreement acceptance.

## Future extension

Reusable inside future Rider Advance flows as the handoff step only — never as
proof of vendor cash payment.
