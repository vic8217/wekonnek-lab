-- Delivery Zones Migration for WeKonnek
-- This creates a zone-based delivery system for identifying delivery areas
-- Example: Manila District 3 = Binondo, Sta. Cruz, Quiapo, San Nicolas
--
-- Run this AFTER supabase-migration.sql

-- ============================================================
-- 1. Delivery Zones Table (Districts / Service Areas)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.delivery_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,               -- e.g., "District 3 - Manila"
    code VARCHAR(50) UNIQUE NOT NULL,         -- e.g., "MNL-D3"
    city VARCHAR(100) NOT NULL,               -- e.g., "Manila"
    region VARCHAR(100) NOT NULL DEFAULT 'Metro Manila',
    description TEXT,
    base_delivery_fee DECIMAL(10, 2) DEFAULT 49.00,   -- Same-zone fee
    cross_zone_fee DECIMAL(10, 2) DEFAULT 79.00,      -- Different zone, same city
    cross_city_fee DECIMAL(10, 2) DEFAULT 129.00,     -- Different city
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active delivery zones" ON public.delivery_zones;
CREATE POLICY "Anyone can view active delivery zones" ON public.delivery_zones
    FOR SELECT USING (true);

-- ============================================================
-- 2. Zone Areas Table (Barangays / Neighborhoods within zones)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.delivery_zone_areas (
    id SERIAL PRIMARY KEY,
    zone_id INTEGER NOT NULL REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
    area_name VARCHAR(255) NOT NULL,          -- e.g., "Binondo", "Sta. Cruz"
    area_type VARCHAR(50) DEFAULT 'barangay' CHECK (area_type IN ('barangay', 'district', 'neighborhood', 'subdivision', 'zone')),
    zip_code VARCHAR(20),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    radius_km DECIMAL(5, 2) DEFAULT 2.0,      -- Coverage radius
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_id, area_name)
);

ALTER TABLE public.delivery_zone_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active zone areas" ON public.delivery_zone_areas;
CREATE POLICY "Anyone can view active zone areas" ON public.delivery_zone_areas
    FOR SELECT USING (true);

-- ============================================================
-- 3. Add zone references to merchants and orders
-- ============================================================
DO $$ 
BEGIN
    -- Add delivery_zone_id to merchants
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'merchants' 
                   AND column_name = 'delivery_zone_id') THEN
        ALTER TABLE public.merchants ADD COLUMN delivery_zone_id INTEGER REFERENCES public.delivery_zones(id);
    END IF;

    -- Add barangay to merchants
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'merchants' 
                   AND column_name = 'barangay') THEN
        ALTER TABLE public.merchants ADD COLUMN barangay VARCHAR(255);
    END IF;

    -- Add delivery_zone_id to orders (merchant's zone at time of order)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'orders' 
                   AND column_name = 'delivery_zone_id') THEN
        ALTER TABLE public.orders ADD COLUMN delivery_zone_id INTEGER REFERENCES public.delivery_zones(id);
    END IF;

    -- Add delivery_zone_name to orders (snapshot for historical records)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'orders' 
                   AND column_name = 'delivery_zone_name') THEN
        ALTER TABLE public.orders ADD COLUMN delivery_zone_name VARCHAR(255);
    END IF;

    -- Add customer_barangay to orders
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'orders' 
                   AND column_name = 'customer_barangay') THEN
        ALTER TABLE public.orders ADD COLUMN customer_barangay VARCHAR(255);
    END IF;

    -- Add order_type to orders (delivery, pickup, dine_in)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'orders' 
                   AND column_name = 'order_type') THEN
        ALTER TABLE public.orders ADD COLUMN order_type VARCHAR(20) DEFAULT 'delivery' 
            CHECK (order_type IN ('delivery', 'pickup', 'dine_in'));
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_zones_city ON public.delivery_zones(city);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_region ON public.delivery_zones(region);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_code ON public.delivery_zones(code);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_is_active ON public.delivery_zones(is_active);
CREATE INDEX IF NOT EXISTS idx_zone_areas_zone_id ON public.delivery_zone_areas(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_areas_zip_code ON public.delivery_zone_areas(zip_code);
CREATE INDEX IF NOT EXISTS idx_merchants_delivery_zone ON public.merchants(delivery_zone_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_zone ON public.orders(delivery_zone_id);

-- Triggers
DROP TRIGGER IF EXISTS update_delivery_zones_updated_at ON public.delivery_zones;
CREATE TRIGGER update_delivery_zones_updated_at BEFORE UPDATE ON public.delivery_zones
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_zone_areas_updated_at ON public.delivery_zone_areas;
CREATE TRIGGER update_zone_areas_updated_at BEFORE UPDATE ON public.delivery_zone_areas
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 4. SEED DATA — Metro Manila Delivery Zones
-- ============================================================

-- ========== CITY OF MANILA (6 Districts) ==========
INSERT INTO public.delivery_zones (name, code, city, region, description, base_delivery_fee, cross_zone_fee, cross_city_fee, display_order) VALUES
('District 1 - Manila', 'MNL-D1', 'Manila', 'Metro Manila', 'Ermita, Intramuros, Malate, Paco, Port Area, San Andres Bukid', 49.00, 69.00, 99.00, 1),
('District 2 - Manila', 'MNL-D2', 'Manila', 'Metro Manila', 'Pandacan, Sampaloc, Santa Mesa', 49.00, 69.00, 99.00, 2),
('District 3 - Manila', 'MNL-D3', 'Manila', 'Metro Manila', 'Binondo, Quiapo, San Nicolas, Santa Cruz', 49.00, 69.00, 99.00, 3),
('District 4 - Manila', 'MNL-D4', 'Manila', 'Metro Manila', 'San Miguel, Tondo I, Tondo II', 49.00, 69.00, 99.00, 4),
('District 5 - Manila', 'MNL-D5', 'Manila', 'Metro Manila', 'Pasay border areas, South Manila', 49.00, 69.00, 99.00, 5),
('District 6 - Manila', 'MNL-D6', 'Manila', 'Metro Manila', 'Tondo III and surrounding areas', 49.00, 69.00, 99.00, 6)
ON CONFLICT (code) DO NOTHING;

-- ========== QUEZON CITY (6 Districts) ==========
INSERT INTO public.delivery_zones (name, code, city, region, description, base_delivery_fee, cross_zone_fee, cross_city_fee, display_order) VALUES
('District 1 - Quezon City', 'QC-D1', 'Quezon City', 'Metro Manila', 'Alicia, Bagong Pag-asa, Bago Bantay, Bahay Toro, Balingasa, Damayang Lagi, Del Monte, Lourdes, Maharlika, Manresa, Mariblo, Masambong, Nayong Kanluran, Paang Bundok, Pag-ibig sa Nayon, Paltok, Paraiso, Phil-Am, Project 6, Salvacion, San Antonio, San Isidro Labrador, San Jose, Santa Cruz, Santa Teresita, Santo Cristo, Santo Domingo, Siena, St. Peter, Talayan, Veterans Village, West Triangle', 49.00, 69.00, 99.00, 7),
('District 2 - Quezon City', 'QC-D2', 'Quezon City', 'Metro Manila', 'Bagong Silangan, Batasan Hills, Commonwealth, Holy Spirit, Payatas', 49.00, 69.00, 99.00, 8),
('District 3 - Quezon City', 'QC-D3', 'Quezon City', 'Metro Manila', 'Amihan, Bagumbayan, Claro, Dioquino Zobel, Duyan-duyan, E. Rodriguez, East Kamias, Escopa I-IV, Kalusugan, Kamuning, Kaunlaran, Kristong Hari, Laging Handa, Malaya, Mariana, Obrero, Pinyahan, Quirino, Roxas, Sacred Heart, San Isidro Galas, San Martin de Porres, San Roque, Tagumpay, UP Campus, UP Village, Valencia, Villa Maria Clara', 49.00, 69.00, 99.00, 9),
('District 4 - Quezon City', 'QC-D4', 'Quezon City', 'Metro Manila', 'Apolonio Samson, Baesa, Balumbato, Culiat, New Era, Novaliches Proper, Pasong Putik, Sangandaan, Sauyo, Talipapa, Tandang Sora, Unang Sigaw', 49.00, 69.00, 99.00, 10),
('District 5 - Quezon City', 'QC-D5', 'Quezon City', 'Metro Manila', 'Bagbag, Capri, Fairview, Greater Lagro, Gulod, Kaligayahan, Nagkaisang Nayon, North Fairview, Pasong Putik Proper, San Agustin, San Bartolome', 49.00, 69.00, 99.00, 11),
('District 6 - Quezon City', 'QC-D6', 'Quezon City', 'Metro Manila', 'Bagong Lipunan ng Crame, Cubao, Immaculate Concepcion, Krus na Ligas, Loyola Heights, Mangga, Marilag, Masagana, Milagrosa, NS Amoranto, Old Capitol Site, Ramon Magsaysay, San Vicente, Sikatuna Village, South Triangle, Teachers Village', 49.00, 69.00, 99.00, 12)
ON CONFLICT (code) DO NOTHING;

-- ========== MAKATI (2 Districts) ==========
INSERT INTO public.delivery_zones (name, code, city, region, description, base_delivery_fee, cross_zone_fee, cross_city_fee, display_order) VALUES
('District 1 - Makati', 'MKT-D1', 'Makati', 'Metro Manila', 'Bel-Air, Forbes Park, Legaspi Village, Salcedo Village, San Lorenzo, Urdaneta', 59.00, 79.00, 109.00, 13),
('District 2 - Makati', 'MKT-D2', 'Makati', 'Metro Manila', 'Cembo, Comembo, Guadalupe, Pembo, Pinagkaisahan, Pitogo, Poblacion, Rembo, South Cembo, West Rembo', 49.00, 69.00, 99.00, 14)
ON CONFLICT (code) DO NOTHING;

-- ========== OTHER METRO MANILA CITIES ==========
INSERT INTO public.delivery_zones (name, code, city, region, description, base_delivery_fee, cross_zone_fee, cross_city_fee, display_order) VALUES
('Pasig City', 'PSG-01', 'Pasig', 'Metro Manila', 'Bagong Ilog, Kapitolyo, Ortigas Center, Rosario, San Miguel, Santolan', 49.00, 69.00, 99.00, 15),
('Taguig City', 'TGG-01', 'Taguig', 'Metro Manila', 'BGC, Fort Bonifacio, Western Bicutan, Signal Village, Upper Bicutan', 59.00, 79.00, 109.00, 16),
('Mandaluyong City', 'MDL-01', 'Mandaluyong', 'Metro Manila', 'Addition Hills, Highway Hills, Ortigas, Pleasant Hills, Shaw Boulevard, Wack-Wack', 49.00, 69.00, 99.00, 17),
('San Juan City', 'SJN-01', 'San Juan', 'Metro Manila', 'Greenhills, Little Baguio, Rivera, West Crame', 49.00, 69.00, 99.00, 18),
('Parañaque City', 'PRQ-01', 'Parañaque', 'Metro Manila', 'BF Homes, Baclaran, Better Living, Moonwalk, San Dionisio, Sucat', 49.00, 69.00, 99.00, 19),
('Las Piñas City', 'LPN-01', 'Las Piñas', 'Metro Manila', 'Almanza, BF Resort, Pamplona, Pilar, Talon', 49.00, 69.00, 99.00, 20),
('Pasay City', 'PSY-01', 'Pasay', 'Metro Manila', 'Baclaran, Cartimar, MOA area, Villamor Airbase', 49.00, 69.00, 99.00, 21),
('Caloocan City', 'CLC-01', 'Caloocan', 'Metro Manila', 'Bagong Barrio, Camarin, Grace Park, Monumento', 49.00, 69.00, 99.00, 22),
('Malabon City', 'MLB-01', 'Malabon', 'Metro Manila', 'Catmon, Concepcion, Longos, Tonsuya', 49.00, 69.00, 99.00, 23),
('Navotas City', 'NVT-01', 'Navotas', 'Metro Manila', 'North Bay Boulevard, San Jose, Tangos', 49.00, 69.00, 99.00, 24),
('Valenzuela City', 'VLZ-01', 'Valenzuela', 'Metro Manila', 'Karuhatan, Lingunan, Malinta, Paso de Blas', 49.00, 69.00, 99.00, 25),
('Marikina City', 'MRK-01', 'Marikina', 'Metro Manila', 'Concepcion, Industrial Valley, Malanday, Nangka, Parang, Santo Niño', 49.00, 69.00, 99.00, 26),
('Muntinlupa City', 'MTP-01', 'Muntinlupa', 'Metro Manila', 'Alabang, Ayala Alabang, Bayanan, Cupang, Putatan, Sucat', 49.00, 69.00, 99.00, 27),
('Pateros', 'PTR-01', 'Pateros', 'Metro Manila', 'Aguho, San Pedro, Santa Ana, Tabacalera', 49.00, 69.00, 99.00, 28)
ON CONFLICT (code) DO NOTHING;


-- ============================================================
-- 5. SEED: Zone Areas (Barangays) — Manila Districts
-- ============================================================

-- ===== District 1 - Manila =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'Ermita', 'barangay', '1000', 14.5833, 120.9833),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'Intramuros', 'barangay', '1002', 14.5889, 120.9736),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'Malate', 'barangay', '1004', 14.5681, 120.9906),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'Paco', 'barangay', '1007', 14.5794, 121.0000),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'Port Area', 'barangay', '1018', 14.5889, 120.9611),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D1'), 'San Andres Bukid', 'barangay', '1017', 14.5728, 121.0003)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ===== District 2 - Manila =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D2'), 'Pandacan', 'barangay', '1011', 14.5883, 121.0036),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D2'), 'Sampaloc', 'barangay', '1008', 14.6111, 120.9928),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D2'), 'Santa Mesa', 'barangay', '1016', 14.6019, 121.0133)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ===== District 3 - Manila (User's example!) =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D3'), 'Binondo', 'barangay', '1006', 14.5997, 120.9744),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D3'), 'Quiapo', 'barangay', '1001', 14.5986, 120.9839),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D3'), 'San Nicolas', 'barangay', '1010', 14.6042, 120.9736),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D3'), 'Santa Cruz', 'barangay', '1003', 14.6036, 120.9833)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ===== District 4 - Manila =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D4'), 'San Miguel', 'barangay', '1005', 14.5944, 120.9903),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D4'), 'Tondo I', 'barangay', '1012', 14.6111, 120.9653),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D4'), 'Tondo II', 'barangay', '1013', 14.6167, 120.9597)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ===== District 5 - Manila =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D5'), 'Malate South', 'barangay', '1004', 14.5600, 120.9900),
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D5'), 'Pasay Border', 'neighborhood', '1300', 14.5500, 120.9900)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ===== District 6 - Manila =====
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MNL-D6'), 'Tondo III', 'barangay', '1014', 14.6200, 120.9550)
ON CONFLICT (zone_id, area_name) DO NOTHING;


-- ============================================================
-- 6. SEED: Zone Areas — Quezon City Sample
-- ============================================================
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D6'), 'Cubao', 'barangay', '1109', 14.6186, 121.0567),
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D6'), 'Immaculate Concepcion', 'barangay', '1111', 14.6200, 121.0500),
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D6'), 'South Triangle', 'barangay', '1103', 14.6361, 121.0375),
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D3'), 'Kamuning', 'barangay', '1103', 14.6325, 121.0425),
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D3'), 'UP Campus', 'barangay', '1101', 14.6538, 121.0689),
((SELECT id FROM public.delivery_zones WHERE code = 'QC-D3'), 'UP Village', 'barangay', '1101', 14.6500, 121.0600)
ON CONFLICT (zone_id, area_name) DO NOTHING;

-- ============================================================
-- 7. SEED: Zone Areas — Makati Sample
-- ============================================================
INSERT INTO public.delivery_zone_areas (zone_id, area_name, area_type, zip_code, latitude, longitude) VALUES
((SELECT id FROM public.delivery_zones WHERE code = 'MKT-D1'), 'Legaspi Village', 'barangay', '1229', 14.5547, 121.0194),
((SELECT id FROM public.delivery_zones WHERE code = 'MKT-D1'), 'Salcedo Village', 'barangay', '1227', 14.5597, 121.0208),
((SELECT id FROM public.delivery_zones WHERE code = 'MKT-D1'), 'San Lorenzo', 'barangay', '1223', 14.5503, 121.0175),
((SELECT id FROM public.delivery_zones WHERE code = 'MKT-D2'), 'Poblacion', 'barangay', '1210', 14.5631, 121.0300),
((SELECT id FROM public.delivery_zones WHERE code = 'MKT-D2'), 'Guadalupe', 'barangay', '1211', 14.5672, 121.0400)
ON CONFLICT (zone_id, area_name) DO NOTHING;


-- ============================================================
-- 8. Utility function: Calculate delivery fee between zones
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_delivery_fee(
    p_merchant_zone_id INTEGER,
    p_customer_barangay VARCHAR
) RETURNS DECIMAL(10, 2) AS $$
DECLARE
    v_merchant_zone RECORD;
    v_customer_zone RECORD;
BEGIN
    -- Get merchant zone
    SELECT * INTO v_merchant_zone FROM public.delivery_zones WHERE id = p_merchant_zone_id;
    IF NOT FOUND THEN
        RETURN 49.00; -- Default fee
    END IF;
    
    -- Find customer's zone by barangay name
    SELECT dz.* INTO v_customer_zone 
    FROM public.delivery_zones dz
    JOIN public.delivery_zone_areas dza ON dza.zone_id = dz.id
    WHERE LOWER(dza.area_name) = LOWER(p_customer_barangay)
    AND dza.is_active = true
    AND dz.is_active = true
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN v_merchant_zone.cross_city_fee; -- Unknown area = cross-city fee
    END IF;
    
    -- Same zone
    IF v_merchant_zone.id = v_customer_zone.id THEN
        RETURN v_merchant_zone.base_delivery_fee;
    END IF;
    
    -- Same city, different zone
    IF v_merchant_zone.city = v_customer_zone.city THEN
        RETURN v_merchant_zone.cross_zone_fee;
    END IF;
    
    -- Different city
    RETURN v_merchant_zone.cross_city_fee;
END;
$$ LANGUAGE plpgsql;
