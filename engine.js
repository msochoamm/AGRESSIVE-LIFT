// Motor determinista (números fiables y testeables). La IA generativa (Edge Function) solo interpreta
// texto libre y redacta consejos; NUNCA decide cargas ni calorías por sí sola.
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const r25 = x => Math.round(x / 2.5) * 2.5;
const REPS = [8, 12];

/* ---------- Nutrición ---------- */
export const macros = (kcal, kg) => {
  const p = Math.round(2 * kg), f = Math.round(0.8 * kg);
  return { kcal: Math.round(kcal), p, f, c: Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4)) };
};
export function initial({ kg, h, age, sex, goal }) { // Mifflin-St Jeor × 1.55
  const tdee = (10 * kg + 6.25 * h - 5 * age + (sex === 'm' ? 5 : -161)) * 1.55;
  return macros(tdee * { cut: 0.8, maint: 1, bulk: 1.1 }[goal], kg);
}
/** Mantiene proteína/grasa y reparte la variación de kcal del día en carbohidratos. */
export const scale = (t, kcal) => ({ ...t, kcal, c: Math.max(0, Math.round((kcal - 4 * t.p - 9 * t.f) / 4)) });
/** Tendencia: promedio últimos 7 d vs 7 d previos. Excluye pesajes ≤3 días tras una fiesta (agua/sodio). */
export function trend(ws, raveDates = []) {
  const age = d => (Date.now() - new Date(d + 'T12:00:00')) / 864e5;
  const ok = ws.filter(w => !raveDates.some(r => { const x = (new Date(w.d) - new Date(r)) / 864e5; return x >= 0 && x <= 3; }));
  const a = ok.filter(w => age(w.d) < 7).map(w => w.kg), b = ok.filter(w => age(w.d) >= 7 && age(w.d) < 14).map(w => w.kg);
  return a.length >= 2 && b.length >= 2 ? { now: avg(a), rate: avg(a) - avg(b) } : null;
}
/** Auditoría semanal: compara ritmo real vs objetivo (déficit −0.6 %/sem, volumen +0.25 %/sem) y corrige ≤250 kcal/sem. */
export function audit({ weights, target, goal, raveDates }) {
  const t = trend(weights, raveDates);
  if (!t) return { target, note: 'Faltan pesajes: registra ≥2 por semana durante 2 semanas para auditar.' };
  const goalRate = { cut: -0.006, maint: 0, bulk: 0.0025 }[goal] * t.now, err = goalRate - t.rate;
  if (Math.abs(err) < 0.001 * t.now) return { target: macros(target.kcal, t.now), note: `Ritmo ${t.rate.toFixed(2)} kg/sem: en objetivo. Sin cambios.` };
  const delta = Math.max(-250, Math.min(250, Math.round(err * 1100 / 10) * 10));
  return { target: macros(Math.max(1500, target.kcal + delta), t.now),
    note: `Ritmo ${t.rate.toFixed(2)} kg/sem vs objetivo ${goalRate.toFixed(2)}. Ajuste ${delta > 0 ? '+' : ''}${delta} kcal/día la próxima semana.` };
}
/** Exceso del día → recorte repartido en 3 días, máx. 200 kcal/día (protege el déficit/superávit sin castigar). */
export const carry = over => { const out = []; let left = Math.min(over, 600); for (let i = 0; i < 3; i++) { const x = Math.min(200, left); out.push(x); left -= x; } return out; };
/** Fiesta: +500 kcal ese día, −150 kcal los 3 siguientes. */
export const raveComp = () => [{ off: 0, k: 500 }, { off: 1, k: -150 }, { off: 2, k: -150 }, { off: 3, k: -150 }];

/* ---------- Entrenamiento ---------- */
/** Autorregulación: usa RIR + check-in de falla anatómica de la sesión previa. prev = series de esa sesión. */
export function regulate(prev, week, weeks) {
  if (week >= weeks) return { action: 'descarga', w: prev.length ? r25(Math.max(...prev.map(s => s.w)) * 0.9) : null, note: 'Semana final del mesociclo: −10 % carga y mitad de series.' };
  if (!prev.length) return { action: 'mantener', w: null, note: 'Sin datos previos: carga de tanteo a RIR 2.' };
  const w = Math.max(...prev.map(s => s.w)), top = prev.filter(s => s.w === w);
  const rir = avg(top.map(s => s.rir)), reps = avg(top.map(s => s.r));
  if (top.filter(s => s.fail !== 'Músculo objetivo').length / top.length >= 0.5)
    return { action: 'mantener', w, note: 'Falló por antebrazo/aire, no por el músculo: no subas. Usa straps/agarre o revisa respiración y posición.' };
  if (rir <= 1 && reps < REPS[0]) return { action: 'descarga', w: r25(w * 0.95), note: 'Reps bajo rango con RIR≤1: fatiga acumulada, baja 5 %.' };
  if (reps >= REPS[1]) return rir >= 2 ? { action: 'subir', w: r25(w * 1.05), note: 'Techo de reps con reserva: +5 %.' } : { action: 'subir', w: r25(w * 1.025), note: 'Techo de reps al límite: +2.5 %.' };
  return { action: 'mantener', w, note: rir >= 3 ? 'Mucha reserva: mismo peso, busca +1-2 reps.' : 'Mismo peso, busca +1 rep por serie.' };
}
/** Modo Diablo: −20 % sobre la última serie efectiva (falló en músculo objetivo); en cascada. */
export function dropLoad(sets) {
  const eff = [...sets].reverse().find(s => s.fail === 'Músculo objetivo') || sets[sets.length - 1];
  return eff ? r25(eff.w * 0.8) : null;
}
export const isPR = (hist = [], w, r) => hist.length > 0 && w * (1 + r / 30) > Math.max(...hist.map(s => s.w * (1 + s.r / 30)));

/** Modo local (sin IA): interpreta "arroz y pollo 650 kcal 45p 70c 15g". null si no hay números. */
export function parseMeal(text) {
  const re = /(\d+(?:[.,]\d+)?)\s*(kcal|cal|p|c|g)\b/gi, map = { kcal: 'k', cal: 'k', p: 'p', c: 'c', g: 'f' }, t = { k: 0, p: 0, c: 0, f: 0 };
  for (const m of String(text).matchAll(re)) t[map[m[2].toLowerCase()]] += parseFloat(m[1].replace(',', '.'));
  if (!t.k) t.k = 4 * t.p + 4 * t.c + 9 * t.f;
  if (!t.k) return null;
  const name = String(text).replace(re, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Comida';
  return { items: [{ name, k: Math.round(t.k), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) }], confidence: 1, note: 'Macros manuales.' };
}

/* ---------- v24: récord cercano, fatiga, descarga, reporte semanal, progreso de bloque ---------- */
/** Mensaje de récord: e1RM (Epley, igual que isPR) de la carga w×r vs. el mejor histórico (sin calentamientos ni drops). */
export function prHint(hist = [], w, r = 8) {
  const h = hist.filter(s => s.t !== 'w' && s.t !== 'drop');
  if (!h.length || !(w > 0) || !(r > 0)) return null;
  const e1 = s => s.w * (1 + s.r / 30), b = h.reduce((m, s) => (e1(s) > e1(m) ? s : m)), p = e1({ w, r }) / e1(b);
  if (p > 1) return { kind: 'break', pct: p, text: `🔥 Tu récord es ${b.w} kg × ${b.r}. ¡Hoy puedes romperlo!` };
  if (p >= 0.92) return { kind: 'near', pct: p, text: `💪 Tu récord es ${b.w} kg × ${b.r}, ¡estás cerca!` };
  return null;
}
/** Fatiga: en ≥minEx ejercicios, las 2 últimas sesiones (≤14 d, sin contar hoy) con RIR 0 en la serie top y menos reps con el MISMO peso. */
export function fatigue(logs, { minEx = 2, today = new Date().toISOString().slice(0, 10) } = {}) {
  const ids = [];
  for (const [id, rows] of Object.entries(logs)) {
    const work = rows.filter(s => s.t !== 'w' && s.t !== 'drop' && s.d < today);
    const days = [...new Set(work.map(s => s.d))].sort().slice(-2);
    if (days.length < 2 || (Date.parse(today) - Date.parse(days[0])) / 864e5 > 14) continue;
    const [a, b] = days.map(d => { const x = work.filter(s => s.d === d), w = Math.max(...x.map(s => s.w)), t = x.filter(s => s.w === w); return { w, rir: avg(t.map(s => s.rir)), r: avg(t.map(s => s.r)) }; });
    if (a.rir <= 0.5 && b.rir <= 0.5 && a.w === b.w && b.r < a.r) ids.push(id);
  }
  return { flag: ids.length >= minEx, ids };
}
/** Descarga activa: −15 % sobre la carga máxima de la sesión previa (mitad de series, RIR 3-4). */
export const deload = prev => ({ action: 'descarga', w: prev.length ? r25(Math.max(...prev.map(s => s.w)) * 0.85) : null, note: 'Descarga activa: −15 % de carga, mitad de series y RIR 3-4. Técnica limpia, sin fallo.' });
/** Reporte semanal: tonelaje, series, PRs, días entrenados y días en meta (±10 % del presupuesto, mismo criterio que el XP). */
export function weekReport({ logs, hist, budget, days }) {
  const rows = Object.values(logs).flat().filter(x => days.includes(x.d));
  return {
    ton: Math.round(rows.reduce((a, x) => a + x.w * x.r, 0)), sets: rows.length, prs: rows.filter(x => x.pr).length,
    trainDays: new Set(rows.map(x => x.d)).size, logged: days.filter(d => hist[d]?.n > 0).length,
    onTarget: days.filter(d => hist[d]?.n > 0 && budget(d) && hist[d].k >= 0.9 * budget(d) && hist[d].k <= 1.1 * budget(d)).length,
  };
}
/** Progreso de un bloque (planLock/dietLock {start, until}): día, semana, días restantes y %. */
export function planProgress(lock, today) {
  if (!lock?.start || !lock?.until) return null;
  const d = iso => Date.parse(iso + 'T12:00:00'), total = Math.round((d(lock.until) - d(lock.start)) / 864e5) + 1, day = Math.round((d(today) - d(lock.start)) / 864e5) + 1, n = Math.max(1, Math.min(total, day));
  return { day: n, totalDays: total, week: Math.ceil(n / 7), weeks: Math.ceil(total / 7), left: total - n, pct: Math.round(n / total * 100), done: day > total };
}

