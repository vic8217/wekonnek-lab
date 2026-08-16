-- The legacy catalog reference data uses this optional UI grouping field.
-- Some databases received it from database/add-group-name-migration.sql,
-- while Prisma-managed servers did not have an equivalent migration.
ALTER TABLE "sub_categories"
ADD COLUMN IF NOT EXISTS "group_name" VARCHAR(100);
