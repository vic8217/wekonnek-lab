-- Rollback for 20260916120000_stage4a_rider_advance_foundation

DROP TABLE IF EXISTS "rider_advances";
DROP TYPE IF EXISTS "RiderAdvanceStatus";
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "allow_rider_advance";
