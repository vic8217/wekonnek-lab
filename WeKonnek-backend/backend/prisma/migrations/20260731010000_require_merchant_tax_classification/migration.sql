ALTER TABLE "merchants"
ALTER COLUMN "tax_classification" SET DEFAULT '';

UPDATE "merchants"
SET "tax_classification" = ''
WHERE "tax_classification" = 'non_vat_percentage_tax';
