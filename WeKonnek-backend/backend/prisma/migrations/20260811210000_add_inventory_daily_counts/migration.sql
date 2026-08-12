CREATE TABLE "inventory_daily_counts" (
  "id" SERIAL NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "variant_id" INTEGER,
  "variant_key" INTEGER NOT NULL DEFAULT 0,
  "business_date" DATE NOT NULL,
  "beginning_balance" INTEGER NOT NULL,
  "expected_ending" INTEGER NOT NULL,
  "ending_balance" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,
  "counted_by" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_daily_counts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_daily_counts_shop_id_product_id_variant_key_business_date_key" ON "inventory_daily_counts"("shop_id", "product_id", "variant_key", "business_date");
CREATE INDEX "inventory_daily_counts_merchant_id_shop_id_business_date_idx" ON "inventory_daily_counts"("merchant_id", "shop_id", "business_date");
ALTER TABLE "inventory_daily_counts" ADD CONSTRAINT "inventory_daily_counts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_daily_counts" ADD CONSTRAINT "inventory_daily_counts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_daily_counts" ADD CONSTRAINT "inventory_daily_counts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_daily_counts" ADD CONSTRAINT "inventory_daily_counts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
