// Capa de datos. AUTH_ENABLED=false → MODO LOCAL: sin login, sin licencia, sin Supabase (todo en el dispositivo).
// Para reactivar login + licencia: AUTH_ENABLED=true y rellenar URL/anon key. Si se activa SIN configurar, la app BLOQUEA (fail-closed).
import { store } from './store.js';

export const AUTH_ENABLED = false;                       // <-- true para volver a exigir login + licencia
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';  // <-- reemplazar
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';                 // <-- reemplazar (pública; la seguridad es RLS)
const configured = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');

export const LOCAL_MODE = !AUTH_ENABLED;
export const AUTH_MISCONFIGURED = AUTH_ENABLED && !configured;
export const CONFIG_OK = AUTH_ENABLED && configured;
// La librería solo se descarga si hace falta (en modo local la app no depende de ninguna red).
export const sb = CONFIG_OK ? (await import('https://esm.sh/@supabase/supabase-js@2.45.4')).createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const timeout = (p, ms = 8000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

export const signIn = (e, p) => sb.auth.signInWithPassword({ email: e, password: p });
export const signUp = (e, p) => sb.auth.signUp({ email: e, password: p });
export const signOut = () => sb.auth.signOut();

/** {ok, reason}. Con auth activa: solo ok:true si hay fila 'active' y no vencida; todo lo demás bloquea. */
export async function checkLicense(userId) {
  if (LOCAL_MODE) return { ok: true };
  if (!CONFIG_OK) return { ok: false, reason: 'network' };
  try {
    const { data, error } = await timeout(sb.from('licenses').select('status,expires_at').eq('user_id', userId).maybeSingle());
    if (error) return { ok: false, reason: 'network' };
    if (!data) return { ok: false, reason: 'missing' };
    if (data.status !== 'active') return { ok: false, reason: 'inactive' };
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return { ok: false, reason: 'expired' };
    return { ok: true };
  } catch { return { ok: false, reason: 'network' }; }
}

/** Cola offline (IndexedDB): se reintenta al reconectar. No hace nada en modo local. */
let flushing = false;
export async function flush() {
  if (!CONFIG_OK || flushing) return; flushing = true;
  try {
    let q = store.get('queue', []);
    while (q.length) { const { error } = await timeout(sb.from(q[0].t).insert(q[0].row)); if (error) break; q = q.slice(1); store.set('queue', q); }
  } catch {}
  flushing = false;
}
const enqueue = (t, uid, r) => { if (!CONFIG_OK) return; store.set('queue', [...store.get('queue', []), { t, row: { user_id: uid, created_at: new Date().toISOString(), ...r } }].slice(-500)); flush(); };
export const saveSet = (uid, r) => enqueue('set_logs', uid, r);
export const saveBody = (uid, r) => enqueue('body_logs', uid, r);
addEventListener('online', flush);

/** IA vía Edge Function (requiere cuenta + licencia). En modo local lanza error y la app usa respuestas locales. */
export async function ai(task, payload) {
  if (!sb) throw new Error('La IA requiere iniciar sesión');
  const { data, error } = await timeout(sb.functions.invoke('ai', { body: { task, payload } }), 25000);
  if (error || !data || data.error) throw new Error(data?.error || error?.message || 'IA no disponible');
  return data;
}
