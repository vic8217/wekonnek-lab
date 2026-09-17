-- Stage 11: Operations Recovery (additive)
-- Rollback: see rollback.sql
-- Stage 11–owned enums for clean DROP on rollback.

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryStatus" AS ENUM (
    'OPEN', 'INVESTIGATING', 'DISPOSITION_SELECTED', 'CLOSED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryTrigger" AS ENUM (
    'DELIVERY_ATTEMPTS_EXHAUSTED',
    'MERCHANT_RETURN_REFUSED',
    'RETURN_BLOCKED',
    'CUSTODY_TRANSFER_ABANDONED',
    'CUSTODY_UNCONFIRMED',
    'RIDER_UNAVAILABLE',
    'GOODS_REPORTED_LOST',
    'GOODS_REPORTED_DAMAGED',
    'ADMIN_RECOVERY_REQUIRED',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryDisposition" AS ENUM (
    'RETURN_REQUIRED',
    'CUSTODY_INVESTIGATION',
    'CONTACT_CUSTOMER',
    'CONTACT_MERCHANT',
    'CONTACT_RIDER',
    'HOLD_FOR_REVIEW',
    'NO_FURTHER_FULFILLMENT',
    'FINANCIAL_REVIEW_REQUIRED',
    'CLEAR_PENDING_CUSTODY_TRANSFER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryEventType" AS ENUM (
    'CASE_OPENED',
    'INVESTIGATION_STARTED',
    'DISPOSITION_SELECTED',
    'EVIDENCE_ADDED',
    'VERIFICATION_RECORDED',
    'PENDING_CUSTODY_CLEARED',
    'CLOSED',
    'CANCELLED',
    'NOTE_ADDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryEvidenceKind" AS ENUM (
    'NOTE',
    'PHOTO_REFERENCE',
    'DOCUMENT_REFERENCE',
    'STATEMENT',
    'CONTACT_ATTEMPT',
    'CONTACT_RESULT',
    'INVESTIGATION_FINDING',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationsRecoveryVerificationCode" AS ENUM (
    'GOODS_LOST_VERIFIED',
    'GOODS_DAMAGED_VERIFIED',
    'CUSTODY_UNCONFIRMED_CONCLUDED',
    'MERCHANT_RETURN_REFUSED_VERIFIED',
    'RIDER_UNAVAILABLE_VERIFIED',
    'ADMIN_OPERATIONAL_CONCLUSION',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "operations_recoveries" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "opening_trigger_code" "OperationsRecoveryTrigger" NOT NULL,
  "opened_by_actor_type" "OrderDomainActorType" NOT NULL,
  "opened_by_actor_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64) NOT NULL,
  "physical_custodian_rider_id_at_open" UUID,
  "active_rider_id_at_open" UUID,
  "pending_custody_incoming_rider_id_at_open" UUID,
  "attempt_budget_exhausted" BOOLEAN NOT NULL DEFAULT FALSE,
  "failed_attempt_count_at_open" INTEGER NOT NULL DEFAULT 0,
  "source_operational_case_id" UUID,
  "source_delivery_attempt_id" UUID,
  "source_redelivery_authorization_id" UUID,
  "stage9_determination_id" UUID,
  "status" "OperationsRecoveryStatus" NOT NULL DEFAULT 'OPEN',
  "current_disposition" "OperationsRecoveryDisposition",
  "notes" VARCHAR(2000),
  "closed_at" TIMESTAMPTZ,
  "closed_by_actor_type" "OrderDomainActorType",
  "closed_by_actor_id" UUID,
  "close_reason" VARCHAR(2000),
  "cancelled_at" TIMESTAMPTZ,
  "cancelled_by_actor_type" "OrderDomainActorType",
  "cancelled_by_actor_id" UUID,
  "cancel_reason" VARCHAR(2000),
  "open_idempotency_key" VARCHAR(64),
  "open_payload_hash" VARCHAR(64),
  "close_idempotency_key" VARCHAR(64),
  "close_payload_hash" VARCHAR(64),
  "clear_pending_idempotency_key" VARCHAR(64),
  "clear_pending_payload_hash" VARCHAR(64),
  "disposition_idempotency_key" VARCHAR(64),
  "disposition_payload_hash" VARCHAR(64),
  "cancel_idempotency_key" VARCHAR(64),
  "cancel_payload_hash" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operations_recoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operations_recoveries_other_notes_check"
    CHECK (
      ("opening_trigger_code" <> 'OTHER')
      OR ("notes" IS NOT NULL AND length(btrim("notes")) > 0)
    ),
  CONSTRAINT "operations_recoveries_closed_disposition_check"
    CHECK (
      ("status" <> 'CLOSED')
      OR ("current_disposition" IS NOT NULL)
    ),
  CONSTRAINT "operations_recoveries_failed_attempt_nonneg_check"
    CHECK ("failed_attempt_count_at_open" >= 0)
);

CREATE INDEX IF NOT EXISTS "operations_recoveries_wk_order_id_status_idx"
  ON "operations_recoveries"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "operations_recoveries_fulfillment_id_status_idx"
  ON "operations_recoveries"("fulfillment_id", "status");

-- At most one active recovery per fulfillment.
CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_one_active_per_fulfillment"
  ON "operations_recoveries"("fulfillment_id")
  WHERE "status" IN ('OPEN', 'INVESTIGATING', 'DISPOSITION_SELECTED');

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_open_idem_unique"
  ON "operations_recoveries"("opened_by_actor_id", "open_idempotency_key")
  WHERE "open_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_close_idem_unique"
  ON "operations_recoveries"("id", "close_idempotency_key")
  WHERE "close_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_clear_pending_idem_unique"
  ON "operations_recoveries"("id", "clear_pending_idempotency_key")
  WHERE "clear_pending_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_disposition_idem_unique"
  ON "operations_recoveries"("id", "disposition_idempotency_key")
  WHERE "disposition_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recoveries_cancel_idem_unique"
  ON "operations_recoveries"("id", "cancel_idempotency_key")
  WHERE "cancel_idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_opened_by_fkey"
    FOREIGN KEY ("opened_by_actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_source_case_fkey"
    FOREIGN KEY ("source_operational_case_id") REFERENCES "operational_cases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_source_attempt_fkey"
    FOREIGN KEY ("source_delivery_attempt_id") REFERENCES "delivery_attempts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_source_redelivery_fkey"
    FOREIGN KEY ("source_redelivery_authorization_id") REFERENCES "redelivery_authorizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recoveries"
    ADD CONSTRAINT "operations_recoveries_stage9_det_fkey"
    FOREIGN KEY ("stage9_determination_id") REFERENCES "return_financial_determinations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "operations_recovery_events" (
  "id" UUID NOT NULL,
  "operations_recovery_id" UUID NOT NULL,
  "event_type" "OperationsRecoveryEventType" NOT NULL,
  "from_status" "OperationsRecoveryStatus",
  "to_status" "OperationsRecoveryStatus",
  "disposition" "OperationsRecoveryDisposition",
  "actor_type" "OrderDomainActorType" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operations_recovery_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "operations_recovery_events_recovery_created_idx"
  ON "operations_recovery_events"("operations_recovery_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "operations_recovery_events"
    ADD CONSTRAINT "operations_recovery_events_recovery_fkey"
    FOREIGN KEY ("operations_recovery_id") REFERENCES "operations_recoveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "operations_recovery_evidence" (
  "id" UUID NOT NULL,
  "operations_recovery_id" UUID NOT NULL,
  "evidence_kind" "OperationsRecoveryEvidenceKind" NOT NULL,
  "storage_reference" VARCHAR(1000),
  "content_hash" VARCHAR(64),
  "content_type" VARCHAR(120),
  "notes" VARCHAR(2000),
  "metadata" JSONB,
  "supersedes_evidence_id" UUID,
  "submitted_by_actor_type" "OrderDomainActorType" NOT NULL,
  "submitted_by_actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64),
  "payload_hash" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operations_recovery_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "operations_recovery_evidence_recovery_created_idx"
  ON "operations_recovery_evidence"("operations_recovery_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recovery_evidence_idem_unique"
  ON "operations_recovery_evidence"("submitted_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "operations_recovery_evidence"
    ADD CONSTRAINT "operations_recovery_evidence_recovery_fkey"
    FOREIGN KEY ("operations_recovery_id") REFERENCES "operations_recoveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operations_recovery_evidence"
    ADD CONSTRAINT "operations_recovery_evidence_supersedes_fkey"
    FOREIGN KEY ("supersedes_evidence_id") REFERENCES "operations_recovery_evidence"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "operations_recovery_verifications" (
  "id" UUID NOT NULL,
  "operations_recovery_id" UUID NOT NULL,
  "verification_code" "OperationsRecoveryVerificationCode" NOT NULL,
  "notes" VARCHAR(2000),
  "metadata" JSONB,
  "verified_by_actor_type" "OrderDomainActorType" NOT NULL,
  "verified_by_actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64),
  "payload_hash" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operations_recovery_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "operations_recovery_verifications_recovery_created_idx"
  ON "operations_recovery_verifications"("operations_recovery_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "operations_recovery_verifications_idem_unique"
  ON "operations_recovery_verifications"("verified_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "operations_recovery_verifications"
    ADD CONSTRAINT "operations_recovery_verifications_recovery_fkey"
    FOREIGN KEY ("operations_recovery_id") REFERENCES "operations_recoveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only: block DELETE (and UPDATE) on events/evidence/verifications.
CREATE OR REPLACE FUNCTION stage11_operations_recovery_children_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage11_operations_recovery_append_only: % of % is forbidden',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage11_ore_events_append_only_upd_trg ON "operations_recovery_events";
CREATE TRIGGER stage11_ore_events_append_only_upd_trg
  BEFORE UPDATE ON "operations_recovery_events"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

DROP TRIGGER IF EXISTS stage11_ore_events_append_only_del_trg ON "operations_recovery_events";
CREATE TRIGGER stage11_ore_events_append_only_del_trg
  BEFORE DELETE ON "operations_recovery_events"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

DROP TRIGGER IF EXISTS stage11_ore_evidence_append_only_upd_trg ON "operations_recovery_evidence";
CREATE TRIGGER stage11_ore_evidence_append_only_upd_trg
  BEFORE UPDATE ON "operations_recovery_evidence"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

DROP TRIGGER IF EXISTS stage11_ore_evidence_append_only_del_trg ON "operations_recovery_evidence";
CREATE TRIGGER stage11_ore_evidence_append_only_del_trg
  BEFORE DELETE ON "operations_recovery_evidence"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

DROP TRIGGER IF EXISTS stage11_ore_verifications_append_only_upd_trg ON "operations_recovery_verifications";
CREATE TRIGGER stage11_ore_verifications_append_only_upd_trg
  BEFORE UPDATE ON "operations_recovery_verifications"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

DROP TRIGGER IF EXISTS stage11_ore_verifications_append_only_del_trg ON "operations_recovery_verifications";
CREATE TRIGGER stage11_ore_verifications_append_only_del_trg
  BEFORE DELETE ON "operations_recovery_verifications"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_children_append_only();

-- Recoveries: DELETE forbidden; terminal CLOSED/CANCELLED immutable for status/disposition/bindings.
CREATE OR REPLACE FUNCTION stage11_operations_recovery_append_only_del()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage11_operations_recoveries_append_only: DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage11_operations_recovery_append_only_del_trg ON "operations_recoveries";
CREATE TRIGGER stage11_operations_recovery_append_only_del_trg
  BEFORE DELETE ON "operations_recoveries"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_append_only_del();

CREATE OR REPLACE FUNCTION stage11_operations_recovery_terminal_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('CLOSED', 'CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.current_disposition IS DISTINCT FROM OLD.current_disposition
       OR NEW.opening_trigger_code IS DISTINCT FROM OLD.opening_trigger_code
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
       OR NEW.fulfillment_id IS DISTINCT FROM OLD.fulfillment_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.attempt_budget_exhausted IS DISTINCT FROM OLD.attempt_budget_exhausted
       OR NEW.failed_attempt_count_at_open IS DISTINCT FROM OLD.failed_attempt_count_at_open
       OR NEW.physical_custodian_rider_id_at_open IS DISTINCT FROM OLD.physical_custodian_rider_id_at_open
       OR NEW.active_rider_id_at_open IS DISTINCT FROM OLD.active_rider_id_at_open
       OR NEW.pending_custody_incoming_rider_id_at_open IS DISTINCT FROM OLD.pending_custody_incoming_rider_id_at_open
    THEN
      RAISE EXCEPTION 'stage11_operations_recovery_terminal_immutable: terminal recovery % cannot be mutated',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage11_operations_recovery_terminal_immutable_trg ON "operations_recoveries";
CREATE TRIGGER stage11_operations_recovery_terminal_immutable_trg
  BEFORE UPDATE ON "operations_recoveries"
  FOR EACH ROW EXECUTE FUNCTION stage11_operations_recovery_terminal_immutable();
