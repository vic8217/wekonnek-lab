CREATE TYPE "PlatformPaymentDestination" AS ENUM ('MERCHANT_ACCOUNT', 'USER_WALLET', 'RIDER_WALLET');
CREATE TYPE "PlatformPaymentSourceType" AS ENUM ('RESTAURANT_ORDER', 'RETAIL_ORDER', 'ADVANCE_ORDER', 'TAKE_OUT', 'RESERVATION', 'MERCHANT_SUBSCRIPTION', 'USER_WALLET_LOAD', 'RIDER_WALLET_LOAD');
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

CREATE TABLE "platform_payment_transactions" (
  "id" UUID NOT NULL, "reference" VARCHAR(32) NOT NULL, "provider" VARCHAR(30) NOT NULL,
  "provider_transaction_id" VARCHAR(100), "provider_qr_code_id" VARCHAR(100), "idempotency_key" VARCHAR(30) NOT NULL,
  "destination" "PlatformPaymentDestination" NOT NULL, "source_type" "PlatformPaymentSourceType" NOT NULL, "source_id" VARCHAR(100),
  "merchant_id" INTEGER, "payer_user_id" UUID, "rider_id" UUID, "wallet_id" UUID,
  "amount" DECIMAL(14,2) NOT NULL, "provider_amount_minor" INTEGER NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING', "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "paid_at" TIMESTAMPTZ,
  CONSTRAINT "platform_payment_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_payment_transactions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_payment_transactions_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_payment_transactions_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_payment_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_payment_destination_owner_check" CHECK (
    ("destination" = 'MERCHANT_ACCOUNT' AND "merchant_id" IS NOT NULL AND "wallet_id" IS NULL AND "rider_id" IS NULL)
    OR ("destination" = 'USER_WALLET' AND "wallet_id" IS NOT NULL AND "payer_user_id" IS NOT NULL AND "merchant_id" IS NULL AND "rider_id" IS NULL)
    OR ("destination" = 'RIDER_WALLET' AND "wallet_id" IS NOT NULL AND "rider_id" IS NOT NULL AND "merchant_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "platform_payment_transactions_reference_key" ON "platform_payment_transactions"("reference");
CREATE UNIQUE INDEX "platform_payment_transactions_provider_transaction_id_key" ON "platform_payment_transactions"("provider_transaction_id");
CREATE UNIQUE INDEX "platform_payment_transactions_provider_qr_code_id_key" ON "platform_payment_transactions"("provider_qr_code_id");
CREATE UNIQUE INDEX "platform_payment_transactions_idempotency_key_key" ON "platform_payment_transactions"("idempotency_key");
CREATE INDEX "platform_payment_transactions_merchant_id_created_at_idx" ON "platform_payment_transactions"("merchant_id", "created_at");
CREATE INDEX "platform_payment_transactions_payer_user_id_created_at_idx" ON "platform_payment_transactions"("payer_user_id", "created_at");
CREATE INDEX "platform_payment_transactions_rider_id_created_at_idx" ON "platform_payment_transactions"("rider_id", "created_at");
CREATE INDEX "platform_payment_transactions_wallet_id_created_at_idx" ON "platform_payment_transactions"("wallet_id", "created_at");
CREATE INDEX "platform_payment_transactions_status_created_at_idx" ON "platform_payment_transactions"("status", "created_at");
CREATE INDEX "platform_payment_transactions_source_type_source_id_idx" ON "platform_payment_transactions"("source_type", "source_id");
