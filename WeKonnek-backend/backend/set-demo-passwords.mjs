/**
 * Sets up demo users with passwords for local development.
 * Run: node set-demo-passwords.mjs
 */
import bcrypt from 'bcryptjs';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || `postgresql://${process.env.USER}@localhost:5432/wekonnek`;

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const DEMO_USERS = [
  { email: 'admin@wekonnek.com', phone: '+639170000001', firstName: 'Admin', lastName: 'User', role: 'admin', password: 'admin123' },
  { email: 'merchant@wekonnek.com', phone: '+639170000002', firstName: 'Merchant', lastName: 'Demo', role: 'merchant', password: 'merchant123' },
  { email: 'customer@wekonnek.com', phone: '+639170000003', firstName: 'Juan', lastName: 'Dela Cruz', role: 'customer', password: 'customer123' },
  { email: 'staff@wekonnek.com', phone: '+639170000006', firstName: 'Staff', lastName: 'Member', role: 'staff', password: 'staff123' },
  { email: 'coordinator@wekonnek.com', phone: '+639170000005', firstName: 'Zone', lastName: 'Coordinator', role: 'staff', password: 'coordinator123' },
];

async function main() {
  console.log('Setting up demo users...\n');

  for (const u of DEMO_USERS) {
    const hash = await bcrypt.hash(u.password, 10);

    // Check if user exists by email
    const existing = await pool.query('SELECT id, email, role FROM users WHERE email = $1', [u.email]);

    if (existing.rows.length > 0) {
      // Update password
      await pool.query(
        'UPDATE users SET password = $1, role = $2, is_verified = true, is_active = true WHERE email = $3',
        [hash, u.role, u.email],
      );
      console.log(`  Updated: ${u.email} (${u.role}) → password: ${u.password}`);
    } else {
      // Insert new user
      await pool.query(
        `INSERT INTO users (id, first_name, last_name, email, phone, password, role, is_verified, is_active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, true)`,
        [u.firstName, u.lastName, u.email, u.phone, hash, u.role]
      );
      console.log(`  Created: ${u.email} (${u.role}) → password: ${u.password}`);
    }
  }

  console.log('\nDemo accounts ready:');
  console.log('  Admin:    admin@wekonnek.com    / admin123');
  console.log('  Merchant: merchant@wekonnek.com / merchant123');
  console.log('  Customer: customer@wekonnek.com / customer123');
  console.log('  Staff:    staff@wekonnek.com    / staff123');
  console.log('  Coordinator: coordinator@wekonnek.com / coordinator123');

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
