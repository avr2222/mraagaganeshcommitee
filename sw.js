/* Ganesh Pooja Expense Portal — service worker
   Caches the app shell (HTML/CSS/JS/icons) for offline/instant loads.
   Everything cross-origin (Supabase API calls, Google Fonts, the
   supabase-js CDN script) always goes to the network — financial data
   must never be served stale from a cache. */

const CACHE_NAME = 'gpep-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only intercept same-origin GET requests for our own static files.
  // Supabase auth/data calls and any other cross-origin request are left
  // completely alone so they always hit the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached);
      // Stale-while-revalidate: instant load from cache, refresh in background.
      return cached || networkFetch;
    })
  );
});
