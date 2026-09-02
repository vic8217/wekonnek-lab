import { createHmac, timingSafeEqual } from 'crypto';
import { DEFAULT_ACCURA_WEBHOOK_TOLERANCE_SECONDS } from './accura-webhook.types';

export type AccuraTimestampCheck =
  | { ok: true; unixSeconds: number }
  | { ok: false; reason: 'missing' | 'invalid' | 'stale' | 'future' };

export function buildAccuraSignedContent(
  timestamp: string,
  rawBody: Buffer,
): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
}

export function computeAccuraHmacHex(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(buildAccuraSignedContent(timestamp, rawBody))
    .digest('hex');
}

export function parseAccuraSignatureHeader(
  header: string | undefined,
): string | null {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',').map((part) => part.trim());
  for (const part of parts) {
    const prefixed = /^v1=(.+)$/i.exec(part);
    if (prefixed?.[1]) return prefixed[1].trim();
  }
  if (parts.some((part) => part.includes('='))) return null;
  return trimmed;
}

export function timingSafeHexEqual(
  expectedHex: string,
  suppliedHex: string,
): boolean {
  if (
    typeof expectedHex !== 'string' ||
    typeof suppliedHex !== 'string' ||
    expectedHex.length === 0 ||
    suppliedHex.length === 0
  ) {
    return false;
  }
  if (!/^[0-9a-fA-F]+$/.test(suppliedHex) || suppliedHex.length % 2 !== 0) {
    return false;
  }
  const expected = Buffer.from(expectedHex.toLowerCase(), 'utf8');
  const supplied = Buffer.from(suppliedHex.toLowerCase(), 'utf8');
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}

export function verifyAccuraWebhookSignature(input: {
  secret: string;
  timestamp: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): boolean {
  try {
    if (!input.secret || !input.timestamp || !input.rawBody) return false;
    const supplied = parseAccuraSignatureHeader(input.signatureHeader);
    if (!supplied) return false;
    const expected = computeAccuraHmacHex(
      input.secret,
      input.timestamp,
      input.rawBody,
    );
    return timingSafeHexEqual(expected, supplied);
  } catch {
    return false;
  }
}

export function evaluateAccuraTimestamp(
  timestampHeader: string | undefined,
  now: Date = new Date(),
  toleranceSeconds: number = DEFAULT_ACCURA_WEBHOOK_TOLERANCE_SECONDS,
): AccuraTimestampCheck {
  if (typeof timestampHeader !== 'string' || timestampHeader.trim() === '') {
    return { ok: false, reason: 'missing' };
  }
  const raw = timestampHeader.trim();
  if (!/^-?\d+$/.test(raw)) return { ok: false, reason: 'invalid' };
  const unixSeconds = Number(raw);
  if (!Number.isSafeInteger(unixSeconds))
    return { ok: false, reason: 'invalid' };
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const delta = nowSeconds - unixSeconds;
  if (delta > toleranceSeconds) return { ok: false, reason: 'stale' };
  if (-delta > toleranceSeconds) return { ok: false, reason: 'future' };
  return { ok: true, unixSeconds };
}
