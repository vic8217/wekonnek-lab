import { Module } from '@nestjs/common';
import { VisualSearchService } from './visual-search.service';
import { MockVisualSearchProvider } from './mock-visual-search.provider';
import { VISUAL_SEARCH_PROVIDER } from './visual-search.provider';
import { VisualSearchController } from './visual-search.controller';
import { VisualSearchProviderRegistry } from './visual-search-provider.registry';
import { VertexVisualSearchProvider } from './providers/vertex/vertex-visual-search.provider';
@Module({
  controllers: [VisualSearchController],
  providers: [
    VisualSearchService,
    MockVisualSearchProvider,
    VertexVisualSearchProvider,
    VisualSearchProviderRegistry,
    {
      provide: VISUAL_SEARCH_PROVIDER,
      inject: [VisualSearchProviderRegistry],
      useFactory: (registry: VisualSearchProviderRegistry) => registry.getProvider(),
    },
  ],
  exports: [VisualSearchService, MockVisualSearchProvider, VisualSearchProviderRegistry],
})
export class VisualSearchModule {}
