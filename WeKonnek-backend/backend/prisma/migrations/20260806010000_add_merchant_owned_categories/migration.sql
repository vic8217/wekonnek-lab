ALTER TABLE "categories" ADD COLUMN "owner_merchant_id" INTEGER;
ALTER TABLE "sub_categories" ADD COLUMN "owner_merchant_id" INTEGER;

CREATE INDEX "categories_owner_merchant_id_idx" ON "categories"("owner_merchant_id");
CREATE INDEX "sub_categories_owner_merchant_id_idx" ON "sub_categories"("owner_merchant_id");

ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_merchant_id_fkey"
  FOREIGN KEY ("owner_merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_owner_merchant_id_fkey"
  FOREIGN KEY ("owner_merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
