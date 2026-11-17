// Sesión guiada (lógica pura, sin DOM, testeable en Node):
//  · calentamiento / estiramiento dinámico previo, SIEMPRE ≤ 5 min, según los músculos que se van a trabajar
//  · estiramiento final suave (≤ 5 min) de lo que se trabajó
//  · cierre: ¿toca cardio hoy? según el objetivo de la persona, el tipo de sesión y lo ya hecho en la semana
//  · descanso al CAMBIAR de ejercicio: depende del ejercicio que viene (no solo del que acabas)

export const MAX_STRETCH_SEC = 300;
const r5 = x => Math.round(x / 5) * 5;
const LOWER = ['cuads', 'isquios', 'gluteos', 'gemelos'];
const isLower = ks => ks.filter(k => LOWER.includes(k)).length > ks.length / 2;

/* [nombre, segundos, indicación]. Dos movimientos por músculo: el 1.º es el imprescindible. Dinámicos: preparan sin restar fuerza. */
const PREP = {
  pecho: [['Aperturas dinámicas de brazos', 30, 'Abre y cruza los brazos a la altura del pecho, cada vez un poco más amplio.'], ['Flexiones lentas con pausa abajo', 30, '6-8 repeticiones suaves (apoya rodillas si hace falta): siente el estiramiento del pecho.']],
  espalda: [['Gato-camello + rotación torácica', 35, 'En cuatro apoyos: arquea y redondea la espalda; luego abre un brazo al techo por lado.'], ['Colgado pasivo o jalón sin peso', 25, 'Deja que los dorsales se estiren 2 segundos arriba y baja las escápulas.']],
  hombros: [['Círculos de brazos progresivos', 30, 'De pequeños a grandes, 15 s hacia delante y 15 s hacia atrás.'], ['Rotaciones externas con banda o polea ligera', 30, 'Codo pegado al cuerpo, 12-15 repeticiones suaves por lado.']],
  biceps: [['Flexo-extensión de codo y muñeca', 25, 'Brazos al frente: abre y cierra el codo girando la palma arriba y abajo.']],
  triceps: [['Extensión de tríceps sobre la cabeza sin peso', 25, 'Lleva la mano entre los omóplatos y extiende arriba, alternando brazos.']],
  core: [['Bicho muerto (dead bug)', 30, 'Espalda baja pegada al suelo; baja brazo y pierna contrarios sin arquear.'], ['Plancha corta', 20, 'Glúteos y abdomen apretados, respira normal.']],
  cuads: [['Sentadilla profunda sin peso con pausa', 35, 'Baja controlado, 2 segundos abajo empujando las rodillas hacia fuera.'], ['Zancada con rotación de tronco', 35, 'Paso largo, rodilla atrás cerca del suelo y gira el tronco hacia la pierna de delante.']],
  isquios: [['Balanceo de pierna adelante-atrás', 30, 'Sujétate de algo; pierna recta y amplitud progresiva, 15 s por lado.'], ['Buenos días sin peso', 30, 'Cadera atrás, espalda neutra, siente el estiramiento detrás del muslo.']],
  gluteos: [['Puente de glúteo con pausa arriba', 30, 'Aprieta 2 segundos arriba sin arquear la espalda baja.'], ['Estiramiento 90/90 de cadera', 30, 'Sentado, alterna las rodillas de lado a lado manteniendo el pecho alto.']],
  gemelos: [['Elevaciones de talón con rango completo', 25, 'Sube alto, baja lento hasta estirar; usa un escalón si puedes.']],
};
/* Estiramiento estático suave para el FINAL (20-30 s, sin rebotes ni dolor). */
const COOL = {
  pecho: ['Pecho en el marco de la puerta', 'Antebrazo apoyado y gira el tronco al lado contrario.'],
  espalda: ['Dorsales: cuelga o postura del niño', 'Brazos largos al frente, lleva la cadera atrás.'],
  hombros: ['Hombro cruzado al pecho', 'Lleva el brazo recto al lado contrario con la otra mano.'],
  biceps: ['Bíceps con brazo atrás en la pared', 'Palma en la pared, pulgar arriba, gira el cuerpo.'],
  triceps: ['Tríceps sobre la cabeza', 'Codo arriba, empuja suave con la otra mano.'],
  core: ['Cobra suave', 'Boca abajo, sube el pecho con los brazos sin forzar la espalda baja.'],
  cuads: ['Cuádriceps de pie', 'Talón al glúteo, rodillas juntas y cadera al frente.'],
  isquios: ['Isquios con pierna extendida', 'Espalda recta, inclínate desde la cadera.'],
  gluteos: ['Glúteo en figura de 4', 'Tobillo sobre la rodilla contraria y acerca las piernas al pecho.'],
  gemelos: ['Gemelo en la pared', 'Pierna atrás recta, talón al suelo.'],
};

/** Calentamiento + estiramiento dinámico PREVIO. Nunca pasa de maxSec (5 min por defecto). ks = músculos del día en el orden de la sesión. */
export function warmupFor(ks = [], { maxSec = MAX_STRETCH_SEC, firstExercise = '' } = {}) {
  const list = [...new Set(ks)].filter(k => PREP[k]), cap = Math.min(maxSec, MAX_STRETCH_SEC);
  if (!list.length) return { steps: [], total: 0, tip: '' };
  const lower = isLower(list);
  const steps = [{ k: 'general', n: lower ? 'Bici o caminata rápida' : 'Remo, elíptica o saltos de tijera suaves', sec: 60, cue: 'Sube pulsaciones y temperatura: debes terminar respirando un poco más rápido, sin cansarte.' }];
  let left = cap - 60;
  const push = (k, m) => { if (!m || m[1] > left) return false; steps.push({ k, n: m[0], sec: m[1], cue: m[2] }); left -= m[1]; return true; };
  list.forEach(k => push(k, PREP[k][0]));            // 1.º: un movimiento por cada músculo del día
  list.forEach(k => push(k, PREP[k][1]));            // 2.º: si sobra tiempo, el segundo de los músculos principales (van primero en la lista)
  const total = steps.reduce((n, s) => n + s.sec, 0);
  return { steps, total, lower,
    tip: `Después, haz 1-2 series de aproximación${firstExercise ? ` de ${firstExercise}` : ' del primer ejercicio'} con ~50 % y ~75 % del peso (no cuentan como series).` };
}

/** Estiramiento estático FINAL de lo trabajado. 25-30 s por músculo, tope de 5 min. */
export function cooldownFor(ks = [], { maxSec = MAX_STRETCH_SEC } = {}) {
  const list = [...new Set(ks)].filter(k => COOL[k]), cap = Math.min(maxSec, MAX_STRETCH_SEC);
  if (!list.length) return { steps: [], total: 0 };
  const per = Math.max(20, Math.min(30, r5(cap / list.length)));
  const steps = list.slice(0, Math.floor(cap / per)).map(k => ({ k, n: COOL[k][0], sec: per, cue: COOL[k][1] }));
  return { steps, total: steps.reduce((n, s) => n + s.sec, 0) };
}

/* Objetivo efectivo: la fase de dieta manda (déficit = definición), luego el objetivo de la rutina. */
const goalOf = ({ goal = '', dietGoal = '' } = {}) => {
  const g = String(goal).toLowerCase();
  if (dietGoal === 'cut' || /defin/.test(g)) return 'definicion';
  if (/fuerza/.test(g)) return 'fuerza';
  if (dietGoal === 'bulk' || /hipertrof|volumen/.test(g)) return 'volumen';
  return 'mantenimiento';
};
const CARDIO = {
  definicion: { label: 'Definición', weekly: 5, steps: '8.000-10.000', train: [25, 'Caminata inclinada (10-12 %, 5-6 km/h) o bici suave'], legs: [15, 'Bici suave sin resistencia'], rest: [35, 'Caminata a paso rápido'],
    why: 'En déficit, el cardio suave (LISS, zona 2) aumenta el gasto sin robarle recuperación a las pesas. Hazlo DESPUÉS de entrenar, nunca antes.' },
  volumen: { label: 'Volumen / hipertrofia', weekly: 3, steps: '6.000-8.000', train: [12, 'Caminata o bici muy suave'], legs: [0, ''], rest: [20, 'Caminata tranquila'],
    why: 'Para ganar músculo el cardio es salud y apetito, no gasto: poco, suave y sin interferir con la recuperación.' },
  fuerza: { label: 'Fuerza', weekly: 2, steps: '6.000-8.000', train: [0, ''], legs: [0, ''], rest: [20, 'Caminata o bici en zona 2'],
    why: 'Tras una sesión pesada prioriza recuperar el sistema nervioso; el cardio va en días de descanso y siempre suave.' },
  mantenimiento: { label: 'Mantenimiento', weekly: 3, steps: '7.000-9.000', train: [15, 'Caminata, bici o elíptica suave'], legs: [10, 'Caminata suave'], rest: [25, 'Caminata a buen paso'],
    why: 'Con calorías estables, 2-3 sesiones suaves por semana cuidan el corazón y la recuperación.' },
};
/**
 * ¿Toca cardio hoy? toca: 'si' | 'opcional' | 'no'.
 * goal = objetivo de la rutina · dietGoal = cut|maint|bulk · ks = músculos del día · restDay = día sin pesas · doneWeek = cardios ya hechos esta semana.
 */
export function cardioFor({ goal = '', dietGoal = '', ks = [], restDay = false, doneWeek = 0, level = '' } = {}) {
  const key = goalOf({ goal, dietGoal }), C = CARDIO[key], lower = !restDay && isLower(ks);
  let [min, kind] = restDay ? C.rest : lower ? C.legs : C.train;
  if (level === 'principiante' && min > 20) min = 20;
  const quota = doneWeek >= C.weekly;
  let toca = min <= 0 ? 'no' : key === 'definicion' && !quota ? 'si' : 'opcional';
  let why = C.why;
  if (lower && key !== 'definicion') why = 'Día de pierna: el cardio extra solo le quita recuperación a lo que acabas de entrenar. ' + C.why;
  else if (lower) why = 'Día de pierna: cardio corto y sin impacto para no castigar más las piernas. ' + C.why;
  if (quota && min > 0) why = `Ya llevas ${doneWeek} sesión${doneWeek === 1 ? '' : 'es'} de cardio esta semana (tu tope es ${C.weekly}): hoy es opcional. ` + C.why;
  const title = toca === 'si' ? `Sí toca cardio: ${min} min` : toca === 'opcional' ? `Cardio opcional: ${min} min` : restDay ? 'Hoy solo pasos' : 'Hoy NO toca cardio';
  const detail = toca === 'no' ? 'Camina 3-5 min para bajar pulsaciones y listo.' : `${kind}, a un ritmo en el que puedas hablar (zona 2).`;
  return { toca, min: Math.max(0, min), kind, title, detail, why, steps: C.steps, goal: key, label: C.label, weekly: C.weekly, lower };
}

/* ---------- Descanso al cambiar de ejercicio ---------- */
const BASE = { H: 150, M: 105, L: 80, S: 55 };
/* Sinergistas: músculos que ya trabajaron de ayudantes en el ejercicio anterior (llegan con fatiga parcial). */
const SYN = { pecho: ['triceps', 'hombros'], hombros: ['triceps'], espalda: ['biceps'], cuads: ['gluteos'], gluteos: ['isquios', 'cuads'], isquios: ['gluteos'] };
const clsOf = e => e?.rest || (e?.role === 'c' ? 'M' : 'S');
/**
 * Descanso entre el ejercicio que acabas (cur) y el que sigue (nxt).
 * Pesa más lo que VIENE: un compuesto pesado exige llegar fresco; un aislamiento pequeño de otro músculo casi no necesita espera.
 * last = descanso que tocaba tras tu última serie ({sec}); rir = cercanía al fallo de esa serie.
 */
export function changeRest(cur, nxt, { last = { sec: 75 }, goal = 'hipertrofia', rir = 2 } = {}) {
  const same = !!cur && !!nxt && cur.k === nxt.k, syn = !same && cur?.role === 'c' && (SYN[cur.k] || []).includes(nxt?.k), cls = clsOf(nxt);
  const setup = cls === 'H' ? 30 : cls === 'M' ? 20 : 10;                              // montar máquina, discos, ajustar asiento
  const carry = same ? 0.65 : syn ? 0.5 : 0.35;                                         // cuánta fatiga local arrastras al siguiente
  let sec = Math.max((last?.sec || 75) * (same ? 0.7 : syn ? 0.55 : 0.45), BASE[cls] * carry + (same ? 15 : 0)) + setup;
  if (rir <= 0) sec += 15;                                                              // vienes de una serie al fallo
  sec *= /fuerza/.test(goal) ? 1.3 : /defin/.test(goal) ? 0.9 : 1;
  sec = Math.min(240, Math.max(45, r5(sec)));
  const approach = cls === 'H' || (cls === 'M' && !same && !syn);
  const reason = same ? 'mismo músculo: recupera antes de seguir' : syn ? `${nxt.m || 'músculo'} ya ayudó en el anterior: recuperación media` : 'cambia el músculo: prepara el equipo';
  return { sec, same, syn, approach, cls, reason,
    why: `Sigue: ${nxt?.n || 'siguiente ejercicio'} · ${reason}${approach ? ' · haz 1 serie de aproximación' : ''}` };
}
