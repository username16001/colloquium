/* Generated resource cache. IndexedDB and progress exports are never removed. */
const PREFIX = 'colloquium-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PREFIX + '/*__VERSION__*/';
const RESOURCES = /*__RESOURCES__*/;
const base = self.registration.scope;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    for (const path of RESOURCES) {
      const url = new URL(path, base);
      const response = await fetch(new Request(url, {cache: 'reload'}));
      if (!response.ok) throw Error('Missing offline resource: ' + path);
      await cache.put(url, response);
    }
  }));
  // Do not skipWaiting automatically: finish saving the current session first.
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, {ignoreSearch: true});
    if (cached) return cached;
    if (event.request.mode === 'navigate') return await cache.match(new URL('index.html',base)) || fetch(event.request);
    return fetch(event.request);
  })());
});
