/**
 * Autocomplete / Place Predictions
 * GET /autocomplete?q=jol&lat=14.5995&lng=120.9842
 *
 * Fast prefix-based search for type-ahead suggestions.
 * Equivalent to Google Maps Places Autocomplete API.
 */

const { query } = require('../db');
const fetch = require('node-fetch');

const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';

async function autocompleteHandler(req, res) {
  try {
    const {
      q,
      lat,
      lng,
      radius,
      types,
      limit = 5,
    } = req.query;

    if (!q || q.trim().length < 1) {
      return res.status(400).json({
        error: 'Missing query parameter: q',
        usage: 'GET /autocomplete?q=jol&lat=14.5995&lng=120.9842',
      });
    }

    const maxResults = Math.min(parseInt(limit), 10);
    const searchTerm = q.trim();

    let photonSuggestions = [];
    try {
      photonSuggestions = await photonAutocomplete(searchTerm, lat, lng, maxResults);
    } catch {
      // Photon unavailable
    }

    const dbSuggestions = await dbAutocomplete(searchTerm, lat, lng, radius, types, maxResults);

    const seen = new Set();
    const merged = [];
    for (const item of [...dbSuggestions, ...photonSuggestions]) {
      const key = item.name?.toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(item);
      if (merged.length >= maxResults) break;
    }

    res.json({
      status: 'ok',
      query: searchTerm,
      predictions: merged,
    });
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function photonAutocomplete(q, lat, lng, limit) {
  const params = new URLSearchParams({ q, limit });
  if (lat && lng) {
    params.set('lat', lat);
    params.set('lon', lng);
  }
  params.set('bbox', '116.0,4.5,127.0,21.5');

  const url = `${PHOTON_URL}/api?${params.toString()}`;
  const resp = await fetch(url, { timeout: 3000 });
  const data = await resp.json();

  return (data.features || []).map(f => {
    const props = f.properties || {};
    const coords = f.geometry?.coordinates || [];
    return {
      place_id: `photon_${props.osm_id || ''}`,
      name: props.name || props.street || 'Unknown',
      description: buildDescription(props),
      location: { lat: coords[1], lng: coords[0] },
      type: props.osm_value || props.type || null,
      source: 'photon',
    };
  });
}

async function dbAutocomplete(searchTerm, lat, lng, radius, types, limit) {
  const hasLocation = lat && lng;
  const params = [`${searchTerm}%`, `%${searchTerm}%`];
  let paramIdx = 3;

  let distanceClause = '';
  let distanceSelect = '';
  let orderBy = 'ORDER BY (CASE WHEN p.name ILIKE $1 THEN 0 ELSE 1 END)';

  if (hasLocation) {
    distanceSelect = `, ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIdx}, $${paramIdx + 1}), 4326)::geography) AS dist`;
    params.push(parseFloat(lng), parseFloat(lat));
    paramIdx += 2;

    if (radius) {
      distanceClause = ` AND ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($${paramIdx - 2}, $${paramIdx - 1}), 4326)::geography, $${paramIdx})`;
      params.push(Math.min(parseInt(radius), 50000));
      paramIdx++;
    }

    orderBy = 'ORDER BY (CASE WHEN p.name ILIKE $1 THEN 0 ELSE 1 END), dist ASC';
  }

  let typeFilter = '';
  if (types) {
    typeFilter = ` AND p.category = $${paramIdx}`;
    params.push(types);
    paramIdx++;
  }

  params.push(limit);

  const sql = `
    SELECT 
      p.id, p.name, p.name_en, p.category, p.subcategory,
      p.lat, p.lng, p.address_full, p.address_city, p.brand,
      pc.display_name as category_display, pc.icon
      ${distanceSelect}
    FROM pois p
    LEFT JOIN poi_categories pc 
      ON p.category = pc.category AND p.subcategory = pc.subcategory
    WHERE p.name IS NOT NULL 
      AND p.name != ''
      AND (p.name ILIKE $1 OR p.name ILIKE $2 OR p.brand ILIKE $1 OR p.brand ILIKE $2)
      ${distanceClause}
      ${typeFilter}
    ${orderBy}
    LIMIT $${paramIdx}
  `;

  const result = await query(sql, params);

  return result.rows.map(row => ({
    place_id: `poi_${row.id}`,
    name: row.name,
    description: [
      row.category_display || row.subcategory,
      row.address_city,
      row.dist ? `${formatDistance(row.dist)}` : null,
    ].filter(Boolean).join(' · '),
    location: { lat: row.lat, lng: row.lng },
    category: row.category,
    subcategory: row.subcategory,
    icon: row.icon,
    type: row.subcategory || row.category,
    source: 'local',
  }));
}

function buildDescription(props) {
  const parts = [];
  if (props.street) parts.push(props.street);
  if (props.city || props.locality) parts.push(props.city || props.locality);
  if (props.state) parts.push(props.state);
  return parts.join(', ') || null;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

module.exports = { autocompleteHandler };
