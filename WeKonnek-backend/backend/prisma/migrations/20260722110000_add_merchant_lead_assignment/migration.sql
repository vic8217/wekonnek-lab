ALTER TABLE "merchant_applications"
  ADD COLUMN "contact_name" VARCHAR(255),
  ADD COLUMN "category_name" VARCHAR(150),
  ADD COLUMN "city_municipality" VARCHAR(100),
  ADD COLUMN "barangay" VARCHAR(150),
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7),
  ADD COLUMN "business_description" TEXT,
  ADD COLUMN "source" VARCHAR(50) NOT NULL DEFAULT 'merchant_application',
  ADD COLUMN "assigned_coordinator_id" UUID,
  ADD COLUMN "assigned_at" TIMESTAMPTZ;
CREATE INDEX "merchant_applications_city_municipality_barangay_idx" ON "merchant_applications"("city_municipality", "barangay");
CREATE INDEX "merchant_applications_assigned_coordinator_id_idx" ON "merchant_applications"("assigned_coordinator_id");
