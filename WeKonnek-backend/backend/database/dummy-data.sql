-- We Konnek Dummy Data
-- Run this in your Supabase SQL Editor after running the migration
--
-- IMPORTANT: Before running this script:
-- 1. Run the migration: backend/database/supabase-migration.sql
-- 2. Create test users in Supabase Auth Dashboard (see create-test-users.md)
-- 3. Run dummy-users.sql to set user roles
-- 4. Then run this script to insert dummy data
--
-- NOTE: This script is idempotent - safe to run multiple times.
-- It uses ON CONFLICT DO NOTHING to prevent duplicate inserts.
--
-- The script will automatically link data to users by email:
-- - customer@wekonnek.com for customer promotions, orders, and reservations
-- - Merchants are referenced by ID (1 = Tita Rosa's Carinderia, 2 = Maria's Bakery)

-- Insert Categories
-- NOTE: The full category hierarchy is defined in category-seed-data.sql
-- Below is a minimal set for backward compatibility with dummy merchants.
-- Run category-seed-data.sql for the complete 9-category, 113-subcategory structure.
INSERT INTO public.categories (name, slug, description, icon, is_active, display_order) VALUES
('Food',        'food',        'Order meals, drinks, and quick food discovery',       '🍽️', true, 1),
('Restaurants', 'restaurants', 'Dine-in discovery and reservations',                  '🍝', true, 2),
('Groceries',   'groceries',   'Daily household food supplies',                       '🛒', true, 3),
('Pharmacy',    'pharmacy',    'Health and medical products',                          '💊', true, 4),
('Shops',       'shops',       'Retail stores selling physical products',              '🏪', true, 5),
('Services',    'services',    'Home and professional services',                       '🔧', true, 6),
('Wellness',    'wellness',    'Personal care and beauty services',                    '💆', true, 7),
('Deals',       'deals',       'Promotions and discount offers across merchants',      '🏷️', true, 8),
('Events',      'events',      'Community events, bazaars, and markets',               '🎉', true, 9)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  updated_at = CURRENT_TIMESTAMP;

-- Insert Sub-Categories (minimal set for dummy data compatibility)
-- For the full subcategory list, run category-seed-data.sql
INSERT INTO public.sub_categories (category_id, name, slug, description, icon, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Filipino Food',  'filipino-food',  'Carinderia and Filipino home-cooked meals', '🇵🇭', 1),
  ('Bakeries',       'bakeries',       'Bread, pastries, and baked goods',          '🥐', 2),
  ('Fast Food',      'fast-food',      'Quick service restaurants',                 '🍟', 3),
  ('Cafés',          'cafes',          'Coffee shops and cafés',                    '☕', 4)
) AS sub(name, slug, description, icon, display_order)
WHERE c.slug = 'food'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO public.sub_categories (category_id, name, slug, description, icon, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Plumbing',           'plumbing',           'Plumbing repair and installation', '🔧', 1),
  ('Electrical Services','electrical-services', 'Electrical wiring and repairs',    '⚡', 2)
) AS sub(name, slug, description, icon, display_order)
WHERE c.slug = 'services'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO public.sub_categories (category_id, name, slug, description, icon, is_active, display_order)
SELECT c.id, sub.name, sub.slug, sub.description, sub.icon, true, sub.display_order
FROM public.categories c
CROSS JOIN (VALUES
  ('Clothing',   'clothing',   'Apparel and fashion stores',        '👕', 1),
  ('Gadget Stores','gadget-stores','Tech gadgets and accessories',  '🎧', 2),
  ('Bookstores', 'bookstores', 'Books and reading materials',       '📚', 3)
) AS sub(name, slug, description, icon, display_order)
WHERE c.slug = 'shops'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Insert Merchants (with subscription and status information)
-- Uses category/subcategory lookups by slug for portability

-- Active Merchant: Tita Rosa's Carinderia (Food > Filipino Food)
INSERT INTO public.merchants (
    name, slug, description, category_id, sub_category_id,
    business_type, phone, email, address, city, state, zip_code, country,
    latitude, longitude, is_active, is_verified, status, subscription_tier, subscription_plan, subscription_amount, payment_method,
    suspension_reason, rating, total_reviews, created_at
)
SELECT
    'Tita Rosa''s Carinderia', 'tita-rosas-carinderia', 'Authentic Filipino home-cooked meals',
    c.id,
    (SELECT sc.id FROM public.sub_categories sc WHERE sc.category_id = c.id AND sc.slug = 'filipino-food' LIMIT 1),
    'storefront', '09123456789', 'rosa@example.com', '123 Food Street, Cubao', 'Quezon City', 'Metro Manila', '1109', 'Philippines',
    14.6186, 121.0567, true, true, 'active', 'gold', 'monthly', 2000.00, 'GCash',
    NULL, 4.5, 120, '2024-01-15 10:30:00+00'
FROM public.categories c WHERE c.slug = 'food'
ON CONFLICT (slug) DO NOTHING;

-- Active Merchant: Maria's Bakery (Food > Bakeries)
INSERT INTO public.merchants (
    name, slug, description, category_id, sub_category_id,
    business_type, phone, email, address, city, state, zip_code, country,
    latitude, longitude, is_active, is_verified, status, subscription_tier, subscription_plan, subscription_amount, payment_method,
    suspension_reason, rating, total_reviews, created_at
)
SELECT
    'Maria''s Bakery', 'marias-bakery', 'Fresh baked goods and pastries',
    c.id,
    (SELECT sc.id FROM public.sub_categories sc WHERE sc.category_id = c.id AND sc.slug = 'bakeries' LIMIT 1),
    'storefront', '09345678901', 'maria@example.com', '456 Bakery Lane, Makati', 'Makati', 'Metro Manila', '1200', 'Philippines',
    14.5547, 121.0244, true, true, 'active', 'platinum', 'annual', 40000.00, 'Maya',
    NULL, 4.7, 203, '2024-03-10 09:15:00+00'
FROM public.categories c WHERE c.slug = 'food'
ON CONFLICT (slug) DO NOTHING;

-- Suspended Merchant: Juan's Repair Shop (Services > Plumbing)
INSERT INTO public.merchants (
    name, slug, description, category_id, sub_category_id,
    business_type, phone, email, address, city, state, zip_code, country,
    latitude, longitude, is_active, is_verified, status, subscription_tier, subscription_plan, subscription_amount, payment_method,
    suspension_reason, rating, total_reviews, created_at
)
SELECT
    'Juan''s Repair Shop', 'juans-repair-shop', 'Professional repair services',
    c.id,
    (SELECT sc.id FROM public.sub_categories sc WHERE sc.category_id = c.id AND sc.slug = 'plumbing' LIMIT 1),
    'home_based', '09234567890', 'juan@example.com', 'Service area: Quezon City', 'Quezon City', 'Metro Manila', '1100', 'Philippines',
    14.6760, 121.0437, false, true, 'suspended', 'basic', 'weekly', 300.00, 'GCash',
    'Non-payment', 4.2, 45, '2024-02-20 09:15:00+00'
FROM public.categories c WHERE c.slug = 'services'
ON CONFLICT (slug) DO NOTHING;

-- Deactivated Merchant: Pedro's Electronics (Shops > Gadget Stores)
INSERT INTO public.merchants (
    name, slug, description, category_id, sub_category_id,
    business_type, phone, email, address, city, state, zip_code, country,
    latitude, longitude, is_active, is_verified, status, subscription_tier, subscription_plan, subscription_amount, payment_method,
    suspension_reason, rating, total_reviews, created_at
)
SELECT
    'Pedro''s Electronics', 'pedros-electronics', 'Electronics and gadgets',
    c.id,
    (SELECT sc.id FROM public.sub_categories sc WHERE sc.category_id = c.id AND sc.slug = 'gadget-stores' LIMIT 1),
    'storefront', '09456789012', 'pedro@example.com', '789 Tech Street, Manila', 'Manila', 'Metro Manila', '1000', 'Philippines',
    14.5995, 120.9842, false, false, 'deactivated', 'gold', 'monthly', 2000.00, 'GCash',
    'Fraudulent Listing', 3.8, 12, '2023-12-05 09:15:00+00'
FROM public.categories c WHERE c.slug = 'shops'
ON CONFLICT (slug) DO NOTHING;

-- Insert Products
-- Only insert if product doesn't already exist for that merchant
INSERT INTO public.products (merchant_id, name, product_code, sku, description, price, quantity, category_id, sub_category_id, is_available)
SELECT 1, 'Adobo Rice Meal', 'ADB-001', 'ADB-001', 'Classic Filipino adobo with rice', 120.00, 45, 1, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Adobo Rice Meal')

UNION ALL

SELECT 1, 'Sinigang na Baboy', 'SIN-002', 'SIN-002', 'Pork sinigang soup with rice', 150.00, 38, 1, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Sinigang na Baboy')

UNION ALL

SELECT 1, 'Lechon Kawali', 'LCH-003', 'LCH-003', 'Crispy fried pork belly with rice', 180.00, 25, 1, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Lechon Kawali')

UNION ALL

SELECT 1, 'Kare-Kare', 'KRK-004', 'KRK-004', 'Oxtail and vegetables in peanut sauce', 200.00, 30, 1, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Kare-Kare')

UNION ALL

SELECT 2, 'Chocolate Cake (whole)', 'CHC-001', 'CHC-001', 'Rich chocolate layer cake', 850.00, 12, 1, 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 2 AND name = 'Chocolate Cake (whole)')

UNION ALL

SELECT 2, 'Ube Pandesal (dozen)', 'UBE-002', 'UBE-002', 'Purple yam bread rolls', 120.00, 50, 1, 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 2 AND name = 'Ube Pandesal (dozen)')

UNION ALL

SELECT 2, 'Ensaimada (6 pcs)', 'ENS-003', 'ENS-003', 'Sweet bread with butter and cheese', 180.00, 40, 1, 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 2 AND name = 'Ensaimada (6 pcs)')

UNION ALL

SELECT 2, 'Red Velvet Cupcakes (6 pcs)', 'RVC-004', 'RVC-004', 'Moist red velvet cupcakes with cream cheese frosting', 250.00, 35, 1, 5, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 2 AND name = 'Red Velvet Cupcakes (6 pcs)')

UNION ALL

-- Additional products for inventory management demo
SELECT 1, 'Premium Coffee Beans', 'PCB-001', 'PCB-001', 'High quality coffee beans', 350.00, 45, 1, 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Premium Coffee Beans')

UNION ALL

SELECT 1, 'Wired Headphones', 'WHD-002', 'WHD-002', 'Quality wired headphones', 2500.00, 12, 4, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Wired Headphones')

UNION ALL

SELECT 1, 'Cotton T-shirt', 'CTS-003', 'CTS-003', 'Comfortable cotton t-shirt', 450.00, 5, 4, 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Cotton T-shirt')

UNION ALL

SELECT 1, 'Laptop Repair Service', 'LRS-004', 'LRS-004', 'Professional laptop repair service', 1000.00, 999, 3, 2, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Laptop Repair Service')

UNION ALL

SELECT 1, 'Organic Honey', 'OHY-005', 'OHY-005', 'Pure organic honey', 280.00, 0, 1, 2, false
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Organic Honey');

-- Insert Merchant Applications (for admin dashboard)
-- Note: These require user_id from auth.users table. 
-- In production, you would link these to actual user accounts.
-- For dummy data, we'll use NULL user_id or you can create test users first.

INSERT INTO public.merchant_applications (
    business_name, email, phone, address,
    subscription_tier, subscription_plan, subscription_amount, payment_method,
    payment_proof_url, business_permit_url, dti_permit_url, valid_id_url,
    status, submitted_at
) VALUES
-- Pending Applications
('Sweet Delights Bakery', 'contact@sweetdelights.com', '+63 917 123 4567', '123 Bakery Street, Quezon City', 
 'gold', 'monthly', 2000.00, 'GCash',
 'https://via.placeholder.com/400x300?text=Payment+Proof', 
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'pending', '2025-01-25 10:30:00+00'),

('Fashion Finds Store', 'hello@fashionfinds.com', '+63 919 345 6789', '456 Fashion Avenue, Makati',
 'basic', 'weekly', 300.00, 'Maya',
 'https://via.placeholder.com/400x300?text=Payment+Proof',
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'pending', '2025-01-23 09:15:00+00'),

-- Reviewing Application
('Tech Gadgets Hub', 'info@techgadgets.com', '+63 918 234 5678', '789 Tech Boulevard, Quezon City',
 'platinum', 'annual', 40000.00, 'GCash',
 'https://via.placeholder.com/400x300?text=Payment+Proof',
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'reviewing', '2025-01-24 14:20:00+00'),

-- Approved Application (already converted to merchant)
('Green Garden Supplies', 'info@greengarden.com', '+63 920 456 7890', '321 Garden Road, Manila',
 'gold', 'monthly', 2000.00, 'Maya',
 'https://via.placeholder.com/400x300?text=Payment+Proof',
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'approved', '2025-01-20 11:00:00+00'),

-- Additional Pending Applications for variety
('Coffee Corner Express', 'orders@coffeecorner.com', '+63 921 567 8901', '555 Coffee Street, Makati',
 'basic', 'weekly', 300.00, 'GCash',
 'https://via.placeholder.com/400x300?text=Payment+Proof',
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'pending', '2025-01-26 08:45:00+00'),

('Beauty Salon Pro', 'book@beautysalon.com', '+63 922 678 9012', '888 Beauty Lane, Quezon City',
 'platinum', 'annual', 40000.00, 'Maya',
 'https://via.placeholder.com/400x300?text=Payment+Proof',
 'https://via.placeholder.com/400x300?text=Business+Permit',
 'https://via.placeholder.com/400x300?text=DTI+Permit',
 'https://via.placeholder.com/400x300?text=Valid+ID',
 'reviewing', '2025-01-25 15:30:00+00')
ON CONFLICT DO NOTHING;

-- Insert Promotions (Merchant promotions)
INSERT INTO public.promotions (merchant_id, title, description, discount_type, discount_value, start_date, end_date, is_active) VALUES
(1, 'Happy Hour Special', '20% off on all meals from 2PM-4PM', 'percentage', 20.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', true),
(2, 'Birthday Cake Discount', '15% off on whole cakes for birthdays', 'percentage', 15.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '60 days', true)
ON CONFLICT DO NOTHING;

-- Insert Customer "Looking For" Promotions/Ads
-- Note: These require user_id from users table. 
-- IMPORTANT: Create test users first (see dummy-users.sql), then run this script.
-- The script uses subqueries to get user_id by email, so it will work once users are created.

-- Ad 1: Looking for Plumber (Services > Plumbing)
INSERT INTO public.customer_promotions (
    user_id, ad_type, title, description, category_id, sub_category_id,
    min_price, max_price, barangay, city, preferred_date, contact_method,
    status, responses_count, posted_date, expires_date
)
SELECT 
    u.id,
    'services',
    'Looking for Plumber - Emergency Leak Repair',
    'Need expert plumber for emergency leak repair. Available sometime this morning.',
    (SELECT id FROM public.categories WHERE slug = 'services'),
    (SELECT sc.id FROM public.sub_categories sc JOIN public.categories c ON sc.category_id = c.id WHERE c.slug = 'services' AND sc.slug = 'plumbing' LIMIT 1),
    800.00, 1200.00,
    'Poblacion',
    'Makati',
    CURRENT_DATE + INTERVAL '7 days',
    'in-app',
    'active',
    0,
    '2024-01-01',
    '2024-02-19'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
ON CONFLICT DO NOTHING;

-- Ad 2: Need Custom T-shirts (Shops > Clothing)
INSERT INTO public.customer_promotions (
    user_id, ad_type, title, description, category_id, sub_category_id,
    min_price, max_price, barangay, city, preferred_date, contact_method,
    status, responses_count, posted_date, expires_date
)
SELECT 
    u.id,
    'items',
    'Need 50 Custom Printed T-shirts',
    'Looking for supplier who can print 50 custom t-shirts for an upcoming event.',
    (SELECT id FROM public.categories WHERE slug = 'shops'),
    (SELECT sc.id FROM public.sub_categories sc JOIN public.categories c ON sc.category_id = c.id WHERE c.slug = 'shops' AND sc.slug = 'clothing' LIMIT 1),
    1000.00, 2000.00,
    NULL,
    'Quezon City',
    CURRENT_DATE + INTERVAL '14 days',
    'phone',
    'active',
    0,
    '2024-01-15',
    '2024-02-17'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
ON CONFLICT DO NOTHING;

-- Ad 3: Carpenter Needed (Draft) (Services > Carpentry)
INSERT INTO public.customer_promotions (
    user_id, ad_type, title, description, category_id, sub_category_id,
    min_price, max_price, barangay, city, preferred_date, contact_method,
    status, responses_count, posted_date, expires_date
)
SELECT 
    u.id,
    'labor',
    'Carpenter Needed for Cabinet Installation',
    'Installing new kitchen cabinets, need experienced carpenter.',
    (SELECT id FROM public.categories WHERE slug = 'services'),
    (SELECT sc.id FROM public.sub_categories sc JOIN public.categories c ON sc.category_id = c.id WHERE c.slug = 'services' AND sc.slug = 'carpentry' LIMIT 1),
    2000.00, 3000.00,
    NULL,
    'Makati',
    CURRENT_DATE + INTERVAL '10 days',
    'in-app',
    'draft',
    0,
    '2024-01-10',
    '2024-02-19'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
ON CONFLICT DO NOTHING;

-- Insert Orders
-- Note: These require user_id and merchant_id. 
-- IMPORTANT: Create test users and merchants first, then run this script.

-- Order 1: The Garden Cafe
INSERT INTO public.orders (
    order_code, user_id, merchant_id, status, total_amount, delivery_address, delivery_fee, created_at
)
SELECT 
    'WK-02790731',
    u.id,
    1, -- Tita Rosa's Carinderia
    'pending',
    350.00,
    '123 Mabuti Street, Quezon City',
    50.00,
    '2025-01-25 10:30:00+00'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
ON CONFLICT (order_code) DO NOTHING;

-- Order 2: Seaside Grill
INSERT INTO public.orders (
    order_code, user_id, merchant_id, status, total_amount, delivery_address, delivery_fee, created_at
)
SELECT 
    'WK-02790732',
    u.id,
    1, -- Tita Rosa's Carinderia (can be changed to different merchant)
    'pending',
    280.00,
    '123 Mabuti Street, Quezon City',
    50.00,
    '2025-01-24 14:20:00+00'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
ON CONFLICT (order_code) DO NOTHING;

-- Insert Order Items
-- Note: These require order_id. The order_code is used to find the order.
-- Only insert if order exists and items don't already exist for that order
INSERT INTO public.order_items (order_id, product_name, quantity, price, subtotal)
SELECT 
    o.id,
    'Classic Adobo',
    2,
    120.00,
    240.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-001'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Classic Adobo'
  )

UNION ALL

SELECT 
    o.id,
    'Crispy Pata',
    1,
    180.00,
    180.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-001'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Crispy Pata'
  )

UNION ALL

SELECT 
    o.id,
    'Halo-Halo',
    1,
    50.00,
    50.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-001'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Halo-Halo'
  )

UNION ALL

SELECT 
    o.id,
    'Sinigang na Baboy',
    1,
    150.00,
    150.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-002'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Sinigang na Baboy'
  )

UNION ALL

SELECT 
    o.id,
    'Lechon Kawali',
    1,
    180.00,
    180.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-002'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Lechon Kawali'
  )

UNION ALL

SELECT 
    o.id,
    'Kare-Kare',
    1,
    200.00,
    200.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-003'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Kare-Kare'
  )

UNION ALL

SELECT 
    o.id,
    'Adobo Rice Meal',
    1,
    120.00,
    120.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-003'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Adobo Rice Meal'
  )

UNION ALL

SELECT 
    o.id,
    'Premium Coffee Beans',
    2,
    350.00,
    700.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-004'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Premium Coffee Beans'
  )

UNION ALL

SELECT 
    o.id,
    'Wired Headphones',
    1,
    2500.00,
    2500.00
FROM public.orders o
WHERE o.order_code = 'ORD-2025-004'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi 
    WHERE oi.order_id = o.id AND oi.product_name = 'Wired Headphones'
  );

-- Insert Reservations
-- Note: These require user_id and merchant_id. 
-- IMPORTANT: Create test users and merchants first, then run this script.

-- Reservation 1: Tita Rosa's Carinderia
INSERT INTO public.reservations (
    reservation_code, user_id, merchant_id, reservation_date, reservation_time,
    number_of_guests, table_number, status, contact_phone, created_at
)
SELECT 
    'RES-2025-001',
    u.id,
    1, -- Tita Rosa's Carinderia
    CURRENT_DATE + INTERVAL '3 days',
    '19:00:00',
    4,
    NULL,
    'pending',
    '+63 9123 456 7890',
    CURRENT_TIMESTAMP
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
ON CONFLICT (reservation_code) DO NOTHING;

-- Reservation 2: Maria's Bakery
INSERT INTO public.reservations (
    reservation_code, user_id, merchant_id, reservation_date, reservation_time,
    number_of_guests, table_number, status, contact_phone, created_at
)
SELECT 
    'RES-2025-002',
    u.id,
    2, -- Maria's Bakery
    CURRENT_DATE + INTERVAL '5 days',
    '18:30:00',
    2,
    '12',
    'confirmed',
    '+63 9123 456 7890',
    CURRENT_TIMESTAMP - INTERVAL '2 days'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 2)
ON CONFLICT (reservation_code) DO NOTHING;

-- Reservation 3: Tita Rosa's Carinderia (Checked In)
INSERT INTO public.reservations (
    reservation_code, user_id, merchant_id, reservation_date, reservation_time,
    number_of_guests, table_number, status, contact_phone, created_at
)
SELECT 
    'RES-2025-003',
    u.id,
    1, -- Tita Rosa's Carinderia
    CURRENT_DATE - INTERVAL '1 day',
    '12:00:00',
    6,
    '5',
    'checked_in',
    '+63 9123 456 7890',
    CURRENT_TIMESTAMP - INTERVAL '3 days'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
ON CONFLICT (reservation_code) DO NOTHING;

-- Insert Reviews (for merchant dashboard)
-- Note: These require user_id, merchant_id, and optionally product_id
-- IMPORTANT: Create test users, merchants, and products first, then run this script.

-- Review 1: Premium Coffee Beans
INSERT INTO public.reviews (
    user_id, merchant_id, product_id, rating, review_text, created_at
)
SELECT 
    u.id,
    1, -- Tita Rosa's Carinderia
    (SELECT id FROM public.products WHERE merchant_id = 1 AND name = 'Premium Coffee Beans' LIMIT 1),
    5,
    'Excellent service! Very professional and the product quality is top-notch. Highly recommended!',
    '2024-01-15 10:00:00+00'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
  AND EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Premium Coffee Beans')
ON CONFLICT DO NOTHING;

-- Review 2: Wired Headphones
INSERT INTO public.reviews (
    user_id, merchant_id, product_id, rating, review_text, created_at
)
SELECT 
    u.id,
    1, -- Tita Rosa's Carinderia
    (SELECT id FROM public.products WHERE merchant_id = 1 AND name = 'Wired Headphones' LIMIT 1),
    4,
    'Good quality but delivery took a bit longer than expected. Overall satisfied with the purchase.',
    '2024-01-14 14:30:00+00'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
  AND EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Wired Headphones')
ON CONFLICT DO NOTHING;

-- Review 3: Cotton T-shirt
INSERT INTO public.reviews (
    user_id, merchant_id, product_id, rating, review_text, created_at
)
SELECT 
    u.id,
    1, -- Tita Rosa's Carinderia
    (SELECT id FROM public.products WHERE merchant_id = 1 AND name = 'Cotton T-shirt' LIMIT 1),
    5,
    'Amazing! Will definitely order again. The customer service was exceptional.',
    '2024-01-13 09:15:00+00'
FROM public.users u
WHERE u.email = 'customer@wekonnek.com'
  AND EXISTS (SELECT 1 FROM public.merchants WHERE id = 1)
  AND EXISTS (SELECT 1 FROM public.products WHERE merchant_id = 1 AND name = 'Cotton T-shirt')
ON CONFLICT DO NOTHING;
