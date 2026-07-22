ALTER TABLE "coordinator_applications" ADD COLUMN "management_zone_id" UUID;
CREATE INDEX "coordinator_applications_management_zone_id_idx" ON "coordinator_applications"("management_zone_id");
ALTER TABLE "coordinator_applications" ADD CONSTRAINT "coordinator_applications_management_zone_id_fkey"
FOREIGN KEY ("management_zone_id") REFERENCES "management_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
