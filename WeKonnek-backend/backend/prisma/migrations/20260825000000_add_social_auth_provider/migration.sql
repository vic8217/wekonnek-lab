CREATE TABLE "social_auth_providers" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "client_id" TEXT,
  "encrypted_client_secret" TEXT,
  "team_id" TEXT,
  "key_id" TEXT,
  "encrypted_private_key" TEXT,
  "callback_url" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'NOT_TESTED',
  "last_tested_at" TIMESTAMP(3),
  "last_test_result" TEXT,
  "updated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_auth_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_auth_providers_provider_environment_key"
  ON "social_auth_providers"("provider", "environment");
