import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const DELIVERY_QR_VERSION = 'WKDH1';
export const DEFAULT_DELIVERY_HANDOFF_TTL_SECONDS = 300;
export const DELIVERY_OTP_MAX_ATTEMPTS = 5;
/** OTP alphabet excludes ambiguous 0/O/1/I/L. ~40 bits for 8 chars. */
const OTP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const DELIVERY_OTP_LENGTH = 8;

export type DeliveryQrPayload = {
  version: typeof DELIVERY_QR_VERSION;
  tokenId: string;
  secret: string;
};

export function generateDeliverySecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateDeliveryOtp(): string {
  const bytes = randomBytes(DELIVERY_OTP_LENGTH);
  let out = '';
  for (let i = 0; i < DELIVERY_OTP_LENGTH; i++) {
    out += OTP_ALPHABET[bytes[i]! % OTP_ALPHABET.length];
  }
  return out;
}

export function hashDeliverySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function hashDeliveryOtp(otp: string): string {
  return createHash('sha256')
    .update(`otp:${String(otp).trim().toUpperCase()}`, 'utf8')
    .digest('hex');
}

export function secretsMatch(storedHash: string, presentedSecret: string): boolean {
  const actual = Buffer.from(hashDeliverySecret(presentedSecret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function otpsMatch(storedHash: string, presentedOtp: string): boolean {
  const actual = Buffer.from(hashDeliveryOtp(presentedOtp), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Compact QR string: WKDH1.<tokenId>.<secret> */
export function encodeDeliveryQrPayload(input: {
  tokenId: string;
  secret: string;
}): string {
  return `${DELIVERY_QR_VERSION}.${input.tokenId}.${input.secret}`;
}

export function parseDeliveryQrPayload(raw: string): DeliveryQrPayload {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error('EMPTY_PAYLOAD');
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error('MALFORMED_PAYLOAD');
  }
  const [version, tokenId, secret] = parts;
  if (version !== DELIVERY_QR_VERSION) {
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
  return { version: DELIVERY_QR_VERSION, tokenId, secret };
}
