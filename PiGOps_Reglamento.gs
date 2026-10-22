// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PiGOps_Reglamento.gs — Reglamento Interno de Trabajo: tardanzas, llamados de atención y faltas graves (v18.5)
//
// Archivo NUEVO del mismo proyecto de Apps Script que PiGOps_Notificaciones_v5.gs (copiar a mano, igual que ese).
// Reutiliza FIREBASE_PROJECT, FIREBASE_REST, MESES_ES, getMallaSheetId(), firestoreGetDocRaw() y MALLA_SHEET_NAME de
// aquel archivo — los dos deben vivir en el mismo proyecto.
//
// ── CÓMO FUNCIONA ──
// • NO hay doGet/doPost nuevos: nada de aquí se puede disparar desde fuera. Todo corre por DISPARADORES PROGRAMADOS:
//     reglamentoAvisos()          cada 15 min  → detecta tardanzas nuevas, crea su registro y avisa al agente.
//     reglamentoProcesarPlazos()  cada día a las 7:00 (solo corre en día hábil) → confirma faltas vencidas y envía
//                                  llamados de atención / notificaciones de falta grave.
//   Se instalan UNA vez ejecutando instalarDisparadoresReglamento() desde el editor.
// • Firestore se lee/escribe con la API REST usando ScriptApp.getOAuthToken() (la cuenta dueña del script, igual que
//   el resto de PiGOps_Notificaciones_v5.gs): no hay llaves ni contraseñas guardadas en ningún lado.
// • Idempotente: cada tardanza tiene UN documento (reglamento_casos/{email}_{AAAAMMDD}_reg) con estado; una vez
//   «Enviado» (o «Cancelado») nunca se vuelve a enviar. LockService evita dos ejecuciones simultáneas.
//
// ── PROPIEDADES DEL SCRIPT (Configuración del proyecto → Propiedades del script) ──
//   reg_th_email           correo(s) de Talento Humano (separados por coma)             [obligatoria]
//   reg_template_id        ID del Google Doc plantilla del llamado de atención           [obligatoria]
//   reg_firmante_cargo     cargo del firmante (Camilo Romero)                            [obligatoria]
//   reg_firmante_nombre    nombre del firmante                                           [opcional, 'Camilo Romero']
//   reg_drive_folder_id    carpeta de Drive donde se guardan PDF y soportes              [opcional]
//   reg_test_email         correo que recibe TODO en modo prueba                         [opcional, 'cromero@pibox.app']
//   El interruptor de MODO PRUEBA vive en Firestore (configs/global.reglamentoModoPrueba, lo cambia el Super Admin desde
//   ⚙ Configurar en Pi GOps). Si falta o no se puede leer: MODO PRUEBA (falla hacia el lado seguro).
//
// ── MARCADORES DE LA PLANTILLA (Google Doc) ──
//   {{FECHA}}            fecha de emisión, ej. «5 de noviembre de 2026»
//   {{NOMBRE}}           nombre del colaborador
//   {{CARGO}}            cargo del colaborador (BASE 3.0, col. F)
//   {{CEDULA}}           (opcional) cédula (BASE 3.0, col. D)
//   {{DESCRIPCION_FALTAS}}  en un párrafo propio: se reemplaza por UN PÁRRAFO POR FALTA (fecha y evidencia)
//   {{CAUSAL}}           (opcional) causal literal: «Artículo 59, numeral 1: El retardo injustificado en la hora de entrada, hasta por segunda vez.»
//   {{FIRMANTE}}         nombre del firmante
//   {{CARGO_FIRMANTE}}   cargo del firmante
//   {{INICIO_NOTA}} y {{FIN_NOTA}}  cada uno en su propio párrafo, rodeando el bloque «nota para quien diligencia el
//                        documento»: se borra todo lo que quede entre ellos (incluidos los marcadores).
//
// ── PERMISOS (se piden al autorizar la primera vez) ──
//   Gmail (enviar), Drive, Documentos, Hojas de cálculo, URL externa (UrlFetch), disparadores (ScriptApp) y
//   Cloud Datastore/Firestore (cloud-platform) — los mismos que ya usa PiGOps_Notificaciones_v5.gs más Drive/Documentos.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

var REG = {
  DESDE: '2026-11-01',          // las tardanzas anteriores siguen en el modelo de strikes
  TOLERANCIA_MIN: 5,            // tardanza = más de 5 minutos
  PLAZO_DIAS_HABILES: 3,
  VENTANA_MESES: 3,             // mes actual + 2 anteriores completos (igual que la vigencia de strikes)
  COL: 'reglamento_casos',
  APP_URL: 'https://cromero-cmd.github.io/Pibox-GOps/',
  ESTADO_PLAZO: 'En plazo de justificación',
  ESTADO_JUSTIFICADO: 'Justificado',
  ESTADO_ENVIADO: 'Enviado',
  ESTADO_CANCELADO: 'Cancelado',
  ESTADO_CERRADO: 'Cerrado',    // caso de Talento Humano cerrado por un admin (cerradoPor / cerradoAt)
  // Texto literal del Reglamento Interno de Trabajo de Digital Platforms Colombia S.A.S.
  CAUSAL_LEVE: 'Artículo 59, numeral 1: El retardo injustificado en la hora de entrada, hasta por segunda vez.',
  CAUSAL_602: 'Artículo 60, numeral 2: El retardo injustificado en la hora de entrada, por tercera vez.',
  CAUSAL_6013: 'Artículo 60, numeral 13: Acumular tres (3) llamados de atención realizados por su jefe inmediato.'
};

// Festivos de Colombia 2026 y 2027 (Ley 51 de 1983 / Emiliani). ÚNICO lugar donde se mantiene esta lista en este archivo;
// index.html tiene su copia (FESTIVOS_CO) y test/pigops_reglamento_test.js verifica que sean idénticas y correctas.
// Para 2028 en adelante: agregar las fechas aquí y en index.html.
var FESTIVOS_CO = [
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
  '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16',
  '2026-12-08', '2026-12-25',
  '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10', '2027-05-31',
  '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15',
  '2027-12-08', '2027-12-25'
];

// ── Fechas (todo en hora de Bogotá, UTC-5 fijo, sin horario de verano) ──
function reg_pad(n) { return (n < 10 ? '0' : '') + n; }
function reg_isoParts(iso) { var p = String(iso).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
function reg_isoToMs(iso) { var p = reg_isoParts(iso); return Date.UTC(p.y, p.m - 1, p.d); }
function reg_msToIso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + reg_pad(d.getUTCMonth() + 1) + '-' + reg_pad(d.getUTCDate()); }
function reg_addDays(iso, n) { return reg_msToIso(reg_isoToMs(iso) + n * 86400000); }
function reg_weekday(iso) { return new Date(reg_isoToMs(iso)).getUTCDay(); } // 0=domingo
function reg_esHabil(iso) { var w = reg_weekday(iso); return w !== 0 && w !== 6 && FESTIVOS_CO.indexOf(iso) === -1; }
// n-ésimo día hábil DESPUÉS de iso (iso no cuenta). Excluye sábados, domingos y festivos.
function reg_sumarHabiles(iso, n) {
  var c = iso, k = 0;
  while (k < n) { c = reg_addDays(c, 1); if (reg_esHabil(c)) k++; }
  return c;
}
function reg_fechaLimite(isoTardanza) { return reg_sumarHabiles(isoTardanza, REG.PLAZO_DIAS_HABILES); }
function reg_isoBogota(date) { return reg_msToIso(date.getTime() - 5 * 3600000); }
function reg_finDelDia(iso) { var p = reg_isoParts(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d, 23 + 5, 59, 59, 999)); }
function reg_aDDMMYYYY(iso) { var p = reg_isoParts(iso); return reg_pad(p.d) + '/' + reg_pad(p.m) + '/' + p.y; }
function reg_isoDesdeDDMMYYYY(s) {
  var p = String(s || '').trim().split('/');
  if (p.length !== 3) return null;
  var y = p[2].length === 2 ? '20' + p[2] : p[2];
  return y + '-' + reg_pad(+p[1]) + '-' + reg_pad(+p[0]);
}
function reg_fechaLarga(iso) { var p = reg_isoParts(iso); return p.d + ' de ' + MESES_ES[p.m - 1] + ' de ' + p.y; }
function reg_horaAmPm(date) { // Date → «8:14 a. m.» (hora de Bogotá)
  var d = new Date(date.getTime() - 5 * 3600000), h = d.getUTCHours(), mi = d.getUTCMinutes();
  return (h % 12 === 0 ? 12 : h % 12) + ':' + reg_pad(mi) + (h < 12 ? ' a. m.' : ' p. m.');
}
function reg_horaProgramada(texto) { // «8:00:00» / «14:00» / «8:00 a. m.» → {h, mi} o null
  var s = String(texto || '').trim();
  if (!s || s === '0') return null;
  var low = s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  var pm = /\bp ?m\b/.test(low), am = /\ba ?m\b/.test(low);
  var m = low.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (pm && h !== 12) h += 12;
  if (am && h === 12) h = 0;
  return { h: h, mi: mi };
}
function reg_progADate(iso, hm) { var p = reg_isoParts(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d, hm.h + 5, hm.mi, 0, 0)); }
// Primer día de la ventana de 3 meses calendario que termina en el mes de iso, nunca antes de REG.DESDE.
function reg_inicioVentana(iso) {
  var p = reg_isoParts(iso), m = p.m - (REG.VENTANA_MESES - 1), y = p.y;
  while (m < 1) { m += 12; y--; }
  var ini = y + '-' + reg_pad(m) + '-01';
  return ini < REG.DESDE ? REG.DESDE : ini;
}
function reg_idCaso(email, iso) { return email + '_' + iso.replace(/-/g, '') + '_reg'; }
function reg_idWaiver(email, iso) { return email + '_' + iso.replace(/-/g, '') + '_tardanza'; }

// ── Detección de tardanzas (misma regla que Pi GOps: malla vs. inicio real del turno) ──
// malla: [{fecha:'DD/MM/YYYY', usuario, inicio, fin, novedad, lider}] · turnos: [{userEmail, status, startTime:Date, endTime}]
// Devuelve [{email, iso, fecha, prog, progTexto, inicio:Date, minutos}] con minutos > TOLERANCIA y fecha >= REG.DESDE.
function reg_detectarTardanzas(malla, turnos) {
  var porUsuarioDia = {};
  turnos.forEach(function (t) {
    if (!t.userEmail || !t.startTime) return;
    var k = t.userEmail + '|' + reg_isoBogota(t.startTime);
    (porUsuarioDia[k] = porUsuarioDia[k] || []).push(t);
  });
  var out = [], vistos = {};
  malla.forEach(function (m) {
    var iso = reg_isoDesdeDDMMYYYY(m.fecha);
    if (!iso || iso < REG.DESDE || !m.usuario) return;
    if (m.novedad) return; // cualquier novedad en la malla (incluida votaciones) no genera tardanza
    var hm = reg_horaProgramada(m.inicio);
    if (!hm) return;
    var k = m.usuario + '|' + iso;
    if (vistos[k]) return; // un solo cómputo por agente y día
    var dia = (porUsuarioDia[k] || []).slice().sort(function (a, b) { return a.startTime - b.startTime; });
    var turno = null, i;
    for (i = 0; i < dia.length; i++) if (dia[i].status === 'ended') { turno = dia[i]; break; }
    if (!turno) for (i = 0; i < dia.length; i++) if (dia[i].status === 'interrupted') { turno = dia[i]; break; }
    if (!turno) turno = dia[0] || null;
    if (!turno) return;
    var prog = reg_progADate(iso, hm);
    var minutos = Math.round((turno.startTime.getTime() - prog.getTime()) / 60000);
    if (minutos <= REG.TOLERANCIA_MIN) return;
    vistos[k] = true;
    out.push({ email: m.usuario, iso: iso, fecha: m.fecha, prog: prog, progTexto: reg_horaAmPm(prog), inicio: turno.startTime, inicioTexto: reg_horaAmPm(turno.startTime), minutos: minutos });
  });
  return out.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
}

// ── Estado de UNA tardanza según justificaciones/apelaciones y plazo ──
// ctx: {waivers:{id→doc}, appeals:{id→doc}, docs:{id→doc}, now:Date}
//   'cancelada' | 'justificada' | 'apelacion_pendiente' | 'en_plazo' | 'confirmada'
function reg_estadoTardanza(t, ctx) {
  var doc = ctx.docs[reg_idCaso(t.email, t.iso)];
  if (doc && doc.estado === REG.ESTADO_CANCELADO) return 'cancelada';
  var wid = reg_idWaiver(t.email, t.iso);
  var ap = ctx.appeals[wid];
  if (ctx.waivers[wid] || (ap && ap.status === 'approved')) return 'justificada';
  var limite = reg_finDelDia(reg_fechaLimite(t.iso));
  if (ap && ap.status === 'rejected') return 'confirmada';
  if (ap && ap.status === 'pending') {
    var creada = ap.createdAt ? new Date(ap.createdAt) : null;
    if (creada && creada <= limite) return 'apelacion_pendiente'; // presentada a tiempo: la falta espera al admin
  }
  return ctx.now > limite ? 'confirmada' : 'en_plazo';
}

// Clasifica las tardanzas de UN agente (orden cronológico): 1.ª y 2.ª de la ventana = leve (llamado de atención),
// 3.ª en adelante = grave (art. 60.2). Las justificadas y canceladas no cuentan. Una tardanza solo se puede actuar
// cuando está confirmada Y no queda antes otra sin resolver (de lo contrario su número de orden podría cambiar).
function reg_clasificar(tardanzas, ctx) {
  var contables = [], bloqueado = false;
  return tardanzas.map(function (t) {
    var e = reg_estadoTardanza(t, ctx);
    var r = { t: t, estadoCalc: e, tipo: null, n: 0, accionable: false, espera: '' };
    if (e === 'justificada' || e === 'cancelada') return r;
    contables.push(t);
    var ini = reg_inicioVentana(t.iso);
    r.n = contables.filter(function (c) { return c.iso >= ini && c.iso <= t.iso; }).length;
    r.tipo = r.n >= 3 ? 'falta_grave' : 'llamado';
    if (e === 'confirmada' && !bloqueado) r.accionable = true;
    else if (e === 'confirmada' && bloqueado) r.espera = 'Espera a que se resuelva una tardanza anterior';
    if (e === 'apelacion_pendiente') r.espera = 'Apelación pendiente de resolver';
    if (e === 'en_plazo' || e === 'apelacion_pendiente') bloqueado = true;
    return r;
  });
}

function reg_descripcionFalta(t, rechazada) {
  return 'El día ' + reg_fechaLarga(t.iso) + ', su turno estaba programado para iniciar a las ' + t.progTexto +
    ' y registró su inicio a las ' + t.inicioTexto + ', con ' + t.minutos + ' minutos de retardo, ' +
    (rechazada ? 'sin que la justificación presentada fuera aprobada.' :
      'sin justificación aprobada dentro del plazo de ' + REG.PLAZO_DIAS_HABILES + ' días hábiles.');
}

// Llamados de atención ENVIADOS y vigentes (mes actual + 2 anteriores), uno por LLAMADO (no por falta): si varias tardanzas
// vencieron el mismo día se envió un solo llamado con un párrafo por falta y todas comparten llamadoId.
// Devuelve [{llamadoId, enviadoISO, pdfUrl, fechas:[ISO de cada falta]}] por fecha de envío. «prueba» solo cuenta en modo prueba.
function reg_llamadosVigentes(docs, email, hoyISO, modoPrueba) {
  var ini = reg_inicioVentanaSinDesde(hoyISO), grupos = {}, orden = [];
  Object.keys(docs).forEach(function (k) {
    var d = docs[k];
    if (!(d.userEmail === email && d.tipoRegistro === 'tardanza' && d.tipo === 'llamado' && d.estado === REG.ESTADO_ENVIADO && (modoPrueba || !d.prueba) && d.enviadoISO && d.enviadoISO >= ini)) return;
    var gid = d.llamadoId || ('solo_' + d.fechaISO);
    if (!grupos[gid]) { grupos[gid] = { llamadoId: gid, enviadoISO: d.enviadoISO, pdfUrl: d.pdfUrl || '', fechas: [] }; orden.push(gid); }
    grupos[gid].fechas.push(d.fechaISO);
  });
  return orden.map(function (g) { grupos[g].fechas.sort(); return grupos[g]; }).sort(function (a, b) { return a.enviadoISO < b.enviadoISO ? -1 : a.enviadoISO > b.enviadoISO ? 1 : 0; });
}
function reg_inicioVentanaSinDesde(iso) {
  var p = reg_isoParts(iso), m = p.m - (REG.VENTANA_MESES - 1), y = p.y;
  while (m < 1) { m += 12; y--; }
  return y + '-' + reg_pad(m) + '-01';
}

// ═══════════════ ORQUESTADOR (puro respecto a IO: todo entra por `deps`, así se prueba sin Google) ═══════════════
// deps: now(), config(), leerMalla(desdeISO), leerTurnos(desdeISO, hasta:Date), agentes() → {email:{nombre,cargo,cedula,liderEmail}},
//       listar(coleccion) → {id:doc}, crear(col,id,obj) → boolean (false si ya existía), actualizar(col,id,obj),
//       enviarCorreo({to,cc,subject,html,attachments}), generarPdfLlamado(datos) → {blob,url}, generarSoporte(datos) → {blob,url}
// opts: {avisos:boolean, plazos:boolean}
function reg_correr(deps, opts) {
  var now = deps.now(), cfg = deps.config(), hoy = reg_isoBogota(now);
  if (hoy < REG.DESDE) return { omitido: 'reglamento aún no vigente' };
  var ventIni = reg_inicioVentana(hoy);
  var malla = deps.leerMalla(ventIni), turnos = deps.leerTurnos(ventIni, now);
  var agentes = deps.agentes();
  var ctx = { waivers: deps.listar('strike_waivers'), appeals: deps.listar('strike_appeals'), docs: deps.listar(REG.COL), now: now };
  var porAgente = {};
  reg_detectarTardanzas(malla, turnos).forEach(function (t) { (porAgente[t.email] = porAgente[t.email] || []).push(t); });
  var res = { avisos: 0, llamados: 0, faltasGraves: 0, art6013: 0, errores: [] };
  Object.keys(porAgente).forEach(function (email) {
    try { reg_procesarAgente(deps, cfg, opts, email, porAgente[email], agentes[email] || {}, ctx, res, hoy); }
    catch (e) { res.errores.push(email + ': ' + e.message); }
  });
  // Agentes sin tardanzas nuevas pero con 3 llamados vigentes (art. 60.13)
  if (opts.plazos && reg_esHabil(hoy)) {
    var emails = {};
    Object.keys(ctx.docs).forEach(function (k) { if (ctx.docs[k].userEmail) emails[ctx.docs[k].userEmail] = true; });
    Object.keys(emails).forEach(function (email) {
      if (porAgente[email]) return;
      try { reg_revisar6013(deps, cfg, email, agentes[email] || {}, ctx, res, hoy); } catch (e) { res.errores.push(email + ' 60.13: ' + e.message); }
    });
  }
  return res;
}

function reg_procesarAgente(deps, cfg, opts, email, tardanzas, ag, ctx, res, hoy) {
  var filas = reg_clasificar(tardanzas, ctx), llamadosPend = [], gravesPend = [];
  filas.forEach(function (f) {
    var t = f.t, id = reg_idCaso(email, t.iso), doc = ctx.docs[id];
    var estado = f.estadoCalc === 'justificada' ? REG.ESTADO_JUSTIFICADO : f.estadoCalc === 'cancelada' ? REG.ESTADO_CANCELADO : REG.ESTADO_PLAZO;
    var limiteISO = reg_fechaLimite(t.iso);
    // Definitivos: Enviado/Cerrado (en modo prueba, o si no son de prueba) y Cancelado
    var sticky = !!doc && ((doc.estado === REG.ESTADO_ENVIADO || doc.estado === REG.ESTADO_CERRADO) && (cfg.modoPrueba || !doc.prueba) || doc.estado === REG.ESTADO_CANCELADO);
    var datos = {
      tipoRegistro: 'tardanza', userEmail: email, userName: ag.nombre || email.split('@')[0], cargo: ag.cargo || '',
      liderEmail: ag.liderEmail || '', fecha: reg_aDDMMYYYY(t.iso), fechaISO: t.iso, programada: t.progTexto, inicioReal: t.inicioTexto,
      minutos: t.minutos, limiteISO: limiteISO, espera: f.espera || ''
    };
    if (!sticky) {
      datos.estado = estado;
      datos.tipo = f.tipo || (doc && doc.tipo) || 'llamado';
      datos.numeroEnVentana = f.n;
    }
    if (!doc) {
      datos.creadoAt = deps.now().toISOString();
      datos.prueba = !!cfg.modoPrueba;
      if (deps.crear(REG.COL, id, datos)) ctx.docs[id] = datos;
      doc = ctx.docs[id];
    } else if (!sticky) {
      deps.actualizar(REG.COL, id, datos);
      for (var k in datos) doc[k] = datos[k];
    }
    if (!doc || sticky) return;
    // Aviso informativo al agente en el momento de la tardanza (solo si el plazo sigue abierto)
    // (un aviso enviado en modo prueba no cuenta: al pasar a producción el agente debe recibir el real)
    if (opts.avisos && f.estadoCalc === 'en_plazo' && (!doc.avisoEnviadoAt || (doc.avisoPrueba && !cfg.modoPrueba))) {
      reg_enviarAviso(deps, cfg, ag, email, t, limiteISO);
      var marca = { avisoEnviadoAt: deps.now().toISOString(), avisoPrueba: !!cfg.modoPrueba };
      deps.actualizar(REG.COL, id, marca); doc.avisoEnviadoAt = marca.avisoEnviadoAt; doc.avisoPrueba = marca.avisoPrueba; res.avisos++;
    }
    // Confirmación (solo en el proceso diario, en día hábil). Se juntan para enviar UN llamado por agente y día.
    if (opts.plazos && reg_esHabil(hoy) && f.accionable) {
      var ap = ctx.appeals[reg_idWaiver(email, t.iso)];
      if (f.tipo === 'llamado') llamadosPend.push({ t: t, id: id, doc: doc, n: f.n, rechazada: !!(ap && ap.status === 'rejected') });
      else gravesPend.push({ t: t, id: id, doc: doc, n: f.n });
    }
  });
  if (llamadosPend.length) { reg_enviarLlamado(deps, cfg, ag, email, llamadosPend, ctx, hoy); res.llamados++; }
  gravesPend.forEach(function (g) {
    reg_enviarFaltaGrave(deps, cfg, ag, email, filas, g.t, g.id, g.doc, ctx, 'art60_2', hoy, g.n >= 4);
    res.faltasGraves++;
  });
  if (opts.plazos && reg_esHabil(hoy)) reg_revisar6013(deps, cfg, email, ag, ctx, res, hoy);
}

// ── Destinatarios (en modo prueba TODO va solo a cromero con «PRUEBA» en el asunto) ──
function reg_listaCorreos(arr) {
  var vistos = {}, out = [];
  (arr || []).forEach(function (x) { String(x || '').split(',').forEach(function (e) { e = e.trim(); if (e && !vistos[e.toLowerCase()]) { vistos[e.toLowerCase()] = true; out.push(e); } }); });
  return out;
}
function reg_enviar(deps, cfg, msg) {
  var real = { to: reg_listaCorreos(msg.to), cc: reg_listaCorreos(msg.cc) };
  var envio = { to: real.to.join(','), cc: real.cc.join(','), subject: msg.subject, html: msg.html, attachments: msg.attachments || [] };
  if (cfg.modoPrueba) {
    envio.to = cfg.testEmail; envio.cc = '';
    envio.subject = 'PRUEBA — ' + msg.subject;
    envio.html = '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-family:Arial,sans-serif;font-size:13px;color:#92400e;">' +
      '<strong>MODO PRUEBA</strong> — este correo NO se envió a los destinatarios reales.<br>Habría ido a: <strong>' + real.to.join(', ') + '</strong>' +
      (real.cc.length ? '<br>Con copia a: ' + real.cc.join(', ') : '') + '</div>' + msg.html;
  }
  deps.enviarCorreo(envio);
  return envio;
}
function reg_caja(titulo, color, cuerpo) {
  return '<div style="font-family:Arial,sans-serif;color:#333;max-width:640px;"><div style="background:' + color + ';padding:16px;border-radius:8px 8px 0 0;"><h2 style="color:white;margin:0;font-size:18px;">' + titulo + '</h2></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' + cuerpo + FOOTER_HTML + '</div></div>';
}
function reg_filaTabla(celdas) {
  return '<tr>' + celdas.map(function (c) { return '<td style="padding:8px 12px;border:1px solid #ddd;">' + c + '</td>'; }).join('') + '</tr>';
}
function reg_tablaTardanzas(filas) {
  return '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;"><tr style="background:#f3f0ff;">' +
    ['Fecha', 'Hora programada', 'Hora de inicio', 'Minutos de retardo', 'Estado'].map(function (h) { return '<th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">' + h + '</th>'; }).join('') + '</tr>' +
    filas.map(function (f) { return reg_filaTabla([reg_aDDMMYYYY(f.t.iso), f.t.progTexto, f.t.inicioTexto, f.t.minutos, f.estadoTexto]); }).join('') + '</table>';
}

// 1) Aviso informativo al agente
function reg_enviarAviso(deps, cfg, ag, email, t, limiteISO) {
  var html = reg_caja('Tardanza registrada — puedes justificarla', '#7B2FFF',
    '<p>Hola ' + (ag.nombre || '') + ',</p>' +
    '<p>Pi GOps registró una <strong>llegada tarde</strong>: el día <strong>' + reg_fechaLarga(t.iso) + '</strong> tu turno estaba programado a las <strong>' + t.progTexto +
    '</strong> y el inicio se registró a las <strong>' + t.inicioTexto + '</strong> (' + t.minutos + ' minutos de retardo).</p>' +
    '<p>Tienes hasta el <strong>' + reg_fechaLarga(limiteISO) + '</strong> (' + REG.PLAZO_DIAS_HABILES + ' días hábiles) para justificarla o apelarla desde Pi GOps: ' +
    '<a href="' + REG.APP_URL + '">' + REG.APP_URL + '</a> → Mi turno → «Reglamento».</p>' +
    '<p style="color:#6b7280;font-size:13px;">Si la justificación es aprobada, la tardanza no cuenta. Si el plazo vence sin justificación, la falta queda confirmada según el Reglamento Interno de Trabajo.</p>');
  reg_enviar(deps, cfg, { to: [email], subject: 'Tardanza del ' + reg_fechaLarga(t.iso) + ' — plazo para justificar hasta el ' + reg_fechaLarga(limiteISO), html: html });
}

// 2) Llamado de atención (falta leve confirmada). items: todas las tardanzas leves que se confirman HOY para este agente →
// UN solo llamado (un PDF, un correo) con un párrafo por falta. Cuenta como UN llamado para el art. 60.13.
function reg_enviarLlamado(deps, cfg, ag, email, items, ctx, hoy) {
  items.sort(function (a, b) { return a.t.iso < b.t.iso ? -1 : 1; });
  var numero = reg_llamadosVigentes(ctx.docs, email, hoy, cfg.modoPrueba).length + 1;
  var faltas = items.map(function (it) { return reg_descripcionFalta(it.t, it.rechazada); });
  var pdf = deps.generarPdfLlamado({
    fecha: reg_fechaLarga(hoy), nombre: ag.nombre || email, cargo: ag.cargo || '', cedula: ag.cedula || '', causal: REG.CAUSAL_LEVE,
    faltas: faltas, firmante: cfg.firmanteNombre, cargoFirmante: cfg.firmanteCargo,
    email: email, emails: reg_listaCorreos([email, ag.liderEmail, cfg.thEmail, cfg.testEmail])
  });
  var fechas = items.map(function (it) { return '<strong>' + reg_fechaLarga(it.t.iso) + '</strong> (' + it.t.minutos + ' minutos de retardo)'; });
  var html = reg_caja('Llamado de atención por llegada tarde', '#fb923c',
    '<p>Hola ' + (ag.nombre || '') + ',</p><p>Se adjunta el llamado de atención correspondiente a ' + (items.length > 1 ? 'tus llegadas tarde del ' : 'tu llegada tarde del ') + fechas.join(', ') +
    ', confirmada' + (items.length > 1 ? 's' : '') + ' por no haberse aprobado una justificación dentro del plazo.</p>' +
    '<p><strong>Causal:</strong> ' + REG.CAUSAL_LEVE + '</p>' +
    '<p>Es tu llamado de atención n.º <strong>' + numero + '</strong> en la ventana de tres meses vigente. Una tercera llegada tarde injustificada en la ventana, o acumular tres llamados de atención vigentes, es falta grave según el Reglamento Interno de Trabajo.</p>');
  reg_enviar(deps, cfg, {
    to: [email], cc: [ag.liderEmail, cfg.thEmail, cfg.testEmail], subject: 'Llamado de atención — ' + (ag.nombre || email) + ' — ' + reg_aDDMMYYYY(hoy),
    html: html, attachments: pdf.blob ? [pdf.blob] : []
  });
  var gid = items[0].id;
  items.forEach(function (it) {
    var upd = { estado: REG.ESTADO_ENVIADO, enviadoAt: deps.now().toISOString(), enviadoISO: hoy, pdfUrl: pdf.url || '', prueba: !!cfg.modoPrueba, tipo: 'llamado', numeroEnVentana: it.n, llamadoId: gid, llamadoNumero: numero, espera: '' };
    deps.actualizar(REG.COL, it.id, upd);
    for (var k in upd) it.doc[k] = upd[k];
  });
}

// 3) Falta grave → Talento Humano (3.ª tardanza o 3 llamados), con soporte Excel. NO se envía al agente.
// filas: resultado de reg_clasificar del agente (detalle de la ventana). causal: 'art60_2' | 'art60_13'.
// reincidencia (4.ª tardanza en adelante): mismo envío, con asunto «Reincidencia — …» y referencia al caso abierto.
function reg_enviarFaltaGrave(deps, cfg, ag, email, filas, t, id, doc, ctx, causal, hoy, reincidencia) {
  var ini = reg_inicioVentana(hoy), nombre = ag.nombre || email;
  var visibles = filas.filter(function (f) { return f.t.iso >= ini; }).map(function (f) {
    var estadoTexto = { justificada: 'Justificada (no cuenta)', cancelada: 'Cancelada (no cuenta)', apelacion_pendiente: 'Apelación pendiente', en_plazo: 'En plazo de justificación', confirmada: 'Confirmada' }[f.estadoCalc];
    return { t: f.t, estadoTexto: estadoTexto, tipo: f.tipo, n: f.n };
  });
  var previos = reg_llamadosVigentes(ctx.docs, email, hoy, cfg.modoPrueba);
  var causalTxt = causal === 'art60_13' ? REG.CAUSAL_6013 : REG.CAUSAL_602;
  // Caso abierto al que se refiere una reincidencia: la falta grave de la 3.ª tardanza de la ventana
  var abierto = null;
  if (reincidencia) {
    Object.keys(ctx.docs).map(function (k) { return ctx.docs[k]; }).filter(function (d) {
      return d.userEmail === email && d.tipoRegistro === 'tardanza' && d.tipo === 'falta_grave' && d.numeroEnVentana === 3 &&
        (d.estado === REG.ESTADO_ENVIADO || d.estado === REG.ESTADO_CERRADO) && d.fechaISO >= ini && d.fechaISO < t.iso;
    }).forEach(function (d) { if (!abierto || d.fechaISO > abierto.fechaISO) abierto = d; });
  }
  var soporte = deps.generarSoporte({ nombre: nombre, cargo: ag.cargo || '', liderEmail: ag.liderEmail || '', email: email, causal: causalTxt, fecha: reg_fechaLarga(hoy), tardanzas: visibles, llamados: previos, reincidencia: !!reincidencia, emails: reg_listaCorreos([cfg.thEmail, ag.liderEmail, cfg.testEmail]) });
  var llamadosHtml = previos.length
    ? '<ul>' + previos.map(function (l) { return '<li>Llamado enviado el ' + reg_aDDMMYYYY(l.enviadoISO) + ' por la(s) tardanza(s) del ' + l.fechas.map(reg_aDDMMYYYY).join(' y ') + (l.pdfUrl ? ' · <a href="' + l.pdfUrl + '">PDF</a>' : '') + '</li>'; }).join('') + '</ul>'
    : '<p>Sin llamados de atención previos vigentes.</p>';
  var refHtml = !reincidencia ? '' :
    '<p style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;"><strong>Reincidencia.</strong> ' +
    (abierto ? 'Se refiere al caso ya abierto por la 3.ª tardanza (' + reg_aDDMMYYYY(abierto.fechaISO) + '), notificado el ' + reg_aDDMMYYYY(abierto.enviadoISO) + (abierto.soporteUrl ? ' · <a href="' + abierto.soporteUrl + '">soporte del caso abierto</a>' : '') + (abierto.estado === REG.ESTADO_CERRADO ? ' (caso marcado como cerrado)' : '') + '.'
      : 'No se encontró en Pi GOps el caso previo de la ventana.') +
    ' La tardanza que motiva este aviso es la del ' + reg_aDDMMYYYY(t.iso) + '.</p>';
  var asunto = (reincidencia ? 'Reincidencia — ' : '') + 'Falta grave para descargos — ' + nombre;
  var html = reg_caja(asunto, '#dc2626',
    '<p>Se informa la siguiente falta grave:</p>' +
    '<table style="font-size:14px;margin-bottom:10px;"><tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Colaborador</td><td><strong>' + nombre + '</strong> (' + email + ')</td></tr>' +
    '<tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Cargo</td><td>' + (ag.cargo || '—') + '</td></tr>' +
    '<tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Líder directo</td><td>' + (ag.liderEmail || '—') + '</td></tr></table>' +
    '<p><strong>Causal:</strong> ' + causalTxt + '</p>' + refHtml +
    '<p><strong>Tardanzas de la ventana vigente</strong> (desde ' + reg_aDDMMYYYY(ini) + '):</p>' + reg_tablaTardanzas(visibles) +
    '<p><strong>Llamados de atención enviados antes:</strong></p>' + llamadosHtml +
    '<p>Se adjunta el Excel de soporte del caso.</p>' +
    '<p><strong>Solicitamos agendar la diligencia de descargos según el procedimiento del art. 64 del Reglamento Interno de Trabajo.</strong></p>');
  reg_enviar(deps, cfg, { to: [cfg.thEmail], cc: [ag.liderEmail, cfg.testEmail], subject: asunto, html: html, attachments: soporte.blob ? [soporte.blob] : [] });
  var upd = { estado: REG.ESTADO_ENVIADO, enviadoAt: deps.now().toISOString(), enviadoISO: hoy, soporteUrl: soporte.url || '', prueba: !!cfg.modoPrueba, tipo: 'falta_grave', causal: causal, espera: '', reincidencia: !!reincidencia };
  if (abierto) upd.casoAbiertoId = abierto._id || reg_idCaso(email, abierto.fechaISO);
  if (causal === 'art60_13') {
    upd.tipoRegistro = 'art60_13'; upd.userEmail = email; upd.userName = nombre; upd.cargo = ag.cargo || ''; upd.liderEmail = ag.liderEmail || '';
    upd.fecha = reg_aDDMMYYYY(hoy); upd.fechaISO = hoy; upd.creadoAt = deps.now().toISOString();
    var existente = ctx.docs[id];
    if (existente) deps.actualizar(REG.COL, id, upd); else deps.crear(REG.COL, id, upd);
    ctx.docs[id] = Object.assign(existente || {}, upd);
  } else {
    deps.actualizar(REG.COL, id, upd);
    for (var k in upd) doc[k] = upd[k];
  }
}

// 4) Art. 60.13: 3 llamados de atención vigentes → falta grave. Un solo envío por tercio de llamados (id por fecha del último).
function reg_revisar6013(deps, cfg, email, ag, ctx, res, hoy) {
  var vig = reg_llamadosVigentes(ctx.docs, email, hoy, cfg.modoPrueba);
  if (vig.length < 3) return;
  var ultimo = vig[vig.length - 1];
  var id = email + '_' + ultimo.enviadoISO.replace(/-/g, '') + '_6013';
  var ya = ctx.docs[id];
  if (ya && ya.estado === REG.ESTADO_ENVIADO && (cfg.modoPrueba || !ya.prueba)) return;
  if (ya && ya.estado === REG.ESTADO_CANCELADO) return;
  // detalle: las tardanzas de la ventana reconstruidas desde los registros guardados (no necesita releer turnos)
  var filas = Object.keys(ctx.docs).map(function (k) { return ctx.docs[k]; }).filter(function (d) {
    return d.userEmail === email && d.tipoRegistro === 'tardanza' && d.fechaISO >= reg_inicioVentana(hoy);
  }).sort(function (a, b) { return a.fechaISO < b.fechaISO ? -1 : 1; }).map(function (d) {
    return { t: { iso: d.fechaISO, progTexto: d.programada, inicioTexto: d.inicioReal, minutos: d.minutos, email: email },
      estadoCalc: d.estado === REG.ESTADO_JUSTIFICADO ? 'justificada' : d.estado === REG.ESTADO_CANCELADO ? 'cancelada' : (d.estado === REG.ESTADO_ENVIADO || d.estado === REG.ESTADO_CERRADO) ? 'confirmada' : 'en_plazo', tipo: d.tipo, n: d.numeroEnVentana };
  });
  reg_enviarFaltaGrave(deps, cfg, ag, email, filas, null, id, ya, ctx, 'art60_13', hoy);
  res.art6013++;
}

// ═══════════════ PRODUCCIÓN: lectura/escritura real (Firestore REST, Sheets, Drive, Docs, Gmail) ═══════════════
// ── Valores tipados de Firestore ──
function reg_fsDecodificar(v) {
  if (v === undefined || v === null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(reg_fsDecodificar);
  if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; for (var k in f) o[k] = reg_fsDecodificar(f[k]); return o; }
  return null;
}
function reg_fsDoc(d) {
  var o = { _id: d.name.split('/').pop() }, f = d.fields || {};
  for (var k in f) o[k] = reg_fsDecodificar(f[k]);
  return o;
}
function reg_fsCodificar(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function reg_fsCampos(obj) { var f = {}; Object.keys(obj).forEach(function (k) { f[k] = reg_fsCodificar(obj[k]); }); return f; }
function reg_token() { return ScriptApp.getOAuthToken(); }
function reg_listarColeccion(col) {
  var out = {}, pageToken = '';
  do {
    var url = FIREBASE_REST + '/' + col + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + reg_token() }, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code === 404) return out;
    if (code !== 200) throw new Error('Firestore ' + col + ' → HTTP ' + code);
    var js = JSON.parse(resp.getContentText());
    (js.documents || []).forEach(function (d) { var o = reg_fsDoc(d); out[o._id] = o; });
    pageToken = js.nextPageToken || '';
  } while (pageToken);
  return out;
}
// Crea SOLO si no existe (precondición exists=false): devuelve false si ya existía → idempotente aunque se cruce otra ejecución.
function reg_crearDoc(col, id, obj) {
  var url = FIREBASE_REST + '/' + col + '/' + encodeURIComponent(id) + '?currentDocument.exists=false';
  var resp = UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + reg_token() }, payload: JSON.stringify({ fields: reg_fsCampos(obj) }), muteHttpExceptions: true });
  var code = resp.getResponseCode();
  if (code === 200) return true;
  if (code === 409 || (code === 400 && /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(resp.getContentText()))) return false;
  throw new Error('Firestore crear ' + id + ' → HTTP ' + code + ' ' + resp.getContentText().slice(0, 200));
}
function reg_actualizarDoc(col, id, obj) {
  var mask = Object.keys(obj).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var url = FIREBASE_REST + '/' + col + '/' + encodeURIComponent(id) + '?' + mask;
  var resp = UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + reg_token() }, payload: JSON.stringify({ fields: reg_fsCampos(obj) }), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Firestore actualizar ' + id + ' → HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText().slice(0, 200));
}
function reg_leerTurnos(desdeISO, hasta) {
  var out = [], ini = reg_finDelDia(reg_addDays(desdeISO, -1)); // 00:00 Bogotá de desdeISO
  ini = new Date(ini.getTime() + 1);
  for (var cur = ini; cur < hasta;) {
    var fin = new Date(Math.min(cur.getTime() + 7 * 86400000, hasta.getTime()));
    var body = { structuredQuery: { from: [{ collectionId: 'turnos' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: cur.toISOString() } } },
      { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'LESS_THAN', value: { timestampValue: fin.toISOString() } } }] } }, limit: 1000 } };
    var resp = UrlFetchApp.fetch(FIREBASE_REST + ':runQuery', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + reg_token() }, payload: JSON.stringify(body), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Firestore turnos → HTTP ' + resp.getResponseCode());
    JSON.parse(resp.getContentText()).forEach(function (r) {
      if (!r.document) return;
      var o = reg_fsDoc(r.document);
      if (o.userEmail && o.startTime) out.push({ userEmail: o.userEmail, status: o.status || '', startTime: new Date(o.startTime), endTime: o.endTime ? new Date(o.endTime) : null });
    });
    cur = fin;
  }
  return out;
}
function reg_leerMalla(desdeISO) {
  var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) throw new Error('No se encontró la hoja Malla');
  var data = sheet.getDataRange().getDisplayValues(), rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i], iso = reg_isoDesdeDDMMYYYY(r[1]);
    if (!iso || iso < desdeISO) continue;
    rows.push({ fecha: String(r[1]).trim(), usuario: String(r[2] || '').trim(), nombre: String(r[3] || '').trim(), inicio: String(r[5] || '').trim(), fin: String(r[6] || '').trim(), lider: String(r[9] || '').trim(), novedad: String(r[10] || '').trim() });
  }
  return rows;
}
// BASE 3.0: nombre (E), cargo (F), correo (G), cédula (D). Líder = columna J de la malla (nombre o correo) resuelto con la misma hoja.
function reg_agentes(malla) {
  var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName('BASE 3.0');
  var porEmail = {}, porNombre = {};
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var nombre = String(data[i][4] || '').trim(), cargo = String(data[i][5] || '').trim(), email = String(data[i][6] || '').trim(), cedula = String(data[i][3] || '').trim();
      if (!email) continue;
      porEmail[email] = { nombre: nombre, cargo: cargo, cedula: cedula };
      if (nombre) porNombre[nombre] = email;
    }
  }
  var out = {};
  Object.keys(porEmail).forEach(function (e) { out[e] = porEmail[e]; });
  (malla || []).forEach(function (m) {
    if (!m.usuario) return;
    var a = out[m.usuario] = out[m.usuario] || { nombre: m.nombre, cargo: '', cedula: '' };
    if (m.lider && !a.liderEmail) a.liderEmail = m.lider.indexOf('@') !== -1 ? m.lider : (porNombre[m.lider] || '');
  });
  return out;
}
function reg_config() {
  var p = PropertiesService.getScriptProperties();
  // Modo prueba: configs/global.reglamentoModoPrueba. SOLO un false explícito lo apaga; cualquier otra cosa = prueba.
  var modoPrueba = true;
  try {
    var g = firestoreGetDocRaw('configs/global');
    var v = g && g.fields && g.fields.reglamentoModoPrueba;
    if (v && v.booleanValue === false) modoPrueba = false;
  } catch (e) { modoPrueba = true; }
  var cfg = {
    modoPrueba: modoPrueba,
    thEmail: p.getProperty('reg_th_email') || '',
    templateId: p.getProperty('reg_template_id') || '',
    firmanteNombre: p.getProperty('reg_firmante_nombre') || 'Camilo Romero',
    firmanteCargo: p.getProperty('reg_firmante_cargo') || '',
    folderId: p.getProperty('reg_drive_folder_id') || '',
    testEmail: p.getProperty('reg_test_email') || 'cromero@pibox.app'
  };
  if (!cfg.thEmail || !cfg.templateId || !cfg.firmanteCargo) throw new Error('Faltan propiedades del script: reg_th_email, reg_template_id y/o reg_firmante_cargo');
  return cfg;
}
function reg_carpeta(cfg) { return cfg.folderId ? DriveApp.getFolderById(cfg.folderId) : DriveApp.getRootFolder(); }
function reg_compartir(file, emails) {
  try { file.addViewers(emails.filter(function (e) { return e && e.indexOf('@') !== -1; })); } catch (e) { Logger.log('No se pudo compartir ' + file.getName() + ': ' + e.message); }
}
// Google Docs lanza «No es posible insertar un elemento de texto vacío» con setText(''), insertText(i,'') y appendText(''): en todo el
// archivo se evitan (reg_vaciarParrafo / reg_ponerTexto). replaceText con '' sí es válido y es lo normal para borrar un marcador;
// si aun así fallara, se borra el marcador con deleteText.
function reg_reemplazar(body, marcador, valor) {
  var patron = '\\{\\{' + marcador + '\\}\\}', v = String(valor == null ? '' : valor);
  if (v !== '') { body.replaceText(patron, v.replace(/\$/g, '\\$')); return; }
  try { body.replaceText(patron, ''); }
  catch (e) {
    var r = body.findText(patron);
    while (r) { r.getElement().asText().deleteText(r.getStartOffset(), r.getEndOffsetInclusive()); r = body.findText(patron); }
  }
}
// Vacía un párrafo conservando su formato de párrafo, SIN setText(''): clear(), o deleteText si clear() no está disponible.
function reg_vaciarParrafo(p) {
  try { p.clear(); return; } catch (e) { /* sigue con deleteText */ }
  var tx = p.editAsText(), len = tx.getText().length;
  if (len > 0) tx.deleteText(0, len - 1);
}
function reg_ponerTexto(p, txt) { if (txt === '' || txt == null) reg_vaciarParrafo(p); else p.setText(txt); }
// ── Formato de párrafos de Google Docs ──
function reg_tryGet(fn) { try { return fn(); } catch (e) { return null; } }
// Formato visible de un párrafo (texto y párrafo): fuente y tamaño a nivel de texto (null si es mixto o vacío) más alineación, interlineado, sangrías y espaciado.
function reg_formatoParrafo(p) {
  var tx = reg_tryGet(function () { return p.editAsText(); });
  var tieneTexto = p.getText().replace(/\s+/g, '') !== '';
  return {
    fuente: tieneTexto && tx ? reg_tryGet(function () { return tx.getFontFamily(); }) : null,
    tam: tieneTexto && tx ? reg_tryGet(function () { return tx.getFontSize(); }) : null,
    alineacion: String(reg_tryGet(function () { return p.getAlignment(); })),
    interlineado: reg_tryGet(function () { return p.getLineSpacing(); }),
    sangriaPrimera: reg_tryGet(function () { return p.getIndentFirstLine(); }),
    sangriaIzq: reg_tryGet(function () { return p.getIndentStart(); }),
    antes: reg_tryGet(function () { return p.getSpacingBefore(); }),
    despues: reg_tryGet(function () { return p.getSpacingAfter(); })
  };
}
function reg_parrafoVacio(el) {
  if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) return false;
  var p = el.asParagraph();
  if (p.getText().replace(/\s+/g, '') !== '') return false;
  for (var j = 0; j < p.getNumChildren(); j++) {
    var tp = p.getChild(j).getType();
    if (tp === DocumentApp.ElementType.INLINE_IMAGE || tp === DocumentApp.ElementType.INLINE_DRAWING || tp === DocumentApp.ElementType.HORIZONTAL_RULE) return false;
  }
  return true;
}
// Evita la hoja en blanco: quita saltos de página y párrafos vacíos del FINAL. Google Docs no deja borrar el último párrafo
// del documento: si está vacío se conserva pero se reduce al mínimo (1 pt, sin espaciado) para que no empuje una página nueva.
function reg_limpiarFinal(body) {
  var n = body.getNumChildren();
  if (n < 1) return;
  var ult = body.getChild(n - 1);
  if (ult.getType() === DocumentApp.ElementType.PARAGRAPH) {
    var p = ult.asParagraph();
    for (var j = p.getNumChildren() - 1; j >= 0; j--) if (p.getChild(j).getType() === DocumentApp.ElementType.PAGE_BREAK) p.getChild(j).removeFromParent();
  }
  if (!reg_parrafoVacio(ult)) return; // el contenido termina en el último párrafo: nada que limpiar
  var atr = {}; atr[DocumentApp.Attribute.FONT_SIZE] = 1; atr[DocumentApp.Attribute.SPACING_BEFORE] = 0; atr[DocumentApp.Attribute.SPACING_AFTER] = 0; atr[DocumentApp.Attribute.LINE_SPACING] = 1;
  try { ult.asParagraph().setAttributes(atr); } catch (e) { Logger.log('No se pudo reducir el último párrafo: ' + e.message); }
  for (var i = n - 2; i >= 0; i--) {
    var el = body.getChild(i);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var q = el.asParagraph();
      for (var k = q.getNumChildren() - 1; k >= 0; k--) if (q.getChild(k).getType() === DocumentApp.ElementType.PAGE_BREAK) q.getChild(k).removeFromParent();
    }
    if (!reg_parrafoVacio(el)) break;
    body.removeChild(el);
  }
}
// Nº de páginas de un PDF (cuenta los objetos /Type /Page y el /Count del árbol de páginas). 0 = no se pudo determinar.
function reg_paginasPdf(blob) {
  var txt = blob.getDataAsString('ISO-8859-1');
  var paginas = (txt.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
  var cuentas = (txt.match(/\/Count\s+(\d+)/g) || []).map(function (c) { return parseInt(c.replace(/\D+/g, ''), 10); });
  return Math.max(paginas, cuentas.length ? Math.max.apply(null, cuentas) : 0);
}
// Plantilla → copia → marcadores → PDF. Cada falta en su propio párrafo, con EL MISMO formato que el párrafo del marcador
// {{DESCRIPCION_FALTAS}} (se copian los párrafos completos, no solo sus atributos: los párrafos nuevos de Docs no heredan fuente,
// tamaño, alineación, interlineado ni sangría) y separadas como el resto del documento. Se elimina la nota para quien diligencia
// y el final vacío (hoja en blanco) antes de exportar.
function reg_pdfLlamado(cfg, d) {
  var copia = DriveApp.getFileById(cfg.templateId).makeCopy('Llamado de atención — ' + d.nombre + ' — ' + d.fecha);
  try {
    var doc = DocumentApp.openById(copia.getId()), body = doc.getBody();
    // (solo pruebaEnvioReglamento) qué marcadores traía la plantilla y cómo se ve el párrafo anterior al marcador, antes de tocarla
    var tenia = null, refFormato = null;
    if (cfg.verificarCuerpo) {
      tenia = { nota: !!(body.findText('\\{\\{INICIO_NOTA\\}\\}') && body.findText('\\{\\{FIN_NOTA\\}\\}')), causal: !!body.findText('\\{\\{CAUSAL\\}\\}'), descripcion: !!body.findText('\\{\\{DESCRIPCION_FALTAS\\}\\}') };
      var h0 = body.findText('\\{\\{DESCRIPCION_FALTAS\\}\\}');
      if (h0) {
        var p0 = h0.getElement().getParent(), c0 = p0.getParent();
        for (var q = c0.getChildIndex(p0) - 1; q >= 0; q--) {
          var e0 = c0.getChild(q);
          if (e0.getType() === DocumentApp.ElementType.PARAGRAPH && !reg_parrafoVacio(e0)) { refFormato = reg_formatoParrafo(e0.asParagraph()); break; }
        }
      }
    }
    reg_reemplazar(body, 'FECHA', d.fecha); reg_reemplazar(body, 'NOMBRE', d.nombre); reg_reemplazar(body, 'CARGO', d.cargo);
    reg_reemplazar(body, 'CEDULA', d.cedula); reg_reemplazar(body, 'CAUSAL', d.causal); reg_reemplazar(body, 'FIRMANTE', d.firmante); reg_reemplazar(body, 'CARGO_FIRMANTE', d.cargoFirmante);
    var hit = body.findText('\\{\\{DESCRIPCION_FALTAS\\}\\}');
    if (hit) {
      var par = hit.getElement().getParent().asParagraph(); // el párrafo que contiene el marcador
      var cont = par.getParent(), idx = cont.getChildIndex(par);
      var contenedor = cont.getType() === DocumentApp.ElementType.BODY_SECTION ? cont.asBody() : cont.asTableCell();
      // Si el párrafo del marcador no tiene espaciado posterior, las faltas se separan con una línea vacía de igual formato
      var conLineaVacia = !(reg_tryGet(function () { return par.getSpacingAfter(); }) > 0);
      // Moldes ANTES de reemplazar el texto del marcador: conservan todo el formato. Fuente y tamaño del texto del marcador, para
      // devolvérselos explícitamente a la línea vacía (un párrafo sin texto no los hereda y alteraría el interlineado).
      var moldes = [], moldesVacios = [], fmtMarcador = reg_formatoParrafo(par), atrTexto = {};
      if (fmtMarcador.fuente) atrTexto[DocumentApp.Attribute.FONT_FAMILY] = fmtMarcador.fuente;
      if (fmtMarcador.tam) atrTexto[DocumentApp.Attribute.FONT_SIZE] = fmtMarcador.tam;
      for (var i = 1; i < d.faltas.length; i++) { moldes.push(par.copy()); if (conLineaVacia) moldesVacios.push(par.copy()); }
      reg_ponerTexto(par, d.faltas[0]);
      var pos = idx + 1;
      for (var k = 1; k < d.faltas.length; k++) {
        if (conLineaVacia) {
          var vacio = contenedor.insertParagraph(pos++, moldesVacios[k - 1]);
          reg_vaciarParrafo(vacio); // sin setText('')
          try { vacio.setAttributes(atrTexto); } catch (e) { Logger.log('No se pudo fijar fuente/tamaño de la línea vacía: ' + e.message); }
        }
        var np = contenedor.insertParagraph(pos++, moldes[k - 1]);
        reg_ponerTexto(np, d.faltas[k]);
      }
    }
    // Nota para quien diligencia: borrar desde {{INICIO_NOTA}} hasta {{FIN_NOTA}} (inclusive)
    var a = body.findText('\\{\\{INICIO_NOTA\\}\\}'), b = body.findText('\\{\\{FIN_NOTA\\}\\}');
    if (a && b) {
      var ia = body.getChildIndex(a.getElement().getParent()), ib = body.getChildIndex(b.getElement().getParent());
      for (var kk = ib; kk >= ia; kk--) {
        try { body.removeChild(body.getChild(kk)); }
        catch (e) { body.getChild(kk).asParagraph().clear(); } // el último párrafo del documento no se puede quitar: se vacía
      }
    }
    reg_limpiarFinal(body);
    if (cfg.verificarCuerpo) {
      var parrafos = body.getParagraphs(), formatos = { referencia: refFormato, faltas: [], lineaVaciaEntre: null };
      var posiciones = d.faltas.map(function (f) { for (var z = 0; z < parrafos.length; z++) if (parrafos[z].getText() === f) return z; return -1; });
      posiciones.forEach(function (z) { if (z >= 0) formatos.faltas.push(reg_formatoParrafo(parrafos[z])); });
      if (posiciones.length > 1 && posiciones.every(function (z) { return z >= 0; })) {
        formatos.lineaVaciaEntre = posiciones.every(function (z, m) { return m === 0 || (z - posiciones[m - 1] === 2 && parrafos[z - 1].getText().replace(/\s+/g, '') === ''); });
      }
      cfg.verificarCuerpo(body.getText(), parrafos.map(function (p) { return p.getText(); }), tenia, formatos);
    }
    doc.saveAndClose();
    var pdf = reg_carpeta(cfg).createFile(copia.getAs('application/pdf').setName('Llamado de atención — ' + d.nombre + ' — ' + d.fecha + '.pdf'));
    if (!cfg.sinCompartir) reg_compartir(pdf, d.emails);
    return { blob: pdf.getBlob(), url: pdf.getUrl() };
  } finally { copia.setTrashed(true); }
}
// Excel de soporte: hoja temporal → exportar .xlsx → guardar en Drive → borrar la hoja temporal.
function reg_xlsxSoporte(cfg, d) {
  var ss = SpreadsheetApp.create('Soporte falta grave — ' + d.nombre);
  try {
    var h1 = ss.getActiveSheet(); h1.setName('Caso');
    h1.getRange(1, 1, 8, 2).setValues([['Colaborador', d.nombre], ['Correo', d.email], ['Cargo', d.cargo], ['Líder directo', d.liderEmail], ['Causal', d.causal], ['Fecha del reporte', d.fecha], ['Reincidencia', d.reincidencia ? 'Sí' : 'No'], ['Modo', cfg.modoPrueba ? 'PRUEBA' : 'Producción']]);
    var h2 = ss.insertSheet('Tardanzas');
    var f2 = [['Fecha', 'Hora programada', 'Hora de inicio', 'Minutos de retardo', 'Estado']].concat(d.tardanzas.map(function (f) { return [reg_aDDMMYYYY(f.t.iso), f.t.progTexto, f.t.inicioTexto, f.t.minutos, f.estadoTexto]; }));
    h2.getRange(1, 1, f2.length, 5).setValues(f2);
    var h3 = ss.insertSheet('Llamados de atención');
    var f3 = [['Fecha(s) de la falta', 'Fecha de envío', 'PDF']].concat(d.llamados.map(function (l) { return [l.fechas.map(reg_aDDMMYYYY).join(' y '), reg_aDDMMYYYY(l.enviadoISO), l.pdfUrl || '']; }));
    h3.getRange(1, 1, f3.length, 3).setValues(f3);
    SpreadsheetApp.flush();
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + reg_token() } });
    var blob = resp.getBlob().setName('Soporte falta grave — ' + d.nombre + '.xlsx');
    var file = reg_carpeta(cfg).createFile(blob);
    if (!cfg.sinCompartir) reg_compartir(file, d.emails);
    return { blob: file.getBlob(), url: file.getUrl() };
  } finally { DriveApp.getFileById(ss.getId()).setTrashed(true); }
}
function reg_depsProduccion() {
  var cfg = null, malla = null;
  return {
    now: function () { return new Date(); },
    config: function () { cfg = cfg || reg_config(); return cfg; },
    leerMalla: function (d) { malla = reg_leerMalla(d); return malla; },
    leerTurnos: reg_leerTurnos,
    agentes: function () { return reg_agentes(malla); },
    listar: reg_listarColeccion,
    crear: reg_crearDoc,
    actualizar: reg_actualizarDoc,
    enviarCorreo: function (m) {
      var o = { htmlBody: m.html, name: 'Pi GOps' };
      if (m.cc) o.cc = m.cc;
      if (m.attachments && m.attachments.length) o.attachments = m.attachments;
      GmailApp.sendEmail(m.to, m.subject, 'Este mensaje requiere un cliente de correo con HTML.', o);
    },
    generarPdfLlamado: function (d) { return reg_pdfLlamado(cfg || reg_config(), d); },
    generarSoporte: function (d) { return reg_xlsxSoporte(cfg || reg_config(), d); }
  };
}

// ── Disparadores ──
function reg_conCandado(opts) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Reglamento: otra ejecución en curso — se omite'); return; }
  try {
    var res = reg_correr(reg_depsProduccion(), opts);
    Logger.log('Reglamento ' + JSON.stringify(opts) + ' → ' + JSON.stringify(res));
    if (res && res.errores && res.errores.length) Logger.log('ERRORES: ' + res.errores.join(' | '));
  } finally { lock.releaseLock(); }
}
function reglamentoAvisos() { reg_conCandado({ avisos: true, plazos: false }); }
function reglamentoProcesarPlazos() { reg_conCandado({ avisos: true, plazos: true }); }
// Ejecutar UNA vez desde el editor: crea los dos disparadores (y borra duplicados de estos mismos).
function instalarDisparadoresReglamento() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'reglamentoAvisos' || f === 'reglamentoProcesarPlazos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reglamentoAvisos').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('reglamentoProcesarPlazos').timeBased().atHour(7).nearMinute(0).everyDays(1).inTimezone('America/Bogota').create();
  Logger.log('Disparadores del Reglamento instalados (cada 15 min + diario 7:00 America/Bogota).');
}

// ── DIAGNÓSTICO (ejecutar desde el editor; NO envía correos ni escribe nada: solo lee) ──
// Comprueba propiedades, permisos (Drive, Docs, Hojas, Gmail, UrlFetch/Firestore) y disparadores. Útil tras editar el
// manifiesto (appsscript.json): si falta un permiso, aquí aparece como FALLA con el nombre del servicio.
function diagnosticoReglamento() {
  var out = [];
  function prueba(nombre, fn) {
    try { out.push('OK     ' + nombre + (function () { var r = fn(); return r ? ' → ' + r : ''; })()); }
    catch (e) { out.push('FALLA  ' + nombre + ' → ' + e.message); }
  }
  var p = PropertiesService.getScriptProperties();
  ['reg_th_email', 'reg_template_id', 'reg_firmante_cargo'].forEach(function (k) { prueba('propiedad ' + k, function () { if (!p.getProperty(k)) throw new Error('vacía'); return 'definida'; }); });
  prueba('cuenta que ejecuta (debe ser cromero@pibox.app)', function () { return Session.getEffectiveUser().getEmail(); });
  prueba('Drive: leer la plantilla', function () { return DriveApp.getFileById(p.getProperty('reg_template_id')).getName(); });
  prueba('Documentos: abrir la plantilla', function () { return DocumentApp.openById(p.getProperty('reg_template_id')).getName(); });
  prueba('Hojas de cálculo: abrir la malla', function () { return SpreadsheetApp.openById(getMallaSheetId()).getName(); });
  prueba('Gmail', function () { return 'bandeja accesible (' + GmailApp.getInboxUnreadCount() + ' sin leer)'; });
  prueba('UrlFetch + Firestore (lectura de configs/global)', function () { var g = firestoreGetDocRaw('configs/global'); return g ? 'leído; modo prueba = ' + !(g.fields && g.fields.reglamentoModoPrueba && g.fields.reglamentoModoPrueba.booleanValue === false) : 'sin documento (modo prueba por defecto)'; });
  prueba('Firestore: colección ' + REG.COL, function () { return Object.keys(reg_listarColeccion(REG.COL)).length + ' registros'; });
  prueba('Disparadores instalados', function () {
    var f = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    if (f.indexOf('reglamentoAvisos') < 0 || f.indexOf('reglamentoProcesarPlazos') < 0) throw new Error('faltan; ejecuta instalarDisparadoresReglamento()');
    return f.join(', ');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

// ── PRUEBA DE ENVÍO (ejecutar a mano desde el editor; NO es un disparador y NO lo llama nadie) ──
// Genera con datos FICTICIOS lo mismo que se enviará en producción —un llamado de atención con DOS faltas (PDF de la
// plantilla real), una notificación de falta grave con el Excel de soporte y una de reincidencia— usando las MISMAS
// funciones de producción, y envía los tres correos SOLO a cromero@pibox.app con «PRUEBA DE ENVÍO» en el asunto, sin
// importar el modo prueba ni los correos de las propiedades. No escribe en Firestore, no lee agentes ni malla, no toca los
// disparadores ni comparte los archivos con nadie. Deja los PDF/Excel en Drive (reg_drive_folder_id o la raíz): los enlaces
// quedan en el log para revisarlos y borrarlos. Cada paso se registra como OK / FALLA / AVISO.
var REG_PRUEBA_DESTINO = 'cromero@pibox.app';
function pruebaEnvioReglamento() {
  var log = [], enlaces = [];
  function paso(nombre, fn) {
    try { var r = fn(); log.push('OK     ' + nombre + (r ? ' → ' + r : '')); return true; }
    catch (e) { log.push('FALLA  ' + nombre + ' → ' + e.message); return false; }
  }
  function aviso(txt) { log.push('AVISO  ' + txt); }
  var p = PropertiesService.getScriptProperties();
  var cfg = {
    modoPrueba: true, sinCompartir: true, testEmail: REG_PRUEBA_DESTINO,
    thEmail: 'talento.humano.prueba@example.com', // ficticio: solo aparece en el banner «habría ido a…»
    templateId: p.getProperty('reg_template_id') || '', folderId: p.getProperty('reg_drive_folder_id') || '',
    firmanteNombre: p.getProperty('reg_firmante_nombre') || 'Camilo Romero', firmanteCargo: p.getProperty('reg_firmante_cargo') || ''
  };
  var hoy = '2026-11-17';
  var ag = { nombre: 'Agente de Prueba', cargo: 'Agente de Operaciones', cedula: '0000000000', liderEmail: 'Líder de Prueba (lider.prueba@example.com)' };
  var email = 'agente.prueba@example.com';
  paso('cuenta que ejecuta (debe ser ' + REG_PRUEBA_DESTINO + ')', function () {
    var u = Session.getEffectiveUser().getEmail();
    if (u !== REG_PRUEBA_DESTINO) throw new Error('la ejecuta ' + u + ': los correos igual van solo a ' + REG_PRUEBA_DESTINO + ', pero revisa la cuenta');
    return u;
  });
  var ok = paso('propiedades reg_template_id y reg_firmante_cargo', function () {
    if (!cfg.templateId || !cfg.firmanteCargo) throw new Error('faltan reg_template_id y/o reg_firmante_cargo');
    return 'definidas; firma: ' + cfg.firmanteNombre + ' — ' + cfg.firmanteCargo;
  });
  if (ok) {
    // Cuatro tardanzas inventadas (noviembre de 2026): 1.ª y 2.ª = falta leve; 3.ª = falta grave; 4.ª = reincidencia
    var datos = [['2026-11-03', 14], ['2026-11-04', 22], ['2026-11-05', 9], ['2026-11-09', 31]].map(function (x) {
      var prog = reg_progADate(x[0], { h: 8, mi: 0 }), ini = new Date(prog.getTime() + x[1] * 60000);
      return { email: email, iso: x[0], fecha: reg_aDDMMYYYY(x[0]), prog: prog, progTexto: reg_horaAmPm(prog), inicio: ini, inicioTexto: reg_horaAmPm(ini), minutos: x[1] };
    });
    var docs = {};
    datos.forEach(function (t, i) {
      docs[reg_idCaso(email, t.iso)] = { _id: reg_idCaso(email, t.iso), tipoRegistro: 'tardanza', userEmail: email, userName: ag.nombre, cargo: ag.cargo, fecha: t.fecha, fechaISO: t.iso,
        programada: t.progTexto, inicioReal: t.inicioTexto, minutos: t.minutos, numeroEnVentana: i + 1, tipo: i < 2 ? 'llamado' : 'falta_grave', estado: REG.ESTADO_PLAZO, prueba: true };
    });
    var ahora = reg_finDelDia(hoy);
    var ctx = { waivers: {}, appeals: {}, docs: docs, now: ahora };
    var filas = reg_clasificar(datos, ctx);
    var deps = {
      now: function () { return ahora; },
      actualizar: function () { /* sin Firestore */ }, crear: function () { return true; },
      enviarCorreo: function (m) {
        // Destino y asunto FIJOS: pase lo que pase aguas arriba, el correo va solo a cromero.
        var base = reg_depsProduccion();
        base.enviarCorreo({ to: REG_PRUEBA_DESTINO, cc: '', subject: 'PRUEBA DE ENVÍO — ' + String(m.subject).replace(/^PRUEBA — /, ''), html: m.html, attachments: m.attachments });
        log.push('OK     correo enviado solo a ' + REG_PRUEBA_DESTINO + ' → «PRUEBA DE ENVÍO — ' + String(m.subject).replace(/^PRUEBA — /, '') + '»' + (m.attachments && m.attachments.length ? ' (adjunto: ' + m.attachments.length + ')' : ''));
      },
      generarPdfLlamado: function (d) {
        var c = Object.assign({}, cfg, { verificarCuerpo: function (texto, parrafos, tenia, formatos) { reg_verificarPdfPrueba(texto, parrafos, tenia, d, log, formatos); } });
        var r = reg_pdfLlamado(c, d); enlaces.push('PDF del llamado: ' + r.url); log.push('OK     PDF generado y guardado en Drive → ' + r.url);
        var pag = reg_tryGet(function () { return reg_paginasPdf(r.blob); });
        if (pag === null || pag === 0) log.push('AVISO  PDF: no se pudo contar las páginas (revísalo a mano: debe tener una sola)');
        else log.push((pag === 1 ? 'OK     ' : 'FALLA  ') + 'PDF: una sola página con ' + d.faltas.length + ' faltas → tiene ' + pag + ' página' + (pag !== 1 ? 's' : ''));
        return r;
      },
      generarSoporte: function (d) { var r = reg_xlsxSoporte(cfg, d); enlaces.push('Excel de soporte' + (d.reincidencia ? ' (reincidencia)' : '') + ': ' + r.url); log.push('OK     Excel de soporte generado y guardado en Drive → ' + r.url); return r; }
    };
    var items = [0, 1].map(function (i) { return { t: datos[i], id: reg_idCaso(email, datos[i].iso), doc: docs[reg_idCaso(email, datos[i].iso)], n: i + 1, rechazada: false }; });
    var llamadoOk = paso('1/3 llamado de atención con DOS faltas (plantilla real → PDF → correo)', function () { reg_enviarLlamado(deps, cfg, ag, email, items, ctx, hoy); return 'enviado'; });
    if (!llamadoOk) items.forEach(function (it) { it.doc.estado = REG.ESTADO_ENVIADO; it.doc.enviadoISO = hoy; it.doc.pdfUrl = '(no generado)'; it.doc.llamadoId = items[0].id; });
    var d3 = docs[reg_idCaso(email, datos[2].iso)], d4 = docs[reg_idCaso(email, datos[3].iso)];
    paso('2/3 notificación de falta grave para descargos (Excel de soporte adjunto)', function () { reg_enviarFaltaGrave(deps, cfg, ag, email, filas, datos[2], reg_idCaso(email, datos[2].iso), d3, ctx, 'art60_2', hoy, false); return 'enviada'; });
    paso('3/3 notificación de reincidencia (4.ª tardanza, referencia al caso abierto)', function () { reg_enviarFaltaGrave(deps, cfg, ag, email, filas, datos[3], reg_idCaso(email, datos[3].iso), d4, ctx, 'art60_2', hoy, true); return 'enviada'; });
  }
  log.push('');
  log.push('ARCHIVOS GENERADOS EN DRIVE (revísalos y bórralos; no se compartieron con nadie):');
  enlaces.forEach(function (e) { log.push('  • ' + e); });
  if (!enlaces.length) log.push('  (ninguno)');
  log.push('Firestore: no se leyó ni escribió nada. Disparadores: no se tocaron.');
  var texto = log.join('\n');
  Logger.log(texto);
  return texto;
}
// Revisión automática del cuerpo del documento ANTES de convertirlo a PDF (lo que verás en el PDF).
function reg_verificarPdfPrueba(texto, parrafos, tenia, d, log, formatos) {
  function chk(nombre, cond, detalle) { log.push((cond ? 'OK     ' : 'FALLA  ') + 'PDF: ' + nombre + (detalle ? ' → ' + detalle : '')); }
  var sinMarcador = texto.match(/\{\{[A-Z_]+\}\}/g);
  chk('marcadores reemplazados (no queda ningún {{...}})', !sinMarcador, sinMarcador ? 'quedan: ' + sinMarcador.join(', ') : '');
  chk('nombre, cargo y fecha del documento', texto.indexOf(d.nombre) >= 0 && texto.indexOf(d.cargo) >= 0 && texto.indexOf(d.fecha) >= 0);
  if (!tenia.descripcion) log.push('FALLA  PDF: la plantilla no tiene {{DESCRIPCION_FALTAS}}: las faltas no aparecen');
  var idx = d.faltas.map(function (f) { return parrafos.indexOf(f); });
  chk('un párrafo por falta (' + d.faltas.length + ' faltas, cada una en su propio párrafo, seguidas o separadas por una línea vacía)', idx.every(function (i) { return i >= 0; }) && idx.every(function (i, k) { return k === 0 || i === idx[k - 1] + 1 || (i === idx[k - 1] + 2 && parrafos[i - 1].replace(/\s+/g, '') === ''); }), 'posiciones ' + idx.join(','));
  if (tenia.nota) chk('nota para quien diligencia eliminada (marcadores {{INICIO_NOTA}}/{{FIN_NOTA}} y todo lo que había entre ellos)', texto.indexOf('INICIO_NOTA') < 0 && texto.indexOf('FIN_NOTA') < 0);
  else log.push('AVISO  PDF: la plantilla NO tiene {{INICIO_NOTA}} / {{FIN_NOTA}}: la nota amarilla NO se elimina sola. Agrega esos dos marcadores (cada uno en su párrafo) rodeándola.');
  if (tenia.causal) chk('causal literal (art. 59 num. 1)', texto.indexOf(d.causal) >= 0, d.causal);
  else log.push('AVISO  PDF: la plantilla no tiene {{CAUSAL}}: la causal «' + d.causal + '» solo va en el correo, no en el PDF. Agrega el marcador si quieres que aparezca.');
  chk('firma: ' + d.firmante + ' — ' + d.cargoFirmante, texto.indexOf(d.firmante) >= 0 && texto.indexOf(d.cargoFirmante) >= 0);
  if (formatos) {
    var fs = formatos.faltas, ref = formatos.referencia;
    function igualesA(a, b) { return a.fuente === b.fuente && a.tam === b.tam; }
    function nom(f) { return (f.fuente || '¿?') + ' ' + (f.tam || '¿?'); }
    if (!ref) log.push('AVISO  PDF: no hay un párrafo con texto antes del marcador {{DESCRIPCION_FALTAS}} para comparar la fuente y el tamaño');
    else chk('todos los párrafos de faltas tienen la misma fuente y tamaño que el párrafo anterior al marcador (' + nom(ref) + ')', fs.length === d.faltas.length && fs.every(function (f) { return igualesA(f, ref); }), fs.map(nom).join(' | '));
    chk('los párrafos de faltas son idénticos entre sí en fuente, tamaño, alineación, interlineado y sangría', fs.length > 0 && fs.every(function (f) { return igualesA(f, fs[0]) && f.alineacion === fs[0].alineacion && f.interlineado === fs[0].interlineado && f.sangriaPrimera === fs[0].sangriaPrimera && f.sangriaIzq === fs[0].sangriaIzq; }), fs.map(function (f) { return nom(f) + ' ' + f.alineacion + ' ' + f.interlineado; }).join(' | '));
    if (d.faltas.length > 1) chk('separación entre faltas igual a la del documento (línea vacía con el mismo formato o espaciado posterior)', formatos.lineaVaciaEntre === true || (fs.length > 1 && fs.every(function (f) { return f.despues > 0; })), formatos.lineaVaciaEntre ? 'línea vacía' : 'espaciado posterior ' + (fs[0] && fs[0].despues));
  }
  var vacios = 0; for (var i = parrafos.length - 1; i >= 0 && parrafos[i].replace(/\s+/g, '') === ''; i--) vacios++;
  chk('sin párrafos vacíos al final (causa de la hoja en blanco)', vacios <= 1, vacios + ' al final' + (vacios === 1 ? ' (el último de un documento de Docs no se puede borrar: se reduce al mínimo)' : ''));
}
