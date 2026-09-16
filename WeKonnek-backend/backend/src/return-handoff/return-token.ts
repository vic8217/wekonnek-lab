import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const RETURN_QR_VERSION = 'WKRH1';
export const DEFAULT_RETURN_HANDOFF_TTL_SECONDS = 300;
export const RETURN_OTP_MAX_ATTEMPTS = 5;
const OTP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RETURN_OTP_LENGTH = 8;

export type ReturnQrPayload = {
  version: typeof RETURN_QR_VERSION;
  tokenId: string;
  secret: string;
};

export function generateReturnSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateReturnOtp(): string {
  const bytes = randomBytes(RETURN_OTP_LENGTH);
  let out = '';
  for (let i = 0; i < RETURN_OTP_LENGTH; i++) {
    out += OTP_ALPHABET[bytes[i]! % OTP_ALPHABET.length];
  }
  return out;
}

export function hashReturnSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function hashReturnOtp(otp: string): string {
  return createHash('sha256')
    .update(`otp:${String(otp).trim().toUpperCase()}`, 'utf8')
    .digest('hex');
}

export function secretsMatch(storedHash: string, presentedSecret: string): boolean {
  const actual = Buffer.from(hashReturnSecret(presentedSecret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function otpsMatch(storedHash: string, presentedOtp: string): boolean {
  const actual = Buffer.from(hashReturnOtp(presentedOtp), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Compact QR string: WKRH1.<tokenId>.<secret> */
export function encodeReturnQrPayload(input: {
  tokenId: string;
  secret: string;
}): string {
  return `${RETURN_QR_VERSION}.${input.tokenId}.${input.secret}`;
}

export function parseReturnQrPayload(raw: string): ReturnQrPayload {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('EMPTY_PAYLOAD');
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('MALFORMED_PAYLOAD');
  const [version, tokenId, secret] = parts;
  if (version !== RETURN_QR_VERSION) throw new Error('UNSUPPORTED_VERSION');
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
  return { version: RETURN_QR_VERSION, tokenId, secret };
}
