-- Quick Script to Set User Roles
-- Run this AFTER creating users in Supabase Auth Dashboard
-- This script updates existing users in public.users table

-- Make sure users exist in auth.users first, then run these updates:

-- Admin User
UPDATE public.users 
SET 
    user_type = 'admin',
    first_name = 'Juan',
    last_name = 'Dela Cruz',
    phone = '+63 917 123 4567'
WHERE email = 'admin@wekonnek.com';

-- Staff User
UPDATE public.users 
SET 
    user_type = 'staff',
    first_name = 'Maria',
    last_name = 'Santos',
    phone = '+63 918 234 5678'
WHERE email = 'staff@wekonnek.com';

-- Merchant User 1
UPDATE public.users 
SET 
    user_type = 'merchant',
    first_name = 'Pedro',
    last_name = 'Garcia',
    phone = '+63 919 345 6789'
WHERE email = 'merchant@wekonnek.com';

-- Merchant User 2
UPDATE public.users 
SET 
    user_type = 'merchant',
    first_name = 'Ana',
    last_name = 'Reyes',
    phone = '+63 920 456 7890'
WHERE email = 'merchant2@wekonnek.com';

-- Customer User 1
UPDATE public.users 
SET 
    user_type = 'customer',
    first_name = 'Luis',
    last_name = 'Fernandez',
    phone = '+63 921 567 8901'
WHERE email = 'customer@wekonnek.com';

-- Customer User 2
UPDATE public.users 
SET 
    user_type = 'customer',
    first_name = 'Sofia',
    last_name = 'Martinez',
    phone = '+63 922 678 9012'
WHERE email = 'customer2@wekonnek.com';

-- Verify users
SELECT 
    email,
    first_name,
    last_name,
    user_type,
    phone
FROM public.users
WHERE email IN (
    'admin@wekonnek.com',
    'staff@wekonnek.com',
    'merchant@wekonnek.com',
    'merchant2@wekonnek.com',
    'customer@wekonnek.com',
    'customer2@wekonnek.com'
)
ORDER BY user_type, email;
