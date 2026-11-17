// Edge Function "ai" — proxy seguro de AGRESSIVE LIFT hacia el modelo de IA.
// La app arma la petición completa (system + historial + mensaje, igual que en la llamada directa) y esta función
// solo guarda la clave como secreto, limita el tamaño y reenvía. Así ambos modos se comportan EXACTAMENTE igual
// (mismos comandos update_routine / update_macros / adjust_routine y análisis de fotos).
//
// Despliegue (elige UN proveedor; si están los dos, se usa Gemini y OpenAI queda de respaldo):
//   supabase secrets set GEMINI_API_KEY=AIza...     (opcional: GEMINI_MODEL=gemini-2.5-flash)
//   supabase secrets set OPENAI_API_KEY=sk-...      (opcional: OPENAI_MODEL=gpt-4o)
//   supabase functions deploy ai --no-verify-jwt
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const USERS = ['juani', 'sebastian'];
const MAX_BODY = 6_000_000, MAX_TEXT = 40_000, MAX_MSGS = 12;

type Img = { mime: string; b64: string };
type Msg = { role: 'system' | 'user' | 'assistant'; content: string; image?: Img };
type Opts = { isMeal?: boolean; vision?: boolean; deep?: boolean; fast?: boolean };

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: CORS });
const fail = (m: string, status = 400) => json({ error: m }, status);

function clean(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_MSGS - 1).map((m: any): Msg => {
    const role = m?.role === 'system' ? 'system' : m?.role === 'assistant' ? 'assistant' : 'user';
    const img = m?.image && /^image\/(jpeg|png|webp)$/.test(String(m.image.mime)) && typeof m.image.b64 === 'string' ? { mime: String(m.image.mime), b64: m.image.b64 } : undefined;
    return { role, content: String(m?.content ?? '').slice(0, MAX_TEXT), ...(img ? { image: img } : {}) };
  }).filter(m => m.content || m.image);
}

async function callGemini(key: string, messages: Msg[], o: Opts) {
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts: any[] = [{ text: m.content }];
    if (m.image) parts.push({ inline_data: { mime_type: m.image.mime, data: m.image.b64 } });
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts });
  }
  while (contents.length && contents[0].role === 'model') contents.shift();
  const body: any = { contents, generationConfig: { maxOutputTokens: o.isMeal ? (o.vision ? 6000 : 1800) : o.fast ? 4096 : 8000, responseMimeType: 'application/json', temperature: o.isMeal ? 0.2 : o.fast ? 0.5 : 0.7 } };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `Gemini ${r.status}`), { status: r.status });
  const text = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('').trim();
  if (!text) throw Object.assign(new Error('Gemini no devolvió texto'), { status: 502 });
  return { text, model, provider: 'Gemini' };
}

async function callOpenAI(key: string, messages: Msg[], o: Opts) {
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o';
  const reasoning = /^(gpt-[5-9]|o\d)/.test(model);
  const msgs = messages.map(m => m.image ? { role: m.role, content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.b64}` } }] } : m);
  const body: any = { model, messages: msgs, max_completion_tokens: reasoning ? (o.isMeal ? 3000 : 8000) : (o.isMeal ? 1500 : 4000), response_format: { type: 'json_object' } };
  if (reasoning) body.reasoning_effort = o.deep ? 'medium' : 'low'; else body.temperature = o.isMeal ? 0.2 : 0.7;
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `OpenAI ${r.status}`), { status: r.status });
  const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw Object.assign(new Error('OpenAI no devolvió texto'), { status: 502 });
  return { text, model, provider: 'OpenAI' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Método no permitido', 405);
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail('Petición demasiado grande', 413);
    const { messages: rawMsgs, opts = {}, profile } = JSON.parse(raw);
    if (profile !== undefined && !USERS.includes(profile)) return fail('Usuario no autorizado', 403);
    const messages = clean(rawMsgs);
    if (!messages.some(m => m.role === 'user')) return fail('Actualiza la app: esta función espera {messages, opts}.', 400);
    const o: Opts = { isMeal: !!opts.isMeal, vision: !!opts.vision, deep: !!opts.deep, fast: !!opts.fast };

    const gem = Deno.env.get('GEMINI_API_KEY'), oai = Deno.env.get('OPENAI_API_KEY');
    if (!gem && !oai) return fail('Falta GEMINI_API_KEY u OPENAI_API_KEY en los secretos de la función', 500);
    const chain = [gem ? () => callGemini(gem, messages, o) : null, oai ? () => callOpenAI(oai, messages, o) : null].filter(Boolean) as (() => Promise<{ text: string; model: string; provider: string }>)[];
    let last: any;
    for (const call of chain) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { return json(await call()); }
        catch (e) { last = e; const s = (e as any)?.status ?? 0; if (!(s >= 500 || s === 0) || attempt) break; await new Promise(r => setTimeout(r, 700)); } // reintenta solo saturación/red; cupo o clave → siguiente proveedor
      }
    }
    const s = last?.status ?? 502;
    return fail(String(last?.message ?? 'Error del modelo'), s === 429 ? 429 : s >= 500 ? 502 : s === 401 || s === 403 ? 500 : 502);
  } catch (e) { return fail(String((e as Error).message ?? e), 500); }
});
