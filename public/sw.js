// public/sw.js
// This minimal service worker is required by Android Chrome to trigger the PWA Install prompt.

self.addEventListener('install', (event) => {
    console.log('Service Worker installing.');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating.');
});

// A fetch listener is strictly required by Chrome's PWA criteria
self.addEventListener('fetch', (event) => {
    // We pass through all requests normally without caching for now
    event.respondWith(fetch(event.request));
});