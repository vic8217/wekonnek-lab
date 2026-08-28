import { BadRequestException } from '@nestjs/common';
import { DeliveryPartnersService } from './delivery-partners.service';

describe('DeliveryPartnersService', () => {
  const service = new DeliveryPartnersService(
    {} as any,
    { get: () => 'test-integration-encryption-key' } as any,
  );

  it('encrypts credentials with the Social Auth AES-256-GCM packed-value format', () => {
    const encrypted = (service as any).encrypt('lalamove-secret');
    expect(encrypted).not.toContain('lalamove-secret');
    expect(encrypted.split('.')).toHaveLength(3);
  });

  it('requires an integration encryption key before a secret can be saved', () => {
    const withoutKey = new DeliveryPartnersService(
      {} as any,
      { get: () => undefined } as any,
    );
    expect(() => (withoutKey as any).encrypt('secret')).toThrow(
      BadRequestException,
    );
  });
});
