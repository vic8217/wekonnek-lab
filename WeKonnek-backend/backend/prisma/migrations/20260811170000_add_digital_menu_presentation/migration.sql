ALTER TABLE "shop_products"
  ADD COLUMN "is_on_menu" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "menu_visible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "menu_description" TEXT,
  ADD COLUMN "menu_badge" VARCHAR(20),
  ADD COLUMN "menu_featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "menu_category" VARCHAR(120),
  ADD COLUMN "menu_display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "menu_category_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "shop_products_shop_id_is_on_menu_menu_visible_idx"
  ON "shop_products"("shop_id", "is_on_menu", "menu_visible");

CREATE INDEX "shop_products_shop_id_menu_category_order_menu_display_order_idx"
  ON "shop_products"("shop_id", "menu_category_order", "menu_display_order");
