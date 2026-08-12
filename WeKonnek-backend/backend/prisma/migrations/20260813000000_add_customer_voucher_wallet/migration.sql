ALTER TABLE "vouchers"
ADD COLUMN "vip_only" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "customer_vouchers" (
  "id" UUID NOT NULL,
  "voucher_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_vouchers_voucher_id_user_id_key"
ON "customer_vouchers"("voucher_id", "user_id");
CREATE INDEX "customer_vouchers_user_id_claimed_at_idx"
ON "customer_vouchers"("user_id", "claimed_at");

ALTER TABLE "customer_vouchers"
ADD CONSTRAINT "customer_vouchers_voucher_id_fkey"
FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_vouchers"
ADD CONSTRAINT "customer_vouchers_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
