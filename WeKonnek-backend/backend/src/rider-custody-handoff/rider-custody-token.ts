import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const RIDER_CUSTODY_QR_VERSION = 'WKRR1';
export const DEFAULT_RIDER_CUSTODY_TTL_SECONDS = 300;
export const RIDER_CUSTODY_OTP_MAX_ATTEMPTS = 5;
const OTP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RIDER_CUSTODY_OTP_LENGTH = 8;

export type RiderCustodyQrPayload = {
  version: typeof RIDER_CUSTODY_QR_VERSION;
  tokenId: string;
  secret: string;
};

export function generateRiderCustodySecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateRiderCustodyOtp(): string {
  const bytes = randomBytes(RIDER_CUSTODY_OTP_LENGTH);
  let out = '';
  for (let i = 0; i < RIDER_CUSTODY_OTP_LENGTH; i++) {
    out += OTP_ALPHABET[bytes[i]! % OTP_ALPHABET.length];
  }
  return out;
}

export function hashRiderCustodySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function hashRiderCustodyOtp(otp: string): string {
  return createHash('sha256')
    .update(`otp:${String(otp).trim().toUpperCase()}`, 'utf8')
    .digest('hex');
}

export function riderCustodySecretsMatch(
  storedHash: string,
  presentedSecret: string,
): boolean {
  const actual = Buffer.from(hashRiderCustodySecret(presentedSecret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function riderCustodyOtpsMatch(
  storedHash: string,
  presentedOtp: string,
): boolean {
  const actual = Buffer.from(hashRiderCustodyOtp(presentedOtp), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Compact QR string: WKRR1.<tokenId>.<secret> */
export function encodeRiderCustodyQrPayload(input: {
  tokenId: string;
  secret: string;
}): string {
  return `${RIDER_CUSTODY_QR_VERSION}.${input.tokenId}.${input.secret}`;
}

export function parseRiderCustodyQrPayload(raw: string): RiderCustodyQrPayload {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('EMPTY_PAYLOAD');
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('MALFORMED_PAYLOAD');
  const [version, tokenId, secret] = parts;
  if (version !== RIDER_CUSTODY_QR_VERSION) throw new Error('UNSUPPORTED_VERSION');
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
  return { version: RIDER_CUSTODY_QR_VERSION, tokenId, secret };
}
