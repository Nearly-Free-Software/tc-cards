// Offline cache for TC Cards. Everything is pre-cached at install and served cache-first;
// a new deploy ships a new VERSION, which installs alongside, takes over and deletes the old cache.
// The two lines below are rewritten by `npm run stamp`; don't edit them by hand.
// <stamp>
const VERSION = 'tc-cards-cc3f0a2cb2';
const FILES = ["./","app.css","app.js","cards.enc.json","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","lock.js","manifest.webmanifest","motion.js","paper/back-gd.svg","paper/back-ss.svg","paper/grain-card.png","paper/grain-table.png","pile.js","swipe.js","theme.js"];
// </stamp>

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tc-cards-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    return hit ?? fetch(request);
  })());
});
