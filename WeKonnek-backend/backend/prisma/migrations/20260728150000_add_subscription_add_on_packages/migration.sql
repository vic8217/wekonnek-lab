CREATE TABLE IF NOT EXISTS "subscription_add_on_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "audience" VARCHAR(30) NOT NULL DEFAULT 'merchant',
  "name" VARCHAR(100) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "billing_unit" VARCHAR(20) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_add_on_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_add_on_packages_audience_name_key"
  ON "subscription_add_on_packages"("audience", "name");
CREATE INDEX IF NOT EXISTS "subscription_add_on_packages_audience_is_active_idx"
  ON "subscription_add_on_packages"("audience", "is_active");
