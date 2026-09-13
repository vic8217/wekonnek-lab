-- AlterEnum: lost-success reconciliation state for ACCURA issuance jobs
ALTER TYPE "AccuraIssuanceJobStatus" ADD VALUE 'PENDING_RECONCILIATION';

-- Cached production eligibility on merchant ACCURA link
ALTER TABLE "accura_merchant_links"
  ADD COLUMN "last_production_eligible" BOOLEAN;
