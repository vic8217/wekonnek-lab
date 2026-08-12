ALTER TABLE "promotions"
ADD COLUMN "applies_to_total_bill" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "category_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "bundle_items" JSONB,
ADD COLUMN "bundle_price" DECIMAL(10,2);
