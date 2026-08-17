// Service Worker for WeKonnek PWA
// Strategy:
//   - Navigations (HTML)      → browser network (allows Nginx Basic Auth)
//   - Next.js static assets   → cache-first (immutable, content-hashed)
//   - Other same-origin GET   → stale-while-revalidate
//   - /api/ GET               → network-first (offline → cache → JSON error)
const CACHE_NAME = 'wekonnek-v7';
const API_CACHE_NAME = 'wekonnek-api-v7';

// Minimal app shell. Kept small & resilient so one missing file can't break install.
const PRECACHE_URLS = [
  '/manifest.json',
  '/images/weKonnekLogov1.png',
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

function safeNotificationPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/'; }
  catch { return '/'; }
}

function portalForPath(path) {
  if (path.startsWith('/merchant/')) return 'merchant';
  if (path.startsWith('/shop/')) return 'shop';
  if (path.startsWith('/admin/')) return 'admin';
  if (path.startsWith('/coordinator/')) return 'coordinator';
  return 'customer';
}

function loginPathFor(target) {
  const portal = portalForPath(target);
  const login = portal === 'merchant' ? '/merchant' : portal === 'shop' ? '/shop' : portal === 'admin' ? '/admin/login' : portal === 'coordinator' ? '/coordinator/login' : '/auth/login';
  return `${login}?redirect=${encodeURIComponent(target)}`;
}

function forShopPortal(target) {
  return target.startsWith('/merchant/') ? target.replace('/merchant/', '/shop/') : target;
}

function requestWindowContext(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      channel.port2.close();
      resolve({ client, authenticated: false });
    }, 400);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve({ client, ...(event.data || {}) });
    };
    client.postMessage({ type: 'WK_NOTIFICATION_CONTEXT_REQUEST' }, [channel.port2]);
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { notification: { title: 'WeKonnek', body: event.data?.text() || 'You have a new notification.' } }; }
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || payload.title || 'WeKonnek';
  const body = notification.body || data.body || payload.body || 'You have a new notification.';
  const target = data.url || notification.click_action || payload.url;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/images/weKonnekLogov1.png',
    badge: '/images/weKonnekLogov1.png',
    data: { url: safeNotificationPath(target) },
    tag: payload.fcmMessageId || data.notificationId || undefined,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeNotificationPath(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const ownWindows = clients.filter(client => new URL(client.url).origin === self.location.origin);
    const contexts = await Promise.all(ownWindows.map(requestWindowContext));
    const targetUrl = new URL(target, self.location.origin);
    const targetShopId = Number(targetUrl.searchParams.get('shopId')) || null;
    const exactShop = targetShopId ? contexts.find(context => context.authenticated && context.portal === 'shop' && Number(context.shopId) === targetShopId) : undefined;
    const merchant = contexts.find(context => context.authenticated && context.portal === 'merchant');
    const samePortal = contexts.find(context => context.authenticated && context.portal === portalForPath(target));
    const reusable = exactShop || merchant || samePortal;
    if (reusable) {
      const path = reusable.portal === 'shop' ? forShopPortal(target) : target;
      const destination = new URL(path, self.location.origin).href;
      const navigated = reusable.client.url === destination ? reusable.client : await reusable.client.navigate(destination);
      return (navigated || reusable.client).focus();
    }
    const otherShop = targetShopId ? contexts.find(context => context.authenticated && context.portal === 'shop') : undefined;
    if (otherShop) {
      const shopTarget = forShopPortal(target);
      const switchShop = `/shop?redirect=${encodeURIComponent(shopTarget)}`;
      const navigated = await otherShop.client.navigate(new URL(switchShop, self.location.origin).href);
      return (navigated || otherShop.client).focus();
    }
    const existing = ownWindows[0];
    const login = loginPathFor(target);
    if (existing) {
      const navigated = await existing.navigate(new URL(login, self.location.origin).href);
      return (navigated || existing).focus();
    }
    return self.clients.openWindow(login);
  }));
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

  // Next App Router client navigations request an RSC payload rather than a
  // document. Never serve those payloads (or authenticated portal routes)
  // stale: doing so can render the previous deployment until a hard refresh.
  const isRscRequest =
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-router-state-tree') ||
    url.searchParams.has('_rsc');
  const isAuthenticatedPortal = /^(?:\/admin|\/merchant|\/shop|\/coordinator)(?:\/|$)/.test(
    url.pathname,
  );
  if (isRscRequest || isAuthenticatedPortal) return;

  // ── API: network-first ──────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    // Never persist authenticated API responses in a shared browser cache.
    // This prevents account A's private data from appearing after account B logs in.
    if (request.headers.has('authorization')) return;
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
