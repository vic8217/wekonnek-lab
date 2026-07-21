/**
 * Map Matching / Snap-to-Road — OSRM /match proxy
 * POST /match
 * Body: { coordinates: [[lng,lat],...], timestamps: [...], radiuses: [...] }
 *
 * Snaps GPS traces to the road network.
 * Equivalent to Google Maps Roads API (Snap to Roads).
 */

const fetch = require('node-fetch');

const OSRM_URL = process.env.OSRM_URL || 'http://osrm-backend:5000';

async function matchHandler(req, res) {
  try {
    let coordinates, timestamps, radiuses, profile, overview, geometries, steps, gaps, tidy;

    if (req.method === 'POST' && req.body) {
      ({ coordinates, timestamps, radiuses, profile = 'driving', overview, geometries, steps, gaps, tidy } = req.body);
    } else {
      coordinates = req.query.coordinates;
      profile = req.query.profile || 'driving';
      overview = req.query.overview;
      geometries = req.query.geometries;
      steps = req.query.steps;
      gaps = req.query.gaps;
      tidy = req.query.tidy;
      timestamps = req.query.timestamps;
      radiuses = req.query.radiuses;
    }

    if (!coordinates) {
      return res.status(400).json({
        error: 'Missing required parameter: coordinates',
        usage: {
          GET: 'GET /match?coordinates=lng1,lat1;lng2,lat2;lng3,lat3',
          POST: 'POST /match { "coordinates": [[lng1,lat1],[lng2,lat2],[lng3,lat3]] }',
        },
        example: '/match?coordinates=120.9842,14.5995;120.985,14.600;120.986,14.601',
      });
    }

    let coordString;
    if (Array.isArray(coordinates)) {
      coordString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
    } else {
      coordString = coordinates;
    }

    const queryParams = new URLSearchParams();
    queryParams.set('overview', overview || 'full');
    queryParams.set('geometries', geometries || 'geojson');

    if (steps) queryParams.set('steps', steps);
    if (gaps) queryParams.set('gaps', gaps);
    if (tidy) queryParams.set('tidy', tidy);
    if (timestamps) {
      queryParams.set('timestamps', Array.isArray(timestamps) ? timestamps.join(';') : timestamps);
    }
    if (radiuses) {
      queryParams.set('radiuses', Array.isArray(radiuses) ? radiuses.join(';') : radiuses);
    }

    const osrmUrl = `${OSRM_URL}/match/v1/${profile}/${coordString}?${queryParams.toString()}`;
    const osrmRes = await fetch(osrmUrl, { timeout: 15000 });
    const osrmData = await osrmRes.json();

    if (osrmData.code !== 'Ok') {
      return res.status(400).json({
        status: 'error',
        code: osrmData.code,
        message: osrmData.message || 'Map matching failed',
      });
    }

    const matchings = osrmData.matchings?.map((matching, idx) => ({
      match_index: idx,
      confidence: matching.confidence,
      distance: {
        meters: Math.round(matching.distance),
        text: formatDistance(matching.distance),
      },
      duration: {
        seconds: Math.round(matching.duration),
        text: formatDuration(matching.duration),
      },
      geometry: matching.geometry,
      legs: matching.legs?.map(leg => ({
        distance: { meters: Math.round(leg.distance), text: formatDistance(leg.distance) },
        duration: { seconds: Math.round(leg.duration), text: formatDuration(leg.duration) },
        steps: leg.steps?.map(step => ({
          distance: { meters: Math.round(step.distance), text: formatDistance(step.distance) },
          duration: { seconds: Math.round(step.duration), text: formatDuration(step.duration) },
          name: step.name || '',
          maneuver: step.maneuver,
          geometry: step.geometry,
        })),
        summary: leg.summary,
      })),
    }));

    const tracepoints = osrmData.tracepoints?.map((tp, idx) => {
      if (!tp) return { index: idx, status: 'unmatched' };
      return {
        index: idx,
        status: 'matched',
        name: tp.name,
        location: { lng: tp.location[0], lat: tp.location[1] },
        matchings_index: tp.matchings_index,
        waypoint_index: tp.waypoint_index,
        alternatives_count: tp.alternatives_count,
      };
    });

    res.json({
      status: 'ok',
      matchings,
      tracepoints,
    });
  } catch (err) {
    console.error('Match error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Map matching timeout' });
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

module.exports = { matchHandler };
