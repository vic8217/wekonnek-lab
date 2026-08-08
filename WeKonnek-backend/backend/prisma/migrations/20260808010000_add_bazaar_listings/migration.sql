CREATE TABLE "bazaar_listings" (
  "id" UUID PRIMARY KEY,
  "seller_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sub_category_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "image_urls" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "listing_fee" DECIMAL(12,2) NOT NULL DEFAULT 15,
  "payment_gateway" TEXT,
  "payment_method" TEXT,
  "payment_ref" TEXT,
  "payment_url" TEXT,
  "published_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "bazaar_listings_seller_id_idx" ON "bazaar_listings"("seller_id");
CREATE INDEX "bazaar_listings_sub_category_id_status_idx" ON "bazaar_listings"("sub_category_id", "status");
