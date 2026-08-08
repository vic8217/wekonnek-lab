-- The original shop inventory migration was applied before these fields were
-- added to its migration file. Add them forward-only for existing databases.
ALTER TABLE "shop_inventory"
ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "shop_inventory"
ADD CONSTRAINT "shop_inventory_reserved_quantity_check"
CHECK ("reserved_quantity" >= 0 AND "reserved_quantity" <= "quantity");

ALTER TABLE "inventory_movements"
ADD COLUMN "reference_type" VARCHAR(50),
ADD COLUMN "reference_id" VARCHAR(100),
ADD COLUMN "reason" VARCHAR(100),
ADD COLUMN "unit_cost" DECIMAL(10, 2),
ADD COLUMN "created_by" UUID;
