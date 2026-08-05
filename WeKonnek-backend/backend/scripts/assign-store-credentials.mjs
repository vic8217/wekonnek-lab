import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/assign-store-credentials.mjs merchant@example.com');
  process.exit(1);
}

const rawUrl = process.env.DATABASE_URL || '';
const pool = new pg.Pool({
  connectionString: rawUrl.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

const locationCode = (value) => (value || 'STORE')
  .normalize('NFKD')
  .replace(/[^a-zA-Z0-9]/g, '')
  .toUpperCase()
  .slice(0, 8) || 'STORE';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT m.id AS merchant_id, m.user_id, m.name, m.merchant_code,
              ma.id AS application_id, ma.geographic_area, ma.barangay,
              ma.city_municipality, COALESCE(ma.address, m.address) AS address
       FROM merchants m
       JOIN merchant_applications ma ON ma.merchant_code = m.merchant_code
       WHERE LOWER(ma.email) = $1 AND ma.status = 'approved'
       FOR UPDATE OF m, ma`,
      [email],
    );
    if (result.rows.length !== 1) throw new Error('Exactly one approved linked merchant application is required');
    const record = result.rows[0];
    if (!record.user_id) throw new Error('Merchant has no linked owner account');

    const place = locationCode(record.geographic_area || record.barangay || record.city_municipality || record.address);
    let storeId = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `WKM-${place}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const existing = await client.query(
        'SELECT 1 FROM merchants WHERE merchant_code = $1 UNION ALL SELECT 1 FROM merchant_applications WHERE merchant_code = $1 LIMIT 1',
        [candidate],
      );
      if (existing.rowCount === 0) { storeId = candidate; break; }
    }
    if (!storeId) throw new Error('Unable to generate a unique Store ID');

    const temporaryPassword = `Wk!${randomBytes(9).toString('base64url')}`;
    const recoveryKey = `WKR-${randomBytes(18).toString('base64url')}`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await client.query('UPDATE merchants SET merchant_code = $1, updated_at = NOW() WHERE id = $2', [storeId, record.merchant_id]);
    await client.query(
      'UPDATE merchant_applications SET merchant_code = $1, temporary_password = $2, recovery_key = $3, updated_at = NOW() WHERE id = $4',
      [storeId, temporaryPassword, recoveryKey, record.application_id],
    );
    await client.query(
      `UPDATE users SET password = $1, must_change_password = TRUE, role = 'merchant',
              is_active = TRUE, is_verified = TRUE, status = 'active', updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, record.user_id],
    );
    await client.query('COMMIT');

    console.log(JSON.stringify({ merchant: record.name, email, storeId, temporaryPassword, recoveryKey }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
