CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VIEWED', 'QUOTED', 'REVISED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED_TO_ORDER', 'CANCELLED');
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'REVISED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED_TO_ORDER', 'CANCELLED');

CREATE TABLE "request_for_quotations" (
  "id" UUID NOT NULL,
  "rfq_number" VARCHAR(40) NOT NULL,
  "buyer_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "product_variant_id" INTEGER,
  "quantity" INTEGER NOT NULL,
  "specifications" TEXT,
  "size" VARCHAR(100),
  "color" VARCHAR(100),
  "customization" TEXT,
  "required_date" DATE,
  "delivery_address" TEXT,
  "notes" TEXT,
  "snapshot" JSONB NOT NULL,
  "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_at" TIMESTAMPTZ,
  "viewed_at" TIMESTAMPTZ,
  "accepted_at" TIMESTAMPTZ,
  "declined_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "request_for_quotations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "request_for_quotations_rfq_number_key" ON "request_for_quotations"("rfq_number");
CREATE INDEX "request_for_quotations_buyer_id_created_at_idx" ON "request_for_quotations"("buyer_id", "created_at");
CREATE INDEX "request_for_quotations_merchant_id_shop_id_status_idx" ON "request_for_quotations"("merchant_id", "shop_id", "status");

CREATE TABLE "merchant_quotations" (
  "id" UUID NOT NULL,
  "quotation_number" VARCHAR(40) NOT NULL,
  "rfq_id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER NOT NULL,
  "buyer_id" UUID NOT NULL,
  "wk_order_id" INTEGER,
  "version" INTEGER NOT NULL,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "unit_price" DECIMAL(10,2) NOT NULL,
  "subtotal" DECIMAL(10,2) NOT NULL,
  "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "delivery_charge" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "other_charges" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(10,2) NOT NULL,
  "lead_time" VARCHAR(255),
  "promised_date" DATE,
  "valid_until" TIMESTAMPTZ NOT NULL,
  "payment_terms" TEXT,
  "merchant_notes" TEXT,
  "return_cancellation_terms" TEXT,
  "revision_request" TEXT,
  "accepted_snapshot" JSONB,
  "sent_at" TIMESTAMPTZ,
  "accepted_at" TIMESTAMPTZ,
  "declined_at" TIMESTAMPTZ,
  "converted_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "merchant_quotations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "merchant_quotations_quotation_number_key" ON "merchant_quotations"("quotation_number");
CREATE UNIQUE INDEX "merchant_quotations_wk_order_id_key" ON "merchant_quotations"("wk_order_id");
CREATE UNIQUE INDEX "merchant_quotations_rfq_id_version_key" ON "merchant_quotations"("rfq_id", "version");
CREATE INDEX "merchant_quotations_buyer_id_status_idx" ON "merchant_quotations"("buyer_id", "status");
CREATE INDEX "merchant_quotations_merchant_id_shop_id_status_idx" ON "merchant_quotations"("merchant_id", "shop_id", "status");

ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merchant_quotations" ADD CONSTRAINT "merchant_quotations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "request_for_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_quotations" ADD CONSTRAINT "merchant_quotations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_quotations" ADD CONSTRAINT "merchant_quotations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_quotations" ADD CONSTRAINT "merchant_quotations_wk_order_id_fkey" FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
