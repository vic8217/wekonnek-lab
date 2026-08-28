import { Injectable } from '@nestjs/common';
import { MockVisualSearchProvider } from './mock-visual-search.provider';
import { VertexVisualSearchProvider } from './providers/vertex/vertex-visual-search.provider';
@Injectable()
export class VisualSearchProviderRegistry {
  constructor(private readonly mock: MockVisualSearchProvider, private readonly vertex: VertexVisualSearchProvider) {}
  get configured() { return process.env.VISUAL_SEARCH_PROVIDER || 'mock'; }
  getProvider(id = this.configured) {
    if (id === 'vertex') return this.vertex;
    if (id !== 'mock') {
      throw new Error(`Visual Search provider "${id}" is unavailable: no adapter is configured`);
    }
    return this.mock;
  }
  capabilities() { return this.getProvider().capabilities(); }
}
