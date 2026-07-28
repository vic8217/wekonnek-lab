ALTER TABLE "merchant_applications"
ADD COLUMN "has_branches" BOOLEAN,
ADD COLUMN "branch_count" INTEGER,
ADD COLUMN "product_count" INTEGER;
