// AGRESSIVE LIFT — SPA modular. Estado único (S) + render por plantillas + delegación de eventos.
import { CONFIG_OK, AI_ON, LOCAL_MODE, AUTH_MISCONFIGURED, sb, signIn, signUp, signOut, checkLicense, saveSet, saveBody, ai, flush } from './supabase.js';
import { hydrate, store, profile, PROFILES } from './store.js';
import * as E from './engine.js';
import * as N from './nutrition.js';

/* ---------- Utilidades y persistencia local ---------- */
const $ = s => document.querySelector(s);
const VERSION = 'v14';
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await hydrate(); // IndexedDB → caché en memoria
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_TRAINING_SCHEDULE = { days: 3, split: 'PPL', cycle: false, workDays: 3, restDays: 4, startDate: today(), weekdays: [1, 3, 5] };
const TRAINER_SYSTEM_PROMPT = 'Eres el entrenador de AGRESSIVE LIFT. Obedece el mensaje actual del usuario: nunca sustituyas una frecuencia o división explícita por una recomendación genérica de 3 días. Si indica días, descanso cíclico o estilo (PPL, torso/pierna o full body), confirma exactamente esos parámetros y entrega sesiones con ejercicios. Usa el calendario, esquema y plan actuales como contexto. No repitas literalmente tu respuesta anterior; responde en español y con acciones concretas.';
const nutritionHistory = store.get('nutritionChatHistory', []);
const previousNutritionChat = store.get('nutritionChat', []);
if (previousNutritionChat.some(message => message.role === 'user')) {
  nutritionHistory.unshift({ endedAt: new Date().toISOString(), messages: previousNutritionChat });
  store.set('nutritionChatHistory', nutritionHistory.slice(0, 100));
}
const freshNutritionChat = [{ role: 'assistant', text: N.greeting(store.get('nutritionPreferences', {}), !!store.get('target', null)) }];
store.set('nutritionChat', freshNutritionChat);
const savedTrainingSchedule = store.get('trainingSchedule', null);
const savedTrainingPlan = store.get('trainingPlan', []);
const savedTrainingConfigured = store.get('trainingConfigured', !!savedTrainingSchedule && savedTrainingPlan.length > 0);
const trainingChatHistory = store.get('trainingChatHistory', []);
const previousTrainingChat = store.get('coachChat', []);
if (previousTrainingChat.some(message => message.role === 'user')) {
  trainingChatHistory.unshift({ endedAt: new Date().toISOString(), messages: previousTrainingChat });
  store.set('trainingChatHistory', trainingChatHistory.slice(0, 100));
}
const TRAINER_GREETING = savedTrainingConfigured
  ? `Tu esquema guardado es ${savedTrainingSchedule?.days || 3} días · ${savedTrainingSchedule?.split || 'PPL'}. ¿Quieres conservarlo o cambiar frecuencia, descansos u objetivo? También puedo ajustar la rutina a tu nivel.`
  : 'Bienvenido a AGRESSIVE LIFT. Antes de abrir tu rutina necesito conocer cómo entrenas para diseñarla a tu medida. Cuéntame en un solo mensaje (o por partes): 1) tu objetivo (hipertrofia, fuerza, definición), 2) tu nivel (principiante, intermedio o avanzado), 3) cuántos días entrenas y cuántos descansas, 4) qué división prefieres (PPL, torso/pierna o full body), 5) dónde entrenas (gimnasio o casa), cuánto dura tu sesión y si tienes alguna lesión o molestia.';
const freshCoachChat = [{ role: 'assistant', text: TRAINER_GREETING }];
store.set('coachChat', freshCoachChat);

/* ---------- Datos del programa ---------- */
// Mesociclo fijo: la lista NO rota. Smart Swap es temporal (solo la sesión actual).
const PROGRAM = {
  push: [
    { id: 'p1', n: 'Press inclinado con mancuernas', m: 'Pecho', alt: ['Press inclinado en máquina', 'Press en Smith inclinado'] },
    { id: 'p2', n: 'Press de pecho en máquina', m: 'Pecho', alt: ['Aperturas en polea', 'Press con mancuernas plano'] },
    { id: 'p3', n: 'Elevaciones laterales en polea', m: 'Hombro', alt: ['Elevaciones laterales con mancuerna', 'Lateral en máquina'] },
    { id: 'p4', n: 'Press militar en máquina', m: 'Hombro', alt: ['Press militar con mancuernas', 'Press Arnold'] },
    { id: 'p5', n: 'Extensión de tríceps en polea', m: 'Tríceps', alt: ['Press francés con barra Z', 'Fondos en máquina'] },
  ],
  pull: [
    { id: 'l1', n: 'Jalón al pecho', m: 'Dorsal', alt: ['Dominadas asistidas', 'Jalón unilateral en polea'] },
    { id: 'l2', n: 'Remo en máquina con apoyo pectoral', m: 'Espalda', alt: ['Remo en polea baja', 'Remo con mancuerna apoyado'] },
    { id: 'l3', n: 'Pullover en polea', m: 'Dorsal', alt: ['Pullover con mancuerna'] },
    { id: 'l4', n: 'Curl inclinado con mancuernas', m: 'Bíceps', alt: ['Curl en polea', 'Curl predicador'] },
    { id: 'l5', n: 'Face pull', m: 'Deltoide post.', alt: ['Pec deck inverso', 'Pájaros con mancuernas'] },
  ],
  legs: [
    { id: 'g1', n: 'Prensa de piernas', m: 'Cuádriceps', alt: ['Hack squat', 'Sentadilla en Smith'] },
    { id: 'g2', n: 'Curl femoral sentado', m: 'Isquios', alt: ['Curl femoral tumbado', 'Peso muerto rumano'] },
    { id: 'g3', n: 'Extensión de cuádriceps', m: 'Cuádriceps', alt: ['Sissy squat', 'Sentadilla búlgara'] },
    { id: 'g4', n: 'Hip thrust', m: 'Glúteo', alt: ['Patada de glúteo en polea', 'Puente de glúteo en Smith'] },
    { id: 'g5', n: 'Gemelo de pie', m: 'Gemelo', alt: ['Gemelo en prensa', 'Gemelo sentado'] },
  ],
};
// Volumen semanal por músculo: mev (mínimo efectivo) y mrv (máximo recuperable), series/semana.
const MUSCLES = {
  pecho: { n: 'Pecho', mev: 8, mrv: 22 }, espalda: { n: 'Espalda', mev: 10, mrv: 25 },
  hombros: { n: 'Hombros', mev: 8, mrv: 26 }, biceps: { n: 'Bíceps', mev: 8, mrv: 20 },
  triceps: { n: 'Tríceps', mev: 6, mrv: 18 }, core: { n: 'Core', mev: 0, mrv: 20 },
  cuads: { n: 'Cuádriceps', mev: 8, mrv: 20 }, isquios: { n: 'Isquios', mev: 6, mrv: 16 },
  gluteos: { n: 'Glúteos', mev: 0, mrv: 16 }, gemelos: { n: 'Gemelos', mev: 8, mrv: 20 },
};
const ALL = Object.values(PROGRAM).flat();
const MAP = { Core: 'core', Pecho: 'pecho', Hombro: 'hombros', 'Deltoide post.': 'hombros', 'Tríceps': 'triceps', Dorsal: 'espalda', Espalda: 'espalda',
  'Bíceps': 'biceps', 'Cuádriceps': 'cuads', Isquios: 'isquios', 'Glúteo': 'gluteos', Gemelo: 'gemelos' };
const dAdd = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// Series de la última semana por grupo (para respetar el MRV en tiempo real).
const weekDone = k => [...ALL, ...Object.values(CEX)].filter(e => MAP[e.m] === k).reduce((n, e) => n + (S.logs[e.id] || []).filter(x => (Date.now() - new Date(x.d)) / 864e5 < 7 && x.t !== 'w').length, 0);
// Catálogo: SIEMPRE 2 ejercicios por músculo (principal + complementario).
const CATALOG = {
  pecho: ['Press inclinado con mancuernas 4×8-10', 'Aperturas en polea 3×12-15'],
  espalda: ['Jalón al pecho 4×8-12', 'Remo con apoyo pectoral 4×8-12'],
  hombros: ['Press militar en máquina 3×8-10', 'Elevaciones laterales en polea 4×12-15'],
  biceps: ['Curl inclinado con mancuernas 3×10-12', 'Curl predicador 3×10-12'],
  triceps: ['Press francés con barra Z 3×8-10', 'Extensión de tríceps en polea 3×10-12'],
  core: ['Crunch en polea 3×12-15', 'Elevación de piernas colgado 3×10-15'],
  cuads: ['Prensa de piernas 4×8-12', 'Extensión de cuádriceps 3×12-15'],
  isquios: ['Peso muerto rumano 3×8-10', 'Curl femoral sentado 4×8-12'],
  gluteos: ['Hip thrust 4×8-12', 'Sentadilla búlgara 3×8-10'],
  gemelos: ['Gemelo de pie 4×10-15', 'Gemelo sentado 3×12-20'],
};
const PRESETS = { Push: ['pecho', 'hombros', 'triceps'], Pull: ['espalda', 'biceps'], Piernas: ['cuads', 'isquios', 'gluteos', 'gemelos'] };
const LABEL = { pecho: 'Pecho', espalda: 'Espalda', hombros: 'Hombro', biceps: 'Bíceps', triceps: 'Tríceps', core: 'Core', cuads: 'Cuádriceps', isquios: 'Isquios', gluteos: 'Glúteo', gemelos: 'Gemelo' };
const clean = n => n.replace(/\s*\d+\s*[x×]\s*[\d-]+.*$/i, '').trim();
const slug = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CEX = {}; // ejercicios del catálogo con id estable (para registrar series y autorregulación)
Object.entries(CATALOG).forEach(([k, l]) => l.forEach((full, i) => { const n = clean(full); CEX['c-' + slug(n)] = { id: 'c-' + slug(n), n, m: LABEL[k], k, alt: [clean(l[1 - i])], sets: +(full.match(/(\d+)\s*[x×]/)?.[1]) || 3, rng: full.match(/[x×]\s*([\d-]+)/)?.[1] || '8-12', fin: i === 1 }; }));
// Orden estratégico: músculos grandes primero (los priorizados antes que todos); compuesto pesado → aislamiento (finalizador).
const ORDER = ['cuads', 'isquios', 'gluteos', 'espalda', 'pecho', 'hombros', 'triceps', 'biceps', 'gemelos', 'core'];
const strategicOrder = ks => { const by = a => [...a].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y)); return [...by(ks.filter(k => S.focus.includes(k))), ...by(ks.filter(k => !S.focus.includes(k)))]; };
const exById = id => CEX[id] || ALL.find(e => e.id === id);
const exByName = name => { const t = slug(clean(name)); return Object.values(CEX).find(e => slug(e.n) === t) || ALL.find(e => slug(e.n) === t); };
const videoUrl = name => 'https://www.youtube.com/results?search_query=' + encodeURIComponent('cómo hacer ' + clean(name) + ' técnica correcta');
const STYLES = {
  batch: ['Batch Cooking', 'Cocinas 1-2 días y porcionas la semana.'],
  dia: ['Cocina al Día', 'Cocinas fresco cada día; más flexible.'],
  hibrido: ['Híbrido', 'Base en batch + comidas frescas.'],
  libres: ['Macros Libres', 'Cualquier comida, solo cierras macros.'],
};

/* ---------- Estado ---------- */
if (!store.get('meso')) store.set('meso', { start: Date.now(), weeks: 8 });
const defaultCoachChat = freshCoachChat;
const S = {
  user: null, screen: 'boot', msg: '', lock: '', tab: 'push', view: 'train',
  meso: store.get('meso'), logs: store.get('logs', {}), rave: store.get('rave', {}), raveDates: store.get('raveDates', []),
  style: store.get('style', 'hibrido'), focus: store.get('focus', []),
  profile: store.get('profile', null), target: store.get('target', null), weights: store.get('weights', []),
  adj: store.get('adj', {}), carried: store.get('carried', {}), note: '', preview: null, busy: false,
  macros: store.get('macros', { d: today(), k: 0, p: 0, c: 0, f: 0 }), meals: store.get('meals', []),
  likes: store.get('likes', []), playlist: store.get('playlist', []),
  rest: 0, fresh: '', open: null, devil: {}, swaps: {}, modal: null, setsOpen: false, playing: false, trk: 0,
  coachOpen: true, aiTab: 'coach',
  coachChat: freshCoachChat,
  trainingPlan: savedTrainingPlan,
  trainingSchedule: savedTrainingSchedule || DEFAULT_TRAINING_SCHEDULE,
  trainingConfigured: savedTrainingConfigured,
  onboarded: store.get('onboarded', savedTrainingConfigured),
  trainingPreferences: store.get('trainingPreferences', {}),
  trainingSectionTab: 'routine',
  nutritionSectionTab: 'chat',
  muscleSide: 'front',
  routineDate: today(),
  routineEdits: store.get('routineEdits', {}), dayMuscles: store.get('dayMuscles', {}), dayRest: store.get('dayRest', {}), ytkey: store.get('ytkey', ''), macroHist: store.get('macroHist', {}), toast: '', doneEx: store.get('doneEx', {}), drop: {}, restWhy: '', ytcache: store.get('ytcache', {}),
  routineModal: null,
  nutritionPreferences: store.get('nutritionPreferences', {}),
  nutritionChat: freshNutritionChat,
  nutritionHistory: store.get('nutritionChatHistory', []),
  nutritionBusy: false,
  menuDay: (new Date().getDay() + 6) % 7, menuSeed: store.get('menuSeed', 0),
};
if (!S.trainingPlan.length) {
  S.trainingPlan = [
    { day: 'Día 1 · Push', focus: 'Pecho + hombros + tríceps', blocks: ['Press inclinado 4x6-8', 'Press militar 3x8', 'Aperturas 3x10-12', 'Extensión de tríceps 2x12-15'] },
    { day: 'Día 2 · Pull', focus: 'Espalda + bíceps + core', blocks: ['Jalón al pecho 4x6-8', 'Remo 3x8-10', 'Curl 3x8-12', 'Face pull 2x12-15'] },
    { day: 'Día 3 · Legs', focus: 'Cuádriceps + glúteos + gemelos', blocks: ['Prensa 4x6-8', 'Curl femoral 3x8-10', 'Hip thrust 3x8-10', 'Gemelo 3x12-15'] },
  ];
  store.set('trainingPlan', S.trainingPlan);
}
if (typeof S.rave !== 'object' || !S.rave) S.rave = {};
if (S.macros.d !== today()) { S.macros = { d: today(), k: 0, p: 0, c: 0, f: 0 }; S.meals = []; store.set('macros', S.macros); store.set('meals', S.meals); }
const raveOn = () => (S.rave.prUntil || 0) > Date.now();
const budget = d => (S.target?.kcal || 2200) + (S.adj[d] || 0);
const nutritionTarget = () => S.target || { kcal: 2200, p: 160, c: 220, f: 70 };
const persist = (...ks) => ks.forEach(k => store.set(k, S[k]));
const addAdj = (off, k) => { const d = dAdd(off); S.adj[d] = (S.adj[d] || 0) + k; };
const mesoWeek = () => Math.min(S.meso.weeks, Math.floor((Date.now() - S.meso.start) / 6048e5) + 1);

/* ---------- Auth + muro de licencia ---------- */
async function gate(session) {
  if (LOCAL_MODE) { S.user = { id: 'local-' + profile, email: PROFILES[profile] }; S.screen = 'app'; S.msg = ''; return render(); } // sin login (temporal)
  if (AUTH_MISCONFIGURED) { S.user = null; S.lock = 'network'; S.screen = 'locked'; return render(); }      // fail-closed
  if (!session) { S.user = null; S.screen = 'auth'; return render(); }
  S.user = session.user; S.screen = 'boot'; render();
  const r = await checkLicense(session.user.id); // fail-closed: solo {ok:true} desbloquea
  if (r.ok) flush(); S.lock = r.reason || ''; S.screen = r.ok ? 'app' : 'locked';
  render();
}

/* ---------- Render parcial: morph del DOM (conserva foco, teclado, scroll e inputs) ---------- */
function morph(a, b) {
  const A = [...a.childNodes], B = [...b.childNodes];
  B.forEach((nb, i) => {
    const na = A[i];
    if (!na) return a.appendChild(nb);
    if (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName || na.id !== nb.id) return a.replaceChild(nb, na);
    if (nb.nodeType === 3) { if (na.data !== nb.data) na.data = nb.data; return; }
    for (const at of [...na.attributes]) if (!nb.hasAttribute(at.name)) na.removeAttribute(at.name);
    for (const at of nb.attributes) if (na.getAttribute(at.name) !== at.value) na.setAttribute(at.name, at.value);
    morph(na, nb);
  });
  A.slice(B.length).forEach(n => n.remove());
}
// Pantalla siempre encendida durante la sesión (Wake Lock; iOS 16.4+).
let lock = null;
async function wake() {
  if (S.screen !== 'app' || lock || !('wakeLock' in navigator)) return;
  lock = 1; try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
// Temporizador de descanso: el tick solo toca el texto del reloj (sin re-render).
const beep = () => { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); c.close(); }, 400); } catch {} };
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const restBar = () => S.rest > Date.now() ? `<div class="rest" id="rest"><b id="rt" class="neon">${fmt(S.rest - Date.now())}</b><span class="text-sm text-zinc-400 flex-1 min-w-0 resttxt">${esc(S.restWhy || 'Descanso')}</span>
  <span class="flex gap-1"><button class="chip" data-act="rest30">+30 s</button><button class="chip" data-act="restoff">Saltar</button></span></div>` : '';
setInterval(() => {
  if (!S.rest) return; const left = S.rest - Date.now();
  if (left > 0) { const t = document.getElementById('rt'); if (t) t.textContent = fmt(left); }
  else { S.rest = 0; S.restWhy = ''; beep(); navigator.vibrate?.([200, 100, 200]); render(); }
}, 250);
// Mini-gráficas SVG.
const spark = v => { if (v.length < 2) return ''; const lo = Math.min(...v), hi = Math.max(...v);
  return `<svg viewBox="0 0 120 28" preserveAspectRatio="none" class="spark"><polyline fill="none" stroke="#ff0033" stroke-width="2" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1) * 120).toFixed(1)},${(26 - (y - lo) / ((hi - lo) || 1) * 24).toFixed(1)}`).join(' ')}"/></svg>`; };
const e1h = id => { const l = (S.logs[id] || []).filter(x => x.t !== 'w'); return [...new Set(l.map(s => s.d))].map(d => Math.max(...l.filter(s => s.d === d).map(s => s.w * (1 + s.r / 30)))).slice(-12); };

/* ---------- Vistas ---------- */
const authView = () => `
<div class="pt-24 text-center">
  <img src="logo.png" alt="AGRESSIVE LIFT" width="220" height="220" class="mx-auto">
  <p class="text-zinc-500 mt-2 mb-8">Acceso por licencia</p>
  ${CONFIG_OK ? '' : '<p class="text-xs text-red-400 mb-3">Configura SUPABASE_URL y ANON_KEY en supabase.js</p>'}
  <input id="em" type="email" placeholder="Correo" autocomplete="email" class="mb-3">
  <input id="pw" type="password" placeholder="Contraseña (mín. 6)" autocomplete="current-password" class="mb-3">
  <p class="text-red-400 min-h-[1.5rem] text-sm">${esc(S.msg)}</p>
  <div class="flex gap-2 mt-2"><button class="btn fill flex-1" data-act="login">Entrar</button>
  <button class="btn flex-1" data-act="signup">Crear cuenta</button></div>
</div>`;

const lockedView = () => `
<div class="pt-40 text-center">
  <div class="text-6xl neon">⛔</div>
  <h2 class="text-2xl font-black mt-4">${S.lock === 'network' ? 'No se pudo verificar la licencia. Acceso bloqueado por seguridad.' : 'Licencia inactiva. Contacta al Administrador'}</h2>
  <p class="text-zinc-500 text-sm mt-2">${{ network: 'Revisa tu conexión y reintenta.', missing: 'No existe licencia para esta cuenta.', expired: 'Tu licencia venció.' }[S.lock] || ''}</p>
  <p class="text-zinc-500 text-sm mt-2">${esc(S.user?.email || '')}</p>
  <div class="flex gap-2 mt-8"><button class="btn flex-1" data-act="recheck">Reintentar</button>
  <button class="btn ghost flex-1" data-act="logout">Salir</button></div>
</div>`;

const header = () => `
<div class="flex justify-between items-center pt-4">
  <div><div class="brand-title font-black neon"><img src="icon-180.png" alt="">AGRESSIVE LIFT</div>
  <div class="text-xs text-zinc-500">Mesociclo · semana ${mesoWeek()}/${S.meso.weeks} · rotación bloqueada · ${VERSION}</div>${xpLine()}</div>
  ${LOCAL_MODE ? `<button class="btn ghost" data-act="switchuser">👤 ${esc(PROFILES[profile])}<br><small>Cambiar</small></button>` : '<button class="btn ghost" data-act="logout">Salir</button>'}
</div>
${raveOn() ? `<div class="card on mt-3 text-sm">🔒 Modo Rave activo: PRs bloqueados ${Math.ceil((S.rave.prUntil - Date.now()) / 36e5)} h más. Entrena para técnica, no para récords.</div>` : ''}
<div class="tabbar">${[['train', 'Entrenar'], ['food', 'Nutrición'], ['map', 'Músculos'], ['control', 'Control']]
  .map(([k, l]) => `<button class="chip flex-1 ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${l}</button>`).join('')}</div>
</div>`;

const todaySets = id => (S.logs[id] || []).filter(s => s.d === today());
// Series de la sesión ANTERIOR (último día distinto de hoy) para autorregulación.
const prevSets = id => { const h = (S.logs[id] || []).filter(s => s.d !== today() && s.t !== 'w' && s.t !== 'drop'); const d = h.length && h[h.length - 1].d; return h.filter(s => s.d === d); };

const HEAVY = /prensa|press|jal[oó]n|remo|muerto|sentadilla|thrust|dominada|b[uú]lgara/i;
const GRIP = /jal[oó]n|remo|curl|muerto|dominada|pullover|face pull|encogimiento|colgado/i; // ejercicios donde el agarre puede limitar
const DROP_REPS = [8, 12, 16];
const isDone = id => !!S.doneEx[S.routineDate]?.[id];
const setLabel = t => (t === 'w' ? 'Calentamiento' : t === 'drop' ? '⬇ Drop' : `Serie ${t || '·'}`);
/** Descanso según ejercicio (pesado/aislamiento), reps, RIR y tipo de serie. */
function restPlan({ id, t, r, rir, drop }) {
  if (t === 'w') return { sec: 45, why: 'Calentamiento: descanso corto' };
  const heavy = HEAVY.test(exById(id)?.n || '');
  let sec = heavy ? 120 : 75, why = heavy ? 'Compuesto pesado' : 'Aislamiento';
  if (r <= 6) { sec += 30; why += ' + pocas reps'; } else if (r >= 15) sec -= 15;
  if (rir <= 0) { sec += 30; why += ' + al fallo'; } else if (rir === 1) sec += 15; else if (rir >= 3) sec -= 15;
  if (drop === 'end') { sec += 45; why = 'Cierre del drop set: fatiga alta'; }
  return { sec: Math.max(30, Math.round(sec / 5) * 5), why: 'Descanso · ' + why };
}
/** Descanso al pasar al siguiente ejercicio: según el que acabas y el que sigue. */
function transitionPlan(cur, nxt) {
  const mk = e => e.k || MAP[e.m], same = mk(cur) === mk(nxt), base = HEAVY.test(cur.n) ? 120 : 75;
  const sec = Math.max(45, Math.round((base * (same ? 1 : 0.6) + (HEAVY.test(nxt.n) ? 30 : 15)) / 5) * 5);
  return { sec, why: `Siguiente: ${nxt.n} · ${same ? 'mismo músculo, recupera' : 'cambio de músculo, prepara la máquina'}` };
}
const dropBanner = (id, p) => `<div class="card on mt-3"><div class="font-bold neon">⬇ DROP SET · descenso ${p.step + 1}/3</div>
  <div class="text-sm mt-1">Baja a <b>${p.ws[p.step]} kg</b> (−20 %) y haz <b>${DROP_REPS[p.step]} reps al fallo</b>. Descanso: <b>ninguno</b>, solo cambia el peso (≈10 s).</div>
  <div class="mt-2"><div class="step"><button data-act="step" data-f="dr-${id}-${p.step}" data-s="-1" aria-label="menos">−</button><input id="dr-${id}-${p.step}" type="number" inputmode="numeric" value="${DROP_REPS[p.step]}"><button data-act="step" data-f="dr-${id}-${p.step}" data-s="1" aria-label="más">＋</button></div>
  <button class="btn fill w-full mt-2" data-act="dropsave" data-id="${id}">Guardar descenso</button></div>
  <button class="underline text-xs text-zinc-500 mt-2" data-act="dropskip" data-id="${id}">Cancelar drop set</button></div>`;
function exCard(e) {
  const name = S.swaps[e.id] || e.n, sets = todaySets(e.id), open = S.open === e.id, dv = S.devil[e.id], done = isDone(e.id), dp = S.drop[e.id];
  const work = sets.filter(x => x.t !== 'w' && x.t !== 'drop'), plan = e.sets || 3;
  const sg = open ? E.regulate(S.swaps[e.id] ? [] : prevSets(e.id), mesoWeek(), S.meso.weeks) : null;
  return `<div class="card ${open ? 'on' : ''} ${done ? 'done' : ''}">
  <div class="flex justify-between items-start" data-act="toggle" data-id="${e.id}">
    <div><div class="font-bold text-lg leading-tight">${done ? '✅ ' : ''}${esc(name)}${S.swaps[e.id] ? ' <span class="text-xs neon">SWAP</span>' : ''}</div>
    <div class="text-xs text-zinc-500">${e.m}${e.sets ? ` · plan ${e.sets}×${e.rng}` : ''} · ${work.length}/${plan} series${e.fin ? ' · <span class="neon">🔥 finalizador</span>' : ''}</div></div><span class="neon">${open ? '▾' : '▸'}</span></div>
  ${open ? `
  ${sets.map((x, i) => `<div class="text-sm text-zinc-400 mt-2 ${S.fresh === e.id && i === sets.length - 1 ? 'pop' : ''}">${setLabel(x.t)} · ${x.w} kg × ${x.r}${x.t === 'w' ? '' : ` · RIR ${x.rir}`}${x.fail && x.fail !== 'Músculo objetivo' ? ` · limitó: ${x.fail}` : ''}</div>`).join('')}
  <div class="card !p-2 mt-2 text-sm ${sg.action === 'descarga' ? 'on' : ''}"><b class="neon">${sg.action.toUpperCase()}</b>${sg.w ? ' · ' + sg.w + ' kg' : ''}<div class="text-zinc-400">${esc(sg.note)}</div></div>
  ${spark(e1h(e.id))}
  ${dp ? dropBanner(e.id, dp) : `
  <div class="flex gap-2 mt-3">${['w', 'r'].map(f => `<div class="step"><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? -2.5 : -1}" aria-label="menos">−</button><input id="${f}-${e.id}" type="number" inputmode="${f === 'w' ? 'decimal' : 'numeric'}" placeholder="${f === 'w' ? 'kg' : 'reps'}" ${f === 'w' && sg.w != null ? `value="${sg.w}"` : ''}><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? 2.5 : 1}" aria-label="más">＋</button></div>`).join('')}</div>
  <button class="btn fill w-full mt-2" data-act="logset" data-id="${e.id}">Registrar serie ${work.length + 1}</button>`}
  <div class="flex gap-2 mt-2">
    <button class="btn flex-1 ${dv ? 'fill' : ''}" data-act="devil" data-id="${e.id}">⬇ Drop set${dv ? ' ON' : ''}</button>
    <button class="btn ghost flex-1" data-act="exercisevideo" data-exercise="${esc(name)}" aria-label="Ver cómo se hace ${esc(name)}">▶ Técnica</button>
    <button class="btn ghost flex-1" data-act="swap" data-id="${e.id}">Smart Swap</button></div>
  ${dv && !dp ? '<div class="text-xs text-zinc-400 mt-2">⬇ Drop set activo: registra tu serie principal al fallo y te digo a cuánto bajar (−20 %, 3 descensos: 8 → 12 → 16 reps) y que no descanses.</div>' : ''}
  ${e.fin && !dv ? '<div class="text-xs neon mt-2">🔥 Finalizador: activa Drop set en tu última serie para dejar el músculo al límite.</div>' : ''}
  ${sets.length ? `<button class="btn ${!done && work.length >= plan ? 'fill' : 'ghost'} w-full mt-2" data-act="${done ? 'undone' : 'doneex'}" data-id="${e.id}">${done ? '↩ Reabrir ejercicio' : '✅ Ejercicio terminado'}</button>` : ''}` : ''}
  </div>`;
}


const isoDate = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const shiftIsoDate = (iso, offset) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return isoDate(date);
};
const mondayOf = iso => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return isoDate(date);
};
function routineSessionForDate(iso) {
  const schedule = S.trainingSchedule || DEFAULT_TRAINING_SCHEDULE;
  const start = schedule.startDate || today();
  const elapsed = Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5);
  if (elapsed < 0 || !S.trainingPlan.length) return null;
  let sessionIndex;
  if (schedule.cycle) {
    const workDays = Number(schedule.workDays) || schedule.days;
    const cycleLength = Math.max(1, workDays + (Number(schedule.restDays) || 0));
    const position = elapsed % cycleLength;
    if (position >= workDays) return null;
    sessionIndex = Math.floor(elapsed / cycleLength) * workDays + position;
  } else {
    const weekdays = schedule.weekdays || DEFAULT_TRAINING_SCHEDULE.weekdays;
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    const sessionPosition = weekdays.indexOf(weekday);
    if (sessionPosition < 0) return null;
    const weeksElapsed = Math.floor((Date.parse(`${mondayOf(iso)}T00:00:00Z`) - Date.parse(`${mondayOf(start)}T00:00:00Z`)) / (7 * 864e5));
    sessionIndex = weeksElapsed * weekdays.length + sessionPosition;
  }
  const index = sessionIndex % S.trainingPlan.length;
  return { ...S.trainingPlan[index], index };
}
const routineExercisesForDate = iso => S.routineEdits[iso] || [];

const dayState = iso => {
  if (Object.values(S.logs).some(l => l.some(x => x.d === iso))) return 'done';
  if (S.dayRest[iso]) return 'rest';
  return (S.routineEdits[iso] || []).length ? 'plan' : '';
};
const calendarCard = () => {
  const base = new Date(`${S.routineDate}T00:00:00Z`), y = base.getUTCFullYear(), m = base.getUTCMonth();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => isoDate(new Date(Date.UTC(y, m, i + 1))))];
  const c = { done: 0, plan: 0, rest: 0 }; cells.forEach(x => { const t = x && dayState(x); if (t) c[t]++; });
  return `<div class="card calendar-card">
    <div class="flex justify-between items-center mb-2"><div><div class="font-bold text-lg">Calendario</div>
    <div class="text-xs text-zinc-500">${base.toLocaleString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · toca un día para elegirlo</div></div>
    <div class="chip on">${c.done + c.plan} entrenos · ${c.rest} descansos</div></div>
    <div class="calendar-grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(l => `<div class="calendar-head">${l}</div>`).join('')}${cells.map(x => x ? `<button class="calendar-day ${dayState(x)} ${x === S.routineDate ? 'sel' : ''} ${x === today() ? 'today' : ''}" data-act="routinedate" data-date="${x}">${Number(x.slice(8))}${S.dayRest[x] ? '<small>😴</small>' : ''}</button>` : '<div></div>').join('')}</div>
    <div class="text-xs text-zinc-500 mt-2">Rojo sólido: entreno hecho · borde rojo: planeado · 😴 descanso</div>
  </div>`;
};

const profileCard = () => `<div class="card"><div class="font-bold mb-2">1 · Perfil y objetivo</div>
  <div class="grid grid-cols-2 gap-2"><input id="pf-kg" type="number" inputmode="decimal" placeholder="Peso kg"><input id="pf-h" type="number" inputmode="numeric" placeholder="Altura cm">
  <input id="pf-a" type="number" inputmode="numeric" placeholder="Edad"><select id="pf-s"><option value="m">Hombre</option><option value="f">Mujer</option></select></div>
  <select id="pf-g" class="mt-2"><option value="cut">Definición (bajar grasa)</option><option value="maint">Mantenimiento</option><option value="bulk">Volumen (ganar músculo)</option></select>
  <button class="btn fill w-full mt-2" data-act="profile">Calcular mis macros</button></div>`;
const nOn = (k, v) => { const c = S.nutritionPreferences[k]; return Array.isArray(c) ? c.includes(v) : String(c) === v; };
const nGroup = q => `<div class="nq"><div class="nq-t">${q.q}${q.multi ? ' <span class="text-zinc-500">(varias)</span>' : ''}</div><div class="quick-prompts !mt-1">${q.opts.map(([v, l]) => `<button class="chip ${nOn(q.k, v) ? 'on' : ''}" data-act="nopt" data-k="${q.k}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
const nutritionCoachCard = () => {
  const miss = N.missing(S.nutritionPreferences, !!S.target), ok = !miss.length;
  return `<div class="card on"><div class="text-xs text-zinc-500 uppercase tracking">${ok ? 'Perfil completo' : 'Entrevista nutricional · obligatoria'}</div>
    <div class="text-xl font-black mt-1">${ok ? 'Tu nutricionista ya te conoce' : 'Diseñemos tu forma de comer'}</div>
    <div class="text-sm text-zinc-400 mt-1">${ok ? 'Puedes ajustar cualquier respuesta cuando quieras: el menú y la lista de compras se recalculan.' : 'Respóndele al nutricionista: presupuesto, proteínas, tiempo y nevera definen tu menú semanal con gramos exactos.'}</div>
    <div class="onb-steps mt-3">${N.STEPS.map(([k, l]) => `<span class="onb-step ${miss.includes(k) ? '' : 'ok'}">${miss.includes(k) ? '○' : '✓'} ${l}</span>`).join('')}</div></div>
  ${!S.target ? profileCard() : ''}
  <div class="card nutrition-coach">
  <div class="flex justify-between items-center gap-2">
    <div><div class="text-xs text-zinc-500 uppercase tracking">Nutricionista IA</div><div class="font-bold text-lg">${ok ? '¿Qué preparamos?' : 'Cuéntame cómo vas a cumplir tu objetivo'}</div></div>
    <span class="text-xs text-zinc-500">Sesión actual</span>
  </div>
  <div class="coach-chat nutrition-chat" aria-live="polite">
    ${S.nutritionChat.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
    ${S.nutritionBusy ? '<div class="coach-bubble assistant">Pensando una opción…</div>' : ''}
  </div>
  ${!ok ? `<div class="nutri-next mt-3">👉 ${esc(N.askFor(miss[0]))}</div>` : ''}
  <div class="quick-prompts">
    <button class="chip" data-act="nutritionprompt" data-msg="Tengo pollo y arroz, ¿qué preparo?">Pollo y arroz</button>
    <button class="chip" data-act="nutritionprompt" data-msg="Dame una cena alta en proteína">Cena alta en proteína</button>
    <button class="chip" data-act="nutritionprompt" data-msg="¿Qué opción me conviene según mis macros restantes?">Según mis macros</button>
    <button class="chip" data-act="nutritionprompt" data-msg="Quiero pedir un corrientazo, ¿cómo lo ajusto?">Comida callejera</button>
  </div>
  <div class="coach-input-row">
    <input id="nutrition-input" type="text" placeholder="Ej: presupuesto económico, como pollo y huevo, 15 min…" maxlength="220" ${S.nutritionBusy ? 'disabled' : ''}>
    <button class="btn fill" data-act="nutritionsend" ${S.nutritionBusy ? 'disabled' : ''}>Enviar</button>
  </div>
  ${S.nutritionHistory.length ? `<details class="nutrition-history"><summary>Conversaciones anteriores (${S.nutritionHistory.length})</summary>
    ${S.nutritionHistory.map(session => `<details class="nutrition-session"><summary>${new Date(session.endedAt).toLocaleString('es-ES')}</summary>
      ${session.messages.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
    </details>`).join('')}
  </details>` : ''}
</div>
<div class="card"><div class="font-bold mb-1">${S.target ? '' : '2 · '}Respuestas rápidas</div><div class="text-xs text-zinc-500 mb-2">Toca para responder sin escribir. Todo lo marcado alimenta tu menú.</div>
  ${N.QUESTIONS.filter(q => q.req).map(nGroup).join('')}
  <details class="mt-2" ${N.QUESTIONS.filter(q => !q.req).some(q => (S.nutritionPreferences[q.k] || []).length) ? 'open' : ''}><summary class="text-sm text-zinc-400" style="min-height:40px;display:flex;align-items:center">Afinar más (restricciones, suplementos, obstáculos)</summary>${N.QUESTIONS.filter(q => !q.req).map(nGroup).join('')}</details></div>
<button class="btn fill w-full" data-act="nutriplan" ${ok ? '' : 'disabled'}>${ok ? 'Ver mi plan nutricional →' : `Faltan ${miss.length} dato${miss.length > 1 ? 's' : ''} para abrir tu plan`}</button>`;
};
/* ---------- Plan: estrategia + menú semanal + compras ---------- */
const currentMenu = () => N.generateMenu(nutritionTarget(), S.nutritionPreferences, S.menuSeed);
const PREP = { nevera: m => `🧊 Nevera · ${m} min`, cocinar: m => `🍳 ${m} min`, rapido: m => `⚡ ${m} min`, fuera: () => '🍽️ Restaurante' };
const planCards = () => {
  const prefs = S.nutritionPreferences, t = nutritionTarget(), menu = currentMenu(), day = Math.min(S.menuDay, 6), meals = menu.days[day] || [];
  const DN = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], tot = meals.reduce((a, m) => ({ k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { k: 0, p: 0, c: 0, f: 0 });
  const strat = N.strategy({ target: t, prefs, goal: S.profile?.goal || 'maint', trainDays: S.trainingSchedule?.days || 3 }), groc = N.groceries(menu);
  const GL = { prot: 'Proteínas', supp: 'Suplementos', dairy: 'Lácteos', carb: 'Carbohidratos', veg: 'Verduras', fat: 'Grasas' };
  return `<div class="card on"><div class="font-bold text-lg">🎯 Tu estrategia</div><div class="text-xs text-zinc-500 mb-1">Hecha con tus respuestas · ${t.kcal} kcal · P ${t.p} · C ${t.c} · G ${t.f}</div>
    <ul class="strat">${strat.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
  <div class="card"><div class="flex justify-between items-center gap-2"><div class="font-bold text-lg">🍽️ Menú de la semana</div><button class="chip !px-3" data-act="menuregen">🔄 Otra variante</button></div>
    <div class="daytabs">${DN.map((d, i) => `<button class="chip ${day === i ? 'on' : ''}" data-act="menuday" data-i="${i}">${d}</button>`).join('')}</div>
    ${meals.map((m, i) => `<div class="meal"><div class="flex justify-between items-start gap-2"><div class="min-w-0"><div class="text-xs neon uppercase">${m.slot}</div><div class="font-bold leading-tight">${esc(m.name)}</div></div><span class="mealtag">${(PREP[m.prep] || PREP.cocinar)(m.mins)}</span></div>
      <div class="text-sm text-zinc-400 mt-1">${m.items.map(it => esc(it.text)).join(' · ')}</div>
      <div class="flex justify-between items-center mt-1"><span class="text-xs text-zinc-500">${m.k} kcal · P ${m.p} · C ${m.c} · G ${m.f}</span><button class="chip !px-3" data-act="mealadd" data-d="${day}" data-i="${i}">＋ Registrar</button></div></div>`).join('') || '<div class="text-sm text-zinc-500">No pude armar el menú con esas restricciones: amplía las proteínas o el tiempo.</div>'}
    <div class="text-xs text-zinc-400 mt-2">Día: <b class="text-white">${tot.k}</b> kcal · P ${tot.p} · C ${tot.c} · G ${tot.f} <span class="text-zinc-500">(meta ${t.kcal} · P ${t.p} · C ${t.c} · G ${t.f})</span></div>
    ${menu.notes.map(n => `<div class="text-xs text-zinc-500 mt-1">ℹ️ ${esc(n)}</div>`).join('')}
    ${menu.prep.length ? `<details class="mt-2"><summary class="text-sm" style="min-height:40px;display:flex;align-items:center">🧊 Qué preparar en la nevera</summary><ul class="strat">${menu.prep.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="text-xs text-zinc-500">Cocina por lotes (domingo y miércoles). Dura 3–4 días en nevera; congela el resto.</div></details>` : ''}</div>
  <div class="card"><details><summary class="font-bold text-lg" style="min-height:40px;display:flex;align-items:center">🛒 Lista de compras (7 días)</summary>
    <div class="text-xs text-zinc-500 mb-1">Pesos crudos aproximados para 1 persona.</div>
    ${Object.keys(GL).map(g => { const l = groc.filter(x => x.group === g); return l.length ? `<div class="text-xs neon uppercase mt-2">${GL[g]}</div>${l.map(x => `<div class="ctl-row"><span>${esc(x.n)}${x.tier === 1 ? ' <span class="text-xs text-zinc-500">· económico</span>' : ''}</span><b>${x.amount}</b></div>`).join('')}` : ''; }).join('')}</details></div>
  <div class="card"><div class="flex justify-between items-center gap-2"><div class="text-sm text-zinc-400">¿Cambió algo (presupuesto, proteínas, tiempo)?</div><button class="chip !px-3" data-act="nutritiontab" data-tab="chat">Ajustar</button></div></div>`;
};
const coachPanel = () => `
<div class="card coach-panel on">
  <div class="text-xs text-zinc-500 uppercase tracking">Coach de entrenamiento</div>
  <div class="font-bold text-lg">Configura tu rutina conversando</div>
  <div class="coach-chat">
    ${S.coachChat.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
  </div>
  <div class="quick-prompts">
    <button class="chip" data-act="coachprompt" data-msg="Quiero entrenar seis días, descansar uno y repetir PPL. Mi objetivo es hipertrofia y soy intermedio.">PPL · 6 días</button>
    <button class="chip" data-act="coachprompt" data-msg="Quiero una rutina torso/pierna de cuatro días. Soy principiante y busco hipertrofia.">Torso/pierna · 4 días</button>
    <button class="chip" data-act="coachprompt" data-msg="Quiero entrenar full body tres días por semana para ganar fuerza.">Full body · 3 días</button>
  </div>
  <div class="coach-input-row">
    <input id="coach-input" type="text" placeholder="Objetivo, días, descansos, nivel…" maxlength="220">
    <button class="btn fill" data-act="coachsend">Enviar</button>
  </div>
  ${trainingChatHistory.length ? `<details class="coach-history"><summary>Conversaciones anteriores (${trainingChatHistory.length})</summary>
    ${trainingChatHistory.map(session => `<details class="coach-session"><summary>${new Date(session.endedAt).toLocaleString('es-ES')}</summary>
      ${session.messages.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
    </details>`).join('')}
  </details>` : ''}
</div>`;

const routineDayPicker = () => {
  const monday = mondayOf(S.routineDate);
  const sunday = shiftIsoDate(monday, 6);
  return `<div class="routine-week-heading"><span>${new Date(`${monday}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${sunday}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span></div>
  <div class="routine-week-nav">
    <button class="icon-btn" data-act="routineweek" data-d="-7" aria-label="Semana anterior" title="Semana anterior">‹</button>
    <div class="routine-week" role="tablist" aria-label="Seleccionar día de rutina">${Array.from({ length: 7 }, (_, i) => {
      const iso = shiftIsoDate(monday, i), date = new Date(`${iso}T00:00:00Z`);
      const day = date.toLocaleDateString('es-ES', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
      return `<button class="routine-day ${S.routineDate === iso ? 'on' : ''}" role="tab" aria-selected="${S.routineDate === iso}" data-act="routinedate" data-date="${iso}"><span>${day}</span><b>${date.getUTCDate()}</b></button>`;
    }).join('')}</div>
    <button class="icon-btn" data-act="routineweek" data-d="7" aria-label="Semana siguiente" title="Semana siguiente">›</button>
  </div>`;
};

const recentWarn = k => { for (const off of [-1, -2]) if ((S.dayMuscles[shiftIsoDate(S.routineDate, off)] || []).includes(k)) return -off; return 0; };
const dayBuilder = () => {
  const sel = S.dayMuscles[S.routineDate] || [];
  return `<div class="mt-3">
  <div class="font-bold mb-1">¿Qué entrenas este día?</div>
  <div class="text-xs text-zinc-500 mb-2">Elige el día arriba y marca los músculos: te armo 2 ejercicios por músculo.</div>
  <div class="flex gap-2 mb-2">${Object.keys(PRESETS).map(p => `<button class="chip flex-1" data-act="daypreset" data-p="${p}">${p}</button>`).join('')}</div>
  <div class="grid grid-cols-2 gap-2">${Object.keys(MUSCLES).map(k => { const w = recentWarn(k); return `<button class="chip ${sel.includes(k) ? 'on' : ''}" data-act="daymuscle" data-k="${k}">${MUSCLES[k].n}${w ? ` <span class="text-xs neon">⚠ hace ${w} d</span>` : ''}</button>`; }).join('')}</div>
  <button class="btn fill w-full mt-3" data-act="daygenerate">Generar rutina (${sel.length * 2} ejercicios)</button></div>`;
};
const routineDayPanel = () => {
  const iso = S.routineDate, exercises = routineExercisesForDate(iso), rest = !!S.dayRest[iso];
  const date = new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const muscles = (S.dayMuscles[iso] || []).map(k => MUSCLES[k].n).join(' · ');
  return `<div class="card routine-day-panel">
    <div class="font-bold text-lg capitalize">${date}</div>
    <div class="text-sm neon">${rest ? '😴 Día de descanso' : exercises.length ? esc(muscles || 'Sesión personalizada') : 'Sin definir: elige Entreno o Descanso'}</div>
    <div class="grid grid-cols-2 gap-2 mt-3"><button class="chip ${rest ? '' : 'on'}" data-act="daytype" data-t="train">🏋️ Entreno</button><button class="chip ${rest ? 'on' : ''}" data-act="daytype" data-t="rest">😴 Descanso</button></div>
    ${rest ? '' : `${dayBuilder()}
    <div class="flex justify-between items-center mt-3"><span class="text-xs text-zinc-500">Ejercicios del día</span><button class="btn" data-act="addroutineexercise">＋ Añadir ejercicio</button></div>
    ${exercises.length ? '<div class="text-xs text-zinc-500 mt-2">Orden estratégico: músculos grandes y priorizados primero · compuesto pesado → aislamiento · el 🔥 finalizador va con drop set para llevar el músculo al límite.</div>' : ''}<div class="routine-exercise-list">${exercises.map((exercise, index) => `<div class="routine-exercise-row">
      <span class="routine-exercise-name">${index + 1}. ${esc(exercise)}${exByName(exercise)?.fin ? ' <span class="text-xs neon">🔥 finalizador</span>' : ''}</span>
      <button class="icon-btn" data-act="exercisevideo" data-index="${index}" aria-label="Ver ${esc(exercise)}" title="Ver ejercicio">▶</button>
      <button class="icon-btn" data-act="editroutineexercise" data-index="${index}" aria-label="Editar ${esc(exercise)}" title="Editar">✎</button>
      <button class="icon-btn" data-act="removeroutineexercise" data-index="${index}" aria-label="Eliminar ${esc(exercise)}" title="Eliminar">×</button>
    </div>`).join('') || '<div class="text-sm text-zinc-500 py-2">Aún no hay ejercicios: marca músculos y pulsa Generar.</div>'}</div>`}
  </div>`;
};

const loggingCards = () => {
  const cards = routineExercisesForDate(S.routineDate).map(exByName).filter(Boolean);
  if (!cards.length) return '';
  return `<div class="plan-title mt-3">Registrar series · ${cards.filter(c => isDone(c.id)).length}/${cards.length} terminados</div>${S.focus.length ? `<div class="text-xs text-zinc-500 mb-2">Enfoque semanal: ${S.focus.map(k => MUSCLES[k].n).join(' + ')}</div>` : ''}
  ${cards.map(exCard).join('')}
  <div class="text-xs text-zinc-600 mt-2">Semana ${mesoWeek()} de ${S.meso.weeks}: mantén los mismos ejercicios y sube carga o reps. <button class="underline" data-act="weeks">${S.meso.weeks} semanas (cambiar)</button> · <button class="underline" data-act="newmeso">reiniciar</button></div>`;
};
const trainingRoutinePanel = () => `<div class="routine-panel">
  
  ${routineDayPicker()}
  ${routineDayPanel()}
  ${loggingCards()}
  <div class="training-top mt-3">${calendarCard()}</div>
</div>`;

/** Entrevista obligatoria: la app no se abre hasta que el coach conoce cómo entrena el usuario. */
const onboardingView = () => {
  const p = S.trainingPreferences, ready = S.trainingConfigured;
  const steps = [['Objetivo', !!p.goal], ['Nivel', !!p.level], ['Días y división', ready], ['Lugar y lesiones', !!(p.place || p.injuries)]];
  return `<div class="pt-4">
  <div class="brand-title font-black neon"><img src="icon-180.png" alt="">AGRESSIVE LIFT</div>
  <div class="onb-hero card on mt-3"><div class="text-xs text-zinc-500 uppercase tracking">Paso obligatorio · 1 min</div>
    <div class="text-xl font-black mt-1">Conozcamos cómo entrenas</div>
    <div class="text-sm text-zinc-400 mt-1">Tu coach IA ajusta ejercicios, series y calendario a tu nivel, tu tiempo y tus molestias. La app se desbloquea al terminar.</div>
    <div class="onb-steps mt-3">${steps.map(([l, ok]) => `<span class="onb-step ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${l}</span>`).join('')}</div></div>
  ${coachPanel()}
  <button class="btn fill w-full mt-3" data-act="onboardfinish" ${ready ? '' : 'disabled'}>${ready ? 'Ver mi rutina →' : 'Responde al coach para continuar'}</button>
  </div>`;
};
const trainView = () => `<div class="section-subtabs" role="tablist" aria-label="Sección Entrenar">
  <button class="chip ${S.trainingSectionTab === 'coach' ? 'on' : ''}" role="tab" aria-selected="${S.trainingSectionTab === 'coach'}" data-act="traintab" data-tab="coach">💬 Entrenador IA</button>
  <button class="chip ${S.trainingSectionTab === 'routine' ? 'on' : ''}" role="tab" aria-selected="${S.trainingSectionTab === 'routine'}" data-act="traintab" data-tab="routine" >📋 Tu Rutina</button>
</div>
${S.trainingSectionTab === 'coach' ? coachPanel() : trainingRoutinePanel()}`;

const foodView = () => {
  const unlocked = N.ready(S.nutritionPreferences, !!S.target);
  const tabs = `<div class="section-subtabs" role="tablist" aria-label="Sección Nutrición">
    <button class="chip ${S.nutritionSectionTab === 'chat' ? 'on' : ''}" role="tab" aria-selected="${S.nutritionSectionTab === 'chat'}" data-act="nutritiontab" data-tab="chat">💬 Nutricionista IA</button>
    <button class="chip ${S.nutritionSectionTab === 'plan' ? 'on' : ''}" role="tab" aria-selected="${S.nutritionSectionTab === 'plan'}" data-act="nutritiontab" data-tab="plan" ${unlocked ? '' : 'disabled'}>🍽️ Tu Plan Nutricional</button>
  </div>`;
  if (S.nutritionSectionTab === 'chat') return `${tabs}${nutritionCoachCard()}`;
  const profileSetup = !S.target ? `<div class="card"><div class="font-bold mb-2">Perfil inicial</div>
  <div class="grid grid-cols-2 gap-2"><input id="pf-kg" type="number" inputmode="decimal" placeholder="Peso kg"><input id="pf-h" type="number" inputmode="numeric" placeholder="Altura cm">
  <input id="pf-a" type="number" inputmode="numeric" placeholder="Edad"><select id="pf-s"><option value="m">Hombre</option><option value="f">Mujer</option></select></div>
  <select id="pf-g" class="mt-2"><option value="cut">Definición</option><option value="maint">Mantenimiento</option><option value="bulk">Volumen</option></select>
  <button class="btn fill w-full mt-2" data-act="profile">Calcular objetivos</button></div>` : '';
  if (!S.target) return `${tabs}${profileSetup}<div class="card text-sm text-zinc-400">Configura tus macros para abrir el plan. Tus hábitos y preferencias ya se guardaron desde el chat.</div>`;
  const b = budget(today()), sc = E.scale(S.target, b), m = S.macros, pv = S.preview;
  return `
${tabs}
${profileSetup}
<div class="card"><div class="font-bold">Hoy: ${m.k} / ${b} kcal${S.adj[today()] ? ` <span class="text-xs neon">(${S.adj[today()] > 0 ? '+' : ''}${S.adj[today()]} ajuste)</span>` : ''}</div>
  <div class="text-sm text-zinc-400">Quedan: <b class="text-white">${sc.kcal - m.k} kcal</b> · P ${sc.p - m.p} · C ${sc.c - m.c} · G ${sc.f - m.f}</div>
  <div class="h-2 bg-zinc-900 mt-2 rounded"><div class="h-2 rounded" style="width:${Math.min(100, m.k / b * 100)}%;background:#ff0033"></div></div></div>
${planCards()}
<div class="card"><div class="font-bold mb-2">¿Qué comiste? (la IA calcula)</div>
  <input id="meal" placeholder="${(LOCAL_MODE && !AI_ON) ? 'Ej: arroz y pollo 650 kcal 45p 70c 15g' : 'Ej: corrientazo con pollo, arroz y plátano, jugo de mora'}">
  <button class="btn fill w-full mt-2" data-act="analyze" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Analizando…' : ((LOCAL_MODE && !AI_ON) ? 'Registrar comida' : 'Analizar con IA')}</button>
  ${S.msg ? `<p class="text-sm text-red-400 mt-2">${esc(S.msg)}</p>` : ''}
  ${pv ? `<div class="card on mt-2 text-sm">${pv.items.map(i => `<div>${esc(i.name)} · ${i.k} kcal · P${i.p} C${i.c} G${i.f}</div>`).join('')}
    <div class="text-zinc-400 mt-1">Estimación (confianza ${Math.round(pv.confidence * 100)} %). ${esc(pv.note)}</div>
    <div class="flex gap-2 mt-2"><button class="btn fill flex-1" data-act="confirmmeal">Registrar</button><button class="btn ghost flex-1" data-act="discard">Descartar</button></div></div>` : ''}
  ${S.meals.map(x => `<div class="text-xs text-zinc-500 mt-2">• ${esc(x.text)} — ${Math.round(x.k)} kcal</div>`).join('')}</div>
<div class="card"><div class="font-bold mb-2">Auditoría de peso</div>
  <div class="flex gap-2"><input id="wt" type="number" inputmode="decimal" placeholder="Peso hoy (kg)"><button class="btn" data-act="weight">Registrar</button></div>
  ${spark(S.weights.map(w => w.kg).slice(-12))}<div class="text-xs text-zinc-500 mt-2">Meta ${S.target.kcal} kcal · P ${S.target.p} C ${S.target.c} G ${S.target.f} (base semanal)</div></div>
<div class="card"><div class="font-bold mb-2">Estilo de la semana</div>
  <div class="grid grid-cols-2 gap-2">${Object.entries(STYLES).map(([k, [n]]) => `<button class="chip ${S.style === k ? 'on' : ''}" data-act="style" data-k="${k}">${n}</button>`).join('')}</div>
  <p class="text-sm text-zinc-400 mt-2">${STYLES[S.style][1]}</p></div>
<div class="card ${raveOn() ? 'on' : ''}"><div class="flex justify-between items-center"><div><div class="font-bold">Modo Rave</div>
  <div class="text-xs text-zinc-500">+500 kcal hoy, −150 los 3 días siguientes, PRs bloqueados 48 h.</div></div>
  <button class="btn ${raveOn() ? 'fill' : ''}" data-act="rave">${raveOn() ? 'ON' : 'OFF'}</button></div></div>`;
};

// Mapa anatómico esquemático (vista frontal/trasera simplificada). Cada región = un grupo muscular.
function adjust(k) {
  const mu = MUSCLES[k], base = Math.round(mu.mev + (mu.mrv - mu.mev) * 0.4), pri = S.focus.includes(k);
  // Prioridad: +50 % del margen hasta el MRV (nunca lo supera). No prioritario: −2 series (≥ MEV) para pagar la recuperación.
  const adj = pri ? Math.min(mu.mrv, base + Math.ceil((mu.mrv - base) * 0.5)) : Math.max(mu.mev, base - (S.focus.length ? 2 : 0));
  return { base, adj, pri, mrv: mu.mrv };
}
function toggleMuscle(k) {
  const i = S.focus.indexOf(k);
  if (i >= 0) S.focus.splice(i, 1);
  else { S.focus.push(k); if (S.focus.length > 2) S.focus.shift(); }
  store.set('focus', S.focus);
}
const muscleRegion = (key, paths, label) => `<g class="muscle-region ${S.focus.includes(key) ? 'on' : ''}" data-act="muscle" data-k="${key}" aria-label="Priorizar ${label}" role="button" tabindex="0">${[].concat(paths).map(d => `<path d="${d}"/><path transform="translate(320 0) scale(-1 1)" d="${d}"/>`).join('')}</g>`;
const mir = (d, c = 'body-detail') => `<path class="${c}" d="${d}"/><path class="${c}" transform="translate(320 0) scale(-1 1)" d="${d}"/>`;
const BODY = 'M160 62 C168 62 172 66 172 74 L174 84 C190 88 206 90 216 96 C230 100 240 114 242 134 L246 170 C250 196 252 214 252 232 L258 268 C262 286 266 300 268 316 L270 330 C262 336 254 334 252 326 L246 300 L238 262 L232 232 C230 210 226 188 220 170 L214 150 C204 176 198 200 198 232 C198 246 196 256 198 268 C206 290 210 320 208 350 C208 380 206 400 202 420 C204 446 206 480 204 510 L206 536 C206 544 196 548 186 548 L172 548 C168 540 170 520 170 500 C170 470 168 440 168 420 C164 380 162 340 162 308 L160 296 Z';
const bodySvg = () => {
  const f = S.muscleSide === 'front';
  return `<svg viewBox="0 0 320 560" class="muscle-svg" role="group" aria-label="Anatomía ${f ? 'frontal' : 'dorsal'}; selecciona un grupo muscular">
  <defs><linearGradient id="metal-body" x1="0" x2="1"><stop stop-color="#14171b"/><stop offset=".5" stop-color="#2b3138"/><stop offset="1" stop-color="#14171b"/></linearGradient></defs>
  <ellipse class="body-silhouette" cx="160" cy="36" rx="19" ry="25"/>${mir(BODY, 'body-silhouette')}
  ${f ? `
    ${muscleRegion('hombros', 'M206 108 L216 96 C230 99 241 112 243 134 C243 146 238 156 229 159 C222 158 216 153 212 146 Z', 'hombros')}
    ${muscleRegion('pecho', 'M160 100 C176 98 192 101 206 108 L212 146 C210 158 204 168 194 172 C180 176 168 174 160 168 Z', 'pecho')}
    ${muscleRegion('biceps', 'M218 158 C226 162 238 162 245 156 L249 174 C252 192 252 210 252 226 L232 226 C231 206 226 186 218 170 Z', 'bíceps')}
    ${muscleRegion('core', ['M160 172 C170 174 180 174 186 172 L190 204 C192 232 190 252 186 270 L160 278 Z', 'M190 176 C196 194 199 222 197 246 L195 268 L190 270 C192 250 194 226 192 204 Z'], 'core')}
    ${muscleRegion('cuads', 'M164 300 C180 292 200 294 207 306 C211 340 209 382 203 412 C194 424 178 424 170 412 C165 380 163 340 164 300 Z', 'cuádriceps')}
    ${muscleRegion('gemelos', 'M170 430 C180 426 196 428 202 436 C204 470 204 500 200 520 C192 528 178 526 172 516 C168 490 168 460 170 430 Z', 'gemelos')}
    ${mir('M162 98 C176 94 192 96 208 104 M160 196 L184 196 M160 220 L186 220 M160 244 L187 244 M190 316 C192 350 190 384 186 410 M170 414 C180 420 192 420 202 412')}
  ` : `
    ${muscleRegion('espalda', ['M178 140 L212 150 C212 184 204 226 190 246 L162 246 L162 176 Z', 'M160 68 C172 72 182 84 214 98 C204 118 184 138 160 172 Z', 'M162 248 L190 248 C192 258 192 266 190 274 L162 274 Z'], 'espalda')}
    ${muscleRegion('hombros', 'M214 98 C230 99 241 112 243 134 C243 146 238 156 229 159 C220 158 212 148 208 136 C206 120 208 108 214 98 Z', 'hombros')}
    ${muscleRegion('triceps', 'M218 158 C226 164 238 164 245 156 L249 174 C252 192 252 210 252 226 L232 226 C231 206 226 186 218 170 Z', 'tríceps')}
    ${muscleRegion('gluteos', 'M162 278 C176 272 196 274 204 288 C208 302 204 320 196 328 C182 334 168 330 162 322 Z', 'glúteos')}
    ${muscleRegion('isquios', 'M164 336 C178 338 194 336 204 332 C208 364 206 398 202 418 C192 428 178 428 170 418 C166 392 164 360 164 336 Z', 'isquios')}
    ${muscleRegion('gemelos', 'M170 432 C182 426 198 430 203 440 C206 470 204 500 200 520 C192 530 178 528 172 516 C168 490 168 460 170 432 Z', 'gemelos')}
    ${mir('M160 70 L160 276 M166 132 C180 128 194 134 198 146 M162 326 C176 332 192 330 204 324')}
  `}
  </svg>`;
};
const mapView = () => `
<div class="card map-panel">
  <div class="flex justify-between items-center mb-2">
    <div><div class="font-bold text-xl">Mapa muscular</div><div class="text-xs text-zinc-500">Frente y espalda · prioriza hasta 2 grupos</div></div>
    <div class="chip ${S.focus.length ? 'on' : ''}">${S.focus.length}/2</div>
  </div>
  <div class="map-view-tabs" role="tablist" aria-label="Vista anatómica">
    <button class="chip ${S.muscleSide === 'front' ? 'on' : ''}" role="tab" aria-selected="${S.muscleSide === 'front'}" data-act="muscleside" data-side="front">Frente</button>
    <button class="chip ${S.muscleSide === 'back' ? 'on' : ''}" role="tab" aria-selected="${S.muscleSide === 'back'}" data-act="muscleside" data-side="back">Espalda</button>
  </div>
  <div class="muscle-svg-wrap">
    ${bodySvg()}
  </div>
</div>
<div class="card">
  ${Object.keys(MUSCLES).map(k => { const a = adjust(k); return `
  <button class="flex justify-between w-full text-sm py-2 border-b border-zinc-900 ${a.pri ? 'neon' : ''}" data-act="muscle" data-k="${k}">
    <span>${MUSCLES[k].n}${a.pri ? ' ▲' : ''}</span>
    <span>${a.base} → <b>${a.adj}</b> series · hechas ${weekDone(k)} · MRV ${a.mrv}</span>
  </button>`; }).join('')}
  <p class="text-xs text-zinc-500 mt-2">Prioridad: +series hasta el MRV con RIR 1-2. El resto se mantiene cerca del MEV para sostener recuperación.</p>
</div>`;

const exerciseMotionType = name => {
  const t = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/elevacion lateral|elevaciones|lateral|gemelo|pantorrilla/.test(t)) return 'raise';
  if (/curl|biceps/.test(t)) return 'curl';
  if (/extension|triceps/.test(t)) return 'extension';
  if (/peso muerto|rumano|hip thrust|gluteo|puente/.test(t)) return 'hinge';
  if (/sentadilla|prensa|pierna|cuad|femoral/.test(t)) return 'squat';
  if (/remo|jalon|face pull|pullover|dominada|traccion/.test(t)) return 'pull';
  return 'push';
};

/* ---------- Imágenes reales del ejercicio: free-exercise-db (dominio público) ---------- */
const EXDB_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const EXIMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const EN = { // nombre en español → nombres probables en inglés del catálogo
  'press-inclinado-con-mancuernas': ['incline dumbbell press'], 'aperturas-en-polea': ['cable crossover', 'cable fly', 'low cable crossover'],
  'jalon-al-pecho': ['wide-grip lat pulldown', 'lat pulldown'], 'remo-con-apoyo-pectoral': ['seated cable rows', 'machine row', 'bent over barbell row'],
  'press-militar-en-maquina': ['machine shoulder (military) press', 'shoulder press'], 'elevaciones-laterales-en-polea': ['cable seated lateral raise', 'side lateral raise', 'lateral raise'],
  'curl-inclinado-con-mancuernas': ['incline dumbbell curl', 'alternate incline dumbbell curl'], 'curl-predicador': ['preacher curl', 'ez-bar preacher curl'],
  'extension-de-triceps-en-polea': ['triceps pushdown', 'triceps pushdown rope attachment'], 'press-frances-con-barra-z': ['ez-bar skullcrusher', 'lying triceps press'],
  'crunch-en-polea': ['cable crunch', 'kneeling cable crunch'], 'elevacion-de-piernas-colgado': ['hanging leg raise'],
  'prensa-de-piernas': ['leg press'], 'extension-de-cuadriceps': ['leg extensions', 'leg extension'], 'curl-femoral-sentado': ['seated leg curl'],
  'curl-femoral-tumbado': ['lying leg curls'], 'peso-muerto-rumano': ['romanian deadlift'], 'hip-thrust': ['barbell hip thrust', 'hip thrust'],
  'sentadilla-bulgara': ['bulgarian split squat', 'split squat with dumbbells', 'single leg squat'], 'gemelo-de-pie': ['standing calf raises', 'standing calf raise'],
  'gemelo-sentado': ['seated calf raise'], 'press-de-pecho-en-maquina': ['machine bench press', 'chest press machine'], 'pullover-en-polea': ['straight-arm pulldown', 'pullover'],
  'face-pull': ['face pull'], 'hack-squat': ['hack squat'], 'press-arnold': ['arnold dumbbell press'],
};
const TR = { press: 'press', inclinado: 'incline', declinado: 'decline', mancuernas: 'dumbbell', mancuerna: 'dumbbell', barra: 'barbell', polea: 'cable', maquina: 'machine', jalon: 'pulldown', remo: 'row', extension: 'extension', elevaciones: 'raise', laterales: 'lateral', sentadilla: 'squat', prensa: 'leg press', muerto: 'deadlift', gemelo: 'calf', femoral: 'leg curl', cuadriceps: 'leg extension', pecho: 'chest', hombro: 'shoulder', espalda: 'back', fondos: 'dips', dominadas: 'pull-up', plancha: 'plank', zancadas: 'lunge', martillo: 'hammer', predicador: 'preacher', aperturas: 'fly', cruces: 'crossover', encogimientos: 'shrug', frances: 'skullcrusher' };
const enGuess = name => slug(clean(name)).split('-').map(w => TR[w] ?? w).filter(w => !['de', 'en', 'con', 'la', 'el', 'sentado', 'pie'].includes(w)).join(' ');
const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function matchEx(db, name) {
  const qs = EN[slug(clean(name))] || [enGuess(name)];
  for (const q of qs) { const hit = db.find(r => norm(r[0]) === norm(q)); if (hit) return hit; }
  let best = null, bs = 0;
  for (const q of qs) { const qt = new Set(norm(q).split(' ')); for (const r of db) { const rt = new Set(norm(r[0]).split(' ')); let k = 0; qt.forEach(w => rt.has(w) && k++); const sc = k / Math.max(qt.size, rt.size); if (sc > bs) { bs = sc; best = r; } } }
  return bs >= 0.6 ? best : null;
}
async function loadExMedia(name) {
  let media = null;
  try {
    let db = store.get('exdb', null);
    if (!db) { // se descarga una vez (~100 KB tras compactar) y queda guardada en el teléfono
      const r = await fetch(EXDB_URL); if (!r.ok) throw new Error('db');
      db = (await r.json()).filter(x => x.images?.length).map(x => [x.name, x.images[0], x.images[1] || x.images[0]]); store.set('exdb', db);
    }
    const hit = matchEx(db, name);
    if (hit) { // precarga y decodifica ambos fotogramas ANTES de mostrarlos: la animación no parpadea ni se corta
      media = { n: hit[0], a: EXIMG + hit[1], b: EXIMG + hit[2] };
      await Promise.all([media.a, media.b].map(src => new Promise(res => { const im = new Image(); im.onload = () => (im.decode ? im.decode().catch(() => {}).then(res) : res()); im.onerror = res; im.src = src; })));
    }
  } catch {}
  if (S.modal?.type === 'exercisevideo' && S.modal.name === name) { S.modal = { ...S.modal, loading: false, media }; render(); }
}

/* ---------- Video del ejercicio DENTRO de la app (YouTube Data API + reproductor incrustado) ---------- */
async function loadYT(name) {
  const set = p => { if (S.modal?.type === 'exercisevideo' && S.modal.name === name) { S.modal = { ...S.modal, ytLoading: false, ...p }; render(); } };
  if (!S.ytkey) return;
  const id = slug(clean(name));
  let list = S.ytcache[id];
  if (!list) {
    try {
      const q = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', videoDuration: 'short', maxResults: '5', relevanceLanguage: 'es', safeSearch: 'strict', q: `cómo hacer ${clean(name)} técnica correcta ejercicio gimnasio`, key: S.ytkey });
      const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + q), j = await r.json();
      if (!r.ok) throw new Error(r.status === 403 ? 'La clave no tiene permiso o se acabó la cuota de hoy.' : 'La clave de YouTube no es válida.');
      list = (j.items || []).filter(v => v.id?.videoId).map(v => ({ id: v.id.videoId, title: v.snippet.title }));
      if (!list.length) throw new Error('No se encontró video para este ejercicio.');
      S.ytcache[id] = list; store.set('ytcache', S.ytcache);
    } catch (e) { return set({ ytErr: e.message === 'Failed to fetch' ? 'Sin conexión: no se pudo buscar el video.' : e.message }); }
  }
  set({ ytList: list, ytI: 0, yt: list[0], ytErr: '' });
}
const ytBlock = m => {
  if (m.yt) return `<div class="ytwrap mt-3"><iframe src="https://www.youtube-nocookie.com/embed/${m.yt.id}?playsinline=1&rel=0&modestbranding=1" title="${esc(m.yt.title)}" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
    <div class="flex justify-between items-center gap-2 mt-1"><span class="text-xs text-zinc-500 truncate">${esc(m.yt.title)}</span>${m.ytList.length > 1 ? '<button class="chip !px-3" data-act="ytnext">Otro video ↻</button>' : ''}</div>`;
  if (m.ytLoading) return '<div class="text-sm text-zinc-500 mt-3 text-center py-4">Buscando video…</div>';
  if (!S.ytkey) return ''; // sin clave: no se pide nada; el video se abre con los enlaces de YouTube
  return `<div class="text-xs text-zinc-500 mt-2"><span class="text-red-400">${esc(m.ytErr || 'No se encontró video dentro de la app.')}</span> <button class="underline" data-act="ytclear">Quitar clave</button></div>`;
};
/** Indicaciones de ejecución en español según el patrón de movimiento (fases completas del ejercicio). */
const CUES = {
  push: ['Escápulas atrás y abajo, pies firmes; agarre estable.', 'Baja controlado (2-3 s) hasta sentir el estiramiento del músculo.', 'Empuja explosivo sin bloquear los codos; exhala al subir.'],
  pull: ['Pecho alto, hombros lejos de las orejas.', 'Inicia el movimiento con la espalda, no con los brazos.', 'Pausa 1 s en la contracción y regresa lento hasta estirar por completo.'],
  squat: ['Pies al ancho de hombros, core firme, espalda neutra.', 'Baja controlado con rodillas siguiendo la línea de los pies.', 'Empuja el piso con todo el pie sin despegar los talones.'],
  hinge: ['Cadera atrás, espalda neutra, rodillas ligeramente flexionadas.', 'Baja hasta sentir el estiramiento del isquio/glúteo.', 'Extiende la cadera y aprieta el glúteo arriba, sin hiperextender la espalda.'],
  curl: ['Codos pegados al torso y muñecas neutras.', 'Sube sin balancear el cuerpo; aprieta el bíceps arriba.', 'Baja en 2-3 s hasta extender casi por completo.'],
  raise: ['Torso estable, leve flexión de codos.', 'Sube hasta la altura del hombro (o el pico del músculo) sin impulso.', 'Baja lento; la fase negativa también cuenta.'],
  extension: ['Codos fijos junto al cuerpo o sobre la cabeza.', 'Extiende por completo y aprieta el tríceps 1 s.', 'Regresa controlado sin que los codos se muevan.'],
};

/* ---------- XP, niveles y racha: se calculan SIEMPRE a partir de tus registros ---------- */
const RANKS = [[1, 'Novato'], [5, 'Agresivo'], [10, 'Bestia'], [15, 'Titán'], [25, 'Élite'], [40, 'Leyenda']];
const rankOf = L => RANKS.filter(r => L >= r[0]).pop()[1];
const levelOf = xp => Math.floor(Math.sqrt(xp / 50)) + 1;
const lvlStart = L => 50 * (L - 1) ** 2;
const allRows = () => Object.values(S.logs).flat();
const setsOn = d => Object.values(S.logs).reduce((n, l) => n + l.filter(x => x.d === d).length, 0);
const tonOn = d => Object.values(S.logs).reduce((n, l) => n + l.filter(x => x.d === d).reduce((a, x) => a + x.w * x.r, 0), 0);
const histBudget = d => (S.target ? S.target.kcal + (S.adj[d] || 0) : 0);
function xpBreakdown() {
  const rows = allRows(), hist = Object.entries(S.macroHist);
  return {
    sets: rows.reduce((n, x) => n + (x.t === 'w' ? 3 : 10 + (x.rir <= 1 ? 3 : 0) + (x.devil ? 5 : 0) + (x.pr ? 50 : 0)), 0),
    train: new Set(rows.map(x => x.d)).size * 40,
    meals: hist.reduce((n, [, h]) => n + 5 * (h.n || 0), 0),
    target: hist.filter(([d, h]) => d < today() && h.n > 0 && histBudget(d) && h.k >= 0.9 * histBudget(d) && h.k <= 1.1 * histBudget(d)).length * 25,
    weigh: S.weights.length * 15,
    done: Object.values(S.doneEx).reduce((n, o) => n + Object.keys(o).length, 0) * 10,
    rest: Object.keys(S.dayRest).filter(d => d <= today()).length * 10,
  };
}
const totalXp = () => Object.values(xpBreakdown()).reduce((a, b) => a + b, 0);
const streak = () => {
  const act = d => setsOn(d) > 0 || S.dayRest[d] || S.macroHist[d]?.n > 0;
  let i = act(today()) ? 0 : -1, n = 0; while (act(dAdd(i))) { n++; i--; } return n;
};
function syncHist() { // guarda el resumen de comida de cada día (para el control semanal)
  const h = { k: S.macros.k, p: S.macros.p, c: S.macros.c, f: S.macros.f, n: S.meals.length }, o = S.macroHist[S.macros.d];
  if (!o || JSON.stringify(o) !== JSON.stringify(h)) { S.macroHist[S.macros.d] = h; store.set('macroHist', S.macroHist); }
}
const toast = m => { S.toast = m; clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = ''; render(); }, 2600); };
const xpToast = b => { const a = totalXp(); if (a <= b) return; const lb = levelOf(b), la = levelOf(a); toast(la > lb ? `🔥 ¡NIVEL ${la}! ${rankOf(la)} · +${a - b} XP` : `+${a - b} XP`); };
const xpLine = () => { const x = totalXp(), L = levelOf(x), a = lvlStart(L), nx = lvlStart(L + 1), st = streak();
  return `<div class="xpline" data-act="view" data-v="control"><b class="neon">Nv ${L}</b><span>${rankOf(L)}</span><div class="xpbar"><i style="width:${Math.round((x - a) / (nx - a) * 100)}%"></i></div><small>${x - a}/${nx - a} XP</small>${st ? `<span>🔥${st}</span>` : ''}</div>`; };

const bars = (v, l) => { const mx = Math.max(...v, 1); return `<div class="bars">${v.map((n, i) => `<div class="bar"><b>${n || ''}</b><i style="height:${Math.round(n / mx * 70)}%"></i><span>${l[i]}</span></div>`).join('')}</div>`; };
const controlView = () => {
  const x = totalXp(), L = levelOf(x), a = lvlStart(L), nx = lvlStart(L + 1), br = xpBreakdown(), st = streak();
  const days = Array.from({ length: 7 }, (_, i) => dAdd(i - 6)), lab = days.map(d => 'DLMXJVS'[new Date(d + 'T12:00:00').getDay()]);
  const sets7 = days.map(setsOn), kcal7 = days.map(d => Math.round(S.macroHist[d]?.k || 0));
  const rows7 = allRows().filter(r => days.includes(r.d)), prs = rows7.filter(r => r.pr).length;
  const ton = Math.round(days.reduce((p, d) => p + tonOn(d), 0)), rir = rows7.length ? (rows7.reduce((p, r) => p + r.rir, 0) / rows7.length).toFixed(1) : '–';
  const b = S.target ? histBudget(today()) : 0, m = S.macros;
  const state = S.dayRest[today()] ? '😴 Descanso' : setsOn(today()) ? `🏋️ ${setsOn(today())} series hechas` : (S.routineEdits[today()] || []).length ? '📋 Entreno planeado' : 'Sin definir';
  const ids = Object.keys(S.logs).filter(id => S.logs[id].length).sort((p, q) => S.logs[q].at(-1).d.localeCompare(S.logs[p].at(-1).d)).slice(0, 12);
  return `
<div class="card on"><div class="flex justify-between items-center"><div><div class="text-xs text-zinc-500">Nivel ${L}</div><div class="text-2xl font-black neon">${rankOf(L)}</div></div>
  <div class="text-center"><div class="text-2xl font-black">${st} 🔥</div><div class="text-xs text-zinc-500">días de racha</div></div></div>
  <div class="xpbar big mt-2"><i style="width:${Math.round((x - a) / (nx - a) * 100)}%"></i></div>
  <div class="text-xs text-zinc-500 mt-1">${x - a} / ${nx - a} XP para el nivel ${L + 1} · total ${x} XP</div>
  <button class="btn fill w-full mt-3" data-act="startworkout">🔥 INICIAR ENTRENAMIENTO</button>
  <div class="text-xs text-zinc-400 mt-2">XP por: series ${br.sets} · días entrenados ${br.train} · comida ${br.meals + br.target} · ejercicios terminados ${br.done} · peso ${br.weigh} · descansos ${br.rest}</div>
  <details class="mt-2 text-sm text-zinc-400"><summary>Cómo gano XP</summary>Serie +10 (+3 si RIR 0-1, +5 drop set; calentamiento +3) · ejercicio terminado +10 · PR +50 · día entrenado +40 · comida registrada +5 · día dentro de tu meta +25 · pesaje +15 · descanso marcado +10. Rangos: Novato, Agresivo (nv 5), Bestia (10), Titán (15), Élite (25), Leyenda (40).</details></div>
<div class="card"><div class="font-bold">Hoy · ${state}</div>
  ${S.target ? `<div class="text-sm text-zinc-400 mt-1">${m.k} / ${b} kcal · P ${m.p} · C ${m.c} · G ${m.f}</div><div class="h-2 bg-zinc-900 mt-2 rounded"><div class="h-2 rounded" style="width:${Math.min(100, b ? m.k / b * 100 : 0)}%;background:#ff2b57"></div></div>` : '<div class="text-sm text-zinc-500 mt-1">Configura tu perfil en Nutrición para ver tus calorías.</div>'}</div>
<div class="card"><div class="font-bold">Esta semana · series por día</div>${bars(sets7, lab)}
  <div class="statgrid"><div class="stat"><b>${sets7.reduce((p, c) => p + c, 0)}</b><span>series</span></div><div class="stat"><b>${ton}</b><span>kg movidos</span></div><div class="stat"><b>${prs}</b><span>PRs</span></div>
  <div class="stat"><b>${sets7.filter(Boolean).length}/7</b><span>días entrenados</span></div><div class="stat"><b>${rir}</b><span>RIR medio</span></div><div class="stat"><b>${days.filter(d => S.dayRest[d]).length}</b><span>descansos</span></div></div></div>
<div class="card"><div class="font-bold mb-1">Volumen semanal vs MRV</div>${Object.keys(MUSCLES).map(k => { const n = weekDone(k), mv = MUSCLES[k].mrv; return `<div class="ctl-row"><span style="width:92px">${MUSCLES[k].n}</span><div class="mrv flex-1"><i style="width:${Math.min(100, n / mv * 100)}%;${n >= mv ? 'background:#fff' : ''}"></i></div><span class="text-xs text-zinc-400" style="width:52px;text-align:right">${n}/${mv}</span></div>`; }).join('')}</div>
<div class="card"><div class="font-bold mb-1">Control de ejercicios</div>${ids.map(id => { const l = S.logs[id], z = l.at(-1), h = e1h(id), best = Math.round(Math.max(...l.map(r => r.w * (1 + r.r / 30)))), tr = h.length > 1 ? (h.at(-1) >= h.at(-2) ? '▲' : '▼') : '';
    return `<div class="ctl-row"><div class="min-w-0"><div class="truncate">${esc(exById(id)?.n || id)}</div><div class="text-xs text-zinc-500">${z.d.slice(5)} · ${z.w} kg × ${z.r} · mejor 1RM ${best} kg ${tr}</div></div><button class="icon-btn" data-act="dellast" data-id="${id}" aria-label="Borrar última serie">🗑</button></div>`; }).join('') || '<div class="text-sm text-zinc-500">Aún no registras series.</div>'}</div>
<div class="card"><div class="font-bold">Control de comida · kcal por día</div>${bars(kcal7, lab)}
  ${S.meals.map((x, i) => `<div class="ctl-row"><div class="min-w-0"><div class="truncate">${esc(x.text)}</div><div class="text-xs text-zinc-500">${Math.round(x.k)} kcal · P${Math.round(x.p)} C${Math.round(x.c)} G${Math.round(x.f)}</div></div><button class="icon-btn" data-act="delmeal" data-i="${i}" aria-label="Borrar comida">🗑</button></div>`).join('') || '<div class="text-sm text-zinc-500 mt-2">Hoy no has registrado comidas.</div>'}
  ${S.weights.length > 1 ? `<div class="font-bold mt-3">Peso corporal · ${S.weights.at(-1).kg} kg</div>${spark(S.weights.map(w => w.kg).slice(-12))}` : ''}</div>`;
};

const sheet = () => {
  const m = S.modal; if (!m) return '';
  if (m.type === 'setlog') {
    const ex = exById(m.id), warm = m.t === 'w', chips = (act, items, cur) => items.map(([v, l]) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('');
    return `<div class="sheet"><div><div class="flex justify-between items-center gap-2"><div class="font-bold">${esc(S.swaps[m.id] || ex.n)}</div><div class="neon text-lg">${m.w} kg × ${m.r}</div></div>
    ${m.devil ? '<div class="text-xs neon mt-1">⬇ Drop set: esta es la serie principal, al fallo</div>' : ''}
    <div class="text-sm text-zinc-400 mt-3 mb-2">¿Qué serie es?</div>
    <div class="grid grid-cols-5 gap-2">${chips('setpick', [['w', 'Calent.'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], m.t)}</div>
    ${warm ? '' : `<div class="text-sm text-zinc-400 mt-3 mb-2">¿Cuántas reps te quedaban? (RIR)</div>
    <div class="grid grid-cols-5 gap-2">${chips('rirpick', [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']], m.rir)}</div>`}
    ${!warm && GRIP.test(ex.n) ? `<div class="text-sm text-zinc-400 mt-3 mb-2">¿Qué te limitó primero?</div>
    <div class="grid grid-cols-3 gap-2">${chips('limpick', [['Músculo objetivo', 'Músculo'], ['Antebrazo', 'Agarre'], ['Aire', 'Respiración']], m.fail)}</div>` : ''}
    <button class="btn fill w-full mt-4" data-act="setsave">Guardar serie</button>
    <button class="btn ghost w-full mt-2" data-act="closemodal">Cancelar</button></div></div>`;
  }
  if (m.type === 'swap') return `<div class="sheet"><div><div class="font-bold mb-1">Smart Swap</div><div class="text-xs text-zinc-500 mb-3">Misma tensión, otra máquina. Solo para hoy.</div>
    ${m.alts.map(a => `<button class="btn w-full mb-2" data-act="doswap" data-n="${esc(a)}">${esc(a)}</button>`).join('')}
    <button class="btn ghost w-full" data-act="doswap" data-n="">Volver al original</button></div></div>`;
  if (m.type === 'routineedit') return `<div class="sheet"><div class="exercise-modal">
    <div class="flex justify-between items-center gap-2"><div class="font-bold">${m.index < 0 ? 'Añadir ejercicio' : 'Editar ejercicio'}</div><button class="icon-btn" data-act="closemodal" aria-label="Cerrar">×</button></div>
    <label class="text-sm text-zinc-400 block mt-3" for="routine-exercise">Nombre y objetivo/repeticiones</label>
    <input id="routine-exercise" class="mt-2" maxlength="120" placeholder="Ej: Press inclinado 4×8" value="${esc(m.value)}">
    <div class="flex gap-2 mt-3"><button class="btn fill flex-1" data-act="saveRoutineExercise">Guardar</button><button class="btn ghost flex-1" data-act="closemodal">Cancelar</button></div>
  </div></div>`;
  if (m.type === 'exercisevideo') {
    const cues = CUES[m.motion] || CUES.push, enQ = m.media?.n || enGuess(m.name);
    const ytEs = videoUrl(m.name), ytEn = 'https://www.youtube.com/results?search_query=' + encodeURIComponent('how to ' + enQ + ' proper form');
    const stage = m.media
      ? `<div class="exmedia"><img class="fa" src="${m.media.a}" alt="${esc(m.name)} posición inicial" decoding="async"><img class="fb" src="${m.media.b}" alt="${esc(m.name)} posición final" decoding="async"><span class="exbadge">▶ Ejercicio completo · en bucle</span></div>
         <div class="exframes"><figure><img src="${m.media.a}" alt="Inicio"><figcaption>1 · Inicio</figcaption></figure><div class="exarrow">→</div><figure><img src="${m.media.b}" alt="Final"><figcaption>2 · Final</figcaption></figure></div>`
      : m.loading ? '<div class="exmedia skeleton"><span class="exbadge">Cargando ejercicio…</span></div>'
      : '<div class="exmedia empty"><div>🎬<br>No hay animación para este ejercicio.<br><b>Míralo completo en YouTube ↓</b></div></div>';
    return `<div class="sheet"><div class="exercise-modal">
    <div class="flex justify-between items-start gap-2"><div><div class="text-xs text-zinc-500 uppercase tracking">Cómo se hace</div><div class="font-bold text-lg">${esc(m.name)}</div></div><button class="icon-btn" data-act="closemodal" aria-label="Cerrar">×</button></div>
    ${ytBlock(m)}
    <div class="motion-stage mt-3 ${m.yt ? 'hidden' : ''}">${stage}${m.media ? `<div class="text-xs text-zinc-500 mt-1">${esc(m.media.n)} · free-exercise-db</div>` : ''}</div>
    <ol class="excues">${cues.map((c, i) => `<li><b class="neon">${i + 1}</b><span>${esc(c)}</span></li>`).join('')}</ol>
    <div class="grid grid-cols-2 gap-2 mt-3"><a class="btn fill" href="${ytEs}" target="_blank" rel="noopener">▶ Video en YouTube</a><a class="btn" href="${ytEn}" target="_blank" rel="noopener">▶ En inglés ↗</a></div>
    <button class="btn ghost w-full mt-2" data-act="closemodal">Cerrar</button>
  </div></div>`;
  }
  return '';
};


function render() {
  if (S.screen === 'app') syncHist();
  const html = S.screen === 'boot' ? '<div class="pt-48 text-center neon text-xl">Verificando licencia…</div>'
    : S.screen === 'auth' ? authView() : S.screen === 'locked' ? lockedView()
    : !S.onboarded ? onboardingView() + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '')
    : header() + (S.view === 'train' ? trainView() : S.view === 'food' ? foodView() : S.view === 'control' ? controlView() : mapView()) + sheet() + restBar() + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '');
  const t = document.createElement('div'); t.innerHTML = html; morph($('#app'), t); wake();
}

/* ---------- Acciones (delegación) ---------- */
const val = id => parseFloat($('#' + id)?.value);
const ACT = {
  async login() { await authAction(signIn); },
  async signup() { await authAction(signUp, true); },
  async logout() {
    if (LOCAL_MODE) {
      S.user = { id: 'local', email: 'local' };
      S.screen = 'app';
      S.msg = '';
      render();
      return;
    }
    await signOut();
  },
  coachstart() {
    S.coachOpen = true;
    if (!S.coachChat.length) S.coachChat = defaultCoachChat.slice();
    S.view = 'train';
    store.set('coachChat', S.coachChat);
    render();
  },
  recheck() { return gate({ user: S.user }); },
  switchuser() { sessionStorage.removeItem('al:profile'); sessionStorage.removeItem('alReload'); location.reload(); },
  startworkout() { // INICIAR desde la tarjeta de XP: abre la rutina de hoy
    S.view = 'train'; S.coachOpen = true;
    if (!S.trainingConfigured) { S.trainingSectionTab = 'coach'; return toast('Primero cuéntale al entrenador cómo entrenas'); }
    S.trainingSectionTab = 'routine'; S.routineDate = today(); toast('🔥 ¡A entrenar!');
  },
  onboardfinish() {
    if (!S.trainingConfigured) return;
    S.onboarded = true; store.set('onboarded', true);
    S.view = 'train'; S.trainingSectionTab = 'routine'; S.routineDate = today();
    toast('✅ Rutina lista. ¡A entrenar!');
  },
  view(d) {
    S.view = d.v;
    if (d.v === 'train') { S.coachOpen = true; S.trainingSectionTab = 'routine'; }
    if (d.v === 'food') S.nutritionSectionTab = 'chat';
  },
  traintab(d) {
    if (d.tab === 'routine' && !S.trainingConfigured) return;
    S.trainingSectionTab = d.tab === 'routine' ? 'routine' : 'coach';
  },
  nutritiontab(d) {
    if (d.tab === 'plan' && !N.ready(S.nutritionPreferences, !!S.target)) return;
    S.nutritionSectionTab = d.tab === 'plan' ? 'plan' : 'chat';
  },
  muscleside(d) { S.muscleSide = d.side === 'back' ? 'back' : 'front'; },
  routinedate(d) { S.routineDate = d.date; },
  routineweek(d) {
    const date = shiftIsoDate(S.routineDate, Number(d.d) || 0);
    ACT.routinedate({ date });
  },
  addroutineexercise() { S.modal = { type: 'routineedit', date: S.routineDate, index: -1, value: '' }; },
  editroutineexercise(d) {
    const index = Number(d.index);
    S.modal = { type: 'routineedit', date: S.routineDate, index, value: routineExercisesForDate(S.routineDate)[index] || '' };
  },
  removeroutineexercise(d) {
    const date = S.routineDate, exercises = [...routineExercisesForDate(date)];
    exercises.splice(Number(d.index), 1);
    S.routineEdits[date] = exercises;
    store.set('routineEdits', S.routineEdits);
  },
  saveRoutineExercise() {
    const name = ($('#routine-exercise')?.value || '').trim();
    if (!name) return;
    const { date, index } = S.modal, exercises = [...routineExercisesForDate(date)];
    if (index < 0) exercises.push(name); else exercises[index] = name;
    S.routineEdits[date] = exercises;
    store.set('routineEdits', S.routineEdits);
    S.modal = null;
  },
  exercisevideo(d) {
    const name = d.exercise || routineExercisesForDate(S.routineDate)[Number(d.index)] || 'Ejercicio';
    S.modal = { type: 'exercisevideo', name, motion: exerciseMotionType(name), loading: true, media: null, ytLoading: !!S.ytkey };
    loadExMedia(name); loadYT(name);
  },
  closemodal() { S.modal = null; },
  dellast(d) { const l = S.logs[d.id]; if (l?.length && confirm('¿Borrar la última serie de este ejercicio?')) { l.pop(); store.set('logs', S.logs); } },
  delmeal(d) { const i = +d.i, x = S.meals[i]; if (!x || !confirm('¿Borrar esta comida?')) return; for (const k of ['k', 'p', 'c', 'f']) S.macros[k] = Math.max(0, S.macros[k] - (x[k] || 0)); S.meals.splice(i, 1); persist('macros', 'meals'); },
  ytsave() { const k = ($('#ytkey')?.value || '').trim(); if (k.length < 20) return alert('Pega la clave completa'); S.ytkey = k; store.set('ytkey', k); if (S.modal?.type === 'exercisevideo') { S.modal = { ...S.modal, ytLoading: true, ytErr: '' }; loadYT(S.modal.name); } },
  ytclear() { S.ytkey = ''; S.ytcache = {}; store.set('ytkey', ''); store.set('ytcache', {}); if (S.modal) S.modal = { ...S.modal, yt: null, ytErr: '', ytLoading: false }; },
  ytnext() { const m = S.modal, i = (m.ytI + 1) % m.ytList.length; S.modal = { ...m, ytI: i, yt: m.ytList[i] }; },
  daymuscle(d) { const a = S.dayMuscles[S.routineDate] || (S.dayMuscles[S.routineDate] = []), i = a.indexOf(d.k); i >= 0 ? a.splice(i, 1) : a.push(d.k); store.set('dayMuscles', S.dayMuscles); },
  daytype(d) { if (d.t === 'rest') S.dayRest[S.routineDate] = true; else delete S.dayRest[S.routineDate]; store.set('dayRest', S.dayRest); },
  daypreset(d) { S.dayMuscles[S.routineDate] = [...PRESETS[d.p]]; store.set('dayMuscles', S.dayMuscles); },
  daygenerate() {
    const ks = S.dayMuscles[S.routineDate] || []; if (!ks.length) return alert('Elige al menos un músculo');
    delete S.dayRest[S.routineDate]; store.set('dayRest', S.dayRest);
    S.routineEdits[S.routineDate] = strategicOrder(ks).flatMap(k => CATALOG[k]); delete S.doneEx[S.routineDate]; store.set('doneEx', S.doneEx);
    S.open = exByName(S.routineEdits[S.routineDate][0])?.id || null; store.set('routineEdits', S.routineEdits);
  },
  tab: d => { S.tab = d.t; S.open = null; }, toggle: d => S.open = S.open === d.id ? null : d.id,
  devil: d => { S.devil[d.id] = !S.devil[d.id]; if (!S.devil[d.id]) delete S.drop[d.id]; },
  logset(d) {
    const w = val('w-' + d.id), r = val('r-' + d.id);
    if (!(w >= 0) || !(r > 0)) return alert('Ingresa peso y repeticiones');
    const hist = (S.logs[d.id] || []).filter(x => x.t !== 'w');
    if (raveOn() && E.isPR(hist, w, r)) return alert('🔒 PR bloqueado por Modo Rave (48 h). Baja la carga o las reps.');
    const k = MAP[exById(d.id).m];
    if (weekDone(k) >= MUSCLES[k].mrv && !confirm(`Ya alcanzaste el MRV de ${MUSCLES[k].n} esta semana (${MUSCLES[k].mrv} series). ¿Registrar igual?`)) return;
    const n = todaySets(d.id).filter(x => x.t !== 'w' && x.t !== 'drop').length;
    S.modal = { type: 'setlog', id: d.id, w, r, t: Math.min(4, n + 1), rir: 2, fail: 'Músculo objetivo', devil: !!S.devil[d.id] };
  },
  setpick(d) { S.modal = { ...S.modal, t: d.v === 'w' ? 'w' : +d.v }; },
  rirpick(d) { S.modal = { ...S.modal, rir: +d.v }; },
  limpick(d) { S.modal = { ...S.modal, fail: d.v }; },
  setsave() {
    const m = S.modal, xb = totalXp(), warm = m.t === 'w', ex = exById(m.id);
    const isPR = !warm && E.isPR((S.logs[m.id] || []).filter(x => x.t !== 'w'), m.w, m.r);
    const fail = !warm && GRIP.test(ex.n) ? m.fail : 'Músculo objetivo';
    const row = { d: today(), w: m.w, r: m.r, rir: warm ? 4 : m.rir, fail, devil: !!(m.devil && !warm), t: m.t, pr: isPR && !raveOn() };
    (S.logs[m.id] ||= []).push(row); store.set('logs', S.logs);
    saveSet(S.user.id, { exercise: m.id, weight: m.w, reps: m.r, rir: row.rir, failure: fail, devil: row.devil });
    let rp;
    if (m.devil && !warm) { // drop set: −20 % en cascada, sin descanso
      const ws = []; let x = m.w; for (let i = 0; i < 3; i++) { x = E.r25(x * 0.8); ws.push(x); }
      S.drop[m.id] = { step: 0, ws }; rp = { sec: 10, why: `Drop set: baja a ${ws[0]} kg YA (−20 %), sin descansar` };
    } else rp = restPlan({ id: m.id, t: m.t, r: m.r, rir: row.rir });
    S.rest = Date.now() + rp.sec * 1000; S.restWhy = rp.why; S.fresh = m.id; S.modal = null; xpToast(xb);
    if (isPR && !raveOn()) setTimeout(() => toast('🔥 ¡NUEVO PR! +50 XP'), 120);
  },
  dropsave(d) {
    const id = d.id, p = S.drop[id]; if (!p) return;
    const r = val(`dr-${id}-${p.step}`); if (!(r > 0)) return alert('Ingresa las repeticiones');
    const xb = totalXp(), w = p.ws[p.step];
    (S.logs[id] ||= []).push({ d: today(), w, r, rir: 0, fail: 'Músculo objetivo', devil: true, t: 'drop' }); store.set('logs', S.logs);
    saveSet(S.user.id, { exercise: id, weight: w, reps: r, rir: 0, failure: 'Músculo objetivo', devil: true });
    p.step++; S.fresh = id;
    const rp = p.step >= 3 ? restPlan({ id, t: 3, r, rir: 0, drop: 'end' }) : { sec: 10, why: `Drop set: baja a ${p.ws[p.step]} kg YA, sin descansar` };
    if (p.step >= 3) delete S.drop[id];
    S.rest = Date.now() + rp.sec * 1000; S.restWhy = rp.why; xpToast(xb);
  },
  dropskip(d) { delete S.drop[d.id]; },
  doneex(d) { // marca terminado y pasa al siguiente ejercicio del orden de la rutina
    const iso = S.routineDate, xb = totalXp(); (S.doneEx[iso] ||= {})[d.id] = true; store.set('doneEx', S.doneEx); delete S.drop[d.id];
    const cards = routineExercisesForDate(iso).map(exByName).filter(Boolean), nxt = cards.find(c => !S.doneEx[iso][c.id]);
    S.open = nxt ? nxt.id : null;
    if (nxt) { const p = transitionPlan(exById(d.id), nxt); S.rest = Date.now() + p.sec * 1000; S.restWhy = p.why; xpToast(xb); }
    else { S.rest = 0; toast('🏁 ¡Sesión completada! Buen trabajo'); }
  },
  undone(d) { delete (S.doneEx[S.routineDate] || {})[d.id]; store.set('doneEx', S.doneEx); S.open = d.id; },
  swap(d) { S.modal = { type: 'swap', id: d.id, alts: [...exById(d.id).alt] }; },
  doswap(d) { d.n ? S.swaps[S.modal.id] = d.n : delete S.swaps[S.modal.id]; S.modal = null; },
  coachtoggle() { S.coachOpen = !S.coachOpen; store.set('coachOpen', S.coachOpen); },
  aitab(d) { S.aiTab = d.tab || 'coach'; store.set('aiTab', S.aiTab); },
  coachsend() {
    const input = $('#coach-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    if (input) input.value = '';
    return sendCoachMessage(text);
  },
  coachprompt(d) {
    const text = d.msg || '';
    if (!text) return;
    return sendCoachMessage(text);
  },
  async nutritionsend() {
    const input = $('#nutrition-input');
    const text = (input?.value || '').trim();
    if (!text || S.nutritionBusy) return;
    S.nutritionChat.push({ role: 'user', text });
    const parsed = N.parse(text, S.nutritionPreferences);
    const preferences = { ...parsed.prefs, lastUpdate: text, updatedAt: new Date().toISOString() };
    if (parsed.prefs.style) S.style = parsed.prefs.style;
    S.nutritionPreferences = preferences;
    store.set('nutritionPreferences', preferences);
    store.set('style', S.style);
    store.set('nutritionChat', S.nutritionChat);
    S.nutritionBusy = true;
    if (input) input.value = '';
    render();
    let reply = nutritionReply(text, parsed.changed);
    if (AI_ON || CONFIG_OK) {
      const remaining = E.scale(nutritionTarget(), budget(today()));
      try {
        const result = await ai('coach', { task: 'nutrition',
          systemPrompt: 'Eres el coach de nutrición de AGRESSIVE LIFT. Pregunta por hábitos, preferencias, restricciones, corrientazos y estilo de cocina. Adapta cada recomendación al mensaje actual, preferencias guardadas y macros restantes; evita respuestas genéricas repetidas. No inventes macros exactos sin cantidades.',
          question: text, missing: N.missing(S.nutritionPreferences, !!S.target), target: nutritionTarget(), preferences: S.nutritionPreferences, conversation: S.nutritionChat.slice(-8),
          remaining: { kcal: remaining.kcal - S.macros.k, protein: remaining.p - S.macros.p,
            carbs: remaining.c - S.macros.c, fat: remaining.f - S.macros.f },
          style: STYLES[S.style][0], meals: S.meals.slice(-3).map(meal => meal.text) });
        reply = result.note || reply;
      } catch {}
    }
    S.nutritionChat.push({ role: 'assistant', text: reply });
    S.nutritionChat = S.nutritionChat.slice(-40);
    S.nutritionBusy = false;
    store.set('nutritionChat', S.nutritionChat);
  },
  nopt(d) {
    const q = N.QUESTIONS.find(x => x.k === d.k); if (!q) return;
    const p = { ...S.nutritionPreferences }, v = d.v;
    if (q.multi) { const a = new Set(p[d.k] || []); if (a.has(v)) a.delete(v); else { if (v === 'ninguna' || v === 'ninguno') a.clear(); else { a.delete('ninguna'); a.delete('ninguno'); } a.add(v); } p[d.k] = [...a]; }
    else p[d.k] = d.k === 'meals' ? +v : v;
    if (d.k === 'style') { S.style = v; store.set('style', v); }
    S.nutritionPreferences = p; store.set('nutritionPreferences', p);
  },
  nutriplan() { if (N.ready(S.nutritionPreferences, !!S.target)) { S.nutritionSectionTab = 'plan'; toast('✅ Plan nutricional listo'); } },
  menuday(d) { S.menuDay = +d.i || 0; },
  menuregen() { S.menuSeed++; store.set('menuSeed', S.menuSeed); },
  mealadd(d) {
    const m = currentMenu().days[+d.d]?.[+d.i]; if (!m) return;
    const xb = totalXp(); addMeal([{ k: m.k, p: m.p, c: m.c, f: m.f }], `${m.slot}: ${m.name}`); syncHist(); xpToast(xb); toast('🍽️ Comida registrada');
  },
  nutritionprompt(d) {
    const input = $('#nutrition-input');
    if (input) input.value = d.msg || '';
    return ACT.nutritionsend();
  },
  step(d) { const i = $('#' + d.f); i.value = Math.max(0, +((parseFloat(i.value) || 0) + +d.s).toFixed(1)); },
  rest30() { S.rest += 3e4; }, restoff() { S.rest = 0; S.restWhy = ''; },
  style(d) { S.style = d.k; store.set('style', d.k); S.nutritionPreferences = { ...S.nutritionPreferences, style: d.k }; store.set('nutritionPreferences', S.nutritionPreferences); },
  profile() {
    const kg = val('pf-kg'), h = val('pf-h'), age = val('pf-a');
    if (!(kg > 30 && h > 120 && age > 13)) return alert('Completa peso, altura y edad');
    S.profile = { h, age, sex: $('#pf-s').value, goal: $('#pf-g').value };
    S.target = E.initial({ kg, ...S.profile }); S.weights = [{ d: today(), kg }];
    persist('profile', 'target', 'weights'); saveBody(S.user.id, { weight: kg });
  },
  async weight() { // auditoría: recalcula objetivos de la semana siguiente con la tendencia real
    const xb = totalXp(), kg = val('wt'); if (!(kg > 30 && kg < 300)) return alert('Peso inválido');
    S.weights = S.weights.filter(w => w.d !== today()).concat({ d: today(), kg }); saveBody(S.user.id, { weight: kg });
    const a = E.audit({ weights: S.weights, target: S.target, goal: S.profile.goal, raveDates: S.raveDates });
    S.target = a.target; S.note = a.note; persist('weights', 'target'); xpToast(xb);
    coach('audit', { goal: S.profile.goal, target: S.target, resultado: a.note, pesos: S.weights.slice(-8) });
  },
  async analyze() {
    const text = $('#meal').value.trim(); if (!text) return;
    S.busy = true; S.msg = ''; S.preview = null; render();
    try {
      const sc = E.scale(S.target, budget(today())), m = S.macros;
      const r = (LOCAL_MODE && !AI_ON) ? E.parseMeal(text) : await ai('meal', { text, restante: { k: sc.kcal - m.k, p: sc.p - m.p, c: sc.c - m.c, f: sc.f - m.f } });
      if (!r) throw new Error('Escribe los macros, ej: arroz y pollo 650 kcal 45p 70c 15g');
      S.preview = { ...r, text }; $('#meal').value = '';
    } catch (e) { S.msg = (LOCAL_MODE && !AI_ON) ? e.message : 'IA no disponible: ' + e.message + '. Inténtalo de nuevo.'; }
    S.busy = false;
  },
  confirmmeal() { const xb = totalXp(); addMeal(S.preview.items, S.preview.text); S.preview = null; syncHist(); xpToast(xb); },
  discard() { S.preview = null; },
  rave() {
    if (raveOn()) return alert('El bloqueo de PRs (48 h) se mantiene para proteger tu sistema nervioso.');
    S.rave = { start: Date.now(), prUntil: Date.now() + 1728e5 }; S.raveDates.push(today());
    E.raveComp().forEach(c => addAdj(c.off, c.k)); persist('rave', 'raveDates', 'adj');
    S.note = 'Modo Rave: +500 kcal hoy, −150 kcal los 3 días siguientes. PRs bloqueados 48 h.';
    coach('rave', { target: S.target, ajustes: S.adj });
  },
  muscle(d) {
    toggleMuscle(d.k);
  },
  weeks() { S.meso.weeks = S.meso.weeks === 8 ? 6 : 8; store.set('meso', S.meso); },
  newmeso() { if (confirm('¿Reiniciar mesociclo?')) { S.meso.start = Date.now(); store.set('meso', S.meso); } },
};
function addMeal(items, text) {
  const t = { k: 0, p: 0, c: 0, f: 0 };
  items.forEach(i => { for (const k in t) t[k] += Math.max(0, +i[k] || 0); });
  for (const k in t) S.macros[k] += Math.round(t[k]);
  S.meals.push({ text, ...t });
  // Si te pasas del presupuesto, el exceso se reparte (≤200 kcal/día, 3 días) para mantener déficit/superávit.
  const done = S.carried[today()] || 0, over = S.macros.k - budget(today()) - done;
  if (over > 0) { const c = E.carry(over); c.forEach((k, i) => addAdj(i + 1, -k)); S.carried[today()] = done + c.reduce((a, b) => a + b, 0);
    S.note = `Te pasaste ${Math.round(over)} kcal: recorto ${c.filter(Boolean).map(x => -x).join(' / ')} kcal los próximos días.`; }
  persist('macros', 'meals', 'adj', 'carried');
}

function parseTrainingRequest(text) {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numberWords = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7 };
  const daysMatch = /\b([1-7]|un[oa]?|dos|tres|cuatro|cinco|seis|siete)\s*(?:dias?|sesiones?)\b/.exec(t);
  const restMatch = /descans\w*\s+(un[oa]?|uno|[1-6]|dos|tres|cuatro|cinco|seis)\s*(?:dias?)?\b/.exec(t);
  const repeating = /\b(repit\w*|vuelv\w*|ciclo)\b/.test(t);
  let split = '';
  if (/\btorso\s*(?:\/|y|[-])\s*pierna|\bupper\s*\/\s*lower\b|\btren superior\b|\btren inferior\b/.test(t)) split = 'Torso/Pierna';
  else if (/\bppl\b|\bpush\b|\bpull\b|\blegs\b|\bempuje\b|\btraccion\b/.test(t)) split = 'Push/Pull/Legs';
  else if (/full\s*body|cuerpo completo|cuerpo entero/.test(t)) split = 'Full Body';
  const days = daysMatch ? Number(daysMatch[1]) || numberWords[daysMatch[1]]
    : split === 'Torso/Pierna' ? 4 : split === 'Full Body' ? 3 : S.trainingSchedule.days;
  const explicit = !!daysMatch || !!split;
  if (!explicit) return null;
  const cycle = !!restMatch;
  const restDays = cycle ? Number(restMatch[1]) || numberWords[restMatch[1]] || 1 : 7 - days;
  const schedule = {
    days, split: split || S.trainingSchedule.split || 'Push/Pull/Legs', cycle,
    workDays: days, restDays: Math.max(0, restDays), startDate: today(),
    weekdays: days === 1 ? [1] : days === 2 ? [1, 4] : days === 3 ? [1, 3, 5]
      : days === 4 ? [1, 2, 4, 6] : days === 5 ? [1, 2, 3, 5, 6] : days === 6 ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6],
  };
  const goal = /fuerza|potencia/.test(t) ? 'fuerza' : /hipertrof|masa|musculo/.test(t) ? 'hipertrofia' : /definicion|perder peso/.test(t) ? 'definición' : '';
  const level = /principiante|novato/.test(t) ? 'principiante' : /intermedio/.test(t) ? 'intermedio' : /avanzado/.test(t) ? 'avanzado' : '';
  if (goal) S.trainingPreferences.goal = goal;
  if (level) S.trainingPreferences.level = level;
  return { days, split: schedule.split, cycle, restDays: schedule.restDays, schedule, goal, level };
}

function buildTrainingPlan(text, request = parseTrainingRequest(text)) {
  if (!request) return S.trainingPlan;
  const { days, split } = request;
  const ppl = [
    { day: 'Push A', focus: 'Pecho, hombros y tríceps', blocks: ['Press inclinado con mancuernas 4x6-8', 'Press de pecho en máquina 3x8-10', 'Elevaciones laterales 3x12-15', 'Extensión de tríceps 3x10-12'] },
    { day: 'Pull A', focus: 'Espalda y bíceps', blocks: ['Jalón al pecho 4x6-10', 'Remo con apoyo pectoral 4x8-10', 'Face pull 3x12-15', 'Curl inclinado 3x10-12'] },
    { day: 'Legs A', focus: 'Cuádriceps, isquios y gemelos', blocks: ['Prensa 4x6-10', 'Curl femoral sentado 4x8-12', 'Extensión de cuádriceps 3x12-15', 'Gemelo de pie 4x10-15'] },
    { day: 'Push B', focus: 'Hombros y pecho', blocks: ['Press militar en máquina 4x6-10', 'Press de pecho en máquina 3x8-12', 'Elevaciones laterales en polea 4x12-15', 'Fondos o extensión de tríceps 3x10-15'] },
    { day: 'Pull B', focus: 'Espalda alta y brazos', blocks: ['Remo en polea baja 4x8-12', 'Jalón unilateral 3x10-12', 'Pájaros o face pull 3x12-15', 'Curl en polea 3x10-15'] },
    { day: 'Legs B', focus: 'Glúteos e isquios', blocks: ['Hip thrust 4x6-10', 'Peso muerto rumano 3x8-10', 'Curl femoral 3x10-12', 'Gemelo sentado 4x12-15'] },
  ];
  const upperLower = [
    { day: 'Torso A', focus: 'Pecho, espalda y hombros', blocks: ['Press inclinado 4x6-10', 'Remo con apoyo 4x8-12', 'Jalón al pecho 3x8-12', 'Elevación lateral 3x12-15', 'Curl + tríceps 2x10-15'] },
    { day: 'Pierna A', focus: 'Cuádriceps e isquios', blocks: ['Prensa 4x6-10', 'Peso muerto rumano 3x8-10', 'Curl femoral 3x10-12', 'Gemelos 4x10-15'] },
    { day: 'Torso B', focus: 'Espalda, pecho y brazos', blocks: ['Jalón al pecho 4x6-10', 'Press de pecho 4x8-12', 'Remo en polea 3x8-12', 'Face pull 3x12-15', 'Curl + tríceps 2x10-15'] },
    { day: 'Pierna B', focus: 'Glúteos y piernas', blocks: ['Hip thrust 4x6-10', 'Sentadilla búlgara 3x8-12', 'Extensión de cuádriceps 3x12-15', 'Curl femoral 3x10-12'] },
  ];
  const fullBody = [
    { day: 'Cuerpo completo A', focus: 'Base de fuerza', blocks: ['Prensa 3x6-10', 'Press inclinado 3x6-10', 'Remo con apoyo 3x8-12', 'Curl femoral 2x10-15', 'Core 2x10-15'] },
    { day: 'Cuerpo completo B', focus: 'Volumen equilibrado', blocks: ['Peso muerto rumano 3x6-10', 'Press militar 3x8-12', 'Jalón al pecho 3x8-12', 'Extensión de cuádriceps 2x12-15', 'Brazos 2x10-15'] },
    { day: 'Cuerpo completo C', focus: 'Estímulo y técnica', blocks: ['Hip thrust 3x8-12', 'Press de pecho 3x8-12', 'Remo en polea 3x8-12', 'Curl femoral 2x10-15', 'Elevaciones laterales 2x12-15'] },
  ];
  const source = split === 'Torso/Pierna' ? upperLower : split === 'Full Body' ? fullBody : ppl;
  return Array.from({ length: days }, (_, i) => ({
    ...source[i % source.length],
    m: musclesForSession(source[i % source.length].day),
    day: `Día ${i + 1} · ${source[i % source.length].day}`,
  }));
}
/** Grupos musculares de cada sesión del plan (para volcarla al calendario con 2 ejercicios por músculo). */
function musclesForSession(name) {
  const t = String(name).toLowerCase();
  if (/push/.test(t)) return ['pecho', 'hombros', 'triceps'];
  if (/pull/.test(t)) return ['espalda', 'biceps', 'core'];
  if (/legs b/.test(t)) return ['gluteos', 'isquios', 'gemelos'];
  if (/legs/.test(t)) return ['cuads', 'isquios', 'gemelos'];
  if (/torso/.test(t)) return ['pecho', 'espalda', 'hombros', 'biceps', 'triceps'];
  if (/pierna/.test(t)) return ['cuads', 'isquios', 'gluteos', 'gemelos'];
  if (/completo a/.test(t)) return ['cuads', 'pecho', 'espalda', 'isquios'];
  if (/completo b/.test(t)) return ['isquios', 'hombros', 'espalda', 'cuads'];
  return ['gluteos', 'pecho', 'espalda', 'hombros'];
}
/** Vuelca el plan al calendario (próximas 4 semanas): entrenos con ejercicios y descansos. No toca días ya registrados. */
function applyPlanToCalendar() {
  const level = S.trainingPreferences.level, perMuscle = level === 'principiante' ? 1 : 2;
  const hasLogs = iso => Object.values(S.logs).some(l => l.some(x => x.d === iso));
  for (let i = 0; i < 28; i++) {
    const iso = shiftIsoDate(today(), i);
    if (hasLogs(iso)) continue;
    const ses = routineSessionForDate(iso);
    if (ses) {
      const ks = ses.m || musclesForSession(ses.day);
      S.dayMuscles[iso] = ks; delete S.dayRest[iso]; delete S.doneEx[iso];
      S.routineEdits[iso] = strategicOrder(ks).flatMap(k => CATALOG[k].slice(0, perMuscle));
    } else { delete S.dayMuscles[iso]; delete S.routineEdits[iso]; S.dayRest[iso] = true; }
  }
  ['dayMuscles', 'routineEdits', 'dayRest', 'doneEx'].forEach(k => store.set(k, S[k]));
}

function coachReply(text, request = parseTrainingRequest(text)) {
  const t = (text || '').toLowerCase();
  if (request) {
    S.trainingSchedule = request.schedule;
    S.trainingPlan = buildTrainingPlan(text, request);
    const cadence = request.cycle
      ? `${request.days} días de entrenamiento y ${request.restDays} de descanso, en ciclo`
      : `${request.days} días por semana · ${request.split}`;
    const details = S.trainingPlan.map(day => `${day.day} (${day.focus}):\n• ${day.blocks.join('\n• ')}`).join('\n\n');
    const profile = [request.goal && `objetivo ${request.goal}`, request.level && `nivel ${request.level}`].filter(Boolean).join(' · ');
    return `Entendido. Ya que entrenas con este esquema de ${cadence}${profile ? ` (${profile})` : ''}, reestructuro tu rutina de la siguiente manera:\n\n${details}\n\nActualicé tu plan y llené el calendario de las próximas 4 semanas con ejercicios por músculo${S.trainingPreferences.level === 'principiante' ? ' (1 ejercicio por músculo al empezar, para que construyas técnica)' : ''}.${S.trainingPreferences.injuries && S.trainingPreferences.injuries !== 'ninguna' ? ' Anoté tu molestia: si un ejercicio la agrava, usa Smart Swap para cambiarlo.' : ''}`;
  }
  if (!S.trainingConfigured) {
    const p = S.trainingPreferences;
    const known = [p.goal && `objetivo ${p.goal}`, p.level && `nivel ${p.level}`, p.place && `entrenas en ${p.place}`, p.duration && `sesión de ${p.duration}`, p.injuries && (p.injuries === 'ninguna' ? 'sin lesiones' : 'molestias anotadas')].filter(Boolean).join(' · ');
    const missing = [!p.goal && 'tu objetivo (hipertrofia, fuerza o definición)', !p.level && 'tu nivel (principiante, intermedio o avanzado)', 'cuántos días entrenas y cuántos descansas, y la división (PPL, torso/pierna o full body)', !p.injuries && 'si tienes alguna lesión o molestia'].filter(Boolean);
    return `${known ? `Anotado: ${known}. ` : ''}Para diseñar tu rutina aún necesito: ${missing.join('; ')}.`;
  }
  const schedule = `${S.trainingSchedule.days} días · ${S.trainingSchedule.split}`;
  if (/volumen|series|semana/.test(t)) return `Con tu esquema actual de ${schedule}, reparte las series entre las sesiones del plan y evita llevar todos los ejercicios al fallo. El detalle de cada día está en la pestaña Ejercicios.`;
  if (/recup|fatiga|descanso|sueño/.test(t)) return `Para tu esquema de ${schedule}, observa rendimiento, sueño y molestias entre sesiones. Si cae el rendimiento varios entrenamientos seguidos, reduce algunas series antes de añadir más días.`;
  if (/prior|hoy|ejercicio|pierna|legs|cuad|glute|pecho|push|hombro/.test(t)) return `Tu plan actual es ${schedule}. Revisa la sesión que corresponde en Ejercicios; prioriza el movimiento principal y conserva repeticiones en reserva si la técnica se degrada.`;
  return `Tengo registrado tu esquema de ${schedule}. Dime cuántos días quieres entrenar o qué división prefieres (PPL o Torso/Pierna) y actualizaré el plan y el calendario con ese cambio.`;
}

async function sendCoachMessage(text) {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const goal = /fuerza|potencia/.test(normalized) ? 'fuerza' : /hipertrof|masa|musculo/.test(normalized) ? 'hipertrofia' : /definicion|perder peso/.test(normalized) ? 'definición' : '';
  const level = /principiante|novato/.test(normalized) ? 'principiante' : /intermedio/.test(normalized) ? 'intermedio' : /avanzado/.test(normalized) ? 'avanzado' : '';
  if (goal) S.trainingPreferences.goal = goal;
  if (level) S.trainingPreferences.level = level;
  if (/lesion|dolor|molestia|operad|tendinitis|hernia/.test(normalized)) S.trainingPreferences.injuries = text.slice(0, 160);
  if (/\bsin lesion|ninguna lesion|no tengo lesion/.test(normalized)) S.trainingPreferences.injuries = 'ninguna';
  if (/\bcasa\b|en casa/.test(normalized)) S.trainingPreferences.place = 'casa';
  else if (/gimnasio|\bgym\b/.test(normalized)) S.trainingPreferences.place = 'gimnasio';
  const dur = /(\d{2,3})\s*(?:min|minutos)/.exec(normalized) || /(\d(?:[.,]\d)?)\s*horas?/.exec(normalized);
  if (dur) S.trainingPreferences.duration = dur[0];
  store.set('trainingPreferences', S.trainingPreferences);
  const request = parseTrainingRequest(text);
  const previousReply = [...S.coachChat].reverse().find(message => message.role === 'assistant')?.text;
  let reply = coachReply(text, request);
  if (reply === previousReply && !request) {
    reply = `Sigo con tu esquema de ${S.trainingSchedule.days} días · ${S.trainingSchedule.split}. Dime qué detalle quieres ajustar y cambio ese punto.`;
  }
  S.coachChat.push({ role: 'user', text }, { role: 'assistant', text: reply });
  S.coachChat = S.coachChat.slice(-60);
  S.note = reply;
  if (request) {
    S.trainingPlan = buildTrainingPlan(text, request);
    S.trainingConfigured = true;
    S.showRoutine = false;
    store.set('trainingConfigured', true);
    store.set('trainingSchedule', S.trainingSchedule);
    store.set('trainingPlan', S.trainingPlan);
    store.set('trainingPreferences', S.trainingPreferences);
    applyPlanToCalendar();
  }
  store.set('coachChat', S.coachChat);
  store.set('note', S.note);
  S.aiTab = 'coach';
  store.set('aiTab', S.aiTab);
  render();
  if (AI_ON || CONFIG_OK) {
    try {
      const result = await ai('coach', {
        task: 'training', systemPrompt: TRAINER_SYSTEM_PROMPT, currentMessage: text,
        schedule: S.trainingSchedule, trainingPlan: S.trainingPlan, preferences: S.trainingPreferences,
        recentMessages: S.coachChat.slice(-8),
      });
      const modelReply = String(result.note || '').trim();
      if (modelReply && modelReply !== previousReply) {
        S.coachChat[S.coachChat.length - 1] = { role: 'assistant', text: modelReply };
        S.note = modelReply;
        store.set('coachChat', S.coachChat);
        store.set('note', S.note);
      }
    } catch {}
  }
}

function nutritionReply(text, changed = []) {
  const prefs = S.nutritionPreferences, miss = N.missing(prefs, !!S.target);
  if (miss.length) return changed.length ? N.interviewReply(changed, prefs, !!S.target) : `${nutritionAnswer(text)}\n\n${N.interviewReply([], prefs, !!S.target)}`;
  return changed.length ? `Actualicé tu plan con: ${changed.map(k => N.LABELS[k] || k).join(', ')}. Revisa el menú y la lista de compras en «Tu Plan Nutricional».` : nutritionAnswer(text);
}
function nutritionAnswer(text) {
  const t = text.toLowerCase();
  const remaining = E.scale(nutritionTarget(), budget(today()));
  const kcal = Math.max(0, remaining.kcal - S.macros.k);
  const protein = Math.max(0, remaining.p - S.macros.p);
  const macroNote = `Te quedan aproximadamente ${kcal} kcal y ${protein} g de proteína hoy.`;
  const styleNote = S.style === 'batch' ? 'Como usas Batch Cooking, deja 2-3 porciones listas.'
    : S.style === 'dia' ? 'Para tu estilo de cocina al día, prepáralo fresco y ajusta la porción al hambre.'
      : S.style === 'libres' ? 'Con Macros Libres, prioriza la porción y el total del día.'
        : 'Con el estilo Híbrido, puedes usar una base ya preparada y sumar verduras frescas.';

  if (/corrientazo|callejer|restaurante|domicilio|pedir/.test(t)) {
    return `${macroNote} Para un corrientazo, elige pollo, carne magra o pescado, pide arroz y fríjoles en porciones moderadas y añade ensalada. Si puedes, cambia el jugo por agua y deja el plátano o la papa según el espacio de tus macros. Registra la comida como estimación; las porciones del restaurante varían.`;
  }
  if (/pollo/.test(t)) {
    return `${macroNote} Prepara pollo a la plancha con arroz o papa y una buena porción de verduras. Si te falta proteína, aumenta un poco el pollo; si te quedan pocas calorías, mide el aceite y reduce el acompañamiento. ${styleNote}`;
  }
  if (/atun|atún|huevo|huevos|pescado/.test(t)) {
    return `${macroNote} Una opción rápida es atún o huevos con papa/arroz y verduras; si buscas más proteína con menos grasa, combina atún con claras o yogur natural como acompañamiento. ${styleNote}`;
  }
  if (/desayun|avena/.test(t)) {
    return `${macroNote} Para desayunar, mezcla avena con yogur griego o leche y fruta; añade huevos o una fuente de proteína aparte si necesitas completar proteína. Ajusta la avena y los extras a las calorías que te quedan.`;
  }
  if (/cena|almuerzo|comida|prepar|receta|antojo|opci|macro/.test(t)) {
    return `${macroNote} Mi opción sencilla: una proteína magra (pollo, atún, huevos o legumbres), arroz/papa según tus carbohidratos disponibles y verduras. Si te quedan menos de 15 g de proteína, añade yogur griego o claras; mide aceite y salsas para controlar calorías. ${styleNote} Dime qué ingredientes tienes y te lo concreto.`;
  }
  return `${macroNote} Cuéntame qué ingredientes tienes, si buscas desayuno/almuerzo/cena y cuánto tiempo quieres dedicarle. Te propongo una combinación que encaje con tus macros; por ahora, usa una proteína, un acompañamiento y verduras. Las cantidades serán aproximadas hasta que registres la comida.`;
}

/** Nota del coach IA (best-effort): si falla, la app sigue con los números deterministas. */
async function coach(task, payload) { try { S.note = (await ai('coach', { task, ...payload })).note || S.note; } catch {} render(); }
async function authAction(fn, isSignup) {
  const email = $('#em').value.trim(), pw = $('#pw').value;
  if (!email || pw.length < 6) { S.msg = 'Correo y contraseña (mín. 6) requeridos'; return render(); }
  S.msg = 'Procesando…'; render();

  const { error } = await fn(email, pw);
  S.msg = error ? error.message : (isSignup ? 'Cuenta creada. Revisa tu correo si pide confirmación.' : '');
  if (error || isSignup) render();
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = ACT[el.dataset.act]; if (!f) return;
  await f(el.dataset);
  if (S.screen === 'app') render();
});
document.addEventListener('keydown', e => {
  const el = e.target.closest?.('.muscle-region');
  if (!el || !['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  toggleMuscle(el.dataset.k);
  render();
});

/* ---------- Arranque ---------- */
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller; // solo recarga si ya había una versión anterior instalada
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !sessionStorage.alReload) { sessionStorage.alReload = 1; location.reload(); } });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (CONFIG_OK) {
  sb.auth.onAuthStateChange((ev, session) => { if (ev !== 'TOKEN_REFRESHED') gate(session); });
  let lastCheck = Date.now(); // re-verifica la licencia al volver a la app (>5 min)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && Date.now() - lastCheck > 3e5) { lastCheck = Date.now(); gate({ user: S.user }); } });
} else { gate(); }
render();
window.__ok = 1;
