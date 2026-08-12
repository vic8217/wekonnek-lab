ALTER TABLE "promotions"
ADD COLUMN "min_order_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "voucher_id" UUID;

CREATE UNIQUE INDEX "promotions_voucher_id_key" ON "promotions"("voucher_id");

ALTER TABLE "promotions"
ADD CONSTRAINT "promotions_voucher_id_fkey"
FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "vouchers" (
  "id", "code", "title", "description", "discount_type", "discount_value",
  "min_order_amount", "status", "max_total_uses", "max_uses_per_user",
  "total_redemptions", "starts_at", "expires_at", "created_at", "updated_at", "vip_only"
)
SELECT
  gen_random_uuid(), 'PROMO-' || p."merchant_id" || '-' || p."id", p."title",
  p."description", p."discount_type"::"DiscountType", COALESCE(p."discount_value", 0),
  p."min_order_amount", 'active'::"VoucherStatus", 0, 1, 0,
  COALESCE(p."start_date", CURRENT_TIMESTAMP),
  COALESCE(p."end_date", TIMESTAMPTZ '2099-12-31 23:59:59+00'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, false
FROM "promotions" p
WHERE p."discount_type" IN ('percentage', 'fixed')
ON CONFLICT ("code") DO NOTHING;

UPDATE "promotions" p
SET "voucher_id" = v."id"
FROM "vouchers" v
WHERE v."code" = 'PROMO-' || p."merchant_id" || '-' || p."id";
