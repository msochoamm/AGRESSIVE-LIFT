// AGRESSIVE LIFT — SPA modular. Estado único (S) + render por plantillas + delegación de eventos.
import { CONFIG_OK, LOCAL_MODE, AUTH_MISCONFIGURED, sb, signIn, signUp, signOut, checkLicense, saveSet, saveBody, ai, flush } from './supabase.js';
import { hydrate, store } from './store.js';
import * as E from './engine.js';

/* ---------- Utilidades y persistencia local ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await hydrate(); // IndexedDB → caché en memoria
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_TRAINING_SCHEDULE = { days: 3, split: 'PPL', cycle: false, workDays: 3, restDays: 4, startDate: today(), weekdays: [1, 3, 5] };
const NUTRITION_GREETING = 'Antes de abrir tus macros, cuéntame cómo comes normalmente, qué alimentos prefieres o evitas, si sueles comer corrientazo/en la calle y qué estilo te funciona: batch cooking, cocinar al día, híbrido o macros libres.';
const TRAINER_SYSTEM_PROMPT = 'Eres el entrenador de AGRESSIVE LIFT. Obedece el mensaje actual del usuario: nunca sustituyas una frecuencia o división explícita por una recomendación genérica de 3 días. Si indica días, descanso cíclico o estilo (PPL, torso/pierna o full body), confirma exactamente esos parámetros y entrega sesiones con ejercicios. Usa el calendario, esquema y plan actuales como contexto. No repitas literalmente tu respuesta anterior; responde en español y con acciones concretas.';
const nutritionHistory = store.get('nutritionChatHistory', []);
const previousNutritionChat = store.get('nutritionChat', []);
if (previousNutritionChat.some(message => message.role === 'user')) {
  nutritionHistory.unshift({ endedAt: new Date().toISOString(), messages: previousNutritionChat });
  store.set('nutritionChatHistory', nutritionHistory.slice(0, 100));
}
const freshNutritionChat = [{ role: 'assistant', text: NUTRITION_GREETING }];
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
  : 'Soy tu coach de entrenamiento. Para configurar tu rutina dime tu objetivo, cuántos días tienes disponibles, qué frecuencia y descansos haces, y tu nivel (principiante, intermedio o avanzado). También puedes pedir una división PPL, torso/pierna o full body.';
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
const weekDone = k => [...ALL, ...Object.values(CEX)].filter(e => MAP[e.m] === k).reduce((n, e) => n + (S.logs[e.id] || []).filter(x => (Date.now() - new Date(x.d)) / 864e5 < 7).length, 0);
// Catálogo: SIEMPRE 2 ejercicios por músculo (principal + complementario).
const CATALOG = {
  pecho: ['Press inclinado con mancuernas 4×8-10', 'Aperturas en polea 3×12-15'],
  espalda: ['Jalón al pecho 4×8-12', 'Remo con apoyo pectoral 4×8-12'],
  hombros: ['Press militar en máquina 3×8-10', 'Elevaciones laterales en polea 4×12-15'],
  biceps: ['Curl inclinado con mancuernas 3×10-12', 'Curl predicador 3×10-12'],
  triceps: ['Extensión de tríceps en polea 3×10-12', 'Press francés con barra Z 3×8-10'],
  core: ['Crunch en polea 3×12-15', 'Elevación de piernas colgado 3×10-15'],
  cuads: ['Prensa de piernas 4×8-12', 'Extensión de cuádriceps 3×12-15'],
  isquios: ['Curl femoral sentado 4×8-12', 'Peso muerto rumano 3×8-10'],
  gluteos: ['Hip thrust 4×8-12', 'Sentadilla búlgara 3×8-10'],
  gemelos: ['Gemelo de pie 4×10-15', 'Gemelo sentado 3×12-20'],
};
const PRESETS = { Push: ['pecho', 'hombros', 'triceps'], Pull: ['espalda', 'biceps'], Piernas: ['cuads', 'isquios', 'gluteos', 'gemelos'] };
const LABEL = { pecho: 'Pecho', espalda: 'Espalda', hombros: 'Hombro', biceps: 'Bíceps', triceps: 'Tríceps', core: 'Core', cuads: 'Cuádriceps', isquios: 'Isquios', gluteos: 'Glúteo', gemelos: 'Gemelo' };
const clean = n => n.replace(/\s*\d+\s*[x×]\s*[\d-]+.*$/i, '').trim();
const slug = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CEX = {}; // ejercicios del catálogo con id estable (para registrar series y autorregulación)
Object.entries(CATALOG).forEach(([k, l]) => l.forEach((full, i) => { const n = clean(full); CEX['c-' + slug(n)] = { id: 'c-' + slug(n), n, m: LABEL[k], k, alt: [clean(l[1 - i])] }; }));
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
  trainingPreferences: store.get('trainingPreferences', {}),
  trainingSectionTab: 'routine',
  nutritionSectionTab: 'chat',
  muscleSide: 'front',
  routineDate: today(),
  routineEdits: store.get('routineEdits', {}), dayMuscles: store.get('dayMuscles', {}),
  routineModal: null,
  nutritionPreferences: store.get('nutritionPreferences', {}),
  nutritionChat: freshNutritionChat,
  nutritionHistory: store.get('nutritionChatHistory', []),
  nutritionBusy: false,
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
  if (LOCAL_MODE) { S.user = { id: 'local', email: 'local' }; S.screen = 'app'; S.msg = ''; return render(); } // sin login (temporal)
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
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const restBar = () => S.rest > Date.now() ? `<div class="rest" id="rest"><b id="rt" class="neon">${fmt(S.rest - Date.now())}</b><span class="text-sm text-zinc-400">Descanso</span>
  <span class="flex gap-1"><button class="chip" data-act="rest30">+30 s</button><button class="chip" data-act="restoff">Saltar</button></span></div>` : '';
setInterval(() => {
  if (!S.rest) return; const left = S.rest - Date.now();
  if (left > 0) { const t = document.getElementById('rt'); if (t) t.textContent = fmt(left); }
  else { S.rest = 0; navigator.vibrate?.([200, 100, 200]); render(); }
}, 250);
// Mini-gráficas SVG.
const spark = v => { if (v.length < 2) return ''; const lo = Math.min(...v), hi = Math.max(...v);
  return `<svg viewBox="0 0 120 28" preserveAspectRatio="none" class="spark"><polyline fill="none" stroke="#ff0033" stroke-width="2" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1) * 120).toFixed(1)},${(26 - (y - lo) / ((hi - lo) || 1) * 24).toFixed(1)}`).join(' ')}"/></svg>`; };
const e1h = id => { const l = S.logs[id] || []; return [...new Set(l.map(s => s.d))].map(d => Math.max(...l.filter(s => s.d === d).map(s => s.w * (1 + s.r / 30)))).slice(-12); };

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
  <div class="text-xs text-zinc-500">Mesociclo · semana ${mesoWeek()}/${S.meso.weeks} · rotación bloqueada</div></div>
  ${LOCAL_MODE ? '' : '<button class="btn ghost" data-act="logout">Salir</button>'}
</div>
${raveOn() ? `<div class="card on mt-3 text-sm">🔒 Modo Rave activo: PRs bloqueados ${Math.ceil((S.rave.prUntil - Date.now()) / 36e5)} h más. Entrena para técnica, no para récords.</div>` : ''}
<div class="tabbar">${[['train', 'Entrenar'], ['food', 'Nutrición'], ['map', 'Músculos']]
  .map(([k, l]) => `<button class="chip flex-1 ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${l}</button>`).join('')}</div>
</div>`;

const todaySets = id => (S.logs[id] || []).filter(s => s.d === today());
// Series de la sesión ANTERIOR (último día distinto de hoy) para autorregulación.
const prevSets = id => { const h = (S.logs[id] || []).filter(s => s.d !== today()); const d = h.length && h[h.length - 1].d; return h.filter(s => s.d === d); };

function exCard(e) {
  const name = S.swaps[e.id] || e.n, sets = todaySets(e.id), open = S.open === e.id, dv = S.devil[e.id],
    sg = open ? E.regulate(S.swaps[e.id] ? [] : prevSets(e.id), mesoWeek(), S.meso.weeks) : null;
  return `<div class="card ${open ? 'on' : ''}">
  <div class="flex justify-between items-start" data-act="toggle" data-id="${e.id}">
    <div><div class="font-bold text-lg leading-tight">${esc(name)}${S.swaps[e.id] ? ' <span class="text-xs neon">SWAP</span>' : ''}</div>
    <div class="text-xs text-zinc-500">${e.m} · ${sets.length} series hoy</div></div><span class="neon">${open ? '▾' : '▸'}</span></div>
  ${open ? `
  ${sets.map((s, i) => `<div class="text-sm text-zinc-400 mt-2 ${S.fresh === e.id && i === sets.length - 1 ? 'pop' : ''}">#${i + 1} · ${s.w} kg × ${s.r} · RIR ${s.rir} · falló: ${s.fail}${s.devil ? ' · 😈' : ''}</div>`).join('')}
  <div class="card !p-2 mt-2 text-sm ${sg.action === 'descarga' ? 'on' : ''}"><b class="neon">${sg.action.toUpperCase()}</b>${sg.w ? ' · ' + sg.w + ' kg' : ''}<div class="text-zinc-400">${esc(sg.note)}</div></div>
  ${spark(e1h(e.id))}
  <div class="flex gap-2 mt-3">${['w', 'r'].map(f => `<div class="step"><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? -2.5 : -1}" aria-label="menos">−</button><input id="${f}-${e.id}" type="number" inputmode="${f === 'w' ? 'decimal' : 'numeric'}" placeholder="${f === 'w' ? 'kg' : 'reps'}" ${f === 'w' && sg.w != null ? `value="${sg.w}"` : ''}><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? 2.5 : 1}" aria-label="más">＋</button></div>`).join('')}</div>
  <button class="btn fill w-full mt-2" data-act="logset" data-id="${e.id}">Registrar serie</button>
  <div class="flex gap-2 mt-2">
    <button class="btn flex-1 ${dv ? 'fill' : ''}" data-act="devil" data-id="${e.id}">😈 Modo Diablo</button>
    <button class="btn ghost flex-1" data-act="exercisevideo" data-exercise="${esc(name)}" aria-label="Ver demostración de ${esc(name)}" title="Ver demostración de ejecución">▶ Técnica</button>
    <button class="btn ghost flex-1" data-act="swap" data-id="${e.id}">Smart Swap</button></div>
  ${dv ? `<div class="card mt-2 text-sm">Última serie al fallo, luego descenso (~−20 % peso, sin descanso): 8 → 12 → 16 reps al fallo.
    <div class="flex gap-2 mt-2">${[8, 12, 16].map(r => `<button class="chip flex-1" data-act="drop" data-id="${e.id}" data-r="${r}">${r}</button>`).join('')}</div></div>` : ''}` : ''}
  </div>`;
}

const calendarDays = (month = new Date()) => {
  const y = month.getFullYear(); const m = month.getMonth();
  const first = new Date(y, m, 1); const start = new Date(first); start.setDate(first.getDate() - first.getDay());
  const label = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const training = Object.values(S.logs).flat().some(x => x.d === iso);
    const schedule = S.trainingSchedule || DEFAULT_TRAINING_SCHEDULE;
    const elapsed = Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${schedule.startDate || today()}T00:00:00Z`)) / 864e5);
    const cycleLength = Math.max(1, (Number(schedule.workDays) || schedule.days) + (Number(schedule.restDays) || 0));
    const planned = elapsed >= 0 && (schedule.cycle
      ? elapsed % cycleLength < (Number(schedule.workDays) || schedule.days)
      : (schedule.weekdays || DEFAULT_TRAINING_SCHEDULE.weekdays).includes(new Date(`${iso}T00:00:00Z`).getUTCDay()));
    const current = d.getMonth() === m;
    days.push({ iso, label: label[d.getDay() === 0 ? 6 : d.getDay() - 1], day: d.getDate(), training, planned, current });
  }
  return days;
};

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
const routineExercisesForDate = iso => S.routineEdits[iso] || routineSessionForDate(iso)?.blocks || [];

const calendarCard = () => {
  const month = new Date();
  const days = calendarDays(month);
  const active = days.filter(d => d.training).length;
  const planned = days.filter(d => d.planned).length;
  return `<div class="card calendar-card">
    <div class="flex justify-between items-center mb-2">
      <div>
        <div class="font-bold text-lg">Calendario de entrenos</div>
        <div class="text-xs text-zinc-500">${month.toLocaleString('es-ES', { month: 'long', year: 'numeric' })} · ${S.trainingSchedule.days} días · ${esc(S.trainingSchedule.split)}</div>
      </div>
      <div class="chip on">${active} hechos · ${planned} plan</div>
    </div>
    <div class="calendar-grid">${['L','M','X','J','V','S','D'].map(n => `<div class="calendar-head">${n}</div>`).join('')}${days.map(d => `<div class="calendar-day ${d.planned ? 'planned' : ''} ${d.training ? 'train' : ''} ${d.current ? 'current' : 'muted'}" title="${d.iso}${d.planned ? ' · programado' : ''}${d.training ? ' · completado' : ''}">${d.day}</div>`).join('')}</div>
    <div class="text-xs text-zinc-500 mt-2">Borde rojo: programado · rojo sólido: entreno registrado</div>
  </div>`;
};

const nutritionCoachCard = () => `<div class="card nutrition-coach">
  <div class="flex justify-between items-center gap-2">
    <div><div class="text-xs text-zinc-500 uppercase tracking">Coach IA · Nutrición</div><div class="font-bold text-lg">¿Qué preparamos?</div></div>
    <span class="text-xs text-zinc-500">Sesión actual</span>
  </div>
  ${!S.target ? '<div class="text-xs text-zinc-500 mt-2">Completa el perfil para personalizar tus macros; mientras tanto usaré una referencia general.</div>' : ''}
  <div class="coach-chat nutrition-chat" aria-live="polite">
    ${S.nutritionChat.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
    ${S.nutritionBusy ? '<div class="coach-bubble assistant">Pensando una opción…</div>' : ''}
  </div>
  <div class="quick-prompts">
    <button class="chip" data-act="nutritionprompt" data-msg="Tengo pollo y arroz, ¿qué preparo?">Pollo y arroz</button>
    <button class="chip" data-act="nutritionprompt" data-msg="Dame una cena alta en proteína">Cena alta en proteína</button>
    <button class="chip" data-act="nutritionprompt" data-msg="¿Qué opción me conviene según mis macros restantes?">Según mis macros</button>
    <button class="chip" data-act="nutritionprompt" data-msg="Quiero pedir un corrientazo, ¿cómo lo ajusto?">Comida callejera</button>
  </div>
  <div class="coach-input-row">
    <input id="nutrition-input" type="text" placeholder="Ingredientes, antojo o comida…" maxlength="220" ${S.nutritionBusy ? 'disabled' : ''}>
    <button class="btn fill" data-act="nutritionsend" ${S.nutritionBusy ? 'disabled' : ''}>Enviar</button>
  </div>
  ${S.nutritionHistory.length ? `<details class="nutrition-history"><summary>Conversaciones anteriores (${S.nutritionHistory.length})</summary>
    ${S.nutritionHistory.map(session => `<details class="nutrition-session"><summary>${new Date(session.endedAt).toLocaleString('es-ES')}</summary>
      ${session.messages.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.text)}</div>`).join('')}
    </details>`).join('')}
  </details>` : ''}
</div>`;

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
  return `<div class="card">
  <div class="font-bold mb-1">¿Qué entrenas este día?</div>
  <div class="text-xs text-zinc-500 mb-2">Elige el día arriba y marca los músculos: te armo 2 ejercicios por músculo.</div>
  <div class="flex gap-2 mb-2">${Object.keys(PRESETS).map(p => `<button class="chip flex-1" data-act="daypreset" data-p="${p}">${p}</button>`).join('')}</div>
  <div class="grid grid-cols-2 gap-2">${Object.keys(MUSCLES).map(k => { const w = recentWarn(k); return `<button class="chip ${sel.includes(k) ? 'on' : ''}" data-act="daymuscle" data-k="${k}">${MUSCLES[k].n}${w ? ` <span class="text-xs neon">⚠ hace ${w} d</span>` : ''}</button>`; }).join('')}</div>
  <button class="btn fill w-full mt-3" data-act="daygenerate">Generar rutina (${sel.length * 2} ejercicios)</button></div>`;
};
const routineDayPanel = () => {
  const session = routineSessionForDate(S.routineDate);
  const exercises = routineExercisesForDate(S.routineDate);
  const date = new Date(`${S.routineDate}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const title = session?.day || (exercises.length ? 'Sesión personalizada' : 'Descanso programado');
  return `<div class="card routine-day-panel">
    <div class="flex justify-between items-center gap-2"><div><div class="font-bold text-lg capitalize">${date}</div><div class="text-sm neon">${esc(title)}</div></div>
      <button class="btn" data-act="addroutineexercise">＋ Añadir ejercicio</button></div>
    ${session?.focus ? `<div class="text-xs text-zinc-500 mt-2">${esc(session.focus)}</div>` : ''}
    <div class="routine-exercise-list">${exercises.map((exercise, index) => `<div class="routine-exercise-row">
      <span class="routine-exercise-name">${esc(exercise)}</span>
      <button class="icon-btn" data-act="exercisevideo" data-index="${index}" aria-label="Ver demostración de ${esc(exercise)}" title="Ver demostración">▶</button>
      <button class="icon-btn" data-act="editroutineexercise" data-index="${index}" aria-label="Editar ${esc(exercise)}" title="Editar">✎</button>
      <button class="icon-btn" data-act="removeroutineexercise" data-index="${index}" aria-label="Eliminar ${esc(exercise)}" title="Eliminar">×</button>
    </div>`).join('') || `<div class="text-sm text-zinc-500 py-2">Día libre. Puedes añadir una sesión personalizada si lo necesitas.</div>`}</div>
  </div>`;
};

const loggingCards = () => {
  const cards = routineExercisesForDate(S.routineDate).map(exByName).filter(Boolean);
  if (!cards.length) return '';
  return `<div class="plan-title mt-3">Registrar series</div>${S.focus.length ? `<div class="text-xs text-zinc-500 mb-2">Enfoque semanal: ${S.focus.map(k => MUSCLES[k].n).join(' + ')}</div>` : ''}
  ${cards.map(exCard).join('')}
  <div class="text-xs text-zinc-600 mt-2">Semana ${mesoWeek()} de ${S.meso.weeks}: mantén los mismos ejercicios y sube carga o reps. <button class="underline" data-act="weeks">${S.meso.weeks} semanas (cambiar)</button> · <button class="underline" data-act="newmeso">reiniciar</button></div>`;
};
const trainingRoutinePanel = () => `<div class="routine-panel">
  
  <div class="plan-title">${S.trainingSchedule.days} días · ${esc(S.trainingSchedule.split)}</div>
  ${routineDayPicker()}
  ${dayBuilder()}
  ${routineDayPanel()}
  <div class="training-top">${calendarCard()}</div>
  ${loggingCards()}
</div>`;

const trainView = () => `<div class="section-subtabs" role="tablist" aria-label="Sección Entrenar">
  <button class="chip ${S.trainingSectionTab === 'coach' ? 'on' : ''}" role="tab" aria-selected="${S.trainingSectionTab === 'coach'}" data-act="traintab" data-tab="coach">💬 Entrenador IA</button>
  <button class="chip ${S.trainingSectionTab === 'routine' ? 'on' : ''}" role="tab" aria-selected="${S.trainingSectionTab === 'routine'}" data-act="traintab" data-tab="routine" >📋 Tu Rutina</button>
</div>
${S.trainingSectionTab === 'coach' ? coachPanel() : trainingRoutinePanel()}`;

const foodView = () => {
  const hasResponded = S.nutritionChat.some(message => message.role === 'user');
  const tabs = `<div class="section-subtabs" role="tablist" aria-label="Sección Nutrición">
    <button class="chip ${S.nutritionSectionTab === 'chat' ? 'on' : ''}" role="tab" aria-selected="${S.nutritionSectionTab === 'chat'}" data-act="nutritiontab" data-tab="chat">💬 Nutricionista IA</button>
    <button class="chip ${S.nutritionSectionTab === 'plan' ? 'on' : ''}" role="tab" aria-selected="${S.nutritionSectionTab === 'plan'}" data-act="nutritiontab" data-tab="plan" ${hasResponded ? '' : 'disabled'}>🍽️ Tu Plan Nutricional</button>
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
<div class="card"><div class="font-bold mb-2">¿Qué comiste? (la IA calcula)</div>
  <input id="meal" placeholder="${LOCAL_MODE ? 'Ej: arroz y pollo 650 kcal 45p 70c 15g' : 'Ej: corrientazo con pollo, arroz y plátano, jugo de mora'}">
  <button class="btn fill w-full mt-2" data-act="analyze" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Analizando…' : (LOCAL_MODE ? 'Registrar comida' : 'Analizar con IA')}</button>
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

const sheet = () => {
  const m = S.modal; if (!m) return '';
  if (m.type === 'rir') return `<div class="sheet"><div><div class="font-bold mb-3">¿Cuántas reps te quedaban? (RIR)</div>
    <div class="grid grid-cols-5 gap-2">${[0, 1, 2, 3, 4].map(n => `<button class="chip" data-act="rir" data-n="${n}">${n === 4 ? '4+' : n}</button>`).join('')}</div></div></div>`;
  if (m.type === 'fail') return `<div class="sheet"><div><div class="font-bold mb-3">¿Dónde cedió?</div>
    <div class="grid grid-cols-3 gap-2">${['Músculo objetivo', 'Antebrazo', 'Aire'].map(n => `<button class="chip" data-act="fail" data-n="${n}">${n}</button>`).join('')}</div></div></div>`;
  if (m.type === 'swap') return `<div class="sheet"><div><div class="font-bold mb-1">Smart Swap</div><div class="text-xs text-zinc-500 mb-3">Misma tensión, otra máquina. Solo para hoy.</div>
    ${m.alts.map(a => `<button class="btn w-full mb-2" data-act="doswap" data-n="${esc(a)}">${esc(a)}</button>`).join('')}
    <button class="btn ghost w-full" data-act="doswap" data-n="">Volver al original</button></div></div>`;
  if (m.type === 'routineedit') return `<div class="sheet"><div class="exercise-modal">
    <div class="flex justify-between items-center gap-2"><div class="font-bold">${m.index < 0 ? 'Añadir ejercicio' : 'Editar ejercicio'}</div><button class="icon-btn" data-act="closemodal" aria-label="Cerrar">×</button></div>
    <label class="text-sm text-zinc-400 block mt-3" for="routine-exercise">Nombre y objetivo/repeticiones</label>
    <input id="routine-exercise" class="mt-2" maxlength="120" placeholder="Ej: Press inclinado 4×8" value="${esc(m.value)}">
    <div class="flex gap-2 mt-3"><button class="btn fill flex-1" data-act="saveRoutineExercise">Guardar</button><button class="btn ghost flex-1" data-act="closemodal">Cancelar</button></div>
  </div></div>`;
  if (m.type === 'exercisevideo') return `<div class="sheet"><div class="exercise-modal">
    <div class="flex justify-between items-start gap-2"><div><div class="text-xs text-zinc-500 uppercase tracking">Demostración animada</div><div class="font-bold text-lg">${esc(m.name)}</div></div><button class="icon-btn" data-act="closemodal" aria-label="Cerrar">×</button></div>
    <div class="motion-stage mt-3"><svg class="motion-demo-svg motion-${m.motion}" viewBox="0 0 260 170" role="img" aria-label="Animación esquemática de la ejecución de ${esc(m.name)}">
      <line class="motion-bench" x1="58" y1="132" x2="202" y2="132"/>
      <g class="motion-figure"><circle class="motion-outline" cx="130" cy="31" r="12"/><path class="motion-outline" d="M130 44 L130 99 M130 57 L98 73 L80 61 M130 57 L162 73 L180 61 M130 99 L105 137 M130 99 L155 137"/></g>
      <g class="motion-bar"><line x1="55" y1="55" x2="205" y2="55"/><line x1="69" y1="46" x2="69" y2="64"/><line x1="191" y1="46" x2="191" y2="64"/><circle cx="55" cy="55" r="5"/><circle cx="205" cy="55" r="5"/></g>
      <path class="motion-arrow" d="M218 78 V45 M212 52 L218 44 L224 52"/>
    </svg></div>
    <p class="text-sm text-zinc-400 mt-2">Controla la fase de bajada, mantén la trayectoria estable y termina cada repetición sin perder la postura.</p>
    <a class="btn fill w-full mt-3" href="${videoUrl(m.name)}" target="_blank" rel="noopener">▶ Ver video real en YouTube ↗</a>
    <button class="btn ghost w-full mt-3" data-act="closemodal">Cerrar</button>
  </div></div>`;
  return '';
};


function render() {
  const html = S.screen === 'boot' ? '<div class="pt-48 text-center neon text-xl">Verificando licencia…</div>'
    : S.screen === 'auth' ? authView() : S.screen === 'locked' ? lockedView()
    : header() + (S.view === 'train' ? trainView() : S.view === 'food' ? foodView() : mapView()) + sheet() + restBar();
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
  view(d) {
    S.view = d.v;
    if (d.v === 'train') { S.coachOpen = true; S.trainingSectionTab = 'coach'; }
    if (d.v === 'food') S.nutritionSectionTab = 'chat';
  },
  traintab(d) {
    if (d.tab === 'routine' && !S.trainingConfigured) return;
    S.trainingSectionTab = d.tab === 'routine' ? 'routine' : 'coach';
  },
  nutritiontab(d) {
    if (d.tab === 'plan' && !S.nutritionChat.some(message => message.role === 'user')) return;
    S.nutritionSectionTab = d.tab === 'plan' ? 'plan' : 'chat';
  },
  muscleside(d) { S.muscleSide = d.side === 'back' ? 'back' : 'front'; },
  routinedate(d) {
    S.routineDate = d.date;
    const session = routineSessionForDate(d.date);
    const name = (session?.day || '').toLowerCase();
    if (/push|torso|full body/.test(name)) S.tab = 'push';
    else if (/pull/.test(name)) S.tab = 'pull';
    else if (/leg|pierna/.test(name)) S.tab = 'legs';
  },
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
    S.modal = { type: 'exercisevideo', name, motion: exerciseMotionType(name) };
  },
  closemodal() { S.modal = null; },
  daymuscle(d) { const a = S.dayMuscles[S.routineDate] || (S.dayMuscles[S.routineDate] = []), i = a.indexOf(d.k); i >= 0 ? a.splice(i, 1) : a.push(d.k); store.set('dayMuscles', S.dayMuscles); },
  daypreset(d) { S.dayMuscles[S.routineDate] = [...PRESETS[d.p]]; store.set('dayMuscles', S.dayMuscles); },
  daygenerate() {
    const ks = S.dayMuscles[S.routineDate] || []; if (!ks.length) return alert('Elige al menos un músculo');
    S.routineEdits[S.routineDate] = ks.flatMap(k => CATALOG[k]); store.set('routineEdits', S.routineEdits);
  },
  tab: d => { S.tab = d.t; S.open = null; }, toggle: d => S.open = S.open === d.id ? null : d.id,
  devil: d => S.devil[d.id] = !S.devil[d.id],
  logset(d) {
    const w = val('w-' + d.id), r = val('r-' + d.id);
    if (!(w >= 0) || !(r > 0)) return alert('Ingresa peso y repeticiones');
    if (raveOn() && E.isPR(S.logs[d.id], w, r)) return alert('🔒 PR bloqueado por Modo Rave (48 h). Baja la carga o las reps.');
    const k = MAP[exById(d.id).m];
    if (weekDone(k) >= MUSCLES[k].mrv && !confirm(`Ya alcanzaste el MRV de ${MUSCLES[k].n} esta semana (${MUSCLES[k].mrv} series). ¿Registrar igual?`)) return;
    S.modal = { type: 'rir', id: d.id, w, r, devil: !!S.devil[d.id] };
  },
  drop(d) { // −20 % sobre la última serie efectiva, en cascada
    const w = E.dropLoad(todaySets(d.id)); if (w == null) return alert('Registra primero una serie efectiva');
    S.modal = { type: 'rir', id: d.id, w, r: +d.r, devil: true };
  },
  rir(d) { S.modal = { ...S.modal, type: 'fail', rir: +d.n }; },
  fail(d) {
    const m = S.modal, row = { d: today(), w: m.w, r: m.r, rir: m.rir, fail: d.n, devil: m.devil };
    const isPR = E.isPR(S.logs[m.id], m.w, m.r);
    (S.logs[m.id] ||= []).push(row); store.set('logs', S.logs);
    saveSet(S.user.id, { exercise: m.id, weight: m.w, reps: m.r, rir: m.rir, failure: d.n, devil: m.devil });
    S.rest = Date.now() + (m.devil ? 20 : /prensa|press|jal[oó]n|remo|muerto|sentadilla|thrust|dominada/i.test(exById(m.id)?.n || '') ? 120 : 75) * 1000; S.fresh = m.id;
    S.modal = null;
    if (isPR) setTimeout(() => alert(raveOn() ? '🔒 Posible PR, pero Modo Rave lo bloquea 24 h. No cuenta.' : '🔥 ¡Nuevo PR!'), 50);
  },
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
    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const preferences = { ...S.nutritionPreferences, lastUpdate: text, updatedAt: new Date().toISOString() };
    if (/batch\s*cooking|cocinar.*semana|cocino.*semana/.test(normalized)) S.style = preferences.style = 'batch';
    else if (/cocina al dia|cocino.*diario|cada dia/.test(normalized)) S.style = preferences.style = 'dia';
    else if (/hibrid/.test(normalized)) S.style = preferences.style = 'hibrido';
    else if (/macro libres|contar macros|flexible/.test(normalized)) S.style = preferences.style = 'libres';
    if (/corrientazo|calle|restaurante|domicilio/.test(normalized)) preferences.eatsOut = true;
    if (/vegetarian|vegano|sin carne/.test(normalized)) preferences.foodPreference = 'vegetariana';
    if (/pollo|carne|pescado|huevo|atun|atún/.test(normalized)) preferences.favorites = text;
    if (/alerg|intoler|no como|no consumo|evito/.test(normalized)) preferences.restrictions = text;
    S.nutritionPreferences = preferences;
    store.set('nutritionPreferences', preferences);
    store.set('style', S.style);
    store.set('nutritionChat', S.nutritionChat);
    S.nutritionBusy = true;
    if (input) input.value = '';
    render();
    let reply = nutritionReply(text);
    if (CONFIG_OK) {
      const remaining = E.scale(nutritionTarget(), budget(today()));
      try {
        const result = await ai('coach', { task: 'nutrition',
          systemPrompt: 'Eres el coach de nutrición de AGRESSIVE LIFT. Pregunta por hábitos, preferencias, restricciones, corrientazos y estilo de cocina. Adapta cada recomendación al mensaje actual, preferencias guardadas y macros restantes; evita respuestas genéricas repetidas. No inventes macros exactos sin cantidades.',
          question: text, preferences: S.nutritionPreferences, conversation: S.nutritionChat.slice(-8),
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
  nutritionprompt(d) {
    const input = $('#nutrition-input');
    if (input) input.value = d.msg || '';
    return ACT.nutritionsend();
  },
  step(d) { const i = $('#' + d.f); i.value = Math.max(0, +((parseFloat(i.value) || 0) + +d.s).toFixed(1)); },
  rest30() { S.rest += 3e4; }, restoff() { S.rest = 0; },
  style(d) { S.style = d.k; store.set('style', d.k); },
  profile() {
    const kg = val('pf-kg'), h = val('pf-h'), age = val('pf-a');
    if (!(kg > 30 && h > 120 && age > 13)) return alert('Completa peso, altura y edad');
    S.profile = { h, age, sex: $('#pf-s').value, goal: $('#pf-g').value };
    S.target = E.initial({ kg, ...S.profile }); S.weights = [{ d: today(), kg }];
    persist('profile', 'target', 'weights'); saveBody(S.user.id, { weight: kg });
  },
  async weight() { // auditoría: recalcula objetivos de la semana siguiente con la tendencia real
    const kg = val('wt'); if (!(kg > 30 && kg < 300)) return alert('Peso inválido');
    S.weights = S.weights.filter(w => w.d !== today()).concat({ d: today(), kg }); saveBody(S.user.id, { weight: kg });
    const a = E.audit({ weights: S.weights, target: S.target, goal: S.profile.goal, raveDates: S.raveDates });
    S.target = a.target; S.note = a.note; persist('weights', 'target');
    coach('audit', { goal: S.profile.goal, target: S.target, resultado: a.note, pesos: S.weights.slice(-8) });
  },
  async analyze() {
    const text = $('#meal').value.trim(); if (!text) return;
    S.busy = true; S.msg = ''; S.preview = null; render();
    try {
      const sc = E.scale(S.target, budget(today())), m = S.macros;
      const r = LOCAL_MODE ? E.parseMeal(text) : await ai('meal', { text, restante: { k: sc.kcal - m.k, p: sc.p - m.p, c: sc.c - m.c, f: sc.f - m.f } });
      if (!r) throw new Error('Escribe los macros, ej: arroz y pollo 650 kcal 45p 70c 15g');
      S.preview = { ...r, text }; $('#meal').value = '';
    } catch (e) { S.msg = LOCAL_MODE ? e.message : 'IA no disponible: ' + e.message + '. Inténtalo de nuevo.'; }
    S.busy = false;
  },
  confirmmeal() { addMeal(S.preview.items, S.preview.text); S.preview = null; },
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
    day: `Día ${i + 1} · ${source[i % source.length].day}`,
  }));
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
    return `Entendido. Ya que entrenas con este esquema de ${cadence}${profile ? ` (${profile})` : ''}, reestructuro tu rutina de la siguiente manera:\n\n${details}\n\nActualicé tu plan y el calendario con esta distribución.`;
  }
  if (!S.trainingConfigured) {
    const preferences = [S.trainingPreferences.goal && `objetivo ${S.trainingPreferences.goal}`, S.trainingPreferences.level && `nivel ${S.trainingPreferences.level}`].filter(Boolean).join(' · ');
    return `${preferences ? `Anotado: ${preferences}. ` : ''}Para configurar y desbloquear la rutina, dime cuántos días entrenas, cuántos descansas y si prefieres PPL, torso/pierna o full body.`;
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
  }
  store.set('coachChat', S.coachChat);
  store.set('note', S.note);
  S.aiTab = 'coach';
  store.set('aiTab', S.aiTab);
  render();
  if (CONFIG_OK) {
    try {
      const result = await ai('coach', {
        task: 'training', systemPrompt: TRAINER_SYSTEM_PROMPT, currentMessage: text,
        schedule: S.trainingSchedule, trainingPlan: S.trainingPlan,
        recentMessages: S.coachChat.slice(-8),
      });
      const modelReply = String(result.note || '').trim();
      if (!request && modelReply && modelReply !== previousReply && modelReply !== reply) {
        S.coachChat[S.coachChat.length - 1] = { role: 'assistant', text: modelReply };
        S.note = modelReply;
        store.set('coachChat', S.coachChat);
        store.set('note', S.note);
      }
    } catch {}
  }
}

function nutritionReply(text) {
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (CONFIG_OK) {
  sb.auth.onAuthStateChange((ev, session) => { if (ev !== 'TOKEN_REFRESHED') gate(session); });
  let lastCheck = Date.now(); // re-verifica la licencia al volver a la app (>5 min)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && Date.now() - lastCheck > 3e5) { lastCheck = Date.now(); gate({ user: S.user }); } });
} else { gate(); }
render();
window.__ok = 1;
