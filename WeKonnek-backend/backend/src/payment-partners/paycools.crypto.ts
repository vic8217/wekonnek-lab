import { createSign, createVerify } from 'crypto';

const SIGN_ALGORITHMS = ['RSA-SHA256', 'RSA-SHA1'] as const;

function toPem(raw: string, kind: 'PRIVATE KEY' | 'PUBLIC KEY') {
  const trimmed = raw
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const lines = trimmed.match(/.{1,64}/g)?.join('\n') || trimmed;
  return `-----BEGIN ${kind}-----\n${lines}\n-----END ${kind}-----`;
}

export function looksLikePemKey(value: string) {
  const compact = value.replace(/\s+/g, '');
  return compact.startsWith('MII') || compact.includes('KEY-----');
}

export function signPayCoolsParam(param: string, privateKeyBase64: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(param, 'utf8');
  signer.end();
  return signer.sign(toPem(privateKeyBase64, 'PRIVATE KEY'), 'base64');
}

export function canonicalCallbackContent(payload: Record<string, unknown>) {
  return Object.keys(payload)
    .filter(
      (key) =>
        key !== 'sign' &&
        payload[key] !== null &&
        payload[key] !== undefined &&
        payload[key] !== '',
    )
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join('&');
}

export function verifyPayCoolsSign(
  content: string,
  sign: string,
  publicKeyBase64: string,
) {
  if (
    !content ||
    !sign ||
    !publicKeyBase64 ||
    !looksLikePemKey(publicKeyBase64)
  )
    return false;
  const pem = toPem(publicKeyBase64, 'PUBLIC KEY');
  return SIGN_ALGORITHMS.some((algorithm) => {
    try {
      const verifier = createVerify(algorithm);
      verifier.update(content, 'utf8');
      verifier.end();
      return verifier.verify(pem, sign, 'base64');
    } catch {
      return false;
    }
  });
}
