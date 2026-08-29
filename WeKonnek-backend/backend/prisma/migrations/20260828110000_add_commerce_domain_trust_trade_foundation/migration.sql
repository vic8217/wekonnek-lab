CREATE TYPE "CommerceDomain" AS ENUM ('FOOD', 'NON_FOOD', 'MIXED');

ALTER TABLE "merchants" ADD COLUMN "commerce_domain" "CommerceDomain";
ALTER TABLE "products" ADD COLUMN "commerce_domain" "CommerceDomain";

CREATE TABLE "order_domain_links" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER,
  "order_v2_id" UUID,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "order_domain_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_domain_links_wk_order_id_key" ON "order_domain_links"("wk_order_id");
CREATE UNIQUE INDEX "order_domain_links_order_v2_id_key" ON "order_domain_links"("order_v2_id");
CREATE INDEX "order_domain_links_merchant_id_shop_id_idx" ON "order_domain_links"("merchant_id", "shop_id");

CREATE TABLE "trust_trade_transactions" (
  "id" UUID NOT NULL,
  "trust_trade_id" VARCHAR(40) NOT NULL,
  "wk_order_id" INTEGER,
  "order_v2_id" UUID,
  "merchant_id" INTEGER NOT NULL,
  "shop_id" INTEGER,
  "buyer_id" UUID NOT NULL,
  "source_type" VARCHAR(30) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'ORDER_CONFIRMED',
  "agreement_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "trust_trade_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trust_trade_transactions_trust_trade_id_key" ON "trust_trade_transactions"("trust_trade_id");
CREATE UNIQUE INDEX "trust_trade_transactions_wk_order_id_key" ON "trust_trade_transactions"("wk_order_id");
CREATE UNIQUE INDEX "trust_trade_transactions_order_v2_id_key" ON "trust_trade_transactions"("order_v2_id");
CREATE INDEX "trust_trade_transactions_buyer_id_created_at_idx" ON "trust_trade_transactions"("buyer_id", "created_at");
CREATE INDEX "trust_trade_transactions_merchant_id_status_idx" ON "trust_trade_transactions"("merchant_id", "status");
ALTER TABLE "trust_trade_transactions" ADD CONSTRAINT "trust_trade_transactions_wk_order_id_fkey" FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_trade_transactions" ADD CONSTRAINT "trust_trade_transactions_order_v2_id_fkey" FOREIGN KEY ("order_v2_id") REFERENCES "orders_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_trade_transactions" ADD CONSTRAINT "trust_trade_transactions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
