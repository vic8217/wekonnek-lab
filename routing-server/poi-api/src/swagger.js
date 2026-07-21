/**
 * ═══════════════════════════════════════════════
 *  Swagger / OpenAPI spec for WeKonnek Routing & POI API
 *  Full Google Maps alternative — all endpoints documented
 * ═══════════════════════════════════════════════
 */

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'WeKonnek Routing & POI API',
    description:
      'Self-hosted routing and location services API — full Google Maps Platform alternative.\n\n' +
      '## Routing & Navigation\n' +
      '- **Directions** — Multi-modal turn-by-turn routing (driving/walking/cycling/motorcycle)\n' +
      '- **Distance Matrix** — NxM duration/distance matrix between origin-destination pairs\n' +
      '- **Map Matching** — Snap GPS traces to the road network\n' +
      '- **Trip Optimization** — Solve the Travelling Salesman Problem for optimal waypoint order\n\n' +
      '## Geocoding & Places\n' +
      '- **Forward Geocoding** — Convert text/address to coordinates\n' +
      '- **Autocomplete** — Fast type-ahead place predictions\n' +
      '- **Reverse Geocoding** — Convert coordinates to Philippine address\n' +
      '- **Nearby Search** — Find POIs within a radius\n' +
      '- **Place Details** — Get full POI info by ID\n' +
      '- **Categories** — List POI categories with counts\n\n' +
      '## Analysis\n' +
      '- **Isochrone** — Reachable area polygons by time/distance\n' +
      '- **Elevation** — Height/altitude data for points\n\n' +
      '## Engines\n' +
      '- OSRM (driving routes, matrix, matching, trip optimization)\n' +
      '- Valhalla (walking/cycling/motorcycle routes, isochrones, elevation)\n' +
      '- Photon + PostGIS (geocoding, autocomplete, POI search)',
    version: '2.0.0',
    contact: { name: 'WeKonnek Dev Team' },
  },
  servers: [
    { url: 'http://localhost:3100', description: 'Local dev (Docker)' },
    { url: 'https://routing.wekonnek.app', description: 'Production' },
  ],
  tags: [
    { name: 'Routing', description: 'Directions, matrix, matching, trip optimization' },
    { name: 'Geocoding', description: 'Forward & reverse geocoding, autocomplete' },
    { name: 'Places', description: 'Nearby search, place details, categories' },
    { name: 'Analysis', description: 'Isochrone & elevation' },
    { name: 'Health', description: 'Health & readiness' },
  ],
  paths: {
    // ═══════════ ROUTING ═══════════

    '/route/v1/{profile}/{coordinates}': {
      get: {
        tags: ['Routing'],
        summary: 'Get directions (multi-modal)',
        description:
          'Returns turn-by-turn directions between waypoints.\n\n' +
          '- **driving** — Uses OSRM (car routing)\n' +
          '- **walking** — Uses Valhalla (pedestrian)\n' +
          '- **cycling** — Uses Valhalla (bicycle)\n' +
          '- **motorcycle** — Uses Valhalla (motorcycle)\n\n' +
          'Coordinate format: `lon1,lat1;lon2,lat2` (waypoints separated by `;`).',
        parameters: [
          {
            name: 'profile', in: 'path', required: true,
            schema: { type: 'string', enum: ['driving', 'walking', 'cycling', 'motorcycle'], default: 'driving' },
            description: 'Routing profile / travel mode',
          },
          {
            name: 'coordinates', in: 'path', required: true,
            schema: { type: 'string', example: '120.9842,14.5995;121.0244,14.5547' },
            description: 'Waypoints in lon,lat;lon,lat format',
          },
          { name: 'overview', in: 'query', schema: { type: 'string', enum: ['full', 'simplified', 'false'], default: 'full' } },
          { name: 'geometries', in: 'query', schema: { type: 'string', enum: ['polyline', 'polyline6', 'geojson'], default: 'polyline' } },
          { name: 'steps', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Include turn-by-turn steps' },
          { name: 'alternatives', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Return alternative routes' },
          { name: 'exclude', in: 'query', schema: { type: 'string', example: 'toll' }, description: 'Exclude toll/motorway (driving only)' },
        ],
        responses: {
          200: {
            description: 'Route result with distance, duration, steps',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DirectionsResponse' } } },
          },
          400: { description: 'Invalid coordinates or routing failed' },
          502: { description: 'Routing engine error' },
          504: { description: 'Routing timeout' },
        },
      },
    },

    '/matrix': {
      get: {
        tags: ['Routing'],
        summary: 'Distance matrix (NxM)',
        description:
          'Returns an NxM matrix of travel durations and distances between origin and destination pairs.\n' +
          'Equivalent to Google Maps Distance Matrix API.',
        parameters: [
          { name: 'origins', in: 'query', required: true, schema: { type: 'string', example: '120.9842,14.5995;121.0244,14.5547' }, description: 'Origin coordinates (lon,lat;lon,lat)' },
          { name: 'destinations', in: 'query', schema: { type: 'string', example: '121.0,14.55;120.99,14.58' }, description: 'Destination coordinates (defaults to origins for NxN)' },
          { name: 'profile', in: 'query', schema: { type: 'string', enum: ['driving'], default: 'driving' } },
        ],
        responses: {
          200: {
            description: 'Distance matrix result',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MatrixResponse' } } },
          },
          400: { description: 'Invalid parameters' },
          504: { description: 'Computation timeout' },
        },
      },
    },

    '/match': {
      get: {
        tags: ['Routing'],
        summary: 'Map matching / snap-to-road',
        description:
          'Snaps GPS traces to the road network.\n' +
          'Equivalent to Google Maps Roads API (Snap to Roads).\n' +
          'Also supports POST with JSON body for larger traces.',
        parameters: [
          { name: 'coordinates', in: 'query', required: true, schema: { type: 'string', example: '120.9842,14.5995;120.985,14.600;120.986,14.601' }, description: 'GPS points in lon,lat;lon,lat format' },
          { name: 'profile', in: 'query', schema: { type: 'string', default: 'driving' } },
          { name: 'geometries', in: 'query', schema: { type: 'string', enum: ['geojson', 'polyline', 'polyline6'], default: 'geojson' } },
          { name: 'steps', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'tidy', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Remove noisy points from trace' },
          { name: 'timestamps', in: 'query', schema: { type: 'string' }, description: 'Unix timestamps per coordinate (;-separated)' },
          { name: 'radiuses', in: 'query', schema: { type: 'string' }, description: 'Search radius per coordinate in meters (;-separated)' },
        ],
        responses: {
          200: { description: 'Matched trace with confidence scores', content: { 'application/json': { schema: { $ref: '#/components/schemas/MatchResponse' } } } },
          400: { description: 'Invalid parameters or matching failed' },
        },
      },
    },

    '/trip': {
      get: {
        tags: ['Routing'],
        summary: 'Trip optimization (TSP)',
        description:
          'Finds the optimal visit order for a set of waypoints (Travelling Salesman Problem).\n' +
          'Equivalent to Google Maps Route Optimization API.',
        parameters: [
          { name: 'coordinates', in: 'query', required: true, schema: { type: 'string', example: '120.9842,14.5995;121.0244,14.5547;121.0,14.58' }, description: 'Waypoints in lon,lat;lon,lat format (2-100 points)' },
          { name: 'roundtrip', in: 'query', schema: { type: 'string', enum: ['true', 'false'], default: 'true' }, description: 'Return to start point' },
          { name: 'source', in: 'query', schema: { type: 'string', enum: ['any', 'first'], default: 'any' }, description: 'Fix the start point' },
          { name: 'destination', in: 'query', schema: { type: 'string', enum: ['any', 'last'], default: 'any' }, description: 'Fix the end point' },
          { name: 'steps', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Include turn-by-turn steps' },
          { name: 'overview', in: 'query', schema: { type: 'string', enum: ['full', 'simplified', 'false'], default: 'full' } },
          { name: 'geometries', in: 'query', schema: { type: 'string', enum: ['polyline', 'polyline6', 'geojson'], default: 'polyline' } },
        ],
        responses: {
          200: { description: 'Optimized trip with visit order', content: { 'application/json': { schema: { $ref: '#/components/schemas/TripResponse' } } } },
          400: { description: 'Invalid parameters' },
        },
      },
    },

    // ═══════════ GEOCODING ═══════════

    '/geocode': {
      get: {
        tags: ['Geocoding'],
        summary: 'Forward geocode (text to coordinates)',
        description:
          'Converts a text query (address, place name, landmark) to geographic coordinates.\n' +
          'Uses Photon (OSM-based) + PostGIS trigram fuzzy search.\n' +
          'Equivalent to Google Maps Geocoding API (forward).',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'Jollibee Taft Manila' }, description: 'Search query (min 2 characters)' },
          { name: 'lat', in: 'query', schema: { type: 'number', example: 14.5995 }, description: 'Bias results near this latitude' },
          { name: 'lng', in: 'query', schema: { type: 'number', example: 120.9842 }, description: 'Bias results near this longitude' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 5, maximum: 20 }, description: 'Max results' },
          { name: 'lang', in: 'query', schema: { type: 'string', default: 'en' }, description: 'Language preference' },
        ],
        responses: {
          200: { description: 'Geocoding results', content: { 'application/json': { schema: { $ref: '#/components/schemas/GeocodeResponse' } } } },
          400: { description: 'Missing or too short query' },
        },
      },
    },

    '/autocomplete': {
      get: {
        tags: ['Geocoding'],
        summary: 'Place autocomplete / predictions',
        description:
          'Fast type-ahead suggestions as the user types.\n' +
          'Equivalent to Google Maps Places Autocomplete API.',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'jol' }, description: 'Search prefix' },
          { name: 'lat', in: 'query', schema: { type: 'number', example: 14.5995 }, description: 'Bias results near this latitude' },
          { name: 'lng', in: 'query', schema: { type: 'number', example: 120.9842 }, description: 'Bias results near this longitude' },
          { name: 'radius', in: 'query', schema: { type: 'integer', maximum: 50000 }, description: 'Restrict to this radius (meters) from lat/lng' },
          { name: 'types', in: 'query', schema: { type: 'string', example: 'food' }, description: 'Filter by category' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 5, maximum: 10 } },
        ],
        responses: {
          200: { description: 'Autocomplete predictions', content: { 'application/json': { schema: { $ref: '#/components/schemas/AutocompleteResponse' } } } },
          400: { description: 'Missing query' },
        },
      },
    },

    '/reverse': {
      get: {
        tags: ['Geocoding'],
        summary: 'Reverse geocode (coordinates to address)',
        description:
          'Returns the nearest Philippine address for a given coordinate.\n' +
          'Falls back to nearest named POI if no address point is found, then to raw coordinates.',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number', example: 14.5995 }, description: 'Latitude' },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number', example: 120.9842 }, description: 'Longitude' },
        ],
        responses: {
          200: { description: 'Reverse geocoding result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReverseResponse' } } } },
          400: { description: 'Missing lat/lng' },
        },
      },
    },

    // ═══════════ PLACES ═══════════

    '/nearby': {
      get: {
        tags: ['Places'],
        summary: 'Search nearby Points of Interest',
        description:
          'Returns POIs within a given radius of a coordinate, filtered by category / subcategory / keyword.\n' +
          'Coordinates must be within the Philippines (lat 4.5-21.5, lng 116-127).',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number', example: 14.5995 } },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number', example: 120.9842 } },
          { name: 'radius', in: 'query', schema: { type: 'integer', default: 1000, maximum: 50000 }, description: 'Search radius in meters' },
          { name: 'category', in: 'query', schema: { type: 'string', example: 'food' } },
          { name: 'subcategory', in: 'query', schema: { type: 'string', example: 'restaurant' } },
          { name: 'q', in: 'query', schema: { type: 'string', example: 'jollibee' }, description: 'Keyword search' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Nearby POI results', content: { 'application/json': { schema: { $ref: '#/components/schemas/NearbyResponse' } } } },
          400: { description: 'Missing or invalid parameters' },
        },
      },
    },

    '/place/{id}': {
      get: {
        tags: ['Places'],
        summary: 'Get place details by ID',
        description:
          'Returns full details for a POI including address, contact, opening hours, and nearby places.\n' +
          'Equivalent to Google Maps Places Details API.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 12345 }, description: 'POI ID' },
        ],
        responses: {
          200: { description: 'Place details', content: { 'application/json': { schema: { $ref: '#/components/schemas/PlaceResponse' } } } },
          404: { description: 'Place not found' },
        },
      },
    },

    '/categories': {
      get: {
        tags: ['Places'],
        summary: 'List all POI categories with counts',
        description: 'Returns POI categories grouped by top-level category, each with subcategories and POI counts.',
        responses: {
          200: { description: 'Category list', content: { 'application/json': { schema: { $ref: '#/components/schemas/CategoriesResponse' } } } },
        },
      },
    },

    // ═══════════ ANALYSIS ═══════════

    '/isochrone': {
      get: {
        tags: ['Analysis'],
        summary: 'Isochrone / reachable area',
        description:
          'Returns polygon(s) showing the area reachable within a given time or distance from a point.\n' +
          'Uses Valhalla. Supports multiple contour ranges.',
        parameters: [
          { name: 'lat', in: 'query', required: true, schema: { type: 'number', example: 14.5995 } },
          { name: 'lng', in: 'query', required: true, schema: { type: 'number', example: 120.9842 } },
          { name: 'range', in: 'query', schema: { type: 'string', default: '600', example: '300,600,900' }, description: 'Comma-separated seconds (time) or meters (distance)' },
          { name: 'mode', in: 'query', schema: { type: 'string', enum: ['driving', 'walking', 'cycling', 'motorcycle'], default: 'driving' } },
          { name: 'metric', in: 'query', schema: { type: 'string', enum: ['time', 'distance'], default: 'time' } },
          { name: 'denoise', in: 'query', schema: { type: 'number', default: 0.5, minimum: 0, maximum: 1 }, description: 'Smoothing factor' },
          { name: 'generalize', in: 'query', schema: { type: 'integer', default: 120 }, description: 'Simplification tolerance (meters)' },
          { name: 'polygons', in: 'query', schema: { type: 'string', enum: ['true', 'false'], default: 'true' } },
        ],
        responses: {
          200: { description: 'Isochrone polygons with GeoJSON', content: { 'application/json': { schema: { $ref: '#/components/schemas/IsochroneResponse' } } } },
          400: { description: 'Invalid parameters' },
          502: { description: 'Valhalla service error' },
        },
      },
    },

    '/elevation': {
      get: {
        tags: ['Analysis'],
        summary: 'Elevation / height data',
        description:
          'Returns elevation data for a set of points. Uses Valhalla with SRTM data.\n' +
          'Equivalent to Google Maps Elevation API.\n' +
          'Also supports POST with JSON body for larger point sets.',
        parameters: [
          { name: 'points', in: 'query', required: true, schema: { type: 'string', example: '14.5995,120.9842|14.5547,121.0244' }, description: 'Points in lat,lng|lat,lng format (max 500)' },
        ],
        responses: {
          200: { description: 'Elevation results', content: { 'application/json': { schema: { $ref: '#/components/schemas/ElevationResponse' } } } },
          400: { description: 'Missing points' },
          502: { description: 'Elevation service error' },
        },
      },
    },

    // ═══════════ HEALTH ═══════════

    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check with service status',
        description: 'Returns health status for all backend services (DB, OSRM, Valhalla, Photon).',
        responses: {
          200: { description: 'All services healthy' },
          503: { description: 'One or more services degraded' },
        },
      },
    },

    '/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe (k8s / Docker)',
        responses: {
          200: { description: 'Ready', content: { 'application/json': { schema: { type: 'object', properties: { ready: { type: 'boolean' } } } } } },
          503: { description: 'Not ready' },
        },
      },
    },
  },

  components: {
    schemas: {
      DirectionsResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          profile: { type: 'string', example: 'driving' },
          engine: { type: 'string', example: 'osrm' },
          waypoints: { type: 'array', items: { $ref: '#/components/schemas/Waypoint' } },
          routes: { type: 'array', items: { $ref: '#/components/schemas/Route' } },
        },
      },
      MatrixResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          origin_count: { type: 'integer', example: 2 },
          destination_count: { type: 'integer', example: 3 },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                origin_index: { type: 'integer' },
                elements: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      duration: { $ref: '#/components/schemas/DurationValue' },
                      distance: { $ref: '#/components/schemas/DistanceValue' },
                      status: { type: 'string', enum: ['ok', 'no_route'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      MatchResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          matchings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                confidence: { type: 'number', example: 0.95 },
                distance: { $ref: '#/components/schemas/DistanceValue' },
                duration: { $ref: '#/components/schemas/DurationValue' },
                geometry: {},
              },
            },
          },
          tracepoints: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                status: { type: 'string', enum: ['matched', 'unmatched'] },
                location: { $ref: '#/components/schemas/LatLng' },
              },
            },
          },
        },
      },
      TripResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          waypoint_count: { type: 'integer' },
          optimized_order: { type: 'array', items: { type: 'integer' }, example: [0, 2, 1] },
          trips: { type: 'array', items: { $ref: '#/components/schemas/Route' } },
          waypoints: { type: 'array', items: { $ref: '#/components/schemas/Waypoint' } },
        },
      },
      GeocodeResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          query: { type: 'string' },
          count: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Jollibee' },
                display_name: { type: 'string', example: 'Jollibee, Taft Ave, Manila' },
                location: { $ref: '#/components/schemas/LatLng' },
                address: { type: 'object' },
                type: { type: 'string' },
                confidence: { type: 'number' },
              },
            },
          },
        },
      },
      AutocompleteResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          query: { type: 'string' },
          predictions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                place_id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                location: { $ref: '#/components/schemas/LatLng' },
                type: { type: 'string' },
              },
            },
          },
        },
      },
      ReverseResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          location: { $ref: '#/components/schemas/LatLng' },
          address: {
            type: 'object',
            properties: {
              full: { type: 'string', example: '123 Ongpin St, Brgy. Binondo, Manila' },
              house_number: { type: 'string' },
              street: { type: 'string' },
              barangay: { type: 'string' },
              city: { type: 'string' },
              province: { type: 'string' },
            },
          },
          source: { type: 'string', enum: ['address_point', 'nearest_poi', 'coordinates_only'] },
        },
      },
      NearbyResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          count: { type: 'integer' },
          center: { $ref: '#/components/schemas/LatLng' },
          radius: { type: 'integer' },
          results: { type: 'array', items: { $ref: '#/components/schemas/POI' } },
        },
      },
      PlaceResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          place: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              category: { type: 'string' },
              location: { $ref: '#/components/schemas/LatLng' },
              address: { type: 'object' },
              contact: { type: 'object', properties: { phone: { type: 'string' }, website: { type: 'string' } } },
              details: { type: 'object', properties: { opening_hours: { type: 'string' }, cuisine: { type: 'string' }, brand: { type: 'string' } } },
              nearby: { type: 'array', items: { $ref: '#/components/schemas/POI' } },
            },
          },
        },
      },
      CategoriesResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          categories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', example: 'food' },
                subcategories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      subcategory: { type: 'string' },
                      display_name: { type: 'string' },
                      icon: { type: 'string' },
                      count: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      IsochroneResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          center: { $ref: '#/components/schemas/LatLng' },
          mode: { type: 'string' },
          metric: { type: 'string' },
          isochrones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                value: { type: 'number' },
                label: { type: 'string', example: '10 min' },
                color: { type: 'string' },
                geometry: { type: 'object', description: 'GeoJSON geometry' },
              },
            },
          },
          geojson: { type: 'object', description: 'Full GeoJSON FeatureCollection' },
        },
      },
      ElevationResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          count: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                location: { $ref: '#/components/schemas/LatLng' },
                elevation: { type: 'number', example: 42 },
                elevation_text: { type: 'string', example: '42 m' },
              },
            },
          },
          summary: {
            type: 'object', nullable: true,
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
              avg: { type: 'number' },
            },
          },
        },
      },
      POI: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          osm_id: { type: 'string' },
          name: { type: 'string', example: 'Jollibee' },
          category: { type: 'string', example: 'food' },
          subcategory: { type: 'string', example: 'fast_food' },
          icon: { type: 'string' },
          location: { $ref: '#/components/schemas/LatLng' },
          distance: { $ref: '#/components/schemas/DistanceValue' },
          address: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          website: { type: 'string', nullable: true },
          opening_hours: { type: 'string', nullable: true },
          cuisine: { type: 'string', nullable: true },
          brand: { type: 'string', nullable: true },
        },
      },
      Route: {
        type: 'object',
        properties: {
          route_index: { type: 'integer' },
          profile: { type: 'string' },
          distance: { $ref: '#/components/schemas/DistanceValue' },
          duration: { $ref: '#/components/schemas/DurationValue' },
          geometry: { description: 'Encoded polyline or GeoJSON' },
          legs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                distance: { $ref: '#/components/schemas/DistanceValue' },
                duration: { $ref: '#/components/schemas/DurationValue' },
                steps: { type: 'array', items: { $ref: '#/components/schemas/Step' } },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
      Step: {
        type: 'object',
        properties: {
          distance: { $ref: '#/components/schemas/DistanceValue' },
          duration: { $ref: '#/components/schemas/DurationValue' },
          instruction: { type: 'string', example: 'Turn right onto Ongpin St' },
          name: { type: 'string' },
          maneuver: { type: 'object' },
          geometry: {},
        },
      },
      Waypoint: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          location: { $ref: '#/components/schemas/LatLng' },
          hint: { type: 'string' },
        },
      },
      LatLng: {
        type: 'object',
        properties: {
          lat: { type: 'number', example: 14.5995 },
          lng: { type: 'number', example: 120.9842 },
        },
      },
      DistanceValue: {
        type: 'object',
        properties: {
          meters: { type: 'integer', example: 5200 },
          text: { type: 'string', example: '5.2 km' },
        },
      },
      DurationValue: {
        type: 'object',
        properties: {
          seconds: { type: 'integer', example: 780 },
          text: { type: 'string', example: '13 min' },
        },
      },
    },
  },
};

module.exports = { swaggerSpec };
