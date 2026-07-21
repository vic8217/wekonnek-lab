/**
 * ═══════════════════════════════════════════════
 *  Reverse Geocoding Endpoint
 *  GET /reverse?lat=...&lng=...
 *  Returns nearest address label from OSM data
 * ═══════════════════════════════════════════════
 */

const { query } = require('../db');

async function reverseHandler(req, res) {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing required parameters: lat, lng',
        usage: 'GET /reverse?lat=14.5995&lng=120.9842',
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    // Strategy 1: Try address_points table first (most precise)
    const addressResult = await query(`
      SELECT 
        house_number,
        street,
        barangay,
        city,
        province,
        region,
        postcode,
        full_address,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
      FROM address_points
      WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        500  -- Search within 500m
      )
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1
    `, [longitude, latitude]);

    if (addressResult.rows.length > 0) {
      const addr = addressResult.rows[0];
      return res.json({
        status: 'ok',
        location: { lat: latitude, lng: longitude },
        address: {
          full: addr.full_address || buildAddress(addr),
          house_number: addr.house_number,
          street: addr.street,
          barangay: addr.barangay,
          city: addr.city,
          province: addr.province,
          region: addr.region,
          postcode: addr.postcode,
        },
        distance_meters: Math.round(addr.distance_meters),
        source: 'address_point',
      });
    }

    // Strategy 2: Find nearest named POI as fallback
    const poiResult = await query(`
      SELECT 
        name,
        category,
        address_full,
        address_street,
        address_city,
        address_province,
        lat,
        lng,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
      FROM pois
      WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        1000  -- Search within 1km
      )
      AND name IS NOT NULL
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1
    `, [longitude, latitude]);

    if (poiResult.rows.length > 0) {
      const poi = poiResult.rows[0];
      return res.json({
        status: 'ok',
        location: { lat: latitude, lng: longitude },
        address: {
          full: poi.address_full || `Near ${poi.name}`,
          street: poi.address_street,
          city: poi.address_city,
          province: poi.address_province,
          nearby_landmark: poi.name,
        },
        distance_meters: Math.round(poi.distance_meters),
        source: 'nearest_poi',
      });
    }

    // Strategy 3: No result found
    return res.json({
      status: 'ok',
      location: { lat: latitude, lng: longitude },
      address: {
        full: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      },
      distance_meters: null,
      source: 'coordinates_only',
    });
  } catch (err) {
    console.error('Reverse geocoding error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function buildAddress(addr) {
  const parts = [];
  if (addr.house_number) parts.push(addr.house_number);
  if (addr.street) parts.push(addr.street);
  if (addr.barangay) parts.push(`Brgy. ${addr.barangay}`);
  if (addr.city) parts.push(addr.city);
  if (addr.province) parts.push(addr.province);
  return parts.join(', ') || 'Unknown location';
}

module.exports = { reverseHandler };
