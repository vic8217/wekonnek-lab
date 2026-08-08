import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The temporary customer seed is disabled in production.');
}

const rawUrl = process.env.DATABASE_URL ?? '';
const pool = new Pool({
  connectionString: rawUrl.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const password = await bcrypt.hash('0000', 12);
  const user = await prisma.user.upsert({
    where: { phone: '+639175403565' },
    update: {
      password,
      role: UserRole.customer,
      isActive: true,
      isVerified: true,
      status: 'active',
    },
    create: {
      phone: '+639175403565',
      password,
      firstName: 'Test',
      lastName: 'Customer',
      role: UserRole.customer,
      isActive: true,
      isVerified: true,
      status: 'active',
    },
    select: { id: true, phone: true, role: true, isActive: true, isVerified: true },
  });
  console.log('Temporary customer ready:', user);
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
