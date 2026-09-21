-- Stage15A rollback. Drop additive provenance only. Never rewrite evidence.
ALTER TABLE "exception_claim_evidence" DROP COLUMN IF EXISTS "provenance";
DROP TYPE IF EXISTS "ClaimEvidenceProvenance";
