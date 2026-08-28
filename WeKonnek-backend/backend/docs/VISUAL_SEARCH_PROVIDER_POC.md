# Visual Search provider POC

> **STATUS: ON HOLD.** Feature development is intentionally paused. The architecture, Vertex POC adapter, benchmark tooling, and reviewed fixtures are preserved. No paid Vertex benchmark or production image-vector indexing has run. POC benchmarking is not customer-feature activation; customer Visual Search remains disabled by default.

> **Resume sequence:** confirm Google Cloud billing/project → enable Vertex AI API → configure ADC → run Vertex 512 dry-run → review operations/cost → explicitly authorize the external benchmark → run the controlled benchmark → review accuracy/latency/cost → decide whether to evaluate production indexing/storage. Only after that decision may pgvector/external-vector-index or customer activation be considered.

## Status

No real provider has been selected or configured. `mock` remains the default. Customer Visual Search stays disabled with `VISUAL_SEARCH_ENABLED=false`; a benchmark POC is independent from that switch.

## Required provider information before implementation

Obtain the provider's current official documentation or an approved account contact covering:

1. Exact image-to-image endpoint/SDK contract, or raw image embedding contract, including request and response schemas.
2. Authentication method and the provider-specific configuration variable names.
3. Whether it returns raw embeddings (dimension and similarity metric) and/or supports a provider-managed image index with stable external references.
4. Index, batch-index, query, delete, and reindex operations; idempotency and eventual-consistency behaviour.
5. Supported formats, image-size limits, timeout/retry guidance, rate limits, and SDK/REST availability.
6. Commercial-use terms, Philippines availability/restrictions, pricing (index, query, storage, commitment), and an account-approved POC budget.
7. Data retention, image/API-data training use, deletion controls, SLA/latency, and hosting/data-location documentation.

Do not infer any of those values from marketing material.

## Decision path

Provider documentation → technical compatibility → one POC adapter → same WeKonnek benchmark dataset → accuracy → latency → actual cost → decision.

The POC must use the existing domain filtering and public result DTO unchanged unless the provider proves a concrete incompatibility.

## Benchmark safety

```bash
npm run visual-search:benchmark -- --dry-run visual-search-benchmark.example.json
```

Dry run makes no provider calls. A future network provider needs `VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=true`; benchmarks over `VISUAL_SEARCH_BENCHMARK_MAX_QUERIES` (default 100) also need `--allow-large-benchmark`. The provider adapter must expose precise catalogue-index and query operation counts before it may run.

## Initial dataset

Target 50–100 approved development catalogue images; smaller sets are valid while assembling it. Suggested distribution: Apparel 20, Grocery/FMCG 20, Beverages 15, Beauty 10, Home 10, Pet/Other 5.

Use distinct customer-like query photos—not the catalogue file—with varied angle, crop, lighting, phone camera, background, and partial visibility. Include `EXACT_PRODUCT` packaged SKU cases and `SIMILAR_PRODUCT` apparel cases with multiple acceptable product IDs. Add hard negatives such as similarly coloured cans, striped polo/dress, shampoo/lotion bottles, and canned products with comparable packaging.

## Provider research — reviewed 2026-08-28

This research is for **image → product retrieval**, not image generation, virtual try-on, or product-studio work. The candidates below were shortlisted only where official documentation confirms image embeddings or image retrieval. Every candidate still requires the same WeKonnek benchmark; no documentation claim establishes retrieval accuracy for WeKonnek's exact-SKU or similar-product cases.

### Shortlist

1. **Google Cloud Vertex AI — `multimodalembedding@001`** (first POC): raw image embeddings, portable application-controlled search, documented per-image price, and a direct REST prediction API.
2. **AWS Bedrock — Amazon Titan Multimodal Embeddings G1 / `amazon.titan-embed-image-v1`** (second POC): raw image embeddings, on-demand invocation, documented image-to-image similarity purpose and strong AWS data controls.
3. **Azure Vision in Foundry Tools — Multimodal embeddings / Image Retrieval 4.0** (optional third): raw 1024-dimensional embeddings, with optional Azure AI Search managed-vector infrastructure.

All three preserve WeKonnek control over Product ID, merchant, branch availability, inventory, geography, and final ranking when used with WeKonnek-controlled vector search. None is a provider-managed *image* index in its embedding API. Azure AI Search is a separately provisioned managed vector-index option.

### Decision matrix

| Criterion | Vertex AI multimodalembedding@001 | Bedrock Titan Multimodal Embeddings G1 | Azure Vision Multimodal Embeddings |
| --- | --- | --- | --- |
| Image retrieval suitable | CONFIRMED — image vectors for downstream image search | CONFIRMED — official image-by-image similarity use case | CONFIRMED — vectorize image then retrieve nearest vectors |
| EXACT_PRODUCT potential | BENCHMARK_REQUIRED — packaging/OCR-like signals documented, SKU recall unproven | BENCHMARK_REQUIRED — generic similarity model, SKU recall unproven | BENCHMARK_REQUIRED — generic similarity model, SKU recall unproven |
| SIMILAR_PRODUCT potential | BENCHMARK_REQUIRED | BENCHMARK_REQUIRED | BENCHMARK_REQUIRED |
| Raw embeddings | Yes, response image vector | Yes, `embedding` float array | Yes, returned vector |
| Embedding dimension | 128, 256, 512, or 1408 | 256, 384, or 1024 (default) | 1024 |
| Similarity metric | Dot product is documented; do not treat score as calibrated probability | Euclidean L2 is documented by AWS for this model | Cosine or Euclidean are documented; retrieval relevance includes cosine plus optional metadata |
| Normalization requirement | Not documented; persist/query vectors unchanged and validate metric in benchmark | No normalization instruction found; use L2 initially and validate | Not documented; use the documented metric consistently for catalogue and query vectors |
| Provider-managed index | No image index in embedding API; Vertex AI Vector Search is separate managed vector infrastructure | No image index in InvokeModel; a separate AWS vector store/Knowledge Base is possible | Azure AI Search provides a separate managed vector index and Azure Vision vectorizer |
| Batch indexing | API batch behaviour for this model: REVIEW_REQUIRED | Batch inference is documented as an inference type; exact POC batching must be verified | Image Retrieval batch embedding: REVIEW_REQUIRED; Azure AI Search indexing is separate |
| Delete / update / reindex | WeKonnek-owned vector store responsibility | WeKonnek-owned vector store responsibility | WeKonnek-owned vectors, or Azure AI Search document/index lifecycle if selected |
| Authentication / REST | Google Cloud OAuth/IAM; REST `endpoints.predict` | AWS IAM-signed Bedrock Runtime `InvokeModel` | Azure resource key or Entra identity; REST vectorize endpoints |
| Formats / input limits | JPEG/PNG in REST schema; general guide also documents BMP/GIF/JPG/PNG and 20 MB; resolve against chosen endpoint before implementation | JPEG/PNG; 25 MB, 2048×2048 inference limit | <20 MB; >10×10 and <16,000×16,000 pixels |
| Published latency / SLA | BENCHMARK_REQUIRED | BENCHMARK_REQUIRED | BENCHMARK_REQUIRED |
| Commercial use | REVIEW_REQUIRED — paid API is documented, but marketplace/e-commerce terms and Philippines availability need legal/procurement confirmation | REVIEW_REQUIRED — paid API is documented, but marketplace/e-commerce terms and Philippines availability need legal/procurement confirmation | REVIEW_REQUIRED — paid service is documented, but marketplace/e-commerce terms and Philippines availability need legal/procurement confirmation |
| Data policy | DATA_POLICY_REVIEW_REQUIRED: Google says customer data is not used to train/fine-tune without permission; retention/location configuration must be selected and verified | Documented zero-data-retention/default controls; model/provider-specific account configuration must be confirmed | DATA_POLICY_REVIEW_REQUIRED: select region and review Azure service/data-residency terms before customer photos |
| Cost/index | $0.0001/image input (USD) for image embedding; vector storage separate | Current pricing page is source of truth; exact per-image price needs account/region confirmation | Not published as a single universal figure in consulted documentation; obtain regional Azure quote |
| Cost/query | Same $0.0001/image input (USD) | Current pricing page is source of truth; exact per-image price needs account/region confirmation | Not published as a single universal figure in consulted documentation; obtain regional Azure quote |
| Storage cost | No embedding storage in embedding API; chosen vector storage separately billed | No embedding storage in InvokeModel; chosen vector storage separately billed | Raw-vector storage separate; Azure AI Search billed separately if used |
| Vendor lock-in | MEDIUM — raw vectors are portable, but model-specific and Google API/IAM are not | MEDIUM — raw vectors are portable, but model-specific and AWS IAM are not | MEDIUM for raw vectors; HIGH if coupled to Azure AI Search integrated vectorization |
| 100K images | LIKELY_SUITABLE with an independently selected vector store | LIKELY_SUITABLE with an independently selected vector store | LIKELY_SUITABLE with an independently selected vector store / Azure AI Search |
| 1M images | REQUIRES_VALIDATION — vector-store capacity, ingest throughput and cost are outside embedding API | REQUIRES_VALIDATION — vector-store capacity, ingest throughput and cost are outside embedding API | REQUIRES_VALIDATION — Search SKU/vector capacity and cost must be sized |
| 10M images | REQUIRES_VALIDATION — requires dedicated vector/search capacity design | REQUIRES_VALIDATION — requires dedicated vector/search capacity design | REQUIRES_VALIDATION — requires dedicated Search capacity design |
| WeKonnek benchmark required | YES | YES | YES |

### Provider details and official sources

#### 1. Vertex AI `multimodalembedding@001` — recommended first POC

The [multimodal embedding guide](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings) documents image/text/video embeddings, 1408 dimensions, input constraints, and dot-product ranking guidance. The [REST prediction reference](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.endpoints/predict) confirms the supported prediction route; the [API schema](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-embeddings-api) documents image-vector output and selectable 128/256/512/1408 dimensions. Use the final current model documentation—not this research note—to confirm the model remains available before an adapter is written.

* **Architecture:** raw vector only for this POC; WeKonnek retains vector search and all domain filtering. No `externalRef`, provider image upload, provider delete, or provider index is needed.
* **Cost:** the [Vertex AI pricing page](https://cloud.google.com/vertex-ai/generative-ai/pricing) lists image multimodal embedding at **USD $0.0001 per image input**. Indexing and query embedding therefore have the same documented input charge; storage is the chosen vector store's cost. Pricing reviewed 2026-08-28.
* **Data:** [Vertex AI zero data retention](https://cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention) says Google will not use customer data to train or fine-tune models without prior permission/instruction, but also explains retention/configuration considerations. Customer-photo handling remains **DATA_POLICY_REVIEW_REQUIRED** until the selected Vertex location, logging/retention settings, and DPA are approved.
* **Operations:** exact maximum request size/formats and RPM differ among official pages and endpoint schemas; the adapter checklist must re-verify the exact selected endpoint. No published latency/SLA is recorded here: **BENCHMARK_REQUIRED**.

#### 2. Amazon Bedrock Titan Multimodal Embeddings G1 — recommended second POC

The [model guide](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html) explicitly lists image-by-image similarity search, model ID, JPEG/PNG support, 25 MB/2048×2048 inference limits, and dimensions. The [request/response documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-mm.html) confirms base64 image input and a returned float embedding. AWS describes L2 use for this model in its [official implementation guidance](https://aws.amazon.com/blogs/machine-learning/cost-effective-document-classification-using-the-amazon-titan-multimodal-embeddings-model/).

* **Architecture:** raw vector only; no Bedrock image index or externally stored image reference is required. On-demand and provisioned throughput are listed inference types; Batch Inference/throughput/cost must be confirmed in the selected AWS Region.
* **Cost:** [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) is the authoritative current source, but consulted rendered documentation did not expose a stable current Titan-image per-request figure. Record it from the actual target-region pricing/console before opt-in: **REVIEW_REQUIRED**, never zero.
* **Data:** [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) says model providers do not access Bedrock logs/prompts/completions. [Retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) and [abuse-detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html) pages document account/model retention controls and exceptions. Configure and verify the actual Titan allowed retention mode before customer photos; POC-only catalogue/query assets still require internal approval.

#### 3. Azure Vision Multimodal Embeddings — optional third POC

The [Azure Vision concept page](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-image-retrieval) documents 1024-dimensional image/text vectors, image-vector retrieval, cosine/Euclidean comparison, and image limits. The [how-to](https://learn.microsoft.com/en-in/azure/ai-services/computer-vision/how-to/image-retrieval) confirms a vector-returning REST endpoint for local image binary or URL. [Azure AI Search's vectorizer documentation](https://learn.microsoft.com/en-us/azure/search/vector-search-vectorizer-ai-services-vision) describes the optional managed-search integration, required same-model vectors, 1024-dimension field, and data processing in the deployment geo.

* **Architecture:** use raw vectors for a directly comparable first test. Azure AI Search is a separate, provider-managed vector-index alternative with index/document operations, metadata fields and query APIs; using it increases coupling and is not needed for the first benchmark.
* **Cost/data:** the consulted official docs do not publish one universal regional price, retention period, or marketplace restriction. Obtain a target-region Azure price and data-residency/retention approval before POC: **REVIEW_REQUIRED / DATA_POLICY_REVIEW_REQUIRED**.

### Providers researched but not shortlisted

**Cohere Embed v4.0** has documented image embeddings, raw vectors, 256/512/1024/1536 dimensions, and cosine/dot-product/Euclidean metrics in its [embedding documentation](https://docs.cohere.com/docs/cohere-embed). It is not recommended for the current POC without legal approval because its [Commercial SaaS Agreement](https://cohere.com/saas-agreement) restricts benchmarking or competitive analysis of Cohere products. The proposed WeKonnek comparative provider benchmark may fall within that restriction. Pricing is also not presented as a stable per-image public rate in the consulted documentation. Status: **REVIEW_REQUIRED — excluded pending written confirmation**.

### Recommendation

**First provider to benchmark: Vertex AI `multimodalembedding@001`.** It has the clearest directly documented image-input price, a raw-vector path that leaves WeKonnek's domain pipeline intact, and an official data-training commitment. It is not declared the winner.

**Second provider to benchmark: Bedrock Titan Multimodal Embeddings G1.** It is expressly documented for image-by-image similarity, returns vectors directly, and offers a materially different model/data-control stack.

**Optional third provider: Azure Vision Multimodal Embeddings.** It is a valid independent raw-vector comparator, but its POC economics/data approval need regional confirmation and Azure AI Search should not be introduced into the first adapter test.

**PROVIDER SELECTION IS NOT FINAL UNTIL THE WEKONNEK BENCHMARK IS RUN.** The benchmark is the authority for exact packaged-SKU retrieval, similar-product discovery, latency, and actual cost.

### First POC checklist — Vertex AI

Do not perform these steps as part of research.

1. Create/select a Google Cloud billing account, project, and an approved Vertex AI location; obtain security/privacy approval for POC-only approved development images.
2. Create a least-privilege service account or use workload identity with the documented Vertex AI prediction permission. Do not use a shared personal credential.
3. Add only provider-specific empty development variables after selection, expected to include `VISUAL_SEARCH_VERTEX_PROJECT_ID`, `VISUAL_SEARCH_VERTEX_LOCATION`, `VISUAL_SEARCH_VERTEX_MODEL=multimodalembedding@001`, and a credential-reference mechanism agreed with repository security conventions. Do **not** add a secret to `.env.example` or Git.
4. Confirm the exact current publisher-model endpoint, authentication flow, model availability, allowed formats/size, RPM, output dimension (start with 1408 unless POC capacity requires otherwise), and dot-product retrieval handling from current official docs.
5. Implement one REST adapter only. No Vertex index is created and product images are not uploaded for persistent provider indexing: each approved catalogue/query image produces one raw vector response.
6. For a 50–100-image dataset, expected paid operations are one image-embedding call per catalogue image requiring indexing plus one call per benchmark query image. Re-index only when the source image/model/dimension changes. Run benchmark dry-run first; then set the existing external-benchmark opt-in only after cost review.
7. Persist vectors only in the selected POC storage under approved retention controls. At POC close, delete the POC vectors/reports/assets according to the project retention decision, revoke the service-account credential or access binding, and verify billing/project resources with the cloud owner. Vertex has no provider image index to delete for this raw-vector flow.

### Implemented Vertex benchmark adapter (development only)

The adapter is at `src/visual-search/providers/vertex/vertex-visual-search.provider.ts`. It implements **only** `multimodalembedding@001`, calling the documented regional publisher-model endpoint:

`https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/multimodalembedding@001:predict`

The current official [multimodal embeddings API reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-embeddings-api) documents a bearer-authenticated request, `image.bytesBase64Encoded` input, `parameters.dimension`, and `predictions[0].imageEmbedding` output. It documents dimensions 128, 256, 512, and 1408. The [multimodal embedding guide](https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings) advises dot-product ranking and cautions against treating it as a calibrated probability. The adapter validates all vector values and dimensions before exposing its provider-neutral raw embedding.

Authentication uses the official [`google-auth-library`](https://cloud.google.com/docs/authentication/application-default-credentials) Application Default Credentials flow with the `cloud-platform` scope. ADC may use a local `gcloud auth application-default login` file for a developer POC, `GOOGLE_APPLICATION_CREDENTIALS` pointing outside the repository, or an attached least-privilege service account. It does not use a public/API-key auth scheme and never returns credentials to a customer response.

The initial dimension is **512** (`VISUAL_SEARCH_VERTEX_DIMENSION=512`): a POC storage/latency choice, not a production schema decision. Do not mix dimensions in one run. Run the same dataset at 1408 only after reviewing the 512 benchmark outcome.

For a Vertex benchmark, the dataset supplies `catalogue` fixture records (`productId`, `image`, optional `sourceType`) and queries. Catalogue and query images are embedded in-process, retained only for that process, and ranked by isolated dot-product math. No vectors are persisted, no Vertex index is created, and no product catalogue is automatically indexed. The benchmark report records catalogue/query/total embedding calls and estimates USD cost from Vertex's [published USD $0.0001/image-input price](https://cloud.google.com/vertex-ai/generative-ai/pricing), reviewed 2026-08-28; it is not an invoice.

`--dry-run` makes no requests and reports model, dimension, fixture/query counts, credential readiness, opt-in status, expected calls, and estimated cost. An actual Vertex run requires all of: valid Vertex config/ADC, `VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=true`, and an explicit benchmark command. It refuses runs above `VISUAL_SEARCH_BENCHMARK_MAX_QUERIES` unless `--allow-large-benchmark` is given. Requests time out after `VISUAL_SEARCH_VERTEX_TIMEOUT_MS` (default 15000); authentication, quota, timeout, network, and malformed-response failures are normalized without leaking credentials. Deliberate retries are not implemented for this first paid POC.

Data-policy and commercial-use status remain **REVIEW_REQUIRED**. A successful POC is not production approval. Recommended first paid run: 20–30 query images across Apparel, Grocery/FMCG, Beverage, Beauty, and Home, covering both `EXACT_PRODUCT` and `SIMILAR_PRODUCT` with different catalogue/query photos.

### Vertex POC dataset gate

No approved, development-owned 75–150-image catalogue fixture set is currently present in the repository, so no real dataset or Vertex request was created. Do not use the existing `uploads/` media or crawl DigitalOcean storage without an explicit asset approval. A live Vertex dataset must contain 20–30 customer-like query images, use a stable version such as `vertex-poc-v1`, carry source-type metadata where known, and include hard negatives. The benchmark now validates the complete Vertex manifest before any external call: non-empty catalogue, file existence/readability, valid product references, unique query IDs, supported modes, 20 MB image limit, and byte-hash prevention of catalogue/query file reuse.

The initial cost cap is `VISUAL_SEARCH_BENCHMARK_MAX_COST_USD=1`; a higher estimated run requires the explicit development-only `VISUAL_SEARCH_ALLOW_COST_OVERRIDE=true`. This is separate from `VISUAL_SEARCH_ALLOW_EXTERNAL_BENCHMARK=true`. Dry-run remains network-free. Preserve any approved `vertex-poc-v1` fixture set unchanged for later 1408 or provider comparisons.
