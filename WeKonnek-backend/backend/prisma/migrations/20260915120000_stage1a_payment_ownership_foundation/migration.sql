-- Stage 1A: payment ownership foundation (additive, backward compatible)
-- Rollback: see rollback.sql

DO $$ BEGIN
  CREATE TYPE "PaymentBeneficiaryType" AS ENUM ('MERCHANT', 'PLATFORM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentPurpose" AS ENUM (
    'MERCHANT_ORDER',
    'PLATFORM_SUBSCRIPTION',
    'PLATFORM_LISTING_FEE',
    'PLATFORM_PROPERTY_FEE',
    'PLATFORM_WALLET_RELOAD',
    'PLATFORM_OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentAllocationComponent" AS ENUM (
    'MERCHANDISE',
    'PLATFORM_FEE',
    'DELIVERY_FEE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MerchantPaymentMethodKind" AS ENUM (
    'CASH',
    'MERCHANT_QR',
    'BANK_TRANSFER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MerchantPaymentStatus" AS ENUM (
    'NOT_REQUIRED',
    'AWAITING_PAYMENT',
    'PROOF_SUBMITTED',
    'VERIFIED',
    'REJECTED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "merchant_payment_status" "MerchantPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

CREATE INDEX IF NOT EXISTS "orders_merchant_payment_status_idx"
  ON "orders"("merchant_payment_status");

CREATE TABLE IF NOT EXISTS "merchant_payment_methods" (
  "id" UUID NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER,
  "kind" "MerchantPaymentMethodKind" NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "account_name" VARCHAR(120),
  "account_reference" VARCHAR(120),
  "instructions" TEXT,
  "qr_asset_url" VARCHAR(1000),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "merchant_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "merchant_payment_methods_merchant_id_enabled_sort_order_idx"
  ON "merchant_payment_methods"("merchant_id", "enabled", "sort_order");
CREATE INDEX IF NOT EXISTS "merchant_payment_methods_shop_id_enabled_idx"
  ON "merchant_payment_methods"("shop_id", "enabled");

DO $$ BEGIN
  ALTER TABLE "merchant_payment_methods"
    ADD CONSTRAINT "merchant_payment_methods_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_payment_methods"
    ADD CONSTRAINT "merchant_payment_methods_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "order_payment_allocations" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "component" "PaymentAllocationComponent" NOT NULL,
  "beneficiary_type" "PaymentBeneficiaryType" NOT NULL,
  "beneficiary_id" VARCHAR(64) NOT NULL,
  "amount" DECIMAL(14, 2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "settlement_note" VARCHAR(120),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_payment_allocations_wk_order_id_component_key"
  ON "order_payment_allocations"("wk_order_id", "component");
CREATE INDEX IF NOT EXISTS "order_payment_allocations_beneficiary_type_beneficiary_id_idx"
  ON "order_payment_allocations"("beneficiary_type", "beneficiary_id");

DO $$ BEGIN
  ALTER TABLE "order_payment_allocations"
    ADD CONSTRAINT "order_payment_allocations_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "merchant_payment_evidences" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "merchant_payment_method_id" UUID NOT NULL,
  "declared_amount" DECIMAL(14, 2) NOT NULL,
  "customer_reference" VARCHAR(120),
  "proof_asset_url" VARCHAR(1000),
  "status" "MerchantPaymentStatus" NOT NULL DEFAULT 'PROOF_SUBMITTED',
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_by" UUID NOT NULL,
  "verified_at" TIMESTAMPTZ,
  "verified_by" UUID,
  "rejection_reason" VARCHAR(255),
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "merchant_payment_evidences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_payment_evidences_idempotency_key_key"
  ON "merchant_payment_evidences"("idempotency_key");
CREATE INDEX IF NOT EXISTS "merchant_payment_evidences_wk_order_id_status_idx"
  ON "merchant_payment_evidences"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_payment_evidences_merchant_payment_method_id_idx"
  ON "merchant_payment_evidences"("merchant_payment_method_id");

DO $$ BEGIN
  ALTER TABLE "merchant_payment_evidences"
    ADD CONSTRAINT "merchant_payment_evidences_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "merchant_payment_evidences"
    ADD CONSTRAINT "merchant_payment_evidences_merchant_payment_method_id_fkey"
    FOREIGN KEY ("merchant_payment_method_id") REFERENCES "merchant_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
