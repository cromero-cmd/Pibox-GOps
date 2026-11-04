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
function aud_leerTurnos(desdeISO) {
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
        editadoPor: (f.editedBy && f.editedBy.stringValue) || (f.forcedClosedBy && f.forcedClosedBy.stringValue) || '',
        recuperado: !!(f.startRecovered && f.startRecovered.booleanValue)
      });
    }
    if (turnos.length > AUD_CONFIG.MAX_TURNOS) throw new Error('Se superó el tope de ' + AUD_CONFIG.MAX_TURNOS + ' turnos; la auditoría quedaría incompleta.');
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
