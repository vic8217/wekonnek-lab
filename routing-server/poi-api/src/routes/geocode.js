/**
 * Forward Geocoding — Text to coordinates
 * GET /geocode?q=Jollibee+Taft+Manila
 *
 * Searches POIs and address_points using PostGIS trigram fuzzy matching.
 * Equivalent to Google Maps Geocoding API (forward).
 */

const { query } = require('../db');
const fetch = require('node-fetch');

const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';

async function geocodeHandler(req, res) {
  try {
    const {
      q,
      lat,
      lng,
      limit = 5,
      lang = 'en',
    } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        error: 'Missing or too short query parameter: q (min 2 characters)',
        usage: 'GET /geocode?q=Jollibee+Manila&lat=14.5995&lng=120.9842',
      });
    }

    const maxResults = Math.min(parseInt(limit), 20);
    const searchTerm = q.trim();

    let photonResults = [];
    try {
      photonResults = await searchPhoton(searchTerm, lat, lng, lang, maxResults);
    } catch {
      // Photon unavailable — fall back to PostGIS only
    }

    const dbResults = await searchPostGIS(searchTerm, lat, lng, maxResults);

    const merged = mergeAndDedup(photonResults, dbResults, maxResults);

    res.json({
      status: 'ok',
      query: searchTerm,
      count: merged.length,
      results: merged,
    });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function searchPhoton(q, lat, lng, lang, limit) {
  const params = new URLSearchParams({ q, limit, lang });
  if (lat && lng) {
    params.set('lat', lat);
    params.set('lon', lng);
  }
  params.set('bbox', '116.0,4.5,127.0,21.5');

  const url = `${PHOTON_URL}/api?${params.toString()}`;
  const resp = await fetch(url, { timeout: 5000 });
  const data = await resp.json();

  return (data.features || []).map(f => {
    const props = f.properties || {};
    const coords = f.geometry?.coordinates || [];
    return {
      source: 'photon',
      name: props.name || null,
      display_name: buildPhotonDisplayName(props),
      location: { lat: coords[1], lng: coords[0] },
      address: {
        house_number: props.housenumber || null,
        street: props.street || null,
        city: props.city || props.locality || null,
        state: props.state || null,
        country: props.country || null,
        postcode: props.postcode || null,
      },
      type: props.osm_value || props.type || null,
      osm_id: props.osm_id || null,
      confidence: 0.9,
    };
  });
}

async function searchPostGIS(searchTerm, lat, lng, limit) {
  const hasLocation = lat && lng;
  const distanceSelect = hasLocation
    ? `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS dist`
    : '';
  const orderBy = hasLocation
    ? 'ORDER BY similarity DESC, dist ASC'
    : 'ORDER BY similarity DESC';

  const params = [`%${searchTerm}%`];
  if (hasLocation) {
    params.push(parseFloat(lng), parseFloat(lat));
  }

  const paramOffset = params.length + 1;

  const sql = `
    (
      SELECT 
        'poi' as source_type,
        p.id, p.name, p.name_en, p.category, p.subcategory,
        p.lat, p.lng,
        p.address_full, p.address_street, p.address_city,
        p.phone, p.website, p.brand,
        GREATEST(
          similarity(COALESCE(p.name,''), $1),
          similarity(COALESCE(p.name_en,''), $1),
          similarity(COALESCE(p.brand,''), $1),
          similarity(COALESCE(p.address_full,''), $1)
        ) AS similarity
        ${distanceSelect}
      FROM pois p
      WHERE (
        p.name ILIKE $1 OR p.name_en ILIKE $1
        OR p.brand ILIKE $1 OR p.address_full ILIKE $1
      )
      AND p.name IS NOT NULL
      LIMIT $${paramOffset}
    )
    UNION ALL
    (
      SELECT 
        'address' as source_type,
        a.id, a.full_address as name, NULL as name_en, 
        'address' as category, NULL as subcategory,
        ST_Y(a.geom) as lat, ST_X(a.geom) as lng,
        a.full_address as address_full, a.street as address_street, a.city as address_city,
        NULL as phone, NULL as website, NULL as brand,
        GREATEST(
          similarity(COALESCE(a.full_address,''), $1),
          similarity(COALESCE(a.street,''), $1),
          similarity(COALESCE(a.city,''), $1)
        ) AS similarity
        ${hasLocation ? `, ST_Distance(a.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS dist` : ''}
      FROM address_points a
      WHERE (
        a.full_address ILIKE $1 OR a.street ILIKE $1 OR a.city ILIKE $1
      )
      LIMIT $${paramOffset}
    )
    ${orderBy}
    LIMIT $${paramOffset}
  `;

  params.push(limit);

  const result = await query(sql, params);

  return result.rows.map(row => ({
    source: 'postgis',
    name: row.name,
    display_name: row.address_full || row.name,
    location: { lat: row.lat, lng: row.lng },
    address: {
      street: row.address_street || null,
      city: row.address_city || null,
    },
    type: row.source_type === 'address' ? 'address' : row.subcategory || row.category,
    category: row.category,
    phone: row.phone,
    website: row.website,
    brand: row.brand,
    confidence: parseFloat(row.similarity) || 0,
  }));
}

function mergeAndDedup(photonResults, dbResults, limit) {
  const seen = new Set();
  const merged = [];

  const all = [...photonResults, ...dbResults]
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  for (const item of all) {
    const key = `${(item.location?.lat || 0).toFixed(4)},${(item.location?.lng || 0).toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= limit) break;
  }

  return merged;
}

function buildPhotonDisplayName(props) {
  const parts = [];
  if (props.name) parts.push(props.name);
  if (props.housenumber && props.street) parts.push(`${props.housenumber} ${props.street}`);
  else if (props.street) parts.push(props.street);
  if (props.city || props.locality) parts.push(props.city || props.locality);
  if (props.state) parts.push(props.state);
  return parts.join(', ') || 'Unknown';
}

module.exports = { geocodeHandler };
