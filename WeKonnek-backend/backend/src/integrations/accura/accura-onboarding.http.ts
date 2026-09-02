import { DEFAULT_ACCURA_API_TIMEOUT_MS } from './accura-client.types';
import { platformAuthorization } from './accura-onboarding.types';

export type AccuraOnboardingFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'status' | 'json' | 'headers'>>;

export type AccuraPlatformConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};

export type AccuraHttpResult = {
  status: number;
  body: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function accuraErrorCode(body: unknown): string | undefined {
  const record = asRecord(body);
  return typeof record?.error === 'string' ? record.error : undefined;
}

export async function accuraPlatformRequest(
  fetchImpl: AccuraOnboardingFetch,
  machine: AccuraPlatformConfig,
  path: string,
  init: RequestInit = {},
): Promise<AccuraHttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), machine.timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set(
      'Authorization',
      platformAuthorization(machine.clientId, machine.clientSecret),
    );
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetchImpl(`${machine.baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export function readPlatformConfig(
  get: (key: string) => string | undefined,
): AccuraPlatformConfig | null {
  const baseUrl = get('ACCURA_API_BASE_URL')?.trim();
  const clientId = get('ACCURA_PLATFORM_CLIENT_ID')?.trim();
  const clientSecret = get('ACCURA_PLATFORM_CLIENT_SECRET')?.trim();
  const timeoutRaw = get('ACCURA_API_TIMEOUT_MS');
  const timeoutMs = Number(timeoutRaw ?? DEFAULT_ACCURA_API_TIMEOUT_MS);
  if (!baseUrl || !clientId || !clientSecret) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_ACCURA_API_TIMEOUT_MS,
  };
}
