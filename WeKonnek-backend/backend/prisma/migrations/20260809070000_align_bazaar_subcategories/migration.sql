-- Align Bazaar taxonomy with WEKONNEK_Bazaar_Subcategories.pdf.
-- Legacy rows remain for referential history but are hidden after their
-- listings/merchants are moved to the closest canonical category.

UPDATE "merchant_sub_categories"
SET "is_active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "category_id" = (SELECT "id" FROM "merchant_categories" WHERE "slug" = 'bazaar');

WITH canonical(name, slug, position) AS (VALUES
  ('Electronics & Gadgets', 'electronics-gadgets', 1),
  ('Mobile Phones & Accessories', 'mobile-phones-accessories', 2),
  ('Computers & Accessories', 'computers-accessories', 3),
  ('Home & Living', 'home-living', 4),
  ('Furniture', 'furniture', 5),
  ('Appliances', 'appliances', 6),
  ('Fashion', 'fashion', 7),
  ('Shoes & Bags', 'shoes-bags', 8),
  ('Beauty & Personal Care', 'beauty-personal-care', 9),
  ('Baby & Kids', 'baby-kids', 10),
  ('Toys & Games', 'toys-games', 11),
  ('Sports & Fitness', 'sports-fitness', 12),
  ('Automotive Parts & Accessories', 'automotive-parts-accessories', 13),
  ('Motorcycles & Bikes', 'motorcycles-bikes', 14),
  ('Tools & Hardware', 'tools-hardware', 15),
  ('Books & Hobbies', 'books-hobbies', 16),
  ('Collectibles', 'collectibles', 17),
  ('Plants & Garden', 'plants-garden', 18),
  ('Pet Supplies', 'pet-supplies', 19),
  ('Food & Homemade Products', 'food-homemade-products', 20),
  ('Office & Business Supplies', 'office-business-supplies', 21),
  ('Preloved / Secondhand', 'preloved-secondhand', 22),
  ('Clearance / Surplus', 'clearance-surplus', 23),
  ('Others', 'others', 24)
)
INSERT INTO "merchant_sub_categories" ("category_id", "name", "slug", "group_name", "is_active", "display_order")
SELECT category."id", canonical.name, canonical.slug, NULL, true, canonical.position
FROM canonical
CROSS JOIN (SELECT "id" FROM "merchant_categories" WHERE "slug" = 'bazaar') category
ON CONFLICT ("category_id", "slug") DO UPDATE SET
  "name" = EXCLUDED."name", "group_name" = NULL, "is_active" = true,
  "display_order" = EXCLUDED."display_order", "updated_at" = CURRENT_TIMESTAMP;

WITH mapping(old_slug, new_slug) AS (VALUES
  ('preloved-items', 'preloved-secondhand'), ('homemade-food', 'food-homemade-products'),
  ('food', 'food-homemade-products'), ('plants', 'plants-garden'),
  ('crafts', 'books-hobbies'), ('gadgets', 'electronics-gadgets'), ('miscellaneous', 'others')
), replacements AS (
  SELECT legacy."id" AS old_id, canonical."id" AS new_id FROM mapping
  JOIN "merchant_categories" category ON category."slug" = 'bazaar'
  JOIN "merchant_sub_categories" legacy ON legacy."category_id" = category."id" AND legacy."slug" = mapping.old_slug
  JOIN "merchant_sub_categories" canonical ON canonical."category_id" = category."id" AND canonical."slug" = mapping.new_slug
)
UPDATE "bazaar_listings" listing SET "sub_category_id" = replacements.new_id
FROM replacements WHERE listing."sub_category_id" = replacements.old_id;

WITH mapping(old_slug, new_slug) AS (VALUES
  ('preloved-items', 'preloved-secondhand'), ('homemade-food', 'food-homemade-products'),
  ('food', 'food-homemade-products'), ('plants', 'plants-garden'),
  ('crafts', 'books-hobbies'), ('gadgets', 'electronics-gadgets'), ('miscellaneous', 'others')
), replacements AS (
  SELECT legacy."id" AS old_id, canonical."id" AS new_id FROM mapping
  JOIN "merchant_categories" category ON category."slug" = 'bazaar'
  JOIN "merchant_sub_categories" legacy ON legacy."category_id" = category."id" AND legacy."slug" = mapping.old_slug
  JOIN "merchant_sub_categories" canonical ON canonical."category_id" = category."id" AND canonical."slug" = mapping.new_slug
)
UPDATE "merchants" merchant SET "sub_category_id" = replacements.new_id
FROM replacements WHERE merchant."sub_category_id" = replacements.old_id;
