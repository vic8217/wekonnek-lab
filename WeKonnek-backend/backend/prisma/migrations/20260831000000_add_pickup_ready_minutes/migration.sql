ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pickup_ready_minutes" INTEGER;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_pickup_ready_minutes_minimum"
  CHECK (
    "pickup_ready_minutes" IS NULL
    OR "pickup_ready_minutes" >= 15
  );
