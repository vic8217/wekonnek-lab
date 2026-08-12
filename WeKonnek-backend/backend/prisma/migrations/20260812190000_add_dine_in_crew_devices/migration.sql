ALTER TABLE "merchant_staff"
  ADD COLUMN "display_name" VARCHAR(100),
  ADD COLUMN "dine_in_role" VARCHAR(30),
  ADD COLUMN "employee_code" VARCHAR(50),
  ADD COLUMN "crew_pin_hash" VARCHAR(255);

CREATE TABLE "merchant_feature_grants" (
  "id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "feature_key" VARCHAR(80) NOT NULL,
  "source" VARCHAR(30) NOT NULL DEFAULT 'add_on',
  "limits" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMPTZ,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchant_feature_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "merchant_feature_grants_merchant_id_feature_key_source_key" ON "merchant_feature_grants"("merchant_id", "feature_key", "source");
CREATE INDEX "merchant_feature_grants_merchant_id_feature_key_is_active_idx" ON "merchant_feature_grants"("merchant_id", "feature_key", "is_active");

CREATE TABLE "crew_devices" (
  "id" UUID NOT NULL, "merchant_id" INTEGER NOT NULL, "shop_id" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL, "role" VARCHAR(30) NOT NULL, "platform" VARCHAR(80),
  "token_hash" VARCHAR(64) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "registered_by_user_id" UUID NOT NULL, "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ, "revoked_at" TIMESTAMPTZ,
  CONSTRAINT "crew_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_devices_token_hash_key" ON "crew_devices"("token_hash");
CREATE INDEX "crew_devices_merchant_id_shop_id_status_idx" ON "crew_devices"("merchant_id", "shop_id", "status");

CREATE TABLE "crew_pairing_tokens" (
  "id" UUID NOT NULL, "merchant_id" INTEGER NOT NULL, "shop_id" INTEGER NOT NULL,
  "role" VARCHAR(30) NOT NULL, "code_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL, "used_at" TIMESTAMPTZ,
  "created_by_user_id" UUID NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_pairing_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_pairing_tokens_code_hash_key" ON "crew_pairing_tokens"("code_hash");
CREATE INDEX "crew_pairing_tokens_merchant_id_expires_at_idx" ON "crew_pairing_tokens"("merchant_id", "expires_at");

CREATE TABLE "crew_device_sessions" (
  "id" UUID NOT NULL, "device_id" UUID NOT NULL, "staff_id" INTEGER NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL, "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_device_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_device_sessions_token_hash_key" ON "crew_device_sessions"("token_hash");
CREATE INDEX "crew_device_sessions_device_id_staff_id_idx" ON "crew_device_sessions"("device_id", "staff_id");

CREATE TABLE "dine_in_audit_logs" (
  "id" UUID NOT NULL, "merchant_id" INTEGER NOT NULL, "shop_id" INTEGER,
  "staff_id" INTEGER, "device_id" UUID, "action" VARCHAR(80) NOT NULL,
  "metadata" JSONB, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dine_in_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dine_in_audit_logs_merchant_id_created_at_idx" ON "dine_in_audit_logs"("merchant_id", "created_at");

ALTER TABLE "merchant_feature_grants" ADD CONSTRAINT "merchant_feature_grants_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE;
ALTER TABLE "crew_devices" ADD CONSTRAINT "crew_devices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE;
ALTER TABLE "crew_devices" ADD CONSTRAINT "crew_devices_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE CASCADE;
ALTER TABLE "crew_pairing_tokens" ADD CONSTRAINT "crew_pairing_tokens_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE;
ALTER TABLE "crew_pairing_tokens" ADD CONSTRAINT "crew_pairing_tokens_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE CASCADE;
ALTER TABLE "crew_device_sessions" ADD CONSTRAINT "crew_device_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "crew_devices"("id") ON DELETE CASCADE;
ALTER TABLE "crew_device_sessions" ADD CONSTRAINT "crew_device_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "merchant_staff"("id") ON DELETE RESTRICT;
ALTER TABLE "dine_in_audit_logs" ADD CONSTRAINT "dine_in_audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE;
ALTER TABLE "dine_in_audit_logs" ADD CONSTRAINT "dine_in_audit_logs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "merchant_staff"("id") ON DELETE SET NULL;
ALTER TABLE "dine_in_audit_logs" ADD CONSTRAINT "dine_in_audit_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "crew_devices"("id") ON DELETE SET NULL;
