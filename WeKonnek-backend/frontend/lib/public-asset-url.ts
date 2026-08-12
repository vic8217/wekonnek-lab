/**
 * Browser-safe URL for files served by the backend upload controller.
 * Local backend URLs cannot pass through Next's image optimizer, so route
 * them through the existing same-origin backend proxy.
 */
export function publicAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const localBackend =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3000";
    if (localBackend && url.pathname.startsWith("/api/uploads/")) {
      return `/api/backend/uploads/${url.pathname.slice("/api/uploads/".length)}${url.search}`;
    }
  } catch {
    // Relative and data URLs are already browser-safe.
  }
  return value;
}
