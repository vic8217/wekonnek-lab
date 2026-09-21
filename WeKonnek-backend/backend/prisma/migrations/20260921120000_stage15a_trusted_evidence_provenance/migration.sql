-- Stage15A: additive trusted evidence provenance.
-- Historical rows keep provenance NULL (LEGACY_UNVERIFIED at the API).
-- No UPDATE of existing exception_claim_evidence rows.
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "ClaimEvidenceProvenance" AS ENUM (
    'SERVER_ATTESTED_ORDER_TERMS'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "exception_claim_evidence"
  ADD COLUMN IF NOT EXISTS "provenance" "ClaimEvidenceProvenance";
