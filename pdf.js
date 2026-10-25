// Generador de PDF sin dependencias ni red: buildMonthPdf(data) → Uint8Array.
// Usa Helvetica estándar (WinAnsi): los emojis y símbolos fuera de Latin-1 se limpian o se reemplazan.
const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M, TOP = H - 52, BOT = 52;
const COL = { ink: [.07, .07, .08], mut: [.36, .36, .4], red: [.86, .08, .22], band: [.93, .93, .95], white: [1, 1, 1], line: [.8, .8, .84] };

/* Anchos Helvetica / Helvetica-Bold (unidades /1000) para ASCII 32..126 */
const HV = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
const HB = '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);

const SUB = { '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '−': '-', '…': '...', '≈': '~', '“': '"', '”': '"', '‘': "'", '’': "'", '‹': '<', '›': '>' };
/** Deja solo caracteres que Helvetica/WinAnsi puede dibujar. */
const clean = s => String(s ?? '')
  .replace(/[≤≥→←−…≈“”‘’‹›]/g, c => SUB[c])
  .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D\u20E3]/gu, '')
  .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2022\u20AC]/g, '')
  .replace(/\s+/g, ' ').trim();
const BYTE = { 0x2013: 0x96, 0x2014: 0x97, 0x2022: 0x95, 0x20AC: 0x80 };
const enc = s => [...s].map(ch => { const c = ch.charCodeAt(0), b = c < 256 ? c : BYTE[c] || 63; return b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : String.fromCharCode(b); }).join('');
const cw = (ch, bold) => {
  const c = ch.charCodeAt(0), T = bold ? HB : HV;
  if (c >= 32 && c <= 126) return T[c - 32];
  if (c === 0x2013) return 556; if (c === 0x2014) return 1000; if (c === 0x2022) return 350; if (c === 0xB7 || c === 0xA0) return 278;
  const b = ch.normalize('NFD').charCodeAt(0); return b >= 32 && b <= 126 ? T[b - 32] : bold ? 611 : 556;
};
const tw = (s, size, bold) => [...s].reduce((a, ch) => a + cw(ch, bold), 0) * size / 1000;
const f = n => (Math.round(n * 100) / 100).toString();
const col = c => c.map(n => n.toFixed(3)).join(' ');

/** Parte el texto en líneas que quepan en maxW (corta palabras gigantes). */
function wrap(s, size, bold, maxW) {
  const out = []; let cur = '';
  for (let word of clean(s).split(' ')) {
    if (!word) continue;
    while (tw(word, size, bold) > maxW) { // palabra más ancha que la línea
      let i = 1; while (i < word.length && tw(word.slice(0, i + 1), size, bold) <= maxW) i++;
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, i)); word = word.slice(i);
    }
    const t = cur ? cur + ' ' + word : word;
    if (tw(t, size, bold) <= maxW) cur = t; else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

class Doc {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = TOP; }
  need(h) { if (this.y - h < BOT) this.newPage(); }
  rect(x, y, w, h, c) { this.ops.push(`${col(c)} rg ${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`); }
  hline(x1, x2, y, c, w = 0.5) { this.ops.push(`${col(c)} RG ${w} w ${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S`); }
  txt(x, y, s, size, bold, c) { s = clean(s); if (s) this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(c)} rg ${f(x)} ${f(y)} Td (${enc(s)}) Tj ET`); }
  txtR(xr, y, s, size, bold, c) { s = clean(s); this.txt(xr - tw(s, size, bold), y, s, size, bold, c); }
  base(lh, size) { return this.y + (lh - size) / 2 + size * 0.21; } // baseline dentro de la caja de línea
  /** Párrafo con salto de línea automático y salto de página entre líneas. */
  para(s, o = {}) {
    const { size = 9.5, bold = false, color = COL.ink, indent = 0, lead = 1.35, after = 3, bullet = false } = o;
    const pad = bullet ? 11 : 0, x = M + indent + pad, lh = size * lead;
    wrap(s, size, bold, CW - indent - pad).forEach((l, i) => {
      this.need(lh); this.y -= lh;
      if (i === 0 && bullet) this.txt(M + indent + 1, this.base(lh, size), '•', size, true, COL.red);
      this.txt(x, this.base(lh, size), l, size, bold, color);
    });
    this.y -= after;
  }
  hOf(s, size, bold, w, lead = 1.35) { return wrap(s, size, bold, w).length * size * lead; }
  band(left, right, { h = 19, fill = COL.ink, fg = COL.white, size = 11, accent } = {}) {
    this.need(h + 30); const y0 = this.y - h;
    this.rect(M, y0, CW, h, fill); if (accent) this.rect(M, y0, 4, h, accent);
    const by = y0 + (h - size) / 2 + size * 0.21;
    this.txt(M + 11, by, left, size, true, fg);
    if (right) this.txtR(M + CW - 8, y0 + (h - (size - 2)) / 2 + (size - 2) * 0.21, right, size - 2, false, fg);
    this.y = y0 - 5;
  }
  h2(s) { this.need(34); this.y -= 8; this.txt(M, this.y - 12, s, 12, true, COL.red); this.y -= 17; this.hline(M, M + CW, this.y, COL.line); this.y -= 6; }

  meal(m) {
    const x = M + 8, w = CW - 8, items = clean(m.items), steps = (m.steps || []).map((s, i) => `${i + 1}. ${s}`);
    const h = 13 + 14 + this.hOf(items, 9, false, w, 1.3) + 12 + (steps.length ? 13 + steps.reduce((a, s) => a + this.hOf(s, 8.5, false, w - 10, 1.3), 0) : 0) + 8;
    this.need(Math.min(h, TOP - BOT - 10));
    this.y -= 13; const tag = [m.slot && clean(m.slot).toUpperCase(), m.time].filter(Boolean).join(' · ');
    this.txt(x, this.y + 2, tag, 8, true, COL.red); this.txtR(M + CW - 8, this.y + 2, m.where || '', 8, false, COL.mut);
    this.y -= 14; this.txt(x, this.y + 3, m.name, 10.5, true, COL.ink);
    this.y -= 1; wrap(items, 9, false, w).forEach(l => { this.y -= 11.7; this.txt(x, this.y + 3, l, 9, false, COL.mut); });
    this.y -= 12; this.txt(x, this.y + 3, `${m.k} kcal  ·  P ${m.p} g  ·  C ${m.c} g  ·  G ${m.f} g`, 8.5, true, COL.ink);
    if (steps.length) {
      this.y -= 13; this.txt(x, this.y + 3, 'Preparación', 8.5, true, COL.red);
      steps.forEach(s => wrap(s, 8.5, false, w - 10).forEach((l, i) => { this.need(11); this.y -= 11; this.txt(x + (i ? 10 : 0), this.y + 3, l, 8.5, false, COL.ink); }));
    }
    this.y -= 6; this.hline(M + 8, M + CW, this.y, COL.line, .4); this.y -= 2;
  }
  day(d) {
    const tr = /^Entreno/.test(d.train || '');
    this.need(110);
    this.band(`${d.name} ${d.date}`, d.tot ? `${d.tot.k} kcal · P ${d.tot.p} · C ${d.tot.c} · G ${d.tot.f}` : '', { h: 17, fill: COL.band, fg: COL.ink, size: 10.5, accent: tr ? COL.red : COL.line });
    if (d.train) this.para(d.train, { size: 9, bold: true, color: tr ? COL.red : COL.mut, indent: 8, after: 2 });
    (d.meals || []).forEach(m => this.meal(m));
    if (!(d.meals || []).length) this.para('Sin comidas planeadas este día.', { size: 9, color: COL.mut, indent: 8 });
    this.y -= 6;
  }
  groceries(list, label) {
    this.band(`Lista de compras · ${label}`, '', { h: 20 });
    const GL = { prot: 'Proteínas', supp: 'Suplementos', dairy: 'Lácteos', carb: 'Carbohidratos', veg: 'Verduras', fat: 'Grasas' }, colW = (CW - 16) / 2;
    for (const g of Object.keys(GL)) {
      const it = (list || []).filter(x => x.group === g); if (!it.length) continue;
      this.need(40); this.y -= 14; this.txt(M + 4, this.y + 2, GL[g], 9.5, true, COL.red); this.y -= 2;
      for (let i = 0; i < it.length; i += 2) {
        this.need(14); this.y -= 13;
        [it[i], it[i + 1]].forEach((x, k) => { if (!x) return; const x0 = M + 4 + k * (colW + 8), name = wrap(x.n, 9, false, colW - 66)[0];
          this.txt(x0, this.y + 2, name, 9, false, COL.ink); this.txtR(x0 + colW, this.y + 2, x.amount, 9, true, COL.ink); });
      }
    }
    this.y -= 8;
  }
  finish(title, range, name) { // encabezado, pie y numeración
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      this.ops = ops;
      if (i > 0) { this.rect(0, H - 8, W, 8, COL.red); this.txt(M, H - 26, 'AGRESSIVE LIFT', 8, true, COL.red); this.txtR(M + CW, H - 26, name, 8, false, COL.mut); }
      this.hline(M, M + CW, 38, COL.line); this.txt(M, 25, `Plan del mes · ${range}`, 8, false, COL.mut); this.txtR(M + CW, 25, `Pág. ${i + 1} de ${n}`, 8, false, COL.mut);
    });
  }
}

function cover(d, data) {
  const t = data.target || {};
  d.rect(0, H - 175, W, 175, COL.ink); d.rect(0, H - 180, W, 5, COL.red);
  d.txt(M, H - 78, 'AGRESSIVE LIFT', 30, true, COL.white);
  d.txt(M, H - 104, 'PLAN DEL MES', 15, true, COL.red);
  d.txt(M, H - 132, data.name || 'Atleta', 13, true, COL.white);
  d.txt(M, H - 150, `${data.range || ''}   ·   generado el ${data.generated || ''}`, 9.5, false, [.75, .75, .78]);
  d.y = H - 205;
  const bw = (CW - 24) / 4;
  [['kcal', 'CALORÍAS / DÍA'], ['p', 'PROTEÍNA (g)'], ['c', 'CARBOHIDRATOS (g)'], ['f', 'GRASAS (g)']].forEach(([k, lab], i) => {
    const x = M + i * (bw + 8); d.rect(x, d.y - 52, bw, 52, COL.band); d.rect(x, d.y - 52, bw, 3, COL.red);
    d.txt(x + 10, d.y - 30, String(t[k] ?? '-'), 19, true, COL.ink); d.txt(x + 10, d.y - 44, lab, 7, true, COL.mut);
  });
  d.y -= 66;
  if (data.training) { d.h2('Entrenamiento'); d.para(data.training, { size: 9.5 }); }
  if ((data.strategy || []).length) { d.h2('Tu estrategia'); data.strategy.forEach(s => d.para(s, { size: 9.5, bullet: true, after: 4 })); }
  if ((data.notes || []).length) { d.h2('Notas'); data.notes.forEach(s => d.para(s, { size: 9.5, bullet: true })); }
  d.h2('Cómo usar este plan');
  ['Cada semana trae su menú día por día, la lista de compras y el plan de cocina (qué cocinar y cuándo).', 'La preparación de cada receta aparece solo la primera vez que se repite en la semana.', 'Si un día se complica, usa las comidas rápidas del menú y no te saltes la proteína.', 'Los pesos y las calorías se auditan cada semana en la app: este PDF es la guía base del mes.']
    .forEach(s => d.para(s, { size: 9.5, bullet: true }));
}

export function buildMonthPdf(data = {}) {
  const d = new Doc();
  cover(d, data);
  (data.weeks || []).forEach((w, i) => {
    d.newPage();
    d.band(`Semana ${i + 1}  ·  ${w.label || ''}`, '', { h: 24, size: 13, accent: COL.red });
    if (w.summary) d.para(w.summary, { size: 9, color: COL.mut, after: 6 });
    (w.days || []).forEach(x => d.day(x));
    d.newPage(); d.groceries(w.groceries, `Semana ${i + 1}`);
    if ((w.cook || []).length) {
      d.band(`Plan de cocina · Semana ${i + 1}`, '', { h: 20 });
      w.cook.forEach(b => { d.para(`${b.day} · ${b.title}`, { size: 10, bold: true, color: COL.red, after: 2 }); (b.tasks || []).forEach(t => d.para(t, { size: 9, bullet: true, indent: 4, after: 2 })); d.y -= 4; });
    }
  });
  d.finish('Plan del mes', data.range || '', data.name || 'Atleta');

  // --- ensamblado del archivo PDF (todo en caracteres 0-255 → bytes) ---
  const n = d.pages.length; let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const off = [];
  const put = (id, body) => { off[id] = out.length; out += `${id} 0 obj\n${body}\nendobj\n`; };
  put(1, '<< /Type /Catalog /Pages 2 0 R >>');
  put(2, `<< /Type /Pages /Kids [${d.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`);
  put(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  put(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  d.pages.forEach((ops, i) => {
    const s = ops.join('\n');
    put(5 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`);
    put(6 + 2 * i, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  const info = 5 + 2 * n; put(info, `<< /Title (${enc(clean('AGRESSIVE LIFT - Plan del mes'))}) /Producer (AGRESSIVE LIFT) >>`);
  const xr = out.length; out += `xref\n0 ${info + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= info; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xr}\n%%EOF`;
  const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255;
  return u;
}
