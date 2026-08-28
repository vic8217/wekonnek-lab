# Visual Search — ON HOLD

Put on hold: 2026-08-28.

Completed: provider-neutral Visual Search boundary, deterministic mock, secured but disabled customer API foundation, Vertex `multimodalembedding@001` POC adapter, local benchmark tooling, and reviewed `vertex-poc-v1` fixtures.

Not implemented: paid Vertex run, production catalogue indexing, vector storage/pgvector, migrations, customer camera UI, deployment, or customer activation.

Last locally validated dataset: 50 catalogue images; 25 queries; 13 `EXACT_PRODUCT`; 12 `SIMILAR_PRODUCT`; 75 expected Vertex image operations; estimated POC embedding cost USD 0.0075.

Resume only with approved development assets, Google Cloud billing/project, Vertex AI API enabled, ADC, a 512-dimension dry-run, reviewed cost, and explicit `VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=true`. A successful POC is not production approval.

Safety defaults remain `VISUAL_SEARCH_ENABLED=false`, `VISUAL_SEARCH_PROVIDER=mock`, and `VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=false`.
