ALTER TABLE "dine_in_changes"
ADD COLUMN "merchant_id" INTEGER;

CREATE INDEX "dine_in_changes_merchant_id_idx"
ON "dine_in_changes"("merchant_id");

ALTER TABLE "dine_in_changes"
ADD CONSTRAINT "dine_in_changes_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
ON DELETE SET NULL;
