import { MockVisualSearchProvider } from '../../mock-visual-search.provider';
import { VisualSearchProviderRegistry } from '../../visual-search-provider.registry';
import {
  dotProduct,
  VERTEX_DIMENSIONS,
  VertexProviderError,
  VertexVisualSearchProvider,
  vertexConfigFromEnvironment,
} from './vertex-visual-search.provider';

describe('VertexVisualSearchProvider POC safeguards', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...original,
      VISUAL_SEARCH_VERTEX_PROJECT_ID: 'poc-project',
      VISUAL_SEARCH_VERTEX_LOCATION: 'us-central1',
      VISUAL_SEARCH_VERTEX_MODEL: 'multimodalembedding@001',
      VISUAL_SEARCH_VERTEX_DIMENSION: '512',
    };
  });
  afterAll(() => {
    process.env = original;
  });

  it('accepts every documented dimension and rejects unsupported values before calls', () => {
    for (const dimension of VERTEX_DIMENSIONS) {
      process.env.VISUAL_SEARCH_VERTEX_DIMENSION = String(dimension);
      expect(vertexConfigFromEnvironment().dimension).toBe(dimension);
    }
    process.env.VISUAL_SEARCH_VERTEX_DIMENSION = '1024';
    expect(() => vertexConfigFromEnvironment()).toThrow(VertexProviderError);
  });

  it('uses deterministic dot-product ranking and rejects mismatched vectors', () => {
    expect(dotProduct([1, 0], [0.9, 0])).toBeCloseTo(0.9);
    expect(dotProduct([1, 0], [0.1, 1])).toBeCloseTo(0.1);
    expect(() => dotProduct([1], [1, 2])).toThrow(VertexProviderError);
  });

  it('registers vertex without changing the default mock selection', () => {
    const mock = new MockVisualSearchProvider();
    const vertex = new VertexVisualSearchProvider();
    const registry = new VisualSearchProviderRegistry(mock, vertex);
    delete process.env.VISUAL_SEARCH_PROVIDER;
    expect(registry.getProvider()).toBe(mock);
    expect(registry.getProvider('vertex')).toBe(vertex);
    expect(() => registry.getProvider('unknown')).toThrow('unavailable');
  });

  it('sends the documented Vertex image request and validates its response', async () => {
    const vector = Array.from({ length: 128 }, (_, index) => index / 100);
    const request = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ predictions: [{ imageEmbedding: vector }] }),
          { status: 200 },
        ),
      );
    const auth = {
      getClient: () =>
        Promise.resolve({
          getAccessToken: () => Promise.resolve({ token: 'test-token' }),
        }),
    } as never;
    const provider = VertexVisualSearchProvider.forTest(
      {
        projectId: 'p',
        location: 'us-central1',
        model: 'multimodalembedding@001',
        dimension: 128,
        timeoutMs: 1000,
      },
      auth,
      request,
    );
    const response = await provider.createQueryEmbedding(Buffer.from('image'));
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(
        '/publishers/google/models/multimodalembedding@001:predict',
      ),
      expect.objectContaining({
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(response.vector).toEqual(vector);
  });
});
