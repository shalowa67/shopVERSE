/* ShopVerse service worker.
 * - App shell (HTML, CSS, JS, icons) is cached so the installed app still opens offline.
 * - Pages and static files use the network first, so deploys show up immediately,
 *   and fall back to the cache when offline.
 * - API responses are never cached: they contain account data and must be fresh.
 * - Uploaded images (/media, versioned URLs) are cached after first view.
 * Bump VERSION whenever frontend files change so users get the new version.
 */

const VERSION = 'v2.3.0';
const SHELL_CACHE = `shopverse-shell-${VERSION}`;
const MEDIA_CACHE = 'shopverse-media';
const SHELL_ASSETS = [
  '/',
  '/styles.css?v=2.3.0',
  '/src/main.js?v=2.3.0',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('shopverse-shell-') && key !== SHELL_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const trimCache = async (name, maxEntries) => {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Page navigations: network first, cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Uploaded images: cache first (URLs change whenever the image changes).
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(MEDIA_CACHE).then((cache) => cache.put(request, copy)).then(() => trimCache(MEDIA_CACHE, 200));
        }
        return response;
      }))
    );
    return;
  }

  // Other static files: always try the network so new deploys show immediately;
  // fall back to the cached copy when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
