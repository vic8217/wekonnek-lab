-- Rollback for 20260915093000_stage0a_commerce_fulfillment_foundation
-- Safe only when no production dependents rely on these tables.
-- Prefer application rollback (redeploy prior build) before dropping schema.

ALTER TABLE "order_domain_events" DROP CONSTRAINT IF EXISTS "order_domain_events_order_v2_id_fkey";
ALTER TABLE "order_domain_events" DROP CONSTRAINT IF EXISTS "order_domain_events_fulfillment_id_fkey";
ALTER TABLE "order_domain_events" DROP CONSTRAINT IF EXISTS "order_domain_events_wk_order_id_fkey";
DROP TABLE IF EXISTS "order_domain_events";

ALTER TABLE "rider_assignments" DROP CONSTRAINT IF EXISTS "rider_assignments_rider_id_fkey";
ALTER TABLE "rider_assignments" DROP CONSTRAINT IF EXISTS "rider_assignments_fulfillment_id_fkey";
DROP TABLE IF EXISTS "rider_assignments";

ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_shop_id_fkey";
ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_merchant_id_fkey";
ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_active_rider_id_fkey";
ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_order_v2_id_fkey";
ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_wk_order_id_fkey";
DROP TABLE IF EXISTS "order_fulfillments";

DROP TYPE IF EXISTS "OrderDomainActorType";
DROP TYPE IF EXISTS "OrderDomainAggregateType";
DROP TYPE IF EXISTS "RiderAssignmentStatus";
DROP TYPE IF EXISTS "FulfillmentStatus";

ALTER TABLE "orders_v2" DROP COLUMN IF EXISTS "assignment_version";
