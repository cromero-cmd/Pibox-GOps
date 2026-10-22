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
  CAUSAL_602: 'Artículo 60, numeral 2 del Reglamento Interno de Trabajo (tercera o posterior llegada tarde injustificada dentro de la ventana de tres meses)',
  CAUSAL_6013: 'Artículo 60, numeral 13 del Reglamento Interno de Trabajo (acumulación de tres llamados de atención vigentes)'
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
    ' y el inicio se registró en Pi GOps a las ' + t.inicioTexto + ', con ' + t.minutos + ' minutos de retardo, ' +
    (rechazada ? 'sin que la justificación presentada fuera aprobada.' :
      'sin justificación aprobada dentro del plazo de ' + REG.PLAZO_DIAS_HABILES + ' días hábiles.');
}

// Llamados de atención ENVIADOS y vigentes (mes actual + 2 anteriores) — «prueba» solo cuenta en modo prueba.
function reg_llamadosVigentes(docs, email, hoyISO, modoPrueba) {
  var ini = reg_inicioVentanaSinDesde(hoyISO);
  return Object.keys(docs).map(function (k) { return docs[k]; }).filter(function (d) {
    return d.userEmail === email && d.tipoRegistro === 'tardanza' && d.tipo === 'llamado' && d.estado === REG.ESTADO_ENVIADO &&
      (modoPrueba || !d.prueba) && d.enviadoISO && d.enviadoISO >= ini;
  }).sort(function (a, b) { return a.enviadoISO < b.enviadoISO ? -1 : 1; });
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
  var filas = reg_clasificar(tardanzas, ctx);
  filas.forEach(function (f) {
    var t = f.t, id = reg_idCaso(email, t.iso), doc = ctx.docs[id];
    var estado = f.estadoCalc === 'justificada' ? REG.ESTADO_JUSTIFICADO : f.estadoCalc === 'cancelada' ? REG.ESTADO_CANCELADO : REG.ESTADO_PLAZO;
    var limiteISO = reg_fechaLimite(t.iso);
    var sticky = doc && (doc.estado === REG.ESTADO_ENVIADO && (cfg.modoPrueba || !doc.prueba) || doc.estado === REG.ESTADO_CANCELADO);
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
      deps.actualizar(REG.COL, id, marca); doc.avisoEnviadoAt = marca.avisoEnviadoAt; res.avisos++;
    }
    // Confirmación y envíos (solo en el proceso diario, en día hábil)
    if (opts.plazos && reg_esHabil(hoy) && f.accionable) {
      var rechazada = !!(ctx.appeals[reg_idWaiver(email, t.iso)] && ctx.appeals[reg_idWaiver(email, t.iso)].status === 'rejected');
      if (f.tipo === 'llamado') { reg_enviarLlamado(deps, cfg, ag, email, t, f.n, rechazada, id, doc, ctx); res.llamados++; }
      else { reg_enviarFaltaGrave(deps, cfg, ag, email, filas, t, id, doc, ctx, 'art60_2', hoy); res.faltasGraves++; }
    }
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

// 2) Llamado de atención (falta leve confirmada)
function reg_enviarLlamado(deps, cfg, ag, email, t, n, rechazada, id, doc, ctx) {
  var hoy = reg_isoBogota(deps.now());
  var pdf = deps.generarPdfLlamado({
    fecha: reg_fechaLarga(hoy), nombre: ag.nombre || email, cargo: ag.cargo || '', cedula: ag.cedula || '',
    faltas: [reg_descripcionFalta(t, rechazada)], firmante: cfg.firmanteNombre, cargoFirmante: cfg.firmanteCargo,
    email: email, emails: reg_listaCorreos([email, ag.liderEmail, cfg.thEmail, cfg.testEmail])
  });
  var html = reg_caja('Llamado de atención por llegada tarde', '#fb923c',
    '<p>Hola ' + (ag.nombre || '') + ',</p><p>Se adjunta el llamado de atención correspondiente a tu llegada tarde del <strong>' + reg_fechaLarga(t.iso) +
    '</strong> (' + t.minutos + ' minutos de retardo), confirmada por no haberse aprobado una justificación dentro del plazo.</p>' +
    '<p>Es tu llamado de atención n.º <strong>' + n + '</strong> en la ventana de tres meses vigente. Una tercera llegada tarde injustificada en la ventana, o acumular tres llamados de atención vigentes, es falta grave según el Reglamento Interno de Trabajo.</p>');
  reg_enviar(deps, cfg, {
    to: [email], cc: [ag.liderEmail, cfg.thEmail, cfg.testEmail], subject: 'Llamado de atención — ' + (ag.nombre || email) + ' — ' + reg_aDDMMYYYY(t.iso),
    html: html, attachments: pdf.blob ? [pdf.blob] : []
  });
  var upd = { estado: REG.ESTADO_ENVIADO, enviadoAt: deps.now().toISOString(), enviadoISO: hoy, pdfUrl: pdf.url || '', prueba: !!cfg.modoPrueba, tipo: 'llamado', numeroEnVentana: n, espera: '' };
  deps.actualizar(REG.COL, id, upd);
  for (var k in upd) doc[k] = upd[k];
}

// 3) Falta grave → Talento Humano (3.ª tardanza o 3 llamados), con soporte Excel. NO se envía al agente.
// filas: resultado de reg_clasificar del agente (detalle de la ventana). causal: 'art60_2' | 'art60_13'
function reg_enviarFaltaGrave(deps, cfg, ag, email, filas, t, id, doc, ctx, causal, hoy) {
  var ini = reg_inicioVentana(hoy), nombre = ag.nombre || email;
  var visibles = filas.filter(function (f) { return f.t.iso >= ini; }).map(function (f) {
    var estadoTexto = { justificada: 'Justificada (no cuenta)', cancelada: 'Cancelada (no cuenta)', apelacion_pendiente: 'Apelación pendiente', en_plazo: 'En plazo de justificación', confirmada: 'Confirmada' }[f.estadoCalc];
    return { t: f.t, estadoTexto: estadoTexto, tipo: f.tipo, n: f.n };
  });
  var previos = reg_llamadosVigentes(ctx.docs, email, hoy, cfg.modoPrueba);
  var causalTxt = causal === 'art60_13' ? REG.CAUSAL_6013 : REG.CAUSAL_602;
  var soporte = deps.generarSoporte({ nombre: nombre, cargo: ag.cargo || '', liderEmail: ag.liderEmail || '', email: email, causal: causalTxt, fecha: reg_fechaLarga(hoy), tardanzas: visibles, llamados: previos, emails: reg_listaCorreos([cfg.thEmail, ag.liderEmail, cfg.testEmail]) });
  var llamadosHtml = previos.length
    ? '<ul>' + previos.map(function (l) { return '<li>' + reg_aDDMMYYYY(l.fechaISO) + ' — llamado enviado el ' + reg_aDDMMYYYY(l.enviadoISO) + (l.pdfUrl ? ' · <a href="' + l.pdfUrl + '">PDF</a>' : '') + '</li>'; }).join('') + '</ul>'
    : '<p>Sin llamados de atención previos vigentes.</p>';
  var html = reg_caja('Falta grave para descargos — ' + nombre, '#dc2626',
    '<p>Se informa la siguiente falta grave:</p>' +
    '<table style="font-size:14px;margin-bottom:10px;"><tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Colaborador</td><td><strong>' + nombre + '</strong> (' + email + ')</td></tr>' +
    '<tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Cargo</td><td>' + (ag.cargo || '—') + '</td></tr>' +
    '<tr><td style="padding:2px 10px 2px 0;color:#6b7280;">Líder directo</td><td>' + (ag.liderEmail || '—') + '</td></tr></table>' +
    '<p><strong>Causal:</strong> ' + causalTxt + '.</p>' +
    '<p><strong>Tardanzas de la ventana vigente</strong> (desde ' + reg_aDDMMYYYY(ini) + '):</p>' + reg_tablaTardanzas(visibles) +
    '<p><strong>Llamados de atención enviados antes:</strong></p>' + llamadosHtml +
    '<p>Se adjunta el Excel de soporte del caso.</p>' +
    '<p><strong>Solicitamos agendar la diligencia de descargos según el procedimiento del art. 64 del Reglamento Interno de Trabajo.</strong></p>');
  reg_enviar(deps, cfg, { to: [cfg.thEmail], cc: [ag.liderEmail, cfg.testEmail], subject: 'Falta grave para descargos — ' + nombre, html: html, attachments: soporte.blob ? [soporte.blob] : [] });
  var upd = { estado: REG.ESTADO_ENVIADO, enviadoAt: deps.now().toISOString(), enviadoISO: hoy, soporteUrl: soporte.url || '', prueba: !!cfg.modoPrueba, tipo: 'falta_grave', causal: causal, espera: '' };
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
      estadoCalc: d.estado === REG.ESTADO_JUSTIFICADO ? 'justificada' : d.estado === REG.ESTADO_CANCELADO ? 'cancelada' : d.estado === REG.ESTADO_ENVIADO ? 'confirmada' : 'en_plazo', tipo: d.tipo, n: d.numeroEnVentana };
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
function reg_reemplazar(body, marcador, valor) {
  body.replaceText('\\{\\{' + marcador + '\\}\\}', String(valor == null ? '' : valor).replace(/\$/g, '\\$'));
}
// Plantilla → copia → marcadores → PDF. Cada falta en su propio párrafo; se elimina la nota para quien diligencia.
function reg_pdfLlamado(cfg, d) {
  var copia = DriveApp.getFileById(cfg.templateId).makeCopy('Llamado de atención — ' + d.nombre + ' — ' + d.fecha);
  try {
    var doc = DocumentApp.openById(copia.getId()), body = doc.getBody();
    reg_reemplazar(body, 'FECHA', d.fecha); reg_reemplazar(body, 'NOMBRE', d.nombre); reg_reemplazar(body, 'CARGO', d.cargo);
    reg_reemplazar(body, 'CEDULA', d.cedula); reg_reemplazar(body, 'FIRMANTE', d.firmante); reg_reemplazar(body, 'CARGO_FIRMANTE', d.cargoFirmante);
    var hit = body.findText('\\{\\{DESCRIPCION_FALTAS\\}\\}');
    if (hit) {
      var par = hit.getElement().getParent(); // el párrafo que contiene el marcador
      var cont = par.getParent(), idx = cont.getChildIndex(par);
      var contenedor = cont.getType() === DocumentApp.ElementType.BODY_SECTION ? cont.asBody() : cont.asTableCell();
      par.asParagraph().setText(d.faltas[0]);
      for (var i = 1; i < d.faltas.length; i++) contenedor.insertParagraph(idx + i, d.faltas[i]).setAttributes(par.asParagraph().getAttributes());
    }
    // Nota para quien diligencia: borrar desde {{INICIO_NOTA}} hasta {{FIN_NOTA}} (inclusive)
    var a = body.findText('\\{\\{INICIO_NOTA\\}\\}'), b = body.findText('\\{\\{FIN_NOTA\\}\\}');
    if (a && b) {
      var ia = body.getChildIndex(a.getElement().getParent()), ib = body.getChildIndex(b.getElement().getParent());
      for (var k = ib; k >= ia; k--) {
        try { body.removeChild(body.getChild(k)); }
        catch (e) { body.getChild(k).asParagraph().clear(); } // el último párrafo del documento no se puede quitar: se vacía
      }
    }
    doc.saveAndClose();
    var pdf = reg_carpeta(cfg).createFile(copia.getAs('application/pdf').setName('Llamado de atención — ' + d.nombre + ' — ' + d.fecha + '.pdf'));
    reg_compartir(pdf, d.emails);
    return { blob: pdf.getBlob(), url: pdf.getUrl() };
  } finally { copia.setTrashed(true); }
}
// Excel de soporte: hoja temporal → exportar .xlsx → guardar en Drive → borrar la hoja temporal.
function reg_xlsxSoporte(cfg, d) {
  var ss = SpreadsheetApp.create('Soporte falta grave — ' + d.nombre);
  try {
    var h1 = ss.getActiveSheet(); h1.setName('Caso');
    h1.getRange(1, 1, 7, 2).setValues([['Colaborador', d.nombre], ['Correo', d.email], ['Cargo', d.cargo], ['Líder directo', d.liderEmail], ['Causal', d.causal], ['Fecha del reporte', d.fecha], ['Modo', cfg.modoPrueba ? 'PRUEBA' : 'Producción']]);
    var h2 = ss.insertSheet('Tardanzas');
    var f2 = [['Fecha', 'Hora programada', 'Hora de inicio', 'Minutos de retardo', 'Estado']].concat(d.tardanzas.map(function (f) { return [reg_aDDMMYYYY(f.t.iso), f.t.progTexto, f.t.inicioTexto, f.t.minutos, f.estadoTexto]; }));
    h2.getRange(1, 1, f2.length, 5).setValues(f2);
    var h3 = ss.insertSheet('Llamados de atención');
    var f3 = [['Fecha de la falta', 'Fecha de envío', 'PDF']].concat(d.llamados.map(function (l) { return [reg_aDDMMYYYY(l.fechaISO), reg_aDDMMYYYY(l.enviadoISO), l.pdfUrl || '']; }));
    h3.getRange(1, 1, f3.length, 3).setValues(f3);
    SpreadsheetApp.flush();
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + reg_token() } });
    var blob = resp.getBlob().setName('Soporte falta grave — ' + d.nombre + '.xlsx');
    var file = reg_carpeta(cfg).createFile(blob);
    reg_compartir(file, d.emails);
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
