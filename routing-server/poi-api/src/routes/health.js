/**
 * Health check endpoints — monitors all backend services
 */

const { pool } = require('../db');
const fetch = require('node-fetch');

const OSRM_URL = process.env.OSRM_URL || 'http://osrm-backend:5000';
const VALHALLA_URL = process.env.VALHALLA_URL || 'http://valhalla:8002';
const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';

async function healthHandler(req, res) {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: '2.0.0',
    services: {},
  };

  // Check database
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    checks.services.database = {
      status: 'ok',
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    checks.services.database = { status: 'error', message: err.message };
    checks.status = 'degraded';
  }

  // Check OSRM
  try {
    const start = Date.now();
    const resp = await fetch(
      `${OSRM_URL}/route/v1/driving/121.0,14.5;121.1,14.6`,
      { timeout: 5000 },
    );
    checks.services.osrm = {
      status: resp.ok ? 'ok' : 'error',
      latency_ms: Date.now() - start,
      features: ['driving', 'matrix', 'match', 'trip'],
    };
  } catch (err) {
    checks.services.osrm = { status: 'error', message: err.message };
    checks.status = 'degraded';
  }

  // Check Valhalla
  try {
    const start = Date.now();
    const resp = await fetch(`${VALHALLA_URL}/status`, { timeout: 5000 });
    checks.services.valhalla = {
      status: resp.ok ? 'ok' : 'error',
      latency_ms: Date.now() - start,
      features: ['walking', 'cycling', 'motorcycle', 'isochrone', 'elevation'],
    };
  } catch (err) {
    checks.services.valhalla = { status: 'unavailable', message: err.message };
    if (checks.status === 'ok') checks.status = 'partial';
  }

  // Check Photon
  try {
    const start = Date.now();
    const resp = await fetch(`${PHOTON_URL}/api?q=Manila&limit=1`, { timeout: 5000 });
    checks.services.photon = {
      status: resp.ok ? 'ok' : 'error',
      latency_ms: Date.now() - start,
      features: ['geocode', 'autocomplete'],
    };
  } catch (err) {
    checks.services.photon = { status: 'unavailable', message: err.message };
    if (checks.status === 'ok') checks.status = 'partial';
  }

  // Memory usage
  const mem = process.memoryUsage();
  checks.memory = {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
  };

  const statusCode = checks.status === 'ok' ? 200 : checks.status === 'degraded' ? 503 : 200;
  res.status(statusCode).json(checks);
}

async function readyHandler(req, res) {
  try {
    await pool.query('SELECT 1');
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
}

module.exports = { healthHandler, readyHandler };
