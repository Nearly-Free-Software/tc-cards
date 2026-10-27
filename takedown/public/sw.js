// Tombstone service worker: replaces TC Cards on phones that installed it. It deletes the
// offline cache, unregisters itself and reloads open windows so they fetch the retired page.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.navigate(client.url);
  })());
});
