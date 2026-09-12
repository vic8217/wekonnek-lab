-- Cache last ACCURA readiness percent for unavailable last-known display.
ALTER TABLE "accura_merchant_links"
  ADD COLUMN "last_readiness_percent" INTEGER;
