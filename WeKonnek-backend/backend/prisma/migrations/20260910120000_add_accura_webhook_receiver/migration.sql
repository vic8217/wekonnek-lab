CREATE TABLE "wk_order_accura_invoices" (
    "id" UUID NOT NULL,
    "wk_order_id" INTEGER NOT NULL,
    "accura_invoice_id" VARCHAR(100) NOT NULL,
    "accura_invoice_number" VARCHAR(100) NOT NULL,
    "accura_issued_at" TIMESTAMPTZ NOT NULL,
    "accura_document_hash" VARCHAR(128) NOT NULL,
    "accura_verification_url" VARCHAR(1000),
    "source_system" VARCHAR(50) NOT NULL,
    "external_order_id" VARCHAR(50) NOT NULL,
    "external_order_code" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wk_order_accura_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wk_order_accura_invoices_wk_order_id_key" ON "wk_order_accura_invoices"("wk_order_id");
CREATE UNIQUE INDEX "wk_order_accura_invoices_accura_invoice_id_key" ON "wk_order_accura_invoices"("accura_invoice_id");

ALTER TABLE "wk_order_accura_invoices"
  ADD CONSTRAINT "wk_order_accura_invoices_wk_order_id_fkey"
  FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accura_webhook_events" (
    "id" UUID NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "wk_order_id" INTEGER,
    "accura_invoice_id" VARCHAR(100),
    "payload_version" VARCHAR(50),
    "processed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accura_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accura_webhook_events_event_id_key" ON "accura_webhook_events"("event_id");
CREATE INDEX "accura_webhook_events_wk_order_id_idx" ON "accura_webhook_events"("wk_order_id");

ALTER TABLE "accura_webhook_events"
  ADD CONSTRAINT "accura_webhook_events_wk_order_id_fkey"
  FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
