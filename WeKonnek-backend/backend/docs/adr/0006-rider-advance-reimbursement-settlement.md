# ADR 0006 — Rider Advance Reimbursement Settlement (Stage 5B)

- **Status:** Accepted / Frozen
- **Date:** 2026-09-16
- **Parent:** Stage 5A `3c6f123f64bd904fd378da57e831c6883dddb9ed`
  (`stage5a-secure-customer-delivery`)

## Purpose

Record **CUSTOMER → CREDITOR RIDER** reimbursement for an established
`RiderAdvance.reimbursementPrincipal` via append-only settlement ledger rows
(`CASH`, `DIRECT_TRANSFER`). WeKonnek records claim/evidence/ack/audit; it does
**not** receive or route merchandise principal.

## Explicit non-goals

No PayCools reimbursement. No WeKonnek reimbursement wallet. No automatic GCash
API transfer. No rider payment-destination profile management. No
`PARTIALLY_REIMBURSED` enum. Convenience fee remains deferred/separate.

## Authority

| Concept | Rule |
|---------|------|
| Principal | Frozen `RiderAdvance.reimbursementPrincipal` (not max / order / fees) |
| Creditor | `RiderAdvance.riderId` (never `activeRiderId`) |
| Authoritative amount | `acknowledgedAmount` on `ACKNOWLEDGED` rows only |
| DIRECT_TRANSFER | `0 < acknowledgedAmount <= claimedAmount` and `<= remaining` |
| Aggregate | `SUM(ACKNOWLEDGED acknowledgedAmount) <= principal` |

## Append-only ledger

Physical `DELETE` of **all** `rider_advance_settlements` rows is blocked by
`rider_advance_settlement_append_only_trg`. Terminal UPDATE immutability remains.
Parent FKs use `ON DELETE RESTRICT`. Corrections create new rows/evidence.

Disposable Stage 5B acceptance cleanup may `TRUNCATE` via identity-gated
`truncateSettlementsForStage5bTest` (**only** `wekonnek_stage5b_test`). That
helper is test-only and is not a production module export or Nest route.

## Deployment requirement (least privilege)

**PRODUCTION MUST NOT RUN THE APPLICATION AS DATABASE OWNER OR SUPERUSER.**

The production application DB role must:

- be non-owner
- not be superuser
- not have `TRUNCATE` on `rider_advance_settlements`
- not have trigger-disabling administrative privileges
- have only required application DML privileges

Append-only DELETE triggers cannot protect data from a superuser/owner
`TRUNCATE` or trigger-disable path. Enforce this at deployment.

## Separations

Delivery fulfillment transitions do not settle reimbursement. Settlement does
not transition fulfillment. Failed/returned delivery does not erase established
principal. Delivery fee and Stage 1 payment ownership remain unchanged.
