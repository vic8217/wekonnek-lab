/**
 * Place Details — Get full POI info by ID
 * GET /place/:id
 *
 * Equivalent to Google Maps Places Details API.
 */

const { query } = require('../db');

async function placeHandler(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: 'Missing place ID',
        usage: 'GET /place/12345',
      });
    }

    const numericId = parseInt(id);
    if (isNaN(numericId)) {
      return res.status(400).json({ error: 'Invalid place ID — must be numeric' });
    }

    const result = await query(`
      SELECT 
        p.id,
        p.osm_id,
        p.osm_type,
        p.name,
        p.name_en,
        p.name_local,
        p.category,
        p.subcategory,
        p.lat,
        p.lng,
        p.address_street,
        p.address_city,
        p.address_province,
        p.address_postcode,
        p.address_full,
        p.phone,
        p.website,
        p.opening_hours,
        p.cuisine,
        p.brand,
        p.tags,
        p.created_at,
        p.updated_at,
        pc.display_name as category_display,
        pc.icon as category_icon
      FROM pois p
      LEFT JOIN poi_categories pc 
        ON p.category = pc.category AND p.subcategory = pc.subcategory
      WHERE p.id = $1
    `, [numericId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        error: 'Place not found',
      });
    }

    const row = result.rows[0];

    const nearbyResult = await query(`
      SELECT 
        p.id, p.name, p.category, p.subcategory, p.lat, p.lng,
        ST_Distance(
          p.geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
      FROM pois p
      WHERE p.id != $3
        AND p.name IS NOT NULL
        AND ST_DWithin(
          p.geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          500
        )
      ORDER BY distance_meters ASC
      LIMIT 5
    `, [row.lng, row.lat, numericId]);

    const place = {
      id: row.id,
      osm_id: row.osm_id,
      osm_type: row.osm_type,
      name: row.name,
      name_en: row.name_en,
      name_local: row.name_local,
      category: row.category,
      subcategory: row.subcategory,
      category_display: row.category_display,
      icon: row.category_icon,
      location: {
        lat: row.lat,
        lng: row.lng,
      },
      address: {
        full: row.address_full,
        street: row.address_street,
        city: row.address_city,
        province: row.address_province,
        postcode: row.address_postcode,
      },
      contact: {
        phone: row.phone,
        website: row.website,
      },
      details: {
        opening_hours: row.opening_hours,
        cuisine: row.cuisine,
        brand: row.brand,
        tags: row.tags || {},
      },
      nearby: nearbyResult.rows.map(n => ({
        id: n.id,
        name: n.name,
        category: n.category,
        location: { lat: n.lat, lng: n.lng },
        distance: {
          meters: Math.round(n.distance_meters),
          text: formatDistance(n.distance_meters),
        },
      })),
      metadata: {
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    };

    res.json({
      status: 'ok',
      place,
    });
  } catch (err) {
    console.error('Place details error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

module.exports = { placeHandler };
