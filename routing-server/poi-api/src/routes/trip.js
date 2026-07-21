/**
 * Trip Optimization — OSRM /trip proxy
 * GET /trip?coordinates=lng,lat;lng,lat;lng,lat
 *
 * Solves the Travelling Salesman Problem — finds optimal visit order
 * for a set of waypoints. Equivalent to Google Maps Route Optimization API.
 */

const fetch = require('node-fetch');

const OSRM_URL = process.env.OSRM_URL || 'http://osrm-backend:5000';

async function tripHandler(req, res) {
  try {
    const {
      coordinates,
      profile = 'driving',
      roundtrip = 'true',
      source: tripSource = 'any',
      destination: tripDest = 'any',
      overview,
      geometries,
      steps,
    } = req.query;

    if (!coordinates) {
      return res.status(400).json({
        error: 'Missing required parameter: coordinates',
        usage: 'GET /trip?coordinates=lng1,lat1;lng2,lat2;lng3,lat3',
        example: '/trip?coordinates=120.9842,14.5995;121.0244,14.5547;121.0,14.58&roundtrip=false&source=first&destination=last',
        params: {
          roundtrip: 'true|false — return to start (default: true)',
          source: 'any|first — fix start point (default: any)',
          destination: 'any|last — fix end point (default: any)',
          steps: 'true|false — include turn-by-turn (default: false)',
        },
      });
    }

    const waypointCount = coordinates.split(';').length;
    if (waypointCount < 2) {
      return res.status(400).json({ error: 'Need at least 2 waypoints for trip optimization' });
    }
    if (waypointCount > 100) {
      return res.status(400).json({ error: 'Maximum 100 waypoints supported' });
    }

    const queryParams = new URLSearchParams();
    queryParams.set('roundtrip', roundtrip);
    queryParams.set('source', tripSource);
    queryParams.set('destination', tripDest);
    queryParams.set('overview', overview || 'full');
    queryParams.set('geometries', geometries || 'polyline');
    if (steps) queryParams.set('steps', steps);

    const osrmUrl = `${OSRM_URL}/trip/v1/${profile}/${coordinates}?${queryParams.toString()}`;
    const osrmRes = await fetch(osrmUrl, { timeout: 30000 });
    const osrmData = await osrmRes.json();

    if (osrmData.code !== 'Ok') {
      return res.status(400).json({
        status: 'error',
        code: osrmData.code,
        message: osrmData.message || 'Trip optimization failed',
      });
    }

    const trips = osrmData.trips?.map((trip, idx) => ({
      trip_index: idx,
      distance: {
        meters: Math.round(trip.distance),
        km: (trip.distance / 1000).toFixed(1),
        text: formatDistance(trip.distance),
      },
      duration: {
        seconds: Math.round(trip.duration),
        minutes: Math.round(trip.duration / 60),
        text: formatDuration(trip.duration),
      },
      geometry: trip.geometry,
      legs: trip.legs?.map(leg => ({
        distance: { meters: Math.round(leg.distance), text: formatDistance(leg.distance) },
        duration: { seconds: Math.round(leg.duration), text: formatDuration(leg.duration) },
        steps: leg.steps?.map(step => ({
          distance: { meters: Math.round(step.distance), text: formatDistance(step.distance) },
          duration: { seconds: Math.round(step.duration), text: formatDuration(step.duration) },
          instruction: buildInstruction(step),
          name: step.name || '',
          maneuver: step.maneuver,
          geometry: step.geometry,
        })),
        summary: leg.summary,
      })),
    }));

    const waypoints = osrmData.waypoints?.map((wp, idx) => ({
      original_index: idx,
      optimized_index: wp.waypoint_index,
      trips_index: wp.trips_index,
      name: wp.name,
      location: { lng: wp.location[0], lat: wp.location[1] },
    }));

    const visitOrder = waypoints
      ?.slice()
      .sort((a, b) => a.optimized_index - b.optimized_index)
      .map(wp => wp.original_index);

    res.json({
      status: 'ok',
      waypoint_count: waypointCount,
      optimized_order: visitOrder,
      trips,
      waypoints,
    });
  } catch (err) {
    console.error('Trip error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Trip optimization timeout' });
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

function buildInstruction(step) {
  if (!step.maneuver) return '';
  const type = step.maneuver.type;
  const modifier = step.maneuver.modifier;
  const name = step.name || 'the road';
  switch (type) {
    case 'depart': return `Head ${modifier || 'forward'} on ${name}`;
    case 'arrive': return `Arrive at destination`;
    case 'turn': return `Turn ${modifier} onto ${name}`;
    case 'new name': return `Continue onto ${name}`;
    case 'merge': return `Merge ${modifier} onto ${name}`;
    case 'fork': return `Take the ${modifier} fork onto ${name}`;
    case 'roundabout': return `Enter roundabout, take exit to ${name}`;
    case 'continue': return `Continue ${modifier || 'straight'} on ${name}`;
    default: return `Continue on ${name}`;
  }
}

module.exports = { tripHandler };
