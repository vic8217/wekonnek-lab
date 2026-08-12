ALTER TABLE "inventory_movements"
  ADD COLUMN "delivery_date" DATE,
  ADD COLUMN "delivered_by" VARCHAR(150),
  ADD COLUMN "received_at" TIMESTAMPTZ;
