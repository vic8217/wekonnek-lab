-- Rollback for 20260916210000_stage6_secure_merchant_return_handoff

ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_custody_event_id_fkey";
ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_rider_assignment_id_fkey";
ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_return_rider_id_fkey";
ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_merchant_id_fkey";
ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_fulfillment_id_fkey";
ALTER TABLE "merchant_return_handoff_tokens" DROP CONSTRAINT IF EXISTS "merchant_return_handoff_tokens_wk_order_id_fkey";

DROP TABLE IF EXISTS "merchant_return_handoff_tokens";
DROP TYPE IF EXISTS "MerchantReturnHandoffTokenStatus";
DROP TYPE IF EXISTS "MerchantReturnHandoffPurpose";
