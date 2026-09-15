-- Rollback for 20260915190000_stage3a_secure_pickup_handoff

ALTER TABLE "pickup_handoff_tokens" DROP CONSTRAINT IF EXISTS "pickup_handoff_tokens_custody_event_id_fkey";
ALTER TABLE "pickup_handoff_tokens" DROP CONSTRAINT IF EXISTS "pickup_handoff_tokens_rider_id_fkey";
ALTER TABLE "pickup_handoff_tokens" DROP CONSTRAINT IF EXISTS "pickup_handoff_tokens_merchant_id_fkey";
ALTER TABLE "pickup_handoff_tokens" DROP CONSTRAINT IF EXISTS "pickup_handoff_tokens_fulfillment_id_fkey";
ALTER TABLE "pickup_handoff_tokens" DROP CONSTRAINT IF EXISTS "pickup_handoff_tokens_wk_order_id_fkey";

DROP TABLE IF EXISTS "pickup_handoff_tokens";
DROP TYPE IF EXISTS "PickupHandoffTokenStatus";
DROP TYPE IF EXISTS "PickupHandoffPurpose";
