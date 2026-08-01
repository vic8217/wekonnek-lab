ALTER TABLE "merchant_applications"
ADD COLUMN "temporary_password" VARCHAR(100),
ADD COLUMN "recovery_key" VARCHAR(100);
