# ADR 0012 — Operations Recovery (Stage 11)

## Status
Accepted (implementation in working tree; freeze deferred)

## Context
After Stage 8 delivery failure and Stage 10 attempt exhaustion (or other
exceptional blockers such as abandoned Stage 7 pending custody transfer,
hollow admin return, merchant return refusal), ordinary secure fulfillment
paths cannot safely complete. Stage 9 may surface financial outcome
`OPERATIONS_RECOVERY_REQUIRED` — that remains **financial vocabulary only**.

## Decision

### Aggregate: `OperationsRecovery` (Option B)
Stage 8 `OperationalCase` stays the delivery-failure **episode** aggregate.
Stage 11 owns long-lived exceptional recovery orchestration on a **new**
table `operations_recoveries`. Do **not** put Stage 11 FSM on Stage 8.

Lifecycle:
`OPEN → INVESTIGATING → DISPOSITION_SELECTED → CLOSED | CANCELLED`

Terminal `CLOSED`/`CANCELLED` are immutable. No reopen — open a new recovery.

### Product policy (locked)
- **A.** SYSTEM_ADMIN explicit open only — no `INTERNAL_SERVICE` auto-open
- **B.** Pending custody clear: event audit only (no fulfillment audit columns)
- **C.** No party self-service report endpoints in MVP
- **D.** Stage 8 may remain OPEN while Stage 11 is CLOSED; ops-state avoids
  misleading duplicate `DELIVERY_DISPOSITION_REQUIRED` when Stage 11 owns path
- **E.** Disposition-specific closure policy (centralized in
  `operations-recovery.policy.ts`)

### Hard ceilings
`MAX_DELIVERY_ATTEMPTS = 3` (imported from Stage 10). Stage 11 never resets
attempts, never adminActivates attempt 4, never fabricates `RETURN_RECEIVED`,
`CUSTOMER_RECEIVED`, or `RIDER_TRANSFER_*`.

### Lock order (compatible with Stages 5A / 7 / 8 / 9 / 10)
1. `orders` (`wkOrderId`) `FOR UPDATE`
2. `order_fulfillments` `FOR UPDATE`
3. `operations_recoveries` `FOR UPDATE`

Cross-stage races with token-first Stage 5A/7 paths use Serializable isolation
+ bounded `withSerializableRetry` (`P2034` / `P2002` / `40P01`).

### Pending clear semantics
`CLEAR_PENDING_CUSTODY_TRANSFER_INTENT` clears pending fields only, preserves
`physicalCustodianRiderId` and assignment/custody history, appends
`OperationsRecoveryEvent` + `OrderDomainEvent` with before/after — never emits
`RIDER_TRANSFER_RECEIVED` / `RIDER_TRANSFER_RELEASED`.

### Vocabulary separation
| Domain | Term | Meaning |
|--------|------|---------|
| Stage 8 disposition | `OPERATIONS_RECOVERY_REQUIRED` | Failure-episode ops signal |
| Stage 9 outcome | `OPERATIONS_RECOVERY_REQUIRED` | **financial vocabulary** |
| Stage 11 lifecycle | `OPEN`…`CLOSED` | Recovery orchestration |

### Non-goals
Financial liability (Stage 12), notifications, UI, fourth delivery attempt.

### Stage 10↔11 mutual exclusivity
Active Stage 11 statuses: `OPEN` | `INVESTIGATING` | `DISPOSITION_SELECTED`.

- **Stage 10 activation** (customer confirm auto-activate and `adminActivate`)
  rejects with `OPERATIONS_RECOVERY_ACTIVE` if any active Stage 11 recovery
  exists for the fulfillment (zero side-effects; confirm+activate atomic).
- **Stage 11 ordinary open** rejects with `REDELIVERY_ACTIVE` while a Stage 10
  authorization is `ACTIVATED`.
- **Investigative opens while ACTIVATED** (investigation only — cannot
  manufacture another delivery attempt / Stage 10 activation):
  `CUSTODY_UNCONFIRMED`, `CUSTODY_TRANSFER_ABANDONED`, `RIDER_UNAVAILABLE`,
  `GOODS_REPORTED_LOST`, `GOODS_REPORTED_DAMAGED`, `ADMIN_RECOVERY_REQUIRED`.
- Terminal Stage 11 (`CLOSED`/`CANCELLED`) does **not** permanently block
  Stage 10; attempt budget remains absolute.

## Consequences
- One active recovery per fulfillment (partial unique index)
- Auth before idempotency; cross-order key reuse conflicts
- Historical Stage 0–10 acceptance DBs remain frozen
- Current schema tip = Stage 11 acceptance + regression DBs
- Stage 10 and Stage 11 are alternative execution authorities
