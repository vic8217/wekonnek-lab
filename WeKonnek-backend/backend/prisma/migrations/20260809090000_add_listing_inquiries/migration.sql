CREATE TYPE "ListingInquiryType" AS ENUM ('BAZAAR', 'PROPERTY');
CREATE TYPE "ListingInquiryStatus" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');

CREATE TABLE "listing_inquiries" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "listing_type" "ListingInquiryType" NOT NULL,
  "listing_owner_id" UUID NOT NULL,
  "inquirer_id" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "status" "ListingInquiryStatus" NOT NULL DEFAULT 'OPEN',
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listing_inquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_inquiries_listing_owner_id_fkey" FOREIGN KEY ("listing_owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "listing_inquiries_inquirer_id_fkey" FOREIGN KEY ("inquirer_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "listing_inquiries_listing_owner_id_listing_type_read_at_idx" ON "listing_inquiries"("listing_owner_id", "listing_type", "read_at");
CREATE INDEX "listing_inquiries_listing_id_listing_type_created_at_idx" ON "listing_inquiries"("listing_id", "listing_type", "created_at");
CREATE INDEX "listing_inquiries_inquirer_id_created_at_idx" ON "listing_inquiries"("inquirer_id", "created_at");
