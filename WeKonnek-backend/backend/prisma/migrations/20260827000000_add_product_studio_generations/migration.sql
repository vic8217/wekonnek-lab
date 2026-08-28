CREATE TABLE "product_studio_generations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "merchant_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "category_id" INTEGER NOT NULL,
  "original_media_id" UUID NOT NULL,
  "generated_media_id" UUID,
  "style" VARCHAR(100) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'review',
  "credits_used" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_studio_generations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_studio_generations_merchant_id_created_at_idx" ON "product_studio_generations"("merchant_id", "created_at");
CREATE INDEX "product_studio_generations_product_id_category_id_idx" ON "product_studio_generations"("product_id", "category_id");
ALTER TABLE "product_studio_generations" ADD CONSTRAINT "product_studio_generations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_studio_generations" ADD CONSTRAINT "product_studio_generations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_studio_generations" ADD CONSTRAINT "product_studio_generations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
