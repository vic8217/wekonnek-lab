-- Register the dedicated Property module in both category catalogs. The
-- module data remains in property_* tables; these rows make it discoverable
-- everywhere that reads the admin-managed category taxonomies.
INSERT INTO "merchant_categories" ("name", "slug", "description", "icon", "is_active", "display_order", "created_at", "updated_at")
SELECT 'Property', 'property', 'Homes, condominiums, lots and commercial spaces for sale or rent', '🏠', true,
       COALESCE(MAX("display_order"), 0) + 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "merchant_categories"
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "categories" ("name", "slug", "description", "icon", "is_active", "display_order", "created_at", "updated_at")
SELECT 'Property', 'property', 'Homes, condominiums, lots and commercial spaces for sale or rent', '🏠', true,
       COALESCE(MAX("display_order"), 0) + 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "categories"
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;
