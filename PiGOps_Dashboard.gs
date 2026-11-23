// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PiGOps_Dashboard.gs — Conteos de agentes por fecha × hora × línea para el dashboard de operaciones (v19.12)
//
// QUINTO archivo del mismo proyecto de Apps Script que PiGOps_Notificaciones_v5.gs, PiGOps_Reglamento.gs, PiGOps_Auditoria.gs y
// PiGOps_CierreTurnos.gs (copiar a mano, igual que ellos). Reutiliza: FIREBASE_REST, MALLA_SHEET_NAME, getMallaSheetId() y mallaFechaISO_()
// de Notificaciones; reg_isoBogota, reg_isoParts, reg_msToIso, reg_pad, reg_horaProgramada, reg_progADate y reg_fsDoc del Reglamento, y
// CIE.AVISO_TECNICO_A / reg_caja de CierreTurnos. Los cinco deben vivir en el mismo proyecto.
//
// ── QUÉ HACE ──
// Cada hora calcula, para los últimos 14 días, cuántos agentes hay PROGRAMADOS (la malla) y cuántos REALES (turnos iniciados) en cada hora de
// cada fecha, por línea de la malla y en total (línea = TODAS), y lo escribe en una HOJA DE GOOGLE APARTE que lee el dashboard. El dashboard
// NUNCA toca Firestore ni la malla: solo ve esa hoja, que contiene SOLO CONTEOS (ni nombres, ni correos, ni IDs).
//
// ── COLUMNAS DE LA HOJA «conteos» ──
//   fecha (AAAA-MM-DD, Bogotá) · hora (0–23) · pais (fijo «Colombia») · linea (la de la malla, tal cual; vacía → «(sin línea)»; TODAS = total)
//   agentes_programados · agentes_reales · actualizado_at (AAAA-MM-DDTHH:MM:SS-05:00) · estado (provisional | cerrado)
// Una fila por fecha × hora × línea; las horas sin agentes van con 0. Una línea aparece en una fecha si alguna fila de la malla la toca ese día
// (incluido el tramo posterior a la medianoche de un turno nocturno del día anterior); TODAS aparece siempre.
//
// ── CÓMO SE CUENTA (misma regla que el mapa de calor de Insights, agentesPorHora en index.html) ──
// • Cada valor es un PROMEDIO de la hora: minutos de agentes en turno ÷ 60 (un agente que entra a las 8:30 cuenta 0,5 a las 8). 2 decimales.
// • Programados: entrada → salida de la malla (si la salida es menor o igual a la entrada se suma un día: turno nocturno). Se ignoran: admins,
//   filas con novedad (salvo la media jornada de votaciones), filas sin horario y filas con entrada = salida SIN novedad.
// • Reales: el turno del agente ese día (ended > interrupted > el más reciente), de su inicio real a su fin real; un turno activo de HOY cuenta
//   hasta ahora; se descartan los turnos de más de 14 h y los sin cierre de días pasados (casi siempre un turno olvidado). Ni el almuerzo ni las
//   pausas se descuentan.
// • Cada MINUTO se asigna a la fecha y hora de Bogotá en que ocurre (zona fija America/Bogota, nunca la del navegador ni la del script): un turno
//   22:00–06:00 del día D pone las horas 22 y 23 en D y las 0 a 5 en D+1. El cálculo arranca UN DÍA ANTES del rango para que la madrugada del
//   primer día no quede vacía.
// • Un agente cuenta UNA sola vez por línea y por TODAS aunque tenga dos filas que se solapen. Un agente con dos líneas distintas cuenta una vez en
//   cada línea y una sola vez en TODAS.
// • Lo que todavía no ocurre NO es cero: las horas de hoy que no han llegado llevan agentes_reales VACÍO (programados sí va); lo mismo pasa con
//   fechas futuras. Una hora de hoy a medias se promedia sobre los minutos ya transcurridos.
// • EXCLUIDO el personal de Storage, con la MISMA regla del botón «Sin Storage» de Insights: «storage» (sin distinguir mayúsculas ni tildes) en la
//   línea o el rol de la fila. Por eso no hay ninguna línea «Storage» en la hoja. Si algún día hay contaminación, se pasa a una lista explícita.
// • Una fecha sin NINGUNA fila en la malla no se escribe (no se sabe si no había nadie o la malla no llega ahí): se informa en el log.
//
// ── ESTADO Y CORRECCIONES ──
// Cada ejecución recalcula y SOBRESCRIBE los últimos 14 días (una fecha ya escrita se reemplaza entera). «provisional» = la fecha tiene menos de 7
// días; «cerrado» = 7 o más (a los 14 días deja de recalcularse). Lo que corrija un admin después (edición de tiempos, cierre automático de un
// turno olvidado, un cambio en la malla) se refleja solo mientras la fecha siga dentro de esos 14 días.
//
// ── FALLA SEGURA ──
// Si no se puede leer Firestore (turnos o admins), la malla o la hoja, NO se escribe nada (una lectura fallida nunca significa «no hay turnos» ni
// «no hay admins») y se envía UN correo técnico al Super Admin (máximo uno por hora). La hoja destino debe tener el encabezado esperado.
//
// ── PUESTA EN MARCHA (a mano, en este orden) ──
//  1) Pegar este archivo en el proyecto de Apps Script.
//  2) Propiedad de script dash_lector_email = correo de la cuenta de servicio que lee el dashboard (no se guarda en el repositorio).
//  3) Ejecutar dashboardCrearHoja(): crea la hoja «Pi GOps — conteos por hora (dashboard)», guarda su ID en la propiedad dash_sheet_id, la comparte
//     como LECTOR con dash_lector_email y deja el ID y la URL en el log. (Si prefieres una hoja ya creada, pon su ID en dash_sheet_id con el
//     encabezado de arriba en la fila 1 de una pestaña llamada «conteos», y ejecuta dashboardCompartir().)
//  4) Ejecutar dashboardVerificarSemana() (solo lectura) y comparar con el mapa de Insights (ver su comentario).
//  5) Ejecutar dashboardCargaInicial() (12 semanas; informa hasta dónde llega la malla).
//  6) Ejecutar instalarDisparadorDashboard() (cada hora).
// Si el Google Workspace bloquea compartir con una cuenta externa, el administrador del dominio debe permitirlo para esa cuenta de servicio.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

var DASH = {
  PAIS: 'Colombia',
  TODAS: 'TODAS',
  SIN_LINEA: '(sin línea)',
  HOJA: 'conteos',
  ENCABEZADOS: ['fecha', 'hora', 'pais', 'linea', 'agentes_programados', 'agentes_reales', 'actualizado_at', 'estado'],
  DIAS_RECALCULO: 14,        // ventana que se recalcula y sobrescribe en cada ejecución (hoy incluido)
  SEMANAS_INICIAL: 12,
  DIAS_PROVISIONAL: 7,       // una fecha con menos de 7 días es «provisional»
  HORAS_TURNO_MAX: 14,       // un turno real de más de 14 h se descarta (casi siempre un turno olvidado)
  DIAS_POR_CONSULTA: 7,      // los turnos se leen en tramos de 7 días (sin offset: cada documento se lee una vez)
  LIMITE_CONSULTA: 2000
};

// ═══════════════ CÁLCULO PURO (sin IO) ═══════════════
function dash_isoMas(iso, n) { var p = reg_isoParts(iso); return reg_msToIso(Date.UTC(p.y, p.m - 1, p.d + n)); }
function dash_diasEntre(a, b) { var pa = reg_isoParts(a), pb = reg_isoParts(b); return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000); }
// Epoch (ms) de la medianoche de Bogotá de la fecha iso (Colombia no tiene horario de verano: UTC−5 fijo)
function dash_inicioDia(iso) { var p = reg_isoParts(iso); return Date.UTC(p.y, p.m - 1, p.d, 5, 0, 0); }
function dash_esVotaciones_(n) { var u = String(n || '').toUpperCase(); return u.indexOf('1/2') !== -1 && u.indexOf('VOT') !== -1; }
// MISMA regla que simulEsStorage (index.html): «storage» en la línea o el rol, sin distinguir mayúsculas ni tildes
function dash_esStorage(r) {
  var f = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  return f(r.linea).indexOf('storage') !== -1 || f(r.rol).indexOf('storage') !== -1;
}
function dash_actualizadoAt(now) { return new Date(now.getTime() - 5 * 3600000).toISOString().slice(0, 19) + '-05:00'; }
function dash_redondear(x) { return Math.round(x * 100) / 100; }
// Turno de un agente en un día (misma elección que el Panel de Control): ended > interrupted > el primero; la lista viene del más reciente al más antiguo.
function dash_elegirTurno(lista) {
  if (!lista || !lista.length) return null;
  var i;
  for (i = 0; i < lista.length; i++) if (lista[i].status === 'ended') return lista[i];
  for (i = 0; i < lista.length; i++) if (lista[i].status === 'interrupted') return lista[i];
  return lista[0];
}
function dash_ordenLinea(a, b) { if (a === b) return 0; if (a === DASH.TODAS) return -1; if (b === DASH.TODAS) return 1; return a < b ? -1 : 1; }
function dash_ordenFila(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  var l = dash_ordenLinea(String(a[3]), String(b[3]));
  return l !== 0 ? l : a[1] - b[1];
}
function dash_slot(pres, iso, clave, u) {
  var d = pres[iso] || (pres[iso] = {}), c = d[clave] || (d[clave] = {});
  return c[u] || (c[u] = { p: new Uint8Array(1440), r: new Uint8Array(1440) });
}
// Marca presencia minuto a minuto en la fecha y hora de Bogotá en que ocurre cada minuto (los días fuera del rango de salida se descartan).
// Misma fórmula que llenar() de agentesPorHora: arranca en el minuto del inicio y cubre ceil(duración) minutos.
function dash_llenar(pres, salida, campo, u, claves, sMs, eMs) {
  var cur = sMs;
  while (cur < eMs) {
    var iso = reg_isoBogota(new Date(cur)), d0 = dash_inicioDia(iso), hasta = Math.min(eMs, d0 + 86400000);
    if (salida[iso]) {
      var m0 = Math.floor((cur - d0) / 60000), m1 = Math.min(1440, m0 + Math.max(1, Math.ceil((hasta - cur) / 60000)));
      for (var c = 0; c < claves.length; c++) { var a = dash_slot(pres, iso, claves[c], u)[campo]; for (var m = m0; m < m1; m++) a[m] = 1; }
    }
    cur = hasta;
  }
}
// e: {now:Date, desdeISO, hastaISO, malla:[{iso,usuario(minúsculas),rol,inicio,fin,linea,novedad}], turnos:[{userEmail,status,startTime:Date,endTime:Date|null}] (del más reciente al más antiguo),
//     admins:{correoMinúsculas:true}, sinDiaPrevio:bool (solo para comparar con Insights, que no mira el día anterior)}
// Devuelve {filas:[[fecha,hora,pais,linea,programados,reales,actualizado_at,estado]], escritas:[fechas], resumen}. Solo números y etiquetas de línea.
function dash_calcular(e) {
  var now = e.now, hoy = reg_isoBogota(now), desde = e.desdeISO, hasta = e.hastaISO;
  var ini = e.sinDiaPrevio ? desde : dash_isoMas(desde, -1), admins = e.admins || {};
  var res = { ignoradasEntradaIgualSalida: 0, turnosLargosDescartados: 0, agentesConFilaDuplicada: 0, storageExcluidos: 0, filasMalla: 0, filasConTurno: 0 };
  var salida = {}, fechasConMalla = {}, iso;
  for (iso = desde; iso <= hasta; iso = dash_isoMas(iso, 1)) salida[iso] = true;
  e.malla.forEach(function (m) { if (salida[m.iso]) fechasConMalla[m.iso] = true; });
  var porDia = {};
  e.turnos.forEach(function (t) { var k = String(t.userEmail || '').toLowerCase() + '|' + reg_isoBogota(t.startTime); (porDia[k] = porDia[k] || []).push(t); });
  var pres = {}, storage = {}, vistas = {}, duplicados = {};
  e.malla.forEach(function (m) {
    if (m.iso < ini || m.iso > hasta) return;
    var u = String(m.usuario || '').toLowerCase();
    if (!u || admins[u]) return;
    var hi = reg_horaProgramada(m.inicio), hf = reg_horaProgramada(m.fin);
    if (!hi || !hf) return;
    if (m.novedad && !dash_esVotaciones_(m.novedad)) return;
    var s = reg_progADate(m.iso, hi).getTime(), f = reg_progADate(m.iso, hf).getTime();
    if (!m.novedad && s === f) { res.ignoradasEntradaIgualSalida++; return; }
    if (dash_esStorage(m)) { storage[u] = true; return; }
    if (f <= s) f += 86400000;
    res.filasMalla++;
    var kd = u + '|' + m.iso;
    if (vistas[kd]) duplicados[kd] = true; vistas[kd] = true;
    var linea = m.linea ? String(m.linea) : DASH.SIN_LINEA, claves = [linea, DASH.TODAS];
    dash_llenar(pres, salida, 'p', u, claves, s, f);
    var t = dash_elegirTurno(porDia[kd]);
    if (!t || !t.startTime) return;
    var rs = t.startTime.getTime(), re = t.endTime ? t.endTime.getTime() : null;
    if (re === null && t.status === 'active' && reg_isoBogota(t.startTime) === hoy && now.getTime() > rs) re = now.getTime();
    if (re === null || re <= rs) return;
    if (re - rs > DASH.HORAS_TURNO_MAX * 3600000) { res.turnosLargosDescartados++; return; }
    res.filasConTurno++;
    dash_llenar(pres, salida, 'r', u, claves, rs, re);
  });
  res.storageExcluidos = Object.keys(storage).length;
  res.agentesConFilaDuplicada = Object.keys(duplicados).length;
  var filas = [], escritas = [], sinMalla = [], ahoraMin = Math.floor((now.getTime() - dash_inicioDia(hoy)) / 60000), act = dash_actualizadoAt(now);
  for (iso = desde; iso <= hasta; iso = dash_isoMas(iso, 1)) {
    if (!fechasConMalla[iso]) { sinMalla.push(iso); continue; }
    escritas.push(iso);
    var estado = dash_diasEntre(iso, hoy) < DASH.DIAS_PROVISIONAL ? 'provisional' : 'cerrado';
    var claves = Object.keys(pres[iso] || {}).filter(function (k) { return k !== DASH.TODAS; }).sort(dash_ordenLinea);
    claves.unshift(DASH.TODAS);
    for (var c = 0; c < claves.length; c++) {
      var usuarios = ((pres[iso] || {})[claves[c]]) || {}, us = Object.keys(usuarios);
      for (var h = 0; h < 24; h++) {
        var obs = iso > hoy ? 0 : iso === hoy ? Math.max(0, Math.min(60, ahoraMin - h * 60)) : 60, sp = 0, sr = 0, m;
        for (var k = 0; k < us.length; k++) {
          var a = usuarios[us[k]];
          for (m = h * 60; m < h * 60 + 60; m++) sp += a.p[m];
          for (m = h * 60; m < h * 60 + obs; m++) sr += a.r[m];
        }
        filas.push([iso, h, DASH.PAIS, claves[c], dash_redondear(sp / 60), obs ? dash_redondear(sr / obs) : '', act, estado]);
      }
    }
  }
  filas.sort(dash_ordenFila);
  res.filas = filas.length; res.fechasEscritas = escritas.length; res.fechasSinMalla = sinMalla;
  return { filas: filas, escritas: escritas, resumen: res };
}

// ═══════════════ ORQUESTACIÓN (IO inyectable) ═══════════════
// deps: {now(), leerMalla(desdeISO)→{rows,minIso,maxIso}, admins()→{correo:true}, leerTurnos(desdeISO,hastaISO), escribir(filas,escritas), avisoTecnico(motivo, now)}
// opts: {desdeISO, hastaISO, sinEscribir, sinDiaPrevio}. Lanza ante cualquier lectura fallida SIN escribir nada.
function dash_correr(deps, opts) {
  var now = deps.now(), hoy = reg_isoBogota(now);
  var hasta = opts.hastaISO || hoy, desde = opts.desdeISO || dash_isoMas(hoy, -(DASH.DIAS_RECALCULO - 1));
  var ini = opts.sinDiaPrevio ? desde : dash_isoMas(desde, -1);
  var mallaRes = deps.leerMalla(ini);
  var enRango = mallaRes.rows.filter(function (m) { return m.iso >= ini && m.iso <= hasta; }).length;
  if (!enRango) throw new Error('la malla no tiene ninguna fila entre ' + ini + ' y ' + hasta + ' (no se puede distinguir «sin programación» de una lectura incompleta)');
  var admins = deps.admins();
  var turnos = deps.leerTurnos(ini, hasta);
  var calc = dash_calcular({ now: now, desdeISO: desde, hastaISO: hasta, malla: mallaRes.rows, turnos: turnos, admins: admins, sinDiaPrevio: !!opts.sinDiaPrevio });
  var escrito = null;
  if (!opts.sinEscribir && calc.escritas.length) escrito = deps.escribir(calc.filas, calc.escritas);
  return { desde: desde, hasta: hasta, malla: { minIso: mallaRes.minIso, maxIso: mallaRes.maxIso }, turnosLeidos: turnos.length, filas: calc.filas, escritas: calc.escritas, resumen: calc.resumen, escrito: escrito };
}

// ═══════════════ PRODUCCIÓN: Firestore REST, Sheets ═══════════════
// Malla: B fecha (día/mes/año), C usuario, E rol, F inicio, G fin, I línea, K novedad. NO se leen nombres. Devuelve también hasta dónde llega la malla.
function dash_leerMalla(desdeISO) {
  var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) throw new Error('No se encontró la hoja Malla');
  var data = sheet.getDataRange().getDisplayValues(), rows = [], minIso = null, maxIso = null;
  if (!data || data.length < 2) throw new Error('la hoja Malla está vacía');
  for (var i = 1; i < data.length; i++) {
    var r = data[i], iso = mallaFechaISO_(r[1]);
    if (!iso) continue;
    if (!minIso || iso < minIso) minIso = iso;
    if (!maxIso || iso > maxIso) maxIso = iso;
    if (iso < desdeISO) continue;
    rows.push({ iso: iso, usuario: String(r[2] || '').trim().toLowerCase(), rol: String(r[4] || '').trim(), inicio: String(r[5] || '').trim(), fin: String(r[6] || '').trim(), linea: String(r[8] || '').trim(), novedad: String(r[10] || '').trim() });
  }
  return { rows: rows, minIso: minIso, maxIso: maxIso };
}
function dash_validarRespuesta_(resp, que) {
  var code = resp.getResponseCode(), texto = resp.getContentText() || '';
  if (code !== 200) { Logger.log('Firestore ' + que + ': HTTP ' + code + ' — cuerpo: ' + texto.slice(0, 1000)); throw new Error('Firestore respondió HTTP ' + code + ' (' + que + ')'); }
  var v;
  try { v = JSON.parse(texto); } catch (e) { Logger.log('Firestore ' + que + ': el cuerpo no es JSON — ' + texto.slice(0, 1000)); throw new Error('la respuesta de Firestore no es JSON válido (' + que + ')'); }
  return v;
}
// Administradores (colección admins; el ID del documento es el correo) + Super Admin + propiedad opcional dash_excluir_correos. Lanza ante cualquier falla.
function dash_leerAdmins() {
  var set = {}, token = '';
  do {
    var url = FIREBASE_REST + '/admins?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var body = dash_validarRespuesta_(UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }), 'admins');
    if (body && body.error) throw new Error('Firestore devolvió un error al leer admins');
    (body.documents || []).forEach(function (d) { set[String(d.name || '').split('/').pop().toLowerCase()] = true; });
    token = body.nextPageToken || '';
  } while (token);
  set[String(CIE.AVISO_TECNICO_A).toLowerCase()] = true; // Super Admin
  String(PropertiesService.getScriptProperties().getProperty('dash_excluir_correos') || '').split(',').forEach(function (x) { x = x.trim().toLowerCase(); if (x) set[x] = true; });
  return set;
}
// Turnos con startTime en [desdeISO 00:00, hastaISO+1 00:00) de Bogotá, en tramos de 7 días; se omiten los archivados. Del más reciente al más antiguo.
function dash_leerTurnos(desdeISO, hastaISO) {
  var out = [], a = desdeISO;
  while (a <= hastaISO) {
    var b = dash_isoMas(a, DASH.DIAS_POR_CONSULTA - 1);
    if (b > hastaISO) b = hastaISO;
    var body = { structuredQuery: { from: [{ collectionId: 'turnos' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(dash_inicioDia(a)).toISOString() } } },
        { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'LESS_THAN', value: { timestampValue: new Date(dash_inicioDia(dash_isoMas(b, 1))).toISOString() } } }] } },
      orderBy: [{ field: { fieldPath: 'startTime' }, direction: 'DESCENDING' }], limit: DASH.LIMITE_CONSULTA } };
    var arr = dash_validarRespuesta_(UrlFetchApp.fetch(FIREBASE_REST + ':runQuery', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify(body), muteHttpExceptions: true }), 'turnos ' + a + '..' + b);
    if (!Array.isArray(arr)) throw new Error('la respuesta de Firestore no es un arreglo (turnos ' + a + '..' + b + ')');
    var docs = 0;
    arr.forEach(function (r) {
      if (r && r.error) { Logger.log('Firestore turnos: error dentro del arreglo — ' + JSON.stringify(r.error).slice(0, 1000)); throw new Error('Firestore devolvió un error dentro del arreglo (turnos ' + a + '..' + b + ')'); }
      if (!r || !r.document) return;
      docs++;
      var o = reg_fsDoc(r.document);
      if (!o.userEmail || !o.startTime || o.status === 'archivado') return;
      out.push({ userEmail: o.userEmail, status: o.status || '', startTime: new Date(o.startTime), endTime: o.endTime ? new Date(o.endTime) : null });
    });
    if (docs >= DASH.LIMITE_CONSULTA) throw new Error('el tramo ' + a + '..' + b + ' alcanzó el límite de ' + DASH.LIMITE_CONSULTA + ' turnos y puede estar incompleto');
    a = dash_isoMas(b, 1);
  }
  out.sort(function (x, y) { return y.startTime.getTime() - x.startTime.getTime(); });
  return out;
}
function dash_hoja() {
  var id = PropertiesService.getScriptProperties().getProperty('dash_sheet_id');
  if (!id) throw new Error('falta la propiedad dash_sheet_id (ejecuta dashboardCrearHoja)');
  var sh = SpreadsheetApp.openById(id).getSheetByName(DASH.HOJA);
  if (!sh) throw new Error('la hoja de destino no tiene una pestaña llamada «' + DASH.HOJA + '»');
  var enc = sh.getRange(1, 1, 1, DASH.ENCABEZADOS.length).getValues()[0];
  for (var i = 0; i < DASH.ENCABEZADOS.length; i++) if (String(enc[i]) !== DASH.ENCABEZADOS[i]) throw new Error('el encabezado de la hoja de destino no es el esperado (columna ' + (i + 1) + ': «' + enc[i] + '» en vez de «' + DASH.ENCABEZADOS[i] + '»); no se escribe');
  return sh;
}
// Reemplaza en la hoja TODAS las filas de las fechas `escritas` por `filas` y deja la tabla ordenada (fecha, línea con TODAS primero, hora). Solo toca
// desde la primera fecha escrita hacia abajo; lo anterior no se lee ni se modifica. Las columnas de texto (fecha, línea, actualizado_at, estado) se
// fijan como texto para que Sheets no las convierta en fechas ni en fórmulas.
function dash_escribir(sheet, filas, escritas) {
  var ncol = DASH.ENCABEZADOS.length, minIso = escritas.slice().sort()[0], set = {};
  escritas.forEach(function (f) { set[f] = true; });
  var ultima = sheet.getLastRow(), ini = ultima + 1, i;
  if (ultima > 1) {
    var fechas = sheet.getRange(2, 1, ultima - 1, 1).getValues();
    for (i = 0; i < fechas.length; i++) {
      var f = fechas[i][0] instanceof Date ? Utilities.formatDate(fechas[i][0], 'America/Bogota', 'yyyy-MM-dd') : String(fechas[i][0]);
      if (f >= minIso) { ini = i + 2; break; }
    }
  }
  var cola = ini <= ultima ? sheet.getRange(ini, 1, ultima - ini + 1, ncol).getValues() : [];
  var conservadas = cola.filter(function (r) { return !set[String(r[0])]; });
  var todas = conservadas.concat(filas).sort(dash_ordenFila);
  var finNecesario = ini + todas.length - 1;
  if (sheet.getMaxRows() < finNecesario) sheet.insertRowsAfter(sheet.getMaxRows(), finNecesario - sheet.getMaxRows());
  [1, 4, 7, 8].forEach(function (c) { sheet.getRange(ini, c, todas.length, 1).setNumberFormat('@'); });
  sheet.getRange(ini, 1, todas.length, ncol).setValues(todas);
  if (ultima >= ini + todas.length) sheet.getRange(ini + todas.length, 1, ultima - (ini + todas.length) + 1, ncol).clearContent();
  return { filasEscritas: filas.length, filasConservadas: conservadas.length, desdeFila: ini, ultimaFila: ini + todas.length - 1 };
}
// Aviso técnico al Super Admin: máximo UNO por hora (propiedad dash_fail_notified_at). Si el correo falla, solo queda en el log.
function dash_avisoTecnico(motivo, now) {
  var props = PropertiesService.getScriptProperties();
  var ultimo = parseInt(props.getProperty('dash_fail_notified_at') || '0', 10);
  if (ultimo && now.getTime() - ultimo < 3600000) { Logger.log('Aviso técnico del dashboard omitido: ya se envió uno hace ' + Math.round((now.getTime() - ultimo) / 60000) + ' min (máximo uno por hora).'); return false; }
  try {
    var html = reg_caja('⚠️ Conteos para el dashboard: no se pudieron actualizar', '#dc2626',
      '<p><strong>' + escHtml_(motivo) + '</strong></p>' +
      '<p>En esta ejecución <strong>no se escribió nada</strong> en la hoja del dashboard (una lectura fallida nunca se interpreta como «no hay turnos» ni «no hay admins»); los datos anteriores siguen ahí. Se reintentará en la próxima hora; este aviso se envía como máximo una vez por hora.</p>' +
      '<p style="color:#6b7280;font-size:13px;">Detalle en Apps Script → Ejecuciones → dashboardActualizar.</p>');
    GmailApp.sendEmail(CIE.AVISO_TECNICO_A, 'Conteos del dashboard: ' + String(motivo).slice(0, 120), 'Este mensaje requiere un cliente de correo con HTML.', { htmlBody: html, name: 'Pi GOps' });
    props.setProperty('dash_fail_notified_at', String(now.getTime()));
    Logger.log('Aviso técnico enviado: ' + motivo);
    return true;
  } catch (e) { Logger.log('No se pudo enviar el aviso técnico del dashboard: ' + e.message); return false; }
}
function dash_depsProduccion() {
  return { now: function () { return new Date(); }, leerMalla: dash_leerMalla, admins: dash_leerAdmins, leerTurnos: dash_leerTurnos,
    escribir: function (filas, escritas) { return dash_escribir(dash_hoja(), filas, escritas); }, avisoTecnico: dash_avisoTecnico };
}
function dash_logResumen_(res) {
  var r = res.resumen;
  Logger.log('Rango ' + res.desde + ' → ' + res.hasta + ' · malla disponible ' + res.malla.minIso + ' → ' + res.malla.maxIso + ' · turnos leídos: ' + res.turnosLeidos +
    ' · fechas escritas: ' + r.fechasEscritas + ' · filas: ' + r.filas);
  Logger.log('Storage excluidos (agentes distintos, sin nombres): ' + r.storageExcluidos + ' · filas con entrada = salida y sin novedad ignoradas: ' + r.ignoradasEntradaIgualSalida +
    ' · turnos de más de ' + DASH.HORAS_TURNO_MAX + ' h descartados: ' + r.turnosLargosDescartados + ' · agentes con dos filas el mismo día: ' + r.agentesConFilaDuplicada);
  if (r.fechasSinMalla.length) Logger.log('SIN FILAS EN LA MALLA (no se escribieron): ' + r.fechasSinMalla.length + ' fechas — de ' + r.fechasSinMalla[0] + ' a ' + r.fechasSinMalla[r.fechasSinMalla.length - 1] + ': ' + r.fechasSinMalla.join(', '));
  if (res.escrito) Logger.log('Hoja: ' + res.escrito.filasEscritas + ' filas escritas, ' + res.escrito.filasConservadas + ' conservadas (fechas fuera de la ventana dentro de la cola), hasta la fila ' + res.escrito.ultimaFila);
}

// ── Disparador (cada hora): recalcula y sobrescribe los últimos 14 días ──
function dashboardActualizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Conteos del dashboard: otra ejecución en curso — se omite'); return; }
  var deps = dash_depsProduccion();
  try {
    dash_logResumen_(dash_correr(deps, {}));
  } catch (e) {
    Logger.log('Conteos del dashboard: NO se actualizó nada — ' + e.message);
    deps.avisoTecnico('No se pudieron actualizar los conteos: ' + e.message, deps.now());
  } finally { lock.releaseLock(); }
}
// Carga inicial: 12 semanas hacia atrás. Informa hasta dónde llega la malla y qué fechas no tienen filas (esas NO se escriben).
function dashboardCargaInicial() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Otra ejecución en curso'); return; }
  try {
    var deps = dash_depsProduccion(), hoy = reg_isoBogota(deps.now());
    var res = dash_correr(deps, { desdeISO: dash_isoMas(hoy, -7 * DASH.SEMANAS_INICIAL), hastaISO: hoy });
    Logger.log('=== CARGA INICIAL (' + DASH.SEMANAS_INICIAL + ' semanas) ===');
    dash_logResumen_(res);
    if (res.malla.minIso > res.desde) Logger.log('LA MALLA NO LLEGA TAN ATRÁS: empieza el ' + res.malla.minIso + ' (se pidió desde ' + res.desde + ').');
    return res.resumen;
  } finally { lock.releaseLock(); }
}
// SOLO LECTURA: calcula una semana (lunes a domingo) SIN escribir y la imprime como el mapa de Insights, para comparar celda por celda.
// Semana: propiedad dash_verif_desde (un lunes AAAA-MM-DD) o, si no existe, la última semana completa. En Insights: elige esas mismas fechas, «Comparar»,
// «Promedio» y activa «Sin Storage». El cálculo NO mira el día anterior (Insights tampoco), por eso la madrugada del lunes puede diferir de la hoja real.
// Cada celda es «programados / reales» con un decimal («–» = aún no ocurre). Diferencia esperada con Insights: el mapa cuenta filas y la hoja cuenta agentes
// (distintos solo si un agente tiene dos filas solapadas el mismo día: se informa cuántos).
function dashboardVerificarSemana() {
  var deps = dash_depsProduccion(), hoy = reg_isoBogota(deps.now());
  var desde = PropertiesService.getScriptProperties().getProperty('dash_verif_desde');
  if (!desde) { var g = new Date(dash_inicioDia(hoy) + 12 * 3600000).getUTCDay(); desde = dash_isoMas(hoy, -((g + 6) % 7) - 7); }
  var res = dash_correr(deps, { desdeISO: desde, hastaISO: dash_isoMas(desde, 6), sinEscribir: true, sinDiaPrevio: true });
  dash_logResumen_(res);
  var f1 = function (x) { return x === '' ? '–' : (Math.round(x * 10) / 10).toString().replace('.', ','); };
  var dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], fechas = [];
  for (var d = 0; d < 7; d++) fechas.push(dash_isoMas(desde, d));
  var lineas = ['hora  ' + fechas.map(function (f, i) { return (dias[i] + ' ' + f.slice(8)).padEnd(11); }).join('')];
  for (var h = 0; h < 24; h++) {
    lineas.push(String(h).padStart(2, '0') + ':00 ' + fechas.map(function (f) {
      var fila = res.filas.filter(function (r) { return r[0] === f && r[1] === h && r[3] === DASH.TODAS; })[0];
      return (fila ? f1(fila[4]) + '/' + f1(fila[5]) : 'sin malla').padEnd(11);
    }).join(''));
  }
  Logger.log('=== SEMANA ' + desde + ' → ' + dash_isoMas(desde, 6) + ' · línea TODAS · programados / reales (comparar con Insights: Comparar + Promedio + Sin Storage) ===\n' + lineas.join('\n'));
  return res.resumen;
}

// ═══════════════ PUESTA EN MARCHA ═══════════════
// Crea la hoja destino (SOLO CONTEOS), guarda su ID en la propiedad dash_sheet_id y la comparte como lector. Si ya hay una, no crea otra.
function dashboardCrearHoja() {
  var props = PropertiesService.getScriptProperties(), existente = props.getProperty('dash_sheet_id');
  if (existente) { Logger.log('Ya existe una hoja de destino (dash_sheet_id = ' + existente + '). No se crea otra.'); return existente; }
  var ss = SpreadsheetApp.create('Pi GOps — conteos por hora (dashboard)'), sh = ss.getSheets()[0];
  sh.setName(DASH.HOJA);
  sh.getRange(1, 1, 1, DASH.ENCABEZADOS.length).setNumberFormat('@').setValues([DASH.ENCABEZADOS]).setFontWeight('bold');
  [1, 4, 7, 8].forEach(function (c) { sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@'); });
  sh.setFrozenRows(1);
  props.setProperty('dash_sheet_id', ss.getId());
  Logger.log('Hoja creada. ID: ' + ss.getId() + ' · URL: ' + ss.getUrl());
  dashboardCompartir();
  return ss.getId();
}
// Comparte la hoja como LECTOR con la cuenta de la propiedad dash_lector_email (la cuenta de servicio del dashboard).
function dashboardCompartir() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('dash_sheet_id'), email = String(props.getProperty('dash_lector_email') || '').trim();
  if (!id) { Logger.log('Falta dash_sheet_id: ejecuta dashboardCrearHoja().'); return false; }
  if (!email) { Logger.log('Falta la propiedad dash_lector_email (correo de la cuenta de servicio que lee el dashboard). La hoja NO se compartió.'); return false; }
  DriveApp.getFileById(id).addViewer(email);
  Logger.log('Hoja ' + id + ' compartida como LECTOR con ' + email);
  return true;
}
// Ejecutar UNA vez desde el editor: crea el disparador horario (y borra duplicados de este mismo).
function instalarDisparadorDashboard() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dashboardActualizar') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dashboardActualizar').timeBased().everyHours(1).create();
  Logger.log('Disparador de los conteos del dashboard instalado (cada hora).');
}
// SOLO LECTURA: comprueba propiedades, acceso a la hoja y disparador.
function diagnosticoDashboard() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('dash_sheet_id: ' + (props.getProperty('dash_sheet_id') || 'FALTA') + ' · dash_lector_email: ' + (props.getProperty('dash_lector_email') ? 'configurada' : 'FALTA'));
  try { var sh = dash_hoja(); Logger.log('Hoja de destino OK (' + Math.max(0, sh.getLastRow() - 1) + ' filas de datos).'); } catch (e) { Logger.log('Hoja de destino: ' + e.message); }
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dashboardActualizar'; });
  Logger.log('Disparador horario: ' + (hay ? 'instalado' : 'NO instalado (ejecuta instalarDisparadorDashboard)'));
}
