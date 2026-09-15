# ADR 0003 — Agreement / Evidence / Custody Foundation (Stage 2A)

- **Status:** Accepted (architecture); Stage 2 overall acceptance deferred to Terra
- **Date:** 2026-09-15
- **Baselines:** Stage 0 `9b35fae`, Stage 1 `ce17630`

## Principle

Durable server records answer: what was agreed, who, role, order, version, when, how, evidence, amendments, custody — without relying on mutable UI/order fields alone.

## Types

- `MERCHANT_TRADE` — upgraded Trust Trade (dual-write with legacy `TrustTradeTransaction`)
- `RIDER_ADVANCE` — schema only; operational activation refused

## Canonical terms

`WEKONNEK-AGREEMENT-V1` + SHA-256 of deterministically serialized JSON.

## Provenance

- `LEGACY_SNAPSHOT` — auto Trust Trade ensure (not explicit acceptance)
- `EXPLICIT_ACCEPTANCE` — after required party acceptances

## Non-goals

QR pickup, Rider Advance execution, delivery OTP, payment routing changes, fulfillment bypass.
