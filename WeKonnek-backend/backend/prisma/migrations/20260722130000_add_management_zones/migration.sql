CREATE TABLE "management_zones" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "management_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "management_zones_code_key" ON "management_zones"("code");

CREATE TABLE "management_zone_coverages" (
  "id" UUID NOT NULL,
  "zone_id" UUID NOT NULL,
  "region_code" TEXT NOT NULL,
  "region_name" TEXT NOT NULL,
  "province_code" TEXT,
  "province_name" TEXT,
  "city_municipality_code" TEXT NOT NULL,
  "city_municipality_name" TEXT NOT NULL,
  "congressional_district" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "management_zone_coverages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "management_zone_coverages_zone_id_city_municipality_code_congressional_district_key"
ON "management_zone_coverages"("zone_id", "city_municipality_code", "congressional_district");
CREATE INDEX "management_zone_coverages_city_municipality_code_congressional_district_idx"
ON "management_zone_coverages"("city_municipality_code", "congressional_district");
ALTER TABLE "management_zone_coverages" ADD CONSTRAINT "management_zone_coverages_zone_id_fkey"
FOREIGN KEY ("zone_id") REFERENCES "management_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
