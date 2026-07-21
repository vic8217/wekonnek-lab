/**
 * Database connection pool — PostGIS
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'wekonnek_poi',
  user: process.env.DB_USER || 'wekonnek',
  password: process.env.DB_PASSWORD || 'wekonnek_secure_2024',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT PostGIS_Version()');
  } finally {
    client.release();
  }
}

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.warn(`⚠️  Slow query (${duration}ms):`, text.substring(0, 100));
  }
  return result;
}

module.exports = { pool, query, testConnection };
