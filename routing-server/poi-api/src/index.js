/**
 * ═══════════════════════════════════════════════
 *  WeKonnek Routing & POI API — Full Google Maps Alternative
 *  Stack: Express + PostGIS + OSRM + Valhalla + Photon
 * ═══════════════════════════════════════════════
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const { nearbyHandler } = require('./routes/nearby');
const { reverseHandler } = require('./routes/reverse');
const { routeProxyHandler } = require('./routes/route-proxy');
const { healthHandler, readyHandler } = require('./routes/health');
const { categoriesHandler } = require('./routes/categories');
const { matrixHandler } = require('./routes/matrix');
const { matchHandler } = require('./routes/match');
const { tripHandler } = require('./routes/trip');
const { geocodeHandler } = require('./routes/geocode');
const { autocompleteHandler } = require('./routes/autocomplete');
const { placeHandler } = require('./routes/place');
const { isochroneHandler } = require('./routes/isochrone');
const { elevationHandler } = require('./routes/elevation');
const { swaggerSpec } = require('./swagger');
const { pool, testConnection } = require('./db');

const app = express();
const PORT = process.env.PORT || 3100;

// ─── Middleware ───────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// ─── Swagger API Docs ─────────────────────────
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'WeKonnek Routing & POI API Docs',
}));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

// ─── Health ──────────────────────────────────
app.get('/health', healthHandler);
app.get('/ready', readyHandler);

// ─── Routing (OSRM + Valhalla) ──────────────
// Multi-modal: driving (OSRM), walking/cycling/motorcycle (Valhalla)
app.get('/route/v1/:profile/:coordinates', routeProxyHandler);

// ─── Distance Matrix (OSRM /table) ──────────
app.get('/matrix', matrixHandler);

// ─── Map Matching / Snap-to-Road ─────────────
app.get('/match', matchHandler);
app.post('/match', matchHandler);

// ─── Trip Optimization (TSP) ─────────────────
app.get('/trip', tripHandler);

// ─── Forward Geocoding ──────────────────────
app.get('/geocode', geocodeHandler);

// ─── Autocomplete / Place Predictions ────────
app.get('/autocomplete', autocompleteHandler);

// ─── Place Details by ID ─────────────────────
app.get('/place/:id', placeHandler);

// ─── Nearby POI Search ──────────────────────
app.get('/nearby', nearbyHandler);

// ─── Reverse Geocoding ──────────────────────
app.get('/reverse', reverseHandler);

// ─── POI Categories ─────────────────────────
app.get('/categories', categoriesHandler);

// ─── Isochrone (Valhalla) ───────────────────
app.get('/isochrone', isochroneHandler);

// ─── Elevation (Valhalla) ───────────────────
app.get('/elevation', elevationHandler);
app.post('/elevation', elevationHandler);

// ─── Start ───────────────────────────────────
async function start() {
  try {
    await testConnection();
    console.log('Database connected');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
══════════════════════════════════════════════════════
  WeKonnek Routing & POI API running on port ${PORT}
  
  Routing & Navigation:
    GET /route/v1/:profile/  → Directions (driving/walking/cycling/motorcycle)
    GET /matrix              → Distance Matrix (NxM)
    GET /match               → Map Matching / Snap-to-Road
    GET /trip                → Trip Optimization (TSP)
  
  Geocoding & Places:
    GET /geocode             → Forward Geocoding (text → coordinates)
    GET /autocomplete        → Place Autocomplete / Predictions
    GET /reverse             → Reverse Geocoding (coordinates → address)
    GET /nearby              → Nearby POI Search
    GET /place/:id           → Place Details by ID
    GET /categories          → POI Category List
  
  Analysis:
    GET /isochrone           → Reachable Area Polygons
    GET /elevation           → Elevation / Height Data
  
  System:
    GET /health              → Health Check
    GET /ready               → Readiness Probe
    GET /docs                → Swagger API Docs
    GET /docs.json           → OpenAPI JSON Spec
══════════════════════════════════════════════════════
      `);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
