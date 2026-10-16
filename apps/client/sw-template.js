/* CRDT Canvas service worker — generated at build time from sw-template.js. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `crdt-canvas-${VERSION}`;
const SCOPE = self.registration.scope;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(PRECACHE.map(path => cache.add(new Request(new URL(path, SCOPE), { cache: 'reload' })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('crdt-canvas-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || url.pathname === '/health') return;

  // App shell: network first (fresh deploys), fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(new URL('index.html', SCOPE), response.clone());
        }
        return response;
      } catch {
        return (await caches.match(new URL('index.html', SCOPE))) || (await caches.match(new URL('./', SCOPE))) || Response.error();
      }
    })());
    return;
  }

  // Hashed assets: cache first.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
