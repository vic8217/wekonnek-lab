CREATE TABLE "merchant_categories" (
  "id" SERIAL PRIMARY KEY, "name" VARCHAR(150) NOT NULL, "slug" VARCHAR(150) NOT NULL UNIQUE,
  "description" TEXT, "icon" VARCHAR(100), "is_active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "merchant_sub_categories" (
  "id" SERIAL PRIMARY KEY, "category_id" INTEGER NOT NULL, "name" VARCHAR(150) NOT NULL,
  "slug" VARCHAR(150) NOT NULL, "group_name" VARCHAR(100), "is_active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_sub_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "merchant_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "merchant_sub_categories_category_id_slug_key" UNIQUE ("category_id", "slug")
);
CREATE INDEX "merchant_sub_categories_category_id_idx" ON "merchant_sub_categories"("category_id");
ALTER TABLE "merchant_applications" ADD COLUMN "sub_category_name" VARCHAR(150);

INSERT INTO "merchant_categories" ("name", "slug", "description", "display_order") VALUES
('Food','food','Meal ordering, drinks, and quick food discovery',1),
('Restaurants','restaurants','Dine-in discovery and reservations',2),
('Groceries','groceries','Daily household food supplies',3),
('Pharmacy','pharmacy','Health and medical products',4),
('Shops','shops','Retail stores selling physical products',5),
('Services','services','Home and professional services',6),
('Wellness','wellness','Personal care and beauty services',7),
('Deals','deals','Promotions and discount offers across merchants',8),
('Events','events','Community events',9),
('Bazaar','bazaar','Community marketplace sellers',10);

WITH rows(category_slug, name, slug, group_name, position) AS (VALUES
('food','Fast Food','fast-food',NULL,1),('food','Filipino Food / Carinderia','filipino-food-carinderia',NULL,2),('food','Street Food','street-food',NULL,3),('food','Chinese Food','chinese-food',NULL,4),('food','Japanese Food','japanese-food',NULL,5),('food','Korean Food','korean-food',NULL,6),('food','Western Food','western-food',NULL,7),('food','Pizza & Pasta','pizza-pasta',NULL,8),('food','Burgers & Sandwiches','burgers-sandwiches',NULL,9),('food','BBQ & Grilled','bbq-grilled',NULL,10),('food','Seafood','seafood',NULL,11),('food','Rice Meals','rice-meals',NULL,12),('food','Noodles & Ramen','noodles-ramen',NULL,13),('food','Cafés','cafes',NULL,14),('food','Milk Tea & Drinks','milk-tea-drinks',NULL,15),('food','Desserts & Ice Cream','desserts-ice-cream',NULL,16),('food','Bakeries','bakeries',NULL,17),('food','Healthy / Vegan Food','healthy-vegan-food',NULL,18),('food','Buffet / Eat-All-You-Can','buffet-eat-all-you-can',NULL,19),
('restaurants','Casual Dining','casual-dining',NULL,1),('restaurants','Family Restaurants','family-restaurants',NULL,2),('restaurants','Fine Dining','fine-dining',NULL,3),('restaurants','Buffet Restaurants','buffet-restaurants',NULL,4),('restaurants','Samgyupsal / Korean BBQ','samgyupsal-korean-bbq',NULL,5),('restaurants','Steakhouse','steakhouse',NULL,6),('restaurants','Seafood Restaurants','seafood-restaurants',NULL,7),('restaurants','Bars & Nightlife','bars-nightlife',NULL,8),('restaurants','Live Music Restaurants','live-music-restaurants',NULL,9),('restaurants','Rooftop Restaurants','rooftop-restaurants',NULL,10),('restaurants','Romantic / Date Restaurants','romantic-date-restaurants',NULL,11),('restaurants','Group Dining Restaurants','group-dining-restaurants',NULL,12),
('groceries','Supermarkets','supermarkets',NULL,1),('groceries','Mini-Marts','mini-marts',NULL,2),('groceries','Wet Market','wet-market',NULL,3),('groceries','Meat Shops','meat-shops',NULL,4),('groceries','Vegetable Stores','vegetable-stores',NULL,5),('groceries','Seafood Markets','seafood-markets',NULL,6),('groceries','Rice Stores','rice-stores',NULL,7),('groceries','Frozen Food','frozen-food',NULL,8),('groceries','Organic Stores','organic-stores',NULL,9),('groceries','Baking Supplies','baking-supplies',NULL,10),('groceries','Imported Goods','imported-goods',NULL,11),('groceries','Convenience Stores','convenience-stores',NULL,12),
('pharmacy','Drugstores','drugstores',NULL,1),('pharmacy','Vitamins & Supplements','vitamins-supplements',NULL,2),('pharmacy','Medical Supplies','medical-supplies',NULL,3),('pharmacy','Personal Care','personal-care',NULL,4),('pharmacy','Baby Care','baby-care',NULL,5),('pharmacy','First Aid Supplies','first-aid-supplies',NULL,6),('pharmacy','Health Monitoring Devices','health-monitoring-devices',NULL,7),('pharmacy','Prescription Medicines','prescription-medicines',NULL,8),('pharmacy','Herbal Medicine','herbal-medicine',NULL,9),
('shops','Cellphone Shops','cellphone-shops','Electronics',1),('shops','Gadget Stores','gadget-stores','Electronics',2),('shops','Computer Stores','computer-stores','Electronics',3),('shops','Accessories','accessories','Electronics',4),('shops','Clothing','clothing','Fashion',5),('shops','Shoes','shoes','Fashion',6),('shops','Bags','bags','Fashion',7),('shops','Jewelry','jewelry','Fashion',8),('shops','Watches','watches','Fashion',9),('shops','Furniture','furniture','Home & Living',10),('shops','Home Decor','home-decor','Home & Living',11),('shops','Kitchen Supplies','kitchen-supplies','Home & Living',12),('shops','Appliances','appliances','Home & Living',13),('shops','Gift Shops','gift-shops','Specialty Shops',14),('shops','Toy Stores','toy-stores','Specialty Shops',15),('shops','Bookstores','bookstores','Specialty Shops',16),('shops','Hobby Stores','hobby-stores','Specialty Shops',17),('shops','Hardware Stores','hardware-stores','Hardware',18),('shops','Construction Supplies','construction-supplies','Hardware',19),
('services','Plumbing','plumbing','Household',1),('services','Electrical Services','electrical-services','Household',2),('services','Carpentry','carpentry','Household',3),('services','Appliance Repair','appliance-repair','Household',4),('services','Aircon Repair','aircon-repair','Household',5),('services','Home Renovation','home-renovation','Household',6),('services','House Cleaning','house-cleaning','Household',7),('services','Pest Control','pest-control','Household',8),('services','IT / Computer Repair','it-computer-repair','Personal',9),('services','Printing Services','printing-services','Personal',10),('services','Photography','photography','Personal',11),('services','Event Services','event-services','Personal',12),('services','Car Wash','car-wash','Automotive',13),('services','Auto Repair','auto-repair','Automotive',14),('services','Motorcycle Repair','motorcycle-repair','Automotive',15),('services','Tire Shops','tire-shops','Automotive',16),('services','Car Accessories','car-accessories','Automotive',17),('services','Detailing Services','detailing-services','Automotive',18),('services','Movers','movers','Logistics',19),
('wellness','Hair Salon','hair-salon',NULL,1),('wellness','Barbershop','barbershop',NULL,2),('wellness','Spa','spa',NULL,3),('wellness','Massage Therapy','massage-therapy',NULL,4),('wellness','Nail Salon','nail-salon',NULL,5),('wellness','Skincare Clinics','skincare-clinics',NULL,6),('wellness','Dermatology Clinics','dermatology-clinics',NULL,7),('wellness','Dental Clinics','dental-clinics',NULL,8),('wellness','Fitness Gyms','fitness-gyms',NULL,9),('wellness','Yoga Studios','yoga-studios',NULL,10),('wellness','Personal Trainers','personal-trainers',NULL,11),
('deals','Food Deals','food-deals',NULL,1),('deals','Restaurant Deals','restaurant-deals',NULL,2),('deals','Grocery Discounts','grocery-discounts',NULL,3),('deals','Retail Sales','retail-sales',NULL,4),('deals','Flash Sales','flash-sales',NULL,5),('deals','Buy 1 Get 1','buy-1-get-1',NULL,6),('deals','Limited Time Deals','limited-time-deals',NULL,7),('deals','Holiday Promotions','holiday-promotions',NULL,8),('deals','Voucher Marketplace','voucher-marketplace',NULL,9),
('events','Bazaar','bazaar',NULL,1),('events','Weekend Markets','weekend-markets',NULL,2),('events','Concerts','concerts',NULL,3),
('bazaar','Preloved Items','preloved-items',NULL,1),('bazaar','Homemade Food','homemade-food',NULL,2),('bazaar','Plants','plants',NULL,3),('bazaar','Crafts','crafts',NULL,4),('bazaar','Fashion','fashion',NULL,5),('bazaar','Gadgets','gadgets',NULL,6),('bazaar','Food','food',NULL,7),('bazaar','Miscellaneous','miscellaneous',NULL,8)
)
INSERT INTO "merchant_sub_categories" ("category_id", "name", "slug", "group_name", "display_order")
SELECT c.id, r.name, r.slug, r.group_name, r.position FROM rows r JOIN "merchant_categories" c ON c.slug = r.category_slug;

ALTER TABLE "merchants" DROP CONSTRAINT IF EXISTS "merchants_category_id_fkey";
ALTER TABLE "merchants" DROP CONSTRAINT IF EXISTS "merchants_sub_category_id_fkey";

CREATE TEMP TABLE "merchant_taxonomy_mapping" AS
SELECT m.id AS merchant_id, mc.id AS category_id, msc.id AS sub_category_id
FROM "merchants" m
LEFT JOIN "categories" old_category ON old_category.id = m."category_id"
LEFT JOIN "merchant_categories" mc ON lower(old_category.name) = lower(mc.name) OR lower(old_category.name) LIKE lower(mc.name) || ' %'
LEFT JOIN "sub_categories" old_sub_category ON old_sub_category.id = m."sub_category_id"
LEFT JOIN "merchant_sub_categories" msc ON msc."category_id" = mc.id AND lower(old_sub_category.name) = lower(msc.name);

UPDATE "merchants" SET "category_id" = NULL, "sub_category_id" = NULL;
UPDATE "merchants" m SET "category_id" = map.category_id, "sub_category_id" = map.sub_category_id
FROM "merchant_taxonomy_mapping" map WHERE map.merchant_id = m.id;

ALTER TABLE "merchants" ADD CONSTRAINT "merchants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "merchant_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "merchant_sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
