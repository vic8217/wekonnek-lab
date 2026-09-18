-- Stage 12 Trust Trade non-conformance amendment (additive).
-- Parent: 20260917200000_stage12_exception_financial_liability
-- Does NOT rewrite Stage 8/11 semantics — only adds reason/trigger labels.
-- Rollback: see rollback.sql (enum labels may remain as irreversible residue).

-- Stage 12–owned enum labels
DO $$ BEGIN
  ALTER TYPE "EconomicLossKind" ADD VALUE IF NOT EXISTS 'GOODS_NON_CONFORMING';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ExceptionClaimType" ADD VALUE IF NOT EXISTS 'GOODS_NON_CONFORMANCE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "ClaimEvidenceKind" ADD VALUE IF NOT EXISTS 'ORDER_TERMS_SNAPSHOT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "ClaimEvidenceKind" ADD VALUE IF NOT EXISTS 'DELIVERY_ATTEMPT_REFERENCE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "ClaimEvidenceKind" ADD VALUE IF NOT EXISTS 'OPERATIONS_RECOVERY_REFERENCE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "VerifiedFactType" ADD VALUE IF NOT EXISTS 'GOODS_NON_CONFORMANCE_CONFIRMED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "VerifiedFactType" ADD VALUE IF NOT EXISTS 'GOODS_CONFORMANCE_CONFIRMED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "VerifiedFactType" ADD VALUE IF NOT EXISTS 'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Narrow additive Stage 8 failure reason (operational allegation only).
DO $$ BEGIN
  ALTER TYPE "DeliveryFailureReasonCode" ADD VALUE IF NOT EXISTS 'CUSTOMER_REFUSED_ITEM_NOT_AS_ORDERED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Narrow additive Stage 11 recovery trigger.
DO $$ BEGIN
  ALTER TYPE "OperationsRecoveryTrigger" ADD VALUE IF NOT EXISTS 'CUSTOMER_REFUSED_NON_CONFORMANCE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GoodsNonConformanceReasonCode" AS ENUM (
    'WRONG_ITEM',
    'WRONG_VARIANT',
    'WRONG_SIZE',
    'WRONG_COLOR',
    'WRONG_QUANTITY',
    'MISSING_ITEM',
    'MATERIAL_SPEC_MISMATCH',
    'OTHER_NON_CONFORMANCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "exception_claims"
  ADD COLUMN IF NOT EXISTS "non_conformance_reason_code" "GoodsNonConformanceReasonCode";

ALTER TABLE "exception_claims"
  DROP CONSTRAINT IF EXISTS "exception_claims_non_conformance_reason_check";

ALTER TABLE "exception_claims"
  ADD CONSTRAINT "exception_claims_non_conformance_reason_check"
  CHECK (
    ("claim_type" <> 'GOODS_NON_CONFORMANCE'::"ExceptionClaimType"
      AND "non_conformance_reason_code" IS NULL)
    OR
    ("claim_type" = 'GOODS_NON_CONFORMANCE'::"ExceptionClaimType"
      AND "non_conformance_reason_code" IS NOT NULL)
  );
