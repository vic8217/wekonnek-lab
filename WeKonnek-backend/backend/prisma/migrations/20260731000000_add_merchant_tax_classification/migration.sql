ALTER TABLE "merchants"
ADD COLUMN IF NOT EXISTS "tax_classification" VARCHAR(50) NOT NULL DEFAULT 'non_vat_percentage_tax';
