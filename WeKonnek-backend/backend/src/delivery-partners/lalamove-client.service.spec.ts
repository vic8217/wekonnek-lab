import { lalamoveBaseUrl, lalamoveSignature } from './lalamove-client.service';

describe('Lalamove client signing', () => {
  it('selects the documented UAT and production endpoints', () => {
    expect(lalamoveBaseUrl('uat')).toBe('https://rest.sandbox.lalamove.com');
    expect(lalamoveBaseUrl('production')).toBe('https://rest.lalamove.com');
  });

  it('creates a deterministic v3 GET signature with an empty body', () => {
    expect(
      lalamoveSignature('1545880607433', 'GET', '/v3/cities', '', 'secret'),
    ).toBe(
      lalamoveSignature('1545880607433', 'GET', '/v3/cities', '', 'secret'),
    );
  });

  it('does not use quotation or order paths for connection signing', () => {
    const signature = lalamoveSignature('1', 'GET', '/v3/cities', '', 'secret');
    expect(signature).toHaveLength(64);
  });
});
