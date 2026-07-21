-- ═══════════════════════════════════════════════
--  WeKonnek POI Database — Initial Schema
--  PostGIS-enabled for spatial queries
-- ═══════════════════════════════════════════════

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS unaccent;   -- For accent-insensitive search

-- ─── POI Categories (OSM mapping) ─────────────
CREATE TABLE IF NOT EXISTS poi_categories (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL,       -- OSM tag key (e.g., 'amenity', 'shop')
    value VARCHAR(100) NOT NULL,     -- OSM tag value (e.g., 'restaurant', 'supermarket')
    category VARCHAR(100) NOT NULL,  -- Our unified category
    subcategory VARCHAR(100),
    display_name VARCHAR(200),
    icon VARCHAR(100),
    UNIQUE(key, value)
);

-- ─── POIs (Points of Interest) ────────────────
CREATE TABLE IF NOT EXISTS pois (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT,
    osm_type VARCHAR(10),           -- 'node', 'way', 'relation'
    name VARCHAR(500),
    name_en VARCHAR(500),           -- English name
    name_local VARCHAR(500),        -- Filipino / local name
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    
    -- Location
    geom GEOMETRY(Point, 4326) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    
    -- Address info
    address_street VARCHAR(500),
    address_city VARCHAR(200),
    address_province VARCHAR(200),
    address_postcode VARCHAR(20),
    address_full VARCHAR(1000),
    
    -- Metadata
    phone VARCHAR(100),
    website VARCHAR(500),
    opening_hours VARCHAR(500),
    cuisine VARCHAR(300),           -- For restaurants
    brand VARCHAR(200),
    tags JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── Reverse Geocoding Data ───────────────────
CREATE TABLE IF NOT EXISTS address_points (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT,
    geom GEOMETRY(Point, 4326) NOT NULL,
    house_number VARCHAR(50),
    street VARCHAR(500),
    barangay VARCHAR(200),          -- PH-specific
    city VARCHAR(200),
    province VARCHAR(200),
    region VARCHAR(200),
    postcode VARCHAR(20),
    full_address VARCHAR(1000),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ─── Spatial Indexes ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_pois_geom ON pois USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_pois_category ON pois(category);
CREATE INDEX IF NOT EXISTS idx_pois_subcategory ON pois(subcategory);
CREATE INDEX IF NOT EXISTS idx_pois_name_trgm ON pois USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pois_name_en_trgm ON pois USING GIN(name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pois_brand ON pois(brand);

CREATE INDEX IF NOT EXISTS idx_address_points_geom ON address_points USING GIST(geom);

-- ─── Seed Category Mappings ───────────────────
INSERT INTO poi_categories (key, value, category, subcategory, display_name, icon) VALUES
    -- Food & Drink
    ('amenity', 'restaurant', 'food', 'restaurant', 'Restaurant', 'restaurant'),
    ('amenity', 'fast_food', 'food', 'fast_food', 'Fast Food', 'fastfood'),
    ('amenity', 'cafe', 'food', 'cafe', 'Cafe', 'cafe'),
    ('amenity', 'bar', 'food', 'bar', 'Bar', 'local_bar'),
    ('amenity', 'food_court', 'food', 'food_court', 'Food Court', 'restaurant'),
    ('amenity', 'ice_cream', 'food', 'ice_cream', 'Ice Cream', 'icecream'),
    ('amenity', 'bakery', 'food', 'bakery', 'Bakery', 'bakery_dining'),
    
    -- Shopping
    ('shop', 'supermarket', 'shopping', 'supermarket', 'Supermarket', 'shopping_cart'),
    ('shop', 'convenience', 'shopping', 'convenience', 'Convenience Store', 'store'),
    ('shop', 'mall', 'shopping', 'mall', 'Mall / Shopping Center', 'local_mall'),
    ('shop', 'department_store', 'shopping', 'department_store', 'Department Store', 'store'),
    ('shop', 'clothes', 'shopping', 'clothes', 'Clothing Store', 'checkroom'),
    ('shop', 'electronics', 'shopping', 'electronics', 'Electronics', 'devices'),
    ('shop', 'pharmacy', 'health', 'pharmacy', 'Pharmacy', 'local_pharmacy'),
    ('shop', 'hardware', 'shopping', 'hardware', 'Hardware Store', 'hardware'),
    
    -- Health
    ('amenity', 'hospital', 'health', 'hospital', 'Hospital', 'local_hospital'),
    ('amenity', 'clinic', 'health', 'clinic', 'Clinic', 'medical_services'),
    ('amenity', 'dentist', 'health', 'dentist', 'Dentist', 'dentistry'),
    ('amenity', 'pharmacy', 'health', 'pharmacy', 'Pharmacy', 'local_pharmacy'),
    
    -- Transport
    ('amenity', 'fuel', 'transport', 'gas_station', 'Gas Station', 'local_gas_station'),
    ('amenity', 'parking', 'transport', 'parking', 'Parking', 'local_parking'),
    ('amenity', 'bus_station', 'transport', 'bus_station', 'Bus Station', 'directions_bus'),
    ('railway', 'station', 'transport', 'train_station', 'Train Station', 'train'),
    
    -- Finance
    ('amenity', 'bank', 'finance', 'bank', 'Bank', 'account_balance'),
    ('amenity', 'atm', 'finance', 'atm', 'ATM', 'atm'),
    ('amenity', 'money_transfer', 'finance', 'remittance', 'Remittance / Money Transfer', 'payments'),
    
    -- Tourism & Landmarks
    ('tourism', 'hotel', 'accommodation', 'hotel', 'Hotel', 'hotel'),
    ('tourism', 'guest_house', 'accommodation', 'guest_house', 'Guest House', 'house'),
    ('tourism', 'attraction', 'tourism', 'attraction', 'Tourist Attraction', 'attractions'),
    ('tourism', 'museum', 'tourism', 'museum', 'Museum', 'museum'),
    ('amenity', 'place_of_worship', 'religion', 'church', 'Place of Worship', 'church'),
    
    -- Education
    ('amenity', 'school', 'education', 'school', 'School', 'school'),
    ('amenity', 'university', 'education', 'university', 'University', 'school'),
    ('amenity', 'library', 'education', 'library', 'Library', 'local_library'),
    
    -- Government
    ('amenity', 'townhall', 'government', 'city_hall', 'City/Town Hall', 'account_balance'),
    ('amenity', 'police', 'government', 'police', 'Police Station', 'local_police'),
    ('amenity', 'fire_station', 'government', 'fire_station', 'Fire Station', 'fire_truck'),
    ('amenity', 'post_office', 'government', 'post_office', 'Post Office', 'local_post_office')
ON CONFLICT (key, value) DO NOTHING;

-- ─── Useful view ──────────────────────────────
CREATE OR REPLACE VIEW v_pois_with_category AS
SELECT 
    p.*,
    pc.display_name as category_display,
    pc.icon as category_icon
FROM pois p
LEFT JOIN poi_categories pc ON p.category = pc.category AND p.subcategory = pc.subcategory;
