// Persistencia en IndexedDB con caché en memoria (lecturas síncronas). iOS puede purgar localStorage; IndexedDB + persist() resiste más.
let db; const mem = {};
// Perfiles de prueba: cada usuario guarda sus datos con su propio prefijo (juani::..., sebastian::...).
export const PROFILES = { juani: 'Juani', sebastian: 'Sebastian' };
export const profile = (() => { try { const p = sessionStorage.getItem('al:profile'); return p in PROFILES ? p : 'juani'; } catch { return 'juani'; } })();
const PFX = profile + '::';
const open = () => new Promise((ok, no) => { const r = indexedDB.open('al', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const put = (k, v) => { mem[k] = v; try { db?.transaction('kv', 'readwrite').objectStore('kv').put(v, PFX + k); } catch {} };
export async function hydrate() {
  const legacy = {}; // datos anteriores a los perfiles: pasan a Juani
  try {
    db = await open();
    await new Promise(res => { const c = db.transaction('kv').objectStore('kv').openCursor(); c.onerror = res;
      c.onsuccess = () => { const x = c.result; if (x) { if (x.key.startsWith(PFX)) mem[x.key.slice(PFX.length)] = x.value; else if (profile === 'juani' && !x.key.includes('::')) legacy[x.key] = x.value; x.continue(); } else res(); }; });
  } catch {}
  for (const k in legacy) if (!(k in mem)) put(k, legacy[k]);
  for (let i = 0; i < localStorage.length; i++) { // migración única desde la v1 (localStorage)
    const k = localStorage.key(i);
    if (profile === 'juani' && k.startsWith('al:') && k !== 'al:profile' && !(k.slice(3) in mem)) try { put(k.slice(3), JSON.parse(localStorage.getItem(k))); } catch {}
  }
  navigator.storage?.persist?.();
}
export const store = { get: (k, d) => mem[k] ?? d, set: put };
