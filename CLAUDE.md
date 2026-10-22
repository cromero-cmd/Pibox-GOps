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
- `PiGOps_Reglamento.gs` (v18.5) is a SECOND file of that same Apps Script project (it reuses `FIREBASE_REST`, `MESES_ES`, `getMallaSheetId`, `firestoreGetDocRaw` from the file above). It only runs from time-based triggers; it has no `doGet`/`doPost`. See «Reglamento Interno» below.
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
- **Reglas de Firestore**: `strike_notifications` necesita regla (las reglas publicadas el 16-oct-2026 no la tienen: lectura y escritura dan «Missing or insufficient permissions»). Mientras no exista, `getStrikeNotifSafe`/`saveStrikeNotifSafe` (v18.0) usan un respaldo en localStorage (`pg_sn_<docId>`) para que el correo de llamado salga una sola vez por navegador y por aumento del contador. Con la regla puesta, el respaldo es inofensivo.
- **Vigencia de 3 meses calendario (v18.1, política de Talento Humano)**: están activos los strikes y llamados del mes actual y de los dos meses calendario anteriores completos (octubre → agosto, septiembre y octubre; el 1 de noviembre → septiembre a noviembre). Lo demás está **archivado** («Vencido»): no cuenta para contadores, umbrales, escalamiento ni nuevos llamados. Se calcula por fecha AL LEER (`strikeVigencia`, `computeAgentStrikes`, `applyStrikePolicy` en `index.html`); no se borra nada en Firestore y no hay procesos programados. Un llamado se fecha con el strike que lo completó y es vigente según el mes en que se emitió; al sumar un strike solo cuentan para ese llamado los de su misma ventana de 3 meses. Un strike con apelación aprobada o retirado (`strike_waivers`) no cuenta nunca. Misma lógica para «Mis strikes» del agente, el Historial (solo consulta, agente y admin) y la tarjeta «Strikes vigentes» de Insights. Pruebas: `node test/pigops_strikes_vigencia_test.js`.
- **Proceso disciplinario**: al tercer llamado acumulado (cualquier combinación) se abre proceso disciplinario/descargos y se envía un correo único por agente.
- **Visibilidad para el agente**: ve su progreso en "Mi Turno" y recibe el aviso "Estás a 1 strike de un nuevo llamado".
- **Justa causa**:
  - El retiro de strikes se guarda en `strike_waivers`.
  - Las apelaciones del agente (`strike_appeals`) las aprueba o rechaza el Super Admin.
  - Los días con novedad de votaciones no generan strikes.
  - Una tardanza justificada se paga por el horario programado en nómina (v17.0).
- **Turnos que cruzan medianoche** (ej. 16:00→01:00): si el fin programado es menor que el inicio programado, se suman 24 h antes de calcular horas. Este ajuste está en `loadStrikes`, `renderPanel2Insights`, la prenómina y el Panel de Control. No romperlo.

### Inicio de turno (regla de negocio, v17.9)
- **Ninguna falla de ubicación bloquea el inicio de turno** (no negociable). Permiso negado, error 1 con permiso concedido, error 2, error 3, Nominatim caído o lento, agente sin ciudad en BASE 3.0: el turno inicia y se guarda `locationStatus` (`ok`, `denied`, `os_blocked`, `unavailable`, `timeout`, `unsupported`, `geocode_failed`, `no_registered_city`, `error`) y el Panel muestra un ícono neutro. Nunca se guardan coordenadas, solo la ciudad.
- **`os_blocked`** = el navegador tiene el permiso pero `getCurrentPosition` responde error 1 «User denied Geolocation» (el sistema operativo, típicamente Windows, no entrega la ubicación). Se reintenta una vez con alta precisión y `maximumAge:0`; si sigue fallando, el turno inicia con aviso persistente al agente.
- **La hora de inicio es la del clic**, fijada en `startTurno()` antes de cualquier modal o espera.
- **Todo paso del inicio lleva tope**: versión 4 s, ubicación ~20 s, malla ≤22 s (10 s si hay caché), geocodificación 4 s, guardado 15 s, y un límite duro de 45 s de espera técnica en `startTurno()` (no cuenta el tiempo de un modal esperando al agente). Los modales siempre traen «Continuar sin ubicación» y se continúan solos (90 s el aviso del navegador, 180 s el modal de bloqueo).
- **Sin duplicados**: `window._startInFlight` (misma pestaña), candado `navigator.locks` (entre pestañas), revisión de turno activo de hoy antes de crear, e id del turno generado en el cliente (`newTurnoId`) para que un reintento sea idempotente.
- **Malla en el inicio**: `fetchMallaCSV(tag,null,{attempts:2,timeoutMs:12000,hedgeMs:5000,maxAgeMs:15*60000})`. MALLA_SCRIPT se cuelga o da 404 en ~1 de cada 8 pedidos, por eso `fetchMallaOnce` lanza un segundo pedido «de cobertura» a los `hedgeMs`. Si todo falla se usa la caché local; una caché de más de 6 h no bloquea el inicio.
- Prueba: `node test/pigops_inicio_turno_test.js` (extrae el código real de `index.html` y simula geolocalización, fetch, Firestore y reloj).

### Botón ↻ del Panel de Control (v18.3)
- **`refreshPanel()` refresca todo el panel**: tarjetas «En turno ahora», Balance hoy, tabla/estados, Extras e Insights, y los badges y modales abiertos de Horas extras, Salidas anticipadas, Semanas excedidas, Apelaciones, Historial de strikes y Nómina. Ignora la caché en memoria y la deja actualizada; botón deshabilitado y girando mientras carga; texto «Actualizado h:mm» (`#panel-last-update`) con ⚠ y el nombre de lo que falló.
- **Ciclo de lectura** (`panelCycleStart`, `panelRead`, `panelGet`, `panelMalla`): cada fuente se lee UNA vez por carga/refresco y la comparten todos los módulos. Dentro de un ciclo los wrappers de Firestore van en modo `strict` (último parámetro): lanzan el error en vez de devolver `[]`, así un módulo caído conserva lo que ya se ve y se avisa, sin arrastrar a los demás. Al agregar una lectura nueva al Panel, regístrala en `PANEL_READERS`, no con `window.get*()` suelto.
- **Lecturas de un refresh completo (10 consultas Firestore + 1 pedido de malla)**: turnos recientes, ausencias, eventos de horas extras, apelaciones, retiros de strikes, turnos del período, extras aprobadas del período, turnos para strikes, llamados de atención del Reglamento (`reglamento_casos`) y lecturas del comunicado vigente (`comunicados_lectura`). Con modales abiertos comparten esas lecturas; solo suman 1 el Historial (turnos del agente) y 1 la Nómina (extras aprobadas de la semana pasada).
- **Strikes**: con la caché de 5 meses vigente (<15 min) el refresh es **incremental** (relee solo el mes en curso o los últimos 7 días); vencida, relee los 5 meses.
- **Nómina abierta**: si hay ediciones sin enviar (`window._payrollDirty`, se activa en `savePayrollDraft`) o una celda en edición, el refresh NO la toca.
- Prueba: `node test/pigops_panel_refresh_test.js` (corre el `loadPanel2`/`refreshPanel` reales con Firestore y DOM simulados y cuenta cada consulta).

### Reglamento Interno de Trabajo: tardanzas, llamados de atención y faltas graves (v18.5 / v18.6)
- **Vigencia**: tardanzas desde el **1-nov-2026** (`REGLAMENTO_DESDE` en `index.html`, `REG.DESDE` en el `.gs`). Más de 5 min de retraso (tolerancia fija, no la configurable de strikes). Desde esa fecha las tardanzas **salen del modelo de strikes** (`computeAgentStrikes` las marca `reg:true` y `applyStrikePolicy` las devuelve aparte en `reglamento`): ya no suman strikes ni llamados del modelo viejo, ni disparan sus correos al líder. La no desconexión sigue en el modelo de strikes.
- **Turnos sin cierre (sin `endTime`) no son falta bajo ninguna regla** (v18.6): la tardanza solo mira la hora de inicio; la no desconexión exige hora de salida real (un turno activo ya no usa «ahora»; antes, v16.8, podía mostrar un strike en vivo).
- **Causales (texto literal del Reglamento de Digital Platforms Colombia S.A.S.)**: falta leve «Artículo 59, numeral 1: El retardo injustificado en la hora de entrada, hasta por segunda vez.»; falta grave «Artículo 60, numeral 2: El retardo injustificado en la hora de entrada, por tercera vez.»; «Artículo 60, numeral 13: Acumular tres (3) llamados de atención realizados por su jefe inmediato.» (`REG.CAUSAL_*` en el `.gs`, `REG_CAUSAL_*` en `index.html`).
- **Plazo**: cada tardanza abre 3 días hábiles (sin sábados, domingos ni festivos; el día de la tardanza no cuenta; el último día vale completo). **Festivos**: una sola lista por runtime, `FESTIVOS_CO` (2026–2027) en `index.html` y en `PiGOps_Reglamento.gs`; `test/pigops_reglamento_test.js` verifica que sean idénticas y correctas (Pascua + Ley Emiliani). Para 2028: agregar fechas en los dos. Esto corrigió además la lista vieja `FESTIVOS_2026` de «Semanas excedidas».
- **Clasificación** (por agente, orden cronológico, ventana = 3 meses calendario y nunca antes del 1-nov): 1.ª y 2.ª tardanza no justificadas = falta leve → **llamado de atención** (PDF de la plantilla de Google Doc); si varias vencen el MISMO día para el mismo agente se envía **UN solo llamado con un párrafo por falta** (comparten `llamadoId`, cuenta como UN llamado para el 60.13). 3.ª = **falta grave art. 60 num. 2** → notificación a Talento Humano (sin llamado y sin correo al agente). **4.ª en adelante = reincidencia**: cada una notifica a TH con asunto «Reincidencia — Falta grave para descargos — [Nombre]» referenciando el caso abierto (la 3.ª tardanza). 3 llamados vigentes enviados = **art. 60 num. 13** → notificación a TH. Una tardanza solo se actúa si está confirmada Y no queda antes otra sin resolver (en plazo o con apelación pendiente). Justificada (retiro/apelación aprobada) o cancelada por un admin = no cuenta. El 60.13 cuenta solo llamados del flujo nuevo.
- **Estados** (`reglamento_casos/{email}_{AAAAMMDD}_reg`, y `..._6013` para el 60.13): «En plazo de justificación» → «Justificado» | «Enviado» | «Cancelado»; un caso de TH «Enviado» pasa a «Cerrado» (`cerradoPor`, `cerradoAt`, `notaCierre`) cuando un admin lo cierra. «Enviado», «Cerrado» y «Cancelado» son definitivos para el script. Apelación presentada a tiempo y sin resolver = la falta espera; tardía no frena; rechazada = confirmada.
- **Quién envía qué, y cuándo**: SOLO disparadores de Apps Script (`instalarDisparadoresReglamento()`): `reglamentoAvisos` cada 15 min y `reglamentoProcesarPlazos` a las 7:00 (solo corre en día hábil). Sin endpoint público nuevo. Firestore con `ScriptApp.getOAuthToken()` (cuenta dueña del script): no hay llaves guardadas. Idempotencia: documento único por tardanza + creación con `currentDocument.exists=false` + `LockService`.
- **Modo prueba**: `configs/global.reglamentoModoPrueba` (interruptor en ⚙ Configurar, solo cromero). Solo un `false` booleano explícito pasa a producción. En prueba todo va solo a cromero con «PRUEBA» en el asunto; los registros se marcan `prueba:true` y al pasar a producción NO cuentan.
- **Propiedades del script**: `reg_th_email`, `reg_template_id`, `reg_firmante_cargo` (obligatorias); `reg_firmante_nombre`, `reg_drive_folder_id`, `reg_test_email` (opcionales). **Formato del PDF (v18.6+)**: cada falta es una COPIA del párrafo del marcador `{{DESCRIPCION_FALTAS}}` (conserva fuente, tamaño, alineación, interlineado y sangrías; los párrafos nuevos de Docs no heredan nada) y se separa con una línea vacía de igual formato, salvo que el marcador ya tenga espaciado posterior; antes de exportar se quitan saltos de página y párrafos vacíos del final (`reg_limpiarFinal`) para que no salga una 2.ª hoja con solo el membrete (el último párrafo de un Doc no se puede borrar: queda a 1 pt). Texto de cada falta: «El día D, su turno estaba programado para iniciar a las H y registró su inicio a las H2, con N minutos de retardo, sin justificación aprobada dentro del plazo de 3 días hábiles.» (sin referencia a Pi GOps). Google Docs real lanza «No es posible insertar un elemento de texto vacío» con `setText('')`, `insertText(i,'')` y `appendText('')`: en `PiGOps_Reglamento.gs` no se usan (`reg_vaciarParrafo` con `clear()`/`deleteText`, `reg_ponerTexto`; `replaceText` con `''` sí es válido y se usa para borrar un marcador vacío como `{{CEDULA}}`, con `deleteText` de respaldo). Las pruebas de Docs usan `test/_google_docs_fake.js`, que reproduce esa restricción (y un test estático vigila que no vuelva a aparecer). **Marcadores de la plantilla**: `{{FECHA}} {{NOMBRE}} {{CARGO}} {{CEDULA}}(opc.) {{CAUSAL}}(opc.) {{DESCRIPCION_FALTAS}} {{FIRMANTE}} {{CARGO_FIRMANTE}}`, y `{{INICIO_NOTA}}`/`{{FIN_NOTA}}` rodeando la nota para quien diligencia (se borra). `diagnosticoReglamento()` (solo lectura) comprueba propiedades, permisos y disparadores. **`pruebaEnvioReglamento()`** (manual, desde el editor; no la llama ningún disparador) genera con datos ficticios y la plantilla real un llamado con dos faltas (PDF), una notificación de falta grave con Excel y una de reincidencia, y envía los 3 correos SOLO a cromero@pibox.app con «PRUEBA DE ENVÍO» en el asunto (sin importar el modo prueba ni las propiedades de destinatarios); no toca Firestore, malla, agentes ni disparadores, no comparte los archivos y deja los PDF/Excel en Drive (`reg_drive_folder_id` o la raíz) con sus enlaces en el log para revisarlos y borrarlos; revisa el PDF (marcadores, un párrafo por falta, nota eliminada, causal, firma) y avisa qué marcadores faltan en la plantilla.
- **Estado de la configuración (22-oct-2026, hecha a mano por Camilo)**: `PiGOps_Reglamento.gs` (v18.6) pegado en Apps Script; propiedades `reg_template_id`, `reg_th_email` y `reg_firmante_cargo` configuradas; `instalarDisparadoresReglamento()` ejecutado; manifiesto actualizado; `diagnosticoReglamento()` en OK. Excepción esperada: la prueba «Gmail» (`GmailApp.getInboxUnreadCount()`, lectura de bandeja) no aplica, porque el script solo ENVÍA correo; si falla, se ignora. Reglas de `reglamento_casos` publicadas. Lo único que queda sin ejercitar es el flujo real de envío, que no puede ocurrir antes del 1-nov-2026 (el motor no hace nada antes de `REG.DESDE`) y arranca en modo prueba.
- **Manifiesto de Apps Script (`appsscript.json`, vive en el proyecto, no en este repo)**: si lista `oauthScopes` explícitos deben estar al menos `drive` (copiar la plantilla, crear PDF/Excel, compartir), `documents`, `spreadsheets`, `script.scriptapp`, `script.send_mail`/Gmail, `script.external_request`, `userinfo.email` y el de Firestore/Datastore (`datastore` o `cloud-platform`). `America/Bogota` como zona horaria del proyecto. Si cambia `PiGOps_Reglamento.gs` hay que volver a pegarlo (los disparadores siguen instalados).
- **Reglas de Firestore (se publican a mano, en el bloque `match /databases/{database}/documents`; las de `reglamento_casos` ya están publicadas)**: abajo está el bloque de referencia de `reglamento_casos`. `configs` ya estaba protegido con la regla que Camilo tiene publicada: cada usuario solo escribe su propio doc (`request.auth.uid == docId`) y `configs/global` (incluido `reglamentoModoPrueba`) solo lo escribe `cromero@pibox.app`; no requiere cambios. Ojo: las reglas se combinan con OR; si ya existe un `match /{document=**}` permisivo, hay que quitarlo o estas restricciones no sirven.
- **UI**: Mi turno → sección «Reglamento» (indicador «Tardanzas desde el 1 de noviembre: X de 3» verde→amarillo→rojo, política literal, aviso de inicio antes del 1-nov, tardanzas con plazo/botón de justificar o apelar —reusa `apelarStrike`/`strike_appeals`— e Historial de llamados con el PDF); Panel de Control → «📣 Llamados de atención» (indicador por agente de faltas leves vigentes: quién está a una de la falta grave; en plazo/enviados; cancelar con motivo) y «🏛️ Casos para Talento Humano» («Pendiente de enviar» / «Enviado a Talento Humano» / «Cerrado» con quién y cuándo, descarga del Excel de soporte). Los dos comparten UNA lectura (`PANEL_READERS.casos`) y el refresh ↻ (`pmCasos`).
- **Artículos del Reglamento (v18.8)**: el enlace «Ver artículos que rigen según el reglamento» (bajo la política en Mi turno y en el texto completo del comunicado, configurable con `enlaceReglamento`) abre un modal de solo lectura con el texto literal. El texto vive en UNA constante, `REGLAMENTO_ARTICULOS` (`index.html`): si el reglamento cambia, se edita ahí, sin resumir. Contenido estático, sin Firestore.
- Pruebas: `node test/pigops_reglamento_test.js` (carga el `.gs` real con IO simulado, Google Docs simulado y el cliente real) y `node test/pigops_panel_refresh_test.js` (módulos del Panel).

```
// ── Firestore rules de reglamento_casos (dentro de `match /databases/{database}/documents { ... }`) ──
function isCromero() {
  return request.auth != null && request.auth.token.email == 'cromero@pibox.app';
}
function isAdmin() {
  return request.auth != null && (isCromero() ||
    exists(/databases/$(database)/documents/admins/$(request.auth.token.email)));
}

// reglamento_casos: lo escribe el script de Apps Script (OAuth del dueño, no pasa por reglas).
match /reglamento_casos/{casoId} {
  allow read: if request.auth != null && (isAdmin() || resource.data.userEmail == request.auth.token.email);
  allow create, delete: if false;
  allow update: if isAdmin() && (
    // cancelar un registro ANTES de su envío
    (resource.data.estado == 'En plazo de justificación'
      && request.resource.data.estado == 'Cancelado'
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['estado', 'motivoCancelacion', 'canceladoPor', 'canceladoAt']))
    ||
    // cerrar un caso de Talento Humano ya enviado
    (resource.data.estado == 'Enviado' && resource.data.tipo == 'falta_grave'
      && request.resource.data.estado == 'Cerrado'
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['estado', 'cerradoPor', 'cerradoAt', 'notaCierre']))
  );
}
```

### Comunicado anclado (v18.7) — mecanismo reutilizable para anuncios
- **Dónde vive**: `configs/global.comunicado = {id, titulo, cuerpo, resumen, fin (ISO con offset -05:00), activo, publicadoAt, publicadoPor}` (solo cromero puede escribirlo: regla de `configs` ya publicada). Si no existe se usa `COMUNICADO_DEFAULT` en `index.html` (anuncio del Reglamento de tardanzas, id `reglamento-tardanzas-2026-11`, fin 1-nov-2026 23:59 Bogotá).
- **Agente** (solo no-admins, no en vista previa): al entrar, si no confirmó, aparece una tarjeta flotante «Leí y entendí» (`#comunicado-modal`); puede cerrarla pero vuelve a salir en CADA ingreso hasta que confirme. Confirmado = banner fijo arriba de Mi turno (resumen + «Ver comunicado»). Visible desde `publicadoAt` hasta `fin` y solo si `activo`; después no aparece nada (ni siquiera se lee Firestore).
- **No estorba el inicio de turno**: la tarjeta no bloquea clics (sin fondo), no se muestra mientras `_startInFlight`, `_startModalOpen` o el botón «Iniciar turno» estén procesando (reintenta cada 3 s), `startTurno` la oculta de forma síncrona antes de cualquier espera, y el arranque (`initComunicado`) es fire-and-forget desde `onAuthStateChanged`.
- **Confirmación**: documento `comunicados_lectura/{comunicadoId}_{email}` con `email, nombre, comunicadoId, confirmadoAt` (serverTimestamp). El email sale SIEMPRE de la sesión (`confirmarComunicadoLectura` no recibe correo). Un comunicado con OTRO `id` obliga a todos a confirmar de nuevo: en ⚙ Configurar → «Comunicado anclado», «Guardar cambios» conserva el id y «Publicar como NUEVO» genera `com_<timestamp>`.
- **Cuotas**: la config global ya se lee en el arranque (se reutiliza, `window._globalCfg`); cada agente hace UNA lectura (su propia confirmación) al entrar; el Panel hace UNA consulta (`PANEL_READERS.comunicados`) compartida con el refresh ↻.
- **Panel de Control → «📢 Comunicados»** (`pmComunicados`): «X de Y leyeron» (Y = agentes con turnos programados en la malla en los últimos 45 días, sin admins), quién confirmó y cuándo, quién falta, botón de descarga en Excel. Badge = pendientes (solo si el comunicado está vigente).
- **Reglas de Firestore para `comunicados_lectura`** (usa tu `isAdmin()`; agregar dentro de `match /databases/{database}/documents`). No se probó con el emulador de Firebase:
```
match /comunicados_lectura/{lecturaId} {
  // Leer: el propio agente (su documento, exista o no todavía) y los admins; listar solo admins.
  allow get: if request.auth != null
    && (isAdmin() || resource == null || resource.data.email == request.auth.token.email);
  allow list: if isAdmin();
  // Crear: solo la confirmación propia (email de la sesión, id {comunicadoId}_{email}, fecha del servidor).
  allow create: if request.auth != null
    && request.resource.data.keys().hasOnly(['email', 'nombre', 'comunicadoId', 'confirmadoAt'])
    && request.resource.data.keys().hasAll(['email', 'nombre', 'comunicadoId', 'confirmadoAt'])
    && request.resource.data.email == request.auth.token.email
    && request.resource.data.comunicadoId is string
    && request.resource.data.nombre is string
    && lecturaId == request.resource.data.comunicadoId + '_' + request.auth.token.email
    && request.resource.data.confirmadoAt == request.time;
  // Nunca modificar ni borrar una confirmación.
  allow update, delete: if false;
}
```
- Pruebas: `node test/pigops_comunicado_test.js` (44 casos: modal, banner, vigencia, comunicado nuevo, confirmación a nombre propio, inicio de turno, edición) y `node test/pigops_panel_refresh_test.js` (módulo del Panel).

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
