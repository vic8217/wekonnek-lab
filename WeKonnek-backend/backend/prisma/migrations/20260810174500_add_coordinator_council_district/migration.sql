ALTER TABLE "coordinator_applications"
ADD COLUMN IF NOT EXISTS "council_district" VARCHAR(100);
