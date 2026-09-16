-- Stage 6: secure merchant return handoff (additive)
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "MerchantReturnHandoffPurpose" AS ENUM ('MERCHANT_RETURN_HANDOFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MerchantReturnHandoffTokenStatus" AS ENUM (
    'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "merchant_return_handoff_tokens" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "otp_hash" VARCHAR(64) NOT NULL,
  "purpose" "MerchantReturnHandoffPurpose" NOT NULL DEFAULT 'MERCHANT_RETURN_HANDOFF',
  "status" "MerchantReturnHandoffTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "return_rider_id" UUID NOT NULL,
  "rider_assignment_id" UUID NOT NULL,
  "assignment_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "consumed_by_user_id" UUID,
  "merchant_confirmed_at" TIMESTAMPTZ,
  "merchant_confirmed_by_user_id" UUID,
  "custody_event_id" UUID,
  "otp_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "otp_locked_until" TIMESTAMPTZ,
  "confirm_idempotency_key" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "revoke_reason" VARCHAR(255),
  CONSTRAINT "merchant_return_handoff_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merchant_return_handoff_tokens_otp_attempts_check"
    CHECK ("otp_failed_attempts" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_token_hash_key"
  ON "merchant_return_handoff_tokens"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_otp_hash_key"
  ON "merchant_return_handoff_tokens"("otp_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_custody_event_id_key"
  ON "merchant_return_handoff_tokens"("custody_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_confirm_idempotency_key_key"
  ON "merchant_return_handoff_tokens"("confirm_idempotency_key");

-- At most one ACTIVE token per fulfillment + purpose
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_active_fulfillment_purpose_key"
  ON "merchant_return_handoff_tokens"("fulfillment_id", "purpose")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_fulfillment_id_status_idx"
  ON "merchant_return_handoff_tokens"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_wk_order_id_status_idx"
  ON "merchant_return_handoff_tokens"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_merchant_id_status_idx"
  ON "merchant_return_handoff_tokens"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_return_rider_id_status_idx"
  ON "merchant_return_handoff_tokens"("return_rider_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_status_expires_at_idx"
  ON "merchant_return_handoff_tokens"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "merchant_return_handoff_tokens_assignment_idx"
  ON "merchant_return_handoff_tokens"("rider_assignment_id", "assignment_version");

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_return_rider_id_fkey"
    FOREIGN KEY ("return_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_rider_assignment_id_fkey"
    FOREIGN KEY ("rider_assignment_id") REFERENCES "rider_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_return_handoff_tokens"
    ADD CONSTRAINT "merchant_return_handoff_tokens_custody_event_id_fkey"
    FOREIGN KEY ("custody_event_id") REFERENCES "custody_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
