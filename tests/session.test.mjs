// Pruebas de la lógica pura de la sesión guiada. Ejecutar:  node tests/session.test.mjs
import assert from 'node:assert/strict';
import * as S from '../js/session.js';
import * as X from '../js/exdb.js';

const ex = n => { const e = X.EXDB.find(x => x.n === n); assert.ok(e, 'no existe en el catálogo: ' + n); return e; };
const combos = [['pecho', 'hombros', 'triceps'], ['espalda', 'biceps', 'core'], ['cuads', 'isquios', 'gluteos', 'gemelos'], ['core'], Object.keys(X.DEFAULT_PICKS)];

// 1) El calentamiento y el estiramiento final nunca pasan de 5 minutos y cubren los músculos del día.
for (const ks of combos) {
  const w = S.warmupFor(ks), c = S.cooldownFor(ks);
  assert.ok(w.total > 0 && w.total <= 300, `calentamiento fuera de rango (${w.total} s) para ${ks}`);
  assert.ok(c.total > 0 && c.total <= 300, `estiramiento fuera de rango (${c.total} s) para ${ks}`);
  if (ks.length <= 5) for (const k of ks) assert.ok(w.steps.some(s => s.k === k), `falta ${k} en el calentamiento`);
}
assert.equal(S.warmupFor([]).steps.length, 0);

// 2) Cardio según el objetivo.
assert.equal(S.cardioFor({ goal: 'definición', ks: ['pecho'] }).toca, 'si');
assert.equal(S.cardioFor({ dietGoal: 'cut', ks: ['cuads', 'isquios'] }).min, 15);               // pierna en definición: corto y sin impacto
assert.equal(S.cardioFor({ goal: 'hipertrofia', ks: ['cuads', 'gluteos'] }).toca, 'no');         // volumen + pierna: no toca
assert.equal(S.cardioFor({ goal: 'hipertrofia', ks: ['pecho'] }).toca, 'opcional');
assert.equal(S.cardioFor({ goal: 'fuerza', ks: ['pecho'] }).toca, 'no');
assert.equal(S.cardioFor({ dietGoal: 'cut', ks: ['pecho'], doneWeek: 5 }).toca, 'opcional');     // tope semanal cumplido
assert.equal(S.cardioFor({ dietGoal: 'cut', restDay: true }).toca, 'si');

// 3) Descanso al cambiar de ejercicio: manda el ejercicio que SIGUE.
const rest = (a, b, rir = 1) => S.changeRest(ex(a), ex(b), { last: X.restFor(ex(a), { r: 9, rir, setNo: 3 }), rir });
const heavyNext = rest('Curl predicador', 'Prensa de piernas'), lightNext = rest('Gemelo de pie', 'Crunch en polea');
assert.ok(heavyNext.sec > lightNext.sec, 'un compuesto pesado debe pedir más descanso que un aislamiento pequeño');
assert.ok(heavyNext.approach, 'antes de un compuesto pesado se sugiere serie de aproximación');
const same = rest('Press inclinado con mancuernas', 'Aperturas en polea'), other = rest('Press inclinado con mancuernas', 'Curl predicador');
assert.ok(same.same && same.sec > other.sec, 'mismo músculo = más descanso que cambiar de músculo');
assert.ok(S.changeRest(ex('Prensa de piernas'), ex('Hack squat'), { last: { sec: 170 }, goal: 'fuerza' }).sec > S.changeRest(ex('Prensa de piernas'), ex('Hack squat'), { last: { sec: 170 }, goal: 'definición' }).sec);
for (const a of X.EXDB) for (const b of X.EXDB) { const s = S.changeRest(a, b).sec; assert.ok(s >= 45 && s <= 240, `descanso fuera de rango ${a.n} → ${b.n}: ${s}`); }

// 4) Catálogo: ids únicos y cada músculo con ejercicios suficientes.
assert.equal(new Set(X.EXDB.map(e => e.id)).size, X.EXDB.length, 'ids duplicados en el catálogo');
for (const k of Object.keys(X.DEFAULT_PICKS)) assert.ok(X.EXDB.filter(e => e.k === k).length >= 4, 'pocos ejercicios para ' + k);

console.log(`OK · ${X.EXDB.length} ejercicios · sesión guiada verificada`);
