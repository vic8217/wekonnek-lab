# ADR 0009 — Failed Delivery / Operational Exception Foundation (Stage 8)

- **Status:** Accepted (implementation under Stage 8 acceptance)
- **Date:** 2026-09-16
- **Parent:** Stage 7 secure rider custody handoff (ADR 0008)

## Purpose

Establish the authoritative **failed delivery attempt** record and **operational
case** lifecycle so marketplace fulfillments never become `delivery_failed`
through a rider self-transition. Stage 8 is the single normal path that:

1. appends a `DeliveryAttempt` with `outcome=FAILED`
2. opens an `OperationalCase` (`DELIVERY_FAILURE` / `OPEN`)
3. transitions `in_transit → delivery_failed` via `INTERNAL_SERVICE`

## §68 acceptance points

| # | Requirement | Decision |
|---|-------------|----------|
| 1 | Attempt ≠ fulfillment status | `DeliveryAttempt` is append-oriented evidence; status change is a separate transition |
| 2 | One normal path to `delivery_failed` | Rider uses `POST /orders/:id/delivery-failures`; generic rider transition blocked |
| 3 | No second delivery authority | Does not invent customer-authenticated acceptance; rider-reported `customerResponse` stays rider provenance |
| 4 | Financial unchanged | No payment / refund / negative settlement mutations |
| 5 | Rider identity server-derived | JWT actor only; body `riderId` spoof rejected |
| 6 | Pending custody denied | `pendingCustodyIncomingRiderId` → `CUSTODY_TRANSFER_PENDING` |
| 7 | Active + physical custodian | Both `activeRiderId` and `physicalCustodianRiderId` must equal actor |
| 8 | Assignment version match | ACTIVE assignment at current `assignmentVersion` required |
| 9 | Server-derived attempt number | `max(attemptNumber)+1` under fulfillment `FOR UPDATE` |
| 10 | Idempotency | Same actor+key+payload → prior result; different payload → `IDEMPOTENCY_PAYLOAD_CONFLICT`; foreign actor never receives cached result |
| 11 | OTHER requires notes | Application + DB CHECK |
| 12 | Evidence refs only | Storage references / hashes — no binary payloads |
| 13 | Case opened atomically | Attempt + case + `CASE_OPENED` + status transition in one Serializable txn |
| 14 | Disposition admin-only | `SYSTEM_ADMIN` (`admin`/`staff`) with reason + correlationId |
| 15 | RETURN_TO_MERCHANT | May transition `delivery_failed → returning` (no `RETURN_RECEIVED`) |
| 16 | RESCHEDULE_REQUESTED | Record only — no auto `in_transit`, no Stage 5A token |
| 17 | Resolve does not fabricate | No custody / payment / RA invention on resolve |
| 18 | Append-only attempts/events | UPDATE/DELETE triggers on attempts, evidences, case events |
| 19 | Integrity flag | `DELIVERY_FAILED_WITHOUT_ATTEMPT` when status failed without FAILED attempt |
| 20 | Admin recovery separate | Admin may still use audited generic transition; hollow failures flagged |
| 21 | Legacy orderV2 | `wkOrderId == null` may still allow rider `delivery_failed` if needed |
| 22 | Close rider bypass | Remove from `RIDER_ALLOWED_TARGETS` **and** guard in `runTransitionInTx` |
| 23 | Operational flags | Case open, disposition required, reschedule pending, return confirmation pending, ops recovery, hollow failure |
| 24 | Non-goals | No refunds, redelivery product flow, notifications, negative settlements |
| 25 | Rollback | Structural rollback required; Stage 8–owned enums/tables fully droppable |
| 26 | Historical DBs | Stage 7 (+ earlier) acceptance DBs must not be mutated by Stage 8 suites |
| 27 | Domain events | `DELIVERY_ATTEMPT_FAILED`, `DELIVERY_FAILURE_CASE_OPENED`, disposition/resolve events |
| 28 | Privacy | List/get filtered by role |
| 29 | Race safety | Serializable + bounded retry (P2034/P2002/40P01) |
| 30 | Partial uniqueness | One open/`DISPOSITION_SELECTED` `DELIVERY_FAILURE` case per fulfillment |
| 31 | Location provenance | Coords require `RIDER_DEVICE_REPORTED` |
| 32 | Extensibility enums | `RETURN_REFUSED` / `CUSTODY_EXCEPTION` / `FINANCIAL_DISPUTE` unused |
| 33 | Merchant refuse return | Remains exceptional; Stage 8 does not auto-close |
| 34 | RA statuses unchanged | Failure report does not mutate Rider Advance |
| 35 | Merchant payment unchanged | Orthogonal to Stage 1A payment lifecycle |
| 36 | Evidence optional AgreementEvidence link | Refs only |
| 37 | CorrelationId on admin ops | Required with reason |
| 38 | No Stage 5A token on failure | Failure is not successful handoff |
| 39 | SUCCESSFUL_HANDOFF reserved | Schema outcome for future; Stage 8 writes FAILED only |
| 40 | Atomicity injection | **Required acceptance proof** — mid-txn abort must leave no hollow `delivery_failed` |
| 41 | Race vs Stage 5A confirm | **Required** — exclusive terminal: delivered+CUSTOMER_RECEIVED XOR failed+attempt |
| 42 | Race vs Stage 7 custody confirm | **Required** — coherent custodian; never incompatible A-failure + B-custody |
| 43 | Race vs reassignment | **Required** — coherent assignee / pending / failure outcome |
| 44 | Concurrent dual idempotency keys | **Required** — at most one FAILED attempt / open case |
| 45 | Rider refusal provenance | **Required** — REFUSED + `RIDER_REPORTED` metadata; never customer-auth |
| 46 | GPS provenance | **Required** — coords imply `RIDER_DEVICE_REPORTED` |
| 47 | RA status matrix | **Required** — no RA field mutation across lifecycle statuses |
| 48 | Merchant payment matrix | **Required** — AWAITING/VERIFIED/REJECTED unchanged |
| 49 | Merchant refuse return | **Required** — returning without RETURN_RECEIVED; case not auto-resolved |
| 50 | OPERATIONS_RECOVERY_REQUIRED flag | **Required** operational flag proof |
| 51 | INVALID_FULFILLMENT_STATE | **Required** when not `in_transit` |
| 52 | HTTP actor matrix | **Required** — pending/former/coordinator/merchant/customer privacy |
| 53 | REST/WS bypass close | **Required** — marketplace `wkOrder` transition path; gateway is orderV2-only (documented) |
| 54 | Current-schema regression | **Required** on `wekonnek_stage8_regression_test` (invariants + feasible Stage 0–7 suites) |
| 55–68 | Remaining operational / ADR hygiene | Documented constraints; expand suites as product surface grows |

> Rows 40–54 are **acceptance requirements**, not assumed-covered by earlier stages.
> See `docs/stage8-current-schema-regression.md` for measured suite counts.

## Authority

| Actor | Rule |
|-------|------|
| Active physical custodian rider | May report failure when `in_transit` and no pending custody transfer |
| SYSTEM_ADMIN | Disposition + resolve; audited |
| INTERNAL_SERVICE | Performs status transitions inside Stage 8 txn |
| Customer / merchant | Read privacy-filtered attempts/case; no failure authority |

## Explicit non-goals / DEFERRED

| Item | Decision |
|------|----------|
| Refunds / PayCools mutation | Out of scope |
| Automatic redelivery / Stage 5A re-issue | Out of scope (`RESCHEDULE_REQUESTED` is record-only) |
| Negative settlements | Out of scope |
| Push / SMS notifications | Out of scope |
| Customer-authenticated refusal | Out of scope — rider provenance only |

## PostgreSQL rollback policy (Stage 8)

**Classification**

| Concern | Requirement |
|---------|-------------|
| Structural rollback | **REQUIRED** |
| Enum label reversal | **REQUIRED** for Stage 8–owned types (safe `DROP TYPE`) |

Rollback **must** remove:

1. Stage 8 tables
2. Stage 8 indexes / constraints / partial uniques
3. Stage 8 triggers / functions
4. Stage 8–owned enum types

**Residue:** none expected. Forward reapply uses `IF NOT EXISTS` / `duplicate_object` guards.

## Historical acceptance DB policy

| Database | Stage 8 policy |
|----------|----------------|
| `wekonnek_stage7_test` | Forbidden for Stage 8 mutation / acceptance |
| `wekonnek_stage7_regression_test` | Forbidden for Stage 8 mutation |
| Prior stage `*_test` DBs | Historical / contaminated — never mutate |
| `wekonnek_stage8_test` | Stage 8 acceptance |
| `wekonnek_stage8_regression_test` | Disposable current-schema regression |

## Close bypass

Marketplace (`wkOrderId != null`): rider (and other non-trusted actors) transitioning
to `delivery_failed` throws `USE_DELIVERY_FAILURE_REPORT`.
`delivery_failed` removed from `RIDER_ALLOWED_TARGETS`.
