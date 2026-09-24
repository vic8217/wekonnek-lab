-- UCE-2: give rider location samples a canonical WkOrder identity.
-- Additive columns and indexes only. Existing legacy rows keep order_id
-- and a null wk_order_id. They are neither rewritten, backfilled, nor deleted.
-- Rollback: see rollback.sql

ALTER TABLE "rider_locations"
  ADD COLUMN "wk_order_id" INTEGER,
  ADD COLUMN "accuracy" DOUBLE PRECISION;

ALTER TABLE "rider_locations"
  ADD CONSTRAINT "rider_locations_wk_order_id_fkey"
  FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A sample belongs to exactly one order identity, never both.
ALTER TABLE "rider_locations"
  ADD CONSTRAINT "rider_locations_single_order_identity"
  CHECK (NOT ("order_id" IS NOT NULL AND "wk_order_id" IS NOT NULL));

CREATE INDEX "rider_locations_wk_order_id_recorded_at_idx"
  ON "rider_locations" ("wk_order_id", "recorded_at");

CREATE INDEX "rider_locations_order_id_idx"
  ON "rider_locations" ("order_id");
