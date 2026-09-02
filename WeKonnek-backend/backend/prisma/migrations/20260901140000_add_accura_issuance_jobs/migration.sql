-- Additive ACCURA issuance outbox. No existing payment or order rows are
-- modified. One durable issuance job per WkOrder.
CREATE TYPE "AccuraIssuanceJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'RETRY_SCHEDULED',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "accura_issuance_jobs" (
    "id" UUID NOT NULL,
    "wk_order_id" INTEGER NOT NULL,
    "status" "AccuraIssuanceJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL,
    "processing_started_at" TIMESTAMPTZ,
    "last_attempt_at" TIMESTAMPTZ,
    "last_error_category" VARCHAR(50),
    "last_http_status" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "accura_issuance_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accura_issuance_jobs_wk_order_id_key" ON "accura_issuance_jobs"("wk_order_id");
CREATE INDEX "accura_issuance_jobs_status_next_attempt_at_idx" ON "accura_issuance_jobs"("status", "next_attempt_at");
CREATE INDEX "accura_issuance_jobs_status_processing_started_at_idx" ON "accura_issuance_jobs"("status", "processing_started_at");

ALTER TABLE "accura_issuance_jobs"
  ADD CONSTRAINT "accura_issuance_jobs_wk_order_id_fkey"
  FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accura_issuance_audit_events" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "wk_order_id" INTEGER NOT NULL,
    "order_code" VARCHAR(50),
    "attempt_number" INTEGER NOT NULL,
    "result" VARCHAR(50) NOT NULL,
    "error_category" VARCHAR(50),
    "accura_invoice_id" VARCHAR(100),
    "actor_type" VARCHAR(30) NOT NULL,
    "actor_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accura_issuance_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accura_issuance_audit_events_job_id_created_at_idx"
  ON "accura_issuance_audit_events"("job_id", "created_at");
CREATE INDEX "accura_issuance_audit_events_wk_order_id_created_at_idx"
  ON "accura_issuance_audit_events"("wk_order_id", "created_at");

ALTER TABLE "accura_issuance_audit_events"
  ADD CONSTRAINT "accura_issuance_audit_events_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "accura_issuance_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
