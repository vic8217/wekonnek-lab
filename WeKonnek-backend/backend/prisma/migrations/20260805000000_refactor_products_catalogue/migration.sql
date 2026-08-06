ALTER TABLE "products"
  ADD COLUMN "product_type" VARCHAR(50) NOT NULL DEFAULT 'Retail Product',
  ADD COLUMN "brand" VARCHAR(150),
  ADD COLUMN "unit" VARCHAR(50) NOT NULL DEFAULT 'Piece',
  ADD COLUMN "base_sku" VARCHAR(100),
  ADD COLUMN "barcode" VARCHAR(100),
  ADD COLUMN "cost_price" DECIMAL(10,2),
  ADD COLUMN "selling_price" DECIMAL(10,2),
  ADD COLUMN "discount_price" DECIMAL(10,2),
  ADD COLUMN "has_variants" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "track_inventory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "availability_status" VARCHAR(30) NOT NULL DEFAULT 'Available';

UPDATE "products"
SET "base_sku" = COALESCE("sku", "product_code"),
    "selling_price" = "price",
    "availability_status" = CASE WHEN "is_available" THEN 'Available' ELSE 'Unavailable' END;

UPDATE "products" AS p
SET "product_type" = CASE c."slug"
  WHEN 'food-beverages' THEN 'Food'
  WHEN 'groceries' THEN 'Retail Product'
  WHEN 'services' THEN 'Service'
  WHEN 'retail-shopping' THEN 'Retail Product'
  WHEN 'health-wellness' THEN 'Retail Product'
  ELSE p."product_type"
END
FROM "merchants" AS m
LEFT JOIN "categories" AS c ON c."id" = m."category_id"
WHERE p."merchant_id" = m."id";

CREATE TABLE "product_options" (
  "id" SERIAL PRIMARY KEY,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "product_options_product_id_idx" ON "product_options"("product_id");

CREATE TABLE "product_option_values" (
  "id" SERIAL PRIMARY KEY,
  "option_id" INTEGER NOT NULL REFERENCES "product_options"("id") ON DELETE CASCADE,
  "value" VARCHAR(150) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "product_option_values_option_id_idx" ON "product_option_values"("option_id");

CREATE TABLE "product_variants" (
  "id" SERIAL PRIMARY KEY,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "sku" VARCHAR(100) NOT NULL UNIQUE,
  "barcode" VARCHAR(100),
  "price" DECIMAL(10,2),
  "image_url" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

CREATE TABLE "product_variant_option_values" (
  "variant_id" INTEGER NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "option_value_id" INTEGER NOT NULL REFERENCES "product_option_values"("id") ON DELETE CASCADE,
  PRIMARY KEY ("variant_id", "option_value_id")
);
