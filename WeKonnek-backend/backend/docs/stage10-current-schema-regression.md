# Stage 10 current-schema regression acceptance

Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
Prisma client. Stage 10 uses:

| Role | Database |
|------|----------|
| A) Stage 10 acceptance | `wekonnek_stage10_test` |
| B) Disposable current-schema regression | `wekonnek_stage10_regression_test` |

Created from `TEMPLATE wekonnek_stage9_test` then Stage 10 migration applied via
`psql`. Regression DB templated from `wekonnek_stage10_test` after migration.

Before every schema mutation against the regression DB:

```sql
SELECT current_database(), current_user;
-- Required: wekonnek_stage10_regression_test
```

`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` loads `.env.stage10.regression.test`
via `loadStageTestEnv` (Stage 10 tip).

See `docs/adr/0011-redelivery-authorization.md`.

## Measured results (2026-09-17)

### Stage 10 acceptance (`wekonnek_stage10_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `redelivery*` (architecture + migration + postgres + http + production-role) | **5** | **38 passed** | PASS |

Breakdown: architecture **8** · migration rollback/reapply **1** · postgres **24** · http **2** · production-role **3**.

Postgres covers: same-rider 1→2 success / 1→2→3 success / attempt4 blocked,
pending Stage 7 custody block, token revoke, window boundaries, address change,
returned/returning blockers, dual-request race, auth-before-cache + cross-order
idempotency, ordinary Stage 5A without SUCCESSFUL_HANDOFF, rider generic
transition block, merchant visibility, Stage 9 PENDING/PROPOSED + FINALIZED
blockers, Stage 5A vs Stage 8 exclusivity race, Stage 9 finalize vs activate
race, activation vs RETURN_TO_MERCHANT, request vs RETURN_TO_MERCHANT,
concurrent Attempt4, dual Attempt N+1 activation, different-rider Stage 7
WKRR1 path + RA/payment preservation, same-rider money preservation,
IDEMPOTENCY_PAYLOAD_CONFLICT.

### Current-schema invariants (`wekonnek_stage10_regression_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `current-schema-invariants.postgres.spec.ts` (Stages 3–10) | 1 | **9 passed** | PASS |

### Stage 0–9 postgres suites under `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`

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

**Totals (regression postgres path above):** 11 suites, **173 passed / 0 failed / 0 skipped**.

With invariants: **12 suites, 182 passed / 0 failed / 0 skipped**.

Prior-stage suites accept `wekonnek_stage10_regression_test` as the tip DB when
`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`. Stage 2 agreement/custody foundation has
no dedicated tip postgres suite in this matrix (same as Stage 9 reporting).

### Build / hygiene

| Check | Result |
|-------|--------|
| `npm run build` / `npx nest build` | PASS |
| `git diff --check` | PASS |
| Secret audit (`.env.stage10.test` not tracked; examples use `CHANGE_ME`) | PASS |
| Commit / tag / push | **NONE** (uncommitted by design) |

### Gaps

1. **Production-role SET ROLE gate** requires `CREATEROLE` on the connecting user.
   Current `victor` lacks `CREATEROLE` (`rolcreaterole = f`). Attempted
   `ALTER USER victor CREATEROLE` as `postgres` failed (peer auth / sudo password
   required). Suite keeps owner-privilege + append-only DELETE trigger proof
   (documented infrastructure blocker, same pattern as Stage 9). Do **not**
   weaken assertions to fake PASS.
2. Stage 7/8/9 migration.spec + http.int historically bound to stage acceptance
   DBs were not re-run as Stage 10 tip regression (same intentional non-run as
   Stage 9 CG notes).
3. Parent `.gitignore` ignores untracked `*.md` under WeKonnek-backend; this file
   exists on disk — use `git add -f docs/stage10-current-schema-regression.md`
   when committing.
4. Worktree remains **UNCOMMITTED**.
