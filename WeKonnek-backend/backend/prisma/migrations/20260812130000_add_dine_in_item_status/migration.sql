ALTER TABLE "order_items" ADD COLUMN "status" VARCHAR(30);

UPDATE "order_items" item
SET "status" = CASE
  WHEN orders."status" IN ('ready', 'bill_out', 'completed') THEN 'served'
  ELSE 'preparing'
END
FROM "orders" orders
WHERE item."order_id" = orders."id"
  AND orders."order_type" IN ('dine_in', 'in_store');

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_status_check"
CHECK ("status" IS NULL OR "status" IN ('preparing', 'served'));
