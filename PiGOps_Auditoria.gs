// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  PiGOps_Auditoria.gs — SOLO LECTURA. TERCER archivo del proyecto de Apps Script «Pi GOps Notificaciones»
//  (reutiliza FIREBASE_PROJECT de PiGOps_Notificaciones_v5.gs). No tiene doGet/doPost, no envía correos, no escribe
//  en Firestore, en Sheets ni en propiedades: solo lee `turnos` y escribe en el Registro de ejecución.
//
//  Para qué sirve: la hora de inicio (`startTime`) la pone el reloj del PC del agente. Cada documento de Firestore trae además
//  `createTime`, fijado por el SERVIDOR en el instante de la creación, que ningún cliente puede falsear. Si `startTime` está muy
//  lejos de `createTime`, ese turno NO debe usarse como evidencia sin revisarlo (ni para un llamado de atención ni para una falta).
//
//  Uso (editor de Apps Script → seleccionar la función → Ejecutar → Ver → Registros de ejecución):
//    auditoriaRelojes()   turnos desde el 1-nov-2026 (REGLAMENTO_DESDE)
//    auditoriaRelojesDesde('2026-11-04')   desde otra fecha (yyyy-MM-dd, hora de Bogotá)
//
//  Ventana acordada (diferencia = startTime − createTime):
//    entre −2 min y +1 min ............ OK
//    entre −12 min y −2 min ........... REVISAR_REINTENTO: startTime anterior a la creación; es lo esperable tras una caída de red
//                                       (la app conserva la hora del clic hasta 10 min al reintentar), pero también lo que
//                                       produciría un reloj atrasado de pocos minutos
//    menos de −12 min ................. ATRASADO: startTime mucho más temprano que la creación (favorece al agente: oculta tardanza)
//    más de +1 min .................... ADELANTADO: startTime posterior a la creación; el reloj iba adelantado (perjudica al agente:
//                                       le suma tardanza que no tuvo)
//    turno con `editedBy`/`forcedClosedBy` EDITADO_POR_ADMIN: un admin pudo cambiar startTime a propósito; se lista aparte
//
//  Limitaciones: (1) la consulta es por startTime (se incluye 1 día de margen hacia atrás para no perder turnos con la hora
//  adelantada); (2) `createTime` no cambia nunca, pero un turno borrado y recreado por alguien con acceso tendría un createTime nuevo
//  (por eso Fase 3 prohíbe borrar turnos); (3) no puede probar quién tocó el reloj, solo que startTime no concuerda con el servidor.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
var AUD_CONFIG = {
  DESDE: '2026-11-01',   // = REGLAMENTO_DESDE
  ATRAS_OK_MIN: 2,       // startTime puede ser hasta 2 min ANTERIOR a createTime
  ADELANTE_OK_MIN: 1,    // y hasta 1 min POSTERIOR
  REINTENTO_MIN: 12,     // hasta 12 min anterior: posible reintento legítimo (v17.9: la app conserva el clic hasta 10 min)
  PAGINA: 300,
  MAX_TURNOS: 5000       // tope de seguridad; si se alcanza, la auditoría FALLA (no entrega un resultado parcial)
};

// Clasifica UN turno. Pura (sin IO) para poder probarla. diffSeg = startTime − createTime en segundos.
function aud_clasificar(diffSeg, editadoPorAdmin, cfg) {
  cfg = cfg || AUD_CONFIG;
  if (editadoPorAdmin) return 'EDITADO_POR_ADMIN';
  var min = diffSeg / 60;
  if (min >= -cfg.ATRAS_OK_MIN && min <= cfg.ADELANTE_OK_MIN) return 'OK';
  if (min > cfg.ADELANTE_OK_MIN) return 'ADELANTADO';
  if (min >= -cfg.REINTENTO_MIN) return 'REVISAR_REINTENTO';
  return 'ATRASADO';
}

// Lee los turnos desde `desdeISO` (yyyy-MM-dd, Bogotá). Lanza ante CUALQUIER falla de lectura: una auditoría incompleta no
// puede interpretarse como «sin hallazgos» (mismo criterio que leerTurnosHoyRest_).
function aud_leerTurnos(desdeISO, maxTurnos) {
  maxTurnos = maxTurnos || AUD_CONFIG.MAX_TURNOS;
  var token = ScriptApp.getOAuthToken();
  var desde = new Date(desdeISO + 'T00:00:00-05:00');
  var margen = new Date(desde.getTime() - 24 * 3600000).toISOString();
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents:runQuery';
  var turnos = [], offset = 0;
  while (true) {
    var body = { structuredQuery: {
      from: [{ collectionId: 'turnos' }],
      where: { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: margen } } },
      orderBy: [{ field: { fieldPath: 'startTime' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: AUD_CONFIG.PAGINA, offset: offset } };
    var resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body), muteHttpExceptions: true });
    var code = resp.getResponseCode(), texto = resp.getContentText() || '';
    if (code !== 200) throw new Error('Firestore respondió HTTP ' + code + ': ' + texto.slice(0, 300));
    var arr;
    try { arr = JSON.parse(texto); } catch (e) { throw new Error('La respuesta de Firestore no es JSON'); }
    if (!Array.isArray(arr)) throw new Error('La respuesta de Firestore no es un arreglo: ' + texto.slice(0, 300));
    var enPagina = 0;
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (r && r.error) throw new Error('Firestore devolvió un error dentro del arreglo: ' + JSON.stringify(r.error).slice(0, 300));
      if (!r || !r.document) continue;
      enPagina++;
      var f = r.document.fields || {};
      var st = f.startTime && f.startTime.timestampValue;
      if (!st || !r.document.createTime) continue; // sin hora de inicio o sin createTime: no hay nada que comparar
      turnos.push({
        id: String(r.document.name || '').split('/').pop(),
        userEmail: (f.userEmail && f.userEmail.stringValue) || '',
        status: (f.status && f.status.stringValue) || '',
        startTime: new Date(st), createTime: new Date(r.document.createTime),
        endTime: (f.endTime && f.endTime.timestampValue) ? new Date(f.endTime.timestampValue) : null,
        editadoPor: (f.editedBy && f.editedBy.stringValue) || (f.forcedClosedBy && f.forcedClosedBy.stringValue) || '',
        recuperado: !!(f.startRecovered && f.startRecovered.booleanValue),
        cierreAutomatico: !!(f.cierreAutomatico && f.cierreAutomatico.booleanValue),
        overtimeStatus: (f.overtimeStatus && f.overtimeStatus.stringValue) || ''
      });
    }
    if (turnos.length > maxTurnos) throw new Error('Se superó el tope de ' + maxTurnos + ' turnos; la auditoría quedaría incompleta.');
    if (enPagina < AUD_CONFIG.PAGINA) break;
    offset += AUD_CONFIG.PAGINA;
  }
  var d0 = desde.getTime();
  // se descarta el margen: cuenta el turno si su startTime O su createTime caen desde la fecha pedida
  return turnos.filter(function (t) { return t.startTime.getTime() >= d0 || t.createTime.getTime() >= d0; });
}

function aud_hora(d) { return Utilities.formatDate(d, 'America/Bogota', 'yyyy-MM-dd HH:mm:ss'); }
function aud_dif(seg) {
  var s = Math.abs(Math.round(seg)), m = Math.floor(s / 60), r = s % 60;
  return (seg < 0 ? '−' : '+') + m + ' min ' + (r < 10 ? '0' : '') + r + ' s';
}

function auditoriaRelojes() { return auditoriaRelojesDesde(AUD_CONFIG.DESDE); }

function auditoriaRelojesDesde(desdeISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desdeISO))) throw new Error('Fecha inválida; usa yyyy-MM-dd');
  var turnos = aud_leerTurnos(desdeISO);
  var cuenta = { OK: 0, REVISAR_REINTENTO: 0, ATRASADO: 0, ADELANTADO: 0, EDITADO_POR_ADMIN: 0 };
  var hallazgos = [];
  turnos.forEach(function (t) {
    var diffSeg = (t.startTime.getTime() - t.createTime.getTime()) / 1000;
    var cat = aud_clasificar(diffSeg, !!t.editadoPor);
    cuenta[cat]++;
    if (cat !== 'OK') hallazgos.push({ categoria: cat, turnoId: t.id, userEmail: t.userEmail, status: t.status, startTime: t.startTime, createTime: t.createTime,
      diferenciaSeg: Math.round(diffSeg), editadoPor: t.editadoPor, recuperado: t.recuperado });
  });
  var orden = { ATRASADO: 0, ADELANTADO: 1, REVISAR_REINTENTO: 2, EDITADO_POR_ADMIN: 3 };
  hallazgos.sort(function (a, b) { return (orden[a.categoria] - orden[b.categoria]) || (a.startTime - b.startTime); });
  Logger.log('AUDITORÍA DE RELOJES (solo lectura) — turnos desde ' + desdeISO + ' (hora de Bogotá): ' + turnos.length + ' revisados');
  Logger.log('Ventana: startTime − createTime entre −' + AUD_CONFIG.ATRAS_OK_MIN + ' y +' + AUD_CONFIG.ADELANTE_OK_MIN + ' min = OK; hasta −' + AUD_CONFIG.REINTENTO_MIN + ' min = revisar (posible reintento legítimo)');
  Logger.log('OK: ' + cuenta.OK + ' · REVISAR_REINTENTO: ' + cuenta.REVISAR_REINTENTO + ' · ATRASADO: ' + cuenta.ATRASADO + ' · ADELANTADO: ' + cuenta.ADELANTADO + ' · EDITADO_POR_ADMIN: ' + cuenta.EDITADO_POR_ADMIN);
  hallazgos.slice(0, 300).forEach(function (h) {
    Logger.log(h.categoria + ' | ' + h.userEmail + ' | startTime ' + aud_hora(h.startTime) + ' | creado en servidor ' + aud_hora(h.createTime) +
      ' | diferencia ' + aud_dif(h.diferenciaSeg) + ' | estado ' + h.status + (h.editadoPor ? ' | editado por ' + h.editadoPor : '') + ' | turno ' + h.turnoId);
  });
  if (hallazgos.length > 300) Logger.log('… y ' + (hallazgos.length - 300) + ' hallazgos más (solo se imprimen 300; el arreglo devuelto los trae todos).');
  if (!hallazgos.length) Logger.log('Sin hallazgos: todos los turnos concuerdan con la hora del servidor.');
  return { revisados: turnos.length, cuenta: cuenta, hallazgos: hallazgos };
}


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  IMPACTO DEL MODELO ANTIGUO DE STRIKES (solo lectura; 5-nov-2026)
//  Desde el 1-nov-2026 el único sistema que genera llamados de atención es el Reglamento. Estas dos funciones NO envían ni escriben nada:
//
//  auditoriaLlamadosViejos()   lista los correos «⚡ Acción requerida — Llamado de atención #N» y «⚖️ Proceso disciplinario requerido»
//                              enviados DESDE el 1-nov-2026 (agente, fecha, número de llamado, destinatarios), para avisar a los
//                              coordinadores que no aplican. Lee la carpeta ENVIADOS de la cuenta dueña del script con GmailApp.search, que
//                              pide el permiso de LECTURA de Gmail (el script hasta hoy solo enviaba): al ejecutarla por primera vez Apps
//                              Script pide autorizarlo; si el manifiesto (appsscript.json) lista oauthScopes explícitos hay que agregar
//                              https://www.googleapis.com/auth/gmail.readonly. Los llamados del Reglamento NO aparecen (otro asunto).
//  auditoriaNoDesconexion()    revisa, desde el 1-jun-2026, cada día de malla donde el turno cerró MÁS de 4 h después de la salida programada
//                              y lo clasifica: MISMO_DIA (sigue siendo no desconexión) o CIERRE_DIA_POSTERIOR (el turno se cerró otro día:
//                              no hay hora real de salida; con la regla corregida ya NO es no desconexión). Imprime la hora de cierre con su
//                              fecha completa, que es lo que el texto antiguo del correo omitía («salida real 09:30 a. m.»).
//  Usan funciones de PiGOps_Reglamento.gs (mismo proyecto). Ejecutar desde el editor → Ver → Registros de ejecución.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
var AUD_LLAMADOS_VIEJOS = { DESDE: '2026-11-01', MAX_HILOS: 500 };

function aud_textoPlano(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
// Analiza UN correo (asunto, cuerpo) del modelo antiguo. Devuelve null si no es de ese modelo. Pura.
function aud_parsearCorreoViejo(asunto, cuerpoHtml) {
  var a = String(asunto || ''), txt = aud_textoPlano(cuerpoHtml), m;
  var tipo = null, numero = null, agente = '';
  if ((m = a.match(/Acci[oó]n requerida\s*[—-]\s*Llamado de atenci[oó]n\s*#(\d+)\s+para\s+(.+)$/i))) { tipo = 'Llamado de atención'; numero = parseInt(m[1], 10); agente = m[2].trim(); }
  else if ((m = a.match(/Proceso disciplinario requerido\s*[—-]\s*(.+)$/i))) { tipo = 'Proceso disciplinario (3 llamados)'; agente = m[1].trim(); }
  else return null;
  var correo = (txt.match(/\(([^\s()]+@[^\s()]+)\)/) || [])[1] || '';
  var periodo = (txt.match(/en el per[ií]odo\s+(.+?)\s*(?:\(|,|\.|por lo que)/i) || [])[1] || '';
  var strikes = (txt.match(/\((\d+)\s+strikes? en total/i) || [])[1];
  return { tipo: tipo, numero: numero, agente: agente, agenteEmail: correo, periodo: periodo, strikes: strikes ? parseInt(strikes, 10) : null };
}

function auditoriaLlamadosViejos() { return auditoriaLlamadosViejosDesde_(AUD_LLAMADOS_VIEJOS.DESDE); }
function auditoriaLlamadosViejosDesde_(desdeISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desdeISO))) throw new Error('Fecha inválida; usa yyyy-MM-dd');
  var desde = new Date(desdeISO + 'T00:00:00-05:00');
  var d0 = new Date(desde.getTime() - 24 * 3600000);
  var after = d0.getUTCFullYear() + '/' + (d0.getUTCMonth() + 1) + '/' + d0.getUTCDate(); // un día de margen: Gmail interpreta la fecha en otra zona
  var consulta = 'in:sent after:' + after + ' (subject:"Acción requerida" OR subject:"Proceso disciplinario requerido")';
  var hilos = [], pos = 0;
  while (true) {
    var lote = GmailApp.search(consulta, pos, 100);
    hilos = hilos.concat(lote);
    if (lote.length < 100) break;
    pos += 100;
    if (hilos.length >= AUD_LLAMADOS_VIEJOS.MAX_HILOS) throw new Error('Más de ' + AUD_LLAMADOS_VIEJOS.MAX_HILOS + ' hilos: la lista quedaría incompleta.');
  }
  var envios = [];
  hilos.forEach(function (h) {
    h.getMessages().forEach(function (msg) {
      var fecha = msg.getDate();
      if (fecha.getTime() < desde.getTime()) return;
      var info = aud_parsearCorreoViejo(msg.getSubject(), msg.getBody());
      if (!info) return;
      envios.push({ fecha: fecha, tipo: info.tipo, numero: info.numero, agente: info.agente, agenteEmail: info.agenteEmail, periodo: info.periodo, strikes: info.strikes,
        para: String(msg.getTo() || ''), cc: String(msg.getCc() || ''), asunto: msg.getSubject() });
    });
  });
  envios.sort(function (x, y) { return x.fecha - y.fecha; });
  Logger.log('CORREOS DEL MODELO ANTIGUO DE STRIKES enviados desde ' + desdeISO + ' (solo lectura; NO aplican desde el 1-nov-2026): ' + envios.length);
  envios.forEach(function (e) {
    Logger.log(aud_hora(e.fecha) + ' | ' + e.tipo + (e.numero ? ' #' + e.numero : '') + ' | agente: ' + e.agente + (e.agenteEmail ? ' <' + e.agenteEmail + '>' : '') +
      ' | período: ' + (e.periodo || '—') + (e.strikes != null ? ' (' + e.strikes + ' strikes)' : '') + ' | para: ' + e.para + (e.cc ? ' | cc: ' + e.cc : ''));
  });
  // Resumen por destinatario: a quién hay que avisarle que no aplican
  var porDest = {};
  envios.forEach(function (e) {
    (e.para + ',' + e.cc).split(',').map(function (x) { var mm = String(x).match(/[^\s<>"',;]+@[^\s<>"',;]+/); return mm ? mm[0].toLowerCase() : ''; }).filter(Boolean).forEach(function (d) {
      (porDest[d] = porDest[d] || {})[e.agente || e.agenteEmail || '?'] = true;
    });
  });
  Logger.log('A QUIÉN AVISAR (destinatario → agentes de los correos que recibió):');
  Object.keys(porDest).sort().forEach(function (d) { Logger.log('  ' + d + ' → ' + Object.keys(porDest[d]).join(', ')); });
  if (!envios.length) Logger.log('Ningún correo del modelo antiguo enviado desde esa fecha en la carpeta Enviados de esta cuenta.');
  return envios;
}

// ── No desconexión: ¿cuántas están mal calculadas? ──
var AUD_NODESC = { DESDE: '2026-06-01', HORAS: 4, MAX_TURNOS: 30000 };
// malla: [{fecha:'D/M/YYYY', usuario, inicio, fin, novedad}] · turnos: [{id, userEmail, status, startTime:Date, endTime:Date|null, editadoPor}]
// Devuelve los días con cierre más de `cfg.HORAS` después de la salida programada, clasificados. Pura (sin IO).
function aud_nodescCalcular(malla, turnos, cfg) {
  cfg = cfg || AUD_NODESC;
  var porDia = {};
  turnos.forEach(function (t) {
    if (!t.userEmail || !t.startTime) return;
    var k = t.userEmail + '|' + reg_isoBogota(t.startTime);
    (porDia[k] = porDia[k] || []).push(t);
  });
  var out = [];
  malla.forEach(function (m) {
    var iso = reg_isoDesdeDDMMYYYY(m.fecha);
    if (!iso || !m.usuario || m.novedad) return;
    var hf = reg_horaProgramada(m.fin), hi = reg_horaProgramada(m.inicio);
    if (!hf) return;
    var dia = (porDia[m.usuario + '|' + iso] || []).slice().sort(function (a, b) { return a.startTime - b.startTime; });
    var turno = null, i;
    for (i = 0; i < dia.length; i++) if (dia[i].status === 'ended') { turno = dia[i]; break; }
    if (!turno) for (i = 0; i < dia.length; i++) if (dia[i].status === 'interrupted') { turno = dia[i]; break; }
    if (!turno) turno = dia[0] || null;
    if (!turno || !turno.endTime) return; // sin cierre no hay falta (regla v18.6)
    var fin = reg_progADate(iso, hf);
    if (hi && fin < reg_progADate(iso, hi)) fin = new Date(fin.getTime() + 24 * 3600000); // turno que cruza la medianoche
    var extra = (turno.endTime.getTime() - fin.getTime()) / 3600000;
    if (extra <= cfg.HORAS) return;
    var categoria = reg_isoBogota(turno.endTime) > reg_isoBogota(fin) ? 'CIERRE_DIA_POSTERIOR' : 'MISMO_DIA';
    out.push({ categoria: categoria, usuario: m.usuario, fecha: m.fecha, iso: iso, finProgramado: m.fin, inicioProgramado: m.inicio, turnoId: turno.id || '', status: turno.status,
      startTime: turno.startTime, endTime: turno.endTime, horasExtra: Math.round(extra * 10) / 10, editadoPor: turno.editadoPor || '' });
  });
  return out.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : (a.usuario < b.usuario ? -1 : 1); });
}
function auditoriaNoDesconexion() { return auditoriaNoDesconexionDesde_(AUD_NODESC.DESDE); }
function auditoriaNoDesconexionDesde_(desdeISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desdeISO))) throw new Error('Fecha inválida; usa yyyy-MM-dd');
  var turnos = aud_leerTurnos(desdeISO, AUD_NODESC.MAX_TURNOS);
  var malla = reg_leerMalla(desdeISO);
  var hallazgos = aud_nodescCalcular(malla, turnos);
  var cuenta = { MISMO_DIA: 0, CIERRE_DIA_POSTERIOR: 0 };
  hallazgos.forEach(function (h) { cuenta[h.categoria]++; });
  Logger.log('NO DESCONEXIÓN (solo lectura) desde ' + desdeISO + ': ' + hallazgos.length + ' días con cierre más de ' + AUD_NODESC.HORAS + ' h después de la salida programada');
  Logger.log('  MISMO_DIA (siguen siendo no desconexión): ' + cuenta.MISMO_DIA + ' · CIERRE_DIA_POSTERIOR (el turno se cerró otro día; NO son no desconexión con la regla corregida): ' + cuenta.CIERRE_DIA_POSTERIOR);
  hallazgos.forEach(function (h) {
    Logger.log(h.categoria + ' | ' + h.usuario + ' | día ' + h.fecha + ' | salida programada ' + h.finProgramado + ' | turno ' + aud_hora(h.startTime) + ' → CERRADO ' + aud_hora(h.endTime) + ' (' + h.horasExtra + ' h después de lo programado) | estado ' + h.status + (h.editadoPor ? ' | editado por ' + h.editadoPor : '') + ' | turno ' + h.turnoId);
  });
  return { desde: desdeISO, cuenta: cuenta, hallazgos: hallazgos };
}


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  TURNOS DE MÁS DE 14 HORAS (solo lectura; v19.3)
//  Auditoría de nómina: un turno que duró más de 14 h casi siempre es un turno olvidado que alguien cerró después. Si no lo corrigió un
//  admin, ese tiempo pudo llegar a la nómina de más (la prenómina usa la hora real de salida cuando hay extras aprobadas o una salida
//  anticipada injustificada). No envía ni escribe nada.
//
//  auditoriaTurnosLargos()   turnos desde el 1-jun-2026 con duración (endTime − startTime) MAYOR a 14 h que NO fueron editados por un
//                            admin (sin editedBy ni forcedClosedBy; los cierres automáticos de PiGOps_CierreTurnos.gs tampoco se editan
//                            como admin: se listan marcados si superan 14 h). Por turno: agente, fecha, horas registradas, horas
//                            programadas según la malla (salida − entrada; si la malla no tiene ese día, «sin malla»), la diferencia,
//                            el estado, si había extras aprobadas (overtimeStatus) y el id. Los turnos aún abiertos (sin endTime) no
//                            tienen duración: los lista cierreTurnosPendientes().
//  Usa funciones de PiGOps_Reglamento.gs (mismo proyecto). Ejecutar desde el editor → Ver → Registros de ejecución.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
var AUD_LARGOS = { DESDE: '2026-06-01', HORAS: 14, MAX_TURNOS: 30000 };
// malla: [{fecha:'D/M/YYYY', usuario, inicio, fin, novedad}] · turnos: [{id, userEmail, status, startTime:Date, endTime:Date|null, editadoPor, cierreAutomatico, overtimeStatus}]
// Pura (sin IO). Devuelve [{usuario, fecha, iso, horasRegistradas, horasProgramadas|null, exceso|null, ...}] ordenado por fecha y agente.
function aud_turnosLargosCalcular(turnos, malla, cfg) {
  cfg = cfg || AUD_LARGOS;
  var porDia = {};
  malla.forEach(function (m) {
    var iso = reg_isoDesdeDDMMYYYY(m.fecha);
    if (!iso || !m.usuario) return;
    (porDia[m.usuario + '|' + iso] = porDia[m.usuario + '|' + iso] || []).push(m);
  });
  var out = [];
  turnos.forEach(function (t) {
    if (!t.endTime || !t.startTime || t.editadoPor) return;
    var horas = (t.endTime.getTime() - t.startTime.getTime()) / 3600000;
    if (!(horas > cfg.HORAS)) return;
    var iso = reg_isoBogota(t.startTime), prog = null, filas = porDia[t.userEmail + '|' + iso] || [], i;
    for (i = 0; i < filas.length; i++) {
      var hi = reg_horaProgramada(filas[i].inicio), hf = reg_horaProgramada(filas[i].fin);
      if (!hi || !hf) continue;
      var h = (hf.h * 60 + hf.mi - hi.h * 60 - hi.mi) / 60;
      if (h <= 0) h += 24; // turno que cruza la medianoche
      if (prog === null || h > prog) prog = h;
    }
    out.push({ usuario: t.userEmail, fecha: reg_aDDMMYYYY(iso), iso: iso, turnoId: t.id || '', status: t.status, startTime: t.startTime, endTime: t.endTime,
      horasRegistradas: Math.round(horas * 10) / 10, horasProgramadas: prog === null ? null : Math.round(prog * 10) / 10,
      exceso: prog === null ? null : Math.round((horas - prog) * 10) / 10, cierreAutomatico: !!t.cierreAutomatico, overtimeStatus: t.overtimeStatus || '' });
  });
  return out.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : (a.usuario < b.usuario ? -1 : 1); });
}
function auditoriaTurnosLargos() { return auditoriaTurnosLargosDesde_(AUD_LARGOS.DESDE); }
function auditoriaTurnosLargosDesde_(desdeISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desdeISO))) throw new Error('Fecha inválida; usa yyyy-MM-dd');
  var turnos = aud_leerTurnos(desdeISO, AUD_LARGOS.MAX_TURNOS);
  var malla = reg_leerMalla(desdeISO);
  var hallazgos = aud_turnosLargosCalcular(turnos, malla);
  var sinMalla = hallazgos.filter(function (h) { return h.horasProgramadas === null; }).length;
  var extras = hallazgos.filter(function (h) { return h.overtimeStatus === 'approved'; }).length;
  var total = hallazgos.reduce(function (a, h) { return a + (h.exceso !== null ? Math.max(0, h.exceso) : 0); }, 0);
  Logger.log('TURNOS DE MÁS DE ' + AUD_LARGOS.HORAS + ' h (solo lectura) desde ' + desdeISO + ': ' + hallazgos.length + ' sin edición de admin (' + turnos.length + ' turnos revisados)');
  Logger.log('  Sin fila de malla ese día: ' + sinMalla + ' · con extras aprobadas (la prenómina usó la hora real): ' + extras + ' · exceso total sobre lo programado: ' + (Math.round(total * 10) / 10) + ' h');
  hallazgos.forEach(function (h) {
    Logger.log(h.usuario + ' | ' + h.fecha + ' | registradas ' + h.horasRegistradas + ' h (' + aud_hora(h.startTime) + ' → ' + aud_hora(h.endTime) + ') | programadas ' +
      (h.horasProgramadas === null ? 'sin malla' : h.horasProgramadas + ' h') + (h.exceso !== null ? ' | diferencia +' + h.exceso + ' h' : '') + ' | estado ' + h.status +
      (h.overtimeStatus ? ' | extras: ' + h.overtimeStatus : '') + (h.cierreAutomatico ? ' | CIERRE AUTOMÁTICO' : '') + ' | turno ' + h.turnoId);
  });
  if (!hallazgos.length) Logger.log('Ningún turno de más de ' + AUD_LARGOS.HORAS + ' h sin edición de un admin.');
  return { desde: desdeISO, hallazgos: hallazgos };
}
