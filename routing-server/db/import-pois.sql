-- ═══════════════════════════════════════════════
--  Fallback POI Import — From osm2pgsql planet tables
--  Run after osm2pgsql import into default tables
-- ═══════════════════════════════════════════════

-- Import amenity POIs
INSERT INTO pois (osm_id, osm_type, name, name_en, category, subcategory, geom, lat, lng,
    address_street, address_city, address_province, address_postcode,
    phone, website, opening_hours, cuisine, brand, tags)
SELECT
    osm_id,
    'node',
    tags->'name',
    tags->'name:en',
    CASE
        WHEN tags->'amenity' IN ('restaurant','fast_food','cafe','bar','food_court','ice_cream') THEN 'food'
        WHEN tags->'amenity' IN ('hospital','clinic','dentist','pharmacy') THEN 'health'
        WHEN tags->'amenity' IN ('fuel','parking','bus_station') THEN 'transport'
        WHEN tags->'amenity' IN ('bank','atm','money_transfer') THEN 'finance'
        WHEN tags->'amenity' IN ('school','university','library') THEN 'education'
        WHEN tags->'amenity' IN ('townhall','police','fire_station','post_office') THEN 'government'
        WHEN tags->'amenity' = 'place_of_worship' THEN 'religion'
        ELSE 'other'
    END,
    tags->'amenity',
    way,
    ST_Y(ST_Transform(way, 4326)),
    ST_X(ST_Transform(way, 4326)),
    tags->'addr:street',
    tags->'addr:city',
    tags->'addr:province',
    tags->'addr:postcode',
    tags->'phone',
    tags->'website',
    tags->'opening_hours',
    tags->'cuisine',
    COALESCE(tags->'brand', tags->'operator'),
    tags
FROM planet_osm_point
WHERE tags->'amenity' IS NOT NULL
ON CONFLICT DO NOTHING;

-- Import shop POIs
INSERT INTO pois (osm_id, osm_type, name, name_en, category, subcategory, geom, lat, lng,
    address_street, address_city, address_province, address_postcode,
    phone, website, opening_hours, brand, tags)
SELECT
    osm_id,
    'node',
    tags->'name',
    tags->'name:en',
    CASE
        WHEN tags->'shop' = 'pharmacy' THEN 'health'
        ELSE 'shopping'
    END,
    tags->'shop',
    way,
    ST_Y(ST_Transform(way, 4326)),
    ST_X(ST_Transform(way, 4326)),
    tags->'addr:street',
    tags->'addr:city',
    tags->'addr:province',
    tags->'addr:postcode',
    tags->'phone',
    tags->'website',
    tags->'opening_hours',
    COALESCE(tags->'brand', tags->'operator'),
    tags
FROM planet_osm_point
WHERE tags->'shop' IS NOT NULL
ON CONFLICT DO NOTHING;

-- Import tourism POIs
INSERT INTO pois (osm_id, osm_type, name, name_en, category, subcategory, geom, lat, lng,
    address_street, address_city, phone, website, tags)
SELECT
    osm_id,
    'node',
    tags->'name',
    tags->'name:en',
    CASE
        WHEN tags->'tourism' IN ('hotel','guest_house','hostel') THEN 'accommodation'
        ELSE 'tourism'
    END,
    tags->'tourism',
    way,
    ST_Y(ST_Transform(way, 4326)),
    ST_X(ST_Transform(way, 4326)),
    tags->'addr:street',
    tags->'addr:city',
    tags->'phone',
    tags->'website',
    tags
FROM planet_osm_point
WHERE tags->'tourism' IS NOT NULL
ON CONFLICT DO NOTHING;

-- Import address points for reverse geocoding
INSERT INTO address_points (osm_id, geom, house_number, street, city, province, postcode)
SELECT
    osm_id,
    way,
    tags->'addr:housenumber',
    tags->'addr:street',
    tags->'addr:city',
    tags->'addr:province',
    tags->'addr:postcode'
FROM planet_osm_point
WHERE tags->'addr:street' IS NOT NULL
ON CONFLICT DO NOTHING;

-- Build full address
UPDATE address_points SET full_address = CONCAT_WS(', ',
    NULLIF(house_number, ''),
    NULLIF(street, ''),
    NULLIF(city, ''),
    NULLIF(province, '')
) WHERE full_address IS NULL;
