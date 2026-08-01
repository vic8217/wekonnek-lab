ALTER TABLE "merchant_applications"
ADD COLUMN "selected_add_on_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
