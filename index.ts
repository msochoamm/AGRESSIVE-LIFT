// Edge Function "ai" — conecta AGRESSIVE LIFT con un modelo tipo GPT (OpenAI).
// Despliegue:
//   supabase secrets set OPENAI_API_KEY=sk-...        (opcional: OPENAI_MODEL=gpt-4o)
//   supabase functions deploy ai --no-verify-jwt
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' };
const USERS = ['juani', 'sebastian'];
const BASE = `Eres el asistente experto de AGRESSIVE LIFT (hipertrofia y nutrición deportiva basadas en evidencia).
Reglas: responde SIEMPRE en español, directo y específico a lo que el usuario acaba de pedir; nunca repitas una respuesta anterior ni uses plantillas genéricas.
Si pide rutina: entrega días, división, ejercicios con series x reps x RIR, orden, descansos y progresión, respetando EXACTAMENTE los días/división que indique.
Si pide dieta: entrega kcal y macros (proteína 1.6-2.2 g/kg, grasa >=0.7 g/kg, resto carbohidratos), comidas con cantidades en gramos y alternativas locales (Colombia: arroz, fríjoles, plátano, arepa, huevos, pollo, corrientazo).
Si falta un dato imprescindible (peso, estatura, edad, nivel, equipo, lesiones, restricciones), pregunta UNA sola cosa concreta al final. Si no tienes el dato, no inventes cifras: dilo.
Guía por objetivo (si el contexto trae goalGuide/planLock, respétalos): 
- Definición: déficit moderado (~0.5-1 % del peso/semana, ~300-500 kcal), proteína ~1.9-2.2 g/kg, entrenamiento de fuerza pesado y constante (conserva carga), cardio LISS y pasos; fase típica de 8-16 semanas; no recomiendes déficits de 800-1000+ kcal.
- Volumen/hipertrofia: superávit pequeño (+5-10 %, ~+250-300 kcal), ganar ~0.25-0.5 % del peso/semana (menos cuanto más avanzado), proteína 1.6-2.2 g/kg, grasa 0.8-1.2 g/kg, 10-20 series duras por músculo/semana, frecuencia 2x/semana, RIR 1-3; ajusta calorías según el ritmo real cada 2-4 semanas.
- Fuerza: 3-6 reps en básicos, descansos de 3-5 min, mantenimiento o superávit leve.
- No cambies ejercicios antes de 6-8 semanas (mesociclos de 4-8 semanas). Si hay planLock activo, el plan no se modifica hasta planLock.until.
Sé honesto con la incertidumbre y no des consejos médicos; ante dolor o lesión recomienda consultar a un profesional.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const fail = (m: string, s = 400) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });
  try {
    const { task, payload = {}, profile } = await req.json();
    if (!USERS.includes(profile)) return fail('Usuario no autorizado', 403);
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return fail('Falta OPENAI_API_KEY en la función', 500);

    const isMeal = task === 'meal';
    const { systemPrompt = '', ...ctx } = payload;
    const system = isMeal
      ? `${BASE}\nTarea: estima los macros de la comida descrita. Responde SOLO JSON: {"items":[{"name":str,"k":int,"p":int,"c":int,"f":int}],"confidence":0-1,"note":str}. Si faltan cantidades asume porciones típicas y baja la confianza.`
      : `${BASE}\n${systemPrompt}\nContexto (JSON) del usuario ${profile}: ${JSON.stringify(ctx).slice(0, 12000)}`;
    const history = Array.isArray(ctx.recentMessages) ? ctx.recentMessages : Array.isArray(ctx.conversation) ? ctx.conversation : [];
    const messages = [
      { role: 'system', content: system },
      ...(isMeal ? [] : history.slice(-8).map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text ?? '') }))),
      { role: 'user', content: isMeal ? String(ctx.text ?? '') : String(ctx.currentMessage ?? ctx.question ?? '') },
    ];

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o', messages, temperature: isMeal ? 0.2 : 0.7, max_tokens: 1200,
        ...(isMeal ? { response_format: { type: 'json_object' } } : {}) }),
    });
    const j = await r.json();
    if (!r.ok) return fail(j?.error?.message ?? 'Error del modelo', 502);
    const text = String(j.choices?.[0]?.message?.content ?? '').trim();
    if (isMeal) { const o = JSON.parse(text); return new Response(JSON.stringify(o), { headers: CORS }); }
    return new Response(JSON.stringify({ note: text }), { headers: CORS });
  } catch (e) { return fail(String((e as Error).message ?? e), 500); }
});
