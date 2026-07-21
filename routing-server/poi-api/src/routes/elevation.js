/**
 * Elevation API — Get elevation for points
 * GET /elevation?points=lat,lng|lat,lng|lat,lng
 * POST /elevation { "points": [[lat,lng],[lat,lng]] }
 *
 * Uses Valhalla height service.
 * Equivalent to Google Maps Elevation API.
 */

const fetch = require('node-fetch');

const VALHALLA_URL = process.env.VALHALLA_URL || 'http://valhalla:8002';

async function elevationHandler(req, res) {
  try {
    let points;

    if (req.method === 'POST' && req.body?.points) {
      points = req.body.points.map(p => ({
        lat: Array.isArray(p) ? p[0] : p.lat,
        lon: Array.isArray(p) ? p[1] : p.lng || p.lon,
      }));
    } else if (req.query.points) {
      points = req.query.points.split('|').map(p => {
        const [lat, lng] = p.split(',').map(Number);
        return { lat, lon: lng };
      });
    }

    if (!points || points.length === 0) {
      return res.status(400).json({
        error: 'Missing required parameter: points',
        usage: {
          GET: 'GET /elevation?points=14.5995,120.9842|14.5547,121.0244',
          POST: 'POST /elevation { "points": [[14.5995,120.9842],[14.5547,121.0244]] }',
        },
      });
    }

    if (points.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 points per request' });
    }

    const valhallaBody = {
      range: points.length > 1,
      shape: points,
    };

    const valhallaRes = await fetch(`${VALHALLA_URL}/height`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valhallaBody),
      timeout: 15000,
    });

    if (!valhallaRes.ok) {
      const errText = await valhallaRes.text().catch(() => 'Unknown error');
      return res.status(502).json({
        status: 'error',
        message: 'Elevation service error',
        detail: errText,
      });
    }

    const valhallaData = await valhallaRes.json();
    const heights = valhallaData.height || [];

    const results = points.map((p, idx) => ({
      location: { lat: p.lat, lng: p.lon },
      elevation: heights[idx] !== undefined ? heights[idx] : null,
      elevation_text: heights[idx] !== undefined ? `${heights[idx]} m` : null,
    }));

    const elevationValues = heights.filter(h => h !== undefined && h !== null);

    res.json({
      status: 'ok',
      count: results.length,
      results,
      summary: elevationValues.length > 0 ? {
        min: Math.min(...elevationValues),
        max: Math.max(...elevationValues),
        avg: Math.round(elevationValues.reduce((a, b) => a + b, 0) / elevationValues.length),
        range: valhallaData.range_height || null,
      } : null,
    });
  } catch (err) {
    console.error('Elevation error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Elevation service timeout' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { elevationHandler };
