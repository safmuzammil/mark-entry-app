// public/sw.js
// Modern PWA Service Worker with auto-purge cache on update

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => self.clients.claim())
  );
});

// Pass through requests safely without crashing or rejecting on transient network drops
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      try {
        const cached = await caches.match(event.request);
        if (cached) return cached;
      } catch (_) {}
      return fetch(event.request);
    })
  );
});
