export type ListingType = 'BAZAAR' | 'PROPERTY';
export type ListingHostEvent = 'LISTING_CREATED' | 'LISTING_UPDATED' | 'LISTING_PAYMENT_REQUIRED' | 'LISTING_PUBLISHED' | 'CLOSE_LISTING_FORM';
export type ListingHostPayload = { event: ListingHostEvent; listingType: ListingType; listingId?: string };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    webkit?: { messageHandlers?: { wekonnek?: { postMessage(payload: ListingHostPayload): void } } };
  }
}

/** Presentation bridge only. Authentication continues to use the normal secure session. */
export function notifyHostApp(displayMode: 'pwa'|'embedded', payload: ListingHostPayload) {
  if (displayMode !== 'embedded' || typeof window === 'undefined') return;
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  else window.webkit?.messageHandlers?.wekonnek?.postMessage(payload);
}
