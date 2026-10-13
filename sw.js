// Independent Home Screen app shell. Every cached response is reconstructed so
// Safari never receives a response carrying an internal redirect flag.
const CACHE = 'cet4-home-shell-v2';
const ASSETS = [
  './', './index.html', './style.css', './schedule.css', './planner.css',
  './planner-extra.css', './offline.css', './iphone.css', './taste.css', './app.js',
  './planner.js', './offline.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon.svg'
];
const url = path => new URL(path, self.registration.scope).href;

async function cleanResponse(response) {
  if (!response || !response.ok || response.type === 'opaque') throw Error('资源未成功返回');
  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  return new Response(await response.arrayBuffer(), { status: 200, headers });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async path => {
      const response = await fetch(url(path), { cache: 'reload', redirect: 'error' });
      await cache.put(url(path), await cleanResponse(response));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('cet4-home-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method !== 'GET' || target.origin !== self.location.origin || !target.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const appPage = url('./index.html');
    const key = request.mode === 'navigate' ? appPage : target.href;
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected) {
        const clean = await cleanResponse(response);
        await cache.put(key, clean.clone());
        return clean;
      }
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const shell = await cache.match(appPage);
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
