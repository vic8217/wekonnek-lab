import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { NCR_COUNCIL_AREAS } from './reference-data/ncr-council-zones';

const rawUrl = process.env.DATABASE_URL ?? '';
if (!rawUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: rawUrl.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const NCR_CITY_NAMES: Record<string, string> = {
  '133900000': 'Manila', '137404000': 'Quezon City', '137501000': 'Caloocan',
  '137602000': 'Makati', '137402000': 'Marikina', '137604000': 'Paranaque',
  '137504000': 'Valenzuela', '137403000': 'Pasig', '137401000': 'Mandaluyong',
  '137605000': 'Pasay', '137601000': 'Las Pinas', '137603000': 'Muntinlupa',
  '137502000': 'Malabon', '137503000': 'Navotas', '137405000': 'San Juan',
  '137607000': 'Taguig', '137606000': 'Pateros',
};

const zoneCode = (cityCode: string, district: string) =>
  `NCR-${cityCode}-${district.replace(/[^a-z0-9]+/gi, '').toUpperCase()}`;

async function seedCatalog() {
  const systemSlugs = ['food', 'restaurants', 'groceries', 'pharmacy', 'shops', 'services', 'wellness', 'deals', 'events', 'bazaar', 'property'];
  const catalogPath = resolve(__dirname, 'reference-data/catalog.sql');
  const catalogSql = (await readFile(catalogPath, 'utf8'))
    .replace(/WHERE c\.slug =/g, 'WHERE c.owner_merchant_id IS NULL AND c.slug =');
  const expectedSubCategories = new Set<string>();
  for (const block of catalogSql.matchAll(/CROSS JOIN \(VALUES([\s\S]*?)\) AS sub\([\s\S]*?WHERE c\.owner_merchant_id IS NULL AND c\.slug = '([^']+)'/g)) {
    for (const row of block[1].matchAll(/\(\s*'(?:''|[^'])*'\s*,\s*'((?:''|[^'])*)'/g)) {
      expectedSubCategories.add(`${block[2]}\u0000${row[1].replaceAll("''", "'")}`);
    }
  }
  if (expectedSubCategories.size !== 121) {
    throw new Error(`Production seed aborted: expected 121 canonical subcategories but parsed ${expectedSubCategories.size}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Blocks concurrent taxonomy writes until collision validation and every
    // canonical category/subcategory write either commits or rolls back.
    await client.query('LOCK TABLE categories, sub_categories IN SHARE ROW EXCLUSIVE MODE');

    const categoryCollisions = await client.query<{
      id: number; slug: string; owner_merchant_id: number;
    }>(`
      SELECT id, slug, owner_merchant_id
      FROM categories
      WHERE slug = ANY($1::text[]) AND owner_merchant_id IS NOT NULL
      ORDER BY slug
    `, [systemSlugs]);
    if (categoryCollisions.rows[0]) {
      const collision = categoryCollisions.rows[0];
      throw new Error(
        `Production seed aborted: merchant-owned category collision; slug = "${collision.slug}"; categoryId = ${collision.id}; ownerMerchantId = ${collision.owner_merchant_id}`,
      );
    }

    const ownedSubCategories = await client.query<{
      id: number; slug: string; owner_merchant_id: number; category_slug: string;
    }>(`
      SELECT sc.id, sc.slug, sc.owner_merchant_id, c.slug AS category_slug
      FROM sub_categories sc
      JOIN categories c ON c.id = sc.category_id
      WHERE c.slug = ANY($1::text[])
        AND c.owner_merchant_id IS NULL
        AND sc.owner_merchant_id IS NOT NULL
      ORDER BY c.slug, sc.slug
    `, [systemSlugs]);
    const subCategoryCollision = ownedSubCategories.rows.find(row =>
      expectedSubCategories.has(`${row.category_slug}\u0000${row.slug}`),
    );
    if (subCategoryCollision) {
      throw new Error(
        `Production seed aborted: merchant-owned subcategory collision; slug = "${subCategoryCollision.slug}"; subcategoryId = ${subCategoryCollision.id}; ownerMerchantId = ${subCategoryCollision.owner_merchant_id}`,
      );
    }

    await client.query(catalogSql);
    await client.query(`
      INSERT INTO categories (name, slug, description, icon, is_active, display_order, owner_merchant_id)
      VALUES ('Property', 'property', 'Homes, condominiums, lots and commercial spaces for sale or rent', '🏠', true, 11, NULL)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        is_active = EXCLUDED.is_active,
        display_order = EXCLUDED.display_order,
        updated_at = CURRENT_TIMESTAMP
      WHERE categories.owner_merchant_id IS NULL
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const [categories, subCategories] = await Promise.all([
    prisma.category.count({ where: { slug: { in: systemSlugs }, ownerMerchantId: null } }),
    prisma.subCategory.count({ where: { category: { slug: { in: systemSlugs }, ownerMerchantId: null }, ownerMerchantId: null } }),
  ]);
  console.log(`✓ System categories seeded (${categories})`);
  console.log(`✓ System subcategories seeded (${subCategories})`);
}

async function seedManagementZones() {
  let zoneCount = 0;
  let coverageCount = 0;
  for (const [cityCode, districts] of Object.entries(NCR_COUNCIL_AREAS)) {
    const cityName = NCR_CITY_NAMES[cityCode];
    if (!cityName) throw new Error(`Missing city name for PSGC code ${cityCode}`);
    for (const [district, areas] of Object.entries(districts)) {
      const code = zoneCode(cityCode, district);
      const zone = await prisma.managementZone.upsert({
        where: { code },
        update: { name: `${cityName} · ${district}`, isActive: true },
        create: {
          name: `${cityName} · ${district}`,
          code,
          description: `WEKONNEK NCR local council coverage for ${cityName}`,
          isActive: true,
        },
      });
      await prisma.managementZoneCoverage.upsert({
        where: {
          zoneId_cityMunicipalityCode_congressionalDistrict: {
            zoneId: zone.id,
            cityMunicipalityCode: cityCode,
            congressionalDistrict: district,
          },
        },
        update: {
          regionCode: '130000000',
          regionName: 'National Capital Region (NCR)',
          provinceCode: null,
          provinceName: null,
          cityMunicipalityName: cityName,
          areas,
        },
        create: {
          zoneId: zone.id,
          regionCode: '130000000',
          regionName: 'National Capital Region (NCR)',
          provinceCode: null,
          provinceName: null,
          cityMunicipalityCode: cityCode,
          cityMunicipalityName: cityName,
          congressionalDistrict: district,
          areas,
        },
      });
      zoneCount += 1;
      coverageCount += 1;
    }
  }
  console.log(`✓ Management zones seeded (${zoneCount})`);
  console.log(`✓ Zone coverage records seeded (${coverageCount})`);
}

async function seedSystemSettings() {
  await prisma.coordinatorCommissionSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, rate: 0 },
  });
  console.log('✓ Default application settings seeded (1)');
}

async function main() {
  console.log('🌱 Starting WEKONNEK production seed');
  await seedCatalog();
  await seedManagementZones();
  await seedSystemSettings();
  console.log('✅ Production reference data seed completed');
}

main()
  .catch(error => {
    console.error('Production seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
