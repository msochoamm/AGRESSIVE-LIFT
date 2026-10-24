// AGRESSIVE LIFT — SPA modular. Estado único (S) + render por plantillas + delegación de eventos.
import { CONFIG_OK, AI_ON, hasAiKey, setAiKey, LOCAL_MODE, AUTH_MISCONFIGURED, sb, signIn, signUp, signOut, checkLicense, saveSet, saveBody, ai, flush, aiModel, pickModel, aiProvider, validKey } from './supabase.js';
import { hydrate, store, profile, PROFILES } from './store.js';
import * as E from './engine.js';
import * as N from './nutrition.js';
import { buildMonthPdf } from './pdf.js';

/* ---------- Utilidades y persistencia local ---------- */
const $ = s => document.querySelector(s);
const VERSION = 'v27';
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await hydrate(); // IndexedDB → caché en memoria
const localIso = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const today = () => localIso(Date.now());
const DEFAULT_TRAINING_SCHEDULE = { days: 3, split: 'PPL', cycle: false, workDays: 3, restDays: 4, startDate: today(), weekdays: [1, 3, 5] };
const TRAINER_SYSTEM_PROMPT = 'Eres el entrenador real de AGRESSIVE LIFT: hablas como una persona, cercano y directo, en español y sin listas numeradas. Obedece el mensaje actual: nunca sustituyas una frecuencia o división explícita por una genérica de 3 días. Haz la entrevista de forma conversacional (UNA pregunta por turno, sin repetir lo que ya respondió: revisa preferences, lastWorkout y el historial) y, cuando tengas lo imprescindible, genera el plan en ese mismo turno con command update_routine. Si planLock está activo el plan es INAMOVIBLE hasta planLock.until: no uses update_routine y ofrece solo ajustes de carga, técnica o recuperación. No repitas literalmente tu respuesta anterior.';
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
  : AI_ON ? 'Hola, soy tu entrenador de AGRESSIVE LIFT. Para armarte la rutina cuéntame con tus palabras qué buscas (ganar músculo, definir o fuerza), cuánto llevas entrenando, qué días puedes ir y si tienes alguna molestia. Yo te voy preguntando lo que falte.' : 'Bienvenido a AGRESSIVE LIFT. Antes de abrir tu rutina necesito conocer cómo entrenas para diseñarla a tu medida. Cuéntame en un solo mensaje (o por partes): 1) tu objetivo (hipertrofia, fuerza, definición), 2) tu nivel (principiante, intermedio o avanzado), 3) cuántos días entrenas y cuántos descansas, 4) qué división prefieres (PPL, torso/pierna o full body), 5) dónde entrenas (gimnasio o casa), cuánto dura tu sesión y si tienes alguna lesión o molestia.';
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

/* Siglas: se vuelven botones en el chat y al tocarlas explican qué significan. */
const GLOSSARY = {
  'VOLUMEN': { n: 'Fase de superávit calórico', d: 'Objetivo: ganar masa muscular. Consumes más calorías de las que gastas; esa energía extra es la que el cuerpo necesita para sintetizar nuevo tejido muscular con el entrenamiento de fuerza. Suele durar 8-16 semanas.', p: 'quieres ganar músculo y tu peso es bajo o normal.', a: 'rutina de hipertrofia (RIR 1-3) y dieta con superávit pequeño: subir ~0.25-0.5 % del peso por semana.' },
  'CONSOLIDACIÓN': { n: 'Fase normocalórica', d: 'Objetivo: estabilizar los resultados obtenidos. Mantienes las calorías en tu nivel de gasto diario durante 2 a 4 semanas, justo al terminar el volumen, para que el cuerpo se adapte a su nuevo peso antes de empezar a recortar comida.', p: 'acabas de terminar un volumen y todavía no vas a definir.', a: 'rutina de carga constante y calorías iguales a tu gasto; dura 4 semanas.' },
  'DEFINICIÓN': { n: 'Fase de déficit calórico', d: 'Objetivo: perder grasa corporal manteniendo el músculo. Consumes menos calorías de las que gastas, así el cuerpo usa la grasa acumulada como energía; el entrenamiento de fuerza se mantiene pesado para proteger el músculo. Suele durar 8-16 semanas.', p: 'quieres bajar grasa y ya tienes una base de músculo.', a: 'rutina con carga pesada y constante + caminata; proteína alta; dura 10 semanas.' },
  'DIET BREAK': { n: 'Descanso de la dieta', d: 'Pausas de 1 o 2 semanas a mitad del déficit donde vuelves a comer en mantenimiento, para evitar el estancamiento y dar un respiro mental.', p: 'llevas muchas semanas en déficit y te sientes agotado o estancado.', a: 'la app no las programa sola; la IA puede sugerirlas si lo necesitas.' },
  'DIETA INVERSA': { n: 'Reverse dieting', d: 'Objetivo: reactivar el metabolismo al salir del déficit. Subes las calorías de forma muy lenta y progresiva, semana a semana, para evitar el efecto rebote (ganar grasa de golpe) y acostumbrar al cuerpo a procesar más comida tras la restricción. Suele durar varias semanas (≈4-8, según cuánto tiempo estuviste en déficit).', p: 'terminaste un déficit largo y quieres subir calorías sin rebotar.', a: 'rutina de carga constante; sube ~50-100 kcal por semana mientras el peso se mantenga estable; dura 6 semanas.' },
  'MANTENIMIENTO': { n: 'Calorías = gasto', d: 'Objetivo: salud, descanso y rendimiento físico. Consumes exactamente las mismas calorías que gastas. Es una fase de descanso metabólico y psicológico donde el peso se mantiene estable, ideal para consolidar la forma física lograda.', p: 'estás conforme con tu físico o necesitas descansar de dietas.', a: 'rutina de carga constante; dura 8 semanas y se puede repetir.' },

  'FST-7': { n: 'Fascia Stretch Training – 7', d: 'Método de Hany Rambod (coach de CBum): 7 series de un ejercicio de aislamiento con descansos muy cortos (30-45 s) al final del entrenamiento de un músculo, para buscar pump y estirar la fascia.', a: 'se añade como finalizador del día si no eres principiante.' },
  'RIR': { n: 'Repeticiones en Reserva', d: 'Cuántas repeticiones te sobran antes de llegar al fallo. RIR 2 = podrías hacer 2 más con buena técnica.', a: 'hipertrofia usa RIR 1-3; definición y fuerza, RIR 1-2.' },
  'RPE': { n: 'Escala de Esfuerzo Percibido (1-10)', d: 'Qué tan duro sintió la serie. RPE 10 = fallo total; RPE 9 equivale a más o menos RIR 1; RPE 8, a RIR 2.', a: '' },
  'LISS': { n: 'Cardio de baja intensidad y ritmo constante', d: 'Cardio suave y sostenido (caminar, bici suave) de 30-45 min. Gasta calorías sin comerse tu recuperación para las pesas.', a: 'es el cardio de la rutina de definición.' },
  'HIIT': { n: 'Entrenamiento de intervalos de alta intensidad', d: 'Alternas esfuerzos muy intensos con descansos cortos. Ahorra tiempo, pero cansa mucho y en definición puede restar recuperación a tus pesas.', a: '' },
  'PPL': { n: 'Push / Pull / Legs', d: 'División en Empuje (pecho, hombros, tríceps), Tracción (espalda, bíceps) y Piernas. Cada músculo se entrena 1-2 veces por semana según los días.', a: 'es el esquema que usa tu plan por defecto.' },
  'TDEE': { n: 'Gasto Energético Total Diario', d: 'Las calorías que quemas en un día entre metabolismo basal, actividad y entrenamiento. Es el punto de partida de la dieta: déficit para definir, superávit pequeño para ganar músculo.', a: 'tus kcal se calculan a partir de él.' },
  'ROM': { n: 'Rango de movimiento', d: 'Qué tan completo es el recorrido del ejercicio. CBum insiste en el rango completo para estimular más fibras.', a: '' },
  'PR': { n: 'Récord Personal', d: 'Tu mejor marca en un ejercicio (más peso o más repeticiones que nunca).', a: 'la app marca tus PR y da XP.' },
  '1RM': { n: 'Una repetición máxima', d: 'El peso máximo que levantas una sola vez con buena técnica. Se estima a partir de series de más repeticiones.', a: '' },
  'GVT': { n: 'German Volume Training', d: 'Método de 10 series de 10 repeticiones con el mismo peso y descansos de ~60 s. Muy exigente; sirve para acumular volumen en pocos ejercicios.', a: '' },
  'FFM': { n: 'Masa Libre de Grasa', d: 'Todo lo que pesas sin la grasa: músculo, huesos, órganos y agua. En definición el objetivo es perder grasa conservando la FFM.', a: '' },
  'NEAT': { n: 'Termogénesis por actividad no deportiva', d: 'Las calorías que gastas moviéndote fuera del gimnasio: caminar, subir escaleras, estar de pie. Los pasos diarios son la parte más fácil de subir.', a: 'la meta de 8-10 mil pasos de definición va por aquí.' },
};
const ACR_KEYS = Object.keys(GLOSSARY).sort((x, y) => y.length - x.length).map(k => k.replace('-', '\\-'));
let ACR_RX; try { ACR_RX = new RegExp('(?<![A-Za-zÁÉÍÓÚÑ0-9-])(' + ACR_KEYS.join('|') + ')(?![A-Za-zÁÉÍÓÚÑ0-9-])', 'g'); } catch { ACR_RX = new RegExp('\\b(' + ACR_KEYS.join('|') + ')\\b', 'g'); }
const rich = t => esc(t).replace(ACR_RX, k => `<button class="acr" data-act="acr" data-k="${k}">${k}</button>`);
const dAdd = n => { const d = new Date(); d.setDate(d.getDate() + n); return localIso(d); };
/* ---------- Plan bloqueado: la rutina no cambia hasta cumplir el objetivo ----------
   Criterio: los ejercicios necesitan >=6 semanas para adaptarse y medir progreso; mesociclos de 4-8 semanas (principiante/intermedio 8, avanzado 6).
   Lo que sí cambia cada sesión es la carga (el motor ajusta peso/reps). */
const planLockActive = () => !!S.planLock && !deloadOn() && dAdd(0) <= S.planLock.until; // v24: la descarga activa pausa el bloqueo
const fmtLong = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
/* Tipos de rutina por objetivo (resumen de la investigación: definición = mantener intensidad y proteína alta con déficit moderado;
   volumen/hipertrofia = 10-20 series duras por músculo/semana, 2 frecuencia, superávit pequeño). */
const GOALS = {
  'consolidación': { inspo: 'Fase normocalórica tras el volumen: mismas calorías que gastas y entrenamiento constante para fijar lo ganado.', weeks: 4, main: '3x6-10', sec: '3x8-12', acc: '3x10-12', rir: 'RIR 2-3', rest: '2 min en básicos y 60-90 s en aislados', cardio: '', nutri: 'calorías de mantenimiento (tu TDEE) durante 2-4 semanas y proteína 1.6-2.2 g/kg' },
  'mantenimiento': { inspo: 'Fase de mantenimiento: peso estable, carga constante y recuperación.', weeks: 8, main: '3x6-10', sec: '3x8-12', acc: '3x10-12', rir: 'RIR 2-3', rest: '2 min en básicos y 60-90 s en aislados', cardio: '', nutri: 'calorías iguales a tu gasto, proteína 1.6-2.2 g/kg y peso estable' },
  'dieta inversa': { inspo: 'Dieta inversa: salir del déficit subiendo calorías muy despacio sin perder carga en la barra.', weeks: 6, main: '4x6-10', sec: '3x8-12', acc: '3x10-12', rir: 'RIR 1-3', rest: '2-3 min en básicos y 60-90 s en aislados', cardio: '', nutri: 'subir ~50-100 kcal por semana mientras el peso se mantenga estable, con proteína 1.8-2.2 g/kg' },
  'hipertrofia': { inspo: 'Estilo CBum / Hany Rambod: rango completo de movimiento, ciclo de 3 días entrenando y 1 de descanso, y un finalizador FST-7 (7 series con descansos cortos) si no eres principiante.', finisher: 'Finalizador FST-7 (estilo Hany Rambod): 7x10-12 con 30-45 s de descanso, en el último ejercicio de aislamiento del día', weeks: 8, main: '4x6-10', sec: '3x8-12', acc: '3x10-15', rir: 'RIR 1-3', rest: '2-3 min en básicos y 60-90 s en aislados', cardio: '',
    nutri: 'superávit pequeño de +5-10 % (≈ +250-300 kcal sobre mantenimiento), subir 0.25-0.5 % del peso por semana, proteína 1.6-2.2 g/kg y grasa 0.8-1.2 g/kg' },
  'definición': { inspo: 'Estilo de preparación de CBum: pesas pesadas y constantes + caminata larga (≈45 min); y comidas frecuentes altas en proteína como Jesse James West.', weeks: 10, main: '4x6-8', sec: '3x8-10', acc: '3x10-12', rir: 'RIR 1-2', rest: '2-3 min en básicos y 60-90 s en aislados', cardio: 'Cardio suave: caminata de 30-45 min (después de las pesas) · meta 8-10 mil pasos al día',
    nutri: 'déficit moderado (≈ 300-500 kcal bajo mantenimiento; perder ~0.5-1 % del peso por semana, sin pasar de ahí), proteína alta (~1.9-2.2 g/kg), y mantén el peso en la barra: la carga pesada es la señal para conservar músculo' },
  'fuerza': { inspo: 'Base de powerlifting (estilo Anatoly / Vladimir Shmondenko): sentadilla, press de banca y peso muerto con técnica y seguridad primero.', weeks: 8, main: '5x3-5', sec: '3x6-8', acc: '3x8-10', rir: 'RIR 1-2', rest: '3-5 min en básicos', cardio: '',
    nutri: 'mantenimiento o superávit leve (+100-250 kcal), proteína 1.6-2.2 g/kg' },
};
const DIET = { cut: { n: 'Definición', weeks: 10, t: 'déficit moderado (~0.5-1 % del peso por semana) con proteína alta' },
  maint: { n: 'Mantenimiento', weeks: 8, t: 'calorías estables y proteína suficiente' },
  bulk: { n: 'Volumen limpio', weeks: 12, t: 'superávit pequeño (+5-10 %), subiendo ~0.25-0.5 % del peso por semana' } };
const goalSelect = long => { const pre = S.trainingPreferences.phaseDiet || '', o = (v, l) => `<option value="${v}" ${pre === v ? 'selected' : ''}>${l}</option>`;
  return `<select id="pf-g" class="mt-2"><option value="" disabled ${pre ? '' : 'selected'}>Elige tu objetivo…</option>${o('cut', long ? 'Definición (bajar grasa)' : 'Definición')}${o('maint', 'Mantenimiento')}${o('bulk', long ? 'Volumen (ganar músculo)' : 'Volumen')}</select>`; };
const dietLockActive = () => !!S.dietLock && dAdd(0) <= S.dietLock.until;
const makeDietLock = goal => ({ goal, start: dAdd(0), until: dAdd(DIET[goal].weeks * 7 - 1), weeks: DIET[goal].weeks });
const ensureDietLock = () => { if (S.profile?.goal && DIET[S.profile.goal] && !S.dietLock) { S.dietLock = makeDietLock(S.profile.goal); store.set('dietLock', S.dietLock); } };
const dietLockCard = () => { ensureDietLock(); const L = S.dietLock; if (!L) return '';
  const d = DIET[L.goal], left = Math.max(0, Math.ceil((Date.parse(L.until + 'T12:00:00') - Date.now()) / 6048e5));
  return dietLockActive()
    ? `<div class="card"><div class="font-bold">🔒 Tu dieta será ${d.n.toUpperCase()} por ${L.weeks} semanas</div><div class="text-sm text-zinc-400 mt-1">Hasta el ${fmtLong(L.until)} · te ${left === 1 ? 'queda 1 semana' : 'quedan ' + left + ' semanas'}. Estrategia: ${d.t}. El tipo de dieta no se puede cambiar hasta cumplir el objetivo; lo que sí se ajusta solo cada semana son tus calorías según tu peso real.</div><button class="chip mt-2" data-act="dietreset">🧪 Reiniciar dieta (pruebas)</button></div>`
    : `<div class="card"><div class="font-bold">✅ Terminaste tu fase de ${d.n.toLowerCase()}</div><div class="text-sm text-zinc-400 mt-1">Ya puedes elegir un nuevo objetivo.</div><button class="btn fill w-full mt-2" data-act="dietnew">Elegir nuevo objetivo</button></div>`; };
const goalKey = () => GOALS[S.trainingPreferences.goal] ? S.trainingPreferences.goal : 'hipertrofia';
const makeLock = () => { const gk = goalKey(), g = GOALS[gk], sc = S.trainingSchedule || {};
  S.trainingPreferences.goal = gk; store.set('trainingPreferences', S.trainingPreferences);
  const weeks = S.trainingPreferences.level === 'avanzado' && gk !== 'definición' ? Math.min(g.weeks, 6) : g.weeks;
  return { start: dAdd(0), until: dAdd(weeks * 7 - 1), weeks, days: sc.days || 3, split: sc.split || 'Push/Pull/Legs', goal: gk }; };
const goalNote = gk => { const g = GOALS[gk]; return `🎯 Rutina de ${gk}: ejercicio principal ${g.main}, secundarios ${g.sec}, accesorios ${g.acc}, cerca del fallo (${g.rir}). Descansos: ${g.rest}.${g.cardio ? ' ' + g.cardio + '.' : ''}\n🏋️ ${g.inspo}\n🍽️ Nutrición para ${gk}: ${g.nutri}.\n📈 Seguimiento: pésate 2-3 veces por semana (la app ajusta tus calorías) y revisa tu avance cada 4 semanas. Duerme 7-9 h.\n👆 Toca una sigla (RIR, FST-7, LISS…) para ver qué significa.`; };
const lockMsg = (fresh = false) => { const L = S.planLock, left = Math.max(1, Math.ceil((Date.parse(L.until + 'T12:00:00') - Date.now()) / 6048e5));
  return `🔒 Tu plan de entrenamiento será ${L.split} · ${L.days} días por semana durante ${L.weeks} semanas (hasta el ${fmtLong(L.until)}) para que cumplas tu objetivo${L.goal ? ' de ' + L.goal : ''}. ${fresh ? '' : `Te quedan ${left} semana${left > 1 ? 's' : ''}. `}Durante ese tiempo la rutina y los ejercicios no cambian: ${L.weeks >= 6 ? 'hacen falta al menos 6 semanas con los mismos movimientos para adaptarte y medir progreso real' : 'es una fase corta: mantén los mismos movimientos para ver cómo responde tu cuerpo'}. Lo que sí sube sesión a sesión es la carga y las repeticiones.`; };
const lockedToast = () => toast(`🔒 Plan bloqueado hasta el ${fmtLong(S.planLock.until)}`);
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
  planLock: store.get('planLock', null), coachPending: store.get('coachPending', null), trainingOnboarded: store.get('trainingOnboarded', savedTrainingConfigured), dietLock: store.get('dietLock', null),
  recentMeals: store.get('recentMeals', []), hydra: store.get('hydra', {}), deload: store.get('deload', null), deloadSkip: store.get('deloadSkip', ''), flashId: '', flashUntil: 0, flashN: 0,
  onboarded: store.get('onboarded', savedTrainingConfigured),
  trainingPreferences: store.get('trainingPreferences', {}),
  trainingSectionTab: 'routine',
  nutritionSectionTab: 'chat',
  muscleSide: 'front',
  routineDate: today(),
  manualRest: store.get('manualRest', {}), manualTrain: store.get('manualTrain', {}), customDay: store.get('customDay', {}),
  routineEdits: store.get('routineEdits', {}), dayMuscles: store.get('dayMuscles', {}), dayRest: store.get('dayRest', {}), ytkey: store.get('ytkey', ''), macroHist: store.get('macroHist', {}), toast: '', doneEx: store.get('doneEx', {}), drop: {}, restWhy: '', ytcache: store.get('ytcache', {}),
  routineModal: null,
  nutritionPreferences: store.get('nutritionPreferences', {}),
  nutritionChat: freshNutritionChat,
  nutritionHistory: store.get('nutritionChatHistory', []),
  nutritionBusy: false,
  menuDay: (new Date().getDay() + 6) % 7, menuSeed: store.get('menuSeed', 0), menuWeek: 0, menuWeekSeen: store.get('menuWeekSeen', ''), pdfMonth: store.get('pdfMonth', ''), badgesSeen: store.get('badgesSeen', null),
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
// Audio desbloqueado en un gesto (iOS lo exige) + beep triple con onda cuadrada.
let AC;
const unlockAudio = () => { try { AC ||= new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch {} };
const beep = () => { try { unlockAudio(); const t0 = AC.currentTime; [0, .24, .48].forEach((o, i) => { const osc = AC.createOscillator(), g = AC.createGain(); osc.type = 'square'; osc.frequency.value = i === 2 ? 1320 : 990;
  g.gain.setValueAtTime(.0001, t0 + o); g.gain.exponentialRampToValueAtTime(.4, t0 + o + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + o + .2); osc.connect(g); g.connect(AC.destination); osc.start(t0 + o); osc.stop(t0 + o + .22); }); } catch {} };
const askNotif = () => { try { if ('Notification' in window && Notification.permission === 'default' && !store.get('notifAsked')) { store.set('notifAsked', 1); Notification.requestPermission(); } } catch {} };
const swPost = m => { try { navigator.serviceWorker?.controller?.postMessage(m); } catch {} };
let sentRest = 0; // el SW recibe el fin del descanso (timestamp) cada vez que cambia: +30 s, saltar, nueva serie…
const restSync = () => { if (S.rest === sentRest) return; sentRest = S.rest; swPost(S.rest > Date.now() ? { type: 'rest', at: S.rest, body: S.restWhy || 'Vuelve a la barra: toca la siguiente serie.' } : { type: 'rest-cancel' }); };
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const restBar = () => S.rest > Date.now() ? `<div class="rest" id="rest"><b id="rt" class="neon">${fmt(S.rest - Date.now())}</b><span class="text-sm text-zinc-400 flex-1 min-w-0 resttxt">${esc(S.restWhy || 'Descanso')}</span>
  <span class="flex gap-1"><button class="chip" data-act="rest30">+30 s</button><button class="chip" data-act="restoff">Saltar</button></span></div>` : '';
function tickRest() { // el fin es un timestamp: sobrevive a segundo plano y se resuelve al volver
  if (!S.rest) return; const left = S.rest - Date.now();
  if (left > 0) { const t = document.getElementById('rt'); if (t) t.textContent = fmt(left); return; }
  const late = left < -15e3; S.rest = 0; S.restWhy = ''; sentRest = 0; swPost({ type: 'rest-cancel' });
  if (!late) { beep(); navigator.vibrate?.([300, 100, 300, 100, 500]); }
  if (!late && document.hidden && 'Notification' in window && Notification.permission === 'granted')
    navigator.serviceWorker?.ready.then(r => r.showNotification('⏱ ¡Descanso terminado!', { body: 'Vuelve a la barra: toca la siguiente serie.', tag: 'rest', renotify: true, vibrate: [300, 100, 300, 100, 500], icon: 'icon-192.png', badge: 'icon-192.png' })).catch(() => {});
  render();
}
setInterval(tickRest, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { unlockAudio(); tickRest(); } });
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
  ${LOCAL_MODE ? `<button class="btn ghost" data-act="aikey">🤖 IA<br><small>${AI_ON ? esc(aiModel() || 'activa') : 'conectar'}</small></button><button class="btn ghost" data-act="switchuser">👤 ${esc(PROFILES[profile])}<br><small>Cambiar</small></button>` : '<button class="btn ghost" data-act="logout">Salir</button>'}
</div>
${raveOn() ? `<div class="card on mt-3 text-sm">🔒 Modo Rave activo: PRs bloqueados ${Math.ceil((S.rave.prUntil - Date.now()) / 36e5)} h más. Entrena para técnica, no para récords.</div>` : ''}
<div class="tabbar">${[['train', '🏋️', 'Entrenar'], ['food', '🍽️', 'Nutrición'], ['map', '🧬', 'Músculos'], ['control', '📊', 'Control']]
  .map(([k, i, l]) => `<button class="chip flex-1 tabbtn ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}"><span class="ti">${i}</span><span>${l}</span></button>`).join('')}</div>
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
/* ---------- v24: último peso, PR cercano, descarga activa, agua/creatina, favoritos, reporte, meta ---------- */
const exAdvice = id => { const prev = S.swaps[id] ? [] : prevSets(id); return deloadOn() ? E.deload(prev) : E.regulate(prev, mesoWeek(), S.meso.weeks); };
const lastPill = id => { const l = (S.logs[id] || []).filter(x => x.t !== 'w' && x.t !== 'drop').at(-1); if (!l) return '';
  return `<button class="last-pill" data-act="uselast" data-id="${id}" data-w="${l.w}" data-r="${l.r}" aria-label="Usar el último peso">↺ Último: <b>${l.w} kg</b> × ${l.r} · ${l.d === today() ? 'hoy' : l.d.slice(5)}</button>`; };
const prBox = (id, sg) => { if (!sg || sg.w == null || raveOn() || deloadOn() || S.swaps[id]) return '';
  const pv = prevSets(id), r = pv.length ? Math.round(pv.reduce((n, s) => n + s.r, 0) / pv.length) : 8, h = E.prHint(S.logs[id] || [], sg.w, r);
  return h ? `<div class="pr-hint ${h.kind}">${esc(h.text)}</div>` : ''; };
const flashCls = id => (S.flashId === id && Date.now() < S.flashUntil ? 'sv' + (S.flashN % 2) : '');
const celebrate = (id, pr) => { navigator.vibrate?.(pr ? [100, 50, 100, 50, 250] : [100, 50, 100]); S.flashId = id; S.flashUntil = Date.now() + 700; S.flashN++; unlockAudio(); askNotif(); };

// Descarga activa: se sugiere (nunca se impone) tras 2 sesiones seguidas al fallo con caída de reps; al aceptar, pausa el bloqueo y lo extiende 7 días.
const deloadOn = () => !!S.deload && S.deload.until >= today();
const deloadCard = () => {
  if (deloadOn()) return `<div class="card on mt-3 text-sm">🌿 <b class="neon">Descarga activa</b> hasta el ${fmtLong(S.deload.until)}: −15 % de carga, la mitad de series y RIR 3-4. El bloqueo del plan queda en pausa y se extendió 7 días.</div>`;
  if (S.deloadSkip > today() || (S.deload && S.deload.until >= dAdd(-14))) return '';
  const f = E.fatigue(S.logs, { today: today() }); if (!f.flag) return '';
  const names = f.ids.slice(0, 3).map(id => esc(exById(id)?.n || id)).join(', ');
  return `<div class="card on mt-3"><div class="font-bold neon">⚠️ Fatiga acumulada</div><div class="text-sm text-zinc-400 mt-1">${names}: 2 sesiones seguidas al fallo (RIR 0) y menos reps con el mismo peso. Te sugiero ${planLockActive() ? 'pausar el bloqueo del plan y hacer' : 'hacer'} 1 semana de descarga activa.</div>
  <div class="flex gap-2 mt-2"><button class="btn fill flex-1" data-act="deloadstart">Descarga 1 semana</button><button class="btn ghost flex-1" data-act="deloadskip">Ahora no</button></div></div>`; };

// Agua y creatina: un solo mapa {fecha: {ml, cr}} en IndexedDB (por perfil, se reinicia solo cada día).
const WATER_ML = 4000;
const hyd = () => S.hydra[today()] || { ml: 0, cr: false };
const setHyd = h => { S.hydra[today()] = h; S.hydra = Object.fromEntries(Object.entries(S.hydra).sort(([x], [y]) => x.localeCompare(y)).slice(-400)); store.set('hydra', S.hydra); };
const hydraCard = () => { const h = hyd();
  return `<div class="card"><div class="flex justify-between items-center"><div class="font-bold">💧 Agua · <span class="${h.ml >= WATER_ML ? 'neon' : ''}">${+(h.ml / 1000).toFixed(2)} / ${WATER_ML / 1000} L</span></div><button class="chip !px-3" data-act="water" data-n="-250" aria-label="Quitar 250 ml">−250</button></div>
  <div class="xpbar big mt-2"><i style="width:${Math.min(100, h.ml / WATER_ML * 100)}%;background:linear-gradient(90deg,#38bdf8,#bae6fd);box-shadow:0 0 8px #38bdf8"></i></div>
  <div class="hydra-row"><button class="chip" data-act="water" data-n="250">+250 ml</button><button class="chip" data-act="water" data-n="500">+500 ml</button><button class="chip" data-act="water" data-n="1000">+1 L</button></div>
  <button class="chk" data-act="creatine" aria-pressed="${h.cr}"><i>${h.cr ? '✓' : ''}</i><span>Creatina tomada hoy</span></button></div>`; };

// Favoritos: las 3 últimas comidas distintas, un toque para repetirlas (sin llamar a la IA).
const quickMeals = () => S.recentMeals.length ? `<div class="quick-meals"><div class="text-xs text-zinc-500 mb-1">⚡ Repetir una comida reciente</div><div class="qm-row">${S.recentMeals.map((m, i) => `<button class="qm" data-act="quickmeal" data-i="${i}"><b>${esc(m.text)}</b><span>${m.k} kcal · P${m.p} C${m.c} G${m.f}</span></button>`).join('')}</div></div>` : '';

// Proyección de meta: semana X de Y del bloque de entreno y de dieta (sale de planLock / dietLock).
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const goalLine = (P, label) => `<div class="mt-3"><div class="flex justify-between text-sm gap-2"><b>${label}</b><span class="text-zinc-400" style="white-space:nowrap">${P.done ? '✅ completada' : `${P.left} ${P.left === 1 ? 'día' : 'días'} restantes`}</span></div><div class="xpbar big mt-1"><i style="width:${P.pct}%"></i></div></div>`;
const goalBar = () => { const tp = E.planProgress(S.planLock, today()), dp = E.planProgress(S.dietLock, today()); if (!tp && !dp) return '';
  return `<div class="card"><div class="font-bold">🎯 Proyección de meta</div>${tp ? goalLine(tp, `Entreno · semana ${tp.week} de ${tp.weeks} de ${esc(cap(S.planLock.goal || 'tu plan'))}`) : ''}${dp ? goalLine(dp, `Dieta · semana ${dp.week} de ${dp.weeks} de ${esc(DIET[S.dietLock.goal]?.n || 'tu dieta')}`) : ''}</div>`; };

// Reporte semanal del Titán: se abre solo los domingos (una vez) y a demanda desde Control.
const weekDays = off => Array.from({ length: 7 }, (_, i) => dAdd(i - 6 - off));
const titanSheet = () => {
  const rep = off => E.weekReport({ logs: S.logs, hist: S.macroHist, budget: histBudget, days: weekDays(off) }), r = rep(0), p = rep(7), dv = p.ton ? Math.round((r.ton - p.ton) / p.ton * 100) : null;
  return `<div class="sheet"><div><div class="text-xs text-zinc-500 uppercase tracking">Reporte semanal</div><div class="text-2xl font-black neon">${r.trainDays >= 3 ? '🏆 Semana de Titán' : '💪 Semana de construcción'}</div>
  <div class="statgrid"><div class="stat"><b>${r.ton.toLocaleString('es-CO')}</b><span>kg movidos</span></div><div class="stat"><b>${r.onTarget}/7</b><span>días en meta</span></div><div class="stat"><b>${r.prs}</b><span>PRs rotos</span></div></div>
  <div class="text-sm text-zinc-400 mt-3">${r.trainDays} días entrenados · ${r.sets} series${dv == null ? '' : ` · ${dv >= 0 ? '▲' : '▼'} ${Math.abs(dv)} % de tonelaje vs. la semana pasada`}</div>
  <div class="text-sm mt-2">${!S.target ? 'Configura tu perfil en Nutrición para medir la adherencia calórica.' : r.logged < 4 ? 'Registra tus comidas todos los días: sin datos, la adherencia no cuenta.' : r.onTarget >= 5 ? 'Disciplina de élite con la comida.' : 'El físico se decide en la cocina: apunta a 5 o más días en meta.'}</div>
  <button class="btn fill w-full mt-4" data-act="closemodal">¡A por la próxima semana!</button></div></div>`; };
const maybeTitan = () => { if (new Date().getDay() !== 0 || store.get('titanSeen') === today() || !S.onboarded || S.modal || !allRows().length) return; S.modal = { type: 'titan' }; };

function exCard(e) {
  const name = S.swaps[e.id] || e.n, sets = todaySets(e.id), open = S.open === e.id, dv = S.devil[e.id], done = isDone(e.id), dp = S.drop[e.id];
  const work = sets.filter(x => x.t !== 'w' && x.t !== 'drop'), plan = e.sets || 3;
  const sg = open ? exAdvice(e.id) : null;
  return `<div class="card ${open ? 'on' : ''} ${done ? 'done' : ''}">
  <div class="flex justify-between items-start" data-act="toggle" data-id="${e.id}">
    <div><div class="font-bold text-lg leading-tight">${done ? '✅ ' : ''}${esc(name)}${S.swaps[e.id] ? ' <span class="text-xs neon">SWAP</span>' : ''}</div>
    <div class="text-xs text-zinc-500">${e.m}${e.sets ? ` · plan ${e.sets}×${e.rng}` : ''} · ${work.length}/${plan} series${e.fin ? ' · <span class="neon">🔥 finalizador</span>' : ''}</div></div><span class="neon">${open ? '▾' : '▸'}</span></div>
  ${open ? `
  ${sets.map((x, i) => `<div class="text-sm text-zinc-400 mt-2 ${S.fresh === e.id && i === sets.length - 1 ? 'pop' : ''}">${setLabel(x.t)} · ${x.w} kg × ${x.r}${x.t === 'w' ? '' : ` · RIR ${x.rir}`}${x.fail && x.fail !== 'Músculo objetivo' ? ` · limitó: ${x.fail}` : ''}</div>`).join('')}
  <div class="card !p-2 mt-2 text-sm ${sg.action === 'descarga' ? 'on' : ''}"><b class="neon">${sg.action.toUpperCase()}</b>${sg.w ? ' · ' + sg.w + ' kg' : ''}<div class="text-zinc-400">${esc(sg.note)}</div></div>
  ${spark(e1h(e.id))}
  ${prBox(e.id, sg)}
  ${dp ? dropBanner(e.id, dp) : `
  ${lastPill(e.id)}<div class="flex gap-2 mt-3">${['w', 'r'].map(f => `<div class="step"><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? -2.5 : -1}" aria-label="menos">−</button><input id="${f}-${e.id}" type="number" inputmode="${f === 'w' ? 'decimal' : 'numeric'}" placeholder="${f === 'w' ? 'kg' : 'reps'}" ${f === 'w' && sg.w != null ? `value="${sg.w}"` : ''}><button data-act="step" data-f="${f}-${e.id}" data-s="${f === 'w' ? 2.5 : 1}" aria-label="más">＋</button></div>`).join('')}</div>
  <button class="btn fill w-full mt-2 ${flashCls(e.id)}" data-act="logset" data-id="${e.id}">Registrar serie ${work.length + 1}</button>`}
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
function legacyRaw(iso, schedule) {
  const start = schedule.startDate || today();
  const elapsed = Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5);
  if (elapsed < 0) return null;
  if (schedule.cycle) {
    const workDays = Number(schedule.workDays) || schedule.days;
    const cycleLength = Math.max(1, workDays + (Number(schedule.restDays) || 0));
    const position = elapsed % cycleLength;
    if (position >= workDays) return null;
    return Math.floor(elapsed / cycleLength) * workDays + position;
  }
  const weekdays = schedule.weekdays || DEFAULT_TRAINING_SCHEDULE.weekdays;
  const sessionPosition = weekdays.indexOf(new Date(`${iso}T00:00:00Z`).getUTCDay());
  if (sessionPosition < 0) return null;
  const weeksElapsed = Math.floor((Date.parse(`${mondayOf(iso)}T00:00:00Z`) - Date.parse(`${mondayOf(start)}T00:00:00Z`)) / (7 * 864e5));
  return weeksElapsed * weekdays.length + sessionPosition;
}
/* v25: calendario SECUENCIAL. Las sesiones del plan (Push, Pull, Legs…) se reparten EN ORDEN sobre los días de entreno.
   Un descanso marcado a mano NO consume sesión: la que te tocaba pasa al día siguiente libre (o al próximo día de entreno)
   y todo lo que sigue se corre. En ciclos (ej. 3 entrenando + 1 descanso) el descanso marcado reinicia el ciclo.
   Un "Entreno" extra en un día de descanso inserta una sesión y también corre lo demás. */
function sessionTimeline(toIso, sch = S.trainingSchedule || DEFAULT_TRAINING_SCHEDULE) {
  const out = {}, rest = S.manualRest || {}, extra = S.manualTrain || {};
  const work = Number(sch.workDays) || sch.days || 3, len = Math.max(1, work + (Number(sch.restDays) || 0)), wds = sch.weekdays || DEFAULT_TRAINING_SCHEDULE.weekdays;
  let seq = sch.offset || 0, pos = 0, carry = false;
  for (let iso = sch.startDate || today(), g = 0; iso <= toIso && g < 800; iso = shiftIsoDate(iso, 1), g++) {
    if (sch.cycle) {
      const w = pos < work;
      if (rest[iso]) { out[iso] = null; pos = w ? 0 : (pos + 1) % len; }
      else if (w || extra[iso]) { out[iso] = seq++; pos = (pos + 1) % len; }
      else { out[iso] = null; pos = (pos + 1) % len; }
    } else {
      const sched = wds.includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
      if (rest[iso]) { out[iso] = null; if (sched) carry = true; }
      else if (sched || carry || extra[iso]) { out[iso] = seq++; carry = false; }
      else out[iso] = null;
    }
  }
  return out;
}
function routineSessionForDate(iso) {
  const n = S.trainingPlan.length; if (!n) return null;
  const seq = sessionTimeline(iso)[iso]; if (seq == null) return null;
  const index = seq % n; return { ...S.trainingPlan[index], index };
}
/** Próximo día con sesión después de fromIso (para avisar "tu próximo entreno es…"). */
function nextSession(fromIso, span = 60) {
  const n = S.trainingPlan.length; if (!n) return null;
  const t = sessionTimeline(shiftIsoDate(fromIso, span));
  for (let i = 1; i <= span; i++) { const iso = shiftIsoDate(fromIso, i); if (t[iso] != null) { const index = t[iso] % n; return { iso, ses: { ...S.trainingPlan[index], index } }; } }
  return null;
}
/* ---------- Organización por fechas: último entrenamiento + días de la semana ---------- */
const NUMW = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
const WD = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const WDN = Object.keys(WD).join('|');
const monFirst = d => (d + 6) % 7;
function parseLastWorkout(t) {
  const none = /\b(nunca|no he entrenado|sin entrenar|empiezo de cero|empezando de cero|primera vez|aun no entreno)\b|llevo\s+(?:\w+\s+){0,2}(?:semanas|meses)\s+sin|hace\s+(?:varias\s+|unas\s+)?(?:semanas|meses)\s+que\s+no/.test(t);
  const past = /(hice|hizo|entrene|entrenaba|toco|trabaje|ultim[oa]|fue)/.test(t);
  let date = '', wd = null;
  if (/\bhoy\b/.test(t) && past) date = today();
  else if (/\banteayer\b|\bantier\b/.test(t)) date = shiftIsoDate(today(), -2);
  else if (/\bayer\b/.test(t)) date = shiftIsoDate(today(), -1);
  else {
    const m = /hace\s+(\d{1,2}|un|dos|tres|cuatro|cinco)\s+dias?/.exec(t);
    if (m) date = shiftIsoDate(today(), -(Number(m[1]) || NUMW[m[1]]));
    else {
      const w = new RegExp(`(?:el\\s+)?(${WDN})\\b[^.,;]{0,30}\\b(?:hice|entrene|toco|trabaje|fue)\\b|\\b(?:hice|entrene|toco|trabaje|fue|ultimo)\\b[^.,;]{0,30}\\b(${WDN})\\b`).exec(t);
      if (w) { wd = WD[w[1] || w[2]]; const back = ((new Date().getDay() - wd + 7) % 7) || 7; date = shiftIsoDate(today(), -back); }
    }
  }
  let focus = '';
  if (date || past) {
    if (/full\s*body|cuerpo completo/.test(t)) focus = 'full';
    else if (/pecho/.test(t) && /espalda/.test(t) || /torso|tren superior|upper/.test(t)) focus = 'torso';
    else if (/pierna|cuadricep|gluteo|femoral|sentadilla|\blegs?\b/.test(t)) focus = 'legs';
    else if (/espalda|biceps|jalon|\bremo\b|\bpull\b|traccion/.test(t)) focus = 'pull';
    else if (/pecho|hombro|triceps|\bpush\b|empuje|\bpress\b/.test(t)) focus = 'push';
  }
  return { none, date, focus, wd };
}
/* Después de la configuración inicial, el último entrenamiento sale de tus registros (no se vuelve a preguntar). */
function lastWorkoutFromLogs() {
  const all = [...ALL, ...Object.values(CEX)]; let last = '';
  for (const id of Object.keys(S.logs)) for (const x of S.logs[id]) if (x.t !== 'w' && x.d > last) last = x.d;
  if (!last) return null;
  const cnt = { push: 0, pull: 0, legs: 0 };
  for (const id of Object.keys(S.logs)) if (S.logs[id].some(x => x.d === last && x.t !== 'w')) {
    const em = all.find(e => e.id === id)?.m, m = String(MAP[em] || em).toLowerCase();
    const g = /pecho|hombro|tricep/.test(m) ? 'push' : /espalda|bicep|core/.test(m) ? 'pull' : /cuad|isqu|glute|gemel|pierna/.test(m) ? 'legs' : ''; if (g) cnt[g]++; }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  return { none: false, date: last, focus: top && top[1] ? top[0] : '', wd: null };
}
function parseWeekdays(t, exclude = null) {
  const found = new Set();
  const range = new RegExp(`(${WDN})\\s+a\\s+(${WDN})`).exec(t);
  if (range) { for (let d = monFirst(WD[range[1]]); d <= monFirst(WD[range[2]]); d++) found.add((d + 1) % 7); }
  else for (const [k, v] of Object.entries(WD)) if (new RegExp(`\\b${k}s?\\b`).test(t)) found.add(v);
  if (exclude !== null && exclude !== undefined) found.delete(exclude);
  return [...found].sort((x, y) => monFirst(x) - monFirst(y));
}
const FOCUS_RX = { push: /push|torso/i, pull: /pull|torso/i, legs: /legs|pierna/i, torso: /torso/i, full: /completo/i };
const FOCUS_TXT = { push: 'empuje (pecho/hombro/tríceps)', pull: 'tracción (espalda/bíceps)', legs: 'pierna', torso: 'torso', full: 'cuerpo completo' };
const nextAfter = focus => { const i = S.trainingPlan.findIndex(d => FOCUS_RX[focus]?.test(d.day)); return i < 0 ? 0 : (i + 1) % S.trainingPlan.length; };
function alignSchedule(sch, nextIdx) { // la primera sesión del calendario será la que sigue a tu último entrenamiento
  const n = S.trainingPlan.length || 1; sch.offset = 0;
  const first = Object.entries(sessionTimeline(shiftIsoDate(sch.startDate, 21), sch)).find(([, v]) => v !== null);
  sch.offset = ((nextIdx % n) + n) % n; return first ? first[0] : sch.startDate;
}
const calPreview = () => { const D = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'], out = [];
  for (let i = 0; i < 14; i++) { const iso = shiftIsoDate(today(), i), ses = routineSessionForDate(iso), d = new Date(iso + 'T12:00:00');
    out.push(`${D[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}: ${ses ? `${ses.day} — ${String(ses.focus).split(' · ')[0]}` : 'descanso'}`); }
  return out.join('\n'); };
const missingIntake = () => { const tp = S.trainingPreferences, m = [];
  if (!tp.bodyKg || !tp.heightCm) m.push('body'); if (!tp.age) m.push('age'); if (!tp.duration) m.push('duration'); if (!tp.injuries) m.push('injury'); return m; };
const PHASES = [
  [/dieta inversa|reverse/, 'dieta inversa', 'dieta inversa', 'maint'],
  [/consolidacion|normocalorica/, 'consolidación', 'consolidación', 'maint'],
  [/mantenimiento|mantener (?:mi )?peso|mantengo/, 'mantenimiento', 'mantenimiento', 'maint'],
  [/definicion|deficit|\bcut\b|cutting|bajar grasa|perder grasa|secar|quemar grasa|bajar de peso|perder peso/, 'definición', 'definición', 'cut'],
  [/volumen|superavit|\bbulk|hipertrof|ganar (?:masa|musculo)|masa muscular|subir de peso|aumentar peso/, 'volumen', 'hipertrofia', 'bulk'],
];
const parsePhase = t => { for (const [rx, name, goal, diet] of PHASES) if (rx.test(t)) return { name, goal, diet }; return null; };
const needPhaseNow = () => !S.trainingPreferences.phase && S.trainingPreferences.goal !== 'fuerza';
const INTAKE_Q = (miss, needDays, needLw, needPhase) => { const q = [];
  if (miss.includes('body')) q.push('¿Cuál es tu peso actual y tu estatura? (para calcular tus métricas y ver cambios recientes). Ej: «72 kg y 1,75»');
  if (miss.includes('age')) q.push('¿Qué edad tienes? (afecta directamente tu capacidad de recuperación)');
  if (miss.includes('duration')) q.push('¿Cuánto tiempo dura cada sesión que puedes dedicar? Ej: «60 min»');
  if (needDays) q.push('¿Qué días de la semana vas a entrenar? Ej: «lunes, martes, jueves y sábado» (o un ciclo, como 3 días entrenando y 1 de descanso)');
  if (needLw) q.push('¿Cuándo fue tu último entrenamiento y qué grupo muscular o rutina hiciste? (para calcular el descanso y no sobreentrenar el mismo músculo). Ej: «ayer pierna» o «llevo semanas sin entrenar»');
  if (miss.includes('injury')) q.push('¿Tienes alguna molestia, dolor o lesión en este momento? (revisión rápida de seguridad antes de cargar peso). Si no, escribe «ninguna»');
  if (needPhase) q.push('¿Cómo vas a hacer tu fase? Elige una (toca el nombre subrayado para ver qué es, cuánto dura y para quién es):\n   • VOLUMEN (superávit calórico): ganar masa muscular.\n   • CONSOLIDACIÓN (normocalórica): estabilizar lo ganado, 2-4 semanas.\n   • DEFINICIÓN (déficit calórico): perder grasa conservando el músculo.\n   • DIETA INVERSA: subir calorías poco a poco al salir del déficit.\n   • MANTENIMIENTO: calorías iguales a tu gasto.');
  const E = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
  return '🆕 Configuración inicial (solo se pide esta primera vez, para definir tu objetivo y tu rutina). Antes de armar y bloquear tu rutina respóndeme esto, todo en un solo mensaje:\n' + q.map((x, i) => `${E[i]} ${x}`).join('\n'); };
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
  ${goalSelect(true)}<div class="text-xs text-zinc-500 mt-1">🔒 Al calcular, el tipo de dieta queda fijo: definición 10 semanas · volumen 12 · mantenimiento 8.</div>
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
    ${S.nutritionChat.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${rich(m.text)}</div>`).join('')}
    ${S.nutritionBusy ? '<div class="coach-bubble assistant">Pensando una opción…</div>' : ''}
  </div>
  ${!ok ? `<div class="nutri-next mt-3">👉 ${esc(N.askFor(miss[0]))}</div>` : ''}
  <div class="quick-prompts">
    <button class="chip" data-act="nutritionprompt" data-msg="Organízame la semana: qué compro, qué cocino y cuándo, cómo lo porciono y cómo lo recalentamos">👩‍🍳 Organízame la semana</button>
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
      ${session.messages.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${rich(m.text)}</div>`).join('')}
    </details>`).join('')}
  </details>` : ''}
</div>
<div class="card"><div class="font-bold mb-1">${S.target ? '' : '2 · '}Respuestas rápidas</div><div class="text-xs text-zinc-500 mb-2">Toca para responder sin escribir. Todo lo marcado alimenta tu menú.</div>
  ${N.QUESTIONS.filter(q => q.req).map(nGroup).join('')}
  <details class="mt-2" ${N.QUESTIONS.filter(q => !q.req).some(q => (S.nutritionPreferences[q.k] || []).length) ? 'open' : ''}><summary class="text-sm text-zinc-400" style="min-height:40px;display:flex;align-items:center">Afinar más (restricciones, suplementos, obstáculos)</summary>${N.QUESTIONS.filter(q => !q.req).map(nGroup).join('')}</details></div>
<button class="btn fill w-full" data-act="nutriplan" ${ok ? '' : 'disabled'}>${ok ? 'Ver mi plan nutricional →' : `Faltan ${miss.length} dato${miss.length > 1 ? 's' : ''} para abrir tu plan`}</button>`;
};
/* ---------- Plan: estrategia + menú semanal + compras ---------- */
/* El menú cambia SOLO cada semana: la semilla sale del número de semana (+ "Otra variante" del usuario). */
const weekNo = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / 864e5 / 7);
const weekSeed = mon => weekNo(mon) + (+mon.slice(0, 4) * 12 + +mon.slice(5, 7)) * 3 + (S.menuSeed || 0); // semana a semana + otro orden cada mes
const menuMonday = off => shiftIsoDate(mondayOf(today()), 7 * off);
const currentMenu = (off = 0) => N.generateMenu(nutritionTarget(), S.nutritionPreferences, weekSeed(menuMonday(off)));
const shortDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
const weekBanner = () => { const k = mondayOf(today()); if (!S.menuWeekSeen) { S.menuWeekSeen = k; store.set('menuWeekSeen', k); return ''; }
  return S.menuWeekSeen === k ? '' : `<div class="card on banner"><div class="font-bold">🔄 ¡Nueva semana, nuevo menú!</div><div class="text-sm text-zinc-400 mt-1">Cambié recetas y proteínas de esta semana (siempre con tus macros) y actualicé la lista de compras y la cocina del domingo.</div><button class="btn fill w-full mt-2" data-act="weekseen">Entendido</button></div>`; };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pdfCard = () => { if (!S.target || !N.ready(S.nutritionPreferences, true)) return ''; const done = S.pdfMonth === today().slice(0, 7), mes = MONTHS[+today().slice(5, 7) - 1];
  return `<div class="card ${done ? '' : 'on'} pdfcard"><div class="flex justify-between items-center gap-2"><div class="min-w-0"><div class="font-bold">📄 Plan de ${mes} en PDF</div><div class="text-xs text-zinc-400 mt-1">${done ? 'Ya lo descargaste este mes. El del próximo mes aparece aquí solo.' : '4 semanas de recetas, horarios, entrenos y lista de compras por semana.'}</div></div><button class="btn ${done ? 'ghost' : 'fill'} !px-3" data-act="pdfmonth">${done ? 'Otra vez' : 'Descargar'}</button></div></div>`; };
const PREPTXT = { nevera: m => `Nevera · ${m} min`, cocinar: m => `Cocinar · ${m} min`, rapido: m => `Rápido · ${m} min`, fuera: () => 'Restaurante' };
/** Datos del PDF mensual: 4 semanas con menú, horarios, entrenos, compras y cocina. */
function monthData() {
  const t = nutritionTarget(), prefs = S.nutritionPreferences, mon0 = shiftIsoDate(mondayOf(today()), [0, 6].includes(new Date().getDay()) ? 7 : 0), sch = S.trainingSchedule, hasPlan = !!S.trainingPlan?.length;
  const DN = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const weeks = [0, 1, 2, 3].map(w => {
    const mon = shiftIsoDate(mon0, 7 * w), menu = N.generateMenu(t, prefs, weekSeed(mon)), seen = new Set(); let trainN = 0;
    const days = menu.days.map((ms, i) => {
      const iso = shiftIsoDate(mon, i), ses = hasPlan ? routineSessionForDate(iso) : null; if (ses) trainN++;
      const meals = ms.map(m => { const first = !seen.has(m.id); seen.add(m.id);
        return { slot: m.slot, time: m.time ? fmtHour(m.time) : '', name: m.name, items: m.items.map(it => it.text).join(' · '), k: m.k, p: m.p, c: m.c, f: m.f, where: (PREPTXT[m.prep] || (() => ''))(m.mins), steps: first ? (m.steps || []) : [] }; });
      return { name: DN[i], date: shortDate(iso), train: ses ? `Entreno: ${ses.day}` : hasPlan ? 'Descanso' : '', meals, tot: meals.reduce((a, m) => ({ k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { k: 0, p: 0, c: 0, f: 0 }) };
    });
    return { label: `${shortDate(mon)} - ${shortDate(shiftIsoDate(mon, 6))}`, summary: `Meta diaria: ${t.kcal} kcal · P ${t.p} g · C ${t.c} g · G ${t.f} g${hasPlan ? ` · ${trainN} entrenos esta semana` : ''}. ${menu.notes.join(' ')}`,
      groceries: N.groceries(menu), cook: N.cookPlan(menu, prefs), days };
  });
  const end = shiftIsoDate(mon0, 27);
  return { name: PROFILES[profile] || 'Atleta', range: `${shortDate(mon0)} - ${shortDate(end)} ${end.slice(0, 4)}`, generated: `${shortDate(today())} ${today().slice(0, 4)}`, target: t,
    strategy: N.strategy({ target: t, prefs, goal: S.profile?.goal || 'maint', trainDays: sch?.days || 3 }), notes: [],
    training: hasPlan && sch ? `${sch.split || 'Rutina'} · ${sch.cycle ? `${sch.workDays} días entrenando y ${sch.restDays} de descanso` : `${sch.days} días por semana`}${S.trainingPreferences.goal ? ' · objetivo: ' + S.trainingPreferences.goal : ''}. Cada día del PDF indica qué te toca; si mueves un descanso en la app, el calendario se reacomoda solo.` : '', weeks };
}
function downloadPdf(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 6e4);
}
const fmtHour = t => { const [h, mi] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`; };
const PREP = { nevera: m => `🧊 Nevera · ${m} min`, cocinar: m => `🍳 ${m} min`, rapido: m => `⚡ ${m} min`, fuera: () => '🍽️ Restaurante' };
const planCards = () => {
  const wk = S.menuWeek || 0, prefs = S.nutritionPreferences, t = nutritionTarget(), menu = currentMenu(wk), day = Math.min(S.menuDay, 6), meals = menu.days[day] || [];
  const DN = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], tot = meals.reduce((a, m) => ({ k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { k: 0, p: 0, c: 0, f: 0 });
  const strat = N.strategy({ target: t, prefs, goal: S.profile?.goal || 'maint', trainDays: S.trainingSchedule?.days || 3 }), groc = N.groceries(menu);
  const cookHtml = N.cookPlan(menu, prefs).map(b => `<div class="mt-2"><div class="neon text-sm font-bold">${esc(b.day)} · ${esc(b.title)}</div><ul class="strat">${b.tasks.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
  const GL = { prot: 'Proteínas', supp: 'Suplementos', dairy: 'Lácteos', carb: 'Carbohidratos', veg: 'Verduras', fat: 'Grasas' };
  return `<div class="card on"><div class="font-bold text-lg">🎯 Tu estrategia</div><div class="text-xs text-zinc-500 mb-1">Hecha con tus respuestas · ${t.kcal} kcal · P ${t.p} · C ${t.c} · G ${t.f}</div>
    <ul class="strat">${strat.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
  ${weekBanner()}${pdfCard()}<div class="card"><div class="flex justify-between items-center gap-2"><div class="font-bold text-lg">🍽️ Menú de la semana</div><button class="chip !px-3" data-act="menuregen">🔄 Otra variante</button></div>
    <div class="weeknav"><button class="icon-btn" data-act="menuweek" data-n="-1" ${wk <= 0 ? 'disabled' : ''}>‹</button><div class="text-center"><b>${wk === 0 ? 'Esta semana' : wk === 1 ? 'Próxima semana' : `En ${wk} semanas`}</b><div class="text-xs text-zinc-500">${shortDate(menuMonday(wk))} - ${shortDate(shiftIsoDate(menuMonday(wk), 6))} · cambia solo cada lunes</div></div><button class="icon-btn" data-act="menuweek" data-n="1" ${wk >= 3 ? 'disabled' : ''}>›</button></div>
    <div class="daytabs">${DN.map((d, i) => `<button class="chip ${day === i ? 'on' : ''}" data-act="menuday" data-i="${i}">${d}</button>`).join('')}</div>
    ${meals.map((m, i) => `<div class="meal"><div class="flex justify-between items-start gap-2"><div class="min-w-0"><div class="text-xs neon uppercase">${m.slot}${m.time ? ` · 🕗 ${fmtHour(m.time)}` : ''}</div><div class="font-bold leading-tight">${esc(m.name)}</div></div><span class="mealtag">${(PREP[m.prep] || PREP.cocinar)(m.mins)}</span></div>
      <div class="text-sm text-zinc-400 mt-1">${m.items.map(it => esc(it.text)).join(' · ')}</div>
      ${(m.steps || []).length ? `<details class="mt-1"><summary class="text-sm neon" style="min-height:36px;display:flex;align-items:center">📖 Ver preparación</summary><ol class="strat" style="list-style:decimal;padding-left:18px">${m.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
      <div class="flex justify-between items-center mt-1"><span class="text-xs text-zinc-500">${m.k} kcal · P ${m.p} · C ${m.c} · G ${m.f}</span><button class="chip !px-3" data-act="mealadd" data-d="${day}" data-i="${i}">＋ Registrar</button></div></div>`).join('') || '<div class="text-sm text-zinc-500">No pude armar el menú con esas restricciones: amplía las proteínas o el tiempo.</div>'}
    <div class="text-xs text-zinc-400 mt-2">Día: <b class="text-white">${tot.k}</b> kcal · P ${tot.p} · C ${tot.c} · G ${tot.f} <span class="text-zinc-500">(meta ${t.kcal} · P ${t.p} · C ${t.c} · G ${t.f})</span></div>
    ${menu.notes.map(n => `<div class="text-xs text-zinc-500 mt-1">ℹ️ ${esc(n)}</div>`).join('')}
    ${menu.prep.length ? `<details class="mt-2"><summary class="text-sm" style="min-height:40px;display:flex;align-items:center">🧊 Qué preparar en la nevera</summary><ul class="strat">${menu.prep.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="text-xs text-zinc-500">Cocina por lotes (domingo y miércoles). Dura 3–4 días en nevera; congela el resto.</div></details>` : ''}</div>
  <div class="card"><details open><summary class="font-bold text-lg" style="min-height:40px;display:flex;align-items:center">👩‍🍳 Cómo organizar y cocinar la semana</summary>${cookHtml}</details></div>
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
    ${S.coachChat.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${rich(m.text)}</div>`).join('')}
  </div>
  <div class="quick-prompts">
    <button class="chip" data-act="coachprompt" data-msg="Quiero entrenar seis días, descansar uno y repetir PPL. Mi objetivo es hipertrofia y soy intermedio.">PPL · 6 días</button>
    <button class="chip" data-act="coachprompt" data-msg="Quiero una rutina torso/pierna de cuatro días. Soy principiante y busco hipertrofia.">Torso/pierna · 4 días</button>
    <button class="chip" data-act="coachprompt" data-msg="Quiero entrenar full body tres días por semana para ganar fuerza.">Full body · 3 días</button>
    ${planLockActive() ? '<button class="chip" data-act="resetplan">🧪 Reiniciar plan (pruebas)</button>' : ''}
  </div>
  <div class="coach-input-row">
    <input id="coach-input" type="text" placeholder="Objetivo, días, descansos, nivel…" maxlength="220">
    <button class="btn fill" data-act="coachsend">${S.coachBusy ? '…' : 'Enviar'}</button>
  </div>
  ${trainingChatHistory.length ? `<details class="coach-history"><summary>Conversaciones anteriores (${trainingChatHistory.length})</summary>
    ${trainingChatHistory.map(session => `<details class="coach-session"><summary>${new Date(session.endedAt).toLocaleString('es-ES')}</summary>
      ${session.messages.map(m => `<div class="coach-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${rich(m.text)}</div>`).join('')}
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
const fmtDay = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
const planInfo = iso => {
  if (!S.trainingConfigured || !S.trainingPlan.length) return '';
  const ses = routineSessionForDate(iso), nx = nextSession(iso), nxt = nx ? `${esc(fmtDay(nx.iso))} — ${esc(nx.ses.day)}` : '';
  return ses ? `<div class="text-xs text-zinc-400 mt-1">📌 Según tu plan este día te toca: <b class="text-white">${esc(ses.day)}</b>${nx ? ` · después: ${nxt}` : ''}</div>`
    : `<div class="text-xs text-zinc-400 mt-1">😴 Sin sesión este día${nx ? ` · próximo entreno: <b class="text-white">${nxt}</b>` : ''}</div>`;
};
const routineDayPanel = () => {
  const iso = S.routineDate, exercises = routineExercisesForDate(iso), rest = !!S.dayRest[iso];
  const date = new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const muscles = (S.dayMuscles[iso] || []).map(k => MUSCLES[k].n).join(' · ');
  return `<div class="card routine-day-panel">
    <div class="font-bold text-lg capitalize">${date}</div>
    <div class="text-sm neon">${rest ? '😴 Día de descanso' : exercises.length ? esc(muscles || 'Sesión personalizada') : 'Sin definir: elige Entreno o Descanso'}</div>
    ${planInfo(iso)}
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
  
  ${deloadCard()}
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
  ${goalSelect(false)}<div class="text-xs text-zinc-500 mt-1">🔒 Al calcular, el tipo de dieta queda fijo: definición 10 semanas · volumen 12 · mantenimiento 8.</div>
  <button class="btn fill w-full mt-2" data-act="profile">Calcular objetivos</button></div>` : '';
  if (!S.target) return `${tabs}${profileSetup}<div class="card text-sm text-zinc-400">Configura tus macros para abrir el plan. Tus hábitos y preferencias ya se guardaron desde el chat.</div>`;
  const b = budget(today()), sc = E.scale(S.target, b), m = S.macros, pv = S.preview;
  return `
${tabs}
${profileSetup}
${dietLockCard()}
<div class="card"><div class="font-bold">Hoy: ${m.k} / ${b} kcal${S.adj[today()] ? ` <span class="text-xs neon">(${S.adj[today()] > 0 ? '+' : ''}${S.adj[today()]} ajuste)</span>` : ''}</div>
  <div class="text-sm text-zinc-400">Quedan: <b class="text-white">${sc.kcal - m.k} kcal</b> · P ${sc.p - m.p} · C ${sc.c - m.c} · G ${sc.f - m.f}</div>
  <div class="h-2 bg-zinc-900 mt-2 rounded"><div class="h-2 rounded" style="width:${Math.min(100, m.k / b * 100)}%;background:#ff0033"></div></div></div>
${planCards()}
<div class="card"><div class="font-bold mb-2">¿Qué comiste? (la IA calcula)</div>
  <input id="meal" placeholder="${(LOCAL_MODE && !AI_ON) ? 'Ej: arroz y pollo 650 kcal 45p 70c 15g' : 'Ej: corrientazo con pollo, arroz y plátano, jugo de mora'}">
  <button class="btn fill w-full mt-2" data-act="analyze" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Analizando…' : ((LOCAL_MODE && !AI_ON) ? 'Registrar comida' : 'Analizar con IA')}</button>
  ${S.msg ? `<p class="text-sm text-red-400 mt-2">${esc(S.msg)}</p>` : ''}
  ${quickMeals()}
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
    badges: badgeState().tiers * 25,
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
const xpToast = b => { const a = totalXp(), bm = checkBadges(true); if (a <= b) return bm && toast(bm); const lb = levelOf(b), la = levelOf(a);
  toast((la > lb ? `🔥 ¡NIVEL ${la}! ${rankOf(la)} · +${a - b} XP` : `+${a - b} XP`) + (bm ? ' · ' + bm : '')); };
/* ---------- Logros y misiones: todo se calcula desde tus registros (nada se pierde) ---------- */
const TIERS = ['Bronce', 'Plata', 'Oro', 'Platino', 'Diamante'];
const BADGE_GROUPS = [
  { id: 'sess', ic: '🏋️', n: 'Constancia', d: 'Días entrenados', th: [1, 10, 30, 75, 150], v: c => c.trainDays },
  { id: 'sets', ic: '💪', n: 'Volumen', d: 'Series efectivas', th: [50, 300, 1000, 3000, 8000], v: c => c.sets },
  { id: 'ton', ic: '🏗️', n: 'Toneladas', d: 'Toneladas levantadas', th: [5, 25, 100, 300, 800], v: c => c.ton },
  { id: 'pr', ic: '🏆', n: 'Récords', d: 'PRs conseguidos', th: [1, 5, 15, 40, 100], v: c => c.prs },
  { id: 'streak', ic: '🔥', n: 'Racha', d: 'Mejor racha en días', th: [3, 7, 14, 30, 60], v: c => c.best },
  { id: 'meals', ic: '🍽️', n: 'Disciplina', d: 'Comidas registradas', th: [10, 50, 150, 400, 1000], v: c => c.meals },
  { id: 'macro', ic: '🎯', n: 'En la meta', d: 'Días dentro de tu meta', th: [3, 10, 30, 60, 120], v: c => c.onTarget },
  { id: 'water', ic: '💧', n: 'Hidratado', d: 'Días con 4 L de agua', th: [3, 10, 30, 60, 120], v: c => c.water },
  { id: 'weigh', ic: '⚖️', n: 'Control', d: 'Pesajes', th: [2, 8, 20, 50, 100], v: c => c.weigh },
  { id: 'perfect', ic: '⭐', n: 'Semana perfecta', d: 'Semanas con todas las misiones', th: [1, 3, 8, 16, 32], v: c => c.perfect },
];
function missionsFor(mon, c) {
  const days = Array.from({ length: 7 }, (_, i) => shiftIsoDate(mon, i)), tl = S.trainingPlan?.length ? sessionTimeline(days[6]) : {};
  const planned = days.filter(d => tl[d] != null).length, td = today();
  return [
    { ic: '🏋️', n: 'Entrena tus sesiones', v: days.filter(d => c.setsBy[d] > 0).length, t: Math.max(1, planned) },
    { ic: '🎯', n: 'Días dentro de tu meta de kcal', v: days.filter(d => d <= td && c.inTarget(d)).length, t: 5 },
    { ic: '💧', n: 'Días con 4 L de agua', v: days.filter(d => (S.hydra[d]?.ml || 0) >= WATER_ML).length, t: 5 },
    { ic: '⚖️', n: 'Pesajes', v: S.weights.filter(w => w.d >= days[0] && w.d <= days[6]).length, t: 2 },
  ];
}
const BC = { sig: '', c: null, st: null };
function badgeCtx() {
  const rows = allRows(), hist = Object.entries(S.macroHist), td = today();
  const sig = [rows.length, hist.length, hist.reduce((a, [, h]) => a + (h.n || 0) * 1000 + Math.round(h.k || 0), 0), S.weights.length, Object.keys(S.dayRest).length, Object.values(S.hydra).reduce((a, h) => a + h.ml, 0), td].join('|');
  if (BC.sig === sig && BC.c) return BC.c;
  const setsBy = {}; let sets = 0, kg = 0, prs = 0;
  for (const x of rows) { setsBy[x.d] = (setsBy[x.d] || 0) + 1; if (x.t !== 'w') { sets++; kg += x.w * x.r; } if (x.pr) prs++; }
  const inTarget = d => { const h = S.macroHist[d], b = histBudget(d); return !!(h && h.n > 0 && b && h.k >= .9 * b && h.k <= 1.1 * b); };
  const act = [...new Set([...Object.keys(setsBy), ...Object.keys(S.dayRest).filter(d => d <= td), ...hist.filter(([, h]) => h.n > 0).map(([d]) => d)])].sort();
  let best = 0, run = 0; act.forEach((d, i) => { run = i && Math.round((Date.parse(d) - Date.parse(act[i - 1])) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); });
  const c = { setsBy, sets, ton: Math.round(kg / 1000), prs, trainDays: Object.keys(setsBy).length, best, meals: hist.reduce((n, [, h]) => n + (h.n || 0), 0), inTarget,
    onTarget: hist.filter(([d]) => d < td && inTarget(d)).length, water: Object.values(S.hydra).filter(h => h.ml >= WATER_ML).length, weigh: S.weights.length, perfect: 0 };
  const first = [...Object.keys(setsBy), ...S.weights.map(w => w.d)].sort()[0];
  if (first) for (let m = mondayOf(first), g = 0; m <= mondayOf(td) && g < 80; m = shiftIsoDate(m, 7), g++) if (missionsFor(m, c).every(x => x.v >= x.t)) c.perfect++;
  BC.sig = sig; BC.c = c; BC.st = null; return c;
}
function badgeState() {
  const c = badgeCtx(); if (BC.st) return BC.st;
  const groups = BADGE_GROUPS.map(g => { const val = g.v(c), tier = g.th.filter(t => val >= t).length, prev = g.th[tier - 1] || 0, next = g.th[tier] ?? null;
    return { ...g, val, tier, next, pct: next == null ? 100 : Math.max(0, Math.round((val - prev) / (next - prev) * 100)) }; });
  return (BC.st = { groups, tiers: groups.reduce((a, g) => a + g.tier, 0), max: BADGE_GROUPS.length * 5 });
}
function checkBadges(announce) {
  const cur = badgeState().groups.flatMap(g => TIERS.slice(0, g.tier).map((_, i) => `${g.id}:${i + 1}`));
  if (!S.badgesSeen) { S.badgesSeen = cur; store.set('badgesSeen', cur); return ''; }
  const fresh = cur.filter(k => !S.badgesSeen.includes(k)); if (!fresh.length) return '';
  S.badgesSeen = cur; store.set('badgesSeen', cur); if (!announce) return '';
  const [id, t] = fresh.at(-1).split(':'), g = BADGE_GROUPS.find(x => x.id === id); navigator.vibrate?.([80, 40, 80, 40, 160]);
  return `🏅 Logro: ${g.n} ${TIERS[t - 1]}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`;
}
const missionsCard = () => { const ms = missionsFor(mondayOf(today()), badgeCtx()), done = ms.filter(m => m.v >= m.t).length;
  return `<div class="card"><div class="flex justify-between items-center"><div class="font-bold">🎯 Misiones de la semana</div><span class="mealtag">${done}/${ms.length}</span></div>
  ${ms.map(m => `<div class="mission ${m.v >= m.t ? 'ok' : ''}"><div class="flex justify-between text-sm gap-2"><span>${m.ic} ${m.n}</span><b>${Math.min(m.v, m.t)}/${m.t}${m.v >= m.t ? ' ✓' : ''}</b></div><div class="xpbar"><i style="width:${Math.min(100, m.v / m.t * 100)}%"></i></div></div>`).join('')}
  ${done === ms.length ? '<div class="text-xs neon mt-2">⭐ ¡Semana perfecta! Cuenta para tu logro «Semana perfecta».</div>' : '<div class="text-xs text-zinc-500 mt-2">Cumple las 4 y consigue una semana perfecta.</div>'}</div>`; };
const badgesCard = () => { const st = badgeState();
  return `<div class="card"><div class="flex justify-between items-center"><div class="font-bold">🏅 Logros</div><span class="mealtag">${st.tiers}/${st.max} · +25 XP c/u</span></div>
  <div class="badges">${st.groups.map(g => `<div class="badge t${g.tier}"><div class="bic">${g.ic}</div><div class="bn">${g.n}</div><div class="bt">${g.tier ? TIERS[g.tier - 1] : 'Bloqueado'}</div><div class="xpbar"><i style="width:${g.pct}%"></i></div><small>${g.next != null ? `${g.val} / ${g.next}` : '¡MÁX!'}</small></div>`).join('')}</div>
  <div class="text-xs text-zinc-500 mt-2">Cada logro sube de Bronce a Diamante. ${esc(st.groups.find(g => g.next != null)?.d || '')}: toca seguir sumando.</div></div>`; };
const rankIx = L => RANKS.filter(r => L >= r[0]).length - 1;
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
<div class="card on hero rk${rankIx(L)}"><div class="hero-row"><div class="ring" style="--p:${Math.round((x - a) / (nx - a) * 100)}"><div><b>${L}</b><small>NIVEL</small></div></div>
  <div class="hero-info"><div class="text-xs text-zinc-500 uppercase tracking">Rango</div><div class="rank-name">${rankOf(L)}</div>
    <div class="xpbar big mt-2"><i style="width:${Math.round((x - a) / (nx - a) * 100)}%"></i></div>
    <div class="text-xs text-zinc-400 mt-1">${x - a} / ${nx - a} XP para el nivel ${L + 1}${RANKS.find(r => r[0] > L) ? ` · ${RANKS.find(r => r[0] > L)[1]} en nivel ${RANKS.find(r => r[0] > L)[0]}` : ' · rango máximo'}</div></div></div>
  <div class="stat3"><div><b>${st}🔥</b><span>racha</span></div><div><b>${badgeState().tiers}</b><span>logros</span></div><div><b>${prs}</b><span>PRs (7 d)</span></div><div><b>${x}</b><span>XP total</span></div></div>
  <button class="btn fill w-full mt-3" data-act="startworkout">🔥 INICIAR ENTRENAMIENTO</button>
  <div class="text-xs text-zinc-400 mt-2">XP por: series ${br.sets} · días entrenados ${br.train} · comida ${br.meals + br.target} · ejercicios terminados ${br.done} · peso ${br.weigh} · descansos ${br.rest} · logros ${br.badges}</div>
  <details class="mt-2 text-sm text-zinc-400"><summary>Cómo gano XP</summary>Serie +10 (+3 si RIR 0-1, +5 drop set; calentamiento +3) · ejercicio terminado +10 · PR +50 · día entrenado +40 · comida registrada +5 · día dentro de tu meta +25 · pesaje +15 · descanso marcado +10. Rangos: Novato, Agresivo (nv 5), Bestia (10), Titán (15), Élite (25), Leyenda (40).</details></div>
${goalBar()}
${missionsCard()}
${badgesCard()}
${pdfCard()}
<div class="card"><div class="font-bold">Hoy · ${state}</div>
  ${S.target ? `<div class="text-sm text-zinc-400 mt-1">${m.k} / ${b} kcal · P ${m.p} · C ${m.c} · G ${m.f}</div><div class="h-2 bg-zinc-900 mt-2 rounded"><div class="h-2 rounded" style="width:${Math.min(100, b ? m.k / b * 100 : 0)}%;background:#ff2b57"></div></div>` : '<div class="text-sm text-zinc-500 mt-1">Configura tu perfil en Nutrición para ver tus calorías.</div>'}</div>
${hydraCard()}
<div class="card"><div class="flex justify-between items-center"><div class="font-bold">Esta semana · series por día</div><button class="chip !px-3" data-act="titan">📊 Reporte</button></div>${bars(sets7, lab)}
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
  if (m.type === 'acr') { const g = GLOSSARY[m.k];
    return `<div class="sheet"><div><div class="text-xs text-zinc-500 uppercase tracking">Significado</div><div class="font-bold text-lg neon">${esc(m.k)} · ${esc(g.n)}</div><div class="text-sm mt-2">${esc(g.d)}</div>${g.p ? `<div class="text-sm mt-2">🎯 Te conviene si ${esc(g.p)}</div>` : ''}${g.a ? `<div class="text-sm text-zinc-400 mt-2">📲 En tu plan: ${esc(g.a)}</div>` : ''}<button class="btn ghost w-full mt-3" data-act="closemodal">Cerrar</button></div></div>`; }
  if (m.type === 'titan') return titanSheet();
  if (m.type === 'aisetup') return `<div class="sheet"><div style="max-height:92vh;overflow:auto">
    <div class="text-xs text-zinc-500 uppercase tracking">Paso importante</div>
    <div class="font-bold text-xl neon">🤖 Conecta tu IA</div>
    <div class="text-sm text-zinc-300 mt-2">Con una clave de IA tu entrenador y tu nutricionista arman rutinas y dietas a tu medida, recuerdan lo que les cuentas y ajustan el plan contigo. Sin clave la app funciona, pero con respuestas más básicas.</div>
    <div class="card on !p-2 mt-3 text-sm">✅ <b>No necesitas pagar.</b> Google Gemini tiene plan <b>gratis, sin tarjeta</b>, y es la opción recomendada. OpenAI (<b>sk-…</b>) también sirve, pero es de pago.</div>
    <details class="aihow mt-3" open><summary>🆓 Gratis: Google Gemini (recomendado)</summary>
      <ol class="strat" style="list-style:decimal;padding-left:20px">
        <li>Abre <a class="neon" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e inicia sesión con tu cuenta de Google.</li>
        <li>Toca <b>Create API key</b> (si te pide un proyecto, elige <b>Create API key in new project</b>).</li>
        <li><b>Copia la clave</b>: empieza con <b>AIza</b>. No pide tarjeta ni saldo.</li>
        <li>Pégala abajo y toca <b>Conectar</b>.</li></ol>
      <div class="text-xs text-zinc-500">El plan gratis tiene un tope de consultas por minuto y por día (suficiente para tu uso normal; si lo alcanzas, la app espera y reintenta). En el plan gratis Google puede usar lo que escribas para mejorar sus productos: no pongas datos que no quieras compartir.</div></details>
    <details class="aihow mt-2"><summary>💳 De pago: OpenAI (sk-…)</summary>
      <ol class="strat" style="list-style:decimal;padding-left:20px">
        <li>Entra a <a class="neon" href="https://platform.openai.com/signup" target="_blank" rel="noopener">platform.openai.com</a> y crea tu cuenta.</li>
        <li>OpenAI ya no regala créditos: en <b>Settings → Billing</b> hay que cargar un saldo prepago (el mínimo suele ser unos 5 USD).</li>
        <li>En <a class="neon" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> toca <b>Create new secret key</b>, cópiala (solo se muestra una vez) y pégala abajo.</li></ol></details>
    <div class="text-xs text-zinc-500 mt-2">🔒 La clave se guarda solo en este dispositivo. No la compartas. Puedes cambiarla o borrarla en el botón 🤖 IA.</div>
    <input id="aikey-in" class="mt-3" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pega aquí tu clave (AIza… o sk-…)">
    <button class="btn fill w-full mt-3" data-act="aikeysave">Conectar</button>
    <button class="btn ghost w-full mt-2" data-act="aikeylater">Más tarde</button></div></div>`;
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
    : !S.onboarded ? onboardingView() + sheet() + restBar() + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '')
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
  resetplan() { if (!confirm('¿Reiniciar el plan de entrenamiento? Solo para pruebas: se quita el bloqueo y vuelve la configuración inicial.')) return; S.planLock = null; S.coachPending = null; S.trainingOnboarded = false; delete S.trainingPreferences.lastWorkout; store.set('planLock', null); store.set('coachPending', null); store.set('trainingOnboarded', false); store.set('trainingPreferences', S.trainingPreferences); toast('Plan desbloqueado'); },
  dietreset() { if (!confirm('¿Reiniciar la dieta? Solo para pruebas: se borra el bloqueo y tus macros calculados.')) return; S.dietLock = null; S.target = null; S.profile = null; store.set('dietLock', null); persist('profile', 'target'); toast('Dieta reiniciada'); },
  aikey() {
    if (!hasAiKey()) { S.modal = { type: 'aisetup' }; return; }
    const k = prompt(hasAiKey() ? 'Ya hay una clave guardada. Pega una nueva, o deja vacío y acepta para BORRARLA:' : 'Pega tu clave de IA (Gemini: AIza… gratis · OpenAI: sk-…). Se guarda solo en este dispositivo:');
    if (k === null) return; const t = k.trim();
    if (t && !validKey(t)) return alert('Esa clave no parece válida: debe empezar con AIza (Gemini) o sk- (OpenAI).');
    setAiKey(t); toast(t ? '🤖 Verificando la clave…' : 'IA desconectada');
    if (t) pickModel(true).then(m => { toast(m ? `🤖 IA conectada · ${aiProvider()} · ${m}` : '⚠️ No pude verificar la clave: revisa que esté completa y que tengas conexión'); render(); }).catch(() => {});
  },
  aikeysave() {
    const t = ($('#aikey-in')?.value || '').trim();
    if (!validKey(t)) return alert('Esa clave no parece válida: debe empezar con AIza (Gemini) o sk- (OpenAI) y estar completa.');
    setAiKey(t); store.set('aiAsked', true); S.modal = null; toast('🤖 Verificando la clave…');
    pickModel(true).then(m => { toast(m ? `🤖 IA conectada · ${aiProvider()} · ${m}` : '⚠️ No pude verificar la clave: revisa que esté completa y que tengas conexión'); render(); }).catch(() => {});
  },
  aikeylater() { store.set('aiAsked', true); S.modal = null; toast('Puedes conectarla cuando quieras en el botón 🤖 IA'); },
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
  addroutineexercise() { if (planLockActive()) return lockedToast(); S.modal = { type: 'routineedit', date: S.routineDate, index: -1, value: '' }; },
  editroutineexercise(d) { if (planLockActive()) return lockedToast();
    const index = Number(d.index);
    S.modal = { type: 'routineedit', date: S.routineDate, index, value: routineExercisesForDate(S.routineDate)[index] || '' };
  },
  removeroutineexercise(d) { if (planLockActive()) return lockedToast();
    const date = S.routineDate, exercises = [...routineExercisesForDate(date)];
    exercises.splice(Number(d.index), 1); S.customDay[date] = true; store.set('customDay', S.customDay);
    S.routineEdits[date] = exercises;
    store.set('routineEdits', S.routineEdits);
  },
  saveRoutineExercise() { if (planLockActive()) return lockedToast();
    const name = ($('#routine-exercise')?.value || '').trim();
    if (!name) return;
    const { date, index } = S.modal, exercises = [...routineExercisesForDate(date)];
    if (index < 0) exercises.push(name); else exercises[index] = name; S.customDay[date] = true; store.set('customDay', S.customDay);
    S.routineEdits[date] = exercises;
    store.set('routineEdits', S.routineEdits);
    S.modal = null;
  },
  exercisevideo(d) {
    const name = d.exercise || routineExercisesForDate(S.routineDate)[Number(d.index)] || 'Ejercicio';
    S.modal = { type: 'exercisevideo', name, motion: exerciseMotionType(name), loading: true, media: null, ytLoading: !!S.ytkey };
    loadExMedia(name); loadYT(name);
  },
  closemodal() { if (S.modal?.type === 'titan') store.set('titanSeen', today()); S.modal = null; },
  acr(d) { if (GLOSSARY[d.k]) S.modal = { type: 'acr', k: d.k }; },
  dellast(d) { const l = S.logs[d.id]; if (l?.length && confirm('¿Borrar la última serie de este ejercicio?')) { l.pop(); store.set('logs', S.logs); } },
  delmeal(d) { const i = +d.i, x = S.meals[i]; if (!x || !confirm('¿Borrar esta comida?')) return; for (const k of ['k', 'p', 'c', 'f']) S.macros[k] = Math.max(0, S.macros[k] - (x[k] || 0)); S.meals.splice(i, 1); persist('macros', 'meals'); },
  ytsave() { const k = ($('#ytkey')?.value || '').trim(); if (k.length < 20) return alert('Pega la clave completa'); S.ytkey = k; store.set('ytkey', k); if (S.modal?.type === 'exercisevideo') { S.modal = { ...S.modal, ytLoading: true, ytErr: '' }; loadYT(S.modal.name); } },
  ytclear() { S.ytkey = ''; S.ytcache = {}; store.set('ytkey', ''); store.set('ytcache', {}); if (S.modal) S.modal = { ...S.modal, yt: null, ytErr: '', ytLoading: false }; },
  ytnext() { const m = S.modal, i = (m.ytI + 1) % m.ytList.length; S.modal = { ...m, ytI: i, yt: m.ytList[i] }; },
  daymuscle(d) { if (planLockActive()) return lockedToast(); const a = S.dayMuscles[S.routineDate] || (S.dayMuscles[S.routineDate] = []), i = a.indexOf(d.k); i >= 0 ? a.splice(i, 1) : a.push(d.k); store.set('dayMuscles', S.dayMuscles); },
  daytype(d) { // descanso/entreno manual: la secuencia del plan se reacomoda sola (ver sessionTimeline)
    const iso = S.routineDate, planned = S.trainingConfigured && S.trainingPlan.length;
    if (d.t === 'rest') { S.dayRest[iso] = true; S.manualRest[iso] = true; delete S.manualTrain[iso]; delete S.customDay[iso]; }
    else { delete S.dayRest[iso]; delete S.manualRest[iso]; if (planned && !routineSessionForDate(iso)) S.manualTrain[iso] = true; }
    ['dayRest', 'manualRest', 'manualTrain', 'customDay'].forEach(k => store.set(k, S[k]));
    if (planned) { applyPlanToCalendar(0); const nx = nextSession(iso); toast(d.t === 'rest' ? `😴 Descanso guardado${nx ? ` · próximo: ${fmtDay(nx.iso)} — ${nx.ses.day}` : ''}` : '🏋️ Día de entreno'); }
  },
  daypreset(d) { if (planLockActive()) return lockedToast(); S.dayMuscles[S.routineDate] = [...PRESETS[d.p]]; store.set('dayMuscles', S.dayMuscles); },
  daygenerate() { if (planLockActive()) return lockedToast();
    const ks = S.dayMuscles[S.routineDate] || []; if (!ks.length) return alert('Elige al menos un músculo');
    delete S.dayRest[S.routineDate]; store.set('dayRest', S.dayRest);
    S.routineEdits[S.routineDate] = strategicOrder(ks).flatMap(k => CATALOG[k]); delete S.doneEx[S.routineDate]; store.set('doneEx', S.doneEx);
    S.open = exByName(S.routineEdits[S.routineDate][0])?.id || null; store.set('routineEdits', S.routineEdits); S.customDay[S.routineDate] = true; store.set('customDay', S.customDay);
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
    S.rest = Date.now() + rp.sec * 1000; S.restWhy = rp.why; S.fresh = m.id; S.modal = null; celebrate(m.id, isPR && !raveOn()); xpToast(xb);
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
    S.rest = Date.now() + rp.sec * 1000; S.restWhy = rp.why; celebrate(id, false); xpToast(xb);
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
    if (AI_ON || CONFIG_OK) return nutritionAI(text, input); // la IA decide qué falta y qué guardar
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
          systemPrompt: 'Eres el coach de nutrición de AGRESSIVE LIFT. Haz preguntas de entrevista SOLO sobre los datos que aparezcan en missing; si missing está vacío el perfil ya está completo: no hagas entrevista, responde y organiza directo. Adapta cada recomendación al mensaje actual, preferencias guardadas y macros restantes; evita respuestas genéricas repetidas. No inventes macros exactos sin cantidades.',
          question: text, recentMessages: S.nutritionChat.slice(-8), cocina: (() => { try { return S.target ? N.cookPlan(currentMenu(0), S.nutritionPreferences).map(b => `${b.day} (${b.title}): ${b.tasks.join(' ')}`) : null; } catch { return null; } })(), horarioTrain: S.trainingSchedule ? { dias: S.trainingSchedule.weekdays, ultimo: S.trainingPreferences.lastWorkout || null } : null, goalGuide: S.trainingPreferences.goal && GOALS[S.trainingPreferences.goal] ? { goal: S.trainingPreferences.goal, nutri: GOALS[S.trainingPreferences.goal].nutri } : null, missing: N.missing(S.nutritionPreferences, !!S.target), target: nutritionTarget(), preferences: S.nutritionPreferences, conversation: S.nutritionChat.slice(-8),
          remaining: { kcal: remaining.kcal - S.macros.k, protein: remaining.p - S.macros.p,
            carbs: remaining.c - S.macros.c, fat: remaining.f - S.macros.f },
          style: STYLES[S.style][0], meals: S.meals.slice(-3).map(meal => meal.text) });
        reply = result.note || reply;
      } catch (e) { reply += '\n\n⚠️ La IA no respondió: ' + (e.message || e); }
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
  dietnew() { if (dietLockActive()) return; S.dietLock = null; S.target = null; S.profile = null; store.set('dietLock', null); persist('profile', 'target'); },
  menuregen() { S.menuSeed++; store.set('menuSeed', S.menuSeed); },
  menuweek(d) { S.menuWeek = Math.max(0, Math.min(3, (S.menuWeek || 0) + (+d.n || 0))); },
  weekseen() { S.menuWeekSeen = mondayOf(today()); store.set('menuWeekSeen', S.menuWeekSeen); },
  async pdfmonth() {
    if (!S.target || !N.ready(S.nutritionPreferences, true)) return toast('Primero completa tu plan nutricional');
    try { toast('📄 Generando tu plan del mes…'); render(); await new Promise(r => setTimeout(r, 30));
      downloadPdf(buildMonthPdf(monthData()), `AGRESSIVE-LIFT-plan-${today().slice(0, 7)}.pdf`);
      S.pdfMonth = today().slice(0, 7); store.set('pdfMonth', S.pdfMonth); toast('✅ PDF descargado: míralo en Descargas');
    } catch (e) { console.error(e); toast('⚠️ No pude crear el PDF: ' + (e.message || e)); }
    render();
  },
  mealadd(d) {
    const m = currentMenu(S.menuWeek || 0).days[+d.d]?.[+d.i]; if (!m) return;
    const xb = totalXp(); addMeal([{ k: m.k, p: m.p, c: m.c, f: m.f }], `${m.slot}: ${m.name}`); syncHist(); xpToast(xb); toast('🍽️ Comida registrada');
  },
  nutritionprompt(d) {
    const input = $('#nutrition-input');
    if (input) input.value = d.msg || '';
    return ACT.nutritionsend();
  },
  step(d) { const i = $('#' + d.f); i.value = Math.max(0, +((parseFloat(i.value) || 0) + +d.s).toFixed(1)); },
  uselast(d) { const w = $('#w-' + d.id), r = $('#r-' + d.id); if (w) w.value = d.w; if (r) r.value = d.r; },
  quickmeal(d) { const m = S.recentMeals[+d.i]; if (!m) return; const xb = totalXp(); addMeal([{ k: m.k, p: m.p, c: m.c, f: m.f }], m.text); syncHist(); xpToast(xb); navigator.vibrate?.(40); toast('⚡ Comida registrada'); },
  water(d) { const h = hyd(), was = h.ml >= WATER_ML; h.ml = Math.max(0, Math.min(10000, h.ml + +d.n)); setHyd(h); navigator.vibrate?.(25); if (!was && h.ml >= WATER_ML) { const bm = checkBadges(true); if (bm) setTimeout(() => toast(bm), 1800); } if (!was && h.ml >= WATER_ML) toast('💧 ¡Meta de agua cumplida!'); },
  creatine() { const h = hyd(); h.cr = !h.cr; setHyd(h); navigator.vibrate?.(25); if (h.cr) toast('💊 Creatina registrada'); },
  titan() { S.modal = { type: 'titan' }; },
  deloadstart() {
    S.deload = { start: today(), until: dAdd(6) }; store.set('deload', S.deload);
    if (S.planLock && dAdd(0) <= S.planLock.until) { S.planLock.until = shiftIsoDate(S.planLock.until, 7); store.set('planLock', S.planLock); } // la semana de descarga no consume el bloque
    toast('🌿 Descarga activa: 1 semana');
  },
  deloadskip() { S.deloadSkip = dAdd(7); store.set('deloadSkip', S.deloadSkip); },
  rest30() { S.rest += 3e4; }, restoff() { S.rest = 0; S.restWhy = ''; },
  style(d) { S.style = d.k; store.set('style', d.k); S.nutritionPreferences = { ...S.nutritionPreferences, style: d.k }; store.set('nutritionPreferences', S.nutritionPreferences); },
  profile() {
    const kg = val('pf-kg'), h = val('pf-h'), age = val('pf-a');
    if (!(kg > 30 && h > 120 && age > 13)) return alert('Completa peso, altura y edad');
    const goal = $('#pf-g').value; if (!DIET[goal]) return alert('Elige tu objetivo: definición, volumen o mantenimiento');
    if (dietLockActive() && S.dietLock.goal !== goal) return alert(`🔒 Tu dieta es ${DIET[S.dietLock.goal].n} hasta el ${fmtLong(S.dietLock.until)}. No se puede cambiar antes.`);
    S.profile = { h, age, sex: $('#pf-s').value, goal }; if (!dietLockActive()) { S.dietLock = makeDietLock(goal); store.set('dietLock', S.dietLock); }
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
  S.recentMeals = [{ text, k: Math.round(t.k), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) }, ...S.recentMeals.filter(m => m.text !== text)].slice(0, 3);
  // Si te pasas del presupuesto, el exceso se reparte (≤200 kcal/día, 3 días) para mantener déficit/superávit.
  const done = S.carried[today()] || 0, over = S.macros.k - budget(today()) - done;
  if (over > 0) { const c = E.carry(over); c.forEach((k, i) => addAdj(i + 1, -k)); S.carried[today()] = done + c.reduce((a, b) => a + b, 0);
    S.note = `Te pasaste ${Math.round(over)} kcal: recorto ${c.filter(Boolean).map(x => -x).join(' / ')} kcal los próximos días.`; }
  persist('macros', 'meals', 'adj', 'carried', 'recentMeals');
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
  const lwx = parseLastWorkout(t), named = parseWeekdays(t, lwx.wd), useNamed = named.length >= 2 && !restMatch;
  const days = useNamed ? named.length : daysMatch ? Number(daysMatch[1]) || numberWords[daysMatch[1]]
    : split === 'Torso/Pierna' ? 4 : split === 'Full Body' ? 3 : S.trainingSchedule.days;
  const explicit = !!daysMatch || !!split || useNamed;
  if (!explicit) return null;
  const cycle = !!restMatch;
  const restDays = cycle ? Number(restMatch[1]) || numberWords[restMatch[1]] || 1 : 7 - days;
  const schedule = {
    days, split: split || S.trainingSchedule.split || 'Push/Pull/Legs', cycle,
    workDays: days, restDays: Math.max(0, restDays), startDate: today(),
    named: useNamed, weekdays: useNamed ? named : days === 1 ? [1] : days === 2 ? [1, 4] : days === 3 ? [1, 3, 5]
      : days === 4 ? [1, 2, 4, 6] : days === 5 ? [1, 2, 3, 5, 6] : days === 6 ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6],
  };
  const goal = /fuerza|potencia/.test(t) ? 'fuerza' : /definicion|\bcut\b|cutting|bajar grasa|perder grasa|quemar grasa|secar|perder peso|bajar de peso/.test(t) ? 'definición' : /hipertrof|masa|musculo|\bbulk|(?:fase|etapa|ciclo)\s+de\s+volumen|(?:hacer|hago|quiero|en)\s+volumen|subir de peso|aumentar peso/.test(t) ? 'hipertrofia' : '';
  const level = /principiante|novato/.test(t) ? 'principiante' : /intermedio/.test(t) ? 'intermedio' : /avanzado/.test(t) ? 'avanzado' : '';
  if (goal) S.trainingPreferences.goal = goal;
  if (level) S.trainingPreferences.level = level;
  return { days, split: schedule.split, cycle, restDays: schedule.restDays, schedule, goal, level, lw: lwx };
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
  const g = GOALS[goalKey()];
  const tuned = s => ({ ...s, focus: `${s.focus} · ${g.rir}`,
    blocks: [...s.blocks.map((b, i) => /core|gemelo|brazos/i.test(b) ? b : b.replace(/\d+x\d+(?:-\d+)?/, i === 0 ? g.main : i === 1 ? g.sec : g.acc)), ...(g.finisher && S.trainingPreferences.level !== 'principiante' ? [g.finisher] : []), ...(g.cardio ? [g.cardio] : [])] });
  return Array.from({ length: days }, (_, i) => ({
    ...tuned(source[i % source.length]),
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
function applyPlanToCalendar(from = -14) {
  const level = S.trainingPreferences.level, perMuscle = level === 'principiante' ? 1 : 2;
  const hasLogs = iso => Object.values(S.logs).some(l => l.some(x => x.d === iso));
  for (let i = from; i < (S.planLock?.weeks ? S.planLock.weeks * 7 : 28); i++) {
    const iso = shiftIsoDate(today(), i);
    if (hasLogs(iso) || (i >= 0 && S.customDay[iso])) continue;
    if (i < 0) { if (S.manualRest[iso]) continue; delete S.dayMuscles[iso]; delete S.routineEdits[iso]; delete S.dayRest[iso]; delete S.doneEx[iso]; continue; }
    const ses = routineSessionForDate(iso);
    if (ses) {
      const ks = ses.m || musclesForSession(ses.day);
      S.dayMuscles[iso] = ks; delete S.dayRest[iso]; delete S.doneEx[iso];
      S.routineEdits[iso] = strategicOrder(ks).flatMap(k => CATALOG[k].slice(0, perMuscle));
    } else { delete S.dayMuscles[iso]; delete S.routineEdits[iso]; S.dayRest[iso] = true; }
  }
  ['dayMuscles', 'routineEdits', 'dayRest', 'doneEx'].forEach(k => store.set(k, S[k]));
}

const planDetails = () => S.trainingPlan.map(day => `${day.day} (${day.focus}):\n• ${day.blocks.join('\n• ')}`).join('\n\n');
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
    return `Entendido. Ya que entrenas con este esquema de ${cadence}${profile ? ` (${profile})` : ''}, reestructuro tu rutina de la siguiente manera:\n\n${details}\n\nActualicé tu plan y llené el calendario con las semanas de tu plan con ejercicios por músculo${S.trainingPreferences.level === 'principiante' ? ' (1 ejercicio por músculo al empezar, para que construyas técnica)' : ''}.${S.trainingPreferences.injuries && S.trainingPreferences.injuries !== 'ninguna' ? ' Anoté tu molestia: si un ejercicio la agrava, usa Smart Swap para cambiarlo.' : ''}`;
  }
  if (!S.trainingConfigured) {
    const p = S.trainingPreferences;
    const known = [p.goal && `objetivo ${p.goal}`, p.level && `nivel ${p.level}`, p.place && `entrenas en ${p.place}`, p.duration && `sesión de ${p.duration}`, p.injuries && (p.injuries === 'ninguna' ? 'sin lesiones' : 'molestias anotadas')].filter(Boolean).join(' · ');
    const req = request || S.coachPending?.request;
    const missing = [!p.goal && 'tu objetivo (hipertrofia, fuerza o definición)', !p.level && 'tu nivel (principiante, intermedio o avanzado)', !req && 'cuántos días entrenas y cuántos descansas, y la división (PPL, torso/pierna o full body)', !p.injuries && 'si tienes alguna lesión o molestia'].filter(Boolean);
    return `${known ? `Anotado: ${known}. ` : ''}Para diseñar tu rutina aún necesito: ${missing.join('; ')}.`;
  }
  const schedule = `${S.trainingSchedule.days} días · ${S.trainingSchedule.split}`;
  if (/volumen|series|semana/.test(t)) return `Con tu esquema actual de ${schedule}, reparte las series entre las sesiones del plan y evita llevar todos los ejercicios al fallo. El detalle de cada día está en la pestaña Ejercicios.`;
  if (/recup|fatiga|descanso|sueño/.test(t)) return `Para tu esquema de ${schedule}, observa rendimiento, sueño y molestias entre sesiones. Si cae el rendimiento varios entrenamientos seguidos, reduce algunas series antes de añadir más días.`;
  if (/prior|hoy|ejercicio|pierna|legs|cuad|glute|pecho|push|hombro/.test(t)) return `Tu plan actual es ${schedule}. Revisa la sesión que corresponde en Ejercicios; prioriza el movimiento principal y conserva repeticiones en reserva si la técnica se degrada.`;
  if (planLockActive()) return lockMsg();
  return `Tengo registrado tu esquema de ${schedule}. Dime cuántos días quieres entrenar o qué división prefieres (PPL o Torso/Pierna) y actualizaré el plan y el calendario con ese cambio.`;
}

async function coachLocal(text, noAI = false) {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const goal = /fuerza|potencia/.test(normalized) ? 'fuerza' : /definicion|\bcut\b|cutting|bajar grasa|perder grasa|quemar grasa|secar|perder peso|bajar de peso/.test(normalized) ? 'definición' : /hipertrof|masa|musculo|\bbulk|(?:fase|etapa|ciclo)\s+de\s+volumen|(?:hacer|hago|quiero|en)\s+volumen|subir de peso|aumentar peso/.test(normalized) ? 'hipertrofia' : '';
  const level = /principiante|novato/.test(normalized) ? 'principiante' : /intermedio/.test(normalized) ? 'intermedio' : /avanzado/.test(normalized) ? 'avanzado' : '';
  const locked = planLockActive(), prefsBefore = { goal: S.trainingPreferences.goal, level: S.trainingPreferences.level };
  if (goal && !locked) S.trainingPreferences.goal = goal;
  if (level && !locked) S.trainingPreferences.level = level;
  if (/lesion|dolor|molestia|operad|tendinitis|hernia/.test(normalized)) S.trainingPreferences.injuries = text.slice(0, 160);
  if (/\bsin lesion|ninguna lesion|no tengo lesion/.test(normalized)) S.trainingPreferences.injuries = 'ninguna';
  if (/\bcasa\b|en casa/.test(normalized)) S.trainingPreferences.place = 'casa';
  else if (/gimnasio|\bgym\b/.test(normalized)) S.trainingPreferences.place = 'gimnasio';
  const dur = /(\d{2,3})\s*(?:min|minutos)/.exec(normalized) || /(\d(?:[.,]\d)?)\s*horas?/.exec(normalized);
  if (dur) S.trainingPreferences.duration = dur[0];
  let factsHit = !!dur;
  const kgM = /(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos?)\b/.exec(normalized); if (kgM) { S.trainingPreferences.bodyKg = parseFloat(kgM[1].replace(',', '.')); factsHit = true; }
  const hM = /\b(\d{3})\s*cm\b/.exec(normalized) || /\b(1[.,]\d{2})\s*(?:m|mts|metros)?\b/.exec(normalized);
  if (hM) { const v = parseFloat(hM[1].replace(',', '.')); S.trainingPreferences.heightCm = v < 3 ? Math.round(v * 100) : v; factsHit = true; }
  const ageM = /\b(\d{2})\s*anos?\b/.exec(normalized); if (ageM) { S.trainingPreferences.age = Number(ageM[1]); factsHit = true; }
  if (/\b(ninguna|ninguno|sin molestias?|ningun dolor|todo bien)\b/.test(normalized)) { S.trainingPreferences.injuries = 'ninguna'; factsHit = true; }
  if (S.trainingPreferences.injuries && /lesion|dolor|molestia|operad|tendinitis|hernia/.test(normalized)) factsHit = true;
  store.set('trainingPreferences', S.trainingPreferences);
  let request = parseTrainingRequest(text);
  const phNow = (!locked && (request || S.coachPending)) ? parsePhase(normalized) : null;
  if (phNow) { Object.assign(S.trainingPreferences, { phase: phNow.name, goal: phNow.goal, phaseDiet: phNow.diet }); store.set('trainingPreferences', S.trainingPreferences); factsHit = true; }
  const lwNow = parseLastWorkout(normalized), known = l => !!(l && (l.none || l.date || l.focus));
  let intake = false, finalLw = null, intakeQ = '';
  if (!locked && S.trainingOnboarded) { if (request) finalLw = known(lwNow) ? lwNow : (lastWorkoutFromLogs() || { none: true }); }
  else if (!locked) {
    const pend = S.coachPending, base = request || (pend ? pend.request : null);
    if (base) {
      const sch = base.schedule, nm = (!request && pend) ? parseWeekdays(normalized, lwNow.wd) : [];
      if (nm.length >= 2 && !sch.cycle) { Object.assign(sch, { days: nm.length, workDays: nm.length, weekdays: nm, named: true }); base.days = nm.length; }
      const gotInfo = !!request || known(lwNow) || nm.length >= 2 || factsHit;
      if (!gotInfo) { /* mensaje ajeno al cuestionario: sigue pendiente y responde normal */ }
      else {
        const tries = pend ? pend.tries : 0, lwBest = known(lwNow) ? lwNow : (pend && pend.lw) || null;
        const miss = missingIntake(), needLw = !known(lwBest), needDays = !sch.named && !sch.cycle, needPhase = needPhaseNow();
        if (((needLw || needPhase) && tries < 2) || ((miss.length || needDays) && tries < 1)) {
          intake = true; intakeQ = INTAKE_Q(tries === 0 ? miss : [], tries === 0 && needDays, needLw, needPhase);
          S.coachPending = { request: base, tries: tries + 1, lw: known(lwBest) ? lwBest : null };
        } else { request = base; finalLw = known(lwBest) ? lwBest : { none: true }; S.coachPending = null; }
      }
    }
    if (intake) request = null;
    store.set('coachPending', S.coachPending);
  }
  if (request && finalLw && !S.trainingOnboarded) { S.trainingOnboarded = true; store.set('trainingOnboarded', true); }
  const lockedAttempt = locked && !!request; // pidió cambiar el plan estando bloqueado
  if (locked) { S.trainingPreferences.goal = prefsBefore.goal; S.trainingPreferences.level = prefsBefore.level; request = null; }
  const previousReply = [...S.coachChat].reverse().find(message => message.role === 'assistant')?.text;
  let reply = lockedAttempt ? lockMsg() : intake ? intakeQ : coachReply(text, request);
  let startNote = '';
  if (request && finalLw) {
    const sch = S.trainingSchedule; sch.startDate = finalLw.date === today() ? shiftIsoDate(today(), 1) : today();
    for (const m of [S.manualRest, S.manualTrain]) for (const k of Object.keys(m)) if (k < sch.startDate) delete m[k];
    S.customDay = {}; ['manualRest', 'manualTrain', 'customDay'].forEach(k => store.set(k, S[k]));
    const firstIso = alignSchedule(sch, finalLw.focus ? nextAfter(finalLw.focus) : 0), first = routineSessionForDate(firstIso);
    S.trainingPreferences.lastWorkout = { date: finalLw.date || '', focus: finalLw.focus || '', none: !!finalLw.none };
    const lwTxt = finalLw.none ? 'llevas un tiempo sin entrenar' : `${finalLw.date ? fmtLong(finalLw.date) + ' · ' : ''}${FOCUS_TXT[finalLw.focus] || 'entrenamiento'}`;
    startNote = `📅 Tu último entrenamiento: ${lwTxt}. Empiezas el ${fmtLong(firstIso)}${first ? ' con ' + first.day : ''} y de ahí se arma todo el calendario:\n${calPreview()}`;
    reply += '\n\n' + startNote;
  }
  if (request) { S.planLock = makeLock(); store.set('planLock', S.planLock); reply += '\n\n' + goalNote(S.planLock.goal) + '\n\n' + lockMsg(true); }
  if (!(AI_ON || CONFIG_OK) && reply === previousReply && !request) {
    reply = `Sigo con tu esquema de ${S.trainingSchedule.days} días · ${S.trainingSchedule.split}. Dime qué detalle quieres ajustar y cambio ese punto.`;
  }
  const aiWillRun = !noAI && !!(AI_ON || CONFIG_OK) && !intake;
  S.coachChat.push({ role: 'user', text }, { role: 'assistant', text: aiWillRun ? '🤖 Pensando…' : reply });
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
  if (aiWillRun) {
    S.coachBusy = true; render();
    try {
      const result = await ai('coach', {
        task: 'training', planLock: planLockActive() ? S.planLock : null, goalGuide: { goal: goalKey(), ...GOALS[goalKey()] }, systemPrompt: TRAINER_SYSTEM_PROMPT, currentMessage: text,
        schedule: S.trainingSchedule, trainingPlan: S.trainingPlan, preferences: S.trainingPreferences,
        recentMessages: S.coachChat.slice(-8),
        intake, lastWorkout: S.trainingPreferences.lastWorkout || null, weekdays: S.trainingSchedule?.weekdays,
        instruccion: request ? 'El usuario acaba de pedir un plan NUEVO y la app ya lo generó (ver trainingPlan). Ten en cuenta su edad, el tiempo por sesión y cualquier molestia o lesión (trainingPreferences): si hay una zona con molestia, indica cómo adaptar o evitar esos ejercicios. Menciona dónde empieza (según su último entrenamiento y sus días) y que el calendario de abajo ya tiene las fechas. Explica en 4-6 líneas por qué esta estructura y estos rangos sirven para su objetivo y nivel, cómo progresar y cuándo comer/dormir alrededor del entreno. NO listes los ejercicios: la app los muestra debajo.'
          : lockedAttempt ? 'El usuario intenta cambiar el plan pero está BLOQUEADO (planLock). Explica con amabilidad por qué no se cambia, responde su duda y ofrece solo ajustes de carga, técnica, descanso o recuperación.'
          : 'Responde lo que preguntó el usuario usando su plan y objetivo actuales. El perfil ya está completo: NO repitas preguntas de entrevista (peso, estatura, edad, último entrenamiento, lesiones); usa lo guardado y sus registros.',
      });
      let out = String(result.note || '').trim() || reply;
      if (request) out += '\n\n📋 TU RUTINA:\n\n' + planDetails() + (startNote ? '\n\n' + startNote : '') + '\n\n' + goalNote(S.planLock.goal) + '\n\n' + lockMsg(true);
      else if (lockedAttempt) out += `\n\n🔒 Plan bloqueado hasta el ${fmtLong(S.planLock.until)}.`;
      S.coachChat[S.coachChat.length - 1] = { role: 'assistant', text: out };
      S.note = out;
    } catch (e) {
      S.coachChat[S.coachChat.length - 1] = { role: 'assistant', text: reply + '\n\n⚠️ La IA no respondió: ' + (e.message || e) };
    }
    S.coachBusy = false;
    S.coachChat = S.coachChat.slice(-60);
    store.set('coachChat', S.coachChat); store.set('note', S.note);
    render();
  }
}

/* ---------- v26: la IA decide (Action-Response). La app solo valida y ejecuta el command que devuelve. ---------- */
const DEFAULT_WD = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;
const hist = list => list.slice(-9).map(m => ({ role: m.role, text: String(m.text).slice(0, 1200) }));
function normPlan(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 7).map((x, i) => {
    const day = String(x?.day || `Día ${i + 1}`).slice(0, 60), blocks = (Array.isArray(x?.blocks) ? x.blocks : []).map(b => String(b).slice(0, 120)).filter(Boolean).slice(0, 8);
    const m = (Array.isArray(x?.muscles) ? x.muscles : []).map(k => String(k).toLowerCase()).filter(k => MUSCLES[k]);
    return { day, focus: String(x?.focus || '').slice(0, 100), blocks, m: m.length ? m : musclesForSession(day) };
  }).filter(x => x.blocks.length);
}
/** command update_routine → valida, guarda el plan, bloquea el bloque y llena el calendario. Devuelve la nota de inicio o null. */
function applyRoutineCommand(pl) {
  if (!pl || typeof pl !== 'object') return null;
  const plan = normPlan(pl.trainingPlan); if (!plan.length) return null;
  const sc = pl.schedule || {}, cycle = !!sc.cycle, tp = S.trainingPreferences;
  const wd = [...new Set((Array.isArray(sc.weekdays) ? sc.weekdays : []).map(Number).filter(v => Number.isInteger(v) && v >= 0 && v <= 6))].sort((a, b) => monFirst(a) - monFirst(b));
  const work = Math.max(1, Math.min(7, Math.round(+sc.workDays) || 3)), rest = Math.max(0, Math.min(6, Math.round(+sc.restDays) || 1));
  const days = cycle ? work : (wd.length || Math.max(1, Math.min(7, Math.round(+sc.days) || plan.length)));
  const pr = pl.preferences || {}, lw = pl.lastWorkout || {};
  const g = String(pr.goal || '').toLowerCase(); if (GOALS[g]) tp.goal = g;
  const lv = String(pr.level || '').toLowerCase(); if (['principiante', 'intermedio', 'avanzado'].includes(lv)) tp.level = lv;
  if (pr.injuries) tp.injuries = String(pr.injuries).slice(0, 160);
  if (pr.place) tp.place = /casa/i.test(pr.place) ? 'casa' : 'gimnasio';
  if (pr.duration) tp.duration = String(pr.duration).slice(0, 30);
  const ph = tp.goal !== 'fuerza' && PHASES.find(x => x[1] === String(pr.phase || '').toLowerCase()); if (ph) Object.assign(tp, { phase: ph[1], goal: ph[2], phaseDiet: ph[3] });
  const lwIso = ISO_RX.test(lw.date || '') ? lw.date : '', focus = FOCUS_RX[lw.focus] ? lw.focus : '';
  const schedule = { days, split: String(sc.split || 'Push/Pull/Legs').slice(0, 40), cycle, workDays: cycle ? work : days, restDays: cycle ? rest : 7 - days,
    startDate: ISO_RX.test(sc.startDate || '') && sc.startDate >= today() ? sc.startDate : (lwIso === today() ? shiftIsoDate(today(), 1) : today()),
    named: !cycle && wd.length >= 2, weekdays: cycle ? DEFAULT_TRAINING_SCHEDULE.weekdays : (wd.length ? wd : DEFAULT_WD[days]) };
  S.trainingPlan = plan; S.trainingSchedule = schedule;
  for (const m of [S.manualRest, S.manualTrain]) for (const k of Object.keys(m)) if (k < schedule.startDate) delete m[k];
  S.customDay = {};
  const si = Number.isInteger(pl.startIndex) && pl.startIndex >= 0 && pl.startIndex < plan.length ? pl.startIndex : (focus ? nextAfter(focus) : 0);
  const firstIso = alignSchedule(schedule, si), first = routineSessionForDate(firstIso);
  tp.lastWorkout = { date: lwIso, focus, none: !!lw.none };
  const lwTxt = lw.none ? 'llevas un tiempo sin entrenar' : `${lwIso ? fmtLong(lwIso) + ' · ' : ''}${FOCUS_TXT[focus] || 'entrenamiento'}`;
  const startNote = `📅 Tu último entrenamiento: ${lwTxt}. Empiezas el ${fmtLong(firstIso)}${first ? ' con ' + first.day : ''} y de ahí se arma todo el calendario:\n${calPreview()}`;
  Object.assign(S, { trainingConfigured: true, trainingOnboarded: true, coachPending: null, showRoutine: false, planLock: makeLock() });
  ['trainingConfigured', 'trainingOnboarded', 'trainingSchedule', 'trainingPlan', 'trainingPreferences', 'planLock', 'coachPending', 'manualRest', 'manualTrain', 'customDay'].forEach(k => store.set(k, S[k]));
  applyPlanToCalendar();
  return startNote;
}
async function sendCoachMessage(text) {
  if (!(AI_ON || CONFIG_OK)) return coachLocal(text, true); // sin IA: modo local por reglas
  if (S.coachBusy) return;
  S.coachChat.push({ role: 'user', text }, { role: 'assistant', text: '🤖 Pensando…' });
  S.coachChat = S.coachChat.slice(-60); store.set('coachChat', S.coachChat); S.coachBusy = true; render();
  const lock = planLockActive();
  try {
    const result = await ai('coach', { task: 'training', systemPrompt: TRAINER_SYSTEM_PROMPT, currentMessage: text,
      hoy: today(), diaSemana: new Date().toLocaleDateString('es-CO', { weekday: 'long' }), planConfigurado: S.trainingConfigured,
      planLock: lock ? S.planLock : null, schedule: S.trainingConfigured ? S.trainingSchedule : null, trainingPlan: S.trainingConfigured ? S.trainingPlan : null,
      calendario: S.trainingConfigured ? calPreview() : null, preferences: S.trainingPreferences, ultimoEntrenoRegistrado: lastWorkoutFromLogs(),
      goalGuide: S.trainingPreferences.goal && GOALS[S.trainingPreferences.goal] ? { goal: S.trainingPreferences.goal, ...GOALS[S.trainingPreferences.goal] } : null,
      recentMessages: hist(S.coachChat) });
    let out = String(result.note || '').trim() || 'Listo.';
    if (result.command === 'update_routine') {
      if (lock) out += '\n\n' + lockMsg();
      else { const sn = applyRoutineCommand(result.payload);
        out += sn ? '\n\n📋 TU RUTINA:\n\n' + planDetails() + '\n\n' + sn + '\n\n' + goalNote(S.planLock.goal) + '\n\n' + lockMsg(true) : '\n\n⚠️ No pude armar el plan con esos datos. Cuéntame de nuevo tus días y la división que prefieres.'; }
    }
    S.coachChat[S.coachChat.length - 1] = { role: 'assistant', text: out }; S.note = out; store.set('note', out);
  } catch (e) { // la IA falló: modo local por reglas + aviso
    S.coachChat.splice(-2); S.coachBusy = false; await coachLocal(text, true);
    const last = S.coachChat[S.coachChat.length - 1]; if (last) last.text += '\n\n⚠️ La IA no respondió (' + (e.message || e) + '); usé el modo local.';
  }
  S.coachBusy = false; S.coachChat = S.coachChat.slice(-60); store.set('coachChat', S.coachChat); render();
}
/** command update_macros → valida preferencias, perfil y macros (rangos sanos) y los guarda. */
function applyMacrosCommand(pl) {
  const notes = []; if (!pl || typeof pl !== 'object') return '';
  const wasReady = N.ready(S.nutritionPreferences, !!S.target), pr = pl.preferences;
  if (pr && typeof pr === 'object') {
    const p = { ...S.nutritionPreferences }; let ch = false;
    for (const q of N.QUESTIONS) { if (pr[q.k] == null) continue; const ok = q.opts.map(o => o[0]);
      if (q.multi) { const a = [].concat(pr[q.k]).map(String).filter(v => ok.includes(v)); if (a.length) { p[q.k] = a; ch = true; } }
      else if (ok.includes(String(pr[q.k]))) { p[q.k] = q.k === 'meals' ? +pr[q.k] : String(pr[q.k]); ch = true; if (q.k === 'style') { S.style = p.style; store.set('style', S.style); } } }
    if (ch) { S.nutritionPreferences = { ...p, updatedAt: new Date().toISOString() }; store.set('nutritionPreferences', S.nutritionPreferences); }
  }
  const pf = pl.profile;
  if (pf && typeof pf === 'object') {
    const kg = +pf.kg, h = +pf.h, age = +pf.age, sex = /^(f|mujer)/i.test(String(pf.sex || '')) ? 'f' : /^(m|h)/i.test(String(pf.sex || '')) ? 'm' : '';
    const gs = String(pf.goal || '').toLowerCase(), goal = DIET[gs] ? gs : /defin|cut|grasa/.test(gs) ? 'cut' : /volum|bulk|masa|musc/.test(gs) ? 'bulk' : /manten|maint/.test(gs) ? 'maint' : '';
    if (kg > 30 && kg < 300 && h > 120 && h < 230 && age > 13 && age < 100 && sex && goal) {
      let g = goal; if (dietLockActive() && S.dietLock.goal !== g) { g = S.dietLock.goal; notes.push(`🔒 Tu dieta sigue siendo ${DIET[g].n} hasta el ${fmtLong(S.dietLock.until)}.`); }
      S.profile = { h, age, sex, goal: g }; if (!dietLockActive()) { S.dietLock = makeDietLock(g); store.set('dietLock', S.dietLock); }
      S.weights = S.weights.filter(w => w.d !== today()).concat({ d: today(), kg }); if (!S.target) S.target = E.initial({ kg, ...S.profile });
      persist('profile', 'target', 'weights'); saveBody(S.user.id, { weight: kg });
    } else notes.push('⚠️ No pude guardar tu perfil: me faltan datos válidos de peso, estatura, edad, sexo u objetivo.');
  }
  const tg = pl.target;
  if (tg && typeof tg === 'object') {
    if (!S.profile) notes.push('⚠️ Para guardar tus macros necesito antes tu peso, estatura, edad y sexo.');
    else { const kg = S.weights.at(-1)?.kg || 70, base = E.initial({ kg, ...S.profile, goal: 'maint' }).kcal;
      const kcal = Math.round(Math.min(base * 1.25, Math.max(base * 0.75, +tg.kcal || S.target?.kcal || base))), asked = Math.round(+tg.kcal) || kcal;
      const p = Math.round(Math.min(3 * kg, Math.max(1.2 * kg, +tg.p || 2 * kg))), f = Math.round(Math.min(1.5 * kg, Math.max(0.5 * kg, +tg.f || 0.8 * kg)));
      S.target = { kcal, p, f, c: Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4)) }; persist('target');
      if (asked !== kcal) notes.push(`ℹ️ Ajusté las calorías a ${kcal} para mantenerlas en un rango seguro.`); }
  }
  if (!wasReady && N.ready(S.nutritionPreferences, !!S.target)) notes.push('✅ Ya puedes abrir «Tu Plan Nutricional».');
  return notes.join('\n');
}
async function nutritionAI(text, input) {
  S.nutritionChat.push({ role: 'user', text }); store.set('nutritionChat', S.nutritionChat);
  S.nutritionBusy = true; if (input) input.value = ''; render();
  let reply;
  try {
    const rem = E.scale(nutritionTarget(), budget(today()));
    const r = await ai('coach', { task: 'nutrition', currentMessage: text, hoy: today(), perfil: S.profile, pesoActual: S.weights.at(-1)?.kg ?? null, objetivoMacros: S.target, dietLock: dietLockActive() ? S.dietLock : null,
      systemPrompt: 'Eres el nutricionista real de AGRESSIVE LIFT: hablas como una persona, cercano y directo, en español y sin listas numeradas. Haz la entrevista de forma conversacional (UNA pregunta por turno, sin repetir lo ya respondido) y guarda con update_macros todo dato nuevo. Si faltanParaAbrirPlan está vacío, no hagas entrevista: responde y organiza directo. No inventes macros de una comida sin cantidades.',
      faltanParaAbrirPlan: N.missing(S.nutritionPreferences, !!S.target), preferences: S.nutritionPreferences,
      restante: { kcal: rem.kcal - S.macros.k, proteina: rem.p - S.macros.p, carbos: rem.c - S.macros.c, grasa: rem.f - S.macros.f }, estilo: STYLES[S.style][0], comidasHoy: S.meals.slice(-3).map(m => m.text),
      cocina: (() => { try { return S.target ? N.cookPlan(currentMenu(0), S.nutritionPreferences).map(b => `${b.day} (${b.title}): ${b.tasks.join(' ')}`) : null; } catch { return null; } })(),
      horarioTrain: S.trainingSchedule ? { dias: S.trainingSchedule.weekdays, ultimo: S.trainingPreferences.lastWorkout || null } : null,
      goalGuide: S.trainingPreferences.goal && GOALS[S.trainingPreferences.goal] ? { goal: S.trainingPreferences.goal, nutri: GOALS[S.trainingPreferences.goal].nutri } : null,
      recentMessages: hist(S.nutritionChat) });
    reply = String(r.note || '').trim() || 'Listo.';
    if (r.command === 'update_macros') { const n = applyMacrosCommand(r.payload); if (n) reply += '\n\n' + n; }
  } catch (e) { // la IA falló: reglas locales + aviso
    const parsed = N.parse(text, S.nutritionPreferences); if (parsed.prefs.style) { S.style = parsed.prefs.style; store.set('style', S.style); }
    S.nutritionPreferences = { ...parsed.prefs, lastUpdate: text, updatedAt: new Date().toISOString() }; store.set('nutritionPreferences', S.nutritionPreferences);
    reply = nutritionReply(text, parsed.changed) + '\n\n⚠️ La IA no respondió: ' + (e.message || e);
  }
  S.nutritionChat.push({ role: 'assistant', text: reply }); S.nutritionChat = S.nutritionChat.slice(-40);
  S.nutritionBusy = false; store.set('nutritionChat', S.nutritionChat); render();
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
  await f(el.dataset); restSync();
  if (S.screen === 'app') render();
});
document.addEventListener('keydown', e => {
  const el = e.target.closest?.('.muscle-region');
  if (!el || !['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  toggleMuscle(el.dataset.k);
  render();
});

/* v25: migración única. Conserva lo que hoy muestra tu calendario y convierte los descansos que marcaste a mano
   (días de descanso donde tu plan decía entrenar) en descansos "reales" que reacomodan la secuencia. */
function migrateCalendar() {
  if (store.get('calV25')) return; store.set('calV25', 1);
  if (!S.trainingConfigured || !S.trainingPlan.length) return;
  const sch = S.trainingSchedule, n = S.trainingPlan.length;
  for (let i = 0; i < 21; i++) {
    const iso = shiftIsoDate(today(), i), raw = legacyRaw(iso, sch); if (raw === null) continue;
    const old = (raw + (sch.offset || 0)) % n, prev = sch.offset || 0; sch.offset = 0;
    const s0 = sessionTimeline(iso, sch)[iso];
    sch.offset = s0 == null ? prev : (((old - s0) % n) + n) % n; break;
  }
  for (const iso of Object.keys(S.dayRest)) if (iso >= today() && S.dayRest[iso] && routineSessionForDate(iso)) S.manualRest[iso] = true;
  ['trainingSchedule', 'manualRest'].forEach(k => store.set(k, S[k]));
  applyPlanToCalendar(0);
}

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
try { migrateCalendar(); } catch (e) { console.error(e); }
try { if (!S.menuWeekSeen) { S.menuWeekSeen = mondayOf(today()); store.set('menuWeekSeen', S.menuWeekSeen); } checkBadges(false); } catch (e) { console.error(e); }
if (hasAiKey()) pickModel().then(() => render()).catch(() => {});
maybeTitan();
if (LOCAL_MODE && !hasAiKey() && !store.get('aiAsked') && !S.modal) S.modal = { type: 'aisetup' }; // primer inicio: pedir la clave de IA
render();
window.__ok = 1;
