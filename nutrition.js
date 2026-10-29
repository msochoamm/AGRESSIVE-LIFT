// Nutricionista IA — parte DETERMINISTA: cuestionario, estrategia y menú semanal con gramos calculados.
// La IA generativa (si hay cuenta) solo conversa; los números salen de aquí (testeables).

/* ---------- Alimentos (por 100 g, peso cocido salvo avena/whey) ---------- */
// tier de costo en Colombia: 1 barato · 2 medio · 3 caro. raw = factor cocido→crudo para la lista de compras.

/** Qué lleva EXACTAMENTE la «verdura mixta»: proporciones sobre el peso total (la app nunca dice solo «verduras mixtas»). */
export const VEG_MIX = [['Zanahoria', 0.3], ['Brócoli', 0.3], ['Habichuela', 0.25], ['Tomate y cebolla', 0.15]];
export const VEG_TXT = 'zanahoria, brócoli, habichuela y tomate';
const vegId = n => 'veg-' + n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '-');
export const vegSplit = g => VEG_MIX.map(([n, p]) => [n, g * p]);
/** En una receta, la primera vez que aparece «verduras» se aclara cuáles son (una sola vez para no alargar el texto). */
const vegSteps = steps => { let done = false; return steps.map(s => (!done && /\bverduras\b/.test(s) ? (done = true, s.replace(/\bverduras\b/, `verduras (${VEG_TXT})`)) : s)); };

/** Plan de cocina: qué comprar/cocinar y cuándo (batch cooking), cómo porcionar y recalentar. */
/** Tareas de cocina por lotes para los días [from..to] de un menú (sirve para cualquier tanda, no solo domingo/miércoles). */
export function cookTasks(menu, from, to, label) {
  const block = (from, to) => { const tot = {}, ids = new Set();
    for (let d = from; d <= to; d++) (menu.days[d] || []).forEach(m => { ids.add(m.id); if (m.prep === 'fuera') return; m.items.forEach(it => { if (FOODS[it.id]) tot[it.id] = (tot[it.id] || 0) + it.g * (FOODS[it.id].raw || 1); }); });
    return { tot, ids }; };
  const list = (tot, kind) => Object.entries(tot).filter(([id]) => FOODS[id].kind === kind).map(([id, g]) => `${FOODS[id].n.toLowerCase()} ${Math.round(g / 10) * 10} g`);
  const { tot, ids } = block(from, to), t = [], n = to - from + 1;
  const prot = list(tot, 'prot').filter(x => !/huevo|cocid/.test(x)), carb = [...list(tot, 'carb'), ...list(tot, 'prot')].filter(x => /cocid/.test(x));
  const veg = list(tot, 'veg').filter(x => !/^verduras/.test(x));
  if (prot.length) t.push(`🍗 Proteínas (peso crudo): ${prot.join(', ')}. Sazona con sal, ajo y pimienta, cocina hasta que estén bien cocidas y porciona en ${n} recipientes (uno por comida).`);
  if (carb.length) t.push(`🍚 Carbohidratos y legumbres (peso ya cocido): ${carb.join(', ')}. Cocínalos juntos y guárdalos en recipientes aparte de la proteína para que no se pongan blandos.`);
  if (tot.verduras) { const parts = vegSplit(tot.verduras).map(([n, g]) => `${n.toLowerCase()} ${Math.round(g / 10) * 10} g`);
    t.push(`🥦 Verduras, ${Math.round(tot.verduras / 10) * 10} g en total = ${parts.join(' + ')}. Lávalas y córtalas: zanahoria en rodajas finas, habichuela en trozos de 3 cm, brócoli en ramitos pequeños, tomate en cubos y cebolla en tiras. Para comer: saltea 2 min la zanahoria y la habichuela con el aceite y sal, agrega el brócoli, el tomate y la cebolla y cocina 2-3 min más (o déjalas listas crudas en la nevera).`); }
  if (veg.length) t.push(`🥦 Otras verduras: ${veg.join(', ')}. Lávalas y córtalas; saltéalas 4-5 min el mismo día de comerlas o déjalas listas crudas.`);
  if (tot.huevo) t.push(`🥚 Hierve ${Math.ceil(tot.huevo / 50 / 1.0)} huevos duros (10 min) para desayunos y snacks.`);
  if ([...ids].some(i => /d-oats/.test(i))) t.push('🥣 Avena de frasco: prepárala la noche anterior (avena + leche + whey + banano).');
  for (let d = from; d <= to; d++) { const ms = (menu.days[d] || []).filter(m => m.prep !== 'fuera'); if (!ms.length) continue;
    t.push(`🥡 Recipientes del día ${d - from + 1} — ${ms.map(m => `${m.slot}: ${m.items.map(it => it.text).join(' + ')}`).join(' | ')}.`); }
  t.push(`📦 Etiqueta cada recipiente con el día (${label}) y guarda lo de los 2 primeros días en la nevera; lo demás, en el congelador si dura más de 3-4 días.`);
  return t;
}
/** Una tanda de cocina: días = lista de arreglos de comidas (uno por día). Devuelve la lista de compras EXACTA de esos días y qué cocinar. */
export function cookBatch(days, label) {
  const menu = { days };
  return { groceries: groceries(menu), tasks: cookTasks(menu, 0, Math.max(0, days.length - 1), label) };
}
export function cookPlan(menu, prefs = {}) {
  const tasks = (from, to, label) => cookTasks(menu, from, to, label);
  return [
    { day: 'Domingo', title: 'Compra y cocina por lotes (Lun–Jue)', tasks: ['🛒 Haz la compra con la lista de la semana (revisa la pestaña "Lista de compras").', ...tasks(0, 3, 'Lun–Jue'), '⏱ Calcula 60-90 min de cocina con todo en paralelo: arroz/papa al fuego, proteína en sartén u horno y verduras al final.'] },
    { day: 'Miércoles', title: 'Reposición (Vie–Dom)', tasks: tasks(4, 6, 'Vie–Dom') },
    { day: 'Cada día', title: 'Rutina diaria (5 min)', tasks: ['🌙 La noche anterior: pasa de la nevera a la mesa lo del día siguiente y deja lista la ropa/bolso de entreno.', '⏰ Pon una alarma por cada comida con la hora del menú.', '🔥 Recalienta 2 min en microondas o sartén (proteína un poco más de tiempo), suma la verdura fresca y a comer.', (prefs.cook === 'poco' || prefs.time === 'poco') ? '⚡ Si hoy no hay tiempo: usa las comidas de 1-5 min (yogur, huevos duros, arepa con atún) y no te saltes la proteína.' : '⚡ Si un día se complica, usa las comidas rápidas del menú (1-5 min) y no te saltes la proteína.'] },
  ];
}

export const FOODS = {
  muslo: { n: 'Muslo de pollo sin piel', s: 'muslo de pollo', k: 179, p: 25, c: 0, f: 8, tier: 1, raw: 1.3, kind: 'prot' },
  pechuga: { n: 'Pechuga de pollo', s: 'pechuga', k: 165, p: 31, c: 0, f: 3.6, tier: 2, raw: 1.3, kind: 'prot' },
  molida: { n: 'Carne molida magra', s: 'carne molida', k: 215, p: 26, c: 0, f: 12, tier: 2, raw: 1.3, kind: 'prot' },
  res: { n: 'Res magra (lomo/bistec)', s: 'res magra', k: 200, p: 29, c: 0, f: 8.5, tier: 3, raw: 1.3, kind: 'prot' },
  cerdo: { n: 'Lomo de cerdo', s: 'lomo de cerdo', k: 190, p: 29, c: 0, f: 7.5, tier: 2, raw: 1.3, kind: 'prot' },
  pescado: { n: 'Tilapia / pescado blanco', s: 'pescado', k: 128, p: 26, c: 0, f: 2.7, tier: 2, raw: 1.25, kind: 'prot' },
  atun: { n: 'Atún en agua (lata)', s: 'atún', k: 116, p: 26, c: 0, f: 1, tier: 2, raw: 1, kind: 'prot' },
  huevo: { n: 'Huevo', s: 'huevo', k: 143, p: 12.6, c: 0.7, f: 9.5, tier: 1, raw: 1, kind: 'prot', unit: 50 },
  higado: { n: 'Hígado de res', s: 'hígado de res', k: 175, p: 27, c: 4, f: 5, tier: 1, raw: 1.3, kind: 'prot' },
  corazon: { n: 'Corazón de res', s: 'corazón de res', k: 165, p: 28, c: 0.1, f: 4.7, tier: 1, raw: 1.3, kind: 'prot' },
  lenteja: { n: 'Lentejas cocidas', s: 'lentejas', k: 116, p: 9, c: 20, f: 0.4, tier: 1, raw: 0.4, kind: 'prot' },
  frijol: { n: 'Fríjoles cocidos', s: 'fríjoles', k: 127, p: 8.7, c: 22.8, f: 0.5, tier: 1, raw: 0.4, kind: 'prot' },
  whey: { n: 'Proteína whey (polvo)', s: 'whey', k: 400, p: 80, c: 8, f: 6, tier: 2, raw: 1, kind: 'supp' },
  yogur: { n: 'Yogur griego natural', s: 'yogur griego', k: 59, p: 10, c: 3.6, f: 0.4, tier: 2, raw: 1, kind: 'dairy' },
  leche: { n: 'Leche descremada', s: 'leche', k: 34, p: 3.4, c: 5, f: 0.1, tier: 1, raw: 1, kind: 'dairy' },
  arroz: { n: 'Arroz cocido', s: 'arroz', k: 130, p: 2.7, c: 28, f: 0.3, tier: 1, raw: 0.4, kind: 'carb' },
  papa: { n: 'Papa cocida', s: 'papa', k: 87, p: 1.9, c: 20, f: 0.1, tier: 1, raw: 1.1, kind: 'carb' },
  platano: { n: 'Plátano maduro cocido', s: 'plátano', k: 122, p: 1, c: 32, f: 0.4, tier: 1, raw: 1.2, kind: 'carb' },
  pasta: { n: 'Pasta cocida', s: 'pasta', k: 158, p: 5.8, c: 31, f: 0.9, tier: 1, raw: 0.45, kind: 'carb' },
  avena: { n: 'Avena en hojuelas (seca)', s: 'avena', k: 389, p: 16.9, c: 66, f: 6.9, tier: 1, raw: 1, kind: 'carb' },
  pan: { n: 'Pan integral', s: 'pan integral', k: 247, p: 13, c: 41, f: 3.4, tier: 1, raw: 1, kind: 'carb' },
  arepa: { n: 'Arepa de maíz', s: 'arepa', k: 195, p: 4, c: 40, f: 1.5, tier: 1, raw: 1, kind: 'carb' },
  banano: { n: 'Banano', s: 'banano', k: 89, p: 1.1, c: 23, f: 0.3, tier: 1, raw: 1, kind: 'carb' },
  verduras: { n: 'Verduras (zanahoria, brócoli, habichuela y tomate)', s: 'verduras', k: 30, p: 2, c: 6, f: 0.2, tier: 1, raw: 1.1, kind: 'veg' },
  zuquini: { n: 'Zuquini', s: 'zuquini', k: 17, p: 1.2, c: 3.1, f: 0.3, tier: 1, raw: 1.1, kind: 'veg' },
  aguacate: { n: 'Aguacate', s: 'aguacate', k: 160, p: 2, c: 9, f: 15, tier: 1, raw: 1, kind: 'fat', cap: 80 },
  mani: { n: 'Maní', s: 'maní', k: 567, p: 26, c: 16, f: 49, tier: 1, raw: 1, kind: 'fat', cap: 20 },
  aceite: { n: 'Aceite de oliva/vegetal', s: 'aceite', k: 884, p: 0, c: 0, f: 100, tier: 1, raw: 1, kind: 'fat', cap: 15 },
};
const MEAT = ['muslo', 'pechuga', 'molida', 'res', 'cerdo', 'pescado', 'atun', 'higado', 'corazon'];

/* ---------- Cuestionario ---------- */
export const QUESTIONS = [
  { k: 'budget', req: true, q: '¿Cuál es tu presupuesto de comida?', opts: [['economico', '💸 Económico'], ['medio', '⚖️ Medio'], ['libre', '🥩 Sin límite']] },
  { k: 'proteins', req: true, multi: true, q: '¿Qué proteínas comes o te gustan?', opts: [['pollo', 'Pollo'], ['molida', 'Carne molida'], ['res', 'Res'], ['cerdo', 'Cerdo'], ['pescado', 'Pescado'], ['atun', 'Atún'], ['huevo', 'Huevo'], ['visceras', 'Hígado/corazón'], ['legumbres', 'Lentejas/fríjol']] },
  { k: 'cook', req: true, q: '¿Cuánto tiempo tienes para cocinar por comida?', opts: [['rapido', '⚡ ≤ 15 min'], ['medio', '⏱ ~30 min'], ['largo', '👨‍🍳 Sin prisa']] },
  { k: 'fridge', req: true, q: '¿Desayunos y cenas listos en la nevera?', opts: [['si', '🧊 Sí, preparar y recalentar'], ['mixto', '🔀 Mixto'], ['no', '🍳 Cocino al momento']] },
  { k: 'style', req: true, q: '¿Cómo prefieres organizarte?', opts: [['batch', 'Batch Cooking'], ['hibrido', 'Híbrido'], ['dia', 'Cocina al Día'], ['libres', 'Macros Libres']] },
  { k: 'carbs', req: true, multi: true, q: '¿Qué carbohidratos prefieres o toleras mejor? (el resto no entra en tu menú)', opts: [['todo', '✅ Cualquiera'], ['arroz', 'Arroz'], ['papa', 'Papa'], ['platano', 'Plátano'], ['pasta', 'Pasta'], ['avena', 'Avena'], ['pan', 'Pan'], ['arepa', 'Arepa'], ['banano', 'Banano']] },
  { k: 'fats', req: true, multi: true, q: '¿Qué grasas prefieres o toleras mejor?', opts: [['todo', '✅ Cualquiera'], ['aguacate', 'Aguacate'], ['mani', 'Maní'], ['aceite', 'Aceite de oliva']] },
  { k: 'dislikes', q: 'Escribe los alimentos que ODIAS o te caen mal (opcional; ej. «odio el hígado y la avena, el pescado me cae pesado»)', text: true },
  { k: 'meals', req: true, q: '¿Cuántas comidas al día?', opts: [['3', '3'], ['4', '4'], ['5', '5']] },
  { k: 'restrict', q: 'Restricciones (opcional)', multi: true, opts: [['ninguna', 'Ninguna'], ['lacteos', 'Sin lácteos'], ['gluten', 'Sin gluten'], ['vegetariano', 'Vegetariano']] },
  { k: 'eatsout', q: '¿Comes corrientazo / en la calle? (opcional)', opts: [['si', 'Sí, seguido'], ['no', 'Casi nunca']] },
  { k: 'supps', q: 'Suplementos (opcional)', multi: true, opts: [['whey', 'Whey'], ['creatina', 'Creatina'], ['ninguno', 'Ninguno']] },
  { k: 'barriers', q: '¿Qué te hace fallar en la dieta? (opcional)', multi: true, opts: [['antojos', 'Antojos'], ['tiempo', 'Falta de tiempo'], ['fuera', 'Comer fuera'], ['cocinar', 'No sé cocinar'], ['dinero', 'Presupuesto'], ['hambre', 'Mucha hambre']] },
];
export const LABELS = { budget: 'presupuesto', proteins: 'proteínas', cook: 'tiempo de cocina', fridge: 'nevera', style: 'estilo', meals: 'comidas al día', carbs: 'carbohidratos', fats: 'grasas', dislikes: 'alimentos que no te gustan', restrict: 'restricciones', eatsout: 'comida en la calle', supps: 'suplementos', barriers: 'obstáculos' };
export const STEPS = [['profile', 'Perfil y objetivo'], ['budget', 'Presupuesto'], ['proteins', 'Proteínas'], ['cook', 'Tiempo'], ['fridge', 'Nevera'], ['style', 'Estilo'], ['carbs', 'Carbohidratos'], ['fats', 'Grasas'], ['meals', 'Comidas']];

const has = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '');
/** Claves obligatorias que faltan, en orden de pregunta. */
export function missing(prefs = {}, hasTarget = false) {
  const out = [];
  if (!hasTarget) out.push('profile');
  for (const [k] of STEPS.slice(1)) if (!has(prefs[k])) out.push(k);
  return out;
}
export const ready = (prefs, hasTarget) => missing(prefs, hasTarget).length === 0;

const ASK = {
  profile: 'Primero completa tu perfil (peso, altura, edad y objetivo) en la tarjeta de abajo: con eso calculo tus calorías y macros.',
  budget: '¿Qué presupuesto manejas para la comida: económico, medio o sin límite? Con eso elijo cortes de carne y alimentos que rindan.',
  proteins: '¿Qué proteínas comes o te gustan (pollo, carne molida, res, cerdo, pescado, atún, huevo, hígado/corazón, lentejas)? Dime también cuáles evitas.',
  cook: '¿Cuánto tiempo tienes para cocinar por comida: ≤15 min, ~30 min o sin prisa?',
  fridge: '¿Te sirve dejar desayunos y cenas listos en la nevera (overnight oats, pollo desmechado, bowls) para ganar rapidez?',
  style: '¿Cómo prefieres organizarte: batch cooking, híbrido, cocinar al día o macros libres?',
  carbs: '¿Qué carbohidratos prefieres o toleras mejor (arroz, papa, plátano, pasta, avena, pan, arepa, banano)? Dime también cuáles odias; si te da igual, escribe «cualquiera».',
  fats: '¿Qué grasas prefieres o toleras mejor (aguacate, maní, aceite de oliva)? Dime cuáles no soportas, o escribe «cualquiera».',
  meals: '¿Cuántas comidas haces al día: 3, 4 o 5?',
};
export const askFor = k => ASK[k] || '';

export function greeting(prefs, hasTarget) {
  if (ready(prefs, hasTarget)) return 'Tu perfil nutricional está completo. Abre «Tu Plan Nutricional» para ver tu estrategia, el menú de la semana y la lista de compras, o cuéntame qué quieres cambiar (presupuesto, proteínas, tiempo, nevera…).';
  return 'Soy tu nutricionista de AGRESSIVE LIFT. Antes de abrir tu plan necesito saber cómo vas a cumplir tu objetivo: tu presupuesto (¿económico?), qué proteínas comes (pollo, carne molida, huevo, hígado…), cuánto tiempo tienes para cocinar, si quieres desayunos y cenas listos en la nevera, tu estilo (batch cooking, híbrido…) y cuántas comidas haces. Puedes responder escribiendo o con los botones de abajo.';
}

/* ---------- Interpretación de texto libre ---------- */
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PROT_RX = { pollo: /pollo|pechuga|muslo/, molida: /molida/, res: /\bres\b|carne de res|bistec|sobrebarriga|churrasco|lomo de res/, cerdo: /cerdo|chuleta|costilla/, pescado: /pescado|tilapia|trucha|salmon|mojarra/, atun: /atun/, huevo: /huevo/, visceras: /higado|corazon|viscera|menudencia/, legumbres: /lenteja|frijol|garbanzo/ };
const FOOD_RX = { muslo: /muslo/, pechuga: /pechuga/, molida: /molida/, res: /\bres\b|bistec|lomo de res/, cerdo: /cerdo/, pescado: /pescado|tilapia/, atun: /atun/, huevo: /huevo/, higado: /higado/, corazon: /corazon/, lenteja: /lenteja/, frijol: /frijol/, whey: /whey/, yogur: /yogur/, leche: /leche/, arroz: /arroz/, papa: /\bpapa/, platano: /platano/, pasta: /pasta|espagueti/, avena: /avena/, pan: /\bpan\b/, arepa: /arepa/, banano: /banano/, zuquini: /zuquini|calabacin/, aguacate: /aguacate/, mani: /\bmani\b|cacahuate/, aceite: /aceite/ };
const POLLO_RX = /\bpollo\b/;
/** Alimentos que NO se usarán por gusto: lo que la persona odia (texto libre) + los carbohidratos/grasas que no eligió. */
export function derivedExcluded(prefs = {}) {
  const out = new Set();
  for (const [key, kind] of [['carbs', 'carb'], ['fats', 'fat']]) { const sel = prefs[key] || []; if (sel.length && !sel.includes('todo')) Object.entries(FOODS).forEach(([id, f]) => { if (f.kind === kind && !sel.includes(id)) out.add(id); }); }
  norm(prefs.dislikes || '').split(/[.;\n,]|\by\b/).forEach(seg => { if (!seg.trim()) return; for (const [id, rx] of Object.entries(FOOD_RX)) if (rx.test(seg)) out.add(id); if (POLLO_RX.test(seg)) { out.add('muslo'); out.add('pechuga'); } });
  return [...out];
}
/** Devuelve { prefs, changed:[claves] } sin mutar la entrada. */
export function parse(text, prefs = {}) {
  const t = norm(text), p = { ...prefs }, changed = new Set(), set = (k, v) => { if (JSON.stringify(p[k]) !== JSON.stringify(v)) { p[k] = v; changed.add(k); } };
  if (/econom|barato|presupuesto (bajo|ajustado|limitado)|poca plata|ahorrar|no tengo mucha plata/.test(t)) set('budget', 'economico');
  else if (/presupuesto medio|presupuesto normal/.test(t)) set('budget', 'medio');
  else if (/sin limite|no importa el precio|presupuesto alto|lo que sea/.test(t)) set('budget', 'libre');
  const prot = new Set(p.proteins || []);
  t.split(/[.;\n]/).forEach(seg => {
    const neg = /no como|no consumo|evito|no me gusta|sin (carne|pollo|res|cerdo|pescado|huevo|atun)/.test(seg);
    for (const [k, rx] of Object.entries(PROT_RX)) if (rx.test(seg)) { neg ? prot.delete(k) : prot.add(k); }
  });
  if ([...prot].sort().join() !== [...(p.proteins || [])].sort().join()) set('proteins', [...prot]);
  const pickFoods = (key, kind) => { // «prefiero arroz y papa», «odio la avena», «cualquiera»
    const cur = new Set(p[key] || []); let hit = false;
    if (/cualquiera|me da igual|como de todo|todo me gusta|todos me gustan/.test(t) && !new RegExp(kind === 'carb' ? 'carbohidrat' : 'grasa').test('')) { if (/cualquier|da igual/.test(t)) { cur.clear(); cur.add('todo'); hit = true; } }
    t.split(/[.;\n]/).forEach(seg => { const neg = /odio|no (me )?(gusta|como|soporto|tolero|cae)|evito|sin /.test(seg); for (const [id, f] of Object.entries(FOODS)) if (f.kind === kind && FOOD_RX[id]?.test(seg)) { if (neg && cur.has('todo')) { cur.delete('todo'); Object.entries(FOODS).forEach(([i2, f2]) => { if (f2.kind === kind) cur.add(i2); }); } else cur.delete('todo'); if (neg) cur.delete(id); else cur.add(id); hit = true; } });
    if (hit && [...cur].sort().join() !== [...(p[key] || [])].sort().join()) set(key, [...cur]);
  };
  if (/prefiero|me gusta|cualquiera|da igual|tolero|odio|no (me )?(gusta|como|soporto|cae)|evito/.test(t)) { if (p.carbs?.length || /arroz|papa|platano|pasta|avena|pan\b|arepa|banano|carbohidrat|cualquier|da igual/.test(t)) pickFoods('carbs', 'carb'); if (p.fats?.length || /aguacate|mani\b|aceite|grasa|cualquier|da igual/.test(t)) pickFoods('fats', 'fat'); }
  if (/odio|no soporto|me cae(n)? (mal|pesad)|no me gusta|asco/.test(t) && !changed.has('proteins')) { const old = (p.dislikes || '').trim(), add = String(text).trim().slice(0, 200); if (add && !old.includes(add)) set('dislikes', (old ? old + '; ' : '') + add); }
  const mins = /(\d{1,3})\s*(min|minutos)/.exec(t);
  if (mins) set('cook', +mins[1] <= 15 ? 'rapido' : +mins[1] <= 35 ? 'medio' : 'largo');
  else if (/rapido|poco tiempo|sin tiempo|afan/.test(t)) set('cook', 'rapido');
  else if (/con calma|me gusta cocinar|tengo tiempo/.test(t)) set('cook', 'largo');
  if (/cocino al momento|fresco cada dia|no me sirve la nevera/.test(t)) set('fridge', 'no');
  else if (/nevera|tupper|meal prep|overnight|dejar listo|recalent/.test(t)) set('fridge', 'si');
  else if (/\bmixto\b/.test(t)) set('fridge', 'mixto');
  if (/batch\s*cooking|cocinar.*semana|cocino.*semana/.test(t)) { set('style', 'batch'); if (!p.fridge) set('fridge', 'si'); }
  else if (/cocina al dia|cocino.*diario|cada dia/.test(t)) set('style', 'dia');
  else if (/hibrid/.test(t)) set('style', 'hibrido');
  else if (/macros? libres|contar macros|flexible/.test(t)) set('style', 'libres');
  const meals = /\b([3-5])\s*comidas/.exec(t); if (meals) set('meals', +meals[1]);
  const rs = new Set(p.restrict || []);
  if (/vegetarian/.test(t)) rs.add('vegetariano'); if (/sin lacteos|intoleran\w* a la lactosa|no (tomo|consumo) leche/.test(t)) rs.add('lacteos');
  if (/celiac|sin gluten/.test(t)) rs.add('gluten'); if (/ninguna restriccion|como de todo|no tengo alergias/.test(t)) { rs.clear(); rs.add('ninguna'); }
  if ([...rs].sort().join() !== [...(p.restrict || [])].sort().join()) set('restrict', [...rs]);
  if (/corrientazo|calle|restaurante|domicilio|almuerzo ejecutivo/.test(t)) set('eatsout', 'si');
  const ss = new Set(p.supps || []); if (/whey|proteina en polvo/.test(t)) ss.add('whey'); if (/creatina/.test(t)) ss.add('creatina'); if (/no uso suplementos|ningun suplemento/.test(t)) { ss.clear(); ss.add('ninguno'); }
  if ([...ss].sort().join() !== [...(p.supps || []).sort()].join()) set('supps', [...ss]);
  const bs = new Set(p.barriers || []);
  [['antojos', /antojo|dulce/], ['tiempo', /sin tiempo|poco tiempo|trabajo mucho/], ['fuera', /comer fuera|salidas|corrientazo/], ['cocinar', /no se cocinar|no cocino/], ['dinero', /poca plata|sin plata|no me alcanza|presupuesto ajustado/], ['hambre', /hambre|ansiedad/]].forEach(([k, rx]) => rx.test(t) && bs.add(k));
  if ([...bs].sort().join() !== [...(p.barriers || [])].sort().join()) set('barriers', [...bs]);
  return { prefs: p, changed: [...changed] };
}
/** Respuesta de entrevista: reconoce lo entendido y pregunta lo siguiente. */
export function interviewReply(changed, prefs, hasTarget) {
  const m = missing(prefs, hasTarget), ack = changed.length ? `Anotado (${changed.map(k => LABELS[k] || k).join(', ')}). ` : '';
  if (!m.length) return `${ack}¡Perfil completo! Ya puedes abrir «Tu Plan Nutricional»: te armé estrategia, menú semanal y lista de compras. Si quieres, aún puedes decirme restricciones, suplementos o qué te hace fallar (antojos, falta de tiempo…).`;
  return `${ack}${ASK[m[0]]}${m.length > 1 ? ` (Me faltan ${m.length} datos.)` : ''}`;
}

/* ---------- Generador de menú ---------- */
const m100 = (food, g) => ({ k: food.k * g / 100, p: food.p * g / 100, c: food.c * g / 100, f: food.f * g / 100 });
const TPL = [
  { id: 'd-oats', slot: 'desayuno', name: 'Overnight oats con proteína', prep: 'nevera', mins: 3, p: { food: 'whey' }, c: 'avena', fixed: [['leche', 200], ['banano', 100]], fat: 'mani', tags: ['dairy', 'whey'] },
  { id: 'd-yogur', slot: 'desayuno', name: 'Bowl de yogur griego con avena y banano', prep: 'nevera', mins: 3, p: { food: 'yogur' }, c: 'avena', fixed: [['banano', 100]], fat: 'mani', tags: ['dairy'] },
  { id: 'd-duros', slot: 'desayuno', name: 'Huevos duros con pan integral y fruta', prep: 'nevera', mins: 3, p: { food: 'huevo' }, c: 'pan', fixed: [['banano', 100]], fat: 'mani', tags: ['egg', 'gluten'] },
  { id: 'd-calentado', slot: 'desayuno', name: 'Calentado: arroz, fríjol y huevo', prep: 'nevera', mins: 5, p: { food: 'huevo' }, c: 'arroz', fixed: [['frijol', 100]], fat: 'mani', tags: ['egg'] },
  { id: 'd-arepa', slot: 'desayuno', name: 'Arepa con {P} desmechado', prep: 'nevera', mins: 4, p: { pool: true, only: ['muslo', 'pechuga', 'res', 'cerdo', 'molida'] }, c: 'arepa', fixed: [['banano', 100]], fat: 'mani', tags: [] },
  { id: 'd-revueltos', slot: 'desayuno', name: 'Huevos revueltos con arepa y fruta', prep: 'cocinar', mins: 10, p: { food: 'huevo' }, c: 'arepa', fixed: [['banano', 100]], fat: 'aceite', tags: ['egg'] },
  { id: 'd-tostadas', slot: 'desayuno', name: 'Tostadas con huevo y aguacate', prep: 'cocinar', mins: 10, p: { food: 'huevo' }, c: 'pan', fixed: [['aguacate', 50]], tags: ['egg', 'gluten'] },
  { id: 'a-bowl', slot: 'almuerzo', name: 'Bowl de {P} con arroz y verduras', prep: 'nevera', mins: 4, p: { pool: true }, c: 'arroz', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'a-papa', slot: 'almuerzo', name: '{P} con papa y ensalada', prep: 'nevera', mins: 4, p: { pool: true }, c: 'papa', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'a-platano', slot: 'almuerzo', name: '{P} con plátano maduro y ensalada', prep: 'cocinar', mins: 25, p: { pool: true }, c: 'platano', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'a-pasta', slot: 'almuerzo', name: 'Pasta con {P} y verduras', prep: 'cocinar', mins: 20, p: { pool: true }, c: 'pasta', fixed: [['verduras', 150]], fat: 'aceite', tags: ['gluten'] },
  { id: 'a-corrientazo', slot: 'almuerzo', name: 'Corrientazo ajustado: {P}, arroz, fríjoles y ensalada', prep: 'fuera', mins: 0, p: { pool: true, only: ['muslo', 'pechuga', 'res', 'cerdo', 'molida', 'pescado'] }, c: 'arroz', fixed: [['frijol', 80], ['verduras', 100]], tags: [], needs: 'eatsout' },
  { id: 'a-higado', slot: 'almuerzo', name: 'Hígado encebollado con arroz y verduras', prep: 'cocinar', mins: 20, p: { pool: true, only: ['higado'] }, c: 'arroz', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'a-lentejas', slot: 'almuerzo', name: 'Lentejas con arroz y {P}', prep: 'nevera', mins: 4, p: { pool: true }, c: 'arroz', fixed: [['lenteja', 150], ['verduras', 100]], fat: 'aceite', tags: [], needs: 'legumbres' },
  { id: 'a-lentejas-veg', slot: 'almuerzo', name: 'Lentejas con arroz y verduras', prep: 'nevera', mins: 4, p: { food: 'lenteja' }, c: 'arroz', fixed: [['verduras', 150]], fat: 'aceite', tags: [], needs: 'veg' },
  { id: 'c-bowl', slot: 'cena', name: 'Bowl de {P}, arroz y vegetales salteados', prep: 'nevera', mins: 4, p: { pool: true }, c: 'arroz', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'c-papa', slot: 'cena', name: '{P} con papa al horno y ensalada', prep: 'nevera', mins: 4, p: { pool: true }, c: 'papa', fixed: [['verduras', 150]], fat: 'aceite', tags: [] },
  { id: 'c-salteado', slot: 'cena', name: 'Salteado rápido de {P} con verduras y arroz', prep: 'rapido', mins: 15, p: { pool: true }, c: 'arroz', fixed: [['verduras', 200]], fat: 'aceite', tags: [] },
  { id: 'c-tortilla', slot: 'cena', name: 'Tortilla de huevos con verduras y papa', prep: 'rapido', mins: 12, p: { food: 'huevo' }, c: 'papa', fixed: [['verduras', 150]], fat: 'aceite', tags: ['egg'] },
  { id: 'c-atun', slot: 'cena', name: 'Atún con arroz y ensalada', prep: 'rapido', mins: 5, p: { food: 'atun' }, c: 'arroz', fixed: [['verduras', 120]], fat: 'aceite', tags: [], needs: 'atun' },
  { id: 'c-zuquini', slot: 'cena', name: 'Zuquini salteado con {P}', prep: 'rapido', mins: 15, p: { pool: true, only: ['corazon', 'higado', 'molida'] }, c: 'arroz', fixed: [['zuquini', 250]], fat: 'aceite', tags: [] },
  { id: 's-yogur', slot: 'snack', name: 'Yogur griego con banano', prep: 'nevera', mins: 1, p: { food: 'yogur' }, c: 'banano', fixed: [], fat: 'mani', tags: ['dairy'] },
  { id: 's-batido', slot: 'snack', name: 'Batido de whey con banano y leche', prep: 'rapido', mins: 3, p: { food: 'whey' }, c: 'banano', fixed: [['leche', 200]], fat: 'mani', tags: ['dairy', 'whey'] },
  { id: 's-huevos', slot: 'snack', name: 'Huevos duros con fruta', prep: 'nevera', mins: 2, p: { food: 'huevo' }, c: 'banano', fixed: [], fat: 'mani', tags: ['egg'] },
  { id: 's-atun', slot: 'snack', name: 'Atún con arepa', prep: 'rapido', mins: 3, p: { food: 'atun' }, c: 'arepa', fixed: [], fat: 'mani', tags: [], needs: 'atun' },
  { id: 's-sandwich', slot: 'snack', name: 'Sándwich de {P} desmechado', prep: 'nevera', mins: 3, p: { pool: true, only: ['muslo', 'pechuga', 'atun', 'res', 'cerdo'] }, c: 'pan', fixed: [], fat: 'mani', tags: ['gluten'] },
];

/* Recetas de preparación por plantilla. {P} = proteína del día. Las cantidades son las que muestra cada comida. */
const COOK_P = 'Sazona {P} con sal, ajo en polvo y pimienta. Cocínalo en sartén o airfryer hasta que no quede rosado por dentro (pollo/cerdo/molida: bien cocido, ~75 °C; res y pescado al punto que prefieras, pescado hasta que se desmenuce).';
const RECIPES = {
  'd-oats': ['En un frasco mezcla la avena con la leche y la whey hasta que no queden grumos.', 'Añade el banano en rodajas y el maní por encima.', 'Tapa y deja en la nevera mínimo 4 horas (ideal de un día para otro). Se come frío o tibio.'],
  'd-yogur': ['Pon el yogur griego en un bowl.', 'Agrega la avena y el banano en rodajas.', 'Termina con el maní picado. Listo en 3 min, sin cocinar.'],
  'd-duros': ['Cocina los huevos en agua hirviendo 10 min; pásalos a agua fría y pélalos.', 'Sirve con el pan integral y el banano.', 'Puedes dejar los huevos duros hechos en la nevera hasta 4 días.'],
  'd-calentado': ['Calienta el arroz y los fríjoles ya cocidos en una sartén con un chorrito de agua.', 'Aparte, fríe o revuelve los huevos en poco aceite hasta que cuajen.', 'Sirve todo junto y añade el maní o cebolla picada si quieres.'],
  'd-arepa': ['Cocina {P}, desmenúzalo y mézclalo con sal y un poco de cebolla.', 'Asa la arepa en sartén antioquia o tostadora hasta que dore.', 'Rellena con {P} desmechado y acompaña con el banano.'],
  'd-revueltos': ['Bate los huevos con sal y pimienta.', 'Calienta el aceite a fuego medio y vierte los huevos; mueve suave hasta que cuajen.', 'Asa la arepa y sirve con el banano.'],
  'd-tostadas': ['Tuesta el pan.', 'Cocina los huevos al gusto (fritos o revueltos) en poco aceite.', 'Pon el aguacate en láminas sobre el pan y los huevos encima, con sal y limón.'],
  'a-bowl': ['Cocina o recalienta el arroz.', COOK_P, 'Saltea las verduras 4-5 min con el aceite, sal y ajo.', 'Arma el bowl: arroz, verduras y {P} encima.'],
  'a-papa': [COOK_P, 'Cocina la papa en agua con sal 15-20 min hasta que se pinche fácil (o al horno a 200 °C unos 30 min).', 'Prepara una ensalada con las verduras, limón y sal. Sirve todo junto.'],
  'a-platano': [COOK_P, 'Corta el plátano maduro en rodajas y dóralo en sartén antiadherente con una gota de aceite, 3 min por lado.', 'Acompaña con la ensalada de verduras y limón.'],
  'a-pasta': ['Cuece la pasta en agua con sal según el paquete y escúrrela.', COOK_P + ' Córtalo en trozos.', 'Saltea las verduras con el aceite 4 min, une la pasta y {P} y mezcla a fuego bajo 1 min.'],
  'a-corrientazo': ['Pide el corrientazo con {P} a la plancha o asado (evita el frito).', 'Pide arroz y fríjoles en porción normal y ensalada extra; la sopa y el jugo con azúcar déjalos fuera.', 'Compara con las cantidades de la comida: si el plato viene más grande, deja parte del arroz.'],
  'a-higado': ['Corta el hígado en tiras y sazónalo con sal, pimienta y ajo; déjalo reposar 10 min.', 'Sofríe la cebolla en tiras con el aceite a fuego medio hasta que ablande.', 'Agrega el hígado y cocínalo 3-4 min por lado, bien cocido pero sin pasarlo (se endurece).', 'Sirve con el arroz y las verduras al vapor o salteadas.'],
  'a-lentejas': ['Remoja las lentejas 30 min y cuécelas en agua nueva con sal 25-30 min hasta que estén tiernas (en olla a presión ~15 min).', COOK_P, 'Sirve las lentejas sobre el arroz con {P} y las verduras.'],
  'a-lentejas-veg': ['Remoja las lentejas 30 min y cuécelas en agua nueva con sal 25-30 min (olla a presión ~15 min).', 'Sofríe cebolla y tomate con el aceite y mézclalo con las lentejas.', 'Sirve con arroz y las verduras.'],
  'c-bowl': ['Recalienta el arroz.', COOK_P, 'Saltea las verduras con el aceite y sal 4-5 min.', 'Arma el bowl con arroz, verduras y {P}.'],
  'c-papa': ['Corta la papa en cubos, mézclala con una gota de aceite y sal y hornéala a 200 °C 30 min (o hiérvela 15-20 min).', COOK_P, 'Sirve con la ensalada de verduras y limón.'],
  'c-salteado': ['Corta {P} en tiras o cubos pequeños y las verduras en trozos finos.', 'Calienta el aceite a fuego alto y saltea {P} 4-5 min hasta que esté bien cocido.', 'Agrega las verduras 3 min más con sal, ajo y un chorrito de salsa de soya si quieres.', 'Sirve sobre el arroz recién calentado.'],
  'c-tortilla': ['Bate los huevos con sal y pimienta.', 'Cocina la papa en cubos pequeños (hervida o en microondas) y saltea las verduras 3 min.', 'Vierte los huevos sobre la papa y las verduras en sartén con el aceite; tapa y cocina a fuego bajo 5-6 min hasta cuajar, voltea y 1 min más.'],
  'c-atun': ['Escurre el atún y mézclalo con limón, sal y pimienta.', 'Calienta el arroz y arma la ensalada con las verduras.', 'Sirve el atún sobre el arroz con la ensalada.'],
  'c-zuquini': ['Corta el zuquini en medias lunas y {P} en trozos pequeños.', 'Saltea {P} con el aceite a fuego alto hasta que esté bien cocido (hígado/corazón 4-5 min).', 'Agrega el zuquini 4 min más con sal y ajo; sirve con el arroz.'],
  's-yogur': ['Pon el yogur griego en un bowl, agrega el banano en rodajas y el maní picado. Listo.'],
  's-batido': ['Licúa la leche, el banano y la whey 30 segundos.', 'Añade el maní y licúa 10 segundos más. Tómalo frío.'],
  's-huevos': ['Cocina los huevos en agua hirviendo 10 min, enfríalos y pélalos.', 'Cómelos con la fruta. Puedes dejarlos listos en la nevera hasta 4 días.'],
  's-atun': ['Escurre el atún y mézclalo con limón y sal.', 'Asa la arepa y rellénala con el atún.'],
  's-sandwich': [COOK_P, 'Desmenúzalo con un tenedor y mézclalo con sal y un poco de limón.', 'Tuesta el pan y arma el sándwich con {P} desmechado.'],
};
const TIMES = { 3: ['8:00', '13:00', '19:30'], 4: ['8:00', '13:00', '16:30', '19:30'], 5: ['7:30', '10:30', '13:00', '16:30', '19:30'] };
const SLOTS = { 3: [['desayuno', .27], ['almuerzo', .38], ['cena', .35]], 4: [['desayuno', .25], ['almuerzo', .33], ['snack', .12], ['cena', .30]], 5: [['desayuno', .22], ['snack', .12], ['almuerzo', .30], ['snack', .10], ['cena', .26]] };
const OPT2FOODS = { pollo: ['muslo', 'pechuga'], molida: ['molida'], res: ['res'], cerdo: ['cerdo'], pescado: ['pescado'], atun: ['atun'], huevo: ['huevo'], visceras: ['higado', 'corazon'], legumbres: ['lenteja', 'frijol'] };

/** Pool de proteínas según gustos, presupuesto y restricciones. Devuelve { pool, excluded, added }. */
export function proteinPool(prefs = {}) {
  const maxTier = { economico: 1, medio: 2, libre: 3 }[prefs.budget] || 2, veg = (prefs.restrict || []).includes('vegetariano');
  const chosen = (prefs.proteins || []).flatMap(o => OPT2FOODS[o] || []);
  const exl = [...(prefs.excluded || []), ...derivedExcluded(prefs)]; let want = chosen.filter(id => !(veg && MEAT.includes(id)) && !exl.includes(id));
  const ok = want.filter(id => FOODS[id].tier <= maxTier), excluded = want.filter(id => FOODS[id].tier > maxTier);
  let pool = [...ok], added = [];
  const cheap = veg ? ['huevo', 'lenteja', 'frijol'] : ['muslo', 'huevo', 'corazon', 'lenteja', 'higado'];
  for (const id of cheap) { if (pool.length >= 3) break; if (!pool.includes(id) && FOODS[id].tier <= maxTier && !(veg && MEAT.includes(id)) && !exl.includes(id)) { pool.push(id); added.push(id); } }
  pool.sort((a, b) => FOODS[a].tier - FOODS[b].tier);
  return { pool, excluded, added };
}

function solve(tpl, pFood, cFood, T, pool) {
  const P = FOODS[pFood], C = FOODS[cFood];
  const fixed = tpl.fixed.map(([id, g]) => [id, g]);
  const fx = fixed.reduce((a, [id, g]) => { const m = m100(FOODS[id], g); return { p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { p: 0, c: 0, f: 0 });
  const rp = T.p - fx.p, rc = T.c - fx.c, a = P.p / 100, b = C.p / 100, c1 = P.c / 100, d = C.c / 100, det = a * d - b * c1;
  let gP, gC;
  if (Math.abs(det) > 1e-6) { gP = (rp * d - b * rc) / det; gC = (a * rc - c1 * rp) / det; } else { gP = rp / a; gC = rc / d; }
  if (gP < 0) { gP = 0; gC = rc / d; } if (gC < 0) { gC = 0; gP = rp / a; }
  const cap = { prot: 320, supp: 60, dairy: 400 };
  gP = Math.max(P.unit ? 50 : 20, Math.min(cap[P.kind] || 320, gP)); gC = Math.max(0, Math.min(cFood === 'avena' ? 120 : 420, gC));
  const rnd = (food, g) => food.unit ? Math.max(1, Math.round(g / food.unit)) * food.unit : food.kind === 'supp' ? Math.round(g / 5) * 5 : Math.round(g / 5) * 5;
  const items = [{ id: pFood, g: rnd(P, gP) }];
  if (gC >= 5) items.push({ id: cFood, g: rnd(C, gC) });
  fixed.forEach(([id, g]) => items.push({ id, g }));
  let tot = items.reduce((a, it) => { const m = m100(FOODS[it.id], it.g); return { k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { k: 0, p: 0, c: 0, f: 0 });
  if (tpl.fat && T.f - tot.f > 3) {
    const fd = FOODS[tpl.fat], g = Math.min(fd.cap || 15, Math.round((T.f - tot.f) / (fd.f / 100) / 5) * 5);
    if (g >= 5) { items.push({ id: tpl.fat, g }); const m = m100(fd, g); tot = { k: tot.k + m.k, p: tot.p + m.p, c: tot.c + m.c, f: tot.f + m.f }; }
  }
  return { items, tot };
}
const label = it => { const f = FOODS[it.id]; return f.unit ? `${it.g / f.unit} ${it.g / f.unit === 1 ? 'huevo' : 'huevos'} (${it.g} g)` : `${it.g} g ${f.n.toLowerCase().replace(' (polvo)', '').replace(' (seca)', '').replace(' (lata)', '')}`; };

/** Menú de 7 días. target = {kcal,p,c,f} base; seed rota las variantes. */
export function generateMenu(target, prefs = {}, seed = 0, opts = {}) {
  const COUNT = opts.count || 7, blockOf = opts.blockOf || (d => (d < 3 ? 0 : 1)); // blockOf: qué días comparten receta (se cocina una vez)
  const meals = +prefs.meals || 3, slots = SLOTS[meals] || SLOTS[3], { pool, excluded, added } = proteinPool(prefs);
  const rs = prefs.restrict || [], noDairy = rs.includes('lacteos') || false, noGluten = rs.includes('gluten'), whey = (prefs.supps || []).includes('whey');
  const eggOK = (prefs.proteins || []).includes('huevo') || !(prefs.proteins || []).length, atunOK = (prefs.proteins || []).includes('atun');
  const fridge = prefs.fridge || 'mixto', cookMax = { rapido: 15, medio: 30, largo: 999 }[prefs.cook] || 999, batch = prefs.style === 'batch';
  const veg = rs.includes('vegetariano'), ex = [...(prefs.excluded || []), ...derivedExcluded(prefs)]; // ex: alimentos que la persona quitó en «Elige tus alimentos»
  // Pool genérico: sin huevo/hígado/legumbres como proteína principal (cantidades poco realistas); solo si la plantilla lo pide o no hay otra.
  const poolFor = t => { const f = (list) => list.filter(id => (!t.p.only || t.p.only.includes(id)) && !(t.p.not || []).includes(id)); const base = f(pool.filter(id => !['huevo', 'higado', 'lenteja', 'frijol'].includes(id) || (t.p.only || []).includes(id))); return base.length || t.p.only ? base : f(pool); };
  const allow = t => {
    if (t.tags.includes('dairy') && noDairy) return false; if (t.tags.includes('gluten') && noGluten) return false;
    if (t.tags.includes('whey') && !whey) return false; if (t.tags.includes('egg') && !eggOK) return false;
    if (t.needs === 'eatsout' && prefs.eatsout !== 'si') return false; if (t.needs === 'atun' && !atunOK) return false;
    if (t.needs === 'legumbres' && !(prefs.proteins || []).includes('legumbres')) return false; if (t.needs === 'veg' && !veg) return false;
    if (t.p.food && ex.includes(t.p.food)) return false; if (ex.includes(t.c)) return false; if (t.fixed.some(([id]) => ex.includes(id) && id !== 'verduras')) return false;
    if (t.p.pool && !poolFor(t).length) return false;
    return true;
  };
  const pick = slot => {
    let list = TPL.filter(t => t.slot === slot && allow(t));
    const step = (fn) => { const l = list.filter(fn); if (l.length) list = l; };
    step(t => t.prep === 'fuera' || t.mins <= cookMax || t.prep === 'nevera');
    if ((fridge === 'si') && (slot === 'desayuno' || slot === 'cena' || slot === 'snack')) step(t => t.prep === 'nevera');
    else if (fridge === 'no') step(t => t.prep !== 'nevera');
    return list;
  };
  const days = [];
  for (let d = 0; d < COUNT; d++) {
    const dayMeals = slots.map(([slot, fr], si) => {
      const list = pick(slot); if (!list.length) return null;
      const blocked = (fridge === 'si' && ['desayuno', 'cena', 'snack'].includes(slot)) || (batch && slot !== 'snack'), bi = blocked ? blockOf(d) : d;
      const tpl = list[(bi + seed + si) % list.length];
      let pf = tpl.p.food;
      if (tpl.p.pool) { const p = poolFor(tpl); pf = p[(bi + seed * 2 + si) % p.length]; }
      const T = { p: target.p * fr, c: target.c * fr, f: target.f * fr };
      const tpl2 = ex.length ? { ...tpl, fixed: tpl.fixed.filter(([id]) => !ex.includes(id)), fat: ex.includes(tpl.fat) ? null : tpl.fat } : tpl;
      const { items, tot } = solve(tpl2, pf, tpl2.c, T, pool);
      return { slot, time: (TIMES[slots.length] || [])[si] || '', id: tpl.id, name: (n => n.charAt(0).toUpperCase() + n.slice(1))(tpl.name.replace('{P}', FOODS[pf].s)), prep: tpl.prep, mins: tpl.mins, steps: vegSteps((RECIPES[tpl.id] || []).map(x => x.replace(/\{P\}/g, FOODS[pf].s))), items: items.map(it => ({ id: it.id, g: it.g, text: label(it) })), k: Math.round(tot.k), p: Math.round(tot.p), c: Math.round(tot.c), f: Math.round(tot.f) };
    }).filter(Boolean);
    days.push(dayMeals);
  }
  const notes = [];
  if (excluded.length) notes.push(`Por presupuesto dejé fuera: ${[...new Set(excluded.map(id => FOODS[id].s))].join(', ')}.`);
  if (added.length) notes.push(`Añadí opciones económicas para dar variedad: ${added.map(id => FOODS[id].s).join(', ')}.`);
  return { days, notes, prep: prepPlan(days) };
}
/** Plan de cocina de domingo: recetas "de nevera" distintas de la semana. */
function prepPlan(days) {
  const seen = new Map();
  days.forEach((ms, d) => ms.forEach(m => { if (m.prep === 'nevera') { const key = m.slot + '|' + m.name; if (!seen.has(key)) seen.set(key, { m, days: [] }); seen.get(key).days.push(d); } }));
  const D = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  return [...seen.values()].map(({ m, days }) => `${m.name} → ${days.map(i => D[i]).join(', ')} (${m.slot})`);
}
/** Lista de compras (peso crudo aproximado). */
export function groceries(menu) {
  const tot = {};
  menu.days.forEach(ms => ms.forEach(m => m.items.forEach(it => { tot[it.id] = (tot[it.id] || 0) + it.g * (FOODS[it.id].raw || 1); })));
  const veg = tot.verduras; if (veg) { delete tot.verduras; vegSplit(veg).forEach(([n, g]) => { tot[vegId(n)] = g; }); } // zanahoria, brócoli… por separado: se compra cada una
  return Object.entries(tot).map(([id, g]) => {
    const vn = id.startsWith('veg-') ? VEG_MIX.find(([n]) => vegId(n) === id)[0] : null, f = vn ? { ...FOODS.verduras, n: vn } : FOODS[id], rounded = Math.ceil(g / 50) * 50;
    return { id, need: f.unit ? Math.ceil(g / f.unit) : rounded, group: f.kind, n: f.unit ? `${f.n}` : f.n, amount: f.unit ? `${Math.ceil(g / f.unit)} huevos` : rounded >= 1000 ? `${(rounded / 1000).toFixed(rounded % 1000 ? 2 : 0).replace(/0$/, '')} kg` : `${rounded} g`, tier: f.tier };
  }).sort((a, b) => ['prot', 'supp', 'dairy', 'carb', 'veg', 'fat'].indexOf(a.group) - ['prot', 'supp', 'dairy', 'carb', 'veg', 'fat'].indexOf(b.group));
}

/* ---------- Estrategia personalizada ---------- */
export function strategy({ target, prefs = {}, goal = 'maint', trainDays = 3 }) {
  const out = [], meals = +prefs.meals || 3, perMeal = Math.round(target.p / meals);
  out.push({ cut: `Definición: déficit moderado (≈20 %) con proteína alta (${target.p} g). Ritmo objetivo: perder ~0.5–0.7 % del peso por semana; si tu peso no se mueve 2 semanas, la auditoría ajusta hasta 250 kcal.`,
    maint: `Mantenimiento: ${target.kcal} kcal estables; usa el peso semanal solo para detectar derivas.`, bulk: `Volumen limpio (+10 %): sube ~0.25 % del peso por semana; si subes más rápido, es grasa y la auditoría recorta calorías.` }[goal]);
  const hrs = (TIMES[meals] || TIMES[3]).map(h => { const [a, b] = h.split(':').map(Number); return `${((a + 11) % 12) + 1}:${String(b).padStart(2, '0')} ${a < 12 ? 'a. m.' : 'p. m.'}`; }).join(' · ');
  out.push(`⏰ Horario sugerido (${meals} comidas): ${hrs} → deja 3-5 h entre comidas, con ~${perMeal} g de proteína en cada una; la comida previa al entreno 1.5-3 h antes y una con proteína + carbohidrato dentro de las 2 h después. ${{ cut: 'En definición, lleva algo más de proteína a la cena para controlar el hambre y haz la última comida ≥2 h antes de dormir.', maint: '', bulk: 'En volumen no te saltes comidas; si cuesta llegar a las calorías, suma un batido entre comidas.' }[goal] || ''}`);
  out.push(`Reparte ${target.p} g de proteína en ${meals} comidas (≈${perMeal} g cada una). Esa es la clave para conservar/ganar músculo.`);
  if (prefs.budget === 'economico') out.push('Presupuesto económico: tu base son huevo, muslo de pollo, hígado/corazón de res, lentejas, fríjoles, arroz y papa — las proteínas más baratas por gramo. Compra la carne en bandeja grande, porciónala y congela.');
  else if (prefs.budget === 'medio') out.push('Presupuesto medio: alterna pechuga, carne molida y pescado con huevo y legumbres para equilibrar costo y variedad.');
  else if (prefs.budget === 'libre') out.push('Sin límite de presupuesto: prioriza cortes magros (pechuga, res magra, pescado) para ajustar grasa con precisión.');
  if (prefs.fridge === 'si' || prefs.style === 'batch') out.push('Nevera: cocina 1–2 veces por semana (p. ej. domingo y miércoles) y deja desayunos/cenas en recipientes. Carne y arroz cocidos duran 3–4 días refrigerados; congela lo que pasa de ese día.');
  else if (prefs.fridge === 'mixto') out.push('Mixto: deja listos solo desayuno y una cena (overnight oats, pollo desmechado) y cocina fresco el almuerzo.');
  if (prefs.cook === 'rapido') out.push('Poco tiempo: el menú prioriza comidas de ≤15 min o recalentables en 3–5 min.');
  if (prefs.eatsout === 'si') out.push('Corrientazo: pide la proteína doble, arroz a la mitad, fríjoles o ensalada extra, y cambia el jugo azucarado por agua. Regístralo como estimación.');
  const B = { antojos: 'Antojos: deja 150–200 kcal libres al día (banano con yogur o una porción pequeña de lo que se te antoja) en vez de prohibírtelo.', tiempo: 'Falta de tiempo: congela porciones sueltas y ten siempre atún, huevos y yogur como plan B de 5 minutos.', fuera: 'Comer fuera: decide la comida antes de llegar y pide proteína + verdura primero.', cocinar: 'No sabes cocinar: empieza con 2 recetas base (bowl de pollo con arroz y huevos revueltos) y repítelas dos semanas.', dinero: 'Dinero: planifica con la lista de compras de abajo y evita comprar por impulso.', hambre: 'Mucha hambre: sube verduras y fruta (volumen), toma agua y deja la proteína en cada comida.' };
  (prefs.barriers || []).forEach(k => B[k] && out.push(B[k]));
  if ((prefs.supps || []).includes('whey')) out.push('Whey: úsalo para completar proteína (snack o desayuno); no reemplaza comida real.');
  if ((prefs.supps || []).includes('creatina')) out.push('Creatina: 3–5 g al día, cualquier hora; toma suficiente agua.');
  out.push(`Entrenas ${trainDays} días/semana: pon la comida con más carbohidrato 1–2 h antes de entrenar y proteína en las 2 h posteriores.`);
  return out;
}


/* ---------- v32: alimentos disponibles por presupuesto y selector «Elige tus alimentos» ---------- */
export const GROUPS = [['prot', 'Proteínas'], ['dairy', 'Lácteos'], ['supp', 'Suplementos'], ['carb', 'Carbohidratos'], ['veg', 'Verduras'], ['fat', 'Grasas']];
/** Opción del cuestionario (pollo, huevo…) a la que pertenece un alimento. */
export const optionOf = id => Object.keys(OPT2FOODS).find(o => OPT2FOODS[o].includes(id));
/** Qué alimentos entran en cada presupuesto (nombres cortos por grupo); null si aún no eligió presupuesto. */
export function budgetFoods(b) {
  const max = { economico: 1, medio: 2, libre: 3 }[b]; if (!max) return null;
  const out = {}; for (const [kind, label] of GROUPS) out[label] = Object.values(FOODS).filter(f => f.kind === kind && f.tier <= max).map(f => f.s);
  return out;
}
/** Todos los alimentos agrupados con su estado. why: 'budget' (fuera de presupuesto), 'diet' (restricción), 'pick' (no elegido aún), '' (disponible). off = no se usará. */
export function foodChoices(prefs = {}) {
  const maxTier = { economico: 1, medio: 2, libre: 3 }[prefs.budget] || 2, rs = prefs.restrict || [], ex = [...(prefs.excluded || []), ...derivedExcluded(prefs)], veg = rs.includes('vegetariano'), pool = new Set(proteinPool(prefs).pool);
  return GROUPS.map(([kind, label]) => ({ kind, label, items: Object.entries(FOODS).filter(([, f]) => f.kind === kind).map(([id, f]) => {
    let why = '';
    if (f.tier > maxTier) why = 'budget';
    else if (kind === 'dairy' && rs.includes('lacteos')) why = 'diet';
    else if ((id === 'pan' || id === 'pasta') && rs.includes('gluten')) why = 'diet';
    else if (veg && MEAT.includes(id)) why = 'diet';
    else if (kind === 'prot' && !pool.has(id)) why = ex.includes(id) ? '' : 'pick';
    else if (id === 'whey' && !(prefs.supps || []).includes('whey')) why = 'pick';
    return { id, n: f.n, tier: f.tier, why, off: !!why || ex.includes(id) };
  }) }));
}
/** Comidas del día que NO se pudieron armar con las exclusiones actuales (lista vacía = todo bien). */
export function checkMenu(target, prefs = {}) {
  try {
    const m = generateMenu(target, prefs, 0, { count: 1 }), want = {}, got = {};
    (SLOTS[+prefs.meals || 3] || SLOTS[3]).forEach(([sl]) => { want[sl] = (want[sl] || 0) + 1; });
    (m.days[0] || []).forEach(x => { got[x.slot] = (got[x.slot] || 0) + 1; });
    return Object.keys(want).filter(sl => (got[sl] || 0) < want[sl]);
  } catch { return []; }
}
