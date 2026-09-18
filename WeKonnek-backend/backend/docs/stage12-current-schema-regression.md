# Stage 12 current-schema regression acceptance

Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
Prisma client. Stage 12 uses:

| Role | Database |
|------|----------|
| A) Stage 12 acceptance | `wekonnek_stage12_test` |
| B) Disposable current-schema regression | `wekonnek_stage12_regression_test` |
| C) Terra / disposable override | `wekonnek_stage12_terra_*` via `WEKONNEK_ACCEPTANCE_DATABASE_URL` |

Created from `TEMPLATE wekonnek_stage11_test` then Stage 12 migration applied via
`psql`. Regression DB templated from `wekonnek_stage12_test` after migration.

## Legacy Stage0–11 current-schema normalization

Stage0–11 PostgreSQL suites distinguish:

| Mode | Signal | Database identity |
|------|--------|-------------------|
| Historical stage acceptance | `WEKONNEK_CURRENT_SCHEMA_REGRESSION` unset | Stage-specific historical DB only (e.g. `wekonnek_stage4_test`) |
| Current-schema regression | `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` | Central disposable target via `assertLegacyPostgresSuiteIdentity` |

In current-schema mode, suites use `WEKONNEK_ACCEPTANCE_DATABASE_URL` (when set) or the tip
`wekonnek_stage12_regression_test`. Do **not** patch Terra DB names into per-suite allowlists.

`loadStageTestEnv` reloads `.env.stage12.regression.test` after stage-specific dotenv when
current-schema mode is on and no explicit override is set, so legacy suites are not left
bound to historical StageN URLs.

## Explicit acceptance DB override (Terra isolation)

Canonical env vars (acceptance infrastructure only):

| Variable | Purpose |
|----------|---------|
| `WEKONNEK_ACCEPTANCE_DATABASE_URL` | Full PostgreSQL URL to a disposable Stage 12 acceptance DB |
| `WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1` | Explicit opt-in required before destructive acceptance |

`loadStageTestEnv` snapshots the override **before** dotenv, then restores and
applies it **after** `.env.stage12.test` / `.env.stage12.regression.test` so
dotenv cannot silently replace Terra's target with `wekonnek_stage12_test`.

Safety requires **both**:

1. Database name matches an approved disposable rule:
   - `wekonnek_stage12_test`
   - `wekonnek_stage12_regression_test`
   - `wekonnek_stage12_terra_<suffix>` (`[a-z0-9_]+`)
2. `WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1`

Denied (fail closed before TRUNCATE / DROP / migration / fixture insert):

- `postgres`, `template0`, `template1`, empty/unknown names
- production/dev-like names (`wekonnek`, `wekonnek_prod`, `wekonnek_dev`, …)
- all historical Stage 0–11 acceptance and prior regression DBs
- any name not matching the disposable rules above

Before destructive work, suites call `SELECT current_database(), current_user`
via Prisma (and migration suites also via `psql`) and assert equality with the
resolved expected disposable DB. Credentials are never logged; URLs are redacted.

Example Terra invocation:

```bash
export WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1
export WEKONNEK_ACCEPTANCE_DATABASE_URL='postgresql://USER:PASS@127.0.0.1:5432/wekonnek_stage12_terra_final_test'
npx jest --runInBand src/exception-financial/exception-financial.postgres.spec.ts
```

Before every schema mutation against the regression DB:


```sql
SELECT current_database(), current_user;
-- Required: wekonnek_stage12_regression_test (or approved terra override)
```

`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` loads `.env.stage12.regression.test`
via `loadStageTestEnv` (Stage 12 tip; falls back to Stage 11 regression env only
if the Stage 12 file is not yet provisioned). An explicit
`WEKONNEK_ACCEPTANCE_DATABASE_URL` still wins when set.

See `docs/adr/0013-exception-financial-liability.md`.

## Measured results (2026-09-17)

### Stage 12 acceptance (`wekonnek_stage12_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `exception-financial*` (architecture + migration + postgres + concurrency + http + production-role) | **6** | **71 passed** | PASS |

### Current-schema invariants (`wekonnek_stage12_regression_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `current-schema-invariants.postgres.spec.ts` (Stages 3–12) | 1 | **11 passed** | PASS |

### Stage 0–11 postgres suites under `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`

| Stage / suite | Tests | Result |
|---------------|-------|--------|
| Stage 0A `fulfillment.postgres` | 7 passed | PASS |
| Stage 1A `payment-ownership.postgres` | 7 passed | PASS |
| Stage 3A `pickup-handoff.postgres` | 14 passed | PASS |
| Stage 4A `rider-advance.postgres` | 13 passed | PASS |
| Stage 5A `delivery-handoff.postgres` | 11 passed | PASS |
| Stage 5B `rider-advance-settlement.postgres` | 31 passed | PASS |
| Stage 6 `return-handoff.postgres` | 10 passed | PASS |
| Stage 6 `order-operational-state.postgres` | 15 passed | PASS |
| Stage 7 `rider-custody-handoff.postgres` | 18 passed | PASS |
| Stage 8 `delivery-failure.postgres` | 26 passed | PASS |
| Stage 9 `return-financial.postgres` | 21 passed | PASS |
| Stage 10 `redelivery.postgres` | 26 passed | PASS |
| Stage 11 `operations-recovery.postgres` | 26 passed | PASS |

**Totals (regression postgres path above + invariants):** 14 suites, **236 passed / 0 failed / 0 skipped**.

Prior-stage suites accept `wekonnek_stage12_regression_test` as the tip DB when
`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`. Stage 2 agreement/custody foundation has
no dedicated tip postgres suite in this matrix (same as Stages 9–11 reporting).

### Build / hygiene

| Check | Result |
|-------|--------|
| `npx nest build` | PASS |
| `git diff --check` | PASS |
| Secret audit (`.env.stage12.test` / `.env.stage12.regression.test` not tracked; examples use `CHANGE_ME`) | PASS |
| Commit / tag / push | **NONE** (uncommitted by design) |

### Gaps

- Historical Stage 0–11 acceptance DBs are not re-run as tip regression (intentional).
- Stage 13 settlement / execution is explicitly out of scope.
