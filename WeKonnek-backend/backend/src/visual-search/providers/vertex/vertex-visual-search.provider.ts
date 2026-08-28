import { Injectable } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import type {
  VisualCandidateOptions,
  VisualEmbedding,
  VisualProductCandidate,
  VisualSearchProvider,
} from '../../visual-search.provider';

export const VERTEX_MODEL = 'multimodalembedding@001';
export const VERTEX_DIMENSIONS = [128, 256, 512, 1408] as const;
export type VertexDimension = (typeof VERTEX_DIMENSIONS)[number];
export type VertexFailureCategory =
  | 'CONFIGURATION_ERROR'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR';

export class VertexProviderError extends Error {
  constructor(
    readonly category: VertexFailureCategory,
    message: string,
  ) {
    super(message);
  }
}

export type VertexConfig = {
  projectId: string;
  location: string;
  model: string;
  dimension: VertexDimension;
  timeoutMs: number;
};
export const vertexConfigFromEnvironment = (): VertexConfig => {
  const projectId = process.env.VISUAL_SEARCH_VERTEX_PROJECT_ID?.trim() || '';
  const location = process.env.VISUAL_SEARCH_VERTEX_LOCATION?.trim() || '';
  const model = process.env.VISUAL_SEARCH_VERTEX_MODEL?.trim() || '';
  const rawDimension = Number(
    process.env.VISUAL_SEARCH_VERTEX_DIMENSION || 512,
  );
  const timeoutMs = Number(
    process.env.VISUAL_SEARCH_VERTEX_TIMEOUT_MS || 15_000,
  );
  if (!projectId || !location || !model)
    throw new VertexProviderError(
      'CONFIGURATION_ERROR',
      'Vertex benchmark requires VISUAL_SEARCH_VERTEX_PROJECT_ID, VISUAL_SEARCH_VERTEX_LOCATION, and VISUAL_SEARCH_VERTEX_MODEL.',
    );
  if (model !== VERTEX_MODEL)
    throw new VertexProviderError(
      'CONFIGURATION_ERROR',
      `Unsupported Vertex model "${model}". This POC supports ${VERTEX_MODEL} only.`,
    );
  if (!VERTEX_DIMENSIONS.includes(rawDimension as VertexDimension))
    throw new VertexProviderError(
      'CONFIGURATION_ERROR',
      `VISUAL_SEARCH_VERTEX_DIMENSION must be one of ${VERTEX_DIMENSIONS.join(', ')}.`,
    );
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1)
    throw new VertexProviderError(
      'CONFIGURATION_ERROR',
      'VISUAL_SEARCH_VERTEX_TIMEOUT_MS must be positive.',
    );
  return {
    projectId,
    location,
    model,
    dimension: rawDimension as VertexDimension,
    timeoutMs,
  };
};

export const dotProduct = (left: number[], right: number[]) => {
  if (
    left.length !== right.length ||
    !left.length ||
    left.some((value) => !Number.isFinite(value)) ||
    right.some((value) => !Number.isFinite(value))
  )
    throw new VertexProviderError(
      'INVALID_RESPONSE',
      'Vertex embeddings must be finite, non-empty vectors with equal dimensions.',
    );
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
};

type FetchLike = typeof fetch;
@Injectable()
export class VertexVisualSearchProvider implements VisualSearchProvider {
  private auth: Pick<GoogleAuth, 'getClient'> = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  private request: FetchLike = fetch;
  private configured?: VertexConfig;
  static forTest(
    config: VertexConfig,
    auth: Pick<GoogleAuth, 'getClient'>,
    request: FetchLike,
  ) {
    const provider = new VertexVisualSearchProvider();
    provider.configured = config;
    provider.auth = auth;
    provider.request = request;
    return provider;
  }
  private get config() {
    return this.configured || vertexConfigFromEnvironment();
  }
  capabilities() {
    const config = this.config;
    return {
      providerId: 'vertex',
      displayName: 'Google Vertex AI Multimodal Embeddings',
      supportsImageEmbedding: true,
      supportsSimilaritySearch: false,
      returnsRawEmbedding: true,
      supportsExternalIndex: false,
      embeddingDimension: config.dimension,
      similarityMetric: 'DOT_PRODUCT' as const,
      supportsBatchIndexing: false,
      supportsDelete: false,
      supportsReindex: true,
      commercialUseKnown: false,
    };
  }
  get benchmarkConfig() {
    return this.config;
  }
  async createQueryEmbedding(image: Buffer): Promise<VisualEmbedding> {
    const token = await this.accessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.request(
        `https://${this.config.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/locations/${encodeURIComponent(this.config.location)}/publishers/google/models/${this.config.model}:predict`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            instances: [
              { image: { bytesBase64Encoded: image.toString('base64') } },
            ],
            parameters: { dimension: this.config.dimension },
          }),
        },
      );
      if (response.status === 401 || response.status === 403)
        throw new VertexProviderError(
          'AUTHENTICATION_FAILED',
          'Vertex authentication failed.',
        );
      if (response.status === 429)
        throw new VertexProviderError(
          'RATE_LIMITED',
          'Vertex quota or rate limit reached.',
        );
      if (!response.ok)
        throw new VertexProviderError(
          'NETWORK_ERROR',
          `Vertex request failed with HTTP ${response.status}.`,
        );
      const payload = (await response.json()) as {
        predictions?: Array<{ imageEmbedding?: unknown }>;
      };
      const vector = payload.predictions?.[0]?.imageEmbedding;
      if (
        !Array.isArray(vector) ||
        vector.length !== this.config.dimension ||
        vector.some(
          (value) => typeof value !== 'number' || !Number.isFinite(value),
        )
      )
        throw new VertexProviderError(
          'INVALID_RESPONSE',
          'Vertex returned an invalid image embedding.',
        );
      return {
        vector,
        dimension: this.config.dimension,
        metric: 'DOT_PRODUCT',
      };
    } catch (error) {
      if (error instanceof VertexProviderError) throw error;
      if ((error as Error).name === 'AbortError')
        throw new VertexProviderError('TIMEOUT', 'Vertex request timed out.');
      throw new VertexProviderError(
        'NETWORK_ERROR',
        'Vertex network request failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  searchSimilarProducts(
    _embedding: VisualEmbedding,
    _options: VisualCandidateOptions,
  ): Promise<VisualProductCandidate[]> {
    void _embedding;
    void _options;
    return Promise.reject(
      new VertexProviderError(
        'CONFIGURATION_ERROR',
        'Vertex raw embeddings are available only to the development benchmark until vector storage is selected.',
      ),
    );
  }
  indexProductImage(): Promise<{ externalReference: string }> {
    return Promise.reject(
      new VertexProviderError(
        'CONFIGURATION_ERROR',
        'Vertex POC uses in-memory benchmark vectors and has no external index.',
      ),
    );
  }
  removeProductImageIndex(): Promise<void> {
    return Promise.reject(
      new VertexProviderError(
        'CONFIGURATION_ERROR',
        'Vertex POC has no external index.',
      ),
    );
  }
  private async accessToken() {
    try {
      const client = await this.auth.getClient();
      const token = await client.getAccessToken();
      if (!token.token) throw new Error('missing token');
      return token.token;
    } catch {
      throw new VertexProviderError(
        'AUTHENTICATION_FAILED',
        'Vertex Application Default Credentials are unavailable.',
      );
    }
  }
}
