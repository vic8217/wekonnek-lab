-- Rollback for 20260916180000_stage5a_secure_customer_delivery_handoff
-- Note: PostgreSQL cannot easily remove enum values; lifecycle values remain inert.

ALTER TABLE "customer_delivery_handoff_tokens" DROP CONSTRAINT IF EXISTS "customer_delivery_handoff_tokens_custody_event_id_fkey";
ALTER TABLE "customer_delivery_handoff_tokens" DROP CONSTRAINT IF EXISTS "customer_delivery_handoff_tokens_delivery_rider_id_fkey";
ALTER TABLE "customer_delivery_handoff_tokens" DROP CONSTRAINT IF EXISTS "customer_delivery_handoff_tokens_customer_id_fkey";
ALTER TABLE "customer_delivery_handoff_tokens" DROP CONSTRAINT IF EXISTS "customer_delivery_handoff_tokens_fulfillment_id_fkey";
ALTER TABLE "customer_delivery_handoff_tokens" DROP CONSTRAINT IF EXISTS "customer_delivery_handoff_tokens_wk_order_id_fkey";

DROP TABLE IF EXISTS "customer_delivery_handoff_tokens";
DROP TYPE IF EXISTS "CustomerDeliveryHandoffTokenStatus";
DROP TYPE IF EXISTS "CustomerDeliveryHandoffPurpose";
