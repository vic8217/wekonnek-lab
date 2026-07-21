/**
 * Isochrone — Reachable area polygons
 * GET /isochrone?lat=14.5995&lng=120.9842&range=600&mode=driving
 *
 * Returns polygon(s) showing the area reachable within a given time/distance.
 * Uses Valhalla isochrone service.
 * No direct Google Maps equivalent (premium feature in Google OR Tools).
 */

const fetch = require('node-fetch');

const VALHALLA_URL = process.env.VALHALLA_URL || 'http://valhalla:8002';

const COSTING_MAP = {
  driving: 'auto',
  walking: 'pedestrian',
  cycling: 'bicycle',
  motorcycle: 'motorcycle',
};

async function isochroneHandler(req, res) {
  try {
    const {
      lat,
      lng,
      range = '600',
      mode = 'driving',
      metric = 'time',
      denoise = '0.5',
      generalize = '120',
      polygons = 'true',
    } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing required parameters: lat, lng',
        usage: 'GET /isochrone?lat=14.5995&lng=120.9842&range=300,600,900&mode=driving',
        params: {
          range: 'Comma-separated seconds (time) or meters (distance). E.g. 300,600,900',
          mode: 'driving|walking|cycling|motorcycle',
          metric: 'time (seconds) or distance (meters)',
          denoise: '0-1, smoothing factor (default 0.5)',
          generalize: 'Simplification tolerance in meters (default 120)',
          polygons: 'true|false — return polygons or lines',
        },
      });
    }

    const costing = COSTING_MAP[mode] || 'auto';
    const ranges = range.split(',').map(r => parseInt(r.trim())).filter(r => r > 0);

    if (ranges.length === 0) {
      return res.status(400).json({ error: 'Invalid range values' });
    }

    const maxRange = metric === 'distance' ? 100000 : 7200; // 100km or 2hr max
    const clampedRanges = ranges.map(r => Math.min(r, maxRange));

    const valhallaBody = {
      locations: [{ lat: parseFloat(lat), lon: parseFloat(lng) }],
      costing,
      contours: clampedRanges.map(r => ({
        [metric]: r,
      })),
      denoise: parseFloat(denoise),
      generalize: parseInt(generalize),
      polygons: polygons === 'true',
    };

    const valhallaRes = await fetch(`${VALHALLA_URL}/isochrone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valhallaBody),
      timeout: 30000,
    });

    if (!valhallaRes.ok) {
      const errText = await valhallaRes.text().catch(() => 'Unknown error');
      return res.status(502).json({
        status: 'error',
        message: 'Isochrone service error',
        detail: errText,
      });
    }

    const valhallaData = await valhallaRes.json();

    const isochrones = (valhallaData.features || []).map((feature, idx) => {
      const props = feature.properties || {};
      return {
        index: idx,
        mode,
        metric,
        value: props.contour || clampedRanges[idx],
        label: metric === 'time'
          ? formatDuration(props.contour || clampedRanges[idx])
          : formatDistance(props.contour || clampedRanges[idx]),
        color: props.color || getColor(idx),
        opacity: props.opacity || Math.max(0.15, 0.5 - idx * 0.1),
        geometry: feature.geometry,
      };
    });

    res.json({
      status: 'ok',
      center: { lat: parseFloat(lat), lng: parseFloat(lng) },
      mode,
      metric,
      isochrones,
      geojson: valhallaData,
    });
  } catch (err) {
    console.error('Isochrone error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Isochrone computation timeout' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours} hr ${mins} min`;
}

const COLORS = ['#ff4444', '#ff8800', '#ffcc00', '#44bb44', '#4488ff'];
function getColor(idx) {
  return COLORS[idx % COLORS.length];
}

module.exports = { isochroneHandler };
