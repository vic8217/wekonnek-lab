import { createHash } from 'crypto';
import { encryptDeliveryProviderCredential } from './delivery-partners.service';

describe('encryptDeliveryProviderCredential', () => {
  const key = createHash('sha256')
    .update('test-integration-encryption-key')
    .digest();

  it('encrypts credentials with the Social Auth AES-256-GCM packed-value format', () => {
    const encrypted = encryptDeliveryProviderCredential('lalamove-secret', key);
    expect(encrypted).not.toContain('lalamove-secret');
    expect(encrypted.split('.')).toHaveLength(3);
  });

  it('uses a fresh initialization vector for each encryption', () => {
    expect(encryptDeliveryProviderCredential('lalamove-secret', key)).not.toBe(
      encryptDeliveryProviderCredential('lalamove-secret', key),
    );
  });
});
