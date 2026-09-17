# Stage 11 current-schema regression acceptance

Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
Prisma client. Stage 11 uses:

| Role | Database |
|------|----------|
| A) Stage 11 acceptance | `wekonnek_stage11_test` |
| B) Disposable current-schema regression | `wekonnek_stage11_regression_test` |

Created from `TEMPLATE wekonnek_stage10_test` then Stage 11 migration applied via
`psql`. Regression DB templated from `wekonnek_stage11_test` after migration.

Before every schema mutation against the regression DB:

```sql
SELECT current_database(), current_user;
-- Required: wekonnek_stage11_regression_test
```

`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1` loads `.env.stage11.regression.test`
via `loadStageTestEnv` (Stage 11 tip).

See `docs/adr/0012-operations-recovery.md`.

## Measured results (2026-09-17)

### Stage 11 acceptance (`wekonnek_stage11_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `operations-recovery*` (architecture + migration + postgres + http + production-role) | **5** | **35 passed** | PASS |

Breakdown: architecture **8** · migration rollback/reapply **1** · postgres **22** · http **1** · production-role **3**.

Postgres covers: returning sticky / no fabricated `RETURN_RECEIVED`, hollow
returned + Stage 9 `RETURN_NOT_FINANCIALLY_ELIGIBLE` +
`HOLLOW_RETURNED_WITHOUT_MERCHANT_CUSTODY` (no `RETURN_COMPLETED`), attempt
budget / adminActivate cannot invent Attempt 4, pending-clear preserves
custodian (no `RIDER_TRANSFER_*`), report≠verified evidence, close does not
invent delivery/return/money, Stage 9 vocabulary separation, attempt-count
freeze, cross-order idempotency, auth-before-cache, concurrent one-active open,
**Stage 5A confirm vs Stage 11 open race**, **Stage 6 RETURN_RECEIVED vs open
race**, **Stage 7 custody confirm vs clearPending race**, **Stage 10
adminActivate vs open race**, **Stage 9 finalize vs Stage 11 close immutability**,
terminal immutable + append-only children, CONTACT/HOLD/CLEAR_PENDING closure
gates, ops flags (`OPERATIONS_RECOVERY_OPEN` suppresses
`DELIVERY_DISPOSITION_REQUIRED`).

### Current-schema invariants (`wekonnek_stage11_regression_test`)

| Suite | Suites | Tests | Result |
|-------|--------|-------|--------|
| `current-schema-invariants.postgres.spec.ts` (Stages 3–11) | 1 | **10 passed** | PASS |

### Stage 0–10 postgres suites under `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`

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

**Totals (regression postgres path above):** 12 suites, **199 passed / 0 failed / 0 skipped**.

With invariants: **13 suites, 209 passed / 0 failed / 0 skipped**.

Prior-stage suites accept `wekonnek_stage11_regression_test` as the tip DB when
`WEKONNEK_CURRENT_SCHEMA_REGRESSION=1`. Stage 2 agreement/custody foundation has
no dedicated tip postgres suite in this matrix (same as Stages 9–10 reporting).

### Build / hygiene

| Check | Result |
|-------|--------|
| `npm run build` / `npx nest build` | PASS |
| `git diff --check` | PASS |
| Secret audit (`.env.stage11.test` / `.env.stage11.regression.test` not tracked; examples use `CHANGE_ME`) | PASS |
| Commit / tag / push | **NONE** (uncommitted by design) |

### Gaps

1. **Production-role SET ROLE gate** requires `CREATEROLE` on the connecting user.
   Current `victor` lacks `CREATEROLE` (`rolcreaterole = f`). Suite keeps
   owner-privilege + append-only DELETE trigger proof (documented infrastructure
   blocker, same pattern as Stages 9/10). Do **not** weaken assertions to fake PASS.
2. Stage 7/8/9 migration.spec + http.int historically bound to stage acceptance
   DBs were not re-run as Stage 11 tip regression (same intentional non-run as
   Stages 9–10 CG notes).
3. Parent `.gitignore` ignores untracked `*.md` under WeKonnek-backend; this file
   exists on disk — use `git add -f docs/stage11-current-schema-regression.md`
   when committing.
4. Worktree remains **UNCOMMITTED**.
5. Stage 10 / Stage 11 mutual product gates (e.g. block redelivery activation while
   Stage 11 recovery is active) are not enforced in services — race tests assert
   coherent DB outcomes without inventing success via Stage 11, but both paths may
   succeed when Serializable isolation allows.
