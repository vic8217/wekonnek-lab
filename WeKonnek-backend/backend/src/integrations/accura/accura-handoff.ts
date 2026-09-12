export const ACCURA_HANDOFF_DESTINATION = 'COMPLETE_SETUP';
export const ACCURA_HANDOFF_PATH = '/handoff/complete-setup';
export const ACCURA_HANDOFF_UNAVAILABLE =
  'ACCURA setup is temporarily unavailable. Please try again.';

const CODE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function readAccuraMerchantAppUrl(
  get: (key: string) => string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  const raw = get('ACCURA_MERCHANT_APP_URL')?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (
    String(nodeEnv || '').toLowerCase() === 'production' &&
    parsed.protocol !== 'https:'
  ) {
    return null;
  }
  return parsed.origin;
}

export function validateAccuraHandoffRedirectUrl(
  redirectUrl: unknown,
  allowedOrigin: string,
): string | null {
  if (typeof redirectUrl !== 'string' || !redirectUrl.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl.trim());
  } catch {
    return null;
  }
  if (parsed.origin !== allowedOrigin) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== ACCURA_HANDOFF_PATH) return null;
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'code') return null;
  const code = parsed.searchParams.get('code') || '';
  if (!CODE_PATTERN.test(code)) return null;
  return parsed.toString();
}
