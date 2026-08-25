import { createProviderIdempotencyKey, createWekonnekPaymentReference } from './platform-payment.service';

describe('PayCools-safe identifiers', () => {
  it('creates an alphanumeric WEKONNEK reference within mchOrderId limits', () => {
    const reference = createWekonnekPaymentReference(new Date('2026-08-19T00:00:00.000Z'));
    expect(reference).toMatch(/^WK260819[A-F0-9]{16}$/);
    expect(reference.length).toBeLessThanOrEqual(32);
  });

  it('creates a separate 10-30 character alphanumeric idempotency key', () => {
    const key = createProviderIdempotencyKey();
    expect(key).toMatch(/^IDEM[A-F0-9]{24}$/);
    expect(key.length).toBeGreaterThanOrEqual(10);
    expect(key.length).toBeLessThanOrEqual(30);
  });

  it('does not reuse generated identifiers', () => {
    expect(createWekonnekPaymentReference()).not.toBe(createWekonnekPaymentReference());
    expect(createProviderIdempotencyKey()).not.toBe(createProviderIdempotencyKey());
  });
});
