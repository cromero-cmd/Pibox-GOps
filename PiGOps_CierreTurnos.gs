// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PiGOps_CierreTurnos.gs — Cierre automático de turnos olvidados (v19.3)
//
// CUARTO archivo del mismo proyecto de Apps Script que PiGOps_Notificaciones_v5.gs, PiGOps_Reglamento.gs y PiGOps_Auditoria.gs
// (copiar a mano, igual que ellos). Reutiliza: FIREBASE_PROJECT, FIREBASE_REST, MALLA_SHEET_NAME, MESES_ES, FOOTER_HTML,
// getMallaSheetId(), mallaFechaISO_(), base3Leer_(), leerRetirados_(), escHtml_() de Notificaciones y los reg_* de fechas, el
// decodificador de Firestore y los estilos de correo (reg_caja, reg_filaTabla) del Reglamento. Los cuatro deben vivir en el mismo proyecto.
//
// ── POR QUÉ ──
// (v19.4) CORTE POR FECHA: el cierre automático (escritura, correo y marca en prenómina) aplica SOLO a turnos iniciados desde el 1-nov-2026
// (CIE.DESDE). Los anteriores —89 al revisarlos en producción, la mayoría turnos HUÉRFANOS: el agente inició otro turno y el anterior quedó
// «active»/«interrupted»— nunca pasan por el flujo normal: se clasifican en solo lectura (auditoriaHistoricosAbiertos, en PiGOps_Auditoria.gs)
// y se ARCHIVAN en silencio a mano (archivarTurnosHistoricosAprobado). Ver «ARCHIVO» más abajo.
//
// Una auditoría mostró 19 turnos desde junio que se cerraron uno o varios días después de su hora (hasta 141 h tarde): inflan las horas de
// nómina y generaban strikes de «no desconexión» falsos. El agente se olvida de cerrar el turno y alguien lo cierra días después.
//
// ── REGLA ──
// • Un turno ABIERTO (status «active» o «interrupted») INICIADO DESDE EL 1-NOV-2026 se cierra solo cuando han pasado MÁS de 4 h desde su SALIDA PROGRAMADA según la
//   malla (fecha del turno = día de su startTime en Bogotá; turno nocturno: si la salida es anterior a la entrada se suma un día).
// • Si ese día el agente no tiene malla utilizable (sin fila, sin hora de salida, o salida programada anterior a su inicio real), se cierra a
//   las 14 h del inicio del turno.
// • La hora de cierre que se REGISTRA (endTime) es la salida programada —o inicio + 14 h sin malla—, NO la hora en que corrió el cierre
//   automático. EXCEPCIÓN (v19.4): en un turno INTERRUMPIDO cuya hora de interrupción (su endTime) es anterior a esa salida, se registra la hora
//   de interrupción (el agente dejó de trabajar entonces; la programada le pagaría de más). El turno queda con cierreAutomatico:true, cierreAutomaticoAt (la hora real en que se cerró), cierreAutomaticoMotivo y los
//   valores anteriores (cierreAutomaticoEstadoPrevio / EndTimePrevio / AccPrevio) por si hay que revisarlo. NO se escribe editedBy ni
//   forcedClosedBy: no es una edición de un admin.
// • Agentes retirados (CARGO = INACTIVO en BASE 3.0, o propiedad agentes_retirados): su turno abierto NO se cierra ni genera correo: cuando
//   vence (misma regla de tiempo) se ARCHIVA en silencio (v19.4, mismo mecanismo que el archivo de históricos).
// • Al cerrar se avisa al agente por correo con copia a su líder directo (mismo estilo que los correos del Reglamento).
// • Un turno cerrado automáticamente no genera ninguna falta ni strike por el cierre (ni no desconexión ni falta de registro de salida):
//   index.html (computeAgentStrikes) lo ignora para «no desconexión». La tardanza de su INICIO, si la hubo, sigue siendo del Reglamento.
// • Nómina: la prenómina destaca estas filas para que se confirme o corrija la hora de salida (index.html). Las horas extra se registran
//   como siempre, con aprobación (el agente se lo reporta a su líder).
//
// ── ARCHIVO SILENCIOSO (v19.4) ──
// Un turno ARCHIVADO queda con status:'archivado' (el campo que ya existe, no uno paralelo: todo lector que filtra por active/ended/interrupted lo
// ignora de entrada, y los lectores con «el primero del día» lo excluyen de forma explícita), archivoMotivo, archivoEstadoPrevio, archivadoAt,
// archivoLote y archivadoPor. NO se toca endTime ni accumulatedSeconds, NO se envía ningún correo, no aparece en la prenómina, no genera strikes,
// faltas del Reglamento ni alertas de ausencia, y no lo ve el Panel. Es REVERSIBLE: revertirArchivoTurnos() restaura el status previo y borra los
// campos de archivo. archivarTurnosHistoricosVistaPrevia() (solo lectura) muestra qué se archivaría; archivarTurnosHistoricosAprobado() lo hace.
//
// ── FALLA SEGURA ──
// Si no se puede leer Firestore, la malla o BASE 3.0 (HTTP != 200, JSON inválido, arreglo con {error}, excepción, resultado que alcanza el
// límite) NO se cierra nada y se envía UN correo técnico al Super Admin (máximo uno por hora, propiedad cierre_fail_notified_at). Una
// lectura fallida nunca significa «no hay turnos abiertos» ni «el agente no tiene malla» (con malla ilegible NO se aplica la regla de 14 h).
// Cada cierre se escribe con precondición de updateTime: si el agente o un admin tocó el turno entre la lectura y la escritura, NO se cierra.
//
// ── DISPARADOR ──
// cierreAutomaticoTurnos() cada hora. Se instala UNA vez con instalarDisparadorCierreTurnos(). Sin endpoints públicos nuevos (sin doGet/doPost).
// Lee solo los turnos abiertos (filtro status IN [active, interrupted]: pocas lecturas, sin importar cuántos turnos haya en total).
//
// ── SOLO LECTURA ──
// cierreTurnosPendientes() lista los turnos que HOY se cerrarían (con su hora de cierre y el motivo) sin cerrar ni enviar nada: ejecútala
// antes de la primera vez. Usa exactamente el mismo plan que el cierre real.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
var CIE = {
  DESDE: '2026-11-01',           // corte: solo turnos iniciados desde esta fecha (Bogotá) entran al cierre automático
  ESTADO_ARCHIVADO: 'archivado',
  MOTIVO_ARCHIVO_HISTORICO: 'Histórico anterior al 1-nov-2026: turno abierto que nunca se cerró (archivo silencioso)',
  MOTIVO_ARCHIVO_RETIRADO: 'Agente retirado (CARGO = INACTIVO): turno abierto vencido (archivo silencioso)',
  HORAS_TRAS_SALIDA: 4,          // se cierra con MÁS de 4 h pasada la salida programada
  HORAS_SIN_MALLA: 14,           // sin malla utilizable: a las 14 h del inicio
  MAX_CIERRES_POR_EJECUCION: 40, // tope por ejecución (cada cierre = 1 escritura + 1 correo); el resto sigue en la siguiente hora
  LIMITE_CONSULTA: 1000,
  ESTADOS_ABIERTOS: ['active', 'interrupted'],
  MOTIVO_MALLA: 'Salida programada + 4 h (malla)',
  MOTIVO_SIN_MALLA: 'Sin malla ese día: 14 h desde el inicio',
  MOTIVO_INICIO_TARDE: 'Inicio posterior a la salida programada: 14 h desde el inicio',
  MOTIVO_INTERRUPCION: 'Hora de interrupción (anterior a la salida programada)',
  MOTIVO_INTERRUPCION_SIN_MALLA: 'Hora de interrupción (anterior a las 14 h desde el inicio, sin malla ese día)',
  AVISO_TECNICO_A: 'cromero@pibox.app'
};

// ── Hora de cierre ──
// malla: [{iso, usuario (minúsculas), inicio, fin, lider, nombre}] · filas del mismo usuario y día → la de salida más tardía (la más prudente).
// Devuelve {salida:Date, limite:Date, motivo, codigo, filaMalla}.
//   codigo 'malla' | 'sin_malla' | 'inicio_tarde' | 'malla_no_leida'
function cie_horario(turno, malla) {
  var iso = reg_isoBogota(turno.startTime), email = String(turno.userEmail || '').toLowerCase();
  var mejor = null, mejorFin = null, i, fin, hi, hf;
  for (i = 0; i < malla.length; i++) {
    var m = malla[i];
    if (m.iso !== iso || m.usuario !== email) continue;
    hf = reg_horaProgramada(m.fin);
    if (!hf) continue;
    fin = reg_progADate(iso, hf);
    hi = reg_horaProgramada(m.inicio);
    if (hi) { if (fin.getTime() < reg_progADate(iso, hi).getTime()) fin = new Date(fin.getTime() + 24 * 3600000); } // turno que cruza la medianoche
    else if (fin.getTime() <= turno.startTime.getTime()) fin = new Date(fin.getTime() + 24 * 3600000);
    if (!mejorFin || fin.getTime() > mejorFin.getTime()) { mejorFin = fin; mejor = m; }
  }
  var sinMalla = new Date(turno.startTime.getTime() + CIE.HORAS_SIN_MALLA * 3600000);
  if (!mejorFin) return { salida: sinMalla, limite: sinMalla, motivo: CIE.MOTIVO_SIN_MALLA, codigo: 'sin_malla', filaMalla: null };
  if (mejorFin.getTime() <= turno.startTime.getTime()) return { salida: sinMalla, limite: sinMalla, motivo: CIE.MOTIVO_INICIO_TARDE, codigo: 'inicio_tarde', filaMalla: mejor };
  return { salida: mejorFin, limite: new Date(mejorFin.getTime() + CIE.HORAS_TRAS_SALIDA * 3600000), motivo: CIE.MOTIVO_MALLA, codigo: 'malla', filaMalla: mejor };
}

// Plan PURO (sin IO): qué hacer con cada turno abierto. turnos: [{id, userEmail, status, startTime:Date, endTime:Date|null, accumulatedSeconds, updateTime}].
// retirados: {correoEnMinúsculas:true}. Devuelve:
//   cerrar     turnos iniciados desde CIE.DESDE y vencidos: se cierran (escritura + correo)
//   archivar   turnos de RETIRADOS iniciados desde CIE.DESDE y vencidos: archivo silencioso (sin correo)
//   historicos turnos iniciados ANTES de CIE.DESDE: el cierre automático NO los toca (los trata auditoriaHistoricosAbiertos / el archivo manual)
//   enCurso    aún no vencidos
// Cada elemento trae el turno y su horario. Si el turno está INTERRUMPIDO y su hora de interrupción es anterior a la salida, la salida registrada
// (item.salida) es la de interrupción (item.interrupcion = true); el momento en que vence (item.limite) no cambia.
function cie_planificar(turnos, malla, retirados, ahora) {
  var res = { cerrar: [], archivar: [], historicos: [], enCurso: [] };
  retirados = retirados || {};
  turnos.forEach(function (t) {
    if (CIE.ESTADOS_ABIERTOS.indexOf(t.status) === -1 || !t.startTime || !t.userEmail) return;
    if (reg_isoBogota(t.startTime) < CIE.DESDE) { res.historicos.push({ turno: t }); return; }
    var h = cie_horario(t, malla);
    var item = { turno: t, salida: h.salida, limite: h.limite, motivo: h.motivo, codigo: h.codigo, filaMalla: h.filaMalla, interrupcion: false };
    if (t.status === 'interrupted' && t.endTime && t.endTime.getTime() > t.startTime.getTime() && t.endTime.getTime() < h.salida.getTime()) {
      item.salida = t.endTime; item.interrupcion = true;
      item.motivo = h.codigo === 'malla' ? CIE.MOTIVO_INTERRUPCION : CIE.MOTIVO_INTERRUPCION_SIN_MALLA;
    }
    // con malla: MÁS de 4 h después de la salida; sin malla: a las 14 h del inicio (ya con 14 h cumplidas)
    var vencido = h.codigo === 'malla' ? ahora.getTime() > h.limite.getTime() : ahora.getTime() >= h.limite.getTime();
    if (!vencido) { res.enCurso.push(item); return; }
    if (retirados[String(t.userEmail).toLowerCase()]) res.archivar.push(item); else res.cerrar.push(item);
  });
  var porInicio = function (a, b) { return a.turno.startTime - b.turno.startTime; };
  res.cerrar.sort(porInicio); res.archivar.sort(porInicio); res.historicos.sort(porInicio);
  return res;
}

// Campos que se escriben al cerrar (valores JS; el codificador los convierte a tipos de Firestore). Pura.
function cie_camposCierre(item, ahora) {
  var t = item.turno;
  // salida = interrupción: el acumulado que ya guardó la app (tiempo realmente trabajado) se conserva; si no hay, se calcula
  var acumulado = item.interrupcion && typeof t.accumulatedSeconds === 'number' && t.accumulatedSeconds > 0 ? t.accumulatedSeconds
    : Math.max(0, Math.round((item.salida.getTime() - t.startTime.getTime()) / 1000));
  return {
    status: 'ended',
    endTime: item.salida,
    accumulatedSeconds: acumulado,
    cierreAutomatico: true,
    cierreAutomaticoAt: ahora,
    cierreAutomaticoMotivo: item.motivo,
    cierreAutomaticoEstadoPrevio: t.status,
    cierreAutomaticoEndTimePrevio: t.endTime || null,
    cierreAutomaticoAccPrevio: typeof t.accumulatedSeconds === 'number' ? t.accumulatedSeconds : 0
  };
}

// Campos del ARCHIVO silencioso: NO incluye endTime ni accumulatedSeconds (no se alteran horas) y no hay ningún correo.
function cie_camposArchivo(turno, motivo, ahora, lote) {
  return { status: CIE.ESTADO_ARCHIVADO, archivoMotivo: motivo, archivoEstadoPrevio: turno.status, archivadoAt: ahora, archivoLote: lote, archivadoPor: 'PiGOps_CierreTurnos.gs' };
}
var CIE_CAMPOS_ARCHIVO = ['archivoMotivo', 'archivoEstadoPrevio', 'archivadoAt', 'archivoLote', 'archivadoPor'];
function cie_loteId(ahora, prefijo) { return prefijo + '-' + reg_isoBogota(ahora).replace(/-/g, '') + '-' + reg_horaAmPm(ahora).replace(/[^0-9apm]/g, ''); }

// ── Correo al agente (con copia al líder), mismo estilo que los del Reglamento ──
function cie_correo(item, agente, liderEmail, ahora) {
  var t = item.turno, iso = reg_isoBogota(t.startTime), fecha = reg_fechaLarga(iso);
  var horaSalida = reg_horaAmPm(item.salida), horaInicio = reg_horaAmPm(t.startTime);
  var porMalla = item.codigo === 'malla';
  var frase = 'Tu turno del <strong>' + fecha + '</strong> se cerró automáticamente a las <strong>' + horaSalida + '</strong>' + (item.interrupcion ? ' (la hora en que se interrumpió tu turno)' : '') +
    (porMalla || item.interrupcion ? '' : ' (' + CIE.HORAS_SIN_MALLA + ' horas después de su inicio, porque ese día no tenías un horario programado que aplicara)') +
    '; si trabajaste más tiempo, repórtalo a tu líder.';
  var tabla = '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">' +
    [['Fecha del turno', fecha], ['Inicio registrado', horaInicio], [item.interrupcion ? 'Hora de tu última interrupción (la registrada)' : porMalla ? 'Hora de salida programada (la registrada)' : 'Hora de cierre registrada', horaSalida]].map(function (f) {
      return '<tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9fafb;font-weight:bold;width:42%;">' + f[0] + '</td><td style="padding:8px 12px;border:1px solid #ddd;">' + f[1] + '</td></tr>';
    }).join('') + '</table>';
  var html = reg_caja('Tu turno se cerró automáticamente', '#fb923c',
    '<p>Hola ' + escHtml_(agente.nombre || '') + ',</p><p>' + frase + '</p>' + tabla +
    '<p style="color:#6b7280;font-size:13px;">El turno seguía abierto más de ' + (porMalla ? CIE.HORAS_TRAS_SALIDA + ' horas después de tu salida programada' : CIE.HORAS_SIN_MALLA + ' horas desde su inicio') +
    '. El cierre automático no genera ninguna falta ni strike. Si trabajaste más tiempo, tu líder debe registrarlo como horas extra con aprobación para que quede en la nómina.</p>');
  return { to: [t.userEmail], cc: liderEmail ? [liderEmail] : [], subject: 'Tu turno del ' + fecha + ' se cerró automáticamente a las ' + horaSalida, html: html };
}

// Líder directo del agente ese día: de la fila de malla de su turno (nombre o correo); sin fila ese día, de su fila más reciente. Pura.
// base: {porNombre:{nombre:correo}}. Devuelve {email, motivoSinCopia}.
function cie_lider(turno, malla, base) {
  var email = String(turno.userEmail || '').toLowerCase(), iso = reg_isoBogota(turno.startTime), elegido = null, reciente = null, i;
  for (i = 0; i < malla.length; i++) {
    var m = malla[i];
    if (m.usuario !== email || !m.lider) continue;
    if (m.iso === iso) elegido = m;
    if (!reciente || m.iso > reciente.iso) reciente = m;
  }
  var fila = elegido || reciente;
  if (!fila) return { email: '', motivoSinCopia: 'el agente no tiene líder registrado en la malla' };
  var l = String(fila.lider).trim();
  var correo = l.indexOf('@') !== -1 ? l : ((base && base.porNombre && base.porNombre[l]) || '');
  if (!correo) return { email: '', motivoSinCopia: 'no se encontró el correo del líder «' + l + '» en BASE 3.0' };
  if (!reg_emailValido(correo)) return { email: '', motivoSinCopia: 'el correo del líder no es válido («' + correo + '»)' };
  if (correo.toLowerCase() === email) return { email: '', motivoSinCopia: 'el líder registrado es el mismo agente' };
  return { email: correo, motivoSinCopia: '' };
}

// ── Orquestación (con dependencias inyectables: las pruebas las simulan) ──
// deps: now(), leerTurnosAbiertos() → [turno], leerMalla(desdeISO) → [{iso, usuario, ...}], retirados() → {correo:true}, base() → {porNombre},
//       cerrar(item, campos) y archivar(item, campos) → 'ok'|'cambio' (lanzan ante un error), enviarCorreo({to,cc,subject,html}), avisoTecnico(motivo, now).
// opts.soloListar: no cierra, no archiva ni envía (cierreTurnosPendientes).
function cie_correr(deps, opts) {
  opts = opts || {};
  var ahora = deps.now(), res = { ok: true, abiertos: 0, cerrados: [], archivados: [], omitidos: [], errores: [], correos: 0, plan: null, motivoFalla: '' };
  var plan;
  try {
    var abiertos = deps.leerTurnosAbiertos();
    res.abiertos = abiertos.length;
    var malla = [], retirados = {}, base = { porNombre: {} };
    // solo los turnos desde el corte necesitan malla, retirados y líderes: sin ninguno, una sola lectura a Firestore
    var desdeCorte = abiertos.filter(function (t) { return t.startTime && reg_isoBogota(t.startTime) >= CIE.DESDE; });
    if (desdeCorte.length) {
      var minIso = desdeCorte.reduce(function (a, t) { var i = reg_isoBogota(t.startTime); return !a || i < a ? i : a; }, '');
      malla = deps.leerMalla(reg_addDays(minIso, -30)); // lanza si no se puede leer: sin malla NO se aplica la regla de 14 h
      retirados = deps.retirados();
      base = deps.base();
    }
    plan = cie_planificar(abiertos, malla, retirados, ahora);
    plan.malla = malla; plan.baseAgentes = base;
  } catch (e) {
    res.ok = false; res.motivoFalla = e.message;
    Logger.log('Cierre automático ABORTADO: no se pudo leer — ' + e.message + '. No se cerró ni se archivó ningún turno.');
    if (!opts.soloListar) deps.avisoTecnico('No se pudo ejecutar el cierre automático de turnos: ' + e.message, ahora);
    return res;
  }
  res.plan = plan;
  if (plan.historicos.length) Logger.log('Turnos abiertos anteriores al ' + CIE.DESDE + ' (el cierre automático NO los toca): ' + plan.historicos.length + '. Clasifícalos con auditoriaHistoricosAbiertos() y archívalos con archivarTurnosHistoricosAprobado().');
  if (opts.soloListar) return res;

  var cola = plan.cerrar.slice(0, CIE.MAX_CIERRES_POR_EJECUCION);
  if (plan.cerrar.length > cola.length) Logger.log('Cierre automático: ' + plan.cerrar.length + ' turnos por cerrar; se procesan ' + cola.length + ' en esta ejecución y el resto en la siguiente.');
  cola.forEach(function (item) {
    var t = item.turno;
    try {
      var r = deps.cerrar(item, cie_camposCierre(item, ahora));
      if (r !== 'ok') { res.omitidos.push({ id: t.id, motivo: 'el turno cambió después de leerlo (precondición)' }); Logger.log('Turno ' + t.id + ' (' + t.userEmail + ') NO se cerró: cambió mientras tanto.'); return; }
      res.cerrados.push({ id: t.id, email: t.userEmail, salida: item.salida, motivo: item.motivo });
      Logger.log('Turno ' + t.id + ' (' + t.userEmail + ') cerrado automáticamente: salida registrada ' + reg_aDDMMYYYY(reg_isoBogota(item.salida)) + ' ' + reg_horaAmPm(item.salida) + ' — ' + item.motivo);
    } catch (e) {
      res.errores.push('cerrar ' + t.id + ': ' + e.message);
      Logger.log('ERROR cerrando el turno ' + t.id + ' (' + t.userEmail + '): ' + e.message);
      return;
    }
    try {
      var agente = { nombre: cie_nombre(t.userEmail, plan.malla) };
      var lider = cie_lider(t, plan.malla, plan.baseAgentes);
      if (lider.motivoSinCopia) Logger.log('Aviso de cierre de ' + t.userEmail + ': se envía SOLO al agente, sin copia al líder — ' + lider.motivoSinCopia + '.');
      deps.enviarCorreo(cie_correo(item, agente, lider.email, ahora));
      res.correos++;
    } catch (e) {
      res.errores.push('correo ' + t.id + ': ' + e.message);
      Logger.log('ERROR enviando el aviso de cierre de ' + t.userEmail + ' (el turno SÍ quedó cerrado): ' + e.message);
    }
  });

  // Retirados vencidos: archivo SILENCIOSO (no se cierra, no hay correo, no se toca endTime)
  var lote = cie_loteId(ahora, 'retirado');
  plan.archivar.slice(0, CIE.MAX_CIERRES_POR_EJECUCION).forEach(function (item) {
    var t = item.turno;
    try {
      var r = deps.archivar(item, cie_camposArchivo(t, CIE.MOTIVO_ARCHIVO_RETIRADO, ahora, lote));
      if (r !== 'ok') { res.omitidos.push({ id: t.id, motivo: 'el turno cambió después de leerlo (precondición)' }); return; }
      res.archivados.push({ id: t.id, email: t.userEmail });
      Logger.log('Turno ' + t.id + ' (' + t.userEmail + ') ARCHIVADO en silencio: agente retirado.');
    } catch (e) {
      res.errores.push('archivar ' + t.id + ': ' + e.message);
      Logger.log('ERROR archivando el turno ' + t.id + ' (' + t.userEmail + '): ' + e.message);
    }
  });
  if (res.errores.length) deps.avisoTecnico('El cierre automático de turnos tuvo errores: ' + res.errores.slice(0, 3).join(' | '), ahora);
  return res;
}
function cie_nombre(email, malla) {
  var e = String(email || '').toLowerCase();
  for (var i = malla.length - 1; i >= 0; i--) if (malla[i].usuario === e && malla[i].nombre) return malla[i].nombre;
  return String(email || '').split('@')[0];
}

// ═══════════════ PRODUCCIÓN: Firestore REST, Sheets, Gmail ═══════════════
function cie_valorFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
// Turnos en los estados dados (por defecto los ABIERTOS: status IN [active, interrupted], sin rango de fechas); lanza ante CUALQUIER falla (misma
// validación estricta que leerTurnosHoyRest_). Un filtro de igualdad/IN sobre UN campo no requiere índice compuesto.
function cie_leerTurnosPorEstado(estados) {
  var body = { structuredQuery: { from: [{ collectionId: 'turnos' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN', value: { arrayValue: { values: estados.map(function (s) { return { stringValue: s }; }) } } } },
    limit: CIE.LIMITE_CONSULTA } };
  var resp = UrlFetchApp.fetch(FIREBASE_REST + ':runQuery', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = resp.getResponseCode(), texto = resp.getContentText() || '';
  if (code !== 200) { Logger.log('Firestore turnos (' + estados.join('/') + '): HTTP ' + code + ' — cuerpo: ' + texto.slice(0, 1000)); throw new Error('Firestore respondió HTTP ' + code + ' (' + resumenErrorFirestore_(texto) + ')'); }
  var arr;
  try { arr = JSON.parse(texto); } catch (e) { Logger.log('Firestore turnos: el cuerpo no es JSON — ' + texto.slice(0, 1000)); throw new Error('la respuesta de Firestore no es JSON válido'); }
  if (!Array.isArray(arr)) { Logger.log('Firestore turnos: no es un arreglo — ' + texto.slice(0, 1000)); throw new Error('la respuesta de Firestore no es un arreglo (' + resumenErrorFirestore_(texto) + ')'); }
  var out = [], docs = 0;
  arr.forEach(function (r) {
    if (r && r.error) { Logger.log('Firestore turnos: error dentro del arreglo — ' + JSON.stringify(r.error).slice(0, 1000)); throw new Error('Firestore devolvió un error (' + resumenErrorFirestore_(JSON.stringify(r)) + ')'); }
    if (!r || !r.document) return;
    docs++;
    var o = reg_fsDoc(r.document);
    if (!o.userEmail || !o.startTime) return;
    out.push({ id: o._id, userEmail: o.userEmail, status: o.status || '', startTime: new Date(o.startTime), endTime: o.endTime ? new Date(o.endTime) : null,
      accumulatedSeconds: o.accumulatedSeconds, updateTime: r.document.updateTime || '',
      archivoEstadoPrevio: o.archivoEstadoPrevio || '', archivoLote: o.archivoLote || '', archivoMotivo: o.archivoMotivo || '' });
  });
  if (docs >= CIE.LIMITE_CONSULTA) throw new Error('el resultado alcanzó el límite de ' + CIE.LIMITE_CONSULTA + ' turnos y puede estar incompleto');
  return out;
}
function cie_leerTurnosAbiertos() { return cie_leerTurnosPorEstado(CIE.ESTADOS_ABIERTOS); }
// Malla: B fecha (día/mes/año; mallaFechaISO_), C usuario, D nombre, F inicio, G fin, J líder. Lanza si la hoja no existe.
function cie_leerMalla(desdeISO) {
  var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) throw new Error('No se encontró la hoja Malla');
  var data = sheet.getDataRange().getDisplayValues(), rows = [];
  if (!data || data.length < 2) throw new Error('la hoja Malla está vacía');
  for (var i = 1; i < data.length; i++) {
    var r = data[i], iso = mallaFechaISO_(r[1]);
    if (!iso || iso < desdeISO) continue;
    rows.push({ iso: iso, usuario: String(r[2] || '').trim().toLowerCase(), nombre: String(r[3] || '').trim(), inicio: String(r[5] || '').trim(), fin: String(r[6] || '').trim(), lider: String(r[9] || '').trim(), novedad: String(r[10] || '').trim() });
  }
  if (!rows.length) throw new Error('la malla no tiene filas desde ' + desdeISO + ' (no se puede distinguir «sin malla» de una lectura incompleta)');
  return rows;
}
// PATCH de un turno con precondición de updateTime (si cambió desde que se leyó → 'cambio', no se escribe). `borrar`: campos que se eliminan
// (están en la máscara y no en el cuerpo). Devuelve 'ok' | 'cambio'; lanza ante cualquier otro error.
function cie_patchTurno(t, campos, borrar) {
  var claves = Object.keys(campos).concat(borrar || []);
  var mask = claves.map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var f = {}; Object.keys(campos).forEach(function (k) { f[k] = cie_valorFs(campos[k]); });
  var url = FIREBASE_REST + '/turnos/' + encodeURIComponent(t.id) + '?' + mask + '&currentDocument.updateTime=' + encodeURIComponent(t.updateTime) + '&currentDocument.exists=true';
  var resp = UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify({ fields: f }), muteHttpExceptions: true });
  var code = resp.getResponseCode(), texto = resp.getContentText() || '';
  if (code === 200) return 'ok';
  if (code === 412 || code === 409 || (code === 400 && /FAILED_PRECONDITION/i.test(texto))) return 'cambio';
  throw new Error('Firestore PATCH ' + t.id + ' → HTTP ' + code + ' ' + texto.slice(0, 200));
}
function cie_cerrarEnFirestore(item, campos) { return cie_patchTurno(item.turno, campos); }
function cie_archivarEnFirestore(item, campos) { return cie_patchTurno(item.turno, campos); }
function cie_depsProduccion() {
  return {
    now: function () { return new Date(); },
    leerTurnosAbiertos: cie_leerTurnosAbiertos,
    leerMalla: cie_leerMalla,
    retirados: function () { var r = leerRetirados_(); if (!r.ok) throw new Error('no se pudo leer BASE 3.0 para excluir retirados: ' + r.motivo); return r.set; },
    base: function () {
      var b = base3Leer_(); if (!b.ok) throw new Error('no se pudo leer BASE 3.0: ' + b.motivo);
      var porNombre = {};
      b.filas.forEach(function (f) { var n = String(f.v[b.col.nombre] || '').trim(), e = String(f.v[b.col.correo] || '').trim(); if (n && e) porNombre[n] = e; });
      return { porNombre: porNombre };
    },
    cerrar: cie_cerrarEnFirestore,
    archivar: cie_archivarEnFirestore,
    enviarCorreo: function (m) {
      var o = { htmlBody: m.html, name: 'Pi GOps' };
      if (m.cc && m.cc.length) o.cc = m.cc.join(',');
      GmailApp.sendEmail(m.to.join(','), m.subject, 'Este mensaje requiere un cliente de correo con HTML.', o);
    },
    avisoTecnico: cie_avisoTecnico
  };
}
// Aviso técnico al Super Admin: máximo UNO por hora (propiedad cierre_fail_notified_at). Si el correo falla, solo queda en el log.
function cie_avisoTecnico(motivo, now) {
  var props = PropertiesService.getScriptProperties();
  var ultimo = parseInt(props.getProperty('cierre_fail_notified_at') || '0', 10);
  if (ultimo && now.getTime() - ultimo < 3600000) { Logger.log('Aviso técnico del cierre omitido: ya se envió uno hace ' + Math.round((now.getTime() - ultimo) / 60000) + ' min (máximo uno por hora).'); return false; }
  try {
    var html = reg_caja('⚠️ Cierre automático de turnos: no se pudo ejecutar', '#dc2626',
      '<p><strong>' + escHtml_(motivo) + '</strong></p>' +
      '<p>En esta ejecución <strong>no se cerró ningún turno</strong> (una lectura fallida nunca se interpreta como «no hay turnos abiertos» ni como «sin malla»). Se reintentará en la próxima hora; este aviso técnico se envía como máximo una vez por hora.</p>' +
      '<p style="color:#6b7280;font-size:13px;">Detalle (código y cuerpo de la respuesta) en Apps Script → Ejecuciones → cierreAutomaticoTurnos.</p>');
    GmailApp.sendEmail(CIE.AVISO_TECNICO_A, 'Cierre automático de turnos: ' + String(motivo).slice(0, 120), 'Este mensaje requiere un cliente de correo con HTML.', { htmlBody: html, name: 'Pi GOps' });
    props.setProperty('cierre_fail_notified_at', String(now.getTime()));
    Logger.log('Aviso técnico enviado a ' + CIE.AVISO_TECNICO_A + ': ' + motivo);
    return true;
  } catch (e) { Logger.log('No se pudo enviar el aviso técnico del cierre: ' + e.message); return false; }
}

// ── Disparador (cada hora) ──
function cierreAutomaticoTurnos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Cierre automático: otra ejecución en curso — se omite'); return; }
  try {
    var res = cie_correr(cie_depsProduccion(), {});
    Logger.log('Cierre automático → abiertos: ' + res.abiertos + ' · cerrados: ' + res.cerrados.length + ' · correos: ' + res.correos + ' · archivados (retirados): ' + res.archivados.length + ' · omitidos: ' + res.omitidos.length + ' · errores: ' + res.errores.length + (res.ok ? '' : ' · ABORTADO: ' + res.motivoFalla));
  } finally { lock.releaseLock(); }
}
// Ejecutar UNA vez desde el editor: crea el disparador horario (y borra duplicados de este mismo).
function instalarDisparadorCierreTurnos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cierreAutomaticoTurnos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cierreAutomaticoTurnos').timeBased().everyHours(1).create();
  Logger.log('Disparador del cierre automático de turnos instalado (cada hora).');
}

// ── Pendientes actuales: SOLO LECTURA (no cierra, no archiva, no envía, no escribe) ──
// Lista los turnos iniciados desde el 1-nov-2026 que HOY se cerrarían (agente, inicio, salida programada, hora de cierre que se registraría, motivo y horas
// abierto), los de retirados que se archivarían y cuántos turnos abiertos anteriores al corte se ignoran.
function cierreTurnosPendientes() {
  var res = cie_correr(cie_depsProduccion(), { soloListar: true });
  var fh = function (d) { return reg_aDDMMYYYY(reg_isoBogota(d)) + ' ' + reg_horaAmPm(d); };
  Logger.log('=== TURNOS ABIERTOS PENDIENTES DE CIERRE desde ' + CIE.DESDE + ' (solo lectura; no se cerró, archivó ni envió nada) ===');
  if (!res.ok) { Logger.log('⚠️ No se pudo leer (' + res.motivoFalla + '): el cierre real tampoco se ejecutaría.'); return res; }
  var ahora = new Date();
  Logger.log('Turnos abiertos (active/interrupted): ' + res.abiertos + ' · anteriores al corte, ignorados: ' + res.plan.historicos.length + ' · se cerrarían ahora: ' + res.plan.cerrar.length + ' · retirados que se archivarían: ' + res.plan.archivar.length + ' · aún en curso: ' + res.plan.enCurso.length);
  res.plan.cerrar.forEach(function (it) {
    var t = it.turno, referencia = it.codigo === 'malla' ? it.salida : t.startTime;
    var horas = Math.round((ahora.getTime() - referencia.getTime()) / 360000) / 10;
    Logger.log('CERRAR | ' + t.userEmail + ' | turno ' + t.id + ' | estado ' + t.status + ' | inicio ' + fh(t.startTime) +
      (it.codigo === 'malla' ? ' | salida programada ' + fh(cie_horarioSalidaProgramada_(it)) : ' | SIN horario utilizable') + ' | se registraría la salida ' + fh(it.salida) +
      ' | ' + it.motivo + ' | vencido hace ' + Math.round((ahora.getTime() - it.limite.getTime()) / 360000) / 10 + ' h' +
      (t.endTime ? ' | hora de interrupción actual ' + fh(t.endTime) : ''));
  });
  res.plan.archivar.forEach(function (it) { Logger.log('ARCHIVAR (retirado, en silencio) | ' + it.turno.userEmail + ' | turno ' + it.turno.id + ' | inicio ' + fh(it.turno.startTime) + ' | sin cierre y sin correo'); });
  if (!res.plan.cerrar.length && !res.plan.archivar.length) Logger.log('Ningún turno abierto desde el corte supera el límite: no hay nada por cerrar ni archivar.');
  return res;
}
// Salida PROGRAMADA de un elemento del plan (item.salida puede ser la hora de interrupción): se recalcula desde el límite (salida + 4 h).
function cie_horarioSalidaProgramada_(item) { return new Date(item.limite.getTime() - CIE.HORAS_TRAS_SALIDA * 3600000); }

// ═══════════════ ARCHIVO SILENCIOSO DE HISTÓRICOS (manual) ═══════════════
// Históricos = turnos ABIERTOS (active/interrupted) iniciados ANTES del 1-nov-2026. Ver el bloque «ARCHIVO SILENCIOSO» del encabezado.
function cie_historicosAbiertos() {
  return cie_leerTurnosAbiertos().filter(function (t) { return reg_isoBogota(t.startTime) < CIE.DESDE; }).sort(function (a, b) { return a.startTime - b.startTime; });
}
// SOLO LECTURA: qué se archivaría. Úsala junto con auditoriaHistoricosAbiertos() (que los clasifica) antes de aprobar.
function archivarTurnosHistoricosVistaPrevia() {
  var h = cie_historicosAbiertos(), fh = function (d) { return reg_aDDMMYYYY(reg_isoBogota(d)) + ' ' + reg_horaAmPm(d); };
  Logger.log('=== VISTA PREVIA DEL ARCHIVO (solo lectura): ' + h.length + ' turnos abiertos iniciados antes del ' + CIE.DESDE + ' ===');
  h.forEach(function (t) { Logger.log('ARCHIVARÍA | ' + t.userEmail + ' | turno ' + t.id + ' | estado ' + t.status + ' | inicio ' + fh(t.startTime) + (t.endTime ? ' | hora de interrupción ' + fh(t.endTime) : '')); });
  Logger.log('No se escribió nada. Para archivarlos ejecuta archivarTurnosHistoricosAprobado(); para deshacerlo, revertirArchivoTurnos().');
  return h;
}
// MANUAL, ESCRIBE: archiva en silencio los históricos. Sin correos, sin endTime nuevo, sin tocar accumulatedSeconds. Reversible.
function archivarTurnosHistoricosAprobado() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Archivo: otra ejecución en curso — se omite'); return null; }
  try {
    var ahora = new Date(), lote = cie_loteId(ahora, 'historico'), h = cie_historicosAbiertos();
    var res = { lote: lote, archivados: [], omitidos: [], errores: [] };
    h.forEach(function (t) {
      try {
        var r = cie_patchTurno(t, cie_camposArchivo(t, CIE.MOTIVO_ARCHIVO_HISTORICO, ahora, lote));
        if (r === 'ok') res.archivados.push(t.id); else res.omitidos.push(t.id);
      } catch (e) { res.errores.push(t.id + ': ' + e.message); Logger.log('ERROR archivando ' + t.id + ': ' + e.message); }
    });
    Logger.log('ARCHIVO SILENCIOSO (lote ' + lote + '): archivados ' + res.archivados.length + ' de ' + h.length + ' · omitidos (cambiaron mientras tanto) ' + res.omitidos.length + ' · errores ' + res.errores.length + '. Para deshacer: revertirArchivoTurnos().');
    return res;
  } finally { lock.releaseLock(); }
}
// MANUAL, ESCRIBE: deshace el archivo. Restaura el status previo y borra los campos de archivo. Si la propiedad de script archivo_revertir_lote
// está definida, solo revierte ese lote; si no, todos los turnos archivados por este script.
function revertirArchivoTurnos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Reversión: otra ejecución en curso — se omite'); return null; }
  try {
    var lote = PropertiesService.getScriptProperties().getProperty('archivo_revertir_lote') || '';
    var archivados = cie_leerTurnosPorEstado([CIE.ESTADO_ARCHIVADO]).filter(function (t) { return !lote || t.archivoLote === lote; });
    var res = { revertidos: [], omitidos: [], errores: [] };
    archivados.forEach(function (t) {
      var previo = t.archivoEstadoPrevio;
      if (CIE.ESTADOS_ABIERTOS.indexOf(previo) === -1 && previo !== 'ended') { res.errores.push(t.id + ': sin estado previo conocido'); return; }
      try {
        var r = cie_patchTurno(t, { status: previo }, CIE_CAMPOS_ARCHIVO);
        if (r === 'ok') res.revertidos.push(t.id); else res.omitidos.push(t.id);
      } catch (e) { res.errores.push(t.id + ': ' + e.message); Logger.log('ERROR revirtiendo ' + t.id + ': ' + e.message); }
    });
    Logger.log('REVERSIÓN DEL ARCHIVO' + (lote ? ' (lote ' + lote + ')' : '') + ': revertidos ' + res.revertidos.length + ' de ' + archivados.length + ' · omitidos ' + res.omitidos.length + ' · errores ' + res.errores.length);
    return res;
  } finally { lock.releaseLock(); }
}
