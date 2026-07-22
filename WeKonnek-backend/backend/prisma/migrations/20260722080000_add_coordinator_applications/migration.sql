CREATE TABLE "coordinator_applications" (
  "id" SERIAL PRIMARY KEY,
  "full_name" VARCHAR(255) NOT NULL,
  "mobile_number" VARCHAR(30) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "region" VARCHAR(100) NOT NULL,
  "province_district" VARCHAR(100) NOT NULL,
  "city_municipality" VARCHAR(100) NOT NULL,
  "barangay" VARCHAR(150),
  "preferred_coverage_area" TEXT,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "background" VARCHAR(150),
  "occupation" VARCHAR(255),
  "motivation" TEXT,
  "monthly_capacity" VARCHAR(50),
  "referred" VARCHAR(100),
  "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "coordinator_applications_status_idx" ON "coordinator_applications"("status");
CREATE INDEX "coordinator_applications_city_municipality_idx" ON "coordinator_applications"("city_municipality");
