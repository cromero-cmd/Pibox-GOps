# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Internal operations tools for Pibox, all static front-end with no build step, no `package.json` and no dependencies. Every push to `main` deploys the whole repo root to GitHub Pages (`.github/workflows/deploy.yml`, published at `https://cromero-cmd.github.io/Pibox-GOps/`). Code, comments, UI text and commit messages are in Spanish.

There are two separate apps:

1. **Pi GOps** (`index.html` at the root): the main app, where agents clock shifts (turnos) and admins manage them. It is one ~6.7k-line HTML file with all CSS and JS inline. Most of the commit history is here.
2. **Liquidaciones** (`liquidaciones/`): the TaDa → Trump payroll pipeline. It's a modular ES-module app (`liquidaciones/index.html` + `liquidaciones/js/*.js`) with its own tests.

The root-level `js/`, `css/`, `test/`, `pipeline.html` and `liquidaciones/pipeline.html` are older copies of the pipeline. The root `index.html` doesn't load them. Work in `liquidaciones/` unless told otherwise. `Trump` files are empty.

## Commands

```bash
# Serve locally (ES modules don't load over file://). Picks port 5173+, serves the directory it lives in.
node server.js                    # root → Pi GOps
node liquidaciones/server.js      # → Liquidaciones pipeline (or liquidaciones/iniciar.sh on macOS)

# Tests: plain Node scripts using node:assert, no test runner. Run one at a time:
node liquidaciones/test/doble_turno_test.mjs
# Run all of them:
for f in liquidaciones/test/*.mjs; do node "$f" || echo "FAIL $f"; done

# Liquidaciones cache-busting: run before committing pipeline changes that will be published
liquidaciones/bump_version.sh     # stamps ?v=YYYYMMDDHHMM on js/main.js in index.html + writes version.json
```

Tests import `../js/*.js` directly and shim `document`, `localStorage` and `window`. They also stub `fetch` to reject, so they never reach the production Apps Script backend. Keep that stub in new tests.

## Pi GOps (`index.html`) architecture

- **Two script blocks.** The first `<script type="module">` (top of the file) does the Firebase setup: Auth with Google sign-in limited to the `pibox.app` domain, Firestore, and the `onAuthStateChanged` boot. It puts Firestore helpers on `window.*`. The large classic `<script>` (starting around `const APP_VERSION`) holds the app logic and calls those `window.*` functions. Inline `onclick=` handlers call `window.*` functions.
- **Views:** `#home-view`, `#turno-view`, `#chat-view`, `#library-view`, `#analytics-view` (Insights), `#panel-view` (Panel de Control).
- **Data sources:**
  - Firestore (project `copper-eye-468704-f8`). Main collections: `turnos`, `events`, `configs` (`configs/global`), `admins`, `absences`, `strike_waivers`, `strike_appeals`, `strike_notifications`.
  - Three Apps Script web apps: `SCRIPT_URL`, `MALLA_SCRIPT` (the schedule, "malla", as CSV), and `NOTIF_SCRIPT` (emails).
- **Malla fetches must go through `fetchMallaCSV()`.** It adds retries, a hot cache and a localStorage fallback. `MALLA_SCRIPT` is often slow or degraded. Several past bugs (v17.5, v17.6) came from one-shot `fetch(MALLA_SCRIPT)` calls that failed silently.
- **Permissions:** use `isSuperAdminUser(email)` for any Super Admin check. It also covers the temporary delegation in `configs/global`. Don't compare against `SUPER_ADMIN` directly. Admins are loaded from Firestore into `ADMINS`.
- **Versioning:** every change bumps `const APP_VERSION='X.Y'` and puts the same `(vX.Y)` in the commit subject (e.g. `fix: ... (v17.8)`). Open tabs detect new versions by re-fetching `index.html` and regex-matching `const APP_VERSION='...'`. Keep that exact declaration format or update detection breaks.

## Apps Script (`.gs`) files

The `.gs` files live in Google Apps Script projects, not in this deploy. The repo copies are references that get pasted into script.google.com by hand.

- `PiGOps_Notificaciones_v5.gs` is the `NOTIF_SCRIPT` backend. It has `doPost`/`doGet`, strike and disciplinary emails, attendance checks, shift reminders and payroll reports. It reads Firestore through the REST API and the malla from a Sheet. Its time-driven functions (`runStrikeAlerts`, `runAttendanceCheck`, `sendWeeklyPayrollAuto`, etc.) run as triggers.
- `liquidaciones/apps-script/*.gs` are patches for the Liquidaciones backend (diccionario, historial, CSV email). Each file's header explains where to wire it in.

When you change backend behavior, edit the matching `.gs` file and tell the user it has to be redeployed by hand.

## Liquidaciones (`liquidaciones/`) architecture

The pipeline steps follow the module order:

`parser.js` (load the TaDa and malla xlsx files with SheetJS) → `normalizer.js` → `conciliacion.js` (match TaDa names to malla names; fuzzy matching plus the learned `diccionario.js`) → `distribucion.js` → `novedades.js` (manual resolutions and exclusions) → `trump.js` (compute payroll using `tariffs.js`) → `email.js` / `historial.js` (save to the backend).

- `main.js` is the entry point. It puts handlers on `window.*`.
- `config.js` holds the shared constants, the localStorage keys (`pibox:*`) and pure helpers (`normStr`, `parseDate` with DD/MM Colombian convention).
- Modules share mutable state through exported live bindings plus setters (e.g. `tadaRaw`, `mallaRaw`, `tadaNorm`, `concResult`).
- Never add `?v=` query strings to imports between modules. A different URL creates a separate module instance, which breaks this shared state and the tests. Only the `main.js` `<script>` tag gets versioned, by `bump_version.sh`.
- `version-check.js` polls `version.json` every 5 minutes and reloads open tabs when it changes.
- The backend is an Apps Script URL (`DEFAULT_BACKEND_URL`, overridable in localStorage).

## Conventions

Commit messages use the `feat:` / `fix:` / `chore:` prefix and a Spanish subject. The body explains the root cause, often with the real case that triggered the change.

## Contexto de negocio e historial

### Qué es
- **Pi GOps**: plataforma interna de operaciones de Pibox (logística de última milla, Colombia). URL: https://cromero-cmd.github.io/Pibox-GOps/.
- **Acceso**: solo cuentas @pibox.app, con login de Google sobre Firebase. Se restringe con `hd` en el provider y con una validación del email después del login.
- **Super Admin**: cromero@pibox.app. Existe además una delegación temporal (`configs/global.delegatedSuperAdmin`/`delegatedUntil`).
- **Roles**: `user` (agente), `admin` y `super`.
- **Módulos**:
  - Gestión de turnos: inicio y fin validados contra la malla (tardanzas, salidas anticipadas, extras).
  - Panel de Control: quién está en turno, cumplimiento, e Insights con ranking de strikes.
  - Alertas automáticas por correo.
  - Sistema de strikes.
  - Pre-revisión de nómina, antes de enviarla a TH.
  - Asistente IA y tutoriales.
  - Configuración.
  - Tarjetas de apps externas: Trump, Nuevo Trump, Pibox Web, Pibox Tracker, Reporte Novedades Nómina, Tribus, WMS Pibox, Trello, Superset, Soporte de Activos, Pikasso y Limpiador de direcciones.
- **Alertas de tardanza** (`checkAttendance` en el `.gs`):
  - Se envían a T+10, T+20 y T+60 min al líder directo, con Camilo en copia salvo que el líder sea él mismo.
  - El recordatorio de inicio sale unos 10 min antes del turno (`sendShiftReminders`, ventana de 8 a 12 min).

### Escala disciplinaria (solo sin justa causa)
| Tipo | Umbral | Strikes por llamado de atención |
|---|---|---|
| Tardanza leve | más de `pg_strike_tardanza` (default 5) hasta 19 min | 3 |
| Tardanza moderada | 20–59 min | 2 |
| Tardanza grave | 60+ min | 1 |
| No desconexión | más de `pg_strike_nodesconexion` h (default 4) después de la salida programada | 3 |

- **Umbrales configurables**: solo el mínimo de tardanza leve y las horas de no desconexión. Los cortes de 20 y 60 min y los conteos 3/2/1/3 están fijos en el código. Viven duplicados en `buildLlamadoHistorial` de `index.html` y del `.gs`, que deben mantenerse iguales.
- **Ojo:** los dos umbrales configurables se guardan solo en el localStorage del navegador que los edita. No van a Firestore como el resto de la configuración. `loadStrikes` corre en el navegador del agente, así que en la práctica los agentes usan los defaults 5 min / 4 h.
- **Ventana de conteo**: los strikes y llamados se cuentan en una ventana móvil de 6 meses, no por mes calendario (v17.7).
- **Proceso disciplinario**: al tercer llamado acumulado (cualquier combinación) se abre proceso disciplinario/descargos y se envía un correo único por agente.
- **Visibilidad para el agente**: ve su progreso en "Mi Turno" y recibe el aviso "Estás a 1 strike de un nuevo llamado".
- **Justa causa**:
  - El retiro de strikes se guarda en `strike_waivers`.
  - Las apelaciones del agente (`strike_appeals`) las aprueba o rechaza el Super Admin.
  - Los días con novedad de votaciones no generan strikes.
  - Una tardanza justificada se paga por el horario programado en nómina (v17.0).
- **Turnos que cruzan medianoche** (ej. 16:00→01:00): si el fin programado es menor que el inicio programado, se suman 24 h antes de calcular horas. Este ajuste está en `loadStrikes`, `renderPanel2Insights`, la prenómina y el Panel de Control. No romperlo.

### Nómina
- **Pre-revisión** (`openPayrollPreview`):
  - Edición en línea con recálculo en tiempo real. Las horas se muestran en formato colombiano "hh:mm a. m./p. m.".
  - El borrador se autoguarda en localStorage en cada edición (`savePayrollDraft`).
  - Solo las ediciones de entrada o salida de una fila con `turnoId` se escriben en Firestore (`turnos`, `editedBy:'payroll-preview'`).
  - Se descarga como CSV con las columnas Nombre, Fecha, Entrada, Salida, Almuerzo, Horas trabajadas, Extras y Novedad.
  - La jornada legal es de 44 h, y de 42 h para semanas desde el 15-jul-2026.
- **Reporte enviado** (`sendPayrollReport` en el `.gs`): genera un Sheet con las hojas "Nomina" y "Resumen". Tiene en cuenta entradas tempranas y tardías, extras aprobadas y salidas anticipadas justificadas o injustificadas.
- **Cuota de Firestore**: hubo problemas de cuota y se resolvieron con caché en memoria (`TURNOS_CACHE_TTL` de 1 min y caché caliente de malla) y límites de consulta (`limit(300)` en turnos, `limit(100)` en ausencias). El proyecto está en plan Blaze. No aumentar lecturas sin necesidad.

### Asistente IA (ChatBot)
- **Fuente**: responde dudas operativas con el manual de operaciones (hoja "Manual del asistente"), leído en tiempo real.
- **API**: llama a la API de Anthropic directo desde el navegador. El modelo está fijo en `claude-sonnet-4-6`, en el fetch a `api.anthropic.com`. Usa streaming y `max_tokens` 1024.
- **Instrucción base** (`sysBase`, editable en Configuración):
  - Se llama Pi GOps y prioriza el manual, pero puede razonar e interpretar cuando la respuesta no está textual.
  - Si algo no está en el manual, lo dice y sugiere a quién escalar. Nunca se queda en blanco.
  - Responde claro y práctico, con pasos o listas, en español colombiano cercano y profesional.
- **Consultas frecuentes**: barra lateral con buscador y filtro por categoría, leída de la hoja "FAQ" (col A Pregunta, col B Categoría opcional).
- **Interfaz**: botón "Nueva consulta" y opción de adjuntar imagen o PDF. El indicador de estado muestra "Cargando..." / "Activo" / "Error".

### Tutoriales
- **Fuente**: biblioteca de videos leída de la hoja "Tutoriales". Las columnas son A Título, B Categoría, C Descripción y D Link.
- **Miniaturas**:
  - La columna E (Thumbnail) hoy no se lee. La miniatura se deriva del link de la columna D.
  - Para un link de Drive de archivo específico (`/d/ID` o `id=ID`, no carpeta), se arma como `https://drive.google.com/thumbnail?id=ID&sz=w400`.
  - YouTube también funciona.
- **Filtros y contenido**: tiene filtros por categoría y buscador. Para agregar contenido no se toca código, solo se llena la hoja.
- **Lectura de hojas**: el manual, FAQ y Tutoriales se leen por nombre de hoja con Apps Script como proxy (`fetchSheetByName` → `SCRIPT_URL?sheet=<nombre>`). Los proxies CORS públicos (allorigins, corsproxy, codetabs) fallaron antes. No volver a depender de proxies públicos.

### Configuración (⚙ Configurar)
- **Campos**:
  - API Key de Anthropic e instrucción base del asistente.
  - URLs CSV del Manual, Tutoriales y FAQ.
  - Correos de nómina y de recordatorios.
  - Día y hora de corte de nómina.
  - Retraso de notificaciones de malla (mínimo 10 min).
  - Umbrales de strikes.
- **Las URLs CSV no se usan**: los datos se leen por nombre de hoja vía `SCRIPT_URL`. La URL de Tutoriales solo funciona como interruptor para cargar la biblioteca.
- **Persistencia**:
  - Se guarda en Firestore (`configs/{uid}`, con respaldo en `configs/global`) y se copia a localStorage (claves `pg_*`) en cada login.
  - Borrar el localStorage no obliga a configurar de nuevo, salvo los umbrales de strikes, que solo viven en localStorage.
  - Los correos y el corte también se envían al `.gs` (`NOTIF_SCRIPT?type=save_config`).
- **Actualizar versión**: el banner "Actualizar ahora" (`softReload`) recarga con `?r=<timestamp>`. Las pestañas también detectan solas una versión nueva comparando `APP_VERSION`.
- **API Key**: nunca exponerla en el código ni en commits. Hoy se ingresa en Configuración y queda en Firestore y localStorage.

### Flujo de trabajo
- **Cada cambio**: subir `APP_VERSION`, hacer commit con `(vX.Y)` en el asunto y push a `main`, que publica en vivo. Después verificar en producción y sugerir el mensaje de commit a Camilo.
- **Archivos `.gs`** (ej. `PiGOps_Notificaciones_v5.gs`): Camilo los copia a mano a Google Apps Script y los redespliega. Si cambia la URL de despliegue, hay que actualizar `NOTIF_SCRIPT`, `MALLA_SCRIPT` o `SCRIPT_URL` en `index.html`. Avisar siempre que un cambio requiera esto.
- **Código suelto**: funciones duplicadas y restos de código viejo ya tumbaron la app antes (ej. `checkTodayNovedad()` duplicada, v17.6). Revisar que no queden fragmentos sueltos ni funciones definidas dos veces.

### Archivos legacy
- No borrar `pipeline.html`, `js/`, `css/` ni `test/` de la raíz hasta confirmar que nadie usa la URL `/pipeline.html`.
