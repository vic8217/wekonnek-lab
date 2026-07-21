/**
 * Distance Matrix — OSRM /table proxy
 * GET /matrix?origins=lng,lat;lng,lat&destinations=lng,lat;lng,lat
 * 
 * Returns NxM duration/distance matrix between origin-destination pairs.
 * Equivalent to Google Maps Distance Matrix API.
 */

const fetch = require('node-fetch');

const OSRM_URL = process.env.OSRM_URL || 'http://osrm-backend:5000';

async function matrixHandler(req, res) {
  try {
    const { origins, destinations, profile = 'driving' } = req.query;

    if (!origins) {
      return res.status(400).json({
        error: 'Missing required parameter: origins',
        usage: 'GET /matrix?origins=lng1,lat1;lng2,lat2&destinations=lng3,lat3;lng4,lat4',
        example: '/matrix?origins=120.9842,14.5995;121.0244,14.5547&destinations=121.0,14.55;120.99,14.58',
      });
    }

    const destCoords = destinations || origins;
    const allCoords = destinations
      ? `${origins};${destCoords}`
      : origins;

    const originCount = origins.split(';').length;
    const destCount = destCoords.split(';').length;

    const originIndices = Array.from({ length: originCount }, (_, i) => i);
    const destIndices = destinations
      ? Array.from({ length: destCount }, (_, i) => i + originCount)
      : Array.from({ length: destCount }, (_, i) => i);

    const queryParams = new URLSearchParams();
    queryParams.set('sources', originIndices.join(';'));
    queryParams.set('destinations', destIndices.join(';'));
    queryParams.set('annotations', 'duration,distance');

    const osrmUrl = `${OSRM_URL}/table/v1/${profile}/${allCoords}?${queryParams.toString()}`;

    const osrmRes = await fetch(osrmUrl, { timeout: 15000 });
    const osrmData = await osrmRes.json();

    if (osrmData.code !== 'Ok') {
      return res.status(400).json({
        status: 'error',
        code: osrmData.code,
        message: osrmData.message || 'Matrix computation failed',
      });
    }

    const rows = osrmData.durations.map((durationRow, i) => ({
      origin_index: i,
      origin: osrmData.sources[i] ? {
        name: osrmData.sources[i].name,
        location: { lng: osrmData.sources[i].location[0], lat: osrmData.sources[i].location[1] },
      } : null,
      elements: durationRow.map((duration, j) => ({
        destination_index: j,
        destination: osrmData.destinations[j] ? {
          name: osrmData.destinations[j].name,
          location: { lng: osrmData.destinations[j].location[0], lat: osrmData.destinations[j].location[1] },
        } : null,
        duration: duration !== null ? {
          seconds: Math.round(duration),
          text: formatDuration(duration),
        } : null,
        distance: osrmData.distances && osrmData.distances[i] && osrmData.distances[i][j] !== null ? {
          meters: Math.round(osrmData.distances[i][j]),
          text: formatDistance(osrmData.distances[i][j]),
        } : null,
        status: duration !== null ? 'ok' : 'no_route',
      })),
    }));

    res.json({
      status: 'ok',
      origin_count: originCount,
      destination_count: destCount,
      rows,
    });
  } catch (err) {
    console.error('Matrix error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Matrix computation timeout' });
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

module.exports = { matrixHandler };
