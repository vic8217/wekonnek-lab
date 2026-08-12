-- Some databases applied the initial shop-inventory migration before order
-- reservation movement types were added to its check constraint. Replace the
-- stale constraint forward-only so order placement and cancellation can write
-- their audit movements.
ALTER TABLE "inventory_movements"
DROP CONSTRAINT IF EXISTS "inventory_movements_type_check";

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_type_check"
CHECK (
  "type" IN (
    'receipt',
    'sale',
    'return',
    'adjustment',
    'transfer_in',
    'transfer_out',
    'reservation',
    'reservation_release'
  )
);
