export function safeNotificationDestination(value?: string | null): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  try {
    const parsed = new URL(value, 'https://wekonnek.invalid');
    return parsed.origin === 'https://wekonnek.invalid'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

export function portalNotificationDestination(value: string | null | undefined, pathname: string): string | undefined {
  const destination = safeNotificationDestination(value);
  return pathname.startsWith('/shop') && destination?.startsWith('/merchant/')
    ? destination.replace('/merchant/', '/shop/')
    : destination;
}

export function pendingNotificationDestination(fallback: string, allowedPrefix: string): string {
  if (typeof window === 'undefined') return fallback;
  const destination = safeNotificationDestination(new URLSearchParams(window.location.search).get('redirect'));
  return destination?.startsWith(allowedPrefix) ? destination : fallback;
}
