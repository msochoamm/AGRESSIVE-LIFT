// SW v20: la app se pide SIEMPRE a la red primero (así ves las actualizaciones al instante) y usa la caché solo sin conexión.
const C = 'al-v20', SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'store.js', 'supabase.js', 'nutrition.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'logo.png'];
const EXT = ['esm.sh', 'raw.githubusercontent.com']; // librería e imágenes de ejercicios: caché primero
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), same = u.origin === location.origin;
  if (e.request.method !== 'GET' || (!same && !EXT.includes(u.hostname))) return;
  e.respondWith(caches.open(C).then(async c => {
    if (same) return fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => c.match(e.request));
    const hit = await c.match(e.request); if (hit) return hit;
    const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
  }));
});
