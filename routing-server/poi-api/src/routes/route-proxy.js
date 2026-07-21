/**
 * ═══════════════════════════════════════════════
 *  Routing Proxy — Multi-modal routing
 *  GET /route/v1/:profile/{lon1},{lat1};{lon2},{lat2}
 *  
 *  Profiles:
 *    driving   → OSRM car (default)
 *    walking   → Valhalla pedestrian
 *    cycling   → Valhalla bicycle
 *    motorcycle → Valhalla motorcycle
 *  
 *  Query params (passed to OSRM/Valhalla):
 *    overview=full|simplified|false
 *    geometries=polyline|polyline6|geojson
 *    steps=true|false
 *    alternatives=true|false
 *    exclude=toll|motorway (OSRM only)
 * ═══════════════════════════════════════════════
 */

const fetch = require('node-fetch');

const OSRM_URL = process.env.OSRM_URL || 'http://osrm-backend:5000';
const VALHALLA_URL = process.env.VALHALLA_URL || 'http://valhalla:8002';

const VALHALLA_PROFILES = {
  walking: 'pedestrian',
  cycling: 'bicycle',
  motorcycle: 'motorcycle',
};

async function routeProxyHandler(req, res) {
  try {
    const { coordinates, profile } = req.params;

    if (!coordinates) {
      return res.status(400).json({
        error: 'Missing coordinates',
        usage: 'GET /route/v1/{profile}/{lon1},{lat1};{lon2},{lat2}',
        profiles: ['driving', 'walking', 'cycling', 'motorcycle'],
        example: '/route/v1/driving/120.9842,14.5995;121.0244,14.5547',
      });
    }

    if (VALHALLA_PROFILES[profile]) {
      return valhallaRoute(req, res, coordinates, profile);
    }

    return osrmRoute(req, res, coordinates);
  } catch (err) {
    console.error('Routing error:', err);
    if (err.type === 'request-timeout') {
      return res.status(504).json({ error: 'Routing service timeout' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function osrmRoute(req, res, coordinates) {
  const queryParams = new URLSearchParams();
  const allowedParams = [
    'overview', 'geometries', 'steps', 'alternatives',
    'annotations', 'bearings', 'radiuses', 'continue_straight',
    'exclude',
  ];
  for (const param of allowedParams) {
    if (req.query[param] !== undefined) {
      queryParams.set(param, req.query[param]);
    }
  }
  if (!queryParams.has('overview')) queryParams.set('overview', 'full');
  if (!queryParams.has('geometries')) queryParams.set('geometries', 'polyline');

  const osrmUrl = `${OSRM_URL}/route/v1/driving/${coordinates}?${queryParams.toString()}`;

  let osrmRes;
  try {
    osrmRes = await fetch(osrmUrl, { timeout: 10000 });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      message: 'OSRM routing service is unavailable',
      hint: 'Start the OSRM Docker container or deploy the full routing stack',
      engine: 'osrm',
    });
  }

  let osrmData;
  try {
    osrmData = await osrmRes.json();
  } catch {
    return res.status(502).json({
      status: 'error',
      message: 'Invalid response from OSRM service',
      engine: 'osrm',
    });
  }

  if (osrmData.code !== 'Ok') {
    return res.status(400).json({
      status: 'error',
      code: osrmData.code,
      message: osrmData.message || 'Routing failed',
    });
  }

  const routes = osrmData.routes.map((route, idx) => ({
    route_index: idx,
    profile: 'driving',
    distance: {
      meters: Math.round(route.distance),
      km: (route.distance / 1000).toFixed(1),
      text: formatDistance(route.distance),
    },
    duration: {
      seconds: Math.round(route.duration),
      minutes: Math.round(route.duration / 60),
      text: formatDuration(route.duration),
    },
    geometry: route.geometry,
    legs: route.legs?.map(leg => ({
      distance: { meters: Math.round(leg.distance), text: formatDistance(leg.distance) },
      duration: { seconds: Math.round(leg.duration), text: formatDuration(leg.duration) },
      steps: leg.steps?.map(step => ({
        distance: { meters: Math.round(step.distance), text: formatDistance(step.distance) },
        duration: { seconds: Math.round(step.duration), text: formatDuration(step.duration) },
        instruction: buildInstruction(step),
        name: step.name || '',
        mode: step.mode,
        maneuver: step.maneuver,
        geometry: step.geometry,
      })),
      summary: leg.summary,
    })),
  }));

  res.json({
    status: 'ok',
    profile: 'driving',
    engine: 'osrm',
    waypoints: osrmData.waypoints?.map(wp => ({
      name: wp.name,
      location: { lng: wp.location[0], lat: wp.location[1] },
      hint: wp.hint,
    })),
    routes,
  });
}

async function valhallaRoute(req, res, coordinates, profile) {
  const coordPairs = coordinates.split(';').map(c => {
    const [lng, lat] = c.split(',').map(Number);
    return { lon: lng, lat };
  });

  if (coordPairs.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 waypoints' });
  }

  const costing = VALHALLA_PROFILES[profile];
  const wantSteps = req.query.steps === 'true';
  const wantAlternatives = req.query.alternatives === 'true' ? 2 : 0;

  const valhallaBody = {
    locations: coordPairs.map(c => ({ lat: c.lat, lon: c.lon })),
    costing,
    directions_options: {
      units: 'km',
      language: 'en-US',
    },
    alternates: wantAlternatives,
  };

  let valhallaRes;
  try {
    valhallaRes = await fetch(`${VALHALLA_URL}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valhallaBody),
      timeout: 15000,
    });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      message: 'Valhalla routing service is unavailable',
      hint: 'Start the Valhalla Docker container or deploy the full routing stack',
      engine: 'valhalla',
    });
  }

  if (!valhallaRes.ok) {
    const errText = await valhallaRes.text().catch(() => 'Unknown error');
    return res.status(502).json({
      status: 'error',
      message: 'Routing service error',
      detail: errText,
    });
  }

  const valhallaData = await valhallaRes.json();
  const trip = valhallaData.trip;

  if (!trip) {
    return res.status(400).json({ status: 'error', message: 'No route found' });
  }

  const routes = [{
    route_index: 0,
    profile,
    distance: {
      meters: Math.round(trip.summary.length * 1000),
      km: trip.summary.length.toFixed(1),
      text: formatDistance(trip.summary.length * 1000),
    },
    duration: {
      seconds: Math.round(trip.summary.time),
      minutes: Math.round(trip.summary.time / 60),
      text: formatDuration(trip.summary.time),
    },
    geometry: trip.legs?.[0]?.shape || null,
    legs: trip.legs?.map(leg => ({
      distance: {
        meters: Math.round(leg.summary.length * 1000),
        text: formatDistance(leg.summary.length * 1000),
      },
      duration: {
        seconds: Math.round(leg.summary.time),
        text: formatDuration(leg.summary.time),
      },
      steps: wantSteps ? leg.maneuvers?.map(m => ({
        distance: { meters: Math.round(m.length * 1000), text: formatDistance(m.length * 1000) },
        duration: { seconds: Math.round(m.time), text: formatDuration(m.time) },
        instruction: m.instruction || '',
        name: m.street_names?.join(', ') || '',
        type: m.type,
        travel_type: m.travel_type,
      })) : undefined,
      summary: leg.summary,
    })),
  }];

  if (valhallaData.alternates) {
    valhallaData.alternates.forEach((alt, idx) => {
      const altTrip = alt.trip;
      if (!altTrip) return;
      routes.push({
        route_index: idx + 1,
        profile,
        distance: {
          meters: Math.round(altTrip.summary.length * 1000),
          km: altTrip.summary.length.toFixed(1),
          text: formatDistance(altTrip.summary.length * 1000),
        },
        duration: {
          seconds: Math.round(altTrip.summary.time),
          minutes: Math.round(altTrip.summary.time / 60),
          text: formatDuration(altTrip.summary.time),
        },
        geometry: altTrip.legs?.[0]?.shape || null,
        legs: altTrip.legs?.map(leg => ({
          distance: { meters: Math.round(leg.summary.length * 1000), text: formatDistance(leg.summary.length * 1000) },
          duration: { seconds: Math.round(leg.summary.time), text: formatDuration(leg.summary.time) },
          summary: leg.summary,
        })),
      });
    });
  }

  const waypoints = coordPairs.map((c, idx) => ({
    name: trip.locations?.[idx]?.name || '',
    location: { lng: c.lon, lat: c.lat },
  }));

  res.json({
    status: 'ok',
    profile,
    engine: 'valhalla',
    waypoints,
    routes,
  });
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

module.exports = { routeProxyHandler };
