// Bump the version whenever you change any file (and the label in index.html).
const CACHE = 'yahtzee-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up straight away), cache when offline or slow.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    const network = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (_) { /* offline */ }
    const hit = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return hit || network;
  })());
});
