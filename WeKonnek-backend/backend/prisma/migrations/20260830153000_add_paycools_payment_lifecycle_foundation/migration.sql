-- Additive PayCools payment lifecycle persistence. No existing rows are
-- modified or removed.
ALTER TYPE "PlatformPaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PlatformPaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

CREATE TABLE "platform_payment_lifecycle_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_payment_transaction_id" UUID NOT NULL,
    "wk_order_id" INTEGER,
    "merchant_id" INTEGER,
    "customer_id" UUID,
    "provider" VARCHAR(30) NOT NULL,
    "environment" VARCHAR(30),
    "event_type" VARCHAR(100) NOT NULL,
    "actor_type" VARCHAR(30) NOT NULL,
    "actor_id" UUID,
    "previous_status" "PlatformPaymentStatus",
    "resulting_status" "PlatformPaymentStatus",
    "safe_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_payment_lifecycle_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_payment_lifecycle_events_platform_payment_transaction_id_fkey"
      FOREIGN KEY ("platform_payment_transaction_id") REFERENCES "platform_payment_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "platform_payment_lifecycle_events_platform_payment_transaction_id_created_at_idx"
  ON "platform_payment_lifecycle_events"("platform_payment_transaction_id", "created_at");
CREATE INDEX "platform_payment_lifecycle_events_wk_order_id_created_at_idx"
  ON "platform_payment_lifecycle_events"("wk_order_id", "created_at");
CREATE INDEX "platform_payment_lifecycle_events_merchant_id_created_at_idx"
  ON "platform_payment_lifecycle_events"("merchant_id", "created_at");
CREATE INDEX "platform_payment_lifecycle_events_customer_id_created_at_idx"
  ON "platform_payment_lifecycle_events"("customer_id", "created_at");
