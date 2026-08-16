/**
 * Browser-safe URL for files served by the backend upload controller.
 * Local backend URLs cannot pass through Next's image optimizer, so route
 * them through the existing same-origin backend proxy.
 */
export function publicAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const proxyLegacyPath = (pathname: string, search = '') => {
    const match = pathname.match(/^\/(?:api\/)?uploads\/(.+)$/);
    return match ? `/api/backend/uploads/${match[1]}${search}` : undefined;
  };
  try {
    const url = new URL(value);
    return proxyLegacyPath(url.pathname, url.search) || value;
  } catch {
    return proxyLegacyPath(value) || value;
  }
}
