ALTER TABLE "subscription_plan_definitions"
ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
