// Base de ejercicios + lógica pura (sin DOM) para: Smart Swap, peso sugerido, descanso inteligente,
// recuperación entre días y curva de niveles. Todo testeable en Node.
export const LABEL = { pecho: 'Pecho', espalda: 'Espalda', hombros: 'Hombro', biceps: 'Bíceps', triceps: 'Tríceps', core: 'Core', cuads: 'Cuádriceps', isquios: 'Isquios', gluteos: 'Glúteo', gemelos: 'Gemelo' };
export const EQ = { maquina: 'Máquina', mancuerna: 'Mancuernas', polea: 'Polea', barra: 'Barra', smith: 'Smith', peso: 'Peso corporal' };
const slug = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* [nombre, músculo, equipo, rol (c=compuesto, i=aislamiento), patrón, carga relativa, series, reps, clase de descanso (H/M/L/S), banderas (u=por mano, b=peso corporal)]
   "carga relativa": 1 = ejercicio de referencia del músculo; sirve para convertir el peso de un ejercicio a otro. Es una ESTIMACIÓN de partida. */
const ROWS = [
  ['Press inclinado con mancuernas', 'pecho', 'mancuerna', 'c', 'hpress', 1, 4, '8-10', 'M', 'u'],
  ['Press plano con mancuernas', 'pecho', 'mancuerna', 'c', 'hpress', 1.1, 4, '8-10', 'M', 'u'],
  ['Press de pecho en máquina', 'pecho', 'maquina', 'c', 'hpress', 1.9, 4, '8-12', 'M'],
  ['Press inclinado en máquina', 'pecho', 'maquina', 'c', 'hpress', 1.7, 4, '8-12', 'M'],
  ['Press banca con barra', 'pecho', 'barra', 'c', 'hpress', 2.3, 4, '6-10', 'H'],
  ['Press en Smith inclinado', 'pecho', 'smith', 'c', 'hpress', 2.0, 4, '8-10', 'M'],
  ['Flexiones', 'pecho', 'peso', 'c', 'hpress', 0, 3, '10-20', 'M', 'b'],
  ['Aperturas en polea', 'pecho', 'polea', 'i', 'fly', 0.45, 3, '12-15', 'L', 'u'],
  ['Aperturas con mancuernas', 'pecho', 'mancuerna', 'i', 'fly', 0.4, 3, '12-15', 'L', 'u'],
  ['Contractora (pec deck)', 'pecho', 'maquina', 'i', 'fly', 1.2, 3, '12-15', 'L'],
  ['Cruce de poleas', 'pecho', 'polea', 'i', 'fly', 0.4, 3, '12-15', 'L', 'u'],

  ['Jalón al pecho', 'espalda', 'polea', 'c', 'vpull', 1, 4, '8-12', 'M'],
  ['Jalón agarre cerrado', 'espalda', 'polea', 'c', 'vpull', 0.95, 4, '8-12', 'M'],
  ['Jalón unilateral en polea', 'espalda', 'polea', 'c', 'vpull', 0.5, 3, '10-12', 'M', 'u'],
  ['Dominadas asistidas', 'espalda', 'maquina', 'c', 'vpull', 0, 4, '6-10', 'M', 'b'],
  ['Remo con apoyo pectoral', 'espalda', 'maquina', 'c', 'hpull', 1, 4, '8-12', 'M'],
  ['Remo en polea baja', 'espalda', 'polea', 'c', 'hpull', 0.95, 4, '8-12', 'M'],
  ['Remo con mancuerna apoyado', 'espalda', 'mancuerna', 'c', 'hpull', 0.45, 3, '8-12', 'M', 'u'],
  ['Remo con barra', 'espalda', 'barra', 'c', 'hpull', 1.3, 4, '6-10', 'H'],
  ['Pullover en polea', 'espalda', 'polea', 'i', 'pullover', 0.45, 3, '12-15', 'L'],
  ['Pullover con mancuerna', 'espalda', 'mancuerna', 'i', 'pullover', 0.4, 3, '12-15', 'L'],

  ['Press militar en máquina', 'hombros', 'maquina', 'c', 'vpress', 1, 3, '8-10', 'M'],
  ['Press militar con mancuernas', 'hombros', 'mancuerna', 'c', 'vpress', 0.45, 3, '8-10', 'M', 'u'],
  ['Press Arnold', 'hombros', 'mancuerna', 'c', 'vpress', 0.38, 3, '8-12', 'M', 'u'],
  ['Press militar en Smith', 'hombros', 'smith', 'c', 'vpress', 0.95, 3, '8-10', 'M'],
  ['Elevaciones laterales en polea', 'hombros', 'polea', 'i', 'lat', 0.16, 4, '12-15', 'S', 'u'],
  ['Elevaciones laterales con mancuernas', 'hombros', 'mancuerna', 'i', 'lat', 0.25, 4, '12-15', 'S', 'u'],
  ['Lateral en máquina', 'hombros', 'maquina', 'i', 'lat', 0.6, 4, '12-15', 'S'],
  ['Pájaros con mancuernas', 'hombros', 'mancuerna', 'i', 'rear', 0.2, 3, '12-15', 'S', 'u'],
  ['Pec deck inverso', 'hombros', 'maquina', 'i', 'rear', 0.6, 3, '12-15', 'S'],
  ['Face pull', 'hombros', 'polea', 'i', 'rear', 0.5, 3, '12-15', 'S'],

  ['Curl inclinado con mancuernas', 'biceps', 'mancuerna', 'i', 'curl', 1, 3, '10-12', 'S', 'u'],
  ['Curl predicador', 'biceps', 'maquina', 'i', 'curl', 1.5, 3, '10-12', 'S'],
  ['Curl en polea', 'biceps', 'polea', 'i', 'curl', 1.5, 3, '10-12', 'S'],
  ['Curl martillo con mancuernas', 'biceps', 'mancuerna', 'i', 'curl', 1.15, 3, '10-12', 'S', 'u'],
  ['Curl con barra Z', 'biceps', 'barra', 'i', 'curl', 2, 3, '8-12', 'S'],
  ['Curl concentrado', 'biceps', 'mancuerna', 'i', 'curl', 0.9, 3, '10-12', 'S', 'u'],

  ['Press francés con barra Z', 'triceps', 'barra', 'i', 'triext', 0.95, 3, '8-10', 'S'],
  ['Extensión sobre la cabeza en polea', 'triceps', 'polea', 'i', 'triext', 0.8, 3, '10-12', 'S'],
  ['Extensión de tríceps con mancuerna', 'triceps', 'mancuerna', 'i', 'triext', 0.7, 3, '10-12', 'S'],
  ['Extensión de tríceps en polea', 'triceps', 'polea', 'i', 'tripush', 1, 3, '10-12', 'S'],
  ['Patada de tríceps en polea', 'triceps', 'polea', 'i', 'tripush', 0.35, 3, '12-15', 'S', 'u'],
  ['Fondos en máquina', 'triceps', 'maquina', 'c', 'tripress', 2.4, 3, '8-12', 'M'],
  ['Press cerrado en Smith', 'triceps', 'smith', 'c', 'tripress', 1.8, 3, '8-10', 'M'],

  ['Crunch en polea', 'core', 'polea', 'i', 'crunch', 1, 3, '12-15', 'S'],
  ['Crunch en máquina', 'core', 'maquina', 'i', 'crunch', 1.1, 3, '12-15', 'S'],
  ['Elevación de piernas colgado', 'core', 'peso', 'i', 'legraise', 0, 3, '10-15', 'S', 'b'],
  ['Elevación de rodillas en silla romana', 'core', 'peso', 'i', 'legraise', 0, 3, '10-15', 'S', 'b'],
  ['Plancha', 'core', 'peso', 'i', 'plank', 0, 3, '30-60 s', 'S', 'b'],
  ['Rueda abdominal', 'core', 'peso', 'i', 'roll', 0, 3, '8-12', 'S', 'b'],

  ['Prensa de piernas', 'cuads', 'maquina', 'c', 'squat', 1, 4, '8-12', 'H'],
  ['Hack squat', 'cuads', 'maquina', 'c', 'squat', 0.7, 4, '8-12', 'H'],
  ['Sentadilla en Smith', 'cuads', 'smith', 'c', 'squat', 0.5, 4, '8-12', 'H'],
  ['Sentadilla con barra', 'cuads', 'barra', 'c', 'squat', 0.45, 4, '6-10', 'H'],
  ['Sentadilla goblet', 'cuads', 'mancuerna', 'c', 'squat', 0.12, 3, '10-12', 'M'],
  ['Zancadas con mancuernas', 'cuads', 'mancuerna', 'c', 'lunge', 0.13, 3, '8-12', 'M', 'u'],
  ['Extensión de cuádriceps', 'cuads', 'maquina', 'i', 'quadext', 0.4, 3, '12-15', 'L'],
  ['Sissy squat', 'cuads', 'peso', 'i', 'quadext', 0, 3, '10-15', 'L', 'b'],

  ['Peso muerto rumano', 'isquios', 'barra', 'c', 'hinge', 1, 3, '8-10', 'H'],
  ['Peso muerto rumano con mancuernas', 'isquios', 'mancuerna', 'c', 'hinge', 0.35, 3, '8-10', 'H', 'u'],
  ['Hiperextensiones', 'isquios', 'peso', 'c', 'hinge', 0, 3, '10-15', 'M', 'b'],
  ['Curl femoral sentado', 'isquios', 'maquina', 'i', 'legcurl', 0.7, 4, '8-12', 'L'],
  ['Curl femoral tumbado', 'isquios', 'maquina', 'i', 'legcurl', 0.6, 3, '10-12', 'L'],
  ['Curl nórdico', 'isquios', 'peso', 'i', 'legcurl', 0, 3, '5-8', 'L', 'b'],

  ['Hip thrust', 'gluteos', 'barra', 'c', 'thrust', 1, 4, '8-12', 'H'],
  ['Hip thrust en máquina', 'gluteos', 'maquina', 'c', 'thrust', 0.9, 4, '8-12', 'H'],
  ['Puente de glúteo en Smith', 'gluteos', 'smith', 'c', 'thrust', 0.9, 4, '8-12', 'M'],
  ['Puente de glúteo con peso corporal', 'gluteos', 'peso', 'c', 'thrust', 0, 3, '15-20', 'M', 'b'],
  ['Sentadilla búlgara', 'gluteos', 'mancuerna', 'c', 'lunge', 0.15, 3, '8-10', 'M', 'u'],
  ['Step-up con mancuernas', 'gluteos', 'mancuerna', 'c', 'lunge', 0.18, 3, '8-12', 'M', 'u'],
  ['Patada de glúteo en polea', 'gluteos', 'polea', 'i', 'kick', 0.15, 3, '12-15', 'S', 'u'],
  ['Abducción en máquina', 'gluteos', 'maquina', 'i', 'abd', 0.5, 3, '12-20', 'S'],

  ['Gemelo de pie', 'gemelos', 'maquina', 'i', 'calf', 1, 4, '10-15', 'S'],
  ['Gemelo en prensa', 'gemelos', 'maquina', 'i', 'calf', 1.2, 4, '10-15', 'S'],
  ['Gemelo unilateral con mancuerna', 'gemelos', 'mancuerna', 'i', 'calf', 0.3, 3, '10-15', 'S', 'u'],
  ['Gemelo sentado', 'gemelos', 'maquina', 'i', 'calfsit', 0.6, 3, '12-20', 'S'],
];
export const EXDB = ROWS.map(([n, k, eq, role, pat, rel, sets, rng, rest, fl = '']) => ({
  id: 'c-' + slug(n), n, m: LABEL[k], k, eq, role, pat, rel, sets, rng, rest, uni: fl.includes('u'), bw: fl.includes('b') }));
export const BYID = Object.fromEntries(EXDB.map(e => [e.id, e]));
export const BYNAME = Object.fromEntries(EXDB.map(e => [slug(e.n), e]));
/** Selección por defecto de cada músculo (mismos nombres que antes: tus registros y PRs se conservan). */
export const DEFAULT_PICKS = {
  pecho: ['Press inclinado con mancuernas', 'Aperturas en polea'], espalda: ['Jalón al pecho', 'Remo con apoyo pectoral'],
  hombros: ['Press militar en máquina', 'Elevaciones laterales en polea'], biceps: ['Curl inclinado con mancuernas', 'Curl predicador'],
  triceps: ['Press francés con barra Z', 'Extensión de tríceps en polea'], core: ['Crunch en polea', 'Elevación de piernas colgado'],
  cuads: ['Prensa de piernas', 'Extensión de cuádriceps'], isquios: ['Peso muerto rumano', 'Curl femoral sentado'],
  gluteos: ['Hip thrust', 'Sentadilla búlgara'], gemelos: ['Gemelo de pie', 'Gemelo sentado'],
};
const bySlug = n => BYNAME[slug(n)];

/* ---------- Equipo disponible ---------- */
const HOME_OK = new Set(['mancuerna', 'peso']);
/** ¿Se puede hacer este ejercicio con lo que tiene la persona? place: 'gimnasio' | 'casa'; equip: lista de claves EQ que prefiere (vacía = todo). */
export const usable = (e, { place } = {}) => (place === 'casa' ? HOME_OK.has(e.eq) : true);
const prefScore = (e, equip = []) => (equip.length ? (equip.includes(e.eq) ? 2 : 0) : 0);

/** Elige n ejercicios de un músculo: 1.º compuesto principal y 2.º complementario/aislamiento, respetando equipo y lugar.
    picks = elecciones guardadas por la persona (ajuste de comodidad) que mandan sobre todo lo demás. */
export function pickExercises(k, n, { equip = [], place = 'gimnasio', picks = {}, avoid = [], variant = 0 } = {}) {
  const saved = (picks[k] || []).map(bySlug).filter(Boolean), def = DEFAULT_PICKS[k].map(bySlug);
  const fits = e => usable(e, { place }) && !avoid.includes(e.n);
  const rank = (cand, list) => [...list].sort((a, b) => prefScore(b, equip) - prefScore(a, equip) || (b.pat === cand.pat) - (a.pat === cand.pat) || (b.role === cand.role) - (a.role === cand.role));
  const out = [];
  for (let i = 0; i < 2; i++) {
    let cand = saved[i] && !avoid.includes(saved[i].n) ? saved[i] : def[i];
    const wrongEq = !saved[i] && equip.length && !equip.includes(cand.eq);
    if (!fits(cand) || wrongEq) {
      let pool = EXDB.filter(e => e.k === k && fits(e) && !out.includes(e) && e.role === cand.role);
      if (!pool.length) pool = EXDB.filter(e => e.k === k && fits(e) && !out.includes(e)); // ningún equivalente del mismo tipo: cualquier ejercicio seguro del músculo
      const better = rank(cand, pool)[0];
      if (better && (!fits(cand) || prefScore(better, equip) > prefScore(cand, equip))) cand = better;
    }
    if (out.includes(cand)) { const alt = rank(cand, EXDB.filter(e => e.k === k && fits(e) && !out.includes(e)))[0]; if (alt) cand = alt; }
    if (!out.includes(cand)) out.push(cand);
  }
  // Variante B/C: el mismo músculo en otra sesión del ciclo (Torso A/B, Cuerpo completo A/B/C) usa OTROS ejercicios equivalentes (mismo patrón, otro equipo/ángulo).
  if (variant > 0 && !saved.length) {
    const base = [...out], used = new Set(base.map(e => e.id));
    for (let i = 0; i < base.length; i++) {
      const pool = rank(base[i], EXDB.filter(e => e.k === k && fits(e) && !used.has(e.id) && e.role === base[i].role && !e.rear));
      const pick = pool[(variant - 1) % Math.max(1, pool.length)]; if (pick) { out[i] = pick; used.add(pick.id); }
    }
  }
  return out.slice(0, n).map(e => `${e.n} ${e.sets}×${e.rng}`);
}
/** Deltoide posterior: va con el día de EMPUJE (como en el ciclo 3+1 de CBum), nunca como "hombro" pegado al día siguiente. */
export function pickRear({ equip = [], place = 'gimnasio', avoid = [], variant = 0 } = {}) {
  const pool = EXDB.filter(e => e.k === 'hombros' && e.pat === 'rear' && usable(e, { place }) && !avoid.includes(e.n)).sort((a, b) => prefScore(b, equip) - prefScore(a, equip) || ['maquina', 'polea', 'mancuerna'].indexOf(a.eq) - ['maquina', 'polea', 'mancuerna'].indexOf(b.eq));
  const e = pool[variant % Math.max(1, pool.length)]; return e ? `${e.n} ${e.sets}×${e.rng}` : null;
}

/* ---------- Peso sugerido ---------- */
const REF = { pecho: .28, espalda: .65, hombros: .5, biceps: .14, triceps: .35, core: .3, cuads: 1.7, isquios: .8, gluteos: 1.1, gemelos: .9 }; // fracción del peso corporal (intermedio)
const LF = { principiante: .65, intermedio: 1, avanzado: 1.2 };
export const rndW = x => (x <= 0 ? 0 : x < 15 ? Math.round(x * 2) / 2 : x < 40 ? Math.round(x / 1.25) * 1.25 : Math.round(x / 2.5) * 2.5);
/** Peso de tanteo para `ex` (RIR 2-3). Si hay un peso de referencia de otro ejercicio del mismo músculo lo convierte; si no, estima por peso corporal. */
export function suggestWeight(ex, { ref, bw, level = 'intermedio', sex = 'm' } = {}) {
  if (!ex || ex.bw || !(ex.rel > 0)) return null;
  if (ref?.ex && ref.ex.k === ex.k && ref.w > 0 && ref.ex.rel > 0) return { w: rndW(ref.w * ex.rel / ref.ex.rel), from: 'ref' };
  if (bw > 30) return { w: rndW(bw * REF[ex.k] * (LF[level] || 1) * (sex === 'f' ? .7 : 1) * ex.rel), from: 'bw' };
  return null;
}
/** Dos alternativas REALES para cambiar un ejercicio sin afectar la rutina: mismo músculo y patrón, distinto a los de hoy y a lo ya hecho. */
export function swapOptions(ex, { exclude = [], equip = [], place = 'gimnasio', n = 2 } = {}) {
  const ban = new Set([ex.id, ...exclude.map(x => (typeof x === 'string' ? (bySlug(x)?.id || x) : x.id))]);
  const sc = e => (e.pat === ex.pat ? 6 : 0) + (e.role === ex.role ? 2 : 0) + (e.eq !== ex.eq ? 3 : 0) + prefScore(e, equip) + (e.bw ? -1 : 0);
  const pool = EXDB.filter(e => e.k === ex.k && !ban.has(e.id) && usable(e, { place }));
  const out = [];
  for (const e of [...pool].sort((a, b) => sc(b) - sc(a))) { if (out.length >= n) break; if (!out.some(o => o.eq === e.eq && o.pat === e.pat) || pool.length <= n) out.push(e); }
  return out;
}

/* ---------- Descanso inteligente ---------- */
const BASE = { H: 150, M: 105, L: 80, S: 55 };
const WHY = { H: 'Compuesto pesado', M: 'Compuesto', L: 'Aislamiento grande', S: 'Aislamiento pequeño' };
const r5 = x => Math.round(x / 5) * 5;
export const fmtRest = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Descanso tras una serie: depende del tipo de ejercicio, las reps, el RIR (cerca del fallo = más), el número de serie y el objetivo. */
export function restFor(ex, { r = 10, rir = 2, setNo = 1, warm = false, drop = '', goal = 'hipertrofia' } = {}) {
  if (warm) return { sec: 40, why: 'Calentamiento: descanso corto' };
  const cls = ex?.rest || (ex?.role === 'c' ? 'M' : 'S');
  let sec = BASE[cls], why = [WHY[cls]];
  if (r <= 6) { sec += cls === 'S' ? 15 : 30; why.push('pocas reps'); } else if (r >= 15) { sec -= cls === 'S' ? 10 : 15; why.push('reps altas'); }
  if (rir <= 0) { sec += 25; why.push('al fallo'); } else if (rir === 1) { sec += 10; why.push('cerca del fallo'); } else if (rir >= 3) { sec -= 15; why.push('con reserva'); }
  if (setNo >= 3 && (cls === 'H' || cls === 'M')) { sec += 10; why.push('fatiga acumulada'); }
  if (goal === 'fuerza') sec *= 1.3; else if (goal === 'definición') sec *= 0.95;
  if (drop === 'end') { sec = Math.max(sec, 90) + 30; why = ['Cierre del drop set: fatiga alta']; }
  return { sec: Math.min(240, Math.max(30, r5(sec))), why: `${why[0]}${why.length > 1 ? ' · ' + why.slice(1).join(' · ') : ''}` };
}
/** Descanso al cambiar de ejercicio: parte del último descanso, baja si cambia el músculo (la fatiga local es otra) y suma el tiempo de montar la máquina. */
export function transitionFor(cur, nxt, last = { sec: 75 }) {
  const same = cur.k === nxt.k, setup = nxt.rest === 'H' ? 30 : nxt.rest === 'M' ? 20 : 10;
  const sec = Math.min(210, Math.max(45, r5(last.sec * (same ? 1 : 0.7) + setup)));
  return { sec, why: `Siguiente: ${nxt.n} · ${same ? 'mismo músculo, recupera' : 'cambio de músculo, prepara la máquina'}${nxt.rest === 'H' ? ' · haz una serie de aproximación' : ''}` };
}

/* ---------- Recuperación entre sesiones ---------- */
/** Horas mínimas antes de volver a entrenar el mismo músculo a ≤2 repeticiones del fallo (consenso: 48 h; 72 h en piernas y espalda por su tamaño y fatiga). */
export const REC_H = { pecho: 48, espalda: 72, hombros: 48, biceps: 48, triceps: 48, core: 24, cuads: 72, isquios: 72, gluteos: 48, gemelos: 24 };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
/** Quita de una sesión los músculos que aún no se recuperaron. `last` = {músculo: fecha ISO del último entreno}. Devuelve {ks, removed}. */
export function recoverMuscles(ks, iso, last) {
  const ok = [], removed = [];
  for (const k of ks) { const d = last[k]; (d && dayDiff(d, iso) * 24 < REC_H[k] ? removed : ok).push(k); }
  return { ks: ok, removed };
}
/** Hace cuántas horas (aprox., por día) se entrenó cada músculo de `ks` y cuáles no cumplen la recuperación. */
export function recoveryIssues(ks, iso, last) {
  return ks.filter(k => last[k] && dayDiff(last[k], iso) * 24 < REC_H[k]).map(k => ({ k, hours: dayDiff(last[k], iso) * 24, need: REC_H[k] }));
}

/* ---------- Niveles (curva realista) ---------- */
/** XP necesaria para llegar al nivel L. Con ~160 XP por día completo: Nv 2 ≈ 1 semana, Nv 5 ≈ 1.5 meses, Nv 10 ≈ 5 meses, Nv 25 ≈ 1.5-2 años, Nv 40 ≈ 3 años. */
export const lvlStart = L => (L <= 1 ? 0 : Math.round(700 * (L - 1) ** 1.41));
export const levelOf = xp => { let L = 1; while (L < 99 && xp >= lvlStart(L + 1)) L++; return L; };

/** Ejercicios a evitar según molestias declaradas (orientativo; si hay dolor persistente, consulta a un profesional). */
export const AVOID = {
  hombro: ['Press militar con mancuernas', 'Press Arnold', 'Press militar en Smith', 'Press banca con barra', 'Press militar en máquina', 'Press francés con barra Z'],
  rodilla: ['Sentadilla búlgara', 'Zancadas con mancuernas', 'Sentadilla con barra', 'Sissy squat', 'Step-up con mancuernas', 'Hack squat', 'Extensión de cuádriceps'],
  espalda: ['Peso muerto rumano', 'Remo con barra', 'Sentadilla con barra', 'Hiperextensiones', 'Peso muerto rumano con mancuernas'],
  muneca: ['Press francés con barra Z', 'Curl con barra Z', 'Flexiones', 'Rueda abdominal'],
};

/** Nombres probables en inglés del catálogo free-exercise-db (para las fotos): uno por CADA ejercicio de la base. Clave = slug del nombre en español. */
export const EN = {
  'press-inclinado-con-mancuernas': ['Incline Dumbbell Press'],
  'press-plano-con-mancuernas': ['Dumbbell Bench Press'],
  'press-de-pecho-en-maquina': ['Machine Bench Press', 'Leverage Chest Press', 'Chest Press Machine'],
  'press-inclinado-en-maquina': ['Leverage Incline Chest Press', 'Incline Machine Press'],
  'press-banca-con-barra': ['Barbell Bench Press - Medium Grip', 'Barbell Bench Press'],
  'press-en-smith-inclinado': ['Smith Machine Incline Bench Press', 'Incline Smith Machine Press'],
  'flexiones': ['Pushups', 'Push-Ups', 'Push Up'],
  'aperturas-en-polea': ['Cable Crossover', 'Flat Bench Cable Flyes', 'Cable Fly'],
  'aperturas-con-mancuernas': ['Dumbbell Flyes', 'Incline Dumbbell Flyes'],
  'contractora-pec-deck': ['Butterfly', 'Pec Deck', 'Machine Fly'],
  'cruce-de-poleas': ['Cable Crossover', 'Low Cable Crossover'],
  'jalon-al-pecho': ['Wide-Grip Lat Pulldown', 'Lat Pulldown'],
  'jalon-agarre-cerrado': ['Close-Grip Front Lat Pulldown', 'V-Bar Pulldown'],
  'jalon-unilateral-en-polea': ['One Arm Lat Pulldown', 'Single Arm Lat Pulldown'],
  'dominadas-asistidas': ['Machine-Assisted Pull-Up', 'Assisted Pull-Up', 'Pullups'],
  'remo-con-apoyo-pectoral': ['Leverage Iso Row', 'Machine Row', 'Seated Cable Rows'],
  'remo-en-polea-baja': ['Seated Cable Rows', 'Cable Seated Row'],
  'remo-con-mancuerna-apoyado': ['One-Arm Dumbbell Row', 'Dumbbell Row', 'Bent Over Two-Dumbbell Row'],
  'remo-con-barra': ['Bent Over Barbell Row', 'Barbell Row'],
  'pullover-en-polea': ['Straight-Arm Pulldown', 'Cable Straight Arm Pulldown'],
  'pullover-con-mancuerna': ['Bent-Arm Dumbbell Pullover', 'Straight-Arm Dumbbell Pullover'],
  'press-militar-en-maquina': ['Machine Shoulder (Military) Press', 'Shoulder Press Machine'],
  'press-militar-con-mancuernas': ['Dumbbell Shoulder Press', 'Seated Dumbbell Press'],
  'press-arnold': ['Arnold Dumbbell Press'],
  'press-militar-en-smith': ['Smith Machine Overhead Shoulder Press', 'Smith Machine Shoulder Press'],
  'elevaciones-laterales-en-polea': ['Cable Seated Lateral Raise', 'Single Arm Cable Lateral Raise', 'Side Lateral Raise'],
  'elevaciones-laterales-con-mancuernas': ['Side Lateral Raise', 'Dumbbell Lateral Raise', 'Lateral Raise'],
  'lateral-en-maquina': ['Lateral Raise Machine', 'Side Lateral Raise', 'Machine Lateral Raise'],
  'pajaros-con-mancuernas': ['Reverse Flyes', 'Bent Over Dumbbell Rear Delt Raise With Head On Bench', 'Rear Delt Fly'],
  'pec-deck-inverso': ['Reverse Machine Flyes', 'Reverse Flyes', 'Rear Delt Machine Fly'],
  'face-pull': ['Face Pull', 'Cable Face Pull'],
  'curl-inclinado-con-mancuernas': ['Alternate Incline Dumbbell Curl', 'Incline Dumbbell Curl', 'Incline Hammer Curls'],
  'curl-predicador': ['Machine Preacher Curls', 'Preacher Curl', 'EZ-Bar Preacher Curl'],
  'curl-en-polea': ['Standing Biceps Cable Curl', 'Cable Curl', 'Cable Hammer Curls - Rope Attachment'],
  'curl-martillo-con-mancuernas': ['Hammer Curls', 'Dumbbell Hammer Curl'],
  'curl-con-barra-z': ['EZ-Bar Curl', 'Barbell Curl'],
  'curl-concentrado': ['Concentration Curls', 'Dumbbell Concentration Curl'],
  'press-frances-con-barra-z': ['EZ-Bar Skullcrusher', 'Lying Triceps Press', 'Skullcrusher'],
  'extension-sobre-la-cabeza-en-polea': ['Cable Rope Overhead Triceps Extension', 'Overhead Cable Triceps Extension'],
  'extension-de-triceps-con-mancuerna': ['Standing Dumbbell Triceps Extension', 'Dumbbell One-Arm Triceps Extension', 'Seated Triceps Press'],
  'extension-de-triceps-en-polea': ['Triceps Pushdown', 'Triceps Pushdown - Rope Attachment', 'Triceps Pushdown - V-Bar Attachment'],
  'patada-de-triceps-en-polea': ['Cable One Arm Tricep Extension', 'Tricep Dumbbell Kickback', 'Kneeling Cable Triceps Extension'],
  'fondos-en-maquina': ['Machine Triceps Extension', 'Dips - Triceps Version', 'Bench Dips'],
  'press-cerrado-en-smith': ['Close-Grip Barbell Bench Press', 'Smith Machine Close-Grip Bench Press'],
  'crunch-en-polea': ['Cable Crunch', 'Kneeling Cable Crunch'],
  'crunch-en-maquina': ['Ab Crunch Machine', 'Machine Crunch'],
  'elevacion-de-piernas-colgado': ['Hanging Leg Raise', 'Hanging Straight Leg Raise'],
  'elevacion-de-rodillas-en-silla-romana': ['Knee/Hip Raise On Parallel Bars', 'Hanging Leg Raise'],
  'plancha': ['Plank', 'Front Plank'],
  'rueda-abdominal': ['Ab Roller', 'Ab Wheel Rollout'],
  'prensa-de-piernas': ['Leg Press'],
  'hack-squat': ['Hack Squat', 'Barbell Hack Squat'],
  'sentadilla-en-smith': ['Smith Machine Squat'],
  'sentadilla-con-barra': ['Barbell Full Squat', 'Barbell Squat', 'Back Squat'],
  'sentadilla-goblet': ['Goblet Squat'],
  'zancadas-con-mancuernas': ['Dumbbell Lunges', 'Dumbbell Walking Lunge', 'Dumbbell Rear Lunge'],
  'extension-de-cuadriceps': ['Leg Extensions', 'Leg Extension'],
  'sissy-squat': ['Weighted Sissy Squat', 'Sissy Squat'],
  'peso-muerto-rumano': ['Romanian Deadlift', 'Romanian Deadlift With Dumbbells'],
  'peso-muerto-rumano-con-mancuernas': ['Romanian Deadlift With Dumbbells', 'Stiff-Legged Dumbbell Deadlift'],
  'hiperextensiones': ['Hyperextensions (Back Extensions)', 'Hyperextensions With No Hyperextension Bench', 'Back Extension'],
  'curl-femoral-sentado': ['Seated Leg Curl'],
  'curl-femoral-tumbado': ['Lying Leg Curls', 'Lying Leg Curl'],
  'curl-nordico': ['Natural Glute Ham Raise', 'Glute Ham Raise', 'Nordic Hamstring Curl'],
  'hip-thrust': ['Barbell Hip Thrust', 'Hip Thrust'],
  'hip-thrust-en-maquina': ['Barbell Hip Thrust', 'Hip Thrust Machine', 'Glute Bridge'],
  'puente-de-gluteo-en-smith': ['Barbell Glute Bridge', 'Smith Machine Hip Thrust', 'Butt Lift (Bridge)'],
  'puente-de-gluteo-con-peso-corporal': ['Butt Lift (Bridge)', 'Single Leg Glute Bridge', 'Glute Bridge'],
  'sentadilla-bulgara': ['Bulgarian Split Squat', 'Split Squat with Dumbbells', 'Single Leg Squat'],
  'step-up-con-mancuernas': ['Dumbbell Step Ups', 'Step-up with Knee Raise'],
  'patada-de-gluteo-en-polea': ['One-Legged Cable Kickback', 'Glute Kickback', 'Cable Glute Kickback'],
  'abduccion-en-maquina': ['Thigh Abductor', 'Hip Abduction Machine'],
  'gemelo-de-pie': ['Standing Calf Raises', 'Standing Calf Raise'],
  'gemelo-en-prensa': ['Calf Press On The Leg Press Machine', 'Calf Press'],
  'gemelo-unilateral-con-mancuerna': ['Standing Dumbbell Calf Raise', 'Single-Leg Standing Calf Raise', 'Dumbbell Seated One-Leg Calf Raise'],
  'gemelo-sentado': ['Seated Calf Raise'],
};
