ALTER TABLE "payment_partner_configurations"
  ADD COLUMN IF NOT EXISTS "uat_public_key_registration_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "uat_ip_whitelist_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "uat_callback_registration_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prod_public_key_registration_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prod_ip_whitelist_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prod_callback_registration_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "uat_last_connection_test_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "uat_last_connection_test_successful" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "uat_last_connection_test_error_code" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "prod_last_connection_test_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "prod_last_connection_test_successful" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "prod_last_connection_test_error_code" VARCHAR(100);

-- A previously seeded provider must not become operational before it passes
-- the new readiness checks. The service still treats legacy enabled rows as
-- non-operational until ready.
UPDATE "payment_partner_configurations"
SET "enabled" = false
WHERE "provider_code" = 'PAYCOOLS'
  AND ("enabled" = true)
  AND ("uat_last_connection_test_successful" IS DISTINCT FROM true)
  AND ("prod_last_connection_test_successful" IS DISTINCT FROM true);
