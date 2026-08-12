ALTER TABLE "branches"
ADD COLUMN "manual_open_override" BOOLEAN,
ADD COLUMN "manual_override_updated_at" TIMESTAMPTZ,
ADD COLUMN "manual_override_updated_by" UUID;
