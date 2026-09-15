-- Stage 0A: commerce/fulfillment foundation (additive, backward compatible)
-- Rollback: see rollback.sql in this folder.

-- Concurrency token on legacy delivery orders
ALTER TABLE "orders_v2" ADD COLUMN IF NOT EXISTS "assignment_version" INTEGER NOT NULL DEFAULT 0;

-- Enums
DO $$ BEGIN
  CREATE TYPE "FulfillmentStatus" AS ENUM (
    'pending',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'rider_assigned',
    'picked_up',
    'in_transit',
    'delivered',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderAssignmentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'UNASSIGNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderDomainAggregateType" AS ENUM ('WK_ORDER', 'ORDER_FULFILLMENT', 'ORDER_V2');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderDomainActorType" AS ENUM (
    'CUSTOMER',
    'MERCHANT_OWNER',
    'MERCHANT_ADMIN',
    'MERCHANT_STAFF',
    'RIDER',
    'SYSTEM_ADMIN',
    'PAYMENT_PROVIDER',
    'INTERNAL_SERVICE',
    'SYSTEM',
    'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "order_fulfillments" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER,
  "order_v2_id" UUID,
  "status" "FulfillmentStatus" NOT NULL DEFAULT 'pending',
  "active_rider_id" UUID,
  "assignment_version" INTEGER NOT NULL DEFAULT 0,
  "delivery_pin" VARCHAR(12),
  "delivery_proof_photo" TEXT,
  "merchant_id" INTEGER,
  "shop_id" INTEGER,
  "customer_id" UUID,
  "cancelled_at" TIMESTAMPTZ,
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "order_fulfillments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_fulfillments_wk_order_id_key" ON "order_fulfillments"("wk_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "order_fulfillments_order_v2_id_key" ON "order_fulfillments"("order_v2_id");
CREATE INDEX IF NOT EXISTS "order_fulfillments_status_created_at_idx" ON "order_fulfillments"("status", "created_at");
CREATE INDEX IF NOT EXISTS "order_fulfillments_active_rider_id_status_idx" ON "order_fulfillments"("active_rider_id", "status");
CREATE INDEX IF NOT EXISTS "order_fulfillments_merchant_id_shop_id_idx" ON "order_fulfillments"("merchant_id", "shop_id");

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_order_v2_id_fkey"
    FOREIGN KEY ("order_v2_id") REFERENCES "orders_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_active_rider_id_fkey"
    FOREIGN KEY ("active_rider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "rider_assignments" (
  "id" UUID NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "order_v2_id" UUID,
  "rider_id" UUID NOT NULL,
  "status" "RiderAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignment_version" INTEGER NOT NULL,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by" UUID,
  "assigned_by_type" "OrderDomainActorType" NOT NULL DEFAULT 'SYSTEM',
  "unassigned_at" TIMESTAMPTZ,
  "reason" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rider_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rider_assignments_fulfillment_id_status_idx" ON "rider_assignments"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "rider_assignments_order_v2_id_status_idx" ON "rider_assignments"("order_v2_id", "status");
CREATE INDEX IF NOT EXISTS "rider_assignments_rider_id_status_idx" ON "rider_assignments"("rider_id", "status");

DO $$ BEGIN
  ALTER TABLE "rider_assignments"
    ADD CONSTRAINT "rider_assignments_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "rider_assignments"
    ADD CONSTRAINT "rider_assignments_rider_id_fkey"
    FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "order_domain_events" (
  "id" UUID NOT NULL,
  "event_id" VARCHAR(64) NOT NULL,
  "aggregate_type" "OrderDomainAggregateType" NOT NULL,
  "aggregate_id" VARCHAR(64) NOT NULL,
  "wk_order_id" INTEGER,
  "fulfillment_id" UUID,
  "order_v2_id" UUID,
  "actor_id" UUID,
  "actor_type" "OrderDomainActorType" NOT NULL DEFAULT 'UNKNOWN',
  "action" VARCHAR(80) NOT NULL,
  "previous_state" VARCHAR(50),
  "new_state" VARCHAR(50),
  "reason" VARCHAR(255),
  "correlation_id" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_domain_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_domain_events_event_id_key" ON "order_domain_events"("event_id");
CREATE INDEX IF NOT EXISTS "order_domain_events_aggregate_type_aggregate_id_created_at_idx"
  ON "order_domain_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_domain_events_wk_order_id_created_at_idx" ON "order_domain_events"("wk_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_domain_events_fulfillment_id_created_at_idx" ON "order_domain_events"("fulfillment_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_domain_events_order_v2_id_created_at_idx" ON "order_domain_events"("order_v2_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_domain_events_correlation_id_idx" ON "order_domain_events"("correlation_id");

DO $$ BEGIN
  ALTER TABLE "order_domain_events"
    ADD CONSTRAINT "order_domain_events_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_domain_events"
    ADD CONSTRAINT "order_domain_events_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_domain_events"
    ADD CONSTRAINT "order_domain_events_order_v2_id_fkey"
    FOREIGN KEY ("order_v2_id") REFERENCES "orders_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
