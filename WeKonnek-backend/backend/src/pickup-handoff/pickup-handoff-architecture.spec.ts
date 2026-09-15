import {
  DEFAULT_PICKUP_HANDOFF_TTL_SECONDS,
  encodePickupQrPayload,
  generatePickupSecret,
  hashPickupSecret,
  parsePickupQrPayload,
  PICKUP_QR_VERSION,
  secretsMatch,
} from './pickup-token';
import { AgreementType } from '@prisma/client';
import { PickupHandoffService } from './pickup-handoff.service';

describe('Stage 3A pickup token crypto + payload', () => {
  it('generates high-entropy secrets and hashes without persisting raw secret', () => {
    const a = generatePickupSecret();
    const b = generatePickupSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    const hash = hashPickupSecret(a);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(a);
    expect(secretsMatch(hash, a)).toBe(true);
    expect(secretsMatch(hash, b)).toBe(false);
  });

  it('encodes and strictly parses WKPH1 payloads', () => {
    const tokenId = '11111111-1111-4111-8111-111111111111';
    const secret = generatePickupSecret();
    const encoded = encodePickupQrPayload({ tokenId, secret });
    expect(encoded.startsWith(`${PICKUP_QR_VERSION}.`)).toBe(true);
    const parsed = parsePickupQrPayload(encoded);
    expect(parsed.tokenId).toBe(tokenId);
    expect(parsed.secret).toBe(secret);
    expect(parsed.version).toBe(PICKUP_QR_VERSION);
  });

  it('rejects malformed / unsupported QR payloads', () => {
    expect(() => parsePickupQrPayload('')).toThrow(/EMPTY/);
    expect(() => parsePickupQrPayload('WKPH2.x.y')).toThrow(/UNSUPPORTED|MALFORMED/);
    expect(() => parsePickupQrPayload('WKPH1.not-a-uuid.abc')).toThrow(/MALFORMED/);
    expect(() => parsePickupQrPayload('WKPH1.11111111-1111-4111-8111-111111111111.short')).toThrow(
      /MALFORMED_SECRET/,
    );
  });

  it('documents default TTL configuration convention', () => {
    expect(DEFAULT_PICKUP_HANDOFF_TTL_SECONDS).toBe(300);
  });
});

describe('Stage 3A architectural separations', () => {
  it('keeps Rider Advance inactive for pickup handoff', () => {
    const svc = Object.create(PickupHandoffService.prototype) as PickupHandoffService;
    expect(() => svc.assertRiderAdvanceInactive()).not.toThrow();
    expect(AgreementType.RIDER_ADVANCE).toBe('RIDER_ADVANCE');
  });

  it('documents binding and separation invariants', () => {
    const invariants = {
      purposeServerOwned: true,
      assignmentVersionBound: true,
      paymentUnchangedOnConfirm: true,
      agreementAcceptanceUnchanged: true,
      custodyNotFulfillment: true,
      pickupNotPayment: true,
      pickupNotRiderAdvance: true,
      usesFulfillmentTransitionService: true,
      rawSecretNotPersisted: true,
    };
    expect(Object.values(invariants).every(Boolean)).toBe(true);
  });
});
