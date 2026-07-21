// Service Worker for WeKonnek PWA
// Strategy:
//   - Navigations (HTML)      → browser network (allows Nginx Basic Auth)
//   - Next.js static assets   → cache-first (immutable, content-hashed)
//   - Other same-origin GET   → stale-while-revalidate
//   - /api/ GET               → network-first (offline → cache → JSON error)
const CACHE_NAME = 'wekonnek-v5';
const API_CACHE_NAME = 'wekonnek-api-v5';

// Minimal app shell. Kept small & resilient so one missing file can't break install.
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/logo/weKonnekLogov1.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Add individually so a single failure doesn't abort the whole precache.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache
            .add(new Request(url, { credentials: 'same-origin' }))
            .catch((err) => console.warn('[sw] precache skipped', url, err)),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE_NAME && n !== API_CACHE_NAME)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // ── API: network-first ──────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(API_CACHE_NAME).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              new Response(
                JSON.stringify({ error: 'You are offline. Please check your connection.' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } },
              ),
          ),
        ),
    );
    return;
  }

  // Let the browser own document navigations. In particular, a navigation
  // must reach Nginx directly for an HTTP Basic Auth challenge to display and
  // cached HTML must not bypass sandbox access control.
  if (request.mode === 'navigate') {
    return;
  }

  // ── Static, content-hashed assets: cache-first ──────
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, copy));
            }
            return response;
          })
          .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
      }),
    );
    return;
  }

  // ── Everything else same-origin: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 503, statusText: 'Offline' }));
      return cached || network;
    }),
  );
});
