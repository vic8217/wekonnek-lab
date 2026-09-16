# Stage 9 current-schema regression acceptance

Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
Prisma client. Stage 9 uses:

| Role | Database |
|------|----------|
| A) Stage 9 acceptance | `wekonnek_stage9_test` |
| B) Disposable current-schema regression | `wekonnek_stage9_regression_test` |

Created from `TEMPLATE wekonnek_stage8_test` then Stage 9 migration applied via
`psql`. Regression DB templated from `wekonnek_stage9_test` after migration.

Before every schema mutation against the regression DB:

```sql
SELECT current_database(), current_user;
-- Required: wekonnek_stage9_regression_test
```

`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` loads `.env.stage9.regression.test`
via `loadStageTestEnv` (Stage 9 tip).

See `docs/adr/0010-return-financial-determination.md`.

## Measured results (2026-09-16)

### Stage 9 acceptance (`wekonnek_stage9_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `return-financial*` (architecture + migration + postgres + http) | **4** | **29 passed** | PASS |

Breakdown: architecture **5** · migration rollback/reapply **1** · postgres **20** · http **3**.

Postgres covers: P/R proofs (0/300/800), no-principal, Stage5B↔Stage9 race,
stale Stage5B CLAIMED ACK after restriction, sequential dual finalize uniqueness,
concurrent dual finalize race, A/B/C creditor-only (return + delivery riders denied),
terms/legacy, ordinary path, cash/transfer/partial/overpay/idempotency/auth-before-cache,
dedicated partial→settle + overpay, cross-order idempotency conflict, FINALIZED
immutability + terminal settlement immutability + append-only DELETE.

HTTP covers: merchant happy path + privacy, return/delivery/coordinator/foreign
merchant/customer denial, Stage5B collection-restricted cash receipt.

Race: Promise.allSettled Stage5B cash + Stage9 finalize → coherent Outcome A or B;
forbidden double-collection state asserted absent.

### Current-schema invariants (`wekonnek_stage9_regression_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `current-schema-invariants.postgres.spec.ts` (Stages 3–9) | 1 | **8 passed** | PASS |

### Stage 0–8 postgres suites under `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`

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

**Totals (regression postgres path above):** 10 suites, **152 passed / 0 failed / 0 skipped**.

### Build / hygiene

| Check | Result |
|-------|--------|
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Secret audit (`.env.stage9.test` not tracked; examples use `CHANGE_ME`) | PASS |
| Commit / tag / push | **NONE** (uncommitted by design) |

## Known gaps / intentional non-runs (CG deferred)

1. **BENEFICIARY_RECOVERY_REQUIRED** ops-state exposure when creditor account is
   unavailable/deleted — deferred (ADR 0010); obligation remains bound to
   `RiderAdvance.riderId`; no invented soft recovery.
2. Stage 7/8 migration.spec + http.int historically bound to stage7/stage8
   acceptance DBs were not re-run as Stage 9 tip regression.
3. Dedicated non-owner PG role TRUNCATE denial not separately provisioned in CI
   (append-only DELETE triggers proven).
4. Legal review of Stage 9 terms wording required before production activation.
5. Parent `.gitignore` ignores untracked `*.md` under WeKonnek-backend; this file
   exists on disk — use `git add -f docs/stage9-current-schema-regression.md`
   when committing.
6. Worktree remains **UNCOMMITTED**.
