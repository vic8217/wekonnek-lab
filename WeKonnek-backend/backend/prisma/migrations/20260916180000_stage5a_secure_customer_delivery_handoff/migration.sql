-- Stage 5A: secure customer delivery handoff + failed-delivery lifecycle (additive)
-- Rollback: see rollback.sql

-- Failed-delivery lifecycle (FulfillmentStatus + legacy OrderStatus)
DO $$ BEGIN
  ALTER TYPE "FulfillmentStatus" ADD VALUE 'delivery_failed';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "FulfillmentStatus" ADD VALUE 'returning';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "FulfillmentStatus" ADD VALUE 'returned';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'delivery_failed';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'returning';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'returned';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerDeliveryHandoffPurpose" AS ENUM ('CUSTOMER_DELIVERY_HANDOFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerDeliveryHandoffTokenStatus" AS ENUM (
    'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "customer_delivery_handoff_tokens" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "otp_hash" VARCHAR(64) NOT NULL,
  "purpose" "CustomerDeliveryHandoffPurpose" NOT NULL DEFAULT 'CUSTOMER_DELIVERY_HANDOFF',
  "status" "CustomerDeliveryHandoffTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "delivery_rider_id" UUID NOT NULL,
  "rider_assignment_id" UUID NOT NULL,
  "assignment_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "consumed_by_user_id" UUID,
  "customer_confirmed_at" TIMESTAMPTZ,
  "customer_confirmed_by_user_id" UUID,
  "custody_event_id" UUID,
  "otp_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "otp_locked_until" TIMESTAMPTZ,
  "confirm_idempotency_key" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "revoke_reason" VARCHAR(255),
  CONSTRAINT "customer_delivery_handoff_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_delivery_handoff_tokens_otp_failed_nonneg_check"
    CHECK ("otp_failed_attempts" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_token_hash_key"
  ON "customer_delivery_handoff_tokens"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_otp_hash_key"
  ON "customer_delivery_handoff_tokens"("otp_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_custody_event_id_key"
  ON "customer_delivery_handoff_tokens"("custody_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_confirm_idempotency_key_key"
  ON "customer_delivery_handoff_tokens"("confirm_idempotency_key");
-- At most one ACTIVE token per fulfillment + purpose
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_active_fulfillment_purpose_key"
  ON "customer_delivery_handoff_tokens"("fulfillment_id", "purpose")
  WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_fulfillment_id_status_idx"
  ON "customer_delivery_handoff_tokens"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_wk_order_id_status_idx"
  ON "customer_delivery_handoff_tokens"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_customer_id_status_idx"
  ON "customer_delivery_handoff_tokens"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_delivery_rider_id_status_idx"
  ON "customer_delivery_handoff_tokens"("delivery_rider_id", "status");
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_status_expires_at_idx"
  ON "customer_delivery_handoff_tokens"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "customer_delivery_handoff_tokens_assignment_idx"
  ON "customer_delivery_handoff_tokens"("rider_assignment_id", "assignment_version");

DO $$ BEGIN
  ALTER TABLE "customer_delivery_handoff_tokens"
    ADD CONSTRAINT "customer_delivery_handoff_tokens_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_delivery_handoff_tokens"
    ADD CONSTRAINT "customer_delivery_handoff_tokens_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_delivery_handoff_tokens"
    ADD CONSTRAINT "customer_delivery_handoff_tokens_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_delivery_handoff_tokens"
    ADD CONSTRAINT "customer_delivery_handoff_tokens_delivery_rider_id_fkey"
    FOREIGN KEY ("delivery_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_delivery_handoff_tokens"
    ADD CONSTRAINT "customer_delivery_handoff_tokens_custody_event_id_fkey"
    FOREIGN KEY ("custody_event_id") REFERENCES "custody_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
