-- Stage 4A: Rider Advance authorization & obligation foundation (additive)
-- Rollback: see rollback.sql

ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "allow_rider_advance" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "RiderAdvanceStatus" AS ENUM (
    'PROPOSED',
    'CUSTOMER_AUTHORIZED',
    'RIDER_ACCEPTED',
    'ADVANCE_RECORDED',
    'VENDOR_ACKNOWLEDGED',
    'REIMBURSEMENT_DUE',
    'REIMBURSED',
    'DISPUTED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "rider_advances" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "agreement_id" UUID NOT NULL,
  "agreement_version_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "rider_id" UUID NOT NULL,
  "rider_assignment_id" UUID NOT NULL,
  "assignment_version" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "authorized_maximum_amount" DECIMAL(14,2) NOT NULL,
  "actual_advance_amount" DECIMAL(14,2),
  "vendor_acknowledged_amount" DECIMAL(14,2),
  "reimbursement_principal" DECIMAL(14,2),
  "convenience_fee_amount" DECIMAL(14,2),
  "status" "RiderAdvanceStatus" NOT NULL DEFAULT 'PROPOSED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "authorized_at" TIMESTAMPTZ,
  "rider_accepted_at" TIMESTAMPTZ,
  "advance_recorded_at" TIMESTAMPTZ,
  "vendor_acknowledged_at" TIMESTAMPTZ,
  "reimbursement_due_at" TIMESTAMPTZ,
  "reimbursed_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "disputed_at" TIMESTAMPTZ,
  "cancel_reason" VARCHAR(255),
  "dispute_reason" VARCHAR(255),
  "authorize_idempotency_key" VARCHAR(64),
  "accept_idempotency_key" VARCHAR(64),
  "record_idempotency_key" VARCHAR(64),
  "acknowledge_idempotency_key" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "rider_advances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rider_advances_authorized_maximum_nonneg_check"
    CHECK ("authorized_maximum_amount" >= 0),
  CONSTRAINT "rider_advances_actual_nonneg_check"
    CHECK ("actual_advance_amount" IS NULL OR "actual_advance_amount" >= 0),
  CONSTRAINT "rider_advances_actual_lte_max_check"
    CHECK (
      "actual_advance_amount" IS NULL
      OR "actual_advance_amount" <= "authorized_maximum_amount"
    ),
  CONSTRAINT "rider_advances_vendor_ack_nonneg_check"
    CHECK ("vendor_acknowledged_amount" IS NULL OR "vendor_acknowledged_amount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "rider_advances_authorize_idempotency_key_key"
  ON "rider_advances"("authorize_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advances_accept_idempotency_key_key"
  ON "rider_advances"("accept_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advances_record_idempotency_key_key"
  ON "rider_advances"("record_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advances_acknowledge_idempotency_key_key"
  ON "rider_advances"("acknowledge_idempotency_key");

-- At most one non-cancelled Rider Advance per order
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advances_active_wk_order_id_key"
  ON "rider_advances"("wk_order_id")
  WHERE "status" <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS "rider_advances_wk_order_id_status_idx"
  ON "rider_advances"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advances_fulfillment_id_status_idx"
  ON "rider_advances"("fulfillment_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advances_rider_id_status_idx"
  ON "rider_advances"("rider_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advances_merchant_id_status_idx"
  ON "rider_advances"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advances_customer_id_status_idx"
  ON "rider_advances"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advances_agreement_id_idx"
  ON "rider_advances"("agreement_id");
CREATE INDEX IF NOT EXISTS "rider_advances_rider_assignment_id_assignment_version_idx"
  ON "rider_advances"("rider_assignment_id", "assignment_version");

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_agreement_version_id_fkey"
    FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advances" ADD CONSTRAINT "rider_advances_rider_id_fkey"
    FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
