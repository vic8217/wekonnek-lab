CREATE TABLE "subscription_plan_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "audience" VARCHAR(30) NOT NULL,
  "tier" VARCHAR(50) NOT NULL,
  "fixed_amount" DECIMAL(10,2) NOT NULL,
  "variable_order_percent" DECIMAL(5,2),
  "product_limit" INTEGER,
  "minimum_orders" INTEGER,
  "includes_in_house_riders" BOOLEAN,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_plan_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plan_definitions_audience_tier_key"
  ON "subscription_plan_definitions"("audience", "tier");
CREATE INDEX "subscription_plan_definitions_audience_is_active_idx"
  ON "subscription_plan_definitions"("audience", "is_active");
