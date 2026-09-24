-- Rollback UCE-2 canonical rider location identity.
-- Dropping wk_order_id discards canonical samples recorded after the forward
-- migration. Legacy order_id rows are untouched.

DROP INDEX IF EXISTS "rider_locations_order_id_idx";
DROP INDEX IF EXISTS "rider_locations_wk_order_id_recorded_at_idx";

ALTER TABLE "rider_locations"
  DROP CONSTRAINT IF EXISTS "rider_locations_single_order_identity";

ALTER TABLE "rider_locations"
  DROP CONSTRAINT IF EXISTS "rider_locations_wk_order_id_fkey";

ALTER TABLE "rider_locations"
  DROP COLUMN IF EXISTS "accuracy",
  DROP COLUMN IF EXISTS "wk_order_id";
