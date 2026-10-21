importScripts('/static/share-worker.js');
const CACHE = 'orbita-shell-20261021-review-1';
const SHELL = ['/static/offline.html', '/static/icons/icon-192.png', '/static/icons/icon-512.png'];
const MAX_ASSETS = 80;
let cacheWrites = Promise.resolve();
function remember(request, response) {
  // Serialize pruning so concurrent downloads cannot exceed the cache budget.
  cacheWrites=cacheWrites.catch(()=>{}).then(async()=>{
    const cache=await caches.open(CACHE),url=new URL(request.url);
    const keys=await cache.keys();
    await Promise.all(keys.filter(key=>new URL(key.url).pathname===url.pathname&&key.url!==url.href).map(key=>cache.delete(key)));
    await cache.put(request,response);
    const assets=(await cache.keys()).filter(key=>!SHELL.includes(new URL(key.url).pathname));
    await Promise.all(assets.slice(0,Math.max(0,assets.length-MAX_ASSETS)).map(key=>cache.delete(key)));
  });
  return cacheWrites.catch(()=>{}); // Quota failures must never break navigation.
}
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('orbita-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method==='POST'&&url.origin===self.location.origin&&url.pathname==='/share-target'){event.respondWith(receiveShare(event.request));return;}
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/static/offline.html'))); return; }
  // Never cache private data, signed URLs, uploads or third-party requests.
  const asset=/^\/static\/dist\/[\w-]+\.(?:js|css)$/.test(url.pathname)||/^\/static\/[^/]+\.(?:js|css)$/.test(url.pathname)||/^\/static\/(?:icons|assets|stickers)\/[^/]+\.(?:png|svg|webp|ico)$/.test(url.pathname)||SHELL.includes(url.pathname);
  if(!asset||event.request.headers.has('range')||event.request.cache==='no-store')return;
  event.respondWith(fetch(event.request).then(response => { if (response.status===200&&!response.headers.get('cache-control')?.includes('no-store')) event.waitUntil(remember(event.request,response.clone())); return response; }).catch(async()=>await caches.match(event.request)||Response.error()));
});
self.addEventListener('push', event => {
  let data = {}; try { data = event.data?.json() || {}; } catch {}
  const url = typeof data.url === 'string' && data.url.startsWith('/?') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(data.title || 'Órbita', { body: data.body || 'Você recebeu uma nova mensagem.', icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png', tag: data.tag || 'orbita-message', data: {url} }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
    for (const client of await self.clients.matchAll({type:'window', includeUncontrolled:true})) {
      if (new URL(client.url).origin === self.location.origin) { await client.navigate(url); return client.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
