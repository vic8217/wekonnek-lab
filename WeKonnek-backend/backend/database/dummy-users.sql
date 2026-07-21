-- We Konnek Dummy Users Setup
-- This script helps you create test users with different roles
--
-- IMPORTANT: You need to create users in Supabase Auth first, then run this script
--
-- Method 1: Create users via Supabase Dashboard
-- 1. Go to Authentication > Users in Supabase Dashboard
-- 2. Click "Add user" > "Create new user"
-- 3. Create users with these emails and passwords:
--    - admin@wekonnek.com / Password123!
--    - staff@wekonnek.com / Password123!
--    - merchant@wekonnek.com / Password123!
--    - customer@wekonnek.com / Password123!
--    - merchant2@wekonnek.com / Password123!
--    - customer2@wekonnek.com / Password123!
--
-- Method 2: Create users via Registration Form
-- 1. Go to http://localhost:3001/auth/login
-- 2. Register users with the emails above
-- 3. Then run this script to update their user_type
--
-- After creating users, run this script to set their roles and profile data

-- Update user types and create profiles for existing users
-- Replace the emails below with the actual emails you used when creating users

-- Admin User
UPDATE public.users 
SET 
    user_type = 'admin',
    first_name = 'Juan',
    last_name = 'Dela Cruz',
    phone = '+63 917 123 4567'
WHERE email = 'admin@wekonnek.com';

-- If user doesn't exist in public.users, insert it
-- First, get the user ID from auth.users (you'll need to do this manually or use a function)
-- For now, we'll use a workaround: create the profile if it doesn't exist
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'admin@wekonnek.com',
    'Juan',
    'Dela Cruz',
    'admin',
    '+63 917 123 4567'
FROM auth.users au
WHERE au.email = 'admin@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'admin',
    first_name = 'Juan',
    last_name = 'Dela Cruz',
    phone = '+63 917 123 4567';

-- Staff User
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'staff@wekonnek.com',
    'Maria',
    'Santos',
    'staff',
    '+63 918 234 5678'
FROM auth.users au
WHERE au.email = 'staff@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'staff',
    first_name = 'Maria',
    last_name = 'Santos',
    phone = '+63 918 234 5678';

-- Merchant User 1
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'merchant@wekonnek.com',
    'Pedro',
    'Garcia',
    'merchant',
    '+63 919 345 6789'
FROM auth.users au
WHERE au.email = 'merchant@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'merchant',
    first_name = 'Pedro',
    last_name = 'Garcia',
    phone = '+63 919 345 6789';

-- Merchant User 2
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'merchant2@wekonnek.com',
    'Ana',
    'Reyes',
    'merchant',
    '+63 920 456 7890'
FROM auth.users au
WHERE au.email = 'merchant2@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'merchant',
    first_name = 'Ana',
    last_name = 'Reyes',
    phone = '+63 920 456 7890';

-- Customer User 1
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'customer@wekonnek.com',
    'Luis',
    'Fernandez',
    'customer',
    '+63 921 567 8901'
FROM auth.users au
WHERE au.email = 'customer@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'customer',
    first_name = 'Luis',
    last_name = 'Fernandez',
    phone = '+63 921 567 8901';

-- Customer User 2
INSERT INTO public.users (id, email, first_name, last_name, user_type, phone)
SELECT 
    au.id,
    'customer2@wekonnek.com',
    'Sofia',
    'Martinez',
    'customer',
    '+63 922 678 9012'
FROM auth.users au
WHERE au.email = 'customer2@wekonnek.com'
ON CONFLICT (id) DO UPDATE SET
    user_type = 'customer',
    first_name = 'Sofia',
    last_name = 'Martinez',
    phone = '+63 922 678 9012';

-- Verify the users were created
SELECT 
    u.email,
    u.first_name,
    u.last_name,
    u.user_type,
    u.phone,
    au.email_confirmed_at IS NOT NULL as email_verified
FROM public.users u
JOIN auth.users au ON u.id = au.id
WHERE u.email IN (
    'admin@wekonnek.com',
    'staff@wekonnek.com',
    'merchant@wekonnek.com',
    'merchant2@wekonnek.com',
    'customer@wekonnek.com',
    'customer2@wekonnek.com'
)
ORDER BY u.user_type, u.email;
