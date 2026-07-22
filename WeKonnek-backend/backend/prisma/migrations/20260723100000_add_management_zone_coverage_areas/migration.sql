ALTER TABLE "management_zone_coverages"
ADD COLUMN "areas" JSONB NOT NULL DEFAULT '[]'::jsonb;
