-- Rollback for 20260915120000_stage1a_payment_ownership_foundation
-- Prefer application rollback before dropping schema with dependents.

ALTER TABLE "merchant_payment_evidences" DROP CONSTRAINT IF EXISTS "merchant_payment_evidences_merchant_payment_method_id_fkey";
ALTER TABLE "merchant_payment_evidences" DROP CONSTRAINT IF EXISTS "merchant_payment_evidences_wk_order_id_fkey";
DROP TABLE IF EXISTS "merchant_payment_evidences";

ALTER TABLE "order_payment_allocations" DROP CONSTRAINT IF EXISTS "order_payment_allocations_wk_order_id_fkey";
DROP TABLE IF EXISTS "order_payment_allocations";

ALTER TABLE "merchant_payment_methods" DROP CONSTRAINT IF EXISTS "merchant_payment_methods_shop_id_fkey";
ALTER TABLE "merchant_payment_methods" DROP CONSTRAINT IF EXISTS "merchant_payment_methods_merchant_id_fkey";
DROP TABLE IF EXISTS "merchant_payment_methods";

ALTER TABLE "orders" DROP COLUMN IF EXISTS "merchant_payment_status";

DROP TYPE IF EXISTS "MerchantPaymentStatus";
DROP TYPE IF EXISTS "MerchantPaymentMethodKind";
DROP TYPE IF EXISTS "PaymentAllocationComponent";
DROP TYPE IF EXISTS "PaymentPurpose";
DROP TYPE IF EXISTS "PaymentBeneficiaryType";
