ALTER TABLE "bazaar_listings"
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspended_by" UUID,
  ADD COLUMN "suspension_reason" TEXT,
  ADD COLUMN "status_before_suspension" TEXT;

CREATE INDEX "bazaar_listings_status_created_at_idx" ON "bazaar_listings"("status", "created_at");
