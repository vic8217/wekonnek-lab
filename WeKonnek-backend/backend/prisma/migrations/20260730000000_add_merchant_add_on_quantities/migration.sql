ALTER TABLE "merchant_applications"
ADD COLUMN IF NOT EXISTS "selected_add_on_quantities" JSONB NOT NULL DEFAULT '{}';
