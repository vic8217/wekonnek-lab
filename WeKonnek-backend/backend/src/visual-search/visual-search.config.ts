export const visualSearchConfig = () => ({
  enabled: process.env.VISUAL_SEARCH_ENABLED === 'true',
  maxBytes: Number(process.env.VISUAL_SEARCH_MAX_BYTES || 10 * 1024 * 1024),
  provider: process.env.VISUAL_SEARCH_PROVIDER || 'mock',
  allowExternalBenchmark: process.env.VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK === 'true',
  benchmarkMaxQueries: Number(process.env.VISUAL_SEARCH_BENCHMARK_MAX_QUERIES || 100),
});
