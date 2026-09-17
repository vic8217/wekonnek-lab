# ADR 0011 — Redelivery Authorization (Stage 10)

## Status
Accepted (implementation in working tree; freeze deferred)

## Context
After Stage 8 delivery failure, merchandise may remain with the rider while the
customer wants another delivery attempt to the **same** address. Stage 9 return
financial determination is orthogonal and must block redelivery when active.
Stage 5A customer handoff remains the only successful delivery authority.

## Decision

### Policy
- `MAX_DELIVERY_ATTEMPTS = 3` (centralized in `redelivery.policy.ts`)
- No redelivery fees / money mutations
- `SAME_AS_ORDER` address only; address change rejected
- Merchant visibility only; **no** merchant approval for same-address retry
- Customer confirm → automatic backend activation (`INTERNAL_SERVICE`
  `delivery_failed → in_transit`); customer does **not** transition fulfillment
- Window: 1–4 hours, start future, ≤7 days ahead, timezone `Asia/Manila`;
  lazy expiry if no scheduler
- `SUCCESSFUL_HANDOFF` DeliveryAttempt on Stage 5A confirm **only** for Stage 10
  `ACTIVATED` legs (not retroactive ordinary Stage 5A)
- `returned` + `RETURN_RECEIVED` = terminal `REDELIVERY_TERMINAL_RETURN`
- Stage 9 determination `PENDING|PROPOSED|ACKNOWLEDGED|DISPUTED|FINALIZED` or
  open return obligations = block (`FINALIZED` →
  `REDELIVERY_FINANCIAL_RESOLUTION_FINALIZED`)
- Notifications deferred

### Aggregate: `RedeliveryAuthorization`
Lifecycle: `REQUESTED → CONFIRMED → ACTIVATED | CANCELLED | EXPIRED | REJECTED`

Prefer `OrderDomainEvent` over a separate event table.

### Fulfillment edge
`delivery_failed → in_transit` added to the state machine. Marketplace `wkOrder`
path blocked for rider/customer generic transitions (`USE_REDELIVERY_ACTIVATION`),
mirroring Stage 8's `USE_DELIVERY_FAILURE_REPORT` pattern.

### Lock order (compatible with Stages 5A / 7 / 8 / 9)
Stage 10 Serializable transactions take locks in this order:

1. `orders` (`wkOrderId`) `FOR UPDATE`
2. `order_fulfillments` `FOR UPDATE`
3. `redelivery_authorizations` `FOR UPDATE`
4. Secondary under fulfillment: `operational_cases`,
   `customer_delivery_handoff_tokens` (revoke / resolve)

**Prior stages (audit):**
| Stage | Primary lock |
|-------|----------------|
| 5A confirm | `customer_delivery_handoff_tokens` then fulfillment via `transitionInTx` |
| 7 confirm | custody token then `order_fulfillments` |
| 8 reportFailure | `order_fulfillments` |
| 9 finalize | `orders` → `order_fulfillments` → determination → `rider_advances` |

Stage 10 never locks tokens/auth **before** order+fulfillment. Cross-stage races
with Stage 5A (token-first) are resolved by Serializable isolation + bounded
retry (`P2034` / `P2002` / `40P01`).

### Activation side effects
1. Resolve prior `DELIVERY_FAILURE` case (`RESOLVED`, redelivery provenance)
2. Revoke ACTIVE Stage 5A delivery tokens
3. Transition `delivery_failed → in_transit` via `INTERNAL_SERVICE`
4. Mark authorization `ACTIVATED`

### Failure path
Failed redelivery uses Stage 8 `reportFailure` only (new case episode).
Stage 8 also revokes ACTIVE Stage 5A tokens on failure.
After attempt 3 failed → `REDELIVERY_ATTEMPT_LIMIT_REACHED` +
`OPERATIONS_RECOVERY_REQUIRED`.

### Different rider
Stage 7 custody transfer required. Pending transfer blocks activation
(`REDELIVERY_CUSTODY_TRANSFER_REQUIRED`).

### Non-goals
Collectibility / RA / payment / notifications untouched.

## Consequences
- Attempt budget is collectibility-gated via `evaluateRedeliveryAttemptCollectibility`
- Auth runs before idempotency cache; cross-order key reuse conflicts
- Historical Stage 0–9 acceptance DBs remain frozen
