-- Rollback for 20260916190000_stage5b_rider_advance_settlement

DROP TRIGGER IF EXISTS rider_advance_settlement_append_only_trg ON "rider_advance_settlements";
DROP FUNCTION IF EXISTS rider_advance_settlement_append_only_guard();

DROP TRIGGER IF EXISTS rider_advance_settlement_immutable_trg ON "rider_advance_settlements";
DROP FUNCTION IF EXISTS rider_advance_settlement_immutable_guard();

ALTER TABLE "rider_advance_settlements" DROP CONSTRAINT IF EXISTS "rider_advance_settlements_creditor_rider_id_fkey";
ALTER TABLE "rider_advance_settlements" DROP CONSTRAINT IF EXISTS "rider_advance_settlements_customer_id_fkey";
ALTER TABLE "rider_advance_settlements" DROP CONSTRAINT IF EXISTS "rider_advance_settlements_wk_order_id_fkey";
ALTER TABLE "rider_advance_settlements" DROP CONSTRAINT IF EXISTS "rider_advance_settlements_rider_advance_id_fkey";

DROP TABLE IF EXISTS "rider_advance_settlements";
DROP TYPE IF EXISTS "RiderAdvanceSettlementStatus";
DROP TYPE IF EXISTS "RiderAdvanceSettlementMethod";
