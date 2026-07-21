-- ═══════════════════════════════════════════════
--  Post-Import SQL — Run after POI data load
--  Creates optimized indexes and materialized views
-- ═══════════════════════════════════════════════

-- Refresh spatial indexes
REINDEX INDEX idx_pois_geom;
REINDEX INDEX idx_address_points_geom;

-- Analyze tables for query optimizer
ANALYZE pois;
ANALYZE address_points;

-- Count stats
DO $$
DECLARE
    poi_count BIGINT;
    addr_count BIGINT;
    cat_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO poi_count FROM pois;
    SELECT COUNT(*) INTO addr_count FROM address_points;
    SELECT COUNT(DISTINCT category) INTO cat_count FROM pois;
    
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '  POI Import Stats:';
    RAISE NOTICE '  Total POIs:        %', poi_count;
    RAISE NOTICE '  Address Points:    %', addr_count;
    RAISE NOTICE '  Categories:        %', cat_count;
    RAISE NOTICE '═══════════════════════════════════════';
END $$;
