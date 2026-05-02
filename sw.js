// Daycraft service worker — offline app shell + Firebase Messaging push.
// Bump VERSION whenever you ship breaking shell changes (forces fresh cache).

// ─── Firebase Messaging (background push) ───────────────────────────────────
// Loaded first so onBackgroundMessage / push handlers register before any
// other listeners. Compat builds work in classic-script SW context.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDuauJ8w1vfqtNnvOAaqzjJrIMHZpLX5SU',
  authDomain: 'daycraft-72848.firebaseapp.com',
  projectId: 'daycraft-72848',
  storageBucket: 'daycraft-72848.firebasestorage.app',
  messagingSenderId: '778642472327',
  appId: '1:778642472327:web:2e47a92f92d233fbe7e722'
});

const messaging = firebase.messaging();

// Fired when an FCM push arrives and the app is NOT in the foreground.
// (Foreground messages are handled in app.js via onMessage.)
messaging.onBackgroundMessage(payload => {
  const title = (payload.notification && payload.notification.title) || 'Daycraft';
  const body  = (payload.notification && payload.notification.body)  || '';
  const data  = payload.data || {};
  return self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:  data.reminderId || 'daycraft',
    data
  });
});

// Tap a notification → focus an open Daycraft tab, or open one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/app') && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow('/app');
  })());
});

// ─── Offline app shell ──────────────────────────────────────────────────────

const VERSION = 'daycraft-v2';
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
// - Cross-origin (Firebase, fonts, FCM) → bypass; let the browser handle it
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
