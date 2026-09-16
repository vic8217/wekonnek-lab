# ADR 0010 — Return Financial Determination (Stage 9)

## Status
Accepted (implementation in working tree; freeze deferred)

## Context
After Stage 6 physical return (`returned` + `RETURN_RECEIVED`) and Stage 8 operational
exception handling, merchandise may return to the merchant while Rider Advance
reimbursement history (Stage 5B) remains. Historical money must never be reversed.
WeKonnek is not a payment processor and must not hold, net, or onward-transfer
commerce / repayment / refund funds.

## Decision

### Non-reversal
Stage 5B remains a positive Customer→Rider ledger only. No negative settlements,
no mutation of `reimbursementPrincipal`, no erasure of ACKNOWLEDGED rows.
Return resolution creates **new** Stage 9 determination / obligation / settlement /
collection-restriction records.

### Allocation formula (FINALIZED QUALIFYING_FULL_RETURN + Rider Advance)
Under `RiderAdvance` lock:

- `P = reimbursementPrincipal` (must be > 0; never invented from return alone)
- `R = SUM(ACKNOWLEDGED Stage 5B)` re-read at finalize (`0 ≤ R ≤ P`)
- Merchant→Rider **REPAYMENT** = `P − R` if > 0
- Merchant→Customer **REFUND** = `R` if > 0
- `RiderAdvanceCollectionRestriction` ACTIVE with `restrictedAmount = P − R` when `P − R > 0`

### Collectibility
```
customerCollectibleRemaining =
  max(0, P − SUM(5B ACK) − SUM(ACTIVE restrictions))
```
Single choke point: `RiderAdvanceCollectibilityService`, consulted by Stage 5B
claim/cash/ack after `FOR UPDATE` on RA. Reject
`CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED` when insufficient.

### Race (Stage 5B final reimbursement vs Stage 9 finalize)
Serializable txn + RA lock → exactly one coherent Outcome A or B.
Forbidden: customer pays remaining **and** merchant owes rider the same remaining.

### Terms gate
New versioned Stage 9 terms (`ReturnFinancialTermsVersion`). Legacy orders without
accepted Stage 9 terms → `RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED` (no auto
formula). Never mutate old terms hashes. Server resolves terms; reject client-spoofed hash.

### Ordinary merchant payment
`VERIFIED` stays `VERIFIED`. Do not trust `declaredAmount`. Require explicit
merchant-acknowledged `refundPrincipal`. Create `MERCHANT_TO_CUSTOMER_REFUND` only;
no RA restriction. RA path and ordinary path are mutually exclusive.

### Authority
- Creditor = `RiderAdvance.riderId` only (not active/physical/return rider)
- Merchant **owner only** for determination acknowledge/finalize
- Customer for refund ack/cash
- Admin adjudication audited only — no evidence fabrication

### Processor boundary
Stage 9 records obligations and external settlement acknowledgments only.
WeKonnek does not hold or transfer funds; PayCools/WK wallet are not refund rails.

### Deferred — BENEFICIARY_RECOVERY_REQUIRED
Architecture specifies flagging `BENEFICIARY_RECOVERY_REQUIRED` when the original
creditor rider account is unavailable/deleted, while keeping the obligation bound
to `RiderAdvance.riderId`. Stage 9 does **not** implement account-unavailable
detection or the ops-state flag in this freeze; legal recovery remains a future
stage. Documented here so product acceptance does not invent soft behavior.

## Consequences
- Stage 5B/6/7/8 semantics preserved
- Collectibility decoupled from historical principal
- Activation gated on legal terms review before production obligation creation
- Beneficiary recovery ops exposure deferred (see above)
