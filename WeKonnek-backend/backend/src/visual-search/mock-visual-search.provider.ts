import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { VisualCandidateOptions, VisualEmbedding, VisualProductCandidate, VisualSearchProvider } from './visual-search.provider';

/** Local/test-only provider. It has no external credentials or image retention. */
@Injectable()
export class MockVisualSearchProvider implements VisualSearchProvider {
  private candidates: VisualProductCandidate[] = [];
  setCandidates(candidates: VisualProductCandidate[]) { this.candidates = [...candidates]; }
  capabilities() { return { providerId: 'mock', displayName: 'Deterministic Mock', supportsImageEmbedding: true, supportsSimilaritySearch: true, returnsRawEmbedding: false, supportsExternalIndex: false, supportsBatchIndexing: false, supportsDelete: true, supportsReindex: true, commercialUseKnown: true }; }
  async createQueryEmbedding(image: Buffer): Promise<VisualEmbedding> { return { fingerprint: createHash('sha256').update(image).digest('hex') }; }
  async searchSimilarProducts(_embedding: VisualEmbedding, options: VisualCandidateOptions) { return this.candidates.slice(0, options.limit); }
  async indexProductImage(input: { productId: number; mediaId: string }) { return { externalReference: `mock:${input.productId}:${input.mediaId}` }; }
  async removeProductImageIndex() { /* mock index has no durable remote state */ }
}
