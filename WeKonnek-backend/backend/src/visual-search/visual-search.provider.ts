export type VisualEmbedding = { fingerprint?: string; vector?: number[]; dimension?: number; metric?: 'DOT_PRODUCT' | 'COSINE' | 'EUCLIDEAN' };
export type VisualProductCandidate = { productId: number; mediaId?: string; score: number };
export type VisualCandidateOptions = { limit: number };
export type VisualSearchProviderCapabilities = { providerId: string; displayName: string; supportsImageEmbedding: boolean; supportsSimilaritySearch: boolean; returnsRawEmbedding: boolean; supportsExternalIndex: boolean; embeddingDimension?: number; similarityMetric?: 'COSINE' | 'DOT_PRODUCT' | 'EUCLIDEAN'; supportsBatchIndexing: boolean; supportsDelete: boolean; supportsReindex: boolean; commercialUseKnown: boolean };

export interface VisualSearchProvider {
  capabilities(): VisualSearchProviderCapabilities;
  createQueryEmbedding(image: Buffer): Promise<VisualEmbedding>;
  searchSimilarProducts(embedding: VisualEmbedding, options: VisualCandidateOptions): Promise<VisualProductCandidate[]>;
  indexProductImage(input: { productId: number; mediaId: string; imageUrl: string }): Promise<{ externalReference: string }>;
  removeProductImageIndex(externalReference: string): Promise<void>;
}

export const VISUAL_SEARCH_PROVIDER = Symbol('VISUAL_SEARCH_PROVIDER');
