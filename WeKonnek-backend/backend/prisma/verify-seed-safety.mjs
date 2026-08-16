import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalogUrl = new URL('./reference-data/catalog.sql', import.meta.url);
const catalogSql = await readFile(catalogUrl, 'utf8');

assert.doesNotMatch(catalogSql, /DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA)/i);
assert.equal((catalogSql.match(/ON CONFLICT \(slug\) DO UPDATE SET/g) || []).length, 1);
assert.equal((catalogSql.match(/ON CONFLICT \(category_id, slug\) DO UPDATE SET/g) || []).length, 10);
assert.equal((catalogSql.match(/WHERE categories\.owner_merchant_id IS NULL/g) || []).length, 1);
assert.equal((catalogSql.match(/WHERE sub_categories\.owner_merchant_id IS NULL/g) || []).length, 10);

const canonicalSubCategories = [];
const runtimeSql = catalogSql.replace(/WHERE c\.slug =/g, 'WHERE c.owner_merchant_id IS NULL AND c.slug =');
for (const block of runtimeSql.matchAll(/CROSS JOIN \(VALUES([\s\S]*?)\) AS sub\([\s\S]*?WHERE c\.owner_merchant_id IS NULL AND c\.slug = '([^']+)'/g)) {
  for (const row of block[1].matchAll(/\(\s*'(?:''|[^'])*'\s*,\s*'((?:''|[^'])*)'/g)) {
    canonicalSubCategories.push({ categorySlug: block[2], slug: row[1] });
  }
}
assert.equal(canonicalSubCategories.length, 121);

const seedRecord = (existing, canonical, type) => {
  if (!existing) return { ...canonical, id: 1, ownerMerchantId: null };
  if (existing.ownerMerchantId !== null) {
    throw new Error(`merchant-owned ${type} collision; slug = "${existing.slug}"; id = ${existing.id}; ownerMerchantId = ${existing.ownerMerchantId}`);
  }
  return { ...existing, ...canonical, ownerMerchantId: null };
};

// Case A: missing category is created as global.
assert.deepEqual(seedRecord(null, { slug: 'food', name: 'Food' }, 'category'), { id: 1, slug: 'food', name: 'Food', ownerMerchantId: null });

// Case B: an existing global category is updated idempotently.
const globalCategory = { id: 9, slug: 'food', name: 'Old', ownerMerchantId: null };
const categoryOnce = seedRecord(globalCategory, { slug: 'food', name: 'Food' }, 'category');
assert.deepEqual(seedRecord(categoryOnce, { slug: 'food', name: 'Food' }, 'category'), categoryOnce);

// Case C: an owned category aborts and remains unchanged.
const ownedCategory = { id: 12, slug: 'food', name: 'Merchant Food', ownerMerchantId: 7 };
assert.throws(() => seedRecord(ownedCategory, { slug: 'food', name: 'Food' }, 'category'), /ownerMerchantId = 7/);
assert.deepEqual(ownedCategory, { id: 12, slug: 'food', name: 'Merchant Food', ownerMerchantId: 7 });

// Case D: an existing global subcategory is updated idempotently.
const globalSubCategory = { id: 30, slug: 'fast-food', name: 'Old', ownerMerchantId: null };
const subOnce = seedRecord(globalSubCategory, { slug: 'fast-food', name: 'Fast Food' }, 'subcategory');
assert.deepEqual(seedRecord(subOnce, { slug: 'fast-food', name: 'Fast Food' }, 'subcategory'), subOnce);

// Case E: an owned subcategory aborts and remains unchanged.
const ownedSubCategory = { id: 31, slug: 'fast-food', name: 'My Menu', ownerMerchantId: 8 };
assert.throws(() => seedRecord(ownedSubCategory, { slug: 'fast-food', name: 'Fast Food' }, 'subcategory'), /ownerMerchantId = 8/);
assert.deepEqual(ownedSubCategory, { id: 31, slug: 'fast-food', name: 'My Menu', ownerMerchantId: 8 });

// Case F: three runs preserve the same logical keys and counts.
let logicalRows = new Map();
for (let run = 0; run < 3; run += 1) {
  for (const canonical of canonicalSubCategories) {
    const key = `${canonical.categorySlug}\u0000${canonical.slug}`;
    logicalRows.set(key, seedRecord(logicalRows.get(key) ?? null, canonical, 'subcategory'));
  }
}
assert.equal(logicalRows.size, 121);

console.log('✓ Production seed collision and idempotency safety cases A–F passed');
