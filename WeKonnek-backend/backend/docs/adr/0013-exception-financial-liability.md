# ADR 0013 — Exception Financial Liability & Claims (Stage 12)

## Status
Accepted (implementation in working tree; freeze deferred)

## Context
Stage 11 closes an `OperationsRecovery` with disposition
`FINANCIAL_REVIEW_REQUIRED` when goods are lost, damaged, never returned, or an
advance/payment cannot be recovered through ordinary fulfillment. Stage 11
deliberately stops there: it is operational orchestration and owns no money.

Stage 9 (`ReturnFinancialDetermination`) already owns *return* money on the
qualifying-return path. Stage 12 must recover exception losses **without**
paying the same loss twice and **without** redesigning Stage 9, 5B, 7 or 11.

Independent Terra acceptance found defect
`STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY`: Stage 12 can FINALIZE positive
liability while Stage 9 is **not yet** return-money-eligible (e.g. Trust Trade
non-conformance before goods return). Later Stage 6 `RETURN_RECEIVED` makes
Stage 9 eligible. Frozen Stage 9 historically had no awareness of
`EconomicLoss` / coverage, so it could independently FINALIZE overlapping
money for the same economic subject. Existing Race E only proved
Stage 9-first → Stage 12.

## Decision

### Aggregates
| Model | Role |
|-------|------|
| `ExceptionLiabilityPolicyVersion` | Versioned, hashed liability policy snapshot |
| `EconomicLoss` | Server-owned *subject of recovery* — what was actually lost |
| `EconomicLossCoverage` | Append-only ledger of everything already covering that loss |
| `ExceptionClaim` | Investigation lifecycle over one `EconomicLoss` |
| `ExceptionClaimEvidence` / `ExceptionClaimVerification` | Append-only evidence + SYSTEM_ADMIN verification |
| `VerifiedFact` | Immutable admin conclusion drawn from VERIFIED evidence |
| `LiabilityDetermination` + `LiabilityAllocation` | Who owes what, and on what basis |
| `ExceptionFinancialObligation` | The resulting payable |

Claim lifecycle:
`OPEN → EVIDENCE_REVIEW → VERIFIED → DETERMINATION_PROPOSED → FINALIZED`
with terminal `REJECTED | WITHDRAWN | CANCELLED`. Terminal claims are immutable.

### Eligibility (strict Stage 11 lineage)
A claim may only be opened from an `OperationsRecovery` that is `CLOSED` (or
`DISPOSITION_SELECTED`) **and** carries `currentDisposition =
FINANCIAL_REVIEW_REQUIRED`. There is no generic "any open recovery" entry
point — liability always has Stage 11 provenance.

### Cross-stage financial authority (Stage 9 ↔ Stage 12)
For economic principals Stage 9 is about to monetize, Stage 9 and Stage 12 must
never independently create overlapping financial liability.

#### Stage9EconomicScope (conceptual; not persisted)
Stage 9 `QUALIFYING_FULL_RETURN` is **order-level**:

| Field | Meaning |
|---|---|
| `grossPrincipal` | RA `P` or ordinary refund principal (goods; **fees excluded**) |
| `merchantToRiderAmount` | `P−R` (RA path) |
| `merchantToCustomerAmount` | `R` or ordinary refund |
| `goodsScope` | always `WHOLE_ORDER` (Stage 9 cannot finalize Item B only) |
| `includedLossKinds` | goods-class + RA/payment kinds Stage 9 formula contains; never `OTHER` |

#### Containment (not exact subject equality)
A Stage 12 `EconomicLoss` **blocks** Stage 9 finalize when:

1. `lossKind ∈ Stage9EconomicScope.includedLossKinds`, and
2. `subjectRef` is economically contained in WHOLE_ORDER goods/RA scope
   (`order-goods:{id}`, `order-nonconformance:{id}`, `rider-advance:{id}`,
   **or** any `order-item:…` / quantity sub-ref), and
3. **effective** Stage 12 coverage `> 0`
   (`Σ STAGE12_OBLIGATION − Σ ADMIN_WRITE_OFF − Σ EXTERNAL_RECOVERY`).

Therefore Item A ₱500 Stage 12 coverage blocks later whole-order Stage 9 ₱800.
Stage 9 does **not** auto-net to ₱300 — remaining item economics proceed via
Stage 11 `FINANCIAL_REVIEW_REQUIRED` → Stage 12 claim/determination/adjustment.
`OTHER` / fee-external subjects outside the formula do **not** block Stage 9.

| Stage 9 obligation type | Import / containment loss kinds |
|---|---|
| `MERCHANT_TO_RIDER_ADVANCE_REPAYMENT` | `RIDER_ADVANCE_UNRECOVERED`, goods-class |
| `MERCHANT_TO_CUSTOMER_REFUND` | `CUSTOMER_PAYMENT_UNRECOVERED`, goods-class |

### Race strategy

#### Stage 12 finalize gate (unchanged intent)
Stage 12 `finalizeDetermination` **refuses** when either holds:

1. A Stage 9 determination on the order is in
   `PENDING | PROPOSED | ACKNOWLEDGED | DISPUTED`
   → `STAGE9_DETERMINATION_IN_PROGRESS`
2. The order is Stage 9 **return-money-eligible** (`fulfillment.status =
   returned` **and** a `RETURN_RECEIVED` custody event exists) while no
   `FINALIZED` Stage 9 determination exists yet
   → `STAGE9_RETURN_MONEY_PENDING`

When a `FINALIZED` Stage 9 determination *does* exist, Stage 12 imports
**same-subject** coverage from its obligations before computing remaining.

#### Stage 9 integration guard (authorized after Terra findings)
A **minimal** Stage 9 finalize guard is the only authorized frozen-stage
behavioral change. Inside Stage 9's existing Serializable finalize transaction,
**after** determination / order / fulfillment / RiderAdvance locks and
**before** any FINALIZED mutation, obligation, or collection restriction:

1. Build `Stage9EconomicScope` from the proposed formula amounts
2. `SELECT … FOR UPDATE` all `economic_losses` on the order whose `loss_kind`
   is in `includedLossKinds` (stable id order) — empty scans still establish
   Serializable SIREAD predicate protection against phantom inserts
3. Re-read coverage; compute **effective Stage 12 coverage**
4. If any loss is **contained** in the scope with effective coverage **> 0**,
   refuse with `STAGE12_FINANCIAL_AUTHORITY_EXISTS`
5. Zero Stage 9 financial side effects on refuse

**What counts as Stage 12 authority:** only positive **effective** coverage from
`EconomicLossCoverage` rows with `sourceKind = STAGE12_OBLIGATION`. Mere claims,
evidence, VerifiedFacts, DRAFT/PROPOSED determinations, and zero-liability
finals do **not** block Stage 9.

**Effective coverage:**
`max(0, Σ STAGE12_OBLIGATION − Σ ADMIN_WRITE_OFF − Σ EXTERNAL_RECOVERY)`.
Stage 9 does **not** auto-net Stage 12 amounts.

**Remainder path:** when Stage 9 is blocked by item-level Stage 12 coverage,
operators resolve remaining order items via Stage 11
`FINANCIAL_REVIEW_REQUIRED` → Stage 12 claim/determination/adjustment — not by
guessing Stage 9 partial item allocation.

**Serialization / phantoms:** Stage 9 predicate-locks contained loss kinds on
the order under Serializable isolation. Concurrent Stage 12 insert/finalize of
a matching item-level loss must either block Stage 9 or abort/retry one side
so overlapping authorities never both commit. Bounded `withSerializableRetry`
remains. Pre-Stage 12 schemas: missing `economic_losses` → guard no-op.

Permanent regressions:
`STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY` and
`STAGE12_ITEM_LEVEL_STAGE9_ORDER_LEVEL_DOUBLE_RECOVERY`.

### Double-recovery control
`remaining = compensableAmount − Σ coverage`. Application code computes it, and
the `stage12_coverage_ceiling` trigger enforces `Σ coverage ≤ compensableAmount`
with `SELECT … FOR UPDATE` on the parent loss — so even a lost race cannot
over-recover. Coverage rows are append-only.

### Lock order
1. `orders`
2. `order_fulfillments`
3. `operations_recoveries`
4. `economic_losses`
5. `exception_claims`
6. `verified_facts`
7. `liability_determinations`
8. `exception_financial_obligations`

This strictly *extends* the Stage 11 order (`orders → order_fulfillments →
operations_recoveries`) rather than reordering it. Stage 9 finalize keeps
determination-first then orders → fulfillment → (RA) → **economic_losses**
(guard only).

### Platform is never liable
`ExceptionLiablePartyType` is `CUSTOMER | MERCHANT | RIDER`. `PLATFORM` is
absent from the enum, rejected by `stage12_allocation_guard`, rejected by
`stage12_obligation_reject_platform`, and rejected in
`exception-financial.policy.ts`. Losses with no liable party stay uncovered
rather than being silently absorbed.

### Fees
`compensableAmount` never auto-includes delivery or transaction fees. Fees are
computed into `feeComponentAmount` for audit and excluded from goods value, so
a claim can never recover platform/operational revenue.

### Determination immutability and adjustments
A `FINALIZED` determination is immutable (trigger-enforced), as are its
allocations. Corrections use `createAdjustment`, which opens a *new*
determination bound through `adjustmentOfDeterminationId`, keeping both the
original decision and the correction in the audit trail.

### Authorization
Every mutation is `UserRole.admin` (SYSTEM_ADMIN) only. Parties get a minimal
lifecycle read: no evidence bodies except `ALL_ORDER_PARTIES` visibility, and
only obligations they are personally party to.

### Trust Trade non-conformance (amendment)
Customer refusal for alleged wrong/incomplete goods is an **operational
allegation**, never automatic liability. Canonical claim type
`GOODS_NON_CONFORMANCE` + `GoodsNonConformanceReasonCode` (e.g. `WRONG_ITEM`)
opens investigation only. Liability still requires evidence → VerifiedFact →
policy → determination.

Verified facts:
- `GOODS_NON_CONFORMANCE_CONFIRMED` — may attribute merchant (or negligence)
- `GOODS_CONFORMANCE_CONFIRMED` / `NON_CONFORMANCE_ALLEGATION_UNSUPPORTED` —
  never attribute parties and cannot ground allocations

Additive Stage 8 reason `CUSTOMER_REFUSED_ITEM_NOT_AS_ORDERED` and Stage 11
trigger `CUSTOMER_REFUSED_NON_CONFORMANCE` are operational labels only.

### Reverse-race regression (Stage 12 integration guard)
Permanent tests named for `STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY`
reproduce: Stage 12 financial authority first → later Stage 6 return →
Stage 9 finalize refused. Also covered: claim/evidence/fact/draft/proposed/
zero-liability do not block; partial effective coverage blocks; unrelated
subjects do not block; true concurrent Stage 9 ∥ Stage 12 finalize yields one
coherent authority; Rider Advance creditor identity preserved with no Stage 5B
mutation.

## Consequences
- One active claim per `EconomicLoss` (partial unique index)
- One active (`DRAFT`/`PROPOSED`) determination per claim
- `EconomicLoss` identity (`economicLossKey`) is server-derived:
  `el:{wkOrderId}:{lossKind}:{sha256(subjectRef)[0..16]}`
- Compensable amount freezes once any coverage exists
- Stage 0–11 acceptance DBs remain frozen; current schema tip = Stage 12
- Stage 9 receives only the minimal overlap guard above; formulas, Stage 5B,
  Stage 6 custody, and payment ownership are unchanged
- Stage 13 execution / settlement remains out of scope
