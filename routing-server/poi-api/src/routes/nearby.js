/**
 * ═══════════════════════════════════════════════
 *  Nearby POI Search Endpoint
 *  GET /nearby?lat=...&lng=...&radius=...&category=...&q=...
 * ═══════════════════════════════════════════════
 */

const { query } = require('../db');

async function nearbyHandler(req, res) {
  try {
    const {
      lat,
      lng,
      radius = 1000,    // meters (default 1km)
      category,          // food, shopping, health, transport, finance, etc.
      subcategory,       // restaurant, fast_food, cafe, etc.
      q,                 // keyword search
      limit = 20,        // max results
      offset = 0,
    } = req.query;

    // Validate required params
    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing required parameters: lat, lng',
        usage: 'GET /nearby?lat=14.5995&lng=120.9842&radius=1000&category=food&q=jollibee',
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusMeters = Math.min(parseInt(radius), 50000); // Max 50km
    const maxResults = Math.min(parseInt(limit), 100);

    // Validate coordinates are in Philippines range
    if (latitude < 4.5 || latitude > 21.5 || longitude < 116 || longitude > 127) {
      return res.status(400).json({
        error: 'Coordinates must be within the Philippines',
        bounds: { lat: [4.5, 21.5], lng: [116, 127] },
      });
    }

    // Build query
    let sql = `
      SELECT 
        p.id,
        p.osm_id,
        p.name,
        p.name_en,
        p.category,
        p.subcategory,
        p.lat,
        p.lng,
        p.address_full,
        p.address_street,
        p.address_city,
        p.phone,
        p.website,
        p.opening_hours,
        p.cuisine,
        p.brand,
        pc.display_name as category_display,
        pc.icon as category_icon,
        ST_Distance(
          p.geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
      FROM pois p
      LEFT JOIN poi_categories pc 
        ON p.category = pc.category AND p.subcategory = pc.subcategory
      WHERE ST_DWithin(
        p.geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
    `;

    const params = [longitude, latitude, radiusMeters];
    let paramIdx = 4;

    // Category filter
    if (category) {
      sql += ` AND p.category = $${paramIdx}`;
      params.push(category);
      paramIdx++;
    }

    // Subcategory filter
    if (subcategory) {
      sql += ` AND p.subcategory = $${paramIdx}`;
      params.push(subcategory);
      paramIdx++;
    }

    // Keyword search (fuzzy)
    if (q) {
      sql += ` AND (
        p.name ILIKE $${paramIdx}
        OR p.name_en ILIKE $${paramIdx}
        OR p.brand ILIKE $${paramIdx}
        OR p.cuisine ILIKE $${paramIdx}
      )`;
      params.push(`%${q}%`);
      paramIdx++;
    }

    // Filter out unnamed POIs unless searching by keyword
    if (!q) {
      sql += ` AND p.name IS NOT NULL AND p.name != ''`;
    }

    // Order by distance
    sql += ` ORDER BY distance_meters ASC`;
    sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(maxResults, parseInt(offset));

    const result = await query(sql, params);

    // Format response
    const pois = result.rows.map(row => ({
      id: row.id,
      osm_id: row.osm_id,
      name: row.name,
      name_en: row.name_en,
      category: row.category,
      subcategory: row.subcategory,
      category_display: row.category_display,
      icon: row.category_icon,
      location: {
        lat: row.lat,
        lng: row.lng,
      },
      distance: {
        meters: Math.round(row.distance_meters),
        text: formatDistance(row.distance_meters),
      },
      address: row.address_full || row.address_street || null,
      city: row.address_city,
      phone: row.phone,
      website: row.website,
      opening_hours: row.opening_hours,
      cuisine: row.cuisine,
      brand: row.brand,
    }));

    res.json({
      status: 'ok',
      count: pois.length,
      center: { lat: latitude, lng: longitude },
      radius: radiusMeters,
      results: pois,
    });
  } catch (err) {
    console.error('Nearby search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

module.exports = { nearbyHandler };
