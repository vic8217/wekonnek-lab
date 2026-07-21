-- Staff Posts table for time-limited posts created by staff
CREATE TABLE IF NOT EXISTS public.staff_posts (
    id SERIAL PRIMARY KEY,
    merchant_id INTEGER REFERENCES public.merchants(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category_tag VARCHAR(100),
    category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    views_count INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    document_urls TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_staff_posts_merchant_id ON public.staff_posts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_staff_posts_category_id ON public.staff_posts(category_id);
CREATE INDEX IF NOT EXISTS idx_staff_posts_expires_at ON public.staff_posts(expires_at);
CREATE INDEX IF NOT EXISTS idx_staff_posts_is_active ON public.staff_posts(is_active);

-- Enable Row Level Security
ALTER TABLE public.staff_posts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Staff posts are viewable by everyone" ON public.staff_posts;
CREATE POLICY "Staff posts are viewable by everyone" ON public.staff_posts
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Staff can create posts" ON public.staff_posts;
CREATE POLICY "Staff can create posts" ON public.staff_posts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND (users.user_type = 'admin' OR users.user_type = 'staff')
        )
    );

DROP POLICY IF EXISTS "Staff can update posts" ON public.staff_posts;
CREATE POLICY "Staff can update posts" ON public.staff_posts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND (users.user_type = 'admin' OR users.user_type = 'staff')
        )
    );

DROP POLICY IF EXISTS "Staff can delete posts" ON public.staff_posts;
CREATE POLICY "Staff can delete posts" ON public.staff_posts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND (users.user_type = 'admin' OR users.user_type = 'staff')
        )
    );
