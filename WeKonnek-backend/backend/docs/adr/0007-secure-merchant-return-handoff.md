# ADR 0007 — Secure Merchant Return Handoff (Stage 6 Option C)

- **Status:** Accepted (implementation under Stage 6 acceptance)
- **Date:** 2026-09-16
- **Parent:** Stage 5B `d87ab692346120a164804d6f2f126e00cc346d1e`
  (`stage5b-rider-advance-settlement`)

## Purpose

Secure final **merchant receipt of returned goods** for marketplace `WkOrder`
fulfillments via short-lived rider-issued QR (`WKRH1`) + OTP capability,
merchant-authenticated confirmation, authoritative `RETURN_RECEIVED` custody,
and atomic `returning → returned` transition.

## Explicit non-goals / DEFERRED

| Item | Decision |
|------|----------|
| Mandatory GPS / photo / video / structured **failed-delivery evidence** | **DEFERRED.** Stage 6 secures final merchant return receipt only. Existing `delivery_failed` reason/metadata behavior remains as-is. Redelivery and richer failed-delivery evidence are future product decisions. |
| Admin HTTP **operational integrity** endpoint | **DEFERRED.** Service-layer integrity flags on `GET /orders/:orderId/operational-state` are required and implemented. Optional admin integrity HTTP surface is not mandatory for Stage 6. |
| Payment refund / PayCools mutation on return | Out of scope. Return ≠ refund. Stage 1 payment ownership unchanged. |
| Rider Advance principal / creditor mutation | Out of scope. Stage 4 / 5B invariants unchanged. |

## Authority

| Actor | Rule |
|-------|------|
| Active return rider | May issue return capability; **cannot** self-finalize `returned` or author `RETURN_RECEIVED` |
| Merchant (owner/staff of bound merchant) | Confirms handoff; only trusted path creates `RETURN_RECEIVED` |
| Customer | No `RETURN_RECEIVED` / return finalize |
| Public `POST /custody-events` | Never grants secure-return authority; no client boolean |
| `SYSTEM_ADMIN` / `SYSTEM` | May recover `returned` only with **server-side** actor type + mandatory `reason` + `correlationId` (not spoofable from public body as `INTERNAL_SERVICE`) |

Internal secure-return authorization is constructed only by
`CustodyEventService.recordSecureMerchantReturnReceiptInTx` (trusted backend).

## Derived operational state

Read-only projection from fulfillment + custody + merchant payment + rider
advance / settlements. No persisted `operationalStatus`.
