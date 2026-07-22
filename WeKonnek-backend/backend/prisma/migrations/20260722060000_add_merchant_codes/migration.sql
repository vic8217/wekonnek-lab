ALTER TABLE "merchants" ADD COLUMN "merchant_code" VARCHAR(20);
ALTER TABLE "merchant_applications" ADD COLUMN "merchant_code" VARCHAR(20);

CREATE UNIQUE INDEX "merchants_merchant_code_key" ON "merchants"("merchant_code");
CREATE UNIQUE INDEX "merchant_applications_merchant_code_key" ON "merchant_applications"("merchant_code");
