/**
 * Integration test suite — WeKonnek Routing Server v2.0
 * Run against a live server: node test/test.js [base_url]
 * Tests all endpoints: routing, matrix, match, trip, geocode, autocomplete,
 *                      reverse, nearby, place, categories, isochrone, elevation
 */

const BASE_URL = process.argv[2] || 'http://localhost:3100';

async function test(name, url, options, validate) {
  if (typeof options === 'function') {
    validate = options;
    options = {};
  }
  try {
    const fetchOpts = { ...options, timeout: 15000 };
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
    const res = await fetch(fullUrl, fetchOpts);
    const data = await res.json();
    const pass = validate(data, res.status);
    console.log(`${pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}`);
    if (!pass) console.log('   Response:', JSON.stringify(data).substring(0, 300));
    return pass;
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m ${name} — ${err.message}`);
    return false;
  }
}

async function runTests() {
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  WeKonnek Routing Server v2.0 — Integration Tests`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`══════════════════════════════════════════════════\n`);

  let passed = 0;
  let total = 0;
  let skipped = 0;

  async function run(name, url, opts, validate) {
    total++;
    const result = await test(name, url, opts, validate);
    if (result) passed++;
    return result;
  }

  // ─── Health ───────────────────────────────
  console.log('--- Health ---');
  await run('Health check', '/health',
    (d) => d.status === 'ok' || d.status === 'degraded' || d.status === 'partial');
  await run('Readiness probe', '/ready',
    (d) => d.ready === true);

  // ─── Routing (OSRM — driving) ─────────────
  console.log('\n--- Routing (Driving / OSRM) ---');
  await run('Driving route - Metro Manila', '/route/v1/driving/120.9842,14.5995;121.0244,14.5547',
    (d) => d.status === 'ok' && d.routes?.length > 0);
  await run('Driving route - with steps', '/route/v1/driving/120.9842,14.5995;121.0244,14.5547?steps=true',
    (d) => d.status === 'ok' && d.routes?.[0]?.legs?.[0]?.steps?.length > 0);
  await run('Driving route - polyline6', '/route/v1/driving/120.9842,14.5995;121.0244,14.5547?geometries=polyline6',
    (d) => d.status === 'ok');
  await run('Driving route - alternatives', '/route/v1/driving/120.9842,14.5995;121.0244,14.5547?alternatives=true',
    (d) => d.status === 'ok');
  await run('Route - profile in response', '/route/v1/driving/120.9842,14.5995;121.0244,14.5547',
    (d) => d.profile === 'driving' && d.engine === 'osrm');

  // ─── Routing (Valhalla — walking/cycling) ──
  console.log('\n--- Routing (Walking/Cycling / Valhalla) ---');
  const valhallaAvailable = await test('Valhalla health', '/health',
    (d) => d.services?.valhalla?.status === 'ok');

  if (valhallaAvailable) {
    await run('Walking route', '/route/v1/walking/120.9842,14.5995;120.9900,14.6020',
      (d) => d.status === 'ok' && d.profile === 'walking');
    await run('Cycling route', '/route/v1/cycling/120.9842,14.5995;120.9900,14.6020',
      (d) => d.status === 'ok' && d.profile === 'cycling');
    await run('Motorcycle route', '/route/v1/motorcycle/120.9842,14.5995;121.0244,14.5547',
      (d) => d.status === 'ok' && d.profile === 'motorcycle');
  } else {
    console.log('  (Valhalla not available — skipping walking/cycling/motorcycle tests)');
    skipped += 3;
  }

  // ─── Distance Matrix ──────────────────────
  console.log('\n--- Distance Matrix ---');
  await run('Matrix - NxN', '/matrix?origins=120.9842,14.5995;121.0244,14.5547',
    (d) => d.status === 'ok' && d.rows?.length === 2);
  await run('Matrix - NxM', '/matrix?origins=120.9842,14.5995&destinations=121.0244,14.5547;121.0,14.58',
    (d) => d.status === 'ok' && d.origin_count === 1 && d.destination_count === 2);
  await run('Matrix - missing origins', '/matrix',
    (d, s) => s === 400);

  // ─── Map Matching ────────────────────────
  console.log('\n--- Map Matching ---');
  await run('Match - GPS trace', '/match?coordinates=120.9842,14.5995;120.985,14.600;120.986,14.601',
    (d) => d.status === 'ok' && d.matchings?.length > 0);
  await run('Match - with tidy', '/match?coordinates=120.9842,14.5995;120.985,14.600;120.986,14.601&tidy=true',
    (d) => d.status === 'ok');
  await run('Match - missing coords', '/match',
    (d, s) => s === 400);

  // ─── Trip Optimization ────────────────────
  console.log('\n--- Trip Optimization ---');
  await run('Trip - 3 waypoints', '/trip?coordinates=120.9842,14.5995;121.0244,14.5547;121.0,14.58',
    (d) => d.status === 'ok' && d.optimized_order?.length === 3);
  await run('Trip - no roundtrip', '/trip?coordinates=120.9842,14.5995;121.0244,14.5547;121.0,14.58&roundtrip=false&source=first&destination=last',
    (d) => d.status === 'ok');
  await run('Trip - with steps', '/trip?coordinates=120.9842,14.5995;121.0244,14.5547;121.0,14.58&steps=true',
    (d) => d.status === 'ok');

  // ─── Geocoding ───────────────────────────
  console.log('\n--- Forward Geocoding ---');
  await run('Geocode - text search', '/geocode?q=Jollibee Manila',
    (d) => d.status === 'ok');
  await run('Geocode - with location bias', '/geocode?q=hospital&lat=14.5995&lng=120.9842',
    (d) => d.status === 'ok');
  await run('Geocode - too short query', '/geocode?q=a',
    (d, s) => s === 400);

  // ─── Autocomplete ────────────────────────
  console.log('\n--- Autocomplete ---');
  await run('Autocomplete - prefix', '/autocomplete?q=jol&lat=14.5995&lng=120.9842',
    (d) => d.status === 'ok');
  await run('Autocomplete - with category', '/autocomplete?q=gas&types=transport',
    (d) => d.status === 'ok');

  // ─── Reverse Geocoding ────────────────────
  console.log('\n--- Reverse Geocoding ---');
  await run('Reverse geocoding', '/reverse?lat=14.5995&lng=120.9842',
    (d) => d.status === 'ok' && d.address);
  await run('Reverse - missing params', '/reverse',
    (d, s) => s === 400);

  // ─── Nearby ──────────────────────────────
  console.log('\n--- Nearby Search ---');
  await run('Nearby - basic', '/nearby?lat=14.5995&lng=120.9842&radius=2000',
    (d) => d.status === 'ok');
  await run('Nearby - with category', '/nearby?lat=14.5995&lng=120.9842&radius=2000&category=food',
    (d) => d.status === 'ok');
  await run('Nearby - with keyword', '/nearby?lat=14.5995&lng=120.9842&radius=5000&q=jollibee',
    (d) => d.status === 'ok');
  await run('Nearby - missing params', '/nearby',
    (d, s) => s === 400);

  // ─── Place Details ────────────────────────
  console.log('\n--- Place Details ---');
  await run('Place - not found', '/place/999999999',
    (d, s) => s === 404);
  await run('Place - invalid ID', '/place/abc',
    (d, s) => s === 400);

  // ─── Categories ──────────────────────────
  console.log('\n--- Categories ---');
  await run('Categories list', '/categories',
    (d) => d.status === 'ok' && d.categories?.length > 0);

  // ─── Isochrone ───────────────────────────
  if (valhallaAvailable) {
    console.log('\n--- Isochrone ---');
    await run('Isochrone - 5min driving', '/isochrone?lat=14.5995&lng=120.9842&range=300&mode=driving',
      (d) => d.status === 'ok' && d.isochrones?.length > 0);
    await run('Isochrone - multi range', '/isochrone?lat=14.5995&lng=120.9842&range=300,600,900&mode=walking',
      (d) => d.status === 'ok');
    await run('Isochrone - missing params', '/isochrone',
      (d, s) => s === 400);
  } else {
    console.log('\n  (Isochrone tests skipped — Valhalla not available)');
    skipped += 3;
  }

  // ─── Elevation ───────────────────────────
  if (valhallaAvailable) {
    console.log('\n--- Elevation ---');
    await run('Elevation - single point', '/elevation?points=14.5995,120.9842',
      (d) => d.status === 'ok' && d.results?.length === 1);
    await run('Elevation - multi point', '/elevation?points=14.5995,120.9842|14.5547,121.0244',
      (d) => d.status === 'ok' && d.results?.length === 2);
    await run('Elevation - POST',
      '/elevation',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [[14.5995, 120.9842], [14.5547, 121.0244]] }),
      },
      (d) => d.status === 'ok');
  } else {
    console.log('\n  (Elevation tests skipped — Valhalla not available)');
    skipped += 3;
  }

  // ─── Results ─────────────────────────────
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  Results: ${passed}/${total} passed${skipped > 0 ? `, ${skipped} skipped` : ''}`);
  console.log(`══════════════════════════════════════════════════\n`);
  process.exit(passed === total ? 0 : 1);
}

runTests();
