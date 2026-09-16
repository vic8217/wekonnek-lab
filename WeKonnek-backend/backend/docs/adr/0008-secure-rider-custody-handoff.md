# ADR 0008 — Secure Rider-to-Rider Custody Handoff (Stage 7 Option B-lite)

- **Status:** Accepted (implementation under Stage 7 acceptance)
- **Date:** 2026-09-16
- **Parent:** Stage 6 secure merchant return handoff (ADR 0007)

## Purpose

Secure **mid-possession physical custody transfer** between riders after
reassignment without treating assignment alone as possession. Outgoing rider
issues short-lived QR (`WKRR1`) + OTP; pending incoming rider confirms;
authoritative `RIDER_TRANSFER_RELEASED` then `RIDER_TRANSFER_RECEIVED` custody
events; atomic assignment finalize via
`RiderAssignmentService.finalizeMidPossessionTransferInTx`.

## Chosen model (Option B-lite)

Mid-possession reassignment sets `pendingCustodyIncomingRiderId` **without**
flipping `activeRiderId`. Outgoing remains active assignee and physical
custodian until incoming confirms the handoff capability.

## Explicit non-goals / DEFERRED

| Item | Decision |
|------|----------|
| Redelivery / failed-delivery product flows | **DEFERRED.** Out of Stage 7. |
| Payment refund / PayCools mutation | Out of scope. Custody ≠ payment. |
| Rider Advance principal / creditor mutation on handoff | Creditor preservation follows existing Stage 4 / 5B reassignment rules; handoff itself does not invent new money semantics. |
| Push / SMS notifications | Out of scope for this stage. |

## Authority

| Actor | Rule |
|-------|------|
| Outgoing active rider (= physical custodian) | May issue capability only when `pendingCustodyIncomingRiderId` is set; incoming is bound from that field (not body) |
| Pending incoming rider | Validates / confirms; only trusted confirm path records transfer custody + finalizes assignment |
| Customer / merchant | No rider-transfer custody authority |
| Public `POST /custody-events` | Must not grant transfer authority via client booleans or residual enum labels |

`RIDER_TRANSFER_RELEASED` / `RIDER_TRANSFER_RECEIVED` are controlled Stage 7
**internal transaction events**. Application/service authorization remains
authoritative. Residual PostgreSQL enum labels alone confer **no** authority.

## Possession vs assignment

- `activeRiderId` — operational assignee
- `physicalCustodianRiderId` — last proven physical possession (pickup confirm or rider transfer confirm)
- Delivery / return capability issuance requires both assignee and custodian authority (`assertPossessionDependentRiderAuthority`)

## Derived operational flags

- `CUSTODY_TRANSFER_PENDING` when `pendingCustodyIncomingRiderId` is set
- `ASSIGNMENT_CUSTODY_MISMATCH` when custodian and active assignee diverge

## PostgreSQL rollback policy (Stage 7)

**Classification**

| Concern | Requirement |
|---------|-------------|
| Structural rollback | **REQUIRED** |
| Enum label reversal | **NOT REQUIRED** / known PostgreSQL limitation |

Rollback **must** remove active Stage 7 structure and behavior:

1. no Stage 7 tables remain
2. no Stage 7 columns remain
3. no Stage 7 indexes remain
4. no Stage 7 constraints remain
5. no Stage 7 triggers/functions remain
6. no Stage 7 active capability remains
7. no public API can create authoritative rider-transfer custody
8. frozen Stage 0–6 behavior remains valid
9. residual enum labels alone have no authoritative behavioral effect
10. limitation is explicitly documented (this ADR)

PostgreSQL enum additions are **forward-only** for practical migration safety.
PostgreSQL does not provide safe ordinary `DROP VALUE` semantics. Rebuilding a
shared frozen enum (`CustodyEventType`) solely to remove unused labels
introduces greater migration risk than retaining unused labels.

Therefore after rollback, residual labels:

- `RIDER_TRANSFER_RELEASED`
- `RIDER_TRANSFER_RECEIVED`

are **ACCEPTABLE irreversible schema residue**. They are **not** active Stage 7
functionality and are **not by themselves** an architecture-review trigger.

**DO NOT** recreate the frozen `CustodyEventType` enum solely to remove these
labels. **DO NOT** perform destructive enum surgery.

Migration forward path **must** safely reapply after rollback when those labels
already exist (`ADD VALUE IF NOT EXISTS` / equivalent). Application denial of
public forging of transfer events must remain effective even when labels exist.

## Historical acceptance DB policy

Frozen historical acceptance DBs are never schema-upgraded merely to satisfy a
newer Prisma client. Stage 7 contamination status (do not repair):

| Database | Stage 7 status |
|----------|----------------|
| `wekonnek_stage5_test` | Contaminated by Stage 7 DDL |
| `wekonnek_stage5b_test` | Contaminated by Stage 7 DDL |
| `wekonnek_stage6_test` | Contaminated by Stage 7 DDL |
| `wekonnek_stage3_test` | Not modified by Stage 7 |
| `wekonnek_stage4_test` | Not modified by Stage 7 |

Current-schema Stage 0–6 regression uses disposable
`wekonnek_stage7_regression_test` (not a historical acceptance DB).

Future stages: dedicated stage acceptance DB **and** disposable current-schema
regression DB (or equivalent isolation).

## Stage 5B production release gate (preserved)

Application DB role must remain non-owner / non-superuser, with no settlement
ledger `TRUNCATE` and no trigger bypass. Stage 7 does not weaken this gate.
