CREATE TABLE IF NOT EXISTS "payment_partner_configurations" (
  "id" UUID NOT NULL,
  "provider_code" VARCHAR(50) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "environment" VARCHAR(20) NOT NULL DEFAULT 'uat',
  "dynamic_qr_enabled" BOOLEAN NOT NULL DEFAULT false,
  "hybrid_qr_enabled" BOOLEAN NOT NULL DEFAULT false,
  "static_qr_enabled" BOOLEAN NOT NULL DEFAULT false,
  "bank_transfer_enabled" BOOLEAN NOT NULL DEFAULT false,
  "web_payment_enabled" BOOLEAN NOT NULL DEFAULT false,
  "bills_payment_enabled" BOOLEAN NOT NULL DEFAULT false,
  "refund_enabled" BOOLEAN NOT NULL DEFAULT false,
  "payout_enabled" BOOLEAN NOT NULL DEFAULT false,
  "default_qr_expiry_seconds" INTEGER NOT NULL DEFAULT 900,
  "settlement_mode" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  "public_key_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "ip_whitelist_configured" BOOLEAN NOT NULL DEFAULT false,
  "callback_registered" BOOLEAN NOT NULL DEFAULT false,
  "last_successful_request_at" TIMESTAMPTZ,
  "last_successful_callback_at" TIMESTAMPTZ,
  "last_reconciliation_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_partner_configurations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_partner_configurations_provider_code_key" ON "payment_partner_configurations"("provider_code");

CREATE TABLE IF NOT EXISTS "payment_partner_source_configs" (
  "id" UUID NOT NULL, "configuration_id" UUID NOT NULL, "provider_code" VARCHAR(50) NOT NULL,
  "source_type" VARCHAR(50) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_partner_source_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_partner_source_configs_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "payment_partner_configurations"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_partner_source_configs_provider_code_source_type_key" ON "payment_partner_source_configs"("provider_code", "source_type");
CREATE INDEX IF NOT EXISTS "payment_partner_source_configs_configuration_id_idx" ON "payment_partner_source_configs"("configuration_id");

CREATE TABLE IF NOT EXISTS "payment_partner_audit_logs" (
  "id" UUID NOT NULL, "configuration_id" UUID NOT NULL, "actor_id" UUID NOT NULL, "action" VARCHAR(100) NOT NULL,
  "changes" JSONB NOT NULL, "ip_address" VARCHAR(64), "user_agent" VARCHAR(500), "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_partner_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_partner_audit_logs_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "payment_partner_configurations"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "payment_partner_audit_logs_configuration_id_created_at_idx" ON "payment_partner_audit_logs"("configuration_id", "created_at");

CREATE TABLE IF NOT EXISTS "payment_partner_events" (
  "id" UUID NOT NULL, "configuration_id" UUID NOT NULL, "type" VARCHAR(100) NOT NULL, "message" VARCHAR(500) NOT NULL,
  "reference" VARCHAR(100), "success" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_partner_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_partner_events_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "payment_partner_configurations"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "payment_partner_events_configuration_id_created_at_idx" ON "payment_partner_events"("configuration_id", "created_at");

INSERT INTO "payment_partner_configurations" ("id", "provider_code", "enabled", "environment", "dynamic_qr_enabled")
VALUES (gen_random_uuid(), 'PAYCOOLS', true, 'uat', true)
ON CONFLICT ("provider_code") DO NOTHING;
INSERT INTO "payment_partner_source_configs" ("id", "configuration_id", "provider_code", "source_type", "enabled")
SELECT gen_random_uuid(), config."id", 'PAYCOOLS', defaults.source_type, defaults.enabled
FROM "payment_partner_configurations" AS config
CROSS JOIN (VALUES ('RESTAURANT_ORDER', true), ('RETAIL_ORDER', true), ('ADVANCE_ORDER', true), ('TAKE_OUT', true), ('RESERVATION', true), ('MERCHANT_SUBSCRIPTION', true), ('DELIVERY_ORDER', false), ('SERVICE_BOOKING', false), ('BAZAAR_LISTING', false), ('PROPERTY_LISTING', false)) AS defaults(source_type, enabled)
WHERE config."provider_code" = 'PAYCOOLS'
ON CONFLICT ("provider_code", "source_type") DO NOTHING;
