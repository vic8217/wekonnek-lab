import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

type Catalogue = {
  productId: number;
  image: string;
  sourceType?: 'ORIGINAL' | 'PRODUCT_STUDIO_CLEAN' | 'AI_MODEL' | 'MANNEQUIN';
};
type Query = {
  id: string;
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'REVIEW_REQUIRED';
  mode: 'EXACT_PRODUCT' | 'SIMILAR_PRODUCT' | 'REVIEW_REQUIRED';
  queryImage: string;
  expectedProductIds: number[];
};
type Dataset = {
  datasetVersion: string;
  catalogue: Catalogue[];
  queries: Query[];
};
const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const maxBytes = 20 * 1024 * 1024;
const imageFiles = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter(
      (item) => item.isFile() && allowed.has(extname(item.name).toLowerCase()),
    )
    .map((item) => item.name)
    .sort();
const hash = (input: Buffer) =>
  createHash('sha256').update(input).digest('hex');

async function validate(dataset: Dataset, root: string) {
  const errors: string[] = [];
  if (!dataset.datasetVersion) errors.push('datasetVersion is required');
  if (!dataset.catalogue.length) errors.push('catalogue is empty');
  if (!dataset.queries.length) errors.push('queries are empty');
  const products = new Set<number>();
  const queryIds = new Set<string>();
  const catalogueHashes = new Set<string>();
  for (const item of dataset.catalogue) {
    if (!Number.isInteger(item.productId) || products.has(item.productId))
      errors.push(
        `invalid or duplicate catalogue productId: ${item.productId}`,
      );
    products.add(item.productId);
    const path = resolve(root, item.image);
    if (!allowed.has(extname(path).toLowerCase()) || !existsSync(path)) {
      errors.push(`missing/unsupported catalogue image: ${item.image}`);
      continue;
    }
    const content = await readFile(path);
    if (content.length > maxBytes)
      errors.push(`catalogue image over 20 MB: ${item.image}`);
    catalogueHashes.add(hash(content));
  }
  for (const query of dataset.queries) {
    if (!query.id || queryIds.has(query.id))
      errors.push(`invalid or duplicate query id: ${query.id}`);
    queryIds.add(query.id);
    if (
      query.category === 'REVIEW_REQUIRED' ||
      query.difficulty === 'REVIEW_REQUIRED' ||
      query.mode === 'REVIEW_REQUIRED'
    )
      errors.push(`query requires review: ${query.id}`);
    if (
      !query.expectedProductIds.length ||
      query.expectedProductIds.some((id) => !products.has(id))
    )
      errors.push(`query expectedProductIds invalid: ${query.id}`);
    const path = resolve(root, query.queryImage);
    if (!allowed.has(extname(path).toLowerCase()) || !existsSync(path)) {
      errors.push(`missing/unsupported query image: ${query.queryImage}`);
      continue;
    }
    const content = await readFile(path);
    if (content.length > maxBytes)
      errors.push(`query image over 20 MB: ${query.queryImage}`);
    if (catalogueHashes.has(hash(content)))
      errors.push(`query duplicates catalogue bytes: ${query.id}`);
  }
  if (
    dataset.queries.length >
    Number(process.env.VISUAL_SEARCH_BENCHMARK_MAX_QUERIES || 100)
  )
    errors.push('query count exceeds VISUAL_SEARCH_BENCHMARK_MAX_QUERIES');
  if (errors.length)
    throw new Error(`Dataset validation failed:\n- ${errors.join('\n- ')}`);
}

async function main() {
  const validateOnly = process.argv.includes('--validate');
  const target = process.argv.filter((arg) => !arg.startsWith('--'))[2];
  if (!target)
    throw new Error(
      'Usage: npm run visual-search:dataset -- [--validate] <fixture-directory-or-dataset.json>',
    );
  const manifest = target.endsWith('.json')
    ? resolve(target)
    : resolve(target, 'dataset.json');
  const root = dirname(manifest);
  if (validateOnly) {
    await validate(
      JSON.parse(await readFile(manifest, 'utf8')) as Dataset,
      root,
    );
    console.log(
      'Dataset validation passed (local only; zero Vertex requests).',
    );
    return;
  }
  const existing = existsSync(manifest)
    ? (JSON.parse(await readFile(manifest, 'utf8')) as Partial<Dataset>)
    : {};
  const catalogueFiles = await imageFiles(join(root, 'catalogue'));
  const queryFiles = await imageFiles(join(root, 'queries'));
  const existingCatalogue = new Map(
    (existing.catalogue || []).map((item) => [item.image, item]),
  );
  let nextId =
    Math.max(
      100000,
      ...(existing.catalogue || []).map((item) => item.productId || 0),
    ) + 1;
  const catalogue = catalogueFiles.map(
    (file) =>
      existingCatalogue.get(`catalogue/${file}`) || {
        productId: nextId++,
        image: `catalogue/${file}`,
        sourceType: 'ORIGINAL' as const,
      },
  );
  const existingQueries = new Map(
    (existing.queries || []).map((item) => [item.queryImage, item]),
  );
  const queries = queryFiles.map<Query>(
    (file) =>
      existingQueries.get(`queries/${file}`) || {
        id: basename(file, extname(file)),
        queryImage: `queries/${file}`,
        category: 'REVIEW_REQUIRED',
        difficulty: 'REVIEW_REQUIRED' as const,
        mode: 'REVIEW_REQUIRED' as const,
        expectedProductIds: [],
      },
  );
  const dataset: Dataset = {
    datasetVersion: existing.datasetVersion || basename(root),
    catalogue,
    queries,
  };
  await writeFile(manifest, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(
    `Updated ${manifest}. Review all query placeholders before validation.`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Dataset tool failed');
  process.exitCode = 1;
});
