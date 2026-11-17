# AGRESSIVE LIFT

Entrenador y nutricionista con IA en una PWA sin framework ni compilación: rutinas con progresión, descansos inteligentes, dietas con lista de compras y seguimiento. Funciona sin conexión y guarda los datos en el dispositivo.

## Estructura

```
index.html            Arranque: selector de perfil, pantalla de error y carga de js/app.js
manifest.json         Manifiesto de la PWA
sw.js                 Service worker (debe quedarse en la raíz: su carpeta define el alcance)
css/styles.css        Estilos: base móvil + tablet (≥700 px) + escritorio (≥1080 px)
js/app.js             Interfaz: estado único (S), vistas por plantillas y acciones (ACT)
js/session.js         Sesión guiada: calentamiento ≤5 min, cardio por objetivo, descanso al cambiar de ejercicio
js/exdb.js            Catálogo de ejercicios, Smart Swap, descanso entre series, recuperación, niveles
js/engine.js          Motor determinista: calorías, macros, autorregulación de cargas, reportes
js/nutrition.js       Entrevista nutricional, estilos de dieta, menús, compras y tandas de cocina
js/supabase.js        Conexión con la IA (Gemini / OpenAI / proxy), login y licencias opcionales
js/store.js           Persistencia en IndexedDB por perfil, respaldo y restauración
js/pdf.js             PDF semanal y mensual
assets/               Logo e iconos
supabase/schema.sql   Tablas y políticas (solo si se activa login + licencia)
supabase/functions/ai Edge Function: proxy seguro hacia el modelo de IA
tests/                Pruebas de la lógica pura (Node)
docs/                 Ejemplo del PDF semanal
```

## Ejecutar en local

Los módulos ES necesitan un servidor (no abre con doble clic):

```
python -m http.server 8080
```

y abrir `http://localhost:8080`. Pruebas: `node tests/session.test.mjs`.

## Publicar

Es un sitio estático: sube la carpeta completa (GitHub Pages, Netlify, Vercel…) **conservando las subcarpetas**. Si vienes de una versión anterior con todos los archivos en la raíz, borra del hosting los antiguos (`app.js`, `styles.css`, `logo.png`, etc.) para no dejar copias viejas.

Al publicar cambios, sube el número de `C` en `sw.js` y de `VERSION` en `js/app.js` para que los teléfonos descarguen la versión nueva.

## Conexión con la IA

Hay dos modos y ambos usan exactamente el mismo prompt, los mismos comandos y el análisis de fotos:

| Modo | Dónde vive la clave | Cómo se activa |
|---|---|---|
| Clave en el dispositivo | En el teléfono (localStorage) | Botón **🤖 IA** dentro de la app. `AIza…` usa Gemini (gratis), `sk-…` usa OpenAI |
| Proxy seguro | Secreto de Supabase | Rellenar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `js/supabase.js` y desplegar la función |

Desplegar el proxy:

```
supabase secrets set GEMINI_API_KEY=AIza...      # y/o OPENAI_API_KEY=sk-...
supabase functions deploy ai --no-verify-jwt
```

Sin IA la app sigue funcionando con sus reglas locales. Los números (cargas, calorías, descansos, cardio) siempre los calcula el motor determinista; la IA interpreta, conversa y propone, y la app valida cada comando antes de aplicarlo.

## Sesión de entrenamiento

1. **Calentamiento y estiramiento dinámico** (nunca más de 5 min) armado con los músculos del día, con temporizador guiado.
2. **Series** con descanso según ejercicio, repeticiones, RIR y objetivo.
3. **Cambio de ejercicio**: descanso propio, calculado con el ejercicio que sigue (más si es un compuesto pesado o el mismo músculo) y contado desde la última serie. Aparece marcado entre tarjetas y en la barra superior.
4. **Cierre**: indica si toca cardio según el objetivo (definición, volumen, fuerza o mantenimiento), el tipo de sesión y lo hecho en la semana; estiramiento final y análisis opcional de la IA.

## Perfiles y licencias

Los perfiles (`juani`, `sebastian`) se definen en `index.html`, `js/store.js` y en `USERS` de la Edge Function. Para exigir login y licencia: `AUTH_ENABLED = true` en `js/supabase.js` y ejecutar `supabase/schema.sql`.
