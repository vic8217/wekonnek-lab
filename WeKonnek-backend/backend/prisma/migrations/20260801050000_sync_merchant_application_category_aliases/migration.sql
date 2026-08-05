-- Application forms may use a concise category label (for example "Food")
-- while the category catalog uses an expanded label ("Food & Beverages").
-- Prefer an exact match, then a category whose name starts with the submitted
-- label followed by a space.
WITH category_matches AS (
  SELECT DISTINCT ON (ma."merchant_code")
    ma."merchant_code",
    c."id" AS category_id
  FROM "merchant_applications" AS ma
  JOIN "categories" AS c
    ON LOWER(TRIM(c."name")) = LOWER(TRIM(ma."category_name"))
    OR LOWER(TRIM(c."name")) LIKE LOWER(TRIM(ma."category_name")) || ' %'
  WHERE ma."status" = 'approved'
    AND ma."merchant_code" IS NOT NULL
    AND ma."category_name" IS NOT NULL
    AND c."is_active" = TRUE
  ORDER BY ma."merchant_code",
    CASE WHEN LOWER(TRIM(c."name")) = LOWER(TRIM(ma."category_name")) THEN 0 ELSE 1 END,
    c."id"
)
UPDATE "merchants" AS m
SET "category_id" = matches.category_id,
    "updated_at" = NOW()
FROM category_matches AS matches
WHERE matches."merchant_code" = m."merchant_code"
  AND m."category_id" IS DISTINCT FROM matches.category_id;
