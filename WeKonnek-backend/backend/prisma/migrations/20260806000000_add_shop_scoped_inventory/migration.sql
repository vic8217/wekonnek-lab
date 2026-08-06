CREATE TABLE "shop_products" (
  "id" SERIAL PRIMARY KEY,
  "merchant_id" INTEGER NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "shop_id" INTEGER NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "price_override" DECIMAL(10,2),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_products_shop_id_product_id_key" UNIQUE ("shop_id", "product_id")
);

CREATE INDEX "shop_products_merchant_id_shop_id_idx" ON "shop_products"("merchant_id", "shop_id");

CREATE TABLE "shop_inventory" (
  "id" SERIAL PRIMARY KEY,
  "merchant_id" INTEGER NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "shop_id" INTEGER NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "variant_id" INTEGER REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "quantity" INTEGER NOT NULL DEFAULT 0 CHECK ("quantity" >= 0),
  "reserved_quantity" INTEGER NOT NULL DEFAULT 0 CHECK ("reserved_quantity" >= 0 AND "reserved_quantity" <= "quantity"),
  "reorder_level" INTEGER NOT NULL DEFAULT 0 CHECK ("reorder_level" >= 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "shop_inventory_variant_key" ON "shop_inventory"("shop_id", "product_id", "variant_id") WHERE "variant_id" IS NOT NULL;
CREATE UNIQUE INDEX "shop_inventory_standard_key" ON "shop_inventory"("shop_id", "product_id") WHERE "variant_id" IS NULL;
CREATE INDEX "shop_inventory_merchant_id_shop_id_product_id_idx" ON "shop_inventory"("merchant_id", "shop_id", "product_id");

CREATE TABLE "inventory_movements" (
  "id" SERIAL PRIMARY KEY,
  "merchant_id" INTEGER NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "shop_id" INTEGER NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "variant_id" INTEGER REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "type" VARCHAR(30) NOT NULL CHECK ("type" IN ('receipt', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out', 'reservation', 'reservation_release')),
  "quantity_change" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL CHECK ("balance_after" >= 0),
  "transfer_shop_id" INTEGER REFERENCES "branches"("id") ON DELETE SET NULL,
  "reference" VARCHAR(150),
  "reference_type" VARCHAR(50),
  "reference_id" VARCHAR(100),
  "reason" VARCHAR(100),
  "unit_cost" DECIMAL(10,2),
  "created_by" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "inventory_movements_scope_idx" ON "inventory_movements"("merchant_id", "shop_id", "product_id", "variant_id");
CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements"("created_at");

ALTER TABLE "orders" ADD COLUMN "shop_id" INTEGER REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "order_items" ADD COLUMN "variant_id" INTEGER REFERENCES "product_variants"("id") ON DELETE SET NULL;
CREATE INDEX "orders_shop_id_idx" ON "orders"("shop_id");
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- Preserve existing stock in the default shop without duplicating products.
INSERT INTO "shop_products" ("merchant_id", "shop_id", "product_id")
SELECT p."merchant_id", b."id", p."id"
FROM "products" p
JOIN "branches" b ON b."merchant_id" = p."merchant_id" AND b."is_default" = true
ON CONFLICT ("shop_id", "product_id") DO NOTHING;

INSERT INTO "shop_inventory" ("merchant_id", "shop_id", "product_id", "quantity", "reorder_level")
SELECT p."merchant_id", b."id", p."id", GREATEST(p."quantity", 0), GREATEST(p."low_stock_threshold", 0)
FROM "products" p
JOIN "branches" b ON b."merchant_id" = p."merchant_id" AND b."is_default" = true
WHERE p."has_variants" = false
ON CONFLICT DO NOTHING;

INSERT INTO "shop_inventory" ("merchant_id", "shop_id", "product_id", "variant_id", "quantity", "reorder_level")
SELECT p."merchant_id", b."id", p."id", v."id", 0, GREATEST(p."low_stock_threshold", 0)
FROM "products" p
JOIN "branches" b ON b."merchant_id" = p."merchant_id" AND b."is_default" = true
JOIN "product_variants" v ON v."product_id" = p."id"
WHERE p."has_variants" = true
ON CONFLICT DO NOTHING;
