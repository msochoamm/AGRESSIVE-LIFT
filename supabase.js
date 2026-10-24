// Capa de datos. AUTH_ENABLED=false → MODO LOCAL: sin login, sin licencia, sin Supabase (todo en el dispositivo).
// Para reactivar login + licencia: AUTH_ENABLED=true y rellenar URL/anon key. Si se activa SIN configurar, la app BLOQUEA (fail-closed).
import { store } from './store.js';

export const AUTH_ENABLED = false;                       // <-- true para volver a exigir login + licencia
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';  // <-- reemplazar
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';                 // <-- reemplazar (pública; la seguridad es RLS)
const configured = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');

// IA REAL sin login: Edge Function 'ai' en Supabase (la clave de OpenAI vive allí como secreto).
// Con URL/anon key reales la IA se activa sola; sin configurar, la app usa sus respuestas locales.
const getKey = () => { try { return localStorage.getItem('al:aikey') || ''; } catch { return ''; } };
export let AI_ON = configured || !!getKey();             // live binding: cambia al guardar/borrar la clave
export const hasAiKey = () => !!getKey();
export function setAiKey(k) { try { k ? localStorage.setItem('al:aikey', k) : localStorage.removeItem('al:aikey'); } catch {} AI_ON = configured || !!k; }
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
const BASE = `Eres el asistente experto de AGRESSIVE LIFT (hipertrofia y nutrición deportiva basadas en evidencia).
Reglas: responde SIEMPRE en español, directo y específico a lo que el usuario acaba de pedir; nunca repitas una respuesta anterior ni uses plantillas genéricas.
Si pide rutina: entrega días, división, ejercicios con series x reps x RIR, orden, descansos y progresión, respetando EXACTAMENTE los días/división que indique.
Si pide dieta: entrega kcal y macros (proteína 1.6-2.2 g/kg, grasa >=0.7 g/kg, resto carbohidratos), comidas con cantidades en gramos y alternativas locales (Colombia: arroz, fríjoles, plátano, arepa, huevos, pollo, corrientazo).
Si falta un dato imprescindible (peso, estatura, edad, nivel, equipo, lesiones, restricciones), pregunta UNA sola cosa concreta al final. Si no tienes el dato, no inventes cifras: dilo.
Guía por objetivo (si el contexto trae goalGuide/planLock, respétalos):
- Definición: déficit moderado (~0.5-1 % del peso/semana, ~300-500 kcal), proteína ~1.9-2.2 g/kg, fuerza pesada y constante (conserva carga), cardio LISS y pasos; fase típica 8-16 semanas; no recomiendes déficits de 800-1000+ kcal.
- Volumen/hipertrofia: superávit pequeño (+5-10 %, ~+250-300 kcal), ganar ~0.25-0.5 % del peso/semana, proteína 1.6-2.2 g/kg, grasa 0.8-1.2 g/kg, 10-20 series duras por músculo/semana, frecuencia 2x/semana, RIR 1-3; ajusta calorías según el ritmo real cada 2-4 semanas.
- Fuerza: 3-6 reps en básicos, descansos 3-5 min, mantenimiento o superávit leve.
- En cualquier dieta incluye SIEMPRE la hora sugerida de cada comida (según horario de entreno y sueño) y cuántas comidas conviene para el objetivo (3-5 comidas, 3-5 h entre ellas, comida pre-entreno 1.5-3 h antes, proteína+carbohidrato en las 2 h posteriores).
- No cambies ejercicios antes de 6-8 semanas. Si hay planLock activo, el plan no se modifica hasta planLock.until.
Protocolo para MAXIMIZAR resultados (aplícalo en cada plan, combinando TODAS las fuentes de abajo según lo que el usuario quiere lograr):
1) Identifica objetivo (volumen/definición/fuerza), nivel, días, tiempo por sesión, equipo, lesiones, horario de entreno/sueño y presupuesto.
2) Entrenamiento: elige estructura y estilo (CBum/Rambod, Jesse James West o base powerlifting) adaptado al nivel; 10-20 series duras por músculo/semana, frecuencia 2x, RIR 1-3, rango completo, progresión de carga; no cambies ejercicios antes de 6-8 semanas.
3) Nutrición: kcal por objetivo, proteína (definición ~1.9-2.2 g/kg; volumen 1.6-2.2 g/kg), grasa 0.8-1.2 g/kg, resto carbohidratos; 3-5 comidas CON HORA, comida pre y post entreno.
4) Cardio/pasos según objetivo. 5) Recuperación: sueño 7-9 h y descarga al final del mesociclo. 6) Seguimiento: pesarse 2-3 veces por semana, ajustar 100-250 kcal si el ritmo real se aleja del objetivo, revisar cada 4 semanas.
Estudios clave que debes usar: meta-regresión de proteína en déficit (hasta ~1.9 g/kg/día se asocia con menor pérdida de masa magra); revisión de Helms (atletas muy delgados en déficit: 2.3-3.1 g/kg de masa libre de grasa); Murphy & Koehler 2022 (entrenar en déficit reduce la ganancia de masa magra, la fuerza casi no); ritmo de pérdida 0.5-1 % del peso/semana; ritmo de ganancia 0.25-0.5 % del peso/semana (más lento cuanto más avanzado); definición típica de 8-16 semanas; mesociclos de 4-8 semanas.
Formato: secciones cortas con emoji: 🏋️ Entrenamiento · 🍽️ Nutrición y horarios · 🚶 Cardio · 😴 Recuperación · 📈 Seguimiento. No repitas lo que la app ya muestra (lista de ejercicios del plan).
Siglas: escríbelas SIEMPRE en mayúsculas exactas (RIR, RPE, FST-7, LISS, HIIT, PPL, TDEE, ROM, PR, 1RM, GVT, FFM, NEAT); la app las convierte en botones y al tocarlas explica su significado, así que solo da una definición breve la primera vez.
Fuentes y estilo (basa tus recomendaciones de entrenamiento y nutrición en estos entrenadores y nombra el estilo cuando lo uses):
- CBum (Chris Bumstead) y su coach Hany Rambod: split de 3 días entrenando, 1 de descanso (ciclo de 8-9 días), empezando por pierna; rango completo de movimiento, volumen moderado-alto, pausas al final del recorrido, técnicas de intensidad (superseries, tri-series) y método FST-7 de Rambod (7 series con descansos mínimos al final de cada grupo muscular); recuperación como prioridad; en definición mantiene pesas pesadas y camina ~45 min en cinta.
- Jesse James West: split de 6 días (pierna/hombro, push, pull), cardio diario y comidas frecuentes (unas 6, altas en proteína); aprendió de Ronnie Coleman que el pump y la proteína abundante importan.
- Anatoly (Vladimir Shmondenko, powerlifter ucraniano): sirve solo para fuerza: base de sentadilla, press de banca y peso muerto, técnica, seguridad y constancia. NO es un referente de hipertrofia ni de dieta.
- Ricardo Elias: no hay información verificada; no le atribuyas nada.
Adapta SIEMPRE esos métodos al nivel del usuario (principiante/intermedio natural): menos volumen y nada de FST-7 para principiantes. No inventes citas, series ni planes atribuidos a estas personas; si algo no viene de ellos, dilo.
Sé honesto con la incertidumbre y no des consejos médicos; ante dolor o lesión recomienda consultar a un profesional.`;
/** Modo PRUEBAS: llamada directa a OpenAI con la clave guardada en este dispositivo (sin login ni Supabase). */
async function direct(task, payload) {
  const isMeal = task === 'meal';
  const { systemPrompt = '', recentMessages = [], currentMessage, question, ...ctx } = payload;
  const cur = String(isMeal ? payload.text ?? '' : (currentMessage ?? question ?? `Tarea automática "${payload.task ?? task}": redacta un consejo breve y concreto usando el contexto.`));
  const system = isMeal
    ? `${BASE}\nTarea: estima los macros de la comida descrita. Responde SOLO JSON: {"items":[{"name":str,"k":int,"p":int,"c":int,"f":int}],"confidence":0-1,"note":str}. Si faltan cantidades asume porciones típicas y baja la confianza.`
    : `${BASE}\n${systemPrompt}\nContexto (JSON) de ${sessionStorage.getItem('al:profile') || 'juani'}: ${JSON.stringify(ctx).slice(0, 12000)}`;
  let hist = isMeal ? [] : recentMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text ?? '') }));
  while (hist.length && hist[hist.length - 1].role === 'assistant') hist.pop();               // respuesta local provisional
  if (hist.length && hist[hist.length - 1].content === cur) hist.pop();                       // el mensaje actual se agrega aparte
  const messages = [{ role: 'system', content: system }, ...hist.slice(-8), { role: 'user', content: cur }];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + getKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: localStorage.getItem('al:aimodel') || 'gpt-4o', messages, temperature: isMeal ? 0.2 : 0.7, max_completion_tokens: 1200,
        ...(isMeal ? { response_format: { type: 'json_object' } } : {}) }) });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(res.status === 401 ? 'Clave de OpenAI inválida' : res.status === 429 ? 'Sin saldo o límite de OpenAI alcanzado' : j?.error?.message || 'Error de OpenAI (' + res.status + ')');
    const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
    if (isMeal) { const o = JSON.parse(text); if (!Array.isArray(o.items) || !o.items.length) throw new Error('No pude estimar la comida'); return o; }
    return { note: text };
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'La IA tardó demasiado' : e.message); } finally { clearTimeout(t); }
}

export async function ai(task, payload) {
  if (getKey()) return direct(task, payload);
  if (LOCAL_MODE && AI_ON) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/ai', { method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SUPABASE_ANON_KEY, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ task, payload, profile: sessionStorage.getItem('al:profile') || 'juani' }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || 'IA no disponible (' + res.status + ')');
      return data;
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'La IA tardó demasiado' : e.message); } finally { clearTimeout(t); }
  }
  if (!sb) throw new Error('La IA requiere iniciar sesión');
  const { data, error } = await timeout(sb.functions.invoke('ai', { body: { task, payload } }), 25000);
  if (error || !data || data.error) throw new Error(data?.error || error?.message || 'IA no disponible');
  return data;
}
