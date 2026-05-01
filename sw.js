// Daycraft service worker — offline app shell.
// Bump VERSION whenever you ship breaking shell changes (forces fresh cache).

const VERSION = 'daycraft-v1';
const SHELL = [
  '/',
  '/index.html',
  '/app',
  '/app.html',
  '/app.js',
  '/style.css',
  '/landing.css',
  '/manifest.webmanifest',
  '/icons/icon-32.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Same-origin GET → stale-while-revalidate (instant load, fresh next time)
// - Cross-origin (Firebase, fonts) → bypass; let the browser handle it
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req);
      const networked = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return cached || networked || new Response('Offline', { status: 503 });
    })
  );
});
