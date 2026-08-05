-- Carry the category selected and reviewed during onboarding into existing
-- live merchant records. New approvals perform the same mapping in service
-- code before creating the merchant.
UPDATE "merchants" AS m
SET "category_id" = c."id",
    "updated_at" = NOW()
FROM "merchant_applications" AS ma
JOIN "categories" AS c
  ON LOWER(TRIM(c."name")) = LOWER(TRIM(ma."category_name"))
WHERE ma."merchant_code" = m."merchant_code"
  AND ma."status" = 'approved'
  AND ma."category_name" IS NOT NULL
  AND (m."category_id" IS NULL OR m."category_id" <> c."id");
