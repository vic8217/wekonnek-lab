/**
 * ACCURA environment binding. UAT readiness must never imply Production.
 */

export type AccuraEnvName = 'UAT' | 'PRODUCTION';

export function readAccuraEnv(
  get: (key: string) => string | undefined,
): AccuraEnvName | null {
  const raw = get('ACCURA_ENV')?.trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'UAT' || raw === 'SANDBOX' || raw === 'TEST') return 'UAT';
  if (raw === 'PRODUCTION' || raw === 'PROD') return 'PRODUCTION';
  return null;
}

/**
 * Reject obviously cross-environment configs (e.g. Production env + localhost API).
 * Returns null when configuration is incomplete or inconsistent.
 */
export function assertAccuraEnvironmentBinding(input: {
  env: AccuraEnvName | null;
  apiBaseUrl: string | null | undefined;
  merchantAppUrl: string | null | undefined;
  nodeEnv?: string;
}): { ok: true; env: AccuraEnvName } | { ok: false; reason: string } {
  if (!input.env) {
    return { ok: false, reason: 'ACCURA_ENV_REQUIRED' };
  }
  const api = String(input.apiBaseUrl || '').trim().toLowerCase();
  const merchant = String(input.merchantAppUrl || '').trim().toLowerCase();
  if (!api) return { ok: false, reason: 'ACCURA_API_BASE_URL_REQUIRED' };

  if (input.env === 'PRODUCTION') {
    if (!api.startsWith('https://')) {
      return { ok: false, reason: 'PRODUCTION_API_REQUIRES_HTTPS' };
    }
    if (
      api.includes('localhost') ||
      api.includes('127.0.0.1') ||
      api.includes('sandbox') ||
      api.includes('-uat.') ||
      api.includes('.uat.')
    ) {
      return { ok: false, reason: 'PRODUCTION_ENV_UAT_URL' };
    }
    if (merchant && !merchant.startsWith('https://')) {
      return { ok: false, reason: 'PRODUCTION_MERCHANT_APP_REQUIRES_HTTPS' };
    }
  }

  if (input.env === 'UAT') {
    if (
      api.includes('prod.') ||
      api.includes('production.') ||
      /https:\/\/accura(?!.*sandbox)(?!.*uat)(?!.*test)/i.test(api) &&
        api.includes('api.accura') &&
        !api.includes('sandbox') &&
        !api.includes('uat') &&
        !api.includes('test')
    ) {
      // Soft signal only when URL clearly says production.
      if (api.includes('prod') || api.includes('production')) {
        return { ok: false, reason: 'UAT_ENV_PRODUCTION_URL' };
      }
    }
  }

  return { ok: true, env: input.env };
}
