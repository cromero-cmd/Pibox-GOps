// ── CONFIG ──
const FIREBASE_PROJECT = 'copper-eye-468704-f8';
const FIREBASE_REST = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents';
const MALLA_SHEET_NAME = 'Malla';
// Utilities.formatDate('MMMM') depende del locale del proyecto de Apps Script, que no siempre
// es español (ej. producía "July" en vez de "julio") — se usa este array fijo para no depender
// de esa configuración.
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const FOOTER_HTML = '<p style="color:#6b7280;font-size:12px;margin-top:24px;">Este mensaje fue generado automáticamente por Pi GOps · Pibox Operaciones</p>';

// ══ SEGURIDAD (v6, Fase 1) ══════════════════════════════════════════════════════════════════════════════════════
// Este despliegue es público (acceso anónimo): cualquiera con la URL puede llamar a doGet/doPost. Hasta que la app envíe
// el ID token de Firebase (Fase 4), la defensa es que NINGÚN correo salga hacia fuera del dominio:
//  • Todo destinatario debe ser un correo @pibox.app. Cualquier otro se RECHAZA (queda en el log como «RECHAZADO»).
//  • Una cadena con varios correos («a@pibox.app,x@otro.com») o con nombre («Nombre <x@otro.com>») también se rechaza: Gmail
//    entrega a todas las direcciones de una cadena separada por comas.
//  • Reporte de nómina: si existe la propiedad de script payroll_allowed_recipients (lista separada por comas), además solo
//    se envía a esas direcciones. Es lo que impide que un correo interno cualquiera reciba el Excel con cédulas.
function correoPibox_(valor) {
  var s = String(valor == null ? '' : valor).trim().toLowerCase();
  return /^[a-z0-9._%+\-]+@pibox\.app$/.test(s) ? s : '';
}
// Acepta un arreglo o una cadena separada por comas/punto y coma (propiedades del script). Devuelve {validos, rechazados}.
function filtrarDestinatarios_(lista, contexto) {
  var arr = Array.isArray(lista) ? lista : (typeof lista === 'string' ? lista.split(/[,;]/) : []);
  var validos = [], rechazados = [];
  arr.forEach(function (e) {
    var crudo = String(e == null ? '' : e).trim();
    if (!crudo) return;
    var ok = correoPibox_(crudo);
    if (!ok) { rechazados.push(crudo.slice(0, 80)); return; }
    if (validos.indexOf(ok) === -1) validos.push(ok);
  });
  if (rechazados.length) Logger.log('RECHAZADO (' + contexto + '): destinatarios que no son @pibox.app: ' + rechazados.join(' | '));
  return { validos: validos, rechazados: rechazados };
}
// Un solo correo (líder, coordinador). '' si no es válido.
function unCorreoPibox_(valor, contexto) {
  var f = filtrarDestinatarios_(valor ? [valor] : [], contexto);
  return f.validos[0] || '';
}
// Destinatarios del reporte de nómina: dominio + (si está definida) la lista blanca payroll_allowed_recipients.
function destinatariosNomina_(lista) {
  var f = filtrarDestinatarios_(lista, 'reporte de nómina');
  var permitidos = PropertiesService.getScriptProperties().getProperty('payroll_allowed_recipients');
  if (!permitidos || !permitidos.trim()) {
    Logger.log('AVISO: la propiedad payroll_allowed_recipients no está definida; el reporte de nómina solo se limita al dominio @pibox.app.');
    return f.validos;
  }
  var lista2 = filtrarDestinatarios_(permitidos, 'payroll_allowed_recipients').validos;
  var fuera = f.validos.filter(function (e) { return lista2.indexOf(e) === -1; });
  if (fuera.length) Logger.log('RECHAZADO (reporte de nómina): no están en payroll_allowed_recipients: ' + fuera.join(' | '));
  return f.validos.filter(function (e) { return lista2.indexOf(e) !== -1; });
}

// ── MODELO ANTIGUO DE STRIKES: DESACTIVADO (1-nov-2026) ──
// Desde el 1 de noviembre de 2026 el ÚNICO sistema que genera llamados de atención y notificaciones de proceso disciplinario es el
// Reglamento Interno (PiGOps_Reglamento.gs). El modelo viejo (strikes leve/moderada/grave/no desconexión → «Acción requerida — Llamado de
// atención #N» y «Proceso disciplinario requerido») ya no envía nada: ni desde la app (type=strike_warning / disciplinary_warning se
// rechazan en doGet/doPost, lo que también frena a las pestañas abiertas con una versión anterior de la app), ni desde el backfill manual
// (sendPendingStrikeAlerts/runStrikeAlerts, que quedan como avisos en el log por si algún disparador antiguo todavía los llama).
// Los strikes siguen mostrándose en Pi GOps solo como información (alerta temprana). No reactivar sin una decisión de Talento Humano.
function strikesModeloAntiguoDesactivado_(origen) {
  Logger.log('MODELO ANTIGUO DE STRIKES DESACTIVADO (' + origen + '): no se envía ningún llamado de atención ni proceso disciplinario; desde el 1-nov-2026 los llamados los genera solo el Reglamento.');
  return { ok: false, error: 'El modelo antiguo de strikes está desactivado desde el 1-nov-2026; los llamados de atención los genera el Reglamento.' };
}
function sendStrikeWarning() { strikesModeloAntiguoDesactivado_('sendStrikeWarning'); return false; }
function sendDisciplinaryWarning() { strikesModeloAntiguoDesactivado_('sendDisciplinaryWarning'); return false; }
function sendPendingStrikeAlerts() { strikesModeloAntiguoDesactivado_('sendPendingStrikeAlerts'); }
function runStrikeAlerts() { sendPendingStrikeAlerts(); }

// ── MAIN HANDLER ──
function doPost(e) {
  try {
    const type = e.parameter.type;
    const body = e.postData ? e.postData.contents : '';
    Logger.log('doPost type: ' + type + ' body length: ' + body.length);
    if (type === 'payroll_report' && body) {
      const data = JSON.parse(body);
      // sendPayrollReport valida los destinatarios ANTES de crear el Sheet; aquí solo se guarda (ya filtrado) el último uso.
      const destinosNomina = destinatariosNomina_(data.recipients);
      if (destinosNomina.length > 0) {
        PropertiesService.getScriptProperties().setProperty('payroll_recipients', destinosNomina.join(','));
      }
      sendPayrollReport(data);
      Logger.log('Payroll report sent OK');
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log('doPost ERROR: ' + err.message);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const type = e.parameter.type;
  const payload = e.parameter.data;

  Logger.log('type: ' + type);
  Logger.log('payload length: ' + (payload ? payload.length : 'null'));

  try {
    const data = JSON.parse(decodeURIComponent(payload));

    if (type === 'overtime_request') {
      sendOvertimeNotification(data);
    } else if (type === 'strike_warning' || type === 'disciplinary_warning') {
      // Modelo antiguo de strikes desactivado desde el 1-nov-2026: se rechaza (también lo que llegue de pestañas con una versión vieja).
      const r = strikesModeloAntiguoDesactivado_(type);
      return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
    } else if (type === 'overtime_rejected') {
      // v6: solo avisa al coordinador. Antes llamaba también a sendPayrollReport(data) (resto de una versión vieja): como el aviso
      // no trae «records», cada rechazo final del Super Admin enviaba al coordinador un Excel de nómina VACÍO y pisaba
      // payroll_recipients con su correo.
      sendOvertimeRejectedNotification(data);
    } else if (type === 'save_config') {
      // v6: ninguna lista de correos se guarda si no es @pibox.app (y una lista sin ningún correo válido NO borra la anterior).
      const props = PropertiesService.getScriptProperties();
      const guardarLista = function (campo, propiedad) {
        if (!data[campo]) return;
        const f = filtrarDestinatarios_(data[campo], 'save_config ' + campo);
        if (f.validos.length) props.setProperty(propiedad, f.validos.join(','));
        else Logger.log('save_config: ' + campo + ' no tiene ningún correo @pibox.app; se conserva el valor anterior.');
      };
      guardarLista('payrollRecipients', 'payroll_recipients');
      guardarLista('reminderRecipients', 'reminder_recipients');
      guardarLista('adminEmails', 'admin_emails');
      const cutDay = Number(data.cutDay), cutHour = Number(data.cutHour), delay = Number(data.mallaNotifDelay);
      if (data.cutDay !== undefined && Number.isInteger(cutDay) && cutDay >= 0 && cutDay <= 6) props.setProperty('payroll_cut_day', String(cutDay));
      if (data.cutHour !== undefined && Number.isInteger(cutHour) && cutHour >= 0 && cutHour <= 23) props.setProperty('payroll_cut_hour', String(cutHour));
      if (data.mallaNotifDelay !== undefined && Number.isFinite(delay) && delay >= 10 && delay <= 1440) props.setProperty('malla_notif_delay', String(Math.round(delay)));
      Logger.log('Config saved');
    }

    Logger.log('Done OK');
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log('ERROR: ' + err.message);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── OVERTIME REJECTED NOTIFICATION ──
function sendOvertimeRejectedNotification(data) {
  const agentName = data.agentName || '—';
  const agentEmail = data.agentEmail || '—';
  const date = data.date || '—';
  const extraMins = data.extraMins || 0;
  const reason = data.reason || '(Sin motivo especificado)';
  const coordinatorEmail = unCorreoPibox_(data.coordinatorEmail, 'overtime_rejected coordinador');
  const extraH = Math.floor(extraMins / 60), extraM = extraMins % 60;
  const extraStr = extraH > 0 ? extraH + 'h ' + (extraM > 0 ? extraM + 'm' : '') : extraM + 'm';

  const subject = '❌ Horas extras rechazadas: ' + agentName + ' — ' + date;
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<div style="background:#f87171;padding:16px;border-radius:8px 8px 0 0;">' +
    '<h2 style="color:white;margin:0;">❌ Solicitud de horas extras rechazada</h2></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' +
    '<p>La solicitud de horas extras del siguiente colaborador fue <strong>rechazada</strong> por el Super Admin:</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
    '<tr><td style="padding:8px;background:#f9fafb;font-weight:bold;">Colaborador</td><td style="padding:8px;">' + agentName + ' (' + agentEmail + ')</td></tr>' +
    '<tr><td style="padding:8px;background:#f9fafb;font-weight:bold;">Fecha</td><td style="padding:8px;">' + date + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f9fafb;font-weight:bold;">Horas extras</td><td style="padding:8px;">' + extraStr + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f9fafb;font-weight:bold;">Motivo del rechazo</td><td style="padding:8px;color:#dc2626;">' + reason + '</td></tr>' +
    '</table>' +
    '<p style="color:#6b7280;font-size:13px;">Por favor comunica esta decisión al colaborador.</p>' +
    '</div></div>';

  if (coordinatorEmail) {
    GmailApp.sendEmail(coordinatorEmail, subject, '', { htmlBody: htmlBody, cc: 'cromero@pibox.app' });
    Logger.log('Overtime rejected notification sent to: ' + coordinatorEmail);
  }
}

// ── OVERTIME NOTIFICATION ──
function sendOvertimeNotification(data) {
  const agentName = data.agentName || '—';
  const agentEmail = data.agentEmail || '—';
  const date = data.date || '—';
  const scheduledHours = data.scheduledHours || '—';
  const workedHours = data.workedHours || '—';
  const extraHours = data.extraHours || '—';
  const recipients = filtrarDestinatarios_(data.recipients, 'overtime_request').validos;
  if (recipients.length === 0) throw new Error('overtime_request sin destinatarios @pibox.app válidos');

  const subject = 'Solicitud de horas extras - ' + agentName + ' - ' + date;
  const body = 'Hola,\n\nSe ha registrado una solicitud de aprobacion de horas extras en Pi GOps.\n\nColaborador: ' + agentName + ' (' + agentEmail + ')\nFecha: ' + date + '\nHoras programadas: ' + scheduledHours + '\nHoras trabajadas: ' + workedHours + '\nHoras extras: ' + extraHours + '\n\nEl colaborador indica que estas horas fueron aprobadas por su lider inmediato.\n\nPor favor ingresa a Pi GOps - Turno - Panel de control - Horas extras para aprobar o rechazar.\n\n---\nPi GOps - Pibox Operaciones';

  recipients.forEach(function(email) {
    GmailApp.sendEmail(email, subject, body);
  });
}

// ── PAYROLL REPORT ──
function sendPayrollReport(data) {
  const weekStart = data.weekStart || '—';
  const weekEnd = data.weekEnd || '—';
  const records = data.records || [];
  // v6: dominio + lista blanca, ANTES de crear el Sheet o leer las cédulas de BASE 3.0.
  const recipients = destinatariosNomina_(data.recipients);
  if (recipients.length === 0) throw new Error('Reporte de nómina sin destinatarios válidos (solo @pibox.app' + (PropertiesService.getScriptProperties().getProperty('payroll_allowed_recipients') ? ' y payroll_allowed_recipients' : '') + ')');

  const ss = SpreadsheetApp.create('Reporte_Nomina_Temp');
  const sheet = ss.getActiveSheet();
  sheet.setName('Nomina');

  // Cargar cédulas desde BASE 3.0
  const agentDataMap = getAgentDataMap();

  function toMilitar(t) {
    if (!t || t === '—' || t === '00:00') return t;
    const str = t.toLowerCase().replace(/\.\s*/g, '').replace(/\s+/g, ' ').trim();
    const isPM = str.includes('pm') || str.includes('p m');
    const isAM = str.includes('am') || str.includes('a m');
    const cleaned = str.replace(/[ap]\s*m/g, '').trim();
    const parts = cleaned.split(':');
    if (parts.length < 2) return t;
    let h = parseInt(parts[0]), m = parseInt(parts[1]);
    if (isNaN(h) || isNaN(m)) return t;
    if (isPM && h !== 12) h += 12;
    if (isAM && h === 12) h = 0;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }

  const headers = ['Cédula', 'Nombre', 'Fecha', 'Entrada', 'Salida', 'Almuerzo', 'Horas trabajadas', 'Novedad'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#7B2FFF');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(11);

  if (records.length > 0) {
    const rows = records.map(function(r) {
      const agentData = agentDataMap[r.email] || {};
      return [
        agentData.cedula || '—',
        r.name || '—',
        r.date || '—',
        toMilitar(r.checkIn==='—'||!r.checkIn?'00:00':r.checkIn),
        toMilitar(r.checkOut==='—'||!r.checkOut?'00:00':r.checkOut),
        r.almuerzo==='—'||!r.almuerzo?'0h':r.almuerzo,
        r.hours==='—'||r.hours==='Sin registro'||!r.hours?'00:00:00':r.hours,
        r.novedad || '—'
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    for (var i = 2; i <= rows.length + 1; i++) {
      if (i % 2 === 0) {
        sheet.getRange(i, 1, 1, headers.length).setBackground('#F3F0FF');
      }
    }
  }

  for (var col = 1; col <= headers.length; col++) {
    sheet.autoResizeColumn(col);
  }

  // ── HOJA 2: RESUMEN SEMANAL ──
  const extrasByAgent = data.extrasByAgent || {};
  const agentMap = {};
  records.forEach(function(r) {
    const key = r.name;
    if (!agentMap[key]) agentMap[key] = { totalSecs: 0, email: r.email || '' };
    if (r.hours && r.hours !== '—' && r.hours !== 'Sin registro' && r.hours !== '00:00:00') {
      const parts = r.hours.split(':');
      if (parts.length === 3) {
        agentMap[key].totalSecs += parseInt(parts[0])*3600 + parseInt(parts[1])*60 + parseInt(parts[2]);
      }
    }
  });

  function secsToHm(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
  }

  const summarySheet = ss.insertSheet('Resumen');
  const summaryHeaders = ['Cédula', 'Nombre', 'Semana', 'Total Horas Trabajadas', 'Total Extras'];
  summarySheet.getRange(1, 1, 1, summaryHeaders.length).setValues([summaryHeaders]);
  const summaryHeaderRange = summarySheet.getRange(1, 1, 1, summaryHeaders.length);
  summaryHeaderRange.setBackground('#7B2FFF');
  summaryHeaderRange.setFontColor('#FFFFFF');
  summaryHeaderRange.setFontWeight('bold');
  summaryHeaderRange.setFontSize(11);

  const semana = weekStart + ' — ' + weekEnd;
  // Horas legales según la semana reportada (no la fecha actual)
  // 44h hasta el 14 jul 2026, 42h desde el 15 jul 2026
  var weekEndDate = new Date(weekEnd.replace(/(\d{2})-([a-z]{3})-(\d{4})/i, function(m, d, mon, y) {
    var meses = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,oct:9,nov:10,'dic':11};
    return y + '-' + String(meses[mon.toLowerCase()] + 1).padStart(2,'0') + '-' + d;
  }));
  var cutoffDate = new Date('2026-07-15');
  var horasLegales = (weekEndDate >= cutoffDate) ? 42 : 44;
  var horasLegalesSecs = horasLegales * 3600;

  const summaryRows = Object.keys(agentMap).sort().map(function(name) {
    const totalSecs = agentMap[name].totalSecs;
    const extraSecs = Math.max(0, totalSecs - horasLegalesSecs);
    const extraStr = extraSecs > 0 ? secsToHm(extraSecs) : '0h';
    const agentData = agentDataMap[agentMap[name].email] || {};
    return [agentData.cedula||'—', name, semana, secsToHm(totalSecs), extraStr];
  });

  if (summaryRows.length > 0) {
    summarySheet.getRange(2, 1, summaryRows.length, summaryHeaders.length).setValues(summaryRows);
    for (var i = 2; i <= summaryRows.length + 1; i++) {
      if (i % 2 === 0) summarySheet.getRange(i, 1, 1, summaryHeaders.length).setBackground('#F3F0FF');
    }
  }
  for (var c = 1; c <= summaryHeaders.length; c++) summarySheet.autoResizeColumn(c);

  SpreadsheetApp.flush();
  Utilities.sleep(2000);

  const ssId = ss.getId();
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const fileName = 'reporte_nomina_' + weekStart.replace(/ /g, '_') + '_al_' + weekEnd.replace(/ /g, '_') + '.xlsx';
  const xlsxBlob = response.getBlob().setName(fileName);

  DriveApp.getFileById(ssId).setTrashed(true);

  const subject = 'Reporte de nomina Operaciones - Semana del ' + weekStart + ' al ' + weekEnd;
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<p>Hola,</p>' +
    '<p>Esperamos que se encuentren muy bien. Adjunto encontraran el reporte de horarios del area de Operaciones correspondiente a la semana del <strong>' + weekStart + '</strong> al <strong>' + weekEnd + '</strong>.</p>' +
    '<p>Este reporte incluye los registros de entrada, salida, horas trabajadas y novedades de cada colaborador durante el periodo indicado.</p>' +
    '<p>Quedamos atentos a cualquier duda o inquietud que pueda surgir al respecto.</p>' +
    '<br/><p>Saludos,<br/><strong>Pibox Operaciones</strong></p>' +
    '</div>';

  recipients.forEach(function(email) {
    GmailApp.sendEmail(email, subject, '', {
      htmlBody: htmlBody,
      attachments: [xlsxBlob]
    });
  });
}

// ── WEEKLY REMINDER ──
function sendWeeklyPayrollAuto() {
  const props = PropertiesService.getScriptProperties();
  const reminderStr = props.getProperty('reminder_recipients') || 'cromero@pibox.app';
  var recipients = filtrarDestinatarios_(reminderStr, 'reminder_recipients').validos;
  if (recipients.length === 0) recipients = ['cromero@pibox.app'];
  const cutDay = parseInt(props.getProperty('payroll_cut_day') || '1');

  const now = new Date();
  const lastWeekEnd = new Date(now);
  lastWeekEnd.setDate(now.getDate() - now.getDay() - (7 - cutDay) % 7);
  lastWeekEnd.setHours(23, 59, 59, 0);
  const lastWeekStart = new Date(lastWeekEnd);
  lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
  lastWeekStart.setHours(0, 0, 0, 0);

  const weekStart = Utilities.formatDate(lastWeekStart, 'America/Bogota', "d 'de' MMMM 'de' yyyy");
  const weekEnd = Utilities.formatDate(lastWeekEnd, 'America/Bogota', "d 'de' MMMM 'de' yyyy");

  Logger.log('Auto reminder to: ' + reminderStr);

  const subject = 'Recordatorio: Reporte de nomina pendiente - Semana del ' + weekStart + ' al ' + weekEnd;
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<p>Hola,</p>' +
    '<p>Este es un recordatorio automatico: el reporte de nomina de la semana del <strong>' + weekStart + '</strong> al <strong>' + weekEnd + '</strong> esta pendiente de envio.</p>' +
    '<p>Por favor ingresa a <strong>Pi GOps → Turno → Panel de control → Enviar reporte nomina</strong> para generar y enviar el reporte completo.</p>' +
    '<br/><p>Saludos,<br/><strong>Pi GOps · Pibox Operaciones</strong></p>' +
    '</div>';

  const to = recipients[0];
  const cc = recipients.slice(1).join(',');
  GmailApp.sendEmail(to, subject, '', {
    htmlBody: htmlBody,
    cc: cc || undefined
  });

  Logger.log('Reminder sent OK to ' + recipients.length + ' recipients');
}

// ── ATTENDANCE NOTIFICATIONS (runs every 10 min via trigger) ──
function checkAttendance() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const adminEmailsStr = props.getProperty('admin_emails') || 'cromero@pibox.app';
  var adminEmails = filtrarDestinatarios_(adminEmailsStr, 'admin_emails').validos;
  if (adminEmails.length === 0) adminEmails = ['cromero@pibox.app'];

  // Get today's malla
  const ss = SpreadsheetApp.openById(getMallaSheetId());
  if (!ss) { Logger.log('No malla sheet found'); return; }
  const sheet = ss.getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) { Logger.log('No Malla sheet tab found'); return; }

  const data = sheet.getDataRange().getDisplayValues();
  // La fecha de la malla es SIEMPRE día/mes/año. Se compara la fecha ya interpretada (nunca texto contra texto): antes (hasta 5-nov-2026)
  // se aceptaba también el formato M/d/yyyy, y del 1 al 12 de cada mes «hoy» coincidía con el día 11 de otro mes (el 5-nov = «11/5/2026» = 11 de mayo).
  const todayISO = Utilities.formatDate(now, 'America/Bogota', 'yyyy-MM-dd');
  const today = mallaFechaTexto_(todayISO);
  Logger.log('Looking for date: ' + today + ' (' + todayISO + ')');

  // Retirados: nunca se alerta ni se escribe a quien ya no trabaja, aunque siga apareciendo en la malla. FALLA SEGURA: si no se puede leer
  // BASE 3.0 no se sabe quién está retirado → no se envía nada en esta ejecución (igual que con la lectura de turnos).
  const retirados = leerRetirados_(todayISO);
  if (!retirados.ok) {
    Logger.log('checkAttendance ABORTADA: no se pudo leer BASE 3.0 para excluir retirados — ' + retirados.motivo + '. No se envió ninguna alerta de ausencia.');
    avisoTecnicoAsistencia_('no se pudo leer BASE 3.0 para excluir a los retirados (' + retirados.motivo + ')', now);
    return;
  }

  // Get today's entries
  const seleccion = asistenciaFilasDeDia_(data, todayISO, retirados.set);
  const todayEntries = seleccion.tomadas;
  seleccion.excluidas.forEach(function(x) {
    if (x.motivo === 'retirado') Logger.log('Se ignora a ' + x.usuario + ': figura como retirado (' + (retirados.origen[String(x.usuario).toLowerCase()] || 'BASE 3.0') + ').');
  });

  if (!todayEntries.length) { Logger.log('No entries for today: ' + today); return; }
  Logger.log('Checking ' + todayEntries.length + ' entries for today');

  // Build leader email map from BASE 3.0
  const liderEmailMap = getLiderEmailMap();

  // Caché de notificaciones del día
  const notifiedStr = props.getProperty('attendance_notified_today') || '';
  let notifiedData = notifiedStr ? JSON.parse(notifiedStr) : {};
  const todayKey = Utilities.formatDate(now, 'America/Bogota', 'yyyy-MM-dd');
  if (notifiedData._date !== todayKey) {
    notifiedData = { _date: todayKey };
    Logger.log('Reset attendance cache for new day: ' + todayKey);
  }
  const notified = notifiedData;

  // Get active turnos from Firebase. FALLA SEGURA: si la lectura falla (HTTP != 200, cuerpo inválido, error dentro del arreglo,
  // excepción) NO se envía ninguna alerta de ausencia y NO se toca el estado de «ya notificados»: una lectura fallida nunca
  // significa «nadie inició turno». Se avisa a cromero (un solo correo técnico por hora).
  const lectura = leerTurnosHoyRest_(now);
  if (!lectura.ok) {
    Logger.log('checkAttendance ABORTADA: no se pudo verificar la asistencia — ' + lectura.motivo + '. No se envió ninguna alerta de ausencia.');
    avisoTecnicoAsistencia_(lectura.motivo, now);
    return;
  }
  const activeTurnos = lectura.emails;
  const activosMin = {};
  activeTurnos.forEach(function(e) { activosMin[String(e).trim().toLowerCase()] = true; });
  Logger.log('Active turnos found: ' + activeTurnos.length);

  // Mark already-connected agents in cache to avoid re-sending alerts
  activeTurnos.forEach(function(email) {
    if (!notified[email]) {
      notified[email] = { n10: true, n20: true, n60: true };
    }
  });

  // Resolve leader emails
  todayEntries.forEach(function(entry) {
    if (entry.lider && !entry.lider.includes('@')) {
      entry.liderEmail = liderEmailMap[entry.lider] || '';
      if (!entry.liderEmail) Logger.log('No email found for leader: ' + entry.lider);
    } else {
      entry.liderEmail = entry.lider || '';
    }
  });

  // Check each entry
  todayEntries.forEach(function(entry) {
    const scheduledStart = parseTimeToDate(entry.inicio, now);
    if (!scheduledStart) return;

    const minsLate = Math.round((now - scheduledStart) / 60000);
    if (minsLate <= 5) return; // within tolerance, skip

    // Check if already connected
    // (sin distinguir mayúsculas: «Ana@…» en la malla y «ana@…» en Firestore son la misma persona)
    const isConnected = !!activosMin[String(entry.usuario).trim().toLowerCase()];
    if (isConnected) {
      // Clear notifications for this user
      if (notified[entry.usuario]) {
        delete notified[entry.usuario];
        props.setProperty('attendance_notified_today', JSON.stringify(notified));
      }
      return;
    }

    // Determine which notifications to send
    const userNotified = notified[entry.usuario] || { n10: false, n20: false, n60: false };

    if (minsLate >= 10 && minsLate < 20 && !userNotified.n10) {
      sendAttendanceAlert(entry, minsLate, adminEmails, 1);
      userNotified.n10 = true;
      Logger.log('Sent T+10 alert for ' + entry.usuario);
    } else if (minsLate >= 20 && minsLate < 60 && !userNotified.n20) {
      sendAttendanceAlert(entry, minsLate, adminEmails, 2);
      userNotified.n20 = true;
      Logger.log('Sent T+20 alert for ' + entry.usuario);
    } else if (minsLate >= 60 && !userNotified.n60) {
      sendAttendanceAlert(entry, minsLate, adminEmails, 3);
      userNotified.n60 = true;
      Logger.log('Sent T+60 alert for ' + entry.usuario);
    }

    notified[entry.usuario] = userNotified;
  });

  props.setProperty('attendance_notified_today', JSON.stringify(notified));

  // Reset at midnight
  const hour = parseInt(Utilities.formatDate(now, 'America/Bogota', 'HH'));
  if (hour === 0) {
    props.deleteProperty('attendance_notified_today');
    Logger.log('Reset attendance notifications for new day');
  }
}

// Aviso técnico a cromero cuando checkAttendance no puede verificar la asistencia: como máximo UNO por hora (propiedad
// attendance_fail_notified_at). Si el correo mismo falla, solo queda en el log.
function avisoTecnicoAsistencia_(motivo, now) {
  var props = PropertiesService.getScriptProperties();
  var ultimo = parseInt(props.getProperty('attendance_fail_notified_at') || '0', 10);
  if (ultimo && now.getTime() - ultimo < 3600000) {
    Logger.log('Aviso técnico omitido: ya se envió uno hace ' + Math.round((now.getTime() - ultimo) / 60000) + ' min (máximo uno por hora).');
    return false;
  }
  try {
    var html = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
      '<div style="background:#dc2626;padding:16px;border-radius:8px 8px 0 0;"><h2 style="color:white;margin:0;font-size:18px;">⚠️ No se pudo verificar la asistencia</h2></div>' +
      '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' +
      '<p><strong>No se pudo verificar la asistencia:</strong> ' + escHtml_(motivo) + '</p>' +
      '<p>En esta ejecución <strong>no se envió ninguna alerta de ausencia</strong> (una lectura fallida nunca se interpreta como «nadie inició turno»). ' +
      'Se reintentará en la próxima ejecución; este aviso técnico se envía como máximo una vez por hora.</p>' +
      '<p style="color:#6b7280;font-size:13px;">Detalle (código y cuerpo de la respuesta) en Apps Script → Ejecuciones → checkAttendance.</p>' +
      FOOTER_HTML + '</div></div>';
    GmailApp.sendEmail('cromero@pibox.app', 'No se pudo verificar la asistencia: ' + String(motivo).slice(0, 120), '', { htmlBody: html, name: 'Pi GOps' });
    props.setProperty('attendance_fail_notified_at', String(now.getTime()));
    Logger.log('Aviso técnico enviado a cromero@pibox.app: ' + motivo);
    return true;
  } catch (e) {
    Logger.log('No se pudo enviar el aviso técnico: ' + e.message);
    return false;
  }
}
function escHtml_(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// «9:00:00» / «14:30» / «9:00 AM» → «9:00 a. m.» / «2:30 p. m.» (formato colombiano, sin segundos). Si no se entiende, se devuelve tal cual.
function horaColombiana_(texto) {
  var s = String(texto || '').trim();
  var low = s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  var m = low.match(/(\d{1,2}):(\d{2})/);
  if (!m) return s;
  var h = parseInt(m[1], 10), mi = m[2];
  if (/\bp ?m\b/.test(low) && h !== 12) h += 12;
  if (/\ba ?m\b/.test(low) && h === 12) h = 0;
  return (h % 12 === 0 ? 12 : h % 12) + ':' + mi + (h < 12 ? ' a. m.' : ' p. m.');
}
function filaAlerta_(etiqueta, valor) {
  return '<tr><td style="padding:8px 12px;border:1px solid #ddd;background:#f9fafb;font-weight:bold;width:38%;">' + etiqueta + '</td><td style="padding:8px 12px;border:1px solid #ddd;">' + valor + '</td></tr>';
}
function sendAttendanceAlert(entry, minsLate, adminEmails, level) {
  const levelLabel = level === 1 ? 'Primer aviso (+10 min)' : level === 2 ? 'Segundo aviso (+20 min)' : 'Aviso final (+60 min)';
  // Encabezado según el nivel: amarillo (+10), naranja (+20), rojo (+60)
  const color = level === 1 ? { bg: '#eab308', fg: '#1f2937' } : level === 2 ? { bg: '#fb923c', fg: '#ffffff' } : { bg: '#dc2626', fg: '#ffffff' };
  const subject = 'Ausencia en turno: ' + entry.nombre + ' — ' + levelLabel;
  const inicioTxt = horaColombiana_(entry.inicio);
  const nombre = escHtml_(entry.nombre), correo = escHtml_(entry.usuario);
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<div style="background:' + color.bg + ';padding:16px;border-radius:8px 8px 0 0;"><h2 style="color:' + color.fg + ';margin:0;font-size:18px;">Ausencia en turno — ' + levelLabel + '</h2></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' +
    '<p>Hola,</p>' +
    '<p>El colaborador <strong>' + nombre + '</strong> aún no ha iniciado su turno programado.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">' +
    filaAlerta_('Colaborador', nombre) +
    filaAlerta_('Correo', '<a href="mailto:' + correo + '">' + correo + '</a>') +
    filaAlerta_('Turno programado', inicioTxt) +
    filaAlerta_('Minutos de retraso', minsLate + ' minutos') +
    filaAlerta_('Nivel del aviso', levelLabel) +
    '</table>' +
    '<p>Por favor verifica la situación del colaborador.</p>' +
    FOOTER_HTML + '</div></div>';

  // Notify only the agent's direct leader, fallback to all admins
  var liderEmail = entry.liderEmail ? entry.liderEmail.trim() : (entry.lider && entry.lider.includes('@') ? entry.lider.trim() : '');
  const SUPER_ADMIN_EMAIL = 'cromero@pibox.app';
  if (liderEmail) {
    // cc Super Admin unless lider IS Super Admin
    const cc = liderEmail !== SUPER_ADMIN_EMAIL ? SUPER_ADMIN_EMAIL : '';
    GmailApp.sendEmail(liderEmail, subject, '', { htmlBody: htmlBody, cc: cc || undefined, name: 'Pi GOps' });
    Logger.log('Alert sent to leader: ' + liderEmail + (cc ? ' (cc: ' + cc + ')' : ''));
  } else if (adminEmails.length > 0) {
    const to = adminEmails[0];
    const others = adminEmails.slice(1).concat([SUPER_ADMIN_EMAIL]).filter(function(e){return e!==to;});
    GmailApp.sendEmail(to, subject, '', { htmlBody: htmlBody, cc: others.join(',') || undefined, name: 'Pi GOps' });
    Logger.log('No leader found, alert sent to all admins');
  }

  // Always notify the agent directly (mismo destinatario y mismo asunto; solo cambia el formato)
  const agentSubject = 'Recordatorio: Tu turno comenzó hace ' + minsLate + ' minutos';
  const agentBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<div style="background:' + color.bg + ';padding:16px;border-radius:8px 8px 0 0;"><h2 style="color:' + color.fg + ';margin:0;font-size:18px;">Recordatorio: tu turno ya comenzó</h2></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' +
    '<p>Hola ' + nombre + ',</p>' +
    '<p>Tu turno estaba programado para las <strong>' + inicioTxt + '</strong> y aún no has registrado tu ingreso en Pi GOps.</p>' +
    '<p>Por favor ingresa a <strong>Pi GOps</strong> e inicia tu turno a la brevedad.</p>' +
    '<p>Si tienes alguna novedad, informa a tu líder inmediato.</p>' +
    FOOTER_HTML + '</div></div>';
  GmailApp.sendEmail(entry.usuario, agentSubject, '', { htmlBody: agentBody, name: 'Pi GOps' });
}

// ── SHIFT START REMINDER (runs every 10 min via trigger) ──
function sendShiftReminders() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();

  const ss = SpreadsheetApp.openById(getMallaSheetId());
  if (!ss) return;
  const sheet = ss.getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getDisplayValues();
  const todayISO = Utilities.formatDate(now, 'America/Bogota', 'yyyy-MM-dd');

  // Sin lista de retirados no se sabe a quién NO recordarle: se omite esta ejecución (el siguiente ciclo reintenta).
  const retirados = leerRetirados_(todayISO);
  if (!retirados.ok) { Logger.log('sendShiftReminders omitido: no se pudo leer BASE 3.0 para excluir retirados — ' + retirados.motivo); return; }

  const reminderSentStr = props.getProperty('shift_reminders_sent') || '';
  const reminderSent = reminderSentStr ? JSON.parse(reminderSentStr) : {};

  const filasHoy = asistenciaFilasDeDia_(data, todayISO, retirados.set).tomadas;
  for (var i = 0; i < filasHoy.length; i++) {
    const usuario = filasHoy[i].usuario;
    const nombre = filasHoy[i].nombre;
    const inicio = filasHoy[i].inicio;

    const scheduledStart = parseTimeToDate(inicio, now);
    if (!scheduledStart) continue;

    const minsUntil = Math.round((scheduledStart - now) / 60000);

    // Send reminder 10 min before start
    if (minsUntil >= 8 && minsUntil <= 12 && !reminderSent[usuario]) {
      const subject = 'Recordatorio: Tu turno comienza en 10 minutos';
      const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
        '<p>Hola ' + nombre + ',</p>' +
        '<p>Tu turno esta programado para las <strong>' + inicio + '</strong>, es decir, en aproximadamente <strong>10 minutos</strong>.</p>' +
        '<p>Recuerda ingresar a <strong>Pi GOps</strong> e iniciar tu turno a tiempo.</p>' +
        '<br/><p>Saludos,<br/><strong>Pi GOps · Pibox Operaciones</strong></p>' +
        '</div>';
      GmailApp.sendEmail(usuario, subject, '', { htmlBody: htmlBody });
      reminderSent[usuario] = true;
      Logger.log('Shift reminder sent to ' + usuario);
    }
  }

  props.setProperty('shift_reminders_sent', JSON.stringify(reminderSent));

  // Reset at midnight
  const hour = parseInt(Utilities.formatDate(now, 'America/Bogota', 'HH'));
  if (hour === 0) {
    props.deleteProperty('shift_reminders_sent');
  }
}

// ── FECHAS DE LA MALLA Y FILAS DEL DÍA ──
// La malla (hoja «Malla», columna B) usa SIEMPRE día/mes/año. Una sola función la interpreta; ningún código compara fechas de la malla como
// texto contra un formato de Utilities.formatDate. Causa de las falsas alertas del 4 y 5-nov-2026: checkAttendance aceptaba también
// 'M/d/yyyy', y del 1 al 12 de cada mes «hoy» coincidía con el día 11 de otro mes (5-nov → «11/5/2026» = 11 de mayo).
function mallaPad_(n) { return (n < 10 ? '0' : '') + n; }
// «5/11/2026», «05/11/2026», «05-11-2026», «05.11.26» (día primero) o «2026-11-05» (ISO, sin ambigüedad) → 'yyyy-MM-dd'; null si no es una fecha real.
function mallaFechaISO_(texto) {
  var s = String(texto == null ? '' : texto).trim(), m, d, mo, y;
  if (!s) return null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return y + '-' + mallaPad_(mo) + '-' + mallaPad_(d);
}
// 'yyyy-MM-dd' → 'dd/MM/yyyy' (para los logs y la comparación humana)
function mallaFechaTexto_(iso) { var p = String(iso).split('-'); return mallaPad_(+p[2]) + '/' + mallaPad_(+p[1]) + '/' + p[0]; }

// Filas de la malla que corresponden al día `diaISO`, ya separadas en tomadas y excluidas (con el motivo). Pura: no lee ni envía nada;
// la usan checkAttendance, sendShiftReminders y los diagnósticos, así que el diagnóstico muestra exactamente lo que toma el script.
// data = getDisplayValues() de «Malla» (fila 0 = encabezados; B fecha, C usuario, D nombre, F inicio, J líder, K novedad).
// retirados = {correoEnMinúsculas: true}
function asistenciaFilasDeDia_(data, diaISO, retirados) {
  var tomadas = [], excluidas = [];
  retirados = retirados || {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (mallaFechaISO_(row[1]) !== diaISO) continue;
    var usuario = row[2] ? String(row[2]).trim() : '';
    var nombre = row[3] ? String(row[3]).trim() : '';
    var inicio = row[5] ? String(row[5]).trim() : '';
    var lider = row[9] ? String(row[9]).trim() : '';
    var novedad = row[10] ? String(row[10]).trim() : '';
    var base = { fila: i + 1, fecha: String(row[1] || '').trim(), usuario: usuario, nombre: nombre, inicio: inicio, lider: lider, novedad: novedad };
    if (!usuario) { base.motivo = 'sin usuario'; excluidas.push(base); continue; }
    if (!inicio) { base.motivo = 'sin hora de inicio'; excluidas.push(base); continue; }
    if (novedad) { base.motivo = 'con novedad «' + novedad + '»'; excluidas.push(base); continue; }
    if (retirados[usuario.toLowerCase()]) { base.motivo = 'retirado'; excluidas.push(base); continue; }
    tomadas.push(base);
  }
  return { tomadas: tomadas, excluidas: excluidas };
}

// ── BASE 3.0 ──
// Estructura real: fila 1 vacía; fila 2 con «VACACIONES» combinada sobre L–O; los encabezados están en la fila 3 y los datos empiezan en la 4
// (B OPERADOR, C TIPO DE DOC., D DOCUMENTO, E NOMBRE, F CARGO, G CORREO, H ROL TRUMP, I LÍDER INMEDIATO, J ciudad, K dirección, L–O fechas
// de vacaciones, P LÍNEA DE EXPERIENCIA). La fila de encabezados NO se supone: se busca la primera fila (de las primeras BASE3_FILAS_BUSQUEDA)
// que tenga una celda «CORREO», así no se rompe si alguien agrega o quita filas arriba. Cada columna se ubica por su encabezado; si falta el
// de NOMBRE, CARGO o DOCUMENTO se usa su posición habitual (E, F, D). Sin fila de encabezados reconocible → ok:false (nadie debe tratarlo
// como «hoja vacía»).
var BASE3_FILAS_BUSQUEDA = 30;
function normEncabezado_(v) { return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
// Devuelve {ok, motivo, filaEncabezados (1 = primera fila de la hoja), encabezados:[texto], col:{correo,nombre,cargo,documento}, filas:[{fila (número de fila en la hoja), v:[celdas]}]}
function base3Leer_() {
  var res = { ok: false, motivo: '', filaEncabezados: 0, encabezados: [], col: {}, filas: [] };
  try {
    var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName('BASE 3.0');
    if (!sheet) { res.motivo = 'no se encontró la hoja BASE 3.0'; return res; }
    var data = sheet.getDataRange().getValues();
    var h = -1;
    for (var i = 0; i < data.length && i < BASE3_FILAS_BUSQUEDA; i++) {
      if (data[i].some(function (c) { return normEncabezado_(c) === 'correo'; })) { h = i; break; }
    }
    if (h < 0) { res.motivo = 'no se encontró la fila de encabezados de BASE 3.0 (una fila con «CORREO» en las primeras ' + BASE3_FILAS_BUSQUEDA + ' filas)'; return res; }
    var enc = data[h].map(normEncabezado_);
    var buscar = function (nombres, defecto) { for (var k = 0; k < nombres.length; k++) { var ix = enc.indexOf(nombres[k]); if (ix >= 0) return ix; } return defecto; };
    res.col = { correo: enc.indexOf('correo'), nombre: buscar(['nombre', 'nombres'], 4), cargo: buscar(['cargo'], 5), documento: buscar(['documento', 'cedula', 'numero de documento'], 3) };
    res.filaEncabezados = h + 1;
    res.encabezados = data[h].map(function (c) { return String(c == null ? '' : c).trim(); });
    for (var j = h + 1; j < data.length; j++) res.filas.push({ fila: j + 1, v: data[j] });
    res.ok = true;
    return res;
  } catch (e) {
    res.motivo = 'excepción al leer BASE 3.0: ' + e.message;
    return res;
  }
}

// ── RETIRADOS ──
// Un agente está RETIRADO cuando su CARGO en BASE 3.0 es «INACTIVO» (sin distinguir mayúsculas, tildes ni espacios). Además, la propiedad de
// script `agentes_retirados` (correos separados por coma) permite marcar a mano a alguien que BASE 3.0 todavía no refleje.
function cargoEsInactivo_(cargo) { return normEncabezado_(cargo).replace(/ /g, '') === 'inactivo'; }
function retiradosManuales_() {
  var out = {};
  (PropertiesService.getScriptProperties().getProperty('agentes_retirados') || '').split(/[,;\n]/).forEach(function (e) { e = e.trim().toLowerCase(); if (e) out[e] = true; });
  return out;
}
// Devuelve {ok, set:{correoEnMinúsculas:true}, origen:{correo:'motivo'}, filaEncabezados, encabezados, col, filaDe:{correo:n}, motivo}.
// ok:false SOLO si BASE 3.0 no se pudo leer o no se reconoce (hoja ausente, sin fila de encabezados, excepción): quien llama NO debe tratarlo
// como «nadie está retirado». (hoyISO se conserva por compatibilidad con los llamadores; la regla ya no depende de la fecha.)
function leerRetirados_(hoyISO) {
  var res = { ok: false, set: {}, origen: {}, filaDe: {}, filaEncabezados: 0, encabezados: [], col: {}, motivo: '' };
  try {
    var manual = retiradosManuales_();
    var base = base3Leer_();
    if (!base.ok) { res.motivo = base.motivo; return res; }
    res.filaEncabezados = base.filaEncabezados; res.encabezados = base.encabezados; res.col = base.col;
    Object.keys(manual).forEach(function (k) { res.set[k] = true; res.origen[k] = 'propiedad agentes_retirados'; });
    base.filas.forEach(function (f) {
      var email = f.v[base.col.correo] ? String(f.v[base.col.correo]).trim().toLowerCase() : '';
      if (!email) return;
      var cargo = f.v[base.col.cargo];
      if (cargoEsInactivo_(cargo)) {
        res.set[email] = true;
        res.filaDe[email] = f.fila;
        if (!res.origen[email]) res.origen[email] = 'BASE 3.0, fila ' + f.fila + ', CARGO = ' + String(cargo).trim();
      }
    });
    res.ok = true;
    return res;
  } catch (e) {
    res.motivo = 'excepción al leer BASE 3.0: ' + e.message;
    return res;
  }
}

// ── DIAGNÓSTICO DE ASISTENCIA (SOLO LECTURA: no envía correos, no escribe en Firestore ni en propiedades) ──
// Ejecutar desde el editor → Ver → Registros de ejecución.
//   diagnosticoAsistencia()           HOY, a la hora actual
//   diagnosticoAsistenciaCaso4Nov()   el 4-nov-2026 a las 10:32 (la hora de las falsas alertas): qué habría tomado el código anterior
// Muestra: (1) las filas que el script TOMA hoy y por qué; (2) las filas de hoy que descarta y por qué; (3) «FILAS FANTASMA»: filas de OTRO
// día que el código anterior tomaba como si fueran de hoy por el formato M/d/yyyy (con la fecha real de cada una y si habrían
// generado alerta); (4) retirados detectados y de dónde, con los encabezados de BASE 3.0; (5) turnos de ese día en Firestore.
function diagnosticoAsistencia() { return diagnosticoAsistenciaDe_(null, null); }
function diagnosticoAsistenciaCaso4Nov() { return diagnosticoAsistenciaDe_('2026-11-04', '10:32'); }
function diagnosticoAttendance() { return diagnosticoAsistencia(); } // nombre anterior
function diagnosticoAsistenciaDe_(diaISO, hhmm) {
  var ahora = new Date();
  if (diaISO) {
    if (mallaFechaISO_(diaISO) !== diaISO) throw new Error('Fecha inválida; usa yyyy-MM-dd');
    ahora = new Date(diaISO + 'T' + (hhmm || '12:00') + ':00-05:00');
  }
  var hoyISO = Utilities.formatDate(ahora, 'America/Bogota', 'yyyy-MM-dd');
  var p = hoyISO.split('-');
  // Formato ANTERIOR (erróneo), armado a mano para reproducir qué texto buscaba el código viejo: M/d/yyyy
  var textoViejoMD = (+p[1]) + '/' + (+p[2]) + '/' + p[0];
  Logger.log('=== DIAGNÓSTICO DE ASISTENCIA (solo lectura) ===');
  Logger.log('Momento evaluado: ' + Utilities.formatDate(ahora, 'America/Bogota', 'yyyy-MM-dd HH:mm') + ' (Bogotá)' + (diaISO ? ' — simulado' : ''));
  Logger.log('Fecha buscada: ' + mallaFechaTexto_(hoyISO) + ' (día/mes/año).  Texto que buscaba el código anterior con M/d/yyyy: «' + textoViejoMD + '» (' + (((+p[1]) === (+p[2])) ? 'igual a la fecha real: este día no tiene ambigüedad' : 'interpretado día/mes sería el ' + mallaFechaTexto_(mallaFechaISO_(textoViejoMD) || '0000-00-00') + (mallaFechaISO_(textoViejoMD) ? '' : ' (no existe como fecha)')) + ')');

  var sheet = SpreadsheetApp.openById(getMallaSheetId()).getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) throw new Error('No se encontró la hoja Malla');
  var data = sheet.getDataRange().getDisplayValues();
  var retirados = leerRetirados_(hoyISO);
  if (!retirados.ok) Logger.log('⚠️ NO SE PUDO LEER BASE 3.0 (checkAttendance abortaría sin enviar nada): ' + retirados.motivo);
  var lectura = leerTurnosHoyRest_(ahora, diaISO ? { dia: hoyISO } : null);
  if (!lectura.ok) Logger.log('⚠️ LECTURA DE TURNOS FALLIDA (checkAttendance NO enviaría alertas): ' + lectura.motivo);
  var conectados = {};
  (lectura.emails || []).forEach(function (e) { conectados[String(e).trim().toLowerCase()] = true; });
  var sel = asistenciaFilasDeDia_(data, hoyISO, retirados.set);

  function nivel(inicio) {
    var prog = parseTimeToDate(inicio, ahora), mins = prog ? Math.round((ahora - prog) / 60000) : 0;
    return { mins: mins, nivel: mins <= 5 ? 'sin alerta (a tiempo)' : mins >= 60 ? 'ALERTA nivel 3 (+60)' : mins >= 20 ? 'ALERTA nivel 2 (+20)' : mins >= 10 ? 'ALERTA nivel 1 (+10)' : 'sin alerta (aún no llega a +10)' };
  }
  Logger.log('');
  Logger.log('(1) FILAS QUE EL SCRIPT TOMA PARA ' + mallaFechaTexto_(hoyISO) + ': ' + sel.tomadas.length);
  sel.tomadas.forEach(function (f) {
    var c = !!conectados[f.usuario.toLowerCase()], n = nivel(f.inicio);
    Logger.log('  fila ' + f.fila + ' | fecha «' + f.fecha + '» | ' + f.usuario + ' | inicio ' + f.inicio + ' | líder ' + (f.lider || '—') + ' | ' + (lectura.ok ? (c ? 'CONECTADO' : 'sin turno ese día') : 'conexión desconocida') + ' | ' + (c ? 'sin alerta (conectado)' : n.nivel + ' (' + n.mins + ' min)'));
  });
  Logger.log('(2) FILAS DE ESE DÍA QUE SE DESCARTAN: ' + sel.excluidas.length);
  sel.excluidas.forEach(function (f) {
    Logger.log('  fila ' + f.fila + ' | «' + f.fecha + '» | ' + (f.usuario || '(sin usuario)') + ' | ' + f.motivo + (f.motivo === 'retirado' ? ' — ' + (retirados.origen[f.usuario.toLowerCase()] || '') : ''));
  });

  // Filas que el código anterior habría tomado: texto igual a alguno de dd/MM/yyyy, d/M/yyyy, dd-MM-yyyy o M/d/yyyy
  var dd = mallaPad_(+p[2]), mm = mallaPad_(+p[1]);
  var textosViejos = [dd + '/' + mm + '/' + p[0], (+p[2]) + '/' + (+p[1]) + '/' + p[0], dd + '-' + mm + '-' + p[0], textoViejoMD];
  var fantasmas = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i], fecha = row[1] ? String(row[1]).trim() : '';
    if (textosViejos.indexOf(fecha) === -1 || mallaFechaISO_(fecha) === hoyISO) continue; // coincide con el formato viejo y NO con la fecha real
    var usuario = row[2] ? String(row[2]).trim() : '', inicio = row[5] ? String(row[5]).trim() : '', novedad = row[10] ? String(row[10]).trim() : '';
    fantasmas.push({ fila: i + 1, fecha: fecha, real: mallaFechaISO_(fecha), usuario: usuario, inicio: inicio, novedad: novedad, lider: row[9] ? String(row[9]).trim() : '' });
  }
  Logger.log('(3) FILAS FANTASMA (las tomaba el código anterior como de hoy y NO lo son): ' + fantasmas.length);
  var alertarian = 0;
  fantasmas.forEach(function (f) {
    var vieja = f.usuario && f.inicio && !f.novedad, c = !!conectados[f.usuario.toLowerCase()], n = vieja ? nivel(f.inicio) : { mins: 0, nivel: 'el código anterior también la descartaba' };
    var alerta = vieja && !c && n.mins > 5; // con lectura fallida nadie figura conectado: igual que hacía el código anterior
    if (alerta && n.mins >= 10) alertarian++;
    Logger.log('  fila ' + f.fila + ' | texto «' + f.fecha + '» = ' + (f.real ? mallaFechaTexto_(f.real) : '?') + ' (NO es ' + mallaFechaTexto_(hoyISO) + ') | ' + (f.usuario || '(sin usuario)') + ' | inicio ' + f.inicio + (f.novedad ? ' | novedad «' + f.novedad + '»' : '') +
      ' | ' + (vieja ? (c ? 'conectado ese día → sin alerta' : 'sin turno ese día → el código anterior: ' + n.nivel + ' (' + n.mins + ' min)') : n.nivel) + (retirados.set[f.usuario.toLowerCase()] ? ' | RETIRADO (' + (retirados.origen[f.usuario.toLowerCase()] || '') + ')' : ''));
  });
  Logger.log('    → el código anterior habría enviado alertas por ' + alertarian + ' fila(s) fantasma en este momento.');

  Logger.log('');
  Logger.log('(4) BASE 3.0 Y RETIRADOS');
  if (retirados.ok) {
    var colLetra = function (c) { return String.fromCharCode(65 + c); };
    Logger.log('  Encabezados encontrados en la FILA ' + retirados.filaEncabezados + ' de BASE 3.0 (datos desde la fila ' + (retirados.filaEncabezados + 1) + '): ' + retirados.encabezados.map(function (h, c) { return h ? colLetra(c) + '=«' + h + '»' : ''; }).filter(Boolean).join(' · '));
    Logger.log('  Columnas usadas → CORREO: ' + colLetra(retirados.col.correo) + ' · CARGO: ' + colLetra(retirados.col.cargo) + ' · NOMBRE: ' + colLetra(retirados.col.nombre) + ' · DOCUMENTO: ' + colLetra(retirados.col.documento));
  }
  Logger.log('  Retirados detectados (CARGO = INACTIVO o propiedad agentes_retirados): ' + Object.keys(retirados.set).length + (retirados.ok ? '' : ' (lectura fallida)'));
  Object.keys(retirados.set).forEach(function (e) { Logger.log('    ' + e + ' — ' + retirados.origen[e]); });
  Logger.log('(5) TURNOS DE ESE DÍA EN FIRESTORE: ' + (lectura.ok ? lectura.emails.length + ' → ' + lectura.emails.join(', ') : 'lectura fallida'));
  Logger.log('=== FIN DIAGNÓSTICO ===');
  return { dia: hoyISO, tomadas: sel.tomadas, excluidas: sel.excluidas, fantasmas: fantasmas, retirados: Object.keys(retirados.set), lecturaTurnosOk: lectura.ok, lecturaRetiradosOk: retirados.ok };
}

// ── COMBINED TRIGGER (every 10 min) ──
function runAttendanceCheck() {
  sendShiftReminders();
  checkAttendance();
  checkMallaChanges();
}

// ── FIREBASE REST ──
// Lee los turnos de HOY (hora de Bogotá) de Firestore y devuelve {ok, emails, motivo}. NUNCA devuelve «lista vacía» cuando la lectura
// falló: antes (hasta 4-nov-2026) cualquier error (HTTP 401/403/429/5xx, cuerpo que no es un arreglo, excepción de red) terminaba en [] y
// checkAttendance concluía que NADIE había iniciado turno → falsas alertas de «Ausencia en turno» a agentes conectados. Se valida el
// código HTTP, que el cuerpo sea JSON y un ARREGLO, y que ningún elemento sea un error (runQuery devuelve los errores dentro del arreglo,
// a veces incluso con HTTP 200). Cuando falla se deja en el log el código y el cuerpo.
// opts.dia ('yyyy-MM-dd', solo para los diagnósticos de un día pasado) acota también el final del día; sin opts la consulta es la de siempre.
function leerTurnosHoyRest_(now, opts) {
  now = now || new Date();
  var LIMITE = 1000;
  try {
    var token = ScriptApp.getOAuthToken();
    // 00:00 de HOY en Bogotá (UTC-5 fijo), sin depender de la zona horaria del proyecto de Apps Script
    var hoy = Utilities.formatDate(now, 'America/Bogota', 'yyyy-MM-dd');
    var todayStartISO = new Date(hoy + 'T00:00:00-05:00').toISOString();
    var queryUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents:runQuery';
    var filtroInicio = { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: todayStartISO } } };
    var where = filtroInicio;
    if (opts && opts.dia) {
      var finDia = new Date(new Date(opts.dia + 'T00:00:00-05:00').getTime() + 24 * 3600000).toISOString();
      where = { compositeFilter: { op: 'AND', filters: [filtroInicio, { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'LESS_THAN', value: { timestampValue: finDia } } }] } };
    }
    var queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'turnos' }],
        where: where,
        limit: LIMITE
      }
    };
    var response = UrlFetchApp.fetch(queryUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify(queryBody),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var texto = response.getContentText() || '';
    if (code !== 200) {
      Logger.log('Firestore turnos de hoy: HTTP ' + code + ' — cuerpo: ' + texto.slice(0, 1000));
      return { ok: false, emails: [], motivo: 'Firestore respondió HTTP ' + code + ' (' + resumenErrorFirestore_(texto) + ')' };
    }
    var results;
    try { results = JSON.parse(texto); }
    catch (e) {
      Logger.log('Firestore turnos de hoy: HTTP 200 pero el cuerpo no es JSON — cuerpo: ' + texto.slice(0, 1000));
      return { ok: false, emails: [], motivo: 'la respuesta de Firestore no es JSON válido' };
    }
    if (!Array.isArray(results)) {
      Logger.log('Firestore turnos de hoy: HTTP 200 pero la respuesta no es un arreglo — cuerpo: ' + texto.slice(0, 1000));
      return { ok: false, emails: [], motivo: 'la respuesta de Firestore no es un arreglo (' + resumenErrorFirestore_(texto) + ')' };
    }
    var activeUsers = [], documentos = 0;
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (result && result.error) {
        Logger.log('Firestore turnos de hoy: HTTP 200 con un error dentro del arreglo — ' + JSON.stringify(result.error).slice(0, 1000));
        return { ok: false, emails: [], motivo: 'Firestore devolvió un error (' + resumenErrorFirestore_(JSON.stringify(result)) + ')' };
      }
      if (!result || !result.document) continue; // elemento sin documento (p. ej. solo readTime cuando no hay resultados)
      documentos++;
      var fields = result.document.fields || {};
      var status = fields.status && fields.status.stringValue;
      var userEmail = fields.userEmail && fields.userEmail.stringValue;
      if (!userEmail) continue;
      if (status === 'active' || status === 'ended' || status === 'interrupted') {
        if (activeUsers.indexOf(userEmail) === -1) activeUsers.push(userEmail);
      }
    }
    if (documentos >= LIMITE) {
      Logger.log('Firestore turnos de hoy: el resultado alcanzó el límite de ' + LIMITE + ' turnos; puede estar incompleto.');
      return { ok: false, emails: [], motivo: 'el resultado alcanzó el límite de ' + LIMITE + ' turnos y puede estar incompleto' };
    }
    Logger.log('Turnos de hoy encontrados: ' + activeUsers.length);
    return { ok: true, emails: activeUsers, motivo: '' };
  } catch (e) {
    Logger.log('Firestore turnos de hoy: excepción — ' + e.message);
    return { ok: false, emails: [], motivo: 'excepción al consultar Firestore: ' + e.message };
  }
}
// Resumen corto y legible de un cuerpo de error de Firestore (para el log y el aviso técnico)
function resumenErrorFirestore_(texto) {
  try {
    var j = JSON.parse(texto);
    var e = Array.isArray(j) ? (j[0] && j[0].error) : j.error;
    if (e) return [e.code, e.status, e.message].filter(Boolean).join(' · ').slice(0, 200);
  } catch (err) { /* no era JSON */ }
  return String(texto || '').replace(/\s+/g, ' ').slice(0, 120) || 'sin cuerpo';
}
// Compatibilidad (diagnosticoAttendance): lista de correos, [] si la lectura falló (ya queda en el log).
function getTodayTurnosFromFirebase() {
  var r = leerTurnosHoyRest_();
  return r.emails;
}

function firestoreGetDocRaw(path) {
  // Lee un documento puntual de Firestore por su path (ej. "strike_notifications/{docId}").
  // Devuelve null tanto si no existe (404) como si hay error — para sendPendingStrikeAlerts eso
  // significa "no hay registro previo, se puede notificar".
  try {
    var token = ScriptApp.getOAuthToken();
    var url = FIREBASE_REST + '/' + path;
    var resp = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch (e) {
    Logger.log('firestoreGetDocRaw error (' + path + '): ' + e.message);
    return null;
  }
}

// ── HELPERS ──
function getMallaSheetId() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('malla_sheet_id') || '';
}

function parseTimeToDate(timeStr, referenceDate) {
  if (!timeStr || timeStr === '0' || timeStr === '') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const d = new Date(referenceDate);
  d.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, 0, 0);
  return d;
}

// ── DIAGNÓSTICO DE SEGURIDAD (v6) — SOLO LECTURA ──
// Ejecútala UNA VEZ antes de dejar activo el parche, desde el editor (Ejecutar → diagnosticoSeguridadNotif → Registro de ejecución).
// Muestra los destinatarios que hoy tiene guardados el script y marca los que NO son @pibox.app: esos dejarán de recibir correo.
// No envía nada ni modifica ninguna propiedad.
function diagnosticoSeguridadNotif() {
  var props = PropertiesService.getScriptProperties();
  var hayFuera = false;
  ['payroll_recipients', 'reminder_recipients', 'admin_emails', 'payroll_allowed_recipients'].forEach(function (k) {
    var v = props.getProperty(k);
    if (!v) { Logger.log(k + ': (sin definir)'); return; }
    var f = filtrarDestinatarios_(v, k);
    Logger.log(k + ': ' + f.validos.length + ' válido(s) → ' + f.validos.join(', ') + (f.rechazados.length ? '   ⚠ FUERA DE @pibox.app (dejarán de recibir): ' + f.rechazados.join(', ') : ''));
    if (f.rechazados.length) hayFuera = true;
  });
  if (!props.getProperty('payroll_allowed_recipients')) {
    Logger.log('⚠ payroll_allowed_recipients no está definida. Recomendado: crearla (Configuración del proyecto → Propiedades del script) con los correos que SÍ deben recibir el reporte de nómina, separados por coma.');
  }
  Logger.log(hayFuera ? 'RESULTADO: hay destinatarios externos guardados. Confirma con quién corresponda si deben seguir recibiendo antes de continuar.' : 'RESULTADO: todos los destinatarios guardados son @pibox.app.');
}

// ── TEST FUNCTIONS ──
function testSend() {
  sendPayrollReport({
    weekStart: '30 de marzo de 2026',
    weekEnd: '5 de abril de 2026',
    records: [{ n: 'Test Usuario', d: 'lun 30 mar', i: '07:00', o: '15:00', h: '8:00:00', nv: '—', ex: '—' }],
    recipients: ['cromero@pibox.app']
  });
}

function testReminder() {
  sendWeeklyPayrollAuto();
}

function testReminderSimple() {
  const props = PropertiesService.getScriptProperties();
  const reminderStr = props.getProperty('reminder_recipients') || 'cromero@pibox.app';
  Logger.log('Enviando a: ' + reminderStr);
  GmailApp.sendEmail('cromero@pibox.app', 'Test Pi GOps', 'Esto es una prueba simple.');
  Logger.log('Correo enviado OK');
}

function testAttendanceCheck() {
  runAttendanceCheck();
}

function setMallaSheetId(id) {
  PropertiesService.getScriptProperties().setProperty('malla_sheet_id', id);
  Logger.log('Malla sheet ID saved: ' + id);
}

// ── LEADER EMAIL LOOKUP ──
function getAgentDataMap() {
  // Retorna mapa email → { cedula, nombre } desde BASE 3.0 (incluye a los retirados: la nómina de semanas pasadas aún los necesita)
  try {
    const base = base3Leer_();
    if (!base.ok) { Logger.log('getAgentDataMap: ' + base.motivo); return {}; }
    const map = {};
    base.filas.forEach(function(f) {
      const cedula = f.v[base.col.documento] ? f.v[base.col.documento].toString().trim() : '';
      const nombre = f.v[base.col.nombre] ? f.v[base.col.nombre].toString().trim() : '';
      const email  = f.v[base.col.correo] ? f.v[base.col.correo].toString().trim() : '';
      if (email) map[email] = { cedula: cedula, nombre: nombre };
    });
    return map;
  } catch(e) {
    Logger.log('Error loading agent data: ' + e.message);
    return {};
  }
}

function getLiderEmailMap() {
  try {
    const base = base3Leer_();
    if (!base.ok) { Logger.log('getLiderEmailMap: ' + base.motivo); return {}; }
    const map = {};
    base.filas.forEach(function(f) {
      const nombre = f.v[base.col.nombre] ? f.v[base.col.nombre].toString().trim() : '';
      const email  = f.v[base.col.correo] ? f.v[base.col.correo].toString().trim() : '';
      if (nombre && email) map[nombre] = email;
    });
    Logger.log('Leader map loaded: ' + Object.keys(map).length + ' entries');
    return map;
  } catch(e) {
    Logger.log('Error loading leader map: ' + e.message);
    return {};
  }
}
function checkMallaChanges() {
  var props = PropertiesService.getScriptProperties();
  var delayMins = parseInt(props.getProperty('malla_notif_delay') || '60');
  var now = new Date();
  var windowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead

  var ss = SpreadsheetApp.openById(getMallaSheetId());
  if (!ss) { Logger.log('No malla sheet'); return; }
  var sheet = ss.getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) return;

  var data = sheet.getDataRange().getDisplayValues();
  var today = new Date(); today.setHours(0,0,0,0);

  // Build current snapshot (only next 30 days, only inicio+fin fields)
  var currentSnapshot = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var fechaStr = row[1] ? row[1].trim() : '';
    var usuario  = row[2] ? row[2].trim() : '';
    var inicio   = row[5] ? row[5].trim() : '';
    var fin      = row[6] ? row[6].trim() : '';
    if (!fechaStr || !usuario || !inicio) continue;
    // Parse date
    var parts = fechaStr.split('/');
    if (parts.length < 3) continue;
    var rowDate = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
    if (rowDate < today || rowDate > windowEnd) continue;
    var key = usuario + '|' + fechaStr;
    currentSnapshot[key] = inicio + '|' + fin;
  }

  // Get previous snapshot
  var prevStr = props.getProperty('malla_snapshot') || '{}';
  var prevSnapshot = JSON.parse(prevStr);

  // Get pending changes cache (changes detected but not yet notified due to delay)
  var pendingStr = props.getProperty('malla_pending_changes') || '{}';
  var pendingChanges = JSON.parse(pendingStr);

  var nowMs = now.getTime();

  // Detect new changes
  Object.keys(currentSnapshot).forEach(function(key) {
    if (prevSnapshot[key] && prevSnapshot[key] !== currentSnapshot[key]) {
      if (!pendingChanges[key]) {
        // First time detecting this change — record timestamp
        pendingChanges[key] = {
          detectedAt: nowMs,
          oldValue: prevSnapshot[key],
          newValue: currentSnapshot[key]
        };
        Logger.log('Change detected for ' + key);
      }
    } else if (!prevSnapshot[key] && currentSnapshot[key]) {
      // New row added — also notify
      if (!pendingChanges[key]) {
        pendingChanges[key] = {
          detectedAt: nowMs,
          oldValue: null,
          newValue: currentSnapshot[key]
        };
      }
    }
  });

  // Remove pending changes that no longer exist (reverted)
  Object.keys(pendingChanges).forEach(function(key) {
    if (currentSnapshot[key] === prevSnapshot[key] || currentSnapshot[key] === pendingChanges[key].oldValue) {
      Logger.log('Change reverted for ' + key + ' — cancelling notification');
      delete pendingChanges[key];
    }
  });

  // Send notifications for changes that have passed the delay
  var delayMs = delayMins * 60 * 1000;
  var notified = [];
  Object.keys(pendingChanges).forEach(function(key) {
    var change = pendingChanges[key];
    if (nowMs - change.detectedAt >= delayMs) {
      // Send notification
      var parts = key.split('|');
      var usuario = parts[0];
      var fechaStr = parts[1];
      var oldParts = change.oldValue ? change.oldValue.split('|') : ['—','—'];
      var newParts = change.newValue ? change.newValue.split('|') : ['—','—'];
      var oldInicio = oldParts[0], oldFin = oldParts[1];
      var newInicio = newParts[0], newFin = newParts[1];

      // Get agent name from current malla
      var nombre = usuario.split('@')[0];
      for (var i = 1; i < data.length; i++) {
        if (data[i][2] && data[i][2].trim() === usuario) { nombre = data[i][3] ? data[i][3].trim() : nombre; break; }
      }

      var subject = 'Pi GOps — Tu horario del ' + fechaStr + ' fue actualizado';
      var htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
        '<p>Hola <strong>' + nombre + '</strong>,</p>' +
        '<p>Tu programación del <strong>' + fechaStr + '</strong> ha sido actualizada en la malla de horarios.</p>' +
        '<table style="border-collapse:collapse;margin:16px 0;width:100%;">' +
        '<tr style="background:#f3f0ff;"><th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Campo</th><th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Anterior</th><th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Nuevo</th></tr>' +
        (change.oldValue ? '<tr><td style="padding:8px 12px;border:1px solid #ddd;">Hora inicio</td><td style="padding:8px 12px;border:1px solid #ddd;color:#e53e3e;">' + oldInicio + '</td><td style="padding:8px 12px;border:1px solid #ddd;color:#38a169;">' + newInicio + '</td></tr>' +
        '<tr><td style="padding:8px 12px;border:1px solid #ddd;">Hora fin</td><td style="padding:8px 12px;border:1px solid #ddd;color:#e53e3e;">' + oldFin + '</td><td style="padding:8px 12px;border:1px solid #ddd;color:#38a169;">' + newFin + '</td></tr>' : '<tr><td colspan="3" style="padding:8px 12px;border:1px solid #ddd;">Nuevo turno asignado: ' + newInicio + ' → ' + newFin + '</td></tr>') +
        '</table>' +
        '<p>Por favor revisa tu malla en <strong>Pi GOps → Mi Turno → Mi malla</strong> para ver el detalle completo.</p>' +
        '<p>Si tienes alguna duda, consulta con tu líder inmediato.</p>' +
        '<br/><p>Saludos,<br/><strong>Pi GOps · Pibox Operaciones</strong></p>' +
        '</div>';

      try {
        GmailApp.sendEmail(usuario, subject, '', { htmlBody: htmlBody });
        Logger.log('Malla change notification sent to ' + usuario + ' for ' + fechaStr);
        notified.push(key);
      } catch(e) {
        Logger.log('Error sending to ' + usuario + ': ' + e.message);
      }
    }
  });

  // Remove notified changes from pending
  notified.forEach(function(key) { delete pendingChanges[key]; });

  // Save updated state
  props.setProperty('malla_snapshot', JSON.stringify(currentSnapshot));
  props.setProperty('malla_pending_changes', JSON.stringify(pendingChanges));
  Logger.log('Malla check done. Snapshot: ' + Object.keys(currentSnapshot).length + ' rows. Pending: ' + Object.keys(pendingChanges).length);
}
