CREATE TABLE "paycools_environment_configurations" (
  "id" UUID NOT NULL,
  "configuration_id" UUID NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "base_url" TEXT,
  "app_id" TEXT,
  "app_name" TEXT,
  "merchant_public_key" TEXT,
  "encrypted_merchant_private_key" TEXT,
  "encrypted_callback_secret" TEXT,
  "channel_code" VARCHAR(100) NOT NULL DEFAULT 'QRPH_DYNAMIC_QR',
  "healthcheck_url" TEXT,
  "ip_whitelist_required" BOOLEAN NOT NULL DEFAULT false,
  "public_key_registered" BOOLEAN NOT NULL DEFAULT false,
  "callback_registered" BOOLEAN NOT NULL DEFAULT false,
  "ip_whitelist_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "paycools_environment_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paycools_environment_configurations_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "payment_partner_configurations"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "paycools_environment_configurations_configuration_id_environment_key"
  ON "paycools_environment_configurations"("configuration_id", "environment");
