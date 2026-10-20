const CACHE = 'orbita-shell-20261020-fluency-1';
const SHELL = ['/static/offline.html', '/static/icons/icon-192.png', '/static/icons/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('orbita-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/static/offline.html'))); return; }
  // Never cache private data, signed URLs, uploads or third-party requests.
  if (!url.pathname.startsWith('/static/')) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); } return response; }).catch(() => caches.match(event.request)));
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
