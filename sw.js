// SW v28: la app se pide SIEMPRE a la red primero (así ves las actualizaciones al instante) y usa la caché solo sin conexión.
const C = 'al-v28', SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'store.js', 'supabase.js', 'nutrition.js', 'pdf.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'logo.png'];
const EXT = ['esm.sh', 'raw.githubusercontent.com']; // librería e imágenes de ejercicios: caché primero
// Instalación tolerante: si un archivo falla (404/red), los demás se guardan igual y el SW se instala (con addAll, un solo fallo cancelaba todo).
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), same = u.origin === location.origin;
  if (e.request.method !== 'GET' || (!same && !EXT.includes(u.hostname))) return;
  e.respondWith(caches.open(C).then(async c => {
    if (same) return fetch(e.request, { cache: 'no-cache' }).then(async r => { if (r.ok) { c.put(e.request, r.clone()); return r; } return (r.status === 404 || r.status >= 500) && await c.match(e.request) || r; })
      .catch(async () => (await c.match(e.request)) || (e.request.mode === 'navigate' ? await c.match('index.html') : null) || Response.error());
    const hit = await c.match(e.request); if (hit) return hit;
    const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
  }));
});

/* v24: aviso de fin de descanso. La página manda {type:'rest', at, body}; el SW intenta avisar si la app no está a la vista.
   Mejor esfuerzo: iOS/Android pueden suspender el SW (la página también avisa al volver a primer plano). iOS exige PWA instalada (16.4+). */
let rt, rs;
self.addEventListener('message', e => {
  const m = e.data || {}; clearTimeout(rt); rs?.(); rs = null;
  if (m.type !== 'rest') return;
  e.waitUntil(new Promise(res => { rs = res; rt = setTimeout(async () => {
    const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!cs.some(c => c.visibilityState === 'visible')) await self.registration.showNotification('⏱ ¡Descanso terminado!', { body: m.body || 'Vuelve a la barra: toca la siguiente serie.', tag: 'rest', renotify: true, vibrate: [300, 100, 300, 100, 500], icon: 'icon-192.png', badge: 'icon-192.png' }).catch(() => {});
    res(); }, Math.min(Math.max(0, m.at - Date.now()), 3e5)); }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => (cs[0] ? cs[0].focus() : clients.openWindow('./')))); });

