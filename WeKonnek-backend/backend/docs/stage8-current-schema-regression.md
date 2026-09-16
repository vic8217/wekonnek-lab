# Stage 8 current-schema regression acceptance

Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
Prisma client. Stage 8 uses:

| Role | Database |
|------|----------|
| A) Stage 8 acceptance | `wekonnek_stage8_test` |
| B) Disposable current-schema regression | `wekonnek_stage8_regression_test` |

Before every schema mutation against the regression DB:

```sql
SELECT current_database(), current_user;
-- Required: wekonnek_stage8_regression_test
```

`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` loads `.env.stage8.regression.test`
via `loadStageTestEnv` (Stage 8 tip).

See `docs/adr/0009-delivery-failure-operational-case.md`.

## Measured results (2026-09-16)

### Stage 8 acceptance (`wekonnek_stage8_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `delivery-failure*` (architecture + migration + postgres + http) | 4 | **38 passed** | PASS |

### Current-schema invariants (`wekonnek_stage8_regression_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `current-schema-invariants.postgres.spec.ts` (Stages 3–8) | 1 | **7 passed** | PASS |

### Stage 0–7 postgres suites under `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`

| Stage / suite | Tests | Result | Notes |
|---------------|-------|--------|-------|
| Stage 0A `fulfillment.postgres` | 7 passed | PASS | |
| Stage 1A `payment-ownership.postgres` | 7 passed | PASS | |
| Stage 3A `pickup-handoff.postgres` | 14 passed | PASS | |
| Stage 4A `rider-advance.postgres` | 13 passed | PASS | |
| Stage 5A `delivery-handoff.postgres` | 11 passed | PASS | Helpers use `INTERNAL_SERVICE` for marketplace `delivery_failed` (Stage 8 close) |
| Stage 5B `rider-advance-settlement.postgres` | 31 passed | PASS | |
| Stage 6 `return-handoff.postgres` | 10 passed | PASS | Same INTERNAL_SERVICE helper update |
| Stage 6 `order-operational-state.postgres` | 15 passed | PASS | |
| Stage 7 `rider-custody-handoff.postgres` | 18 passed | PASS | Now uses `loadStageTestEnv` + Stage 8 regression DB |

**Totals (regression postgres path above):** 9 suites, **126 passed / 0 failed / 0 skipped** (plus 7 invariant tests).

### Build / hygiene

| Check | Result |
|-------|--------|
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Known gaps / intentional non-runs

1. **Tracking WebSocket** (`order-status-update`) is **orderV2-only** (`tracking.gateway.ts`). Marketplace `wkOrder` bypass is closed on `FulfillmentTransitionService` (covered by Stage 8 HTTP + postgres). No Socket.IO e2e against wkOrder was added.
2. **Stage 7 migration.spec / http.int** still bind historically to `wekonnek_stage7_test` and were not re-run as Stage 8 regression (postgres acceptance suites above are the regression focus).
3. Accidental `i18n/` copy created by Nest HTTP test bootstrap may appear locally; ignored via `.gitignore`.
4. Hollow admin `delivery_failed` without Stage 8 attempt remains allowed and flagged (`DELIVERY_FAILED_WITHOUT_ATTEMPT`) — by design.

## How to re-run

```bash
# Acceptance
export DATABASE_URL='postgresql://victor@127.0.0.1:5432/wekonnek_stage8_test?host=/var/run/postgresql'
npx jest --testPathPatterns=delivery-failure --runInBand --forceExit

# Regression tip
export WEKONNEK_CURRENT_SCHEMA_REGRESSION=1
# loads .env.stage8.regression.test
npx jest --testPathPatterns=current-schema-invariants --runInBand --forceExit
npx jest --testPathPatterns='fulfillment.postgres|payment-ownership.postgres|pickup-handoff.postgres|rider-advance.postgres|delivery-handoff.postgres|rider-advance-settlement.postgres|return-handoff.postgres|order-operational-state.postgres|rider-custody-handoff.postgres' --runInBand --forceExit
```
