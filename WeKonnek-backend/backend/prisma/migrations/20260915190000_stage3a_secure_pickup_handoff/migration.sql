-- Stage 3A: secure merchant–rider pickup handoff tokens (additive)
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "PickupHandoffPurpose" AS ENUM ('MERCHANT_PICKUP_HANDOFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PickupHandoffTokenStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "pickup_handoff_tokens" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "purpose" "PickupHandoffPurpose" NOT NULL DEFAULT 'MERCHANT_PICKUP_HANDOFF',
  "status" "PickupHandoffTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "rider_id" UUID NOT NULL,
  "rider_assignment_id" UUID NOT NULL,
  "assignment_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "consumed_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID NOT NULL,
  "merchant_confirmed_at" TIMESTAMPTZ,
  "merchant_confirmed_by_user_id" UUID,
  "custody_event_id" UUID,
  "correlation_id" VARCHAR(64),
  "revoked_at" TIMESTAMPTZ,
  "revoke_reason" VARCHAR(255),
  CONSTRAINT "pickup_handoff_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pickup_handoff_tokens_token_hash_key"
  ON "pickup_handoff_tokens"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_handoff_tokens_custody_event_id_key"
  ON "pickup_handoff_tokens"("custody_event_id");
-- At most one ACTIVE token per fulfillment + purpose
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_handoff_tokens_active_fulfillment_purpose_key"
  ON "pickup_handoff_tokens"("fulfillment_id", "purpose")
  WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_fulfillment_id_status_idx"
  ON "pickup_handoff_tokens"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_wk_order_id_status_idx"
  ON "pickup_handoff_tokens"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_rider_id_status_idx"
  ON "pickup_handoff_tokens"("rider_id", "status");
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_merchant_id_status_idx"
  ON "pickup_handoff_tokens"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_status_expires_at_idx"
  ON "pickup_handoff_tokens"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "pickup_handoff_tokens_rider_assignment_id_assignment_version_idx"
  ON "pickup_handoff_tokens"("rider_assignment_id", "assignment_version");

DO $$ BEGIN
  ALTER TABLE "pickup_handoff_tokens" ADD CONSTRAINT "pickup_handoff_tokens_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pickup_handoff_tokens" ADD CONSTRAINT "pickup_handoff_tokens_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pickup_handoff_tokens" ADD CONSTRAINT "pickup_handoff_tokens_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pickup_handoff_tokens" ADD CONSTRAINT "pickup_handoff_tokens_rider_id_fkey"
    FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pickup_handoff_tokens" ADD CONSTRAINT "pickup_handoff_tokens_custody_event_id_fkey"
    FOREIGN KEY ("custody_event_id") REFERENCES "custody_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
