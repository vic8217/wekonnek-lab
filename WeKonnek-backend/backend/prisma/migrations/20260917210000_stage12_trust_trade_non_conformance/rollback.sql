-- Structural rollback for Stage 12 Trust Trade non-conformance amendment.
-- Enum label reversal is NOT performed (PostgreSQL limitation / Stage 7 policy).
-- Residual labels remain irreversible schema residue and confer no authority alone.

ALTER TABLE "exception_claims"
  DROP CONSTRAINT IF EXISTS "exception_claims_non_conformance_reason_check";

ALTER TABLE "exception_claims"
  DROP COLUMN IF EXISTS "non_conformance_reason_code";

DROP TYPE IF EXISTS "GoodsNonConformanceReasonCode";
