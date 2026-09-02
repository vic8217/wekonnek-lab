import {
  computeAccuraHmacHex,
  evaluateAccuraTimestamp,
  parseAccuraSignatureHeader,
  timingSafeHexEqual,
  verifyAccuraWebhookSignature,
} from './accura-webhook.crypto';

const SECRET = 'accura-webhook-test-secret';

function signed(rawBody: Buffer, timestamp: string, secret = SECRET) {
  return `v1=${computeAccuraHmacHex(secret, timestamp, rawBody)}`;
}

describe('ACCURA webhook crypto', () => {
  const timestamp = '1710000000';
  const rawBody = Buffer.from('{"eventId":"evt-1"}', 'utf8');

  it('A. accepts a valid exact-body signature', () => {
    expect(
      verifyAccuraWebhookSignature({
        secret: SECRET,
        timestamp,
        rawBody,
        signatureHeader: signed(rawBody, timestamp),
      }),
    ).toBe(true);
  });

  it('B. rejects a one-byte body change', () => {
    const tampered = Buffer.from(rawBody);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] ^ 1;
    expect(
      verifyAccuraWebhookSignature({
        secret: SECRET,
        timestamp,
        rawBody: tampered,
        signatureHeader: signed(rawBody, timestamp),
      }),
    ).toBe(false);
  });

  it('C. rejects a wrong secret', () => {
    expect(
      verifyAccuraWebhookSignature({
        secret: 'other-secret',
        timestamp,
        rawBody,
        signatureHeader: signed(rawBody, timestamp),
      }),
    ).toBe(false);
  });

  it('D. rejects malformed signatures without throwing', () => {
    for (const signatureHeader of [
      '',
      'not-hex',
      'v1=',
      'v1=zz',
      'v1=abc',
      'v2=deadbeef',
      '%%%',
    ]) {
      expect(() =>
        verifyAccuraWebhookSignature({
          secret: SECRET,
          timestamp,
          rawBody,
          signatureHeader,
        }),
      ).not.toThrow();
      expect(
        verifyAccuraWebhookSignature({
          secret: SECRET,
          timestamp,
          rawBody,
          signatureHeader,
        }),
      ).toBe(false);
    }
  });

  it('E. rejects a stale timestamp', () => {
    const now = new Date(1_710_000_000_000);
    expect(evaluateAccuraTimestamp('1709999699', now, 300).ok).toBe(false);
    expect(evaluateAccuraTimestamp('1709999699', now, 300)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('F. rejects a future timestamp outside tolerance', () => {
    const now = new Date(1_710_000_000_000);
    expect(evaluateAccuraTimestamp('1710000301', now, 300)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('G. constant-time comparison handles unequal lengths without throwing', () => {
    expect(timingSafeHexEqual('ab', 'abcd')).toBe(false);
    expect(timingSafeHexEqual('abcd', 'ab')).toBe(false);
    expect(timingSafeHexEqual('abcd', 'zzzz')).toBe(false);
    expect(() => timingSafeHexEqual('aa', 'bbcc')).not.toThrow();
    expect(parseAccuraSignatureHeader('v1=deadbeef')).toBe('deadbeef');
    expect(timingSafeHexEqual('ab', 'ab')).toBe(true);
  });

  it('accepts timestamps inside the tolerance window', () => {
    const now = new Date(1_710_000_000_000);
    expect(evaluateAccuraTimestamp('1710000000', now, 300).ok).toBe(true);
    expect(evaluateAccuraTimestamp('1709999700', now, 300).ok).toBe(true);
    expect(evaluateAccuraTimestamp('1710000300', now, 300).ok).toBe(true);
  });

  it('rejects missing and invalid timestamps', () => {
    expect(evaluateAccuraTimestamp(undefined).reason).toBe('missing');
    expect(evaluateAccuraTimestamp('').reason).toBe('missing');
    expect(evaluateAccuraTimestamp('not-a-number').reason).toBe('invalid');
    expect(evaluateAccuraTimestamp('12.5').reason).toBe('invalid');
  });
});
