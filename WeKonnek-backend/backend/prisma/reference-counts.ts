import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const rawUrl = process.env.DATABASE_URL ?? '';
if (!rawUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: rawUrl.replace(/[?&]sslmode=[^&]*/g, ''), ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const counts = {
    globalCategories: await prisma.category.count({ where: { ownerMerchantId: null } }),
    globalSubCategories: await prisma.subCategory.count({ where: { ownerMerchantId: null, category: { ownerMerchantId: null } } }),
    merchantCategories: await prisma.merchantCategory.count(),
    merchantSubCategories: await prisma.merchantSubCategory.count(),
    deliveryZones: await prisma.zone.count(),
    managementZones: await prisma.managementZone.count(),
    managementZoneCoverages: await prisma.managementZoneCoverage.count(),
    subscriptionPlans: await prisma.subscriptionPlanDefinition.count(),
    subscriptionAddOns: await prisma.subscriptionAddOnPackage.count(),
    propertyTypes: await prisma.propertyType.count(),
    propertyListingPlans: await prisma.propertyListingPlan.count(),
  };
  console.table(counts);
}

main().finally(async () => { await prisma.$disconnect(); await pool.end(); });
