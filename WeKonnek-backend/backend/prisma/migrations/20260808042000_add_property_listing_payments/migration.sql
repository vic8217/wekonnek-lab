ALTER TABLE "property_listings"
ADD COLUMN "listing_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
ADD COLUMN "payment_gateway" TEXT,
ADD COLUMN "payment_method" TEXT,
ADD COLUMN "payment_ref" TEXT,
ADD COLUMN "payment_url" TEXT;

CREATE INDEX "property_listings_payment_status_idx" ON "property_listings"("payment_status");
