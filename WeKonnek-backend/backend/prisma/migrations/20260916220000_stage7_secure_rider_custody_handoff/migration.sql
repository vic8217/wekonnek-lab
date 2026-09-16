-- Stage 7: secure rider-to-rider custody handoff (additive)
-- Rollback: see rollback.sql

DO $$ BEGIN
  ALTER TYPE "CustodyEventType" ADD VALUE IF NOT EXISTS 'RIDER_TRANSFER_RELEASED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "CustodyEventType" ADD VALUE IF NOT EXISTS 'RIDER_TRANSFER_RECEIVED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderCustodyHandoffPurpose" AS ENUM ('RIDER_CUSTODY_HANDOFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderCustodyHandoffTokenStatus" AS ENUM (
    'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "order_fulfillments"
  ADD COLUMN IF NOT EXISTS "physical_custodian_rider_id" UUID,
  ADD COLUMN IF NOT EXISTS "pending_custody_incoming_rider_id" UUID,
  ADD COLUMN IF NOT EXISTS "pending_custody_from_assignment_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "pending_custody_requested_at" TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_physical_custodian_rider_id_fkey"
    FOREIGN KEY ("physical_custodian_rider_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "order_fulfillments"
    ADD CONSTRAINT "order_fulfillments_pending_custody_incoming_rider_id_fkey"
    FOREIGN KEY ("pending_custody_incoming_rider_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "order_fulfillments_physical_custodian_rider_id_status_idx"
  ON "order_fulfillments"("physical_custodian_rider_id", "status");

CREATE TABLE IF NOT EXISTS "rider_custody_handoff_tokens" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "otp_hash" VARCHAR(64) NOT NULL,
  "purpose" "RiderCustodyHandoffPurpose" NOT NULL DEFAULT 'RIDER_CUSTODY_HANDOFF',
  "status" "RiderCustodyHandoffTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "outgoing_rider_id" UUID NOT NULL,
  "incoming_rider_id" UUID NOT NULL,
  "source_rider_assignment_id" UUID NOT NULL,
  "source_assignment_version" INTEGER NOT NULL,
  "target_assignment_version" INTEGER,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "consumed_by_user_id" UUID,
  "incoming_confirmed_at" TIMESTAMPTZ,
  "release_custody_event_id" UUID,
  "receipt_custody_event_id" UUID,
  "otp_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "otp_locked_until" TIMESTAMPTZ,
  "confirm_idempotency_key" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" UUID NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "revoke_reason" VARCHAR(255),
  CONSTRAINT "rider_custody_handoff_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rider_custody_handoff_tokens_otp_attempts_check"
    CHECK ("otp_failed_attempts" BETWEEN 0 AND 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_token_hash_key"
  ON "rider_custody_handoff_tokens"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_otp_hash_key"
  ON "rider_custody_handoff_tokens"("otp_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_release_custody_event_id_key"
  ON "rider_custody_handoff_tokens"("release_custody_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_receipt_custody_event_id_key"
  ON "rider_custody_handoff_tokens"("receipt_custody_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_confirm_idempotency_key_key"
  ON "rider_custody_handoff_tokens"("confirm_idempotency_key");

-- At most one ACTIVE capability per fulfillment + purpose
CREATE UNIQUE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_active_fulfillment_purpose_key"
  ON "rider_custody_handoff_tokens"("fulfillment_id", "purpose")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_fulfillment_id_status_idx"
  ON "rider_custody_handoff_tokens"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_wk_order_id_status_idx"
  ON "rider_custody_handoff_tokens"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_outgoing_rider_id_status_idx"
  ON "rider_custody_handoff_tokens"("outgoing_rider_id", "status");
CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_incoming_rider_id_status_idx"
  ON "rider_custody_handoff_tokens"("incoming_rider_id", "status");
CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_status_expires_at_idx"
  ON "rider_custody_handoff_tokens"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "rider_custody_handoff_tokens_source_assignment_idx"
  ON "rider_custody_handoff_tokens"("source_rider_assignment_id", "source_assignment_version");

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_outgoing_rider_id_fkey"
    FOREIGN KEY ("outgoing_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_incoming_rider_id_fkey"
    FOREIGN KEY ("incoming_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_source_rider_assignment_id_fkey"
    FOREIGN KEY ("source_rider_assignment_id") REFERENCES "rider_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_release_custody_event_id_fkey"
    FOREIGN KEY ("release_custody_event_id") REFERENCES "custody_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_custody_handoff_tokens"
    ADD CONSTRAINT "rider_custody_handoff_tokens_receipt_custody_event_id_fkey"
    FOREIGN KEY ("receipt_custody_event_id") REFERENCES "custody_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
