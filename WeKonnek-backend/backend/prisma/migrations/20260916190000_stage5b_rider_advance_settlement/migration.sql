-- Stage 5B: Rider Advance reimbursement settlement ledger (additive)
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "RiderAdvanceSettlementMethod" AS ENUM ('CASH', 'DIRECT_TRANSFER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderAdvanceSettlementStatus" AS ENUM (
    'CLAIMED', 'ACKNOWLEDGED', 'REJECTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "rider_advance_settlements" (
  "id" UUID NOT NULL,
  "rider_advance_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "customer_id" UUID NOT NULL,
  "creditor_rider_id" UUID NOT NULL,
  "method" "RiderAdvanceSettlementMethod" NOT NULL,
  "status" "RiderAdvanceSettlementStatus" NOT NULL DEFAULT 'CLAIMED',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "claimed_amount" DECIMAL(14,2),
  "acknowledged_amount" DECIMAL(14,2),
  "external_reference" VARCHAR(120),
  "proof_storage_reference" VARCHAR(1000),
  "claim_evidence_id" UUID,
  "ack_evidence_id" UUID,
  "rejection_reason" VARCHAR(255),
  "claimed_at" TIMESTAMPTZ,
  "claimed_by_user_id" UUID,
  "acknowledged_at" TIMESTAMPTZ,
  "acknowledged_by_user_id" UUID,
  "rejected_at" TIMESTAMPTZ,
  "rejected_by_user_id" UUID,
  "claim_idempotency_key" VARCHAR(64),
  "ack_idempotency_key" VARCHAR(64),
  "cash_idempotency_key" VARCHAR(64),
  "reject_idempotency_key" VARCHAR(64),
  "payload_fingerprint" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "rider_advance_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rider_advance_settlements_claimed_positive_check"
    CHECK ("claimed_amount" IS NULL OR "claimed_amount" > 0),
  CONSTRAINT "rider_advance_settlements_ack_positive_check"
    CHECK ("acknowledged_amount" IS NULL OR "acknowledged_amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "rider_advance_settlements_claim_idempotency_key_key"
  ON "rider_advance_settlements"("claim_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advance_settlements_ack_idempotency_key_key"
  ON "rider_advance_settlements"("ack_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advance_settlements_cash_idempotency_key_key"
  ON "rider_advance_settlements"("cash_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "rider_advance_settlements_reject_idempotency_key_key"
  ON "rider_advance_settlements"("reject_idempotency_key");

CREATE INDEX IF NOT EXISTS "rider_advance_settlements_rider_advance_id_status_idx"
  ON "rider_advance_settlements"("rider_advance_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advance_settlements_wk_order_id_status_idx"
  ON "rider_advance_settlements"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advance_settlements_customer_id_status_idx"
  ON "rider_advance_settlements"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advance_settlements_creditor_rider_id_status_idx"
  ON "rider_advance_settlements"("creditor_rider_id", "status");
CREATE INDEX IF NOT EXISTS "rider_advance_settlements_status_created_at_idx"
  ON "rider_advance_settlements"("status", "created_at");

DO $$ BEGIN
  ALTER TABLE "rider_advance_settlements"
    ADD CONSTRAINT "rider_advance_settlements_rider_advance_id_fkey"
    FOREIGN KEY ("rider_advance_id") REFERENCES "rider_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advance_settlements"
    ADD CONSTRAINT "rider_advance_settlements_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advance_settlements"
    ADD CONSTRAINT "rider_advance_settlements_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advance_settlements"
    ADD CONSTRAINT "rider_advance_settlements_creditor_rider_id_fkey"
    FOREIGN KEY ("creditor_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Terminal settlement financial fields are immutable (ACKNOWLEDGED / REJECTED).
CREATE OR REPLACE FUNCTION rider_advance_settlement_immutable_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('ACKNOWLEDGED', 'REJECTED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.claimed_amount IS DISTINCT FROM OLD.claimed_amount
       OR NEW.acknowledged_amount IS DISTINCT FROM OLD.acknowledged_amount
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.creditor_rider_id IS DISTINCT FROM OLD.creditor_rider_id
       OR NEW.rider_advance_id IS DISTINCT FROM OLD.rider_advance_id
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
    THEN
      RAISE EXCEPTION 'rider_advance_settlement_immutable: terminal settlement financial fields cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rider_advance_settlement_immutable_trg ON "rider_advance_settlements";
CREATE TRIGGER rider_advance_settlement_immutable_trg
  BEFORE UPDATE ON "rider_advance_settlements"
  FOR EACH ROW
  EXECUTE PROCEDURE rider_advance_settlement_immutable_guard();

-- Append-only ledger: application role must not physically DELETE any settlement row.
-- Lifecycle changes use controlled status transitions; corrections create new rows/evidence.
-- TRUNCATE is intentionally not blocked here (DELETE triggers do not fire on TRUNCATE).
-- Disposable Stage 5B acceptance DBs may TRUNCATE for fixture reset; production app roles
-- must not be granted TRUNCATE on this table.
CREATE OR REPLACE FUNCTION rider_advance_settlement_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rider_advance_settlement_append_only: physical DELETE of settlement ledger rows is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rider_advance_settlement_append_only_trg ON "rider_advance_settlements";
CREATE TRIGGER rider_advance_settlement_append_only_trg
  BEFORE DELETE ON "rider_advance_settlements"
  FOR EACH ROW
  EXECUTE PROCEDURE rider_advance_settlement_append_only_guard();
