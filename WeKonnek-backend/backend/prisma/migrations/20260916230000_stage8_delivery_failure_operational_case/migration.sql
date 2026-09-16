-- Stage 8: failed delivery / operational exception foundation (additive)
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "DeliveryAttemptOutcome" AS ENUM ('SUCCESSFUL_HANDOFF', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryFailureReasonCode" AS ENUM (
    'CUSTOMER_UNREACHABLE',
    'CUSTOMER_REFUSED',
    'ADDRESS_ISSUE',
    'CUSTOMER_REQUESTED_RESCHEDULE',
    'MERCHANT_REQUESTED_RETURN',
    'RIDER_OPERATIONAL_FAILURE',
    'VEHICLE_OR_TRANSPORT_FAILURE',
    'SAFETY_ISSUE',
    'GOODS_DAMAGED',
    'GOODS_LOST',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryAttemptCustomerResponse" AS ENUM (
    'NONE',
    'UNREACHABLE',
    'REFUSED',
    'REQUESTED_RESCHEDULE',
    'ACCEPTANCE_NOT_COMPLETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryAttemptLocationProvenance" AS ENUM ('RIDER_DEVICE_REPORTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryAttemptEvidenceKind" AS ENUM (
    'PHOTO', 'VIDEO', 'GPS_LOCATION', 'NOTES', 'OTHER_ATTACHMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationalCaseType" AS ENUM (
    'DELIVERY_FAILURE',
    'RETURN_REFUSED',
    'CUSTODY_EXCEPTION',
    'FINANCIAL_DISPUTE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationalCaseStatus" AS ENUM (
    'OPEN', 'DISPOSITION_SELECTED', 'RESOLVED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationalDisposition" AS ENUM (
    'RETURN_TO_MERCHANT',
    'HOLD_FOR_REVIEW',
    'RESCHEDULE_REQUESTED',
    'CUSTOMER_REFUSED_RETURN_REQUIRED',
    'OPERATIONS_RECOVERY_REQUIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperationalCaseEventType" AS ENUM (
    'CASE_OPENED',
    'DISPOSITION_SELECTED',
    'CASE_RESOLVED',
    'CASE_CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "delivery_attempts" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "rider_id" UUID NOT NULL,
  "rider_assignment_id" UUID NOT NULL,
  "assignment_version" INTEGER NOT NULL,
  "physical_custodian_rider_id" UUID NOT NULL,
  "outcome" "DeliveryAttemptOutcome" NOT NULL,
  "failure_reason_code" "DeliveryFailureReasonCode",
  "customer_response" "DeliveryAttemptCustomerResponse" NOT NULL DEFAULT 'NONE',
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reported_by_actor_type" "OrderDomainActorType" NOT NULL,
  "reported_by_actor_id" UUID NOT NULL,
  "notes" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "idempotency_key" VARCHAR(64),
  "request_payload_hash" VARCHAR(64),
  "location_latitude" DECIMAL(10, 7),
  "location_longitude" DECIMAL(10, 7),
  "location_provenance" "DeliveryAttemptLocationProvenance",
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_attempts_failed_requires_reason_check" CHECK (
    ("outcome" <> 'FAILED') OR ("failure_reason_code" IS NOT NULL)
  ),
  CONSTRAINT "delivery_attempts_other_requires_notes_check" CHECK (
    ("failure_reason_code" IS DISTINCT FROM 'OTHER')
    OR (NULLIF(BTRIM("notes"), '') IS NOT NULL)
  ),
  CONSTRAINT "delivery_attempts_location_provenance_check" CHECK (
    (
      "location_latitude" IS NULL
      AND "location_longitude" IS NULL
      AND "location_provenance" IS NULL
    )
    OR (
      "location_latitude" IS NOT NULL
      AND "location_longitude" IS NOT NULL
      AND "location_provenance" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_attempts_fulfillment_id_attempt_number_key"
  ON "delivery_attempts"("fulfillment_id", "attempt_number");

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_attempts_reported_by_actor_id_idempotency_key_key"
  ON "delivery_attempts"("reported_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "delivery_attempts_wk_order_id_idx"
  ON "delivery_attempts"("wk_order_id");
CREATE INDEX IF NOT EXISTS "delivery_attempts_fulfillment_id_outcome_idx"
  ON "delivery_attempts"("fulfillment_id", "outcome");
CREATE INDEX IF NOT EXISTS "delivery_attempts_rider_id_idx"
  ON "delivery_attempts"("rider_id");

DO $$ BEGIN
  ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_rider_id_fkey"
    FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_physical_custodian_rider_id_fkey"
    FOREIGN KEY ("physical_custodian_rider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_rider_assignment_id_fkey"
    FOREIGN KEY ("rider_assignment_id") REFERENCES "rider_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "delivery_attempt_evidences" (
  "id" UUID NOT NULL,
  "delivery_attempt_id" UUID NOT NULL,
  "evidence_kind" "DeliveryAttemptEvidenceKind" NOT NULL,
  "storage_reference" VARCHAR(1000),
  "content_hash" VARCHAR(64),
  "content_type" VARCHAR(120),
  "size_bytes" INTEGER,
  "agreement_evidence_id" UUID,
  "metadata" JSONB,
  "submitted_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_attempt_evidences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_attempt_evidences_delivery_attempt_id_created_at_idx"
  ON "delivery_attempt_evidences"("delivery_attempt_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "delivery_attempt_evidences"
    ADD CONSTRAINT "delivery_attempt_evidences_delivery_attempt_id_fkey"
    FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_attempt_evidences"
    ADD CONSTRAINT "delivery_attempt_evidences_agreement_evidence_id_fkey"
    FOREIGN KEY ("agreement_evidence_id") REFERENCES "agreement_evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "operational_cases" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "delivery_attempt_id" UUID,
  "case_type" "OperationalCaseType" NOT NULL,
  "status" "OperationalCaseStatus" NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opened_by_actor_type" "OrderDomainActorType" NOT NULL,
  "opened_by_actor_id" UUID NOT NULL,
  "current_disposition" "OperationalDisposition",
  "resolved_at" TIMESTAMPTZ,
  "resolved_by_actor_type" "OrderDomainActorType",
  "resolved_by_actor_id" UUID,
  "resolution_reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "operational_cases_delivery_attempt_id_key"
  ON "operational_cases"("delivery_attempt_id")
  WHERE "delivery_attempt_id" IS NOT NULL;

-- One non-terminal DELIVERY_FAILURE case per fulfillment
CREATE UNIQUE INDEX IF NOT EXISTS "operational_cases_one_open_delivery_failure_per_fulfillment"
  ON "operational_cases"("fulfillment_id")
  WHERE "case_type" = 'DELIVERY_FAILURE'
    AND "status" IN ('OPEN', 'DISPOSITION_SELECTED');

CREATE INDEX IF NOT EXISTS "operational_cases_wk_order_id_status_idx"
  ON "operational_cases"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "operational_cases_fulfillment_id_case_type_status_idx"
  ON "operational_cases"("fulfillment_id", "case_type", "status");

DO $$ BEGIN
  ALTER TABLE "operational_cases"
    ADD CONSTRAINT "operational_cases_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operational_cases"
    ADD CONSTRAINT "operational_cases_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "operational_cases"
    ADD CONSTRAINT "operational_cases_delivery_attempt_id_fkey"
    FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "operational_case_events" (
  "id" UUID NOT NULL,
  "operational_case_id" UUID NOT NULL,
  "event_type" "OperationalCaseEventType" NOT NULL,
  "from_status" "OperationalCaseStatus",
  "to_status" "OperationalCaseStatus",
  "disposition" "OperationalDisposition",
  "actor_type" "OrderDomainActorType" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_case_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "operational_case_events_operational_case_id_created_at_idx"
  ON "operational_case_events"("operational_case_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "operational_case_events"
    ADD CONSTRAINT "operational_case_events_operational_case_id_fkey"
    FOREIGN KEY ("operational_case_id") REFERENCES "operational_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only: delivery_attempts
CREATE OR REPLACE FUNCTION stage8_delivery_attempts_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage8_delivery_attempts_append_only: UPDATE/DELETE of delivery_attempts is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage8_delivery_attempts_append_only_upd_trg ON "delivery_attempts";
CREATE TRIGGER stage8_delivery_attempts_append_only_upd_trg
  BEFORE UPDATE ON "delivery_attempts"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_delivery_attempts_append_only_guard();

DROP TRIGGER IF EXISTS stage8_delivery_attempts_append_only_del_trg ON "delivery_attempts";
CREATE TRIGGER stage8_delivery_attempts_append_only_del_trg
  BEFORE DELETE ON "delivery_attempts"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_delivery_attempts_append_only_guard();

-- Append-only: delivery_attempt_evidences
CREATE OR REPLACE FUNCTION stage8_delivery_attempt_evidences_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage8_delivery_attempt_evidences_append_only: UPDATE/DELETE of delivery_attempt_evidences is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage8_delivery_attempt_evidences_append_only_upd_trg ON "delivery_attempt_evidences";
CREATE TRIGGER stage8_delivery_attempt_evidences_append_only_upd_trg
  BEFORE UPDATE ON "delivery_attempt_evidences"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_delivery_attempt_evidences_append_only_guard();

DROP TRIGGER IF EXISTS stage8_delivery_attempt_evidences_append_only_del_trg ON "delivery_attempt_evidences";
CREATE TRIGGER stage8_delivery_attempt_evidences_append_only_del_trg
  BEFORE DELETE ON "delivery_attempt_evidences"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_delivery_attempt_evidences_append_only_guard();

-- Append-only: operational_case_events (cases themselves may UPDATE)
CREATE OR REPLACE FUNCTION stage8_operational_case_events_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage8_operational_case_events_append_only: UPDATE/DELETE of operational_case_events is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage8_operational_case_events_append_only_upd_trg ON "operational_case_events";
CREATE TRIGGER stage8_operational_case_events_append_only_upd_trg
  BEFORE UPDATE ON "operational_case_events"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_operational_case_events_append_only_guard();

DROP TRIGGER IF EXISTS stage8_operational_case_events_append_only_del_trg ON "operational_case_events";
CREATE TRIGGER stage8_operational_case_events_append_only_del_trg
  BEFORE DELETE ON "operational_case_events"
  FOR EACH ROW
  EXECUTE PROCEDURE stage8_operational_case_events_append_only_guard();
