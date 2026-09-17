-- Stage 10: Redelivery Authorization (additive)
-- Rollback: see rollback.sql
-- Stage 10–owned enums for clean DROP on rollback.

DO $$ BEGIN
  CREATE TYPE "RedeliveryAuthorizationStatus" AS ENUM (
    'REQUESTED', 'CONFIRMED', 'ACTIVATED', 'CANCELLED', 'EXPIRED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RedeliveryAddressMode" AS ENUM (
    'SAME_AS_ORDER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RedeliveryCustomerAuthMethod" AS ENUM (
    'CUSTOMER_JWT', 'ADMIN_RECOVERY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "redelivery_authorizations" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "target_attempt_number" INTEGER NOT NULL,
  "address_mode" "RedeliveryAddressMode" NOT NULL DEFAULT 'SAME_AS_ORDER',
  "address_snapshot" JSONB NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "window_end" TIMESTAMPTZ NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
  "customer_auth_actor_type" "OrderDomainActorType",
  "customer_auth_actor_id" UUID,
  "customer_auth_method" "RedeliveryCustomerAuthMethod",
  "customer_authorized_at" TIMESTAMPTZ,
  "status" "RedeliveryAuthorizationStatus" NOT NULL DEFAULT 'REQUESTED',
  "prior_operational_case_id" UUID,
  "correlation_id" VARCHAR(64),
  "request_idempotency_key" VARCHAR(64),
  "request_payload_hash" VARCHAR(64),
  "confirm_idempotency_key" VARCHAR(64),
  "confirm_payload_hash" VARCHAR(64),
  "activate_idempotency_key" VARCHAR(64),
  "activate_payload_hash" VARCHAR(64),
  "requested_by_actor_type" "OrderDomainActorType" NOT NULL,
  "requested_by_actor_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "expired_at" TIMESTAMPTZ,
  "cancel_reason" VARCHAR(2000),
  "reject_reason" VARCHAR(2000),
  CONSTRAINT "redelivery_authorizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "redelivery_authorizations_attempt_positive_check"
    CHECK ("target_attempt_number" > 0),
  CONSTRAINT "redelivery_authorizations_window_order_check"
    CHECK ("window_end" > "window_start"),
  CONSTRAINT "redelivery_authorizations_address_mode_check"
    CHECK ("address_mode" = 'SAME_AS_ORDER')
);

CREATE INDEX IF NOT EXISTS "redelivery_authorizations_wk_order_id_status_idx"
  ON "redelivery_authorizations"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "redelivery_authorizations_fulfillment_id_status_idx"
  ON "redelivery_authorizations"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "redelivery_authorizations_customer_request_idem_idx"
  ON "redelivery_authorizations"("customer_id", "request_idempotency_key");
CREATE INDEX IF NOT EXISTS "redelivery_authorizations_customer_confirm_idem_idx"
  ON "redelivery_authorizations"("customer_id", "confirm_idempotency_key");

-- At most one open (REQUESTED|CONFIRMED) authorization per fulfillment.
CREATE UNIQUE INDEX IF NOT EXISTS "redelivery_authorizations_one_open_per_fulfillment"
  ON "redelivery_authorizations"("fulfillment_id")
  WHERE "status" IN ('REQUESTED', 'CONFIRMED');

-- Idempotency uniqueness (nullable keys ignored).
CREATE UNIQUE INDEX IF NOT EXISTS "redelivery_authorizations_request_idem_unique"
  ON "redelivery_authorizations"("requested_by_actor_id", "request_idempotency_key")
  WHERE "request_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "redelivery_authorizations_confirm_idem_unique"
  ON "redelivery_authorizations"("customer_auth_actor_id", "confirm_idempotency_key")
  WHERE "confirm_idempotency_key" IS NOT NULL AND "customer_auth_actor_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "redelivery_authorizations_activate_idem_unique"
  ON "redelivery_authorizations"("id", "activate_idempotency_key")
  WHERE "activate_idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_prior_case_fkey"
    FOREIGN KEY ("prior_operational_case_id") REFERENCES "operational_cases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redelivery_authorizations"
    ADD CONSTRAINT "redelivery_authorizations_requested_by_fkey"
    FOREIGN KEY ("requested_by_actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-oriented: block DELETE of historical authorizations.
CREATE OR REPLACE FUNCTION stage10_redelivery_append_only_del()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage10_redelivery_authorizations_append_only: DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage10_redelivery_append_only_del_trg ON "redelivery_authorizations";
CREATE TRIGGER stage10_redelivery_append_only_del_trg
  BEFORE DELETE ON "redelivery_authorizations"
  FOR EACH ROW EXECUTE FUNCTION stage10_redelivery_append_only_del();

-- Terminal status immutability (ACTIVATED/CANCELLED/EXPIRED/REJECTED cannot change status).
CREATE OR REPLACE FUNCTION stage10_redelivery_terminal_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('ACTIVATED', 'CANCELLED', 'EXPIRED', 'REJECTED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'stage10_redelivery_terminal_immutable: status % cannot transition to %',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage10_redelivery_terminal_immutable_trg ON "redelivery_authorizations";
CREATE TRIGGER stage10_redelivery_terminal_immutable_trg
  BEFORE UPDATE ON "redelivery_authorizations"
  FOR EACH ROW EXECUTE FUNCTION stage10_redelivery_terminal_immutable();
