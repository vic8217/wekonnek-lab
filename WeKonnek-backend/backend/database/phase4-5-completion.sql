-- ============================================================
-- Phase 4 & Phase 5 completion migration
-- ============================================================
-- Run this AFTER supabase-migration.sql.
--
-- Adds:
--   1. `out_for_delivery` order status (Phase 5 spec).
--   2. `image_url` column on categories / sub_categories (Phase 4
--      image-upload support).
--   3. `product_categories` junction table for multi-category
--      product assignment (Phase 4 multi-category).
--
-- Safe to re-run.

BEGIN;

-- ─── 1. ORDERS.STATUS: add 'out_for_delivery' ─────────────────
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    SELECT constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%status%';

    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', constraint_name_var);
    END IF;

    BEGIN
        ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
            CHECK (status IN (
                'pending',
                'processing',
                'preparing',
                'ready',
                'out_for_delivery',
                'completed',
                'cancelled',
                'bill_out'
            ));
    EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN others THEN NULL;
    END;
END $$;

-- ─── 2. CATEGORY IMAGES ───────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'categories'
          AND column_name = 'image_url'
    ) THEN
        ALTER TABLE public.categories ADD COLUMN image_url VARCHAR(500);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sub_categories'
          AND column_name = 'image_url'
    ) THEN
        ALTER TABLE public.sub_categories ADD COLUMN image_url VARCHAR(500);
    END IF;
END $$;

-- ─── 3. PRODUCT MULTI-CATEGORY JUNCTION ───────────────────────
CREATE TABLE IF NOT EXISTS public.product_categories (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    sub_category_id INTEGER REFERENCES public.sub_categories(id) ON DELETE SET NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, category_id, sub_category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_product_id
    ON public.product_categories (product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category_id
    ON public.product_categories (category_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_sub_category_id
    ON public.product_categories (sub_category_id);

-- Backfill from the existing single-category columns so historical
-- products stay searchable through the new junction. Idempotent thanks
-- to the UNIQUE constraint above.
INSERT INTO public.product_categories (product_id, category_id, sub_category_id, is_primary)
SELECT p.id, p.category_id, p.sub_category_id, true
FROM public.products p
WHERE p.category_id IS NOT NULL
ON CONFLICT (product_id, category_id, sub_category_id) DO NOTHING;

COMMIT;
