import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const PICKUP_QR_VERSION = 'WKPH1';
export const DEFAULT_PICKUP_HANDOFF_TTL_SECONDS = 300;

export type PickupQrPayload = {
  version: typeof PICKUP_QR_VERSION;
  tokenId: string;
  secret: string;
};

export function generatePickupSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPickupSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function secretsMatch(storedHash: string, presentedSecret: string): boolean {
  const actual = Buffer.from(hashPickupSecret(presentedSecret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Compact QR string: WKPH1.<tokenId>.<secret> */
export function encodePickupQrPayload(input: {
  tokenId: string;
  secret: string;
}): string {
  return `${PICKUP_QR_VERSION}.${input.tokenId}.${input.secret}`;
}

export function parsePickupQrPayload(raw: string): PickupQrPayload {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error('EMPTY_PAYLOAD');
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error('MALFORMED_PAYLOAD');
  }
  const [version, tokenId, secret] = parts;
  if (version !== PICKUP_QR_VERSION) {
    throw new Error('UNSUPPORTED_VERSION');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tokenId,
    )
  ) {
    throw new Error('MALFORMED_TOKEN_ID');
  }
  if (!secret || secret.length < 22 || secret.length > 64) {
    throw new Error('MALFORMED_SECRET');
  }
  return { version: PICKUP_QR_VERSION, tokenId, secret };
}
