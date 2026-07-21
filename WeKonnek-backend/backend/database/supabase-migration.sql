-- We Konnek Supabase Migration
-- Run this in your Supabase SQL Editor
-- 
-- NOTE: This migration is idempotent - it can be run multiple times safely.
-- It uses IF NOT EXISTS for tables/indexes and DROP IF EXISTS for policies/triggers.

-- Enable UUID extension (for auth.users)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
-- This table stores additional user profile information
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    user_type VARCHAR(50) NOT NULL DEFAULT 'customer' CHECK (user_type IN ('customer', 'merchant', 'admin', 'staff')),
    phone VARCHAR(20),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Categories table (top-level groupings)
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sub-categories table (specific segments within categories)
CREATE TABLE IF NOT EXISTS public.sub_categories (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, slug)
);

-- Merchants table
CREATE TABLE IF NOT EXISTS public.merchants (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES public.categories(id),
    sub_category_id INTEGER REFERENCES public.sub_categories(id),
    business_type VARCHAR(50) NOT NULL CHECK (business_type IN ('storefront', 'mobile_cart', 'home_based')),
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Philippines',
    logo_url VARCHAR(500),
    cover_image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
    subscription_tier VARCHAR(50) DEFAULT 'basic' CHECK (subscription_tier IN ('basic', 'gold', 'platinum')),
    subscription_plan VARCHAR(50) DEFAULT 'weekly' CHECK (subscription_plan IN ('weekly', 'monthly', 'annual')),
    subscription_amount DECIMAL(10, 2) DEFAULT 0.00,
    payment_method VARCHAR(50),
    suspension_reason TEXT,
    suspension_duration INTEGER,
    suspended_until TIMESTAMP WITH TIME ZONE,
    rating DECIMAL(3, 2) DEFAULT 0.00,
    total_reviews INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Merchant Applications table (for registration submissions)
CREATE TABLE IF NOT EXISTS public.merchant_applications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    business_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    subscription_tier VARCHAR(50) DEFAULT 'basic' CHECK (subscription_tier IN ('basic', 'gold', 'platinum')),
    subscription_plan VARCHAR(50) DEFAULT 'weekly' CHECK (subscription_plan IN ('weekly', 'monthly', 'annual')),
    subscription_amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50),
    payment_proof_url VARCHAR(500),
    business_permit_url VARCHAR(500),
    dti_permit_url VARCHAR(500),
    valid_id_url VARCHAR(500),
    establishment_photo_url VARCHAR(500),
    authorized_person_photo_url VARCHAR(500),
    business_documents_urls TEXT[], -- Array of document URLs
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products/Offerings table
CREATE TABLE IF NOT EXISTS public.products (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2),
    image_url VARCHAR(500),
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add new columns to products table if they don't exist (for existing tables)
DO $$ 
BEGIN
    -- Add product_code if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'products' 
                   AND column_name = 'product_code') THEN
        ALTER TABLE public.products ADD COLUMN product_code VARCHAR(100);
    END IF;
    
    -- Add sku if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'products' 
                   AND column_name = 'sku') THEN
        ALTER TABLE public.products ADD COLUMN sku VARCHAR(100);
    END IF;
    
    -- Add quantity if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'products' 
                   AND column_name = 'quantity') THEN
        ALTER TABLE public.products ADD COLUMN quantity INTEGER DEFAULT 0;
    END IF;
    
    -- Add category_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'products' 
                   AND column_name = 'category_id') THEN
        ALTER TABLE public.products ADD COLUMN category_id INTEGER REFERENCES public.categories(id);
    END IF;
    
    -- Add sub_category_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'products' 
                   AND column_name = 'sub_category_id') THEN
        ALTER TABLE public.products ADD COLUMN sub_category_id INTEGER REFERENCES public.sub_categories(id);
    END IF;
END $$;

-- Promotions/Offers table (merchant promotions)
CREATE TABLE IF NOT EXISTS public.promotions (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    discount_type VARCHAR(50) CHECK (discount_type IN ('percentage', 'fixed', 'buy_one_get_one')),
    discount_value DECIMAL(10, 2),
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customer "Looking For" Ads/Promotions table
CREATE TABLE IF NOT EXISTS public.customer_promotions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ad_type VARCHAR(50) NOT NULL CHECK (ad_type IN ('items', 'services', 'labor')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER REFERENCES public.categories(id),
    sub_category_id INTEGER REFERENCES public.sub_categories(id),
    min_price DECIMAL(10, 2),
    max_price DECIMAL(10, 2),
    barangay VARCHAR(100),
    city VARCHAR(100) NOT NULL,
    preferred_date DATE,
    contact_method VARCHAR(50) DEFAULT 'in-app' CHECK (contact_method IN ('in-app', 'phone', 'email', 'both')),
    attachment_urls TEXT[],
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'active', 'closed')),
    responses_count INTEGER DEFAULT 0,
    posted_date DATE DEFAULT CURRENT_DATE,
    expires_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE IF NOT EXISTS public.orders (
    id SERIAL PRIMARY KEY,
    order_code VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    merchant_id INTEGER NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
    total_amount DECIMAL(10, 2) NOT NULL,
    delivery_address TEXT,
    delivery_fee DECIMAL(10, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add table_number to orders if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'orders' 
                   AND column_name = 'table_number') THEN
        ALTER TABLE public.orders ADD COLUMN table_number VARCHAR(20);
    END IF;
END $$;

-- Update orders status constraint to include new status values
DO $$ 
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Find the constraint name
    SELECT constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'orders' 
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%status%';
    
    -- Drop old constraint if found
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', constraint_name_var);
    END IF;
    
    -- Add new constraint with all status values
    BEGIN
        ALTER TABLE public.orders ADD CONSTRAINT orders_status_check 
            CHECK (status IN ('pending', 'processing', 'preparing', 'ready', 'completed', 'cancelled', 'bill_out'));
    EXCEPTION
        WHEN duplicate_object THEN NULL; -- Constraint already exists, ignore
        WHEN others THEN NULL; -- Other errors, ignore
    END;
END $$;

-- Order Items table
CREATE TABLE IF NOT EXISTS public.order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES public.products(id),
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reservations table
CREATE TABLE IF NOT EXISTS public.reservations (
    id SERIAL PRIMARY KEY,
    reservation_code VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    merchant_id INTEGER NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    reservation_date DATE NOT NULL,
    reservation_time TIME NOT NULL,
    number_of_guests INTEGER NOT NULL,
    table_number VARCHAR(20),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed')),
    special_requests TEXT,
    contact_phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add table_number to reservations if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'reservations' 
                   AND column_name = 'table_number') THEN
        ALTER TABLE public.reservations ADD COLUMN table_number VARCHAR(20);
    END IF;
END $$;

-- Update reservations status constraint to include 'checked_in'
DO $$ 
DECLARE
    constraint_name_var TEXT;
BEGIN
    -- Find the constraint name
    SELECT constraint_name INTO constraint_name_var
    FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'reservations' 
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%status%';
    
    -- Drop old constraint if found
    IF constraint_name_var IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', constraint_name_var);
    END IF;
    
    -- Add new constraint with all status values
    BEGIN
        ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_check 
            CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed'));
    EXCEPTION
        WHEN duplicate_object THEN NULL; -- Constraint already exists, ignore
        WHEN others THEN NULL; -- Other errors, ignore
    END;
END $$;

-- Reviews table (for customer reviews of products/merchants)
CREATE TABLE IF NOT EXISTS public.reviews (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    merchant_id INTEGER REFERENCES public.merchants(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES public.products(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    response_text TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sub_categories_category_id ON public.sub_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_merchants_category_id ON public.merchants(category_id);
CREATE INDEX IF NOT EXISTS idx_merchants_sub_category_id ON public.merchants(sub_category_id);
CREATE INDEX IF NOT EXISTS idx_merchants_city ON public.merchants(city);
CREATE INDEX IF NOT EXISTS idx_merchants_location ON public.merchants(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_merchants_is_active ON public.merchants(is_active);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON public.merchants(status);
CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON public.merchants(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_applications_status ON public.merchant_applications(status);
CREATE INDEX IF NOT EXISTS idx_merchant_applications_user_id ON public.merchant_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_is_active ON public.categories(is_active);
CREATE INDEX IF NOT EXISTS idx_sub_categories_is_active ON public.sub_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON public.products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_promotions_merchant_id ON public.promotions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customer_promotions_user_id ON public.customer_promotions(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_promotions_status ON public.customer_promotions(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON public.orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON public.reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_merchant_id ON public.reservations(merchant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(status);

-- Create index on products.category_id only if the column exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'products' 
               AND column_name = 'category_id') THEN
        CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_merchant_id ON public.reviews(merchant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON public.reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
-- Drop existing triggers if they exist, then recreate
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON public.categories;
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_sub_categories_updated_at ON public.sub_categories;
CREATE TRIGGER update_sub_categories_updated_at BEFORE UPDATE ON public.sub_categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchants_updated_at ON public.merchants;
CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON public.merchants
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchant_applications_updated_at ON public.merchant_applications;
CREATE TRIGGER update_merchant_applications_updated_at BEFORE UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_promotions_updated_at ON public.promotions;
CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_promotions_updated_at ON public.customer_promotions;
CREATE TRIGGER update_customer_promotions_updated_at BEFORE UPDATE ON public.customer_promotions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_reservations_updated_at ON public.reservations;
CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_reviews_updated_at ON public.reviews;
CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
