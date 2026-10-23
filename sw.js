// SW: shell en stale-while-revalidate (abre instantáneo, se actualiza en segundo plano); esm.sh cache-first.
const C = 'al-v6', SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'store.js', 'supabase.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'logo.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || (u.origin !== location.origin && u.hostname !== 'esm.sh')) return;
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
