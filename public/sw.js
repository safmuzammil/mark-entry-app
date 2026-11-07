// public/sw.js
// Modern PWA Service Worker with auto-purge cache on update

self.addEventListener('install', (event) => {
    console.log('Service Worker installing & skipping waiting.');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating & clearing old caches.');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => caches.delete(cacheName))
            );
        }).then(() => self.clients.claim())
    );
});

// Pass through all requests dynamically without stale caching
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
