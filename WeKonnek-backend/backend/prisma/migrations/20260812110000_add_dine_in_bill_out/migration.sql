ALTER TABLE "orders"
ADD COLUMN "discount_type" VARCHAR(30),
ADD COLUMN "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "discount_details" JSONB,
ADD COLUMN "voucher_id" UUID;
