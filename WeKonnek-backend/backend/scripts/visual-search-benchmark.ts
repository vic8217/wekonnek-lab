import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { retrievalMetrics } from '../src/visual-search/visual-search-benchmark.metrics';
import {
  dotProduct,
  VertexProviderError,
  VertexVisualSearchProvider,
  vertexConfigFromEnvironment,
} from '../src/visual-search/providers/vertex/vertex-visual-search.provider';

type Query = {
  id: string;
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  mode: 'EXACT_PRODUCT' | 'SIMILAR_PRODUCT';
  queryImage: string;
  expectedProductIds: number[];
};
type CatalogueImage = {
  productId: number;
  image: string;
  sourceType?: 'ORIGINAL' | 'PRODUCT_STUDIO_CLEAN' | 'AI_MODEL' | 'MANNEQUIN';
};
const DEFAULT_MAX_QUERIES = 100;
const DEFAULT_MAX_VERTEX_COST_USD = 1;
const MAX_VERTEX_IMAGE_BYTES = 20 * 1024 * 1024;
const usage =
  'Usage: npm run visual-search:benchmark -- [--dry-run] [--allow-large-benchmark] <dataset-path>';

function parseArgs(args: string[]) {
  const dryRun = args.includes('--dry-run');
  const allowLargeBenchmark = args.includes('--allow-large-benchmark');
  const datasetPath =
    args.find((arg) => !arg.startsWith('--')) ||
    'visual-search-benchmark.example.json';
  if (args.filter((arg) => !arg.startsWith('--')).length > 1)
    throw new Error(usage);
  return { dryRun, allowLargeBenchmark, datasetPath };
}

function providerPlan(providerId: string, catalogue: CatalogueImage[]) {
  if (providerId === 'mock')
    return {
      external: false,
      credentialsConfigured: true,
      catalogueImageCount: undefined,
      indexOperations: 0,
    };
  if (providerId === 'vertex') {
    let config: ReturnType<typeof vertexConfigFromEnvironment> | undefined;
    try {
      config = vertexConfigFromEnvironment();
    } catch {
      /* dry-run reports readiness without failing */
    }
    const credentialPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      resolve(homedir(), '.config/gcloud/application_default_credentials.json');
    return {
      external: true,
      credentialsConfigured: Boolean(config) && existsSync(credentialPath),
      catalogueImageCount: catalogue.length,
      indexOperations: catalogue.length,
      config,
      costPerImageUsd: 0.0001,
    };
  }
  return {
    external: true,
    credentialsConfigured: false,
    catalogueImageCount: undefined,
    indexOperations: undefined,
  };
}

async function validateDataset(
  dataset: {
    datasetVersion?: string;
    queries?: Query[];
    catalogue?: CatalogueImage[];
  },
  root: string,
  requireCatalogue: boolean,
) {
  if (
    !dataset.datasetVersion ||
    !Array.isArray(dataset.queries) ||
    (requireCatalogue &&
      (!Array.isArray(dataset.catalogue) || !dataset.catalogue.length))
  )
    throw new Error(
      'Invalid Visual Search benchmark dataset: datasetVersion, queries, and a non-empty catalogue are required for a Vertex run.',
    );
  const queryIds = new Set<string>();
  const catalogue = dataset.catalogue || [];
  const productIds = new Set(catalogue.map((item) => item.productId));
  if (
    catalogue.some(
      (item) =>
        !Number.isInteger(item.productId) || item.productId < 1 || !item.image,
    )
  )
    throw new Error(
      'Invalid Visual Search benchmark dataset: catalogue product IDs and images are required.',
    );
  const catalogueHashes = new Set<string>();
  if (!requireCatalogue) return;
  for (const item of catalogue) {
    const content = await readFile(resolve(root, item.image));
    if (content.length > MAX_VERTEX_IMAGE_BYTES)
      throw new Error(
        `Catalogue image exceeds Vertex 20 MB limit: ${item.image}`,
      );
    catalogueHashes.add(createHash('sha256').update(content).digest('hex'));
  }
  for (const query of dataset.queries) {
    if (
      !query.id ||
      queryIds.has(query.id) ||
      !query.category ||
      !query.queryImage ||
      !query.expectedProductIds?.length ||
      !['EXACT_PRODUCT', 'SIMILAR_PRODUCT'].includes(query.mode)
    )
      throw new Error(`Invalid benchmark query: ${query.id || '(missing id)'}`);
    queryIds.add(query.id);
    if (
      requireCatalogue &&
      query.expectedProductIds.some((id) => !productIds.has(id))
    )
      throw new Error(
        `Query ${query.id} references a Product ID absent from catalogue.`,
      );
    const content = await readFile(resolve(root, query.queryImage));
    if (content.length > MAX_VERTEX_IMAGE_BYTES)
      throw new Error(
        `Query image exceeds Vertex 20 MB limit: ${query.queryImage}`,
      );
    if (catalogueHashes.has(createHash('sha256').update(content).digest('hex')))
      throw new Error(
        `Query ${query.id} duplicates catalogue image bytes; use a distinct customer-like image.`,
      );
  }
}

async function main() {
  const { dryRun, allowLargeBenchmark, datasetPath } = parseArgs(
    process.argv.slice(2),
  );
  const resolvedDatasetPath = resolve(datasetPath);
  const dataset = JSON.parse(await readFile(resolvedDatasetPath, 'utf8')) as {
    datasetVersion?: string;
    queries?: Query[];
    catalogue?: CatalogueImage[];
  };
  const catalogue = dataset.catalogue || [];
  const providerId = process.env.VISUAL_SEARCH_PROVIDER || 'mock';
  await validateDataset(
    dataset,
    dirname(resolvedDatasetPath),
    providerId === 'vertex',
  );
  const queries = dataset.queries || [];
  const plan = providerPlan(providerId, catalogue);
  const maxQueries = Number(
    process.env.VISUAL_SEARCH_BENCHMARK_MAX_QUERIES || DEFAULT_MAX_QUERIES,
  );
  if (!Number.isInteger(maxQueries) || maxQueries < 1)
    throw new Error(
      'VISUAL_SEARCH_BENCHMARK_MAX_QUERIES must be a positive integer',
    );
  const dryRunReport = {
    provider: providerId,
    model: plan.config?.model,
    dimension: plan.config?.dimension,
    dataset: datasetPath,
    queryCount: queries.length,
    catalogueImageCount:
      plan.catalogueImageCount ??
      'unavailable — provider adapter not configured',
    expectedOperations: {
      catalogueImageEmbeddingCalls:
        plan.indexOperations ?? 'unavailable — provider adapter not configured',
      queryImageEmbeddingCalls: queries.length,
      totalImageEmbeddingCalls:
        typeof plan.indexOperations === 'number'
          ? plan.indexOperations + queries.length
          : 'unavailable — provider adapter not configured',
    },
    externalCallsWouldOccur: plan.external,
    providerCredentialsConfigured: plan.credentialsConfigured,
    externalBenchmarkPermissionEnabled:
      process.env.VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK === 'true',
    maxQueries,
    estimatedCost:
      plan.costPerImageUsd != null && typeof plan.indexOperations === 'number'
        ? {
            currency: 'USD',
            amount: (
              plan.costPerImageUsd *
              (plan.indexOperations + queries.length)
            ).toFixed(4),
            label: 'estimated, not invoiced; Vertex price reviewed 2026-08-28',
          }
        : 'unavailable — provider pricing not configured',
  };
  if (dryRun) {
    console.log(JSON.stringify(dryRunReport, null, 2));
    return;
  }
  if (
    plan.external &&
    process.env.VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK !== 'true'
  )
    throw new Error(
      'External Visual Search benchmarks are disabled. Set VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=true for an intentional POC run.',
    );
  const maxVertexCost = Number(
    process.env.VISUAL_SEARCH_BENCHMARK_MAX_COST_USD ||
      DEFAULT_MAX_VERTEX_COST_USD,
  );
  const estimatedVertexCost =
    plan.costPerImageUsd != null
      ? plan.costPerImageUsd * (catalogue.length + queries.length)
      : undefined;
  if (
    providerId === 'vertex' &&
    (!Number.isFinite(maxVertexCost) || maxVertexCost <= 0)
  )
    throw new Error('VISUAL_SEARCH_BENCHMARK_MAX_COST_USD must be positive.');
  if (
    providerId === 'vertex' &&
    estimatedVertexCost != null &&
    estimatedVertexCost > maxVertexCost &&
    process.env.VISUAL_SEARCH_ALLOW_COST_OVERRIDE !== 'true'
  )
    throw new Error(
      `Estimated Vertex benchmark cost USD ${estimatedVertexCost.toFixed(4)} exceeds VISUAL_SEARCH_BENCHMARK_MAX_COST_USD=${maxVertexCost}. Set VISUAL_SEARCH_ALLOW_COST_OVERRIDE=true only after reviewing cost.`,
    );
  if (plan.external && queries.length > maxQueries && !allowLargeBenchmark)
    throw new Error(
      `External benchmark has ${queries.length} queries, exceeding VISUAL_SEARCH_BENCHMARK_MAX_QUERIES=${maxQueries}. Re-run with --allow-large-benchmark only after reviewing expected cost.`,
    );
  if (providerId === 'vertex') {
    if (!plan.credentialsConfigured)
      throw new Error(
        'Vertex benchmark configuration is incomplete. Run --dry-run for readiness details.',
      );
    if (!catalogue.length)
      throw new Error(
        'Vertex benchmark requires a non-empty catalogue fixture list.',
      );
    const provider = new VertexVisualSearchProvider();
    const root = dirname(resolvedDatasetPath);
    const indexed = await Promise.all(
      catalogue.map(async (item) => ({
        productId: item.productId,
        embedding: await provider.createQueryEmbedding(
          await readFile(resolve(root, item.image)),
        ),
      })),
    );
    const measured: Array<
      Query & {
        ranked: number[];
        candidates?: Array<{ productId: number; score: number }>;
        failure?: string;
      }
    > = await Promise.all(
      queries.map(async (query) => {
        try {
          const queryEmbedding = await provider.createQueryEmbedding(
            await readFile(resolve(root, query.queryImage)),
          );
          if (!queryEmbedding.vector)
            throw new Error('Vertex returned no vector');
          const ranked = indexed
            .map((item) => ({
              productId: item.productId,
              score: dotProduct(
                queryEmbedding.vector!,
                item.embedding.vector || [],
              ),
            }))
            .sort((a, b) => b.score - a.score);
          return {
            ...query,
            ranked: ranked.map((item) => item.productId),
            candidates: ranked,
          };
        } catch (error) {
          return {
            ...query,
            ranked: [] as number[],
            failure:
              error instanceof VertexProviderError
                ? error.category
                : 'BENCHMARK_ERROR',
          };
        }
      }),
    );
    const failures = measured
      .filter((query) => query.failure)
      .map((query) => ({ id: query.id, category: query.failure }));
    const report = {
      benchmarkVersion: 1,
      datasetVersion: dataset.datasetVersion,
      provider: {
        id: providerId,
        model: plan.config!.model,
        dimension: plan.config!.dimension,
        metric: 'DOT_PRODUCT',
      },
      operations: {
        catalogueImageEmbeddingCalls: catalogue.length,
        queryImageEmbeddingCalls: queries.length,
        totalImageEmbeddingCalls: catalogue.length + queries.length,
        estimatedCostUsd: (
          0.0001 *
          (catalogue.length + queries.length)
        ).toFixed(4),
      },
      summary: {
        queryCount: measured.length,
        successfulQueries: measured.length - failures.length,
        failedQueries: failures.length,
        ...retrievalMetrics(measured),
      },
      failures,
    };
    const output = `visual-search-benchmark-${Date.now()}.json`;
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`Report: ${output}`);
    return;
  }
  if (plan.external)
    throw new Error(
      `Visual Search provider "${providerId}" is unavailable: no adapter is configured. Run --dry-run to inspect the POC plan.`,
    );
  // The deterministic mock remains deliberately local; real calls are added only by a selected provider adapter.
  const measured = queries.map((query) => ({
    ...query,
    ranked: [] as number[],
  }));
  const report = {
    benchmarkVersion: 1,
    datasetVersion: dataset.datasetVersion,
    provider: { id: providerId },
    summary: {
      queryCount: measured.length,
      successfulQueries: 0,
      failedQueries: measured.length,
      ...retrievalMetrics(measured),
    },
    failures: measured.map((query) => ({
      id: query.id,
      category: 'PROVIDER_NOT_CONFIGURED',
    })),
  };
  const output = `visual-search-benchmark-${Date.now()}.json`;
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${output}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 1;
});
