-- WEKONNEK production category and subcategory reference data.
-- Executed only by prisma/seed.ts after migrations are deployed.
-- Conflict updates are restricted to global rows (owner_merchant_id IS NULL).
--
-- ============================================================
-- Insert 10 Main Categories
-- ============================================================
INSERT INTO public.categories (name, slug, description, icon, is_active, display_order) VALUES
('Food',        'food',        'Order meals, drinks, and quick food discovery',                    '🍽️', true, 1),
('Restaurants', 'restaurants', 'Dine-in discovery and reservations',                               '🍝', true, 2),
('Groceries',   'groceries',   'Daily household food supplies',                                    '🛒', true, 3),
('Pharmacy',    'pharmacy',    'Health and medical products',                                      '💊', true, 4),
('Shops',       'shops',       'Retail stores selling physical products',                          '🏪', true, 5),
('Services',    'services',    'Home and professional services',                                   '🔧', true, 6),
('Wellness',    'wellness',    'Personal care and beauty services',                                '💆', true, 7),
('Deals',       'deals',       'Promotions and discount offers across merchants',                  '🏷️', true, 8),
('Events',      'events',      'Community events, bazaars, and markets',                           '🎉', true, 9),
('Bazaar',      'bazaar',      'Buy and sell preloved items, homemade food, crafts, and more',     '🛍️', true, 10)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE categories.owner_merchant_id IS NULL;

-- ============================================================
-- STEP 3: Insert Sub-Categories
-- ============================================================
-- We use a CTE to look up category IDs by slug so this works
-- regardless of the auto-increment ID values.

-- ──────────────────────────────────────────────────────────────
-- 1️⃣ FOOD Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Fast Food',              'fast-food',              'Quick service restaurants',             '🍟', NULL, 1),
  ('Filipino Food / Carinderia', 'filipino-food',      'Carinderia and Filipino home-cooked meals', '🇵🇭', NULL, 2),
  ('Street Food',            'street-food',            'Affordable street food vendors',        '🍢', NULL, 3),
  ('Chinese Food',           'chinese-food',           'Chinese cuisine restaurants',           '🥡', NULL, 4),
  ('Japanese Food',          'japanese-food',          'Japanese cuisine and sushi',            '🍣', NULL, 5),
  ('Korean Food',            'korean-food',            'Korean cuisine and BBQ',                '🥘', NULL, 6),
  ('Western Food',           'western-food',           'Western-style meals',                   '🥩', NULL, 7),
  ('Pizza & Pasta',          'pizza-pasta',            'Italian-inspired pizza and pasta',      '🍕', NULL, 8),
  ('Burgers & Sandwiches',   'burgers-sandwiches',     'Burgers, subs, and sandwiches',        '🍔', NULL, 9),
  ('BBQ & Grilled',          'bbq-grilled',            'Barbecue and grilled dishes',           '🍖', NULL, 10),
  ('Seafood',                'seafood',                'Seafood dishes and restaurants',        '🦐', NULL, 11),
  ('Rice Meals',             'rice-meals',             'Rice meal combos',                      '🍚', NULL, 12),
  ('Noodles & Ramen',        'noodles-ramen',          'Noodle soups and ramen',                '🍜', NULL, 13),
  ('Cafés',                  'cafes',                  'Coffee shops and cafés',                '☕', NULL, 14),
  ('Milk Tea & Drinks',      'milk-tea-drinks',        'Milk tea, juices, and beverages',       '🧋', NULL, 15),
  ('Desserts & Ice Cream',   'desserts-ice-cream',     'Sweet treats and frozen desserts',      '🍨', NULL, 16),
  ('Bakeries',               'bakeries',               'Bread, pastries, and baked goods',      '🥐', NULL, 17),
  ('Healthy / Vegan Food',   'healthy-vegan',          'Health-conscious and plant-based meals', '🥗', NULL, 18),
  ('Buffet / Eat-All-You-Can','buffet',                'All-you-can-eat buffet restaurants',    '🍱', NULL, 19)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'food'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 2️⃣ RESTAURANTS Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Casual Dining',          'casual-dining',          'Relaxed sit-down restaurants',          '🪑', NULL, 1),
  ('Family Restaurants',     'family-restaurants',     'Family-friendly dining spots',          '👨‍👩‍👧‍👦', NULL, 2),
  ('Fine Dining',            'fine-dining',            'Upscale dining experiences',            '🥂', NULL, 3),
  ('Buffet Restaurants',     'buffet-restaurants',     'All-you-can-eat buffet establishments', '🍽️', NULL, 4),
  ('Samgyupsal / Korean BBQ','samgyupsal-korean-bbq',  'Korean BBQ and grilling restaurants',   '🥓', NULL, 5),
  ('Steakhouse',             'steakhouse',             'Steak and grill restaurants',            '🥩', NULL, 6),
  ('Seafood Restaurants',    'seafood-restaurants',    'Specialty seafood dining',               '🦞', NULL, 7),
  ('Bars & Nightlife',       'bars-nightlife',         'Bars, pubs, and nightlife spots',       '🍻', NULL, 8),
  ('Live Music Restaurants', 'live-music-restaurants', 'Dining with live entertainment',         '🎵', NULL, 9),
  ('Rooftop Restaurants',    'rooftop-restaurants',    'Scenic rooftop dining',                  '🏙️', NULL, 10),
  ('Romantic / Date Restaurants','romantic-date',       'Romantic and intimate dining',           '❤️', NULL, 11),
  ('Group Dining Restaurants','group-dining',          'Restaurants for groups and celebrations', '🎊', NULL, 12)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'restaurants'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 3️⃣ GROCERIES Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Supermarkets',       'supermarkets',       'Large grocery stores',                 '🏬', NULL, 1),
  ('Mini-Marts',         'mini-marts',         'Small neighborhood stores',            '🏪', NULL, 2),
  ('Wet Market',         'wet-market',         'Fresh produce wet markets',            '🥬', NULL, 3),
  ('Meat Shops',         'meat-shops',         'Butcher shops and meat vendors',       '🥩', NULL, 4),
  ('Vegetable Stores',   'vegetable-stores',   'Fresh vegetable suppliers',            '🥕', NULL, 5),
  ('Seafood Markets',    'seafood-markets',    'Fresh seafood markets',                '🐟', NULL, 6),
  ('Rice Stores',        'rice-stores',        'Rice dealers and suppliers',           '🍚', NULL, 7),
  ('Frozen Food',        'frozen-food',        'Frozen goods and ready-to-cook items', '🧊', NULL, 8),
  ('Organic Stores',     'organic-stores',     'Organic and natural products',         '🌿', NULL, 9),
  ('Baking Supplies',    'baking-supplies',    'Baking ingredients and tools',         '🎂', NULL, 10),
  ('Imported Goods',     'imported-goods',     'Imported snacks and products',         '📦', NULL, 11),
  ('Convenience Stores', 'convenience-stores', '24/7 convenience stores',              '🏪', NULL, 12)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'groceries'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 4️⃣ PHARMACY Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Drugstores',              'drugstores',              'Full-service pharmacies',                '🏥', NULL, 1),
  ('Vitamins & Supplements',  'vitamins-supplements',    'Vitamins, minerals, and health supplements', '💊', NULL, 2),
  ('Medical Supplies',        'medical-supplies',        'Medical devices and hospital supplies',   '🩺', NULL, 3),
  ('Personal Care',           'personal-care',           'Personal hygiene and care products',      '🧴', NULL, 4),
  ('Baby Care',               'baby-care',               'Baby health and care products',           '👶', NULL, 5),
  ('First Aid Supplies',      'first-aid-supplies',      'First aid kits and emergency supplies',   '🩹', NULL, 6),
  ('Health Monitoring Devices','health-monitoring',       'BP monitors, thermometers, etc.',         '📊', NULL, 7),
  ('Prescription Medicines',  'prescription-medicines',  'Prescription drug dispensing',             '📋', NULL, 8),
  ('Herbal Medicine',         'herbal-medicine',         'Natural and herbal remedies',              '🌱', NULL, 9)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'pharmacy'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 5️⃣ SHOPS Sub-Categories  (grouped: Electronics, Fashion, Home & Living, Specialty, Hardware)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  -- Electronics
  ('Cellphone Shops',        'cellphone-shops',        'Mobile phone retailers',                '📱', 'Electronics', 1),
  ('Gadget Stores',          'gadget-stores',          'Tech gadgets and accessories',           '🎧', 'Electronics', 2),
  ('Computer Stores',        'computer-stores',        'Computers and peripherals',              '💻', 'Electronics', 3),
  ('Accessories',            'electronics-accessories','Cables, chargers, and tech accessories', '🔌', 'Electronics', 4),
  -- Fashion
  ('Clothing',               'clothing',               'Apparel and fashion stores',             '👕', 'Fashion', 5),
  ('Shoes',                  'shoes',                  'Footwear shops',                         '👟', 'Fashion', 6),
  ('Bags',                   'bags',                   'Bags, backpacks, and luggage',            '👜', 'Fashion', 7),
  ('Jewelry',                'jewelry',                'Jewelry and gemstone shops',              '💍', 'Fashion', 8),
  ('Watches',                'watches',                'Watch retailers',                         '⌚', 'Fashion', 9),
  -- Home & Living
  ('Furniture',              'furniture',              'Home and office furniture',               '🛋️', 'Home & Living', 10),
  ('Home Decor',             'home-decor',             'Interior decoration and accessories',     '🖼️', 'Home & Living', 11),
  ('Kitchen Supplies',       'kitchen-supplies',       'Kitchenware and cooking tools',           '🍳', 'Home & Living', 12),
  ('Appliances',             'appliances',             'Home and kitchen appliances',             '🔌', 'Home & Living', 13),
  -- Specialty Shops
  ('Gift Shops',             'gift-shops',             'Gifts, souvenirs, and novelty items',     '🎁', 'Specialty Shops', 14),
  ('Toy Stores',             'toy-stores',             'Toys and games for children',             '🧸', 'Specialty Shops', 15),
  ('Bookstores',             'bookstores',             'Books and reading materials',              '📚', 'Specialty Shops', 16),
  ('Hobby Stores',           'hobby-stores',           'Hobby supplies and craft materials',       '🎨', 'Specialty Shops', 17),
  -- Hardware
  ('Hardware Stores',        'hardware-stores',        'Tools, hardware, and building materials',  '🔨', 'Hardware', 18),
  ('Construction Supplies',  'construction-supplies',  'Construction and building supplies',       '🧱', 'Hardware', 19)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'shops'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 6️⃣ SERVICES Sub-Categories  (grouped: Household, Personal, Automotive, Logistics)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  -- Household
  ('Plumbing',              'plumbing',              'Plumbing repair and installation',     '🔧', 'Household', 1),
  ('Electrical Services',   'electrical-services',   'Electrical wiring and repairs',        '⚡', 'Household', 2),
  ('Carpentry',             'carpentry',             'Woodworking and carpentry services',   '🪚', 'Household', 3),
  ('Appliance Repair',      'appliance-repair',      'Home appliance repair services',       '🔩', 'Household', 4),
  ('Aircon Repair',         'aircon-repair',         'Air conditioning services',            '❄️', 'Household', 5),
  ('Home Renovation',       'home-renovation',       'Remodeling and renovation services',   '🏠', 'Household', 6),
  ('House Cleaning',        'house-cleaning',        'Professional cleaning services',       '🧹', 'Household', 7),
  ('Pest Control',          'pest-control',          'Pest extermination services',          '🐜', 'Household', 8),
  -- Personal
  ('IT / Computer Repair',  'it-computer-repair',    'Computer and IT troubleshooting',      '🖥️', 'Personal', 9),
  ('Printing Services',     'printing-services',     'Printing and document services',       '🖨️', 'Personal', 10),
  ('Photography',           'photography',           'Photography and videography services',  '📷', 'Personal', 11),
  ('Event Services',        'event-services',        'Event planning and management',         '🎪', 'Personal', 12),
  -- Automotive
  ('Car Wash',              'car-wash',              'Vehicle washing and cleaning',           '🚗', 'Automotive', 13),
  ('Auto Repair',           'auto-repair',           'Automobile repair services',             '🔧', 'Automotive', 14),
  ('Motorcycle Repair',     'motorcycle-repair',     'Motorcycle maintenance and repair',      '🏍️', 'Automotive', 15),
  ('Tire Shops',            'tire-shops',            'Tire sales and vulcanizing',             '🛞', 'Automotive', 16),
  ('Car Accessories',       'car-accessories',       'Vehicle accessories and parts',           '🚙', 'Automotive', 17),
  ('Detailing Services',    'detailing-services',    'Auto detailing and polishing',            '✨', 'Automotive', 18),
  -- Logistics
  ('Movers',                'movers',                'Moving and hauling services',             '🚚', 'Logistics', 19)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'services'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 7️⃣ WELLNESS Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Hair Salon',          'hair-salon',          'Haircut, styling, and treatment',       '💇', NULL, 1),
  ('Barbershop',          'barbershop',          'Men''s grooming and haircuts',           '💈', NULL, 2),
  ('Spa',                 'spa',                 'Spa treatments and relaxation',          '🧖', NULL, 3),
  ('Massage Therapy',     'massage-therapy',     'Therapeutic and relaxation massage',     '💆', NULL, 4),
  ('Nail Salon',          'nail-salon',          'Manicure and pedicure services',         '💅', NULL, 5),
  ('Skincare Clinics',    'skincare-clinics',    'Facial treatments and skincare',          '✨', NULL, 6),
  ('Dermatology Clinics', 'dermatology-clinics', 'Dermatological treatments',               '🏥', NULL, 7),
  ('Dental Clinics',      'dental-clinics',      'Dental care and orthodontics',            '🦷', NULL, 8),
  ('Fitness Gyms',        'fitness-gyms',        'Gym facilities and workouts',             '🏋️', NULL, 9),
  ('Yoga Studios',        'yoga-studios',        'Yoga classes and meditation',             '🧘', NULL, 10),
  ('Personal Trainers',   'personal-trainers',   'Personal fitness coaching',               '💪', NULL, 11)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'wellness'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 8️⃣ DEALS Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Food Deals',           'food-deals',           'Discounts on food orders',               '🍽️', NULL, 1),
  ('Restaurant Deals',     'restaurant-deals',     'Dining promos and discounts',             '🍝', NULL, 2),
  ('Grocery Discounts',    'grocery-discounts',    'Savings on grocery items',                '🛒', NULL, 3),
  ('Retail Sales',         'retail-sales',         'Retail and shopping discounts',            '🛍️', NULL, 4),
  ('Flash Sales',          'flash-sales',          'Limited-time flash deals',                 '⚡', NULL, 5),
  ('Buy 1 Get 1',         'buy-1-get-1',          'BOGO offers from merchants',               '🎁', NULL, 6),
  ('Limited Time Deals',   'limited-time-deals',   'Deals with expiration dates',              '⏰', NULL, 7),
  ('Holiday Promotions',   'holiday-promotions',   'Special holiday offers',                   '🎄', NULL, 8),
  ('Voucher Marketplace',  'voucher-marketplace',  'Browse and claim discount vouchers',       '🎟️', NULL, 9)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'deals'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 9️⃣ EVENTS Sub-Categories
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Bazaar',           'bazaar',           'Pop-up bazaars and flea markets',    '🎪', NULL, 1),
  ('Weekend Markets',  'weekend-markets',  'Weekend farmers and artisan markets', '🛍️', NULL, 2),
  ('Concerts',         'concerts',         'Live music and concert events',       '🎤', NULL, 3)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'events'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 🔟 BAZAAR Sub-Categories (new!)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, group_name, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, sub.group_name, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Preloved Items',   'preloved-items',   'Second-hand and preloved goods',          '♻️', NULL, 1),
  ('Homemade Food',    'homemade-food',    'Home-cooked meals and baked goods',        '🏠', NULL, 2),
  ('Plants',           'plants',           'Indoor and outdoor plants for sale',       '🌱', NULL, 3),
  ('Crafts',           'crafts',           'Handmade crafts and artisan products',     '🎨', NULL, 4),
  ('Fashion',          'bazaar-fashion',   'Preloved and thrift fashion items',        '👗', NULL, 5),
  ('Gadgets',          'bazaar-gadgets',   'Used gadgets and electronics',             '📱', NULL, 6),
  ('Food',             'bazaar-food',      'Food stalls and vendors at bazaars',       '🍢', NULL, 7),
  ('Miscellaneous',    'miscellaneous',    'Everything else at the bazaar',            '📦', NULL, 8)
) AS sub(name, slug, description, icon, group_name, display_order)
WHERE c.slug = 'bazaar'
ON CONFLICT (category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  group_name = EXCLUDED.group_name,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP
WHERE sub_categories.owner_merchant_id IS NULL;

-- ============================================================
-- DONE! Summary of seeded data:
-- ============================================================
-- Categories: 10
--   1. Food           (19 subcategories)
--   2. Restaurants     (12 subcategories)
--   3. Groceries       (12 subcategories)
--   4. Pharmacy         (9 subcategories)
--   5. Shops           (19 subcategories — grouped: Electronics, Fashion, Home & Living, Specialty Shops, Hardware)
--   6. Services        (19 subcategories — grouped: Household, Personal, Automotive, Logistics)
--   7. Wellness        (11 subcategories)
--   8. Deals            (9 subcategories)
--   9. Events           (3 subcategories)
--  10. Bazaar           (8 subcategories)
--
-- Total: 10 categories, 121 sub-categories
--
-- Homepage recommended display order:
--   Food → Restaurants → Groceries → Pharmacy → Shops → Services → Wellness → Deals
--   (Events and Bazaar are secondary — shown in "More" or scrollable row)



