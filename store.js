// Persistencia en IndexedDB con caché en memoria (lecturas síncronas). iOS puede purgar localStorage; IndexedDB + persist() resiste más.
let db; const mem = {};
const open = () => new Promise((ok, no) => { const r = indexedDB.open('al', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const put = (k, v) => { mem[k] = v; try { db?.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch {} };
export async function hydrate() {
  try {
    db = await open();
    await new Promise(res => { const c = db.transaction('kv').objectStore('kv').openCursor(); c.onerror = res;
      c.onsuccess = () => { const x = c.result; if (x) { mem[x.key] = x.value; x.continue(); } else res(); }; });
  } catch {}
  for (let i = 0; i < localStorage.length; i++) { // migración única desde la v1 (localStorage)
    const k = localStorage.key(i);
    if (k.startsWith('al:') && !(k.slice(3) in mem)) try { put(k.slice(3), JSON.parse(localStorage.getItem(k))); } catch {}
  }
  navigator.storage?.persist?.();
}
export const store = { get: (k, d) => mem[k] ?? d, set: put };
