// ── CONFIG ──
const FIREBASE_PROJECT = 'copper-eye-468704-f8';
const FIREBASE_REST = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents';
const MALLA_SHEET_NAME = 'Malla';
// Utilities.formatDate('MMMM') depende del locale del proyecto de Apps Script, que no siempre
// es español (ej. producía "July" en vez de "julio") — se usa este array fijo para no depender
// de esa configuración.
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── MAIN HANDLER ──
function doPost(e) {
  try {
    const type = e.parameter.type;
    const body = e.postData ? e.postData.contents : '';
    Logger.log('doPost type: ' + type + ' body length: ' + body.length);
    if (type === 'payroll_report' && body) {
      const data = JSON.parse(body);
      if (data.recipients && data.recipients.length > 0) {
        const props = PropertiesService.getScriptProperties();
        props.setProperty('payroll_recipients', data.recipients.join(','));
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
    } else if (type === 'strike_warning') {
      sendStrikeWarning(data);
    } else if (type === 'overtime_rejected') {
      const data = JSON.parse(decodeURIComponent(payload));
      sendOvertimeRejectedNotification(data);
      if (data.recipients && data.recipients.length > 0) {
        const props = PropertiesService.getScriptProperties();
        props.setProperty('payroll_recipients', data.recipients.join(','));
      }
      sendPayrollReport(data);
    } else if (type === 'save_config') {
      const props = PropertiesService.getScriptProperties();
      if (data.payrollRecipients) props.setProperty('payroll_recipients', data.payrollRecipients);
      if (data.reminderRecipients) props.setProperty('reminder_recipients', data.reminderRecipients);
      if (data.cutDay !== undefined) props.setProperty('payroll_cut_day', data.cutDay.toString());
      if (data.cutHour !== undefined) props.setProperty('payroll_cut_hour', data.cutHour.toString());
      if (data.adminEmails) props.setProperty('admin_emails', data.adminEmails);
      if (data.mallaNotifDelay !== undefined) props.setProperty('malla_notif_delay', data.mallaNotifDelay.toString());
      Logger.log('Config saved - reminder_recipients: ' + data.reminderRecipients);
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
  const coordinatorEmail = data.coordinatorEmail || '';
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
  const recipients = data.recipients || [];

  const subject = 'Solicitud de horas extras - ' + agentName + ' - ' + date;
  const body = 'Hola,\n\nSe ha registrado una solicitud de aprobacion de horas extras en Pi GOps.\n\nColaborador: ' + agentName + ' (' + agentEmail + ')\nFecha: ' + date + '\nHoras programadas: ' + scheduledHours + '\nHoras trabajadas: ' + workedHours + '\nHoras extras: ' + extraHours + '\n\nEl colaborador indica que estas horas fueron aprobadas por su lider inmediato.\n\nPor favor ingresa a Pi GOps - Turno - Panel de control - Horas extras para aprobar o rechazar.\n\n---\nPi GOps - Pibox Operaciones';

  recipients.forEach(function(email) {
    GmailApp.sendEmail(email, subject, body);
  });
}

// ── STRIKE WARNING (llamado de atención) ──
function sendStrikeWarning(data) {
  const agentName = data.agentName || '—';
  const agentEmail = data.agentEmail || '—';
  const liderEmail = data.liderEmail || '';
  const llamadoNumero = data.llamadoNumero || 1;
  const totalStrikes = data.totalStrikes || 0;
  const esTercerLlamado = !!data.esTercerLlamado;
  const detalle = data.detalle || [];

  // El mes se deriva de la fecha del primer strike (formato DD/MM/YYYY) usando MESES_ES, en vez
  // de confiar en data.mes tal cual llega — así el correo siempre queda en español sin importar
  // el locale del llamador (Utilities.formatDate en sendPendingStrikeAlerts producía "July").
  var mes = data.mes || '—';
  if (detalle.length && detalle[0].fecha) {
    var fechaParts = detalle[0].fecha.split('/');
    if (fechaParts.length === 3) {
      var mesIdx = parseInt(fechaParts[1], 10) - 1;
      var anio = fechaParts[2];
      if (mesIdx >= 0 && mesIdx < 12) mes = MESES_ES[mesIdx] + ' de ' + anio;
    }
  }

  const subject = '⚡ Acción requerida — Llamado de atención #' + llamadoNumero + ' para ' + agentName;

  // Reemplaza el emoji de color de cada tipo de strike por texto con color HTML — los emojis de
  // color (🔴🔵🟠🟡) no se renderizan de forma confiable en varios clientes de correo.
  function tipoHTML(rawTipo) {
    var t = (rawTipo || '').toUpperCase();
    if (t.indexOf('LEVE') !== -1) return '<span style="color:#d97706;font-weight:bold;">Leve</span>';
    if (t.indexOf('MODERADA') !== -1) return '<span style="color:#ea580c;font-weight:bold;">Moderada</span>';
    if (t.indexOf('GRAVE') !== -1) return '<span style="color:#dc2626;font-weight:bold;">Grave</span>';
    if (t.indexOf('DESCONEX') !== -1) return '<span style="color:#2563eb;font-weight:bold;">No desconexión</span>';
    return rawTipo || '—';
  }

  const rows = detalle.map(function(d) {
    return '<tr><td style="padding:8px 12px;border:1px solid #ddd;">' + (d.fecha || '—') + '</td>' +
      '<td style="padding:8px 12px;border:1px solid #ddd;">' + tipoHTML(d.tipo) + '</td>' +
      '<td style="padding:8px 12px;border:1px solid #ddd;">' + (d.descripcion || '—') + '</td></tr>';
  }).join('');

  const disciplinaryWarning = esTercerLlamado
    ? '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin:16px 0;">' +
      '<p style="margin:0;color:#dc2626;font-weight:bold;">⚠️ Este es el tercer llamado de atención acumulado. Según el reglamento interno, corresponde iniciar un proceso disciplinario formal. Por favor coordina con Talento Humano de inmediato.</p>' +
      '</div>'
    : '';

  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<div style="background:#fb923c;padding:16px;border-radius:8px 8px 0 0;">' +
    '<h2 style="color:white;margin:0;">⚡ Acción requerida — Llamado de atención #' + llamadoNumero + '</h2></div>' +
    '<div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">' +
    '<p>Estimado(a) coordinador(a),</p>' +
    '<p>El sistema Pi GOps ha detectado que el colaborador <strong>' + agentName + '</strong> (' + agentEmail + ') ha acumulado ' +
    'suficientes strikes durante <strong>' + mes + '</strong> (' + totalStrikes + ' strikes en total este mes) para generar el ' +
    '<strong>llamado de atención #' + llamadoNumero + '</strong>.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
    '<tr style="background:#f3f0ff;"><th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Fecha</th>' +
    '<th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Tipo</th>' +
    '<th style="padding:8px 12px;text-align:left;border:1px solid #ddd;">Descripción</th></tr>' +
    rows +
    '</table>' +
    '<p><strong>Por favor procede a realizar el llamado de atención verbal/escrito correspondiente según el reglamento interno de Pibox y notifica a Talento Humano.</strong></p>' +
    disciplinaryWarning +
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:20px;">' +
    '<p style="font-weight:bold;color:#374151;margin:0 0 8px 0;">📋 Recordatorio — Escala disciplinaria (sin justa causa)</p>' +
    '<table style="width:100%;font-size:13px;color:#6b7280;">' +
    '<tr><td>Tardanza leve (5–19 min)</td><td>3 strikes = 1 llamado de atención</td></tr>' +
    '<tr><td>Tardanza moderada (20–59 min)</td><td>2 strikes = 1 llamado de atención</td></tr>' +
    '<tr><td>Tardanza grave (60+ min)</td><td>1 strike = 1 llamado de atención</td></tr>' +
    '<tr><td>No desconexión (+4h)</td><td>3 strikes = 1 llamado de atención</td></tr>' +
    '</table>' +
    '<p style="color:#6b7280;font-size:12px;margin:8px 0 0 0;">⚖️ 3 llamados de atención acumulados (cualquier combinación) = proceso disciplinario formal.</p>' +
    '</div>' +
    '<p style="color:#6b7280;font-size:12px;margin-top:24px;">Este mensaje fue generado automáticamente por Pi GOps · Pibox Operaciones</p>' +
    '</div></div>';

  if (liderEmail) {
    GmailApp.sendEmail(liderEmail, subject, '', { htmlBody: htmlBody, cc: 'cromero@pibox.app' });
    Logger.log('Strike warning sent to leader: ' + liderEmail + ' (cc cromero@pibox.app) for agent ' + agentEmail);
  } else {
    GmailApp.sendEmail('cromero@pibox.app', subject, '', { htmlBody: htmlBody });
    Logger.log('Strike warning sent to Super Admin only (no liderEmail) for agent ' + agentEmail);
  }
}

// ── PENDING STRIKE ALERTS (backfill manual — julio 2026) ──
// Reimplementa en Apps Script la misma lógica de detección de strikes que loadStrikes() ya
// aplica en el cliente (index.html), para poder procesar de una vez a todos los agentes del mes
// y enviar los correos de llamado de atención que aún no se hayan disparado desde el navegador
// de cada agente. Se ejecuta manualmente desde el editor de Apps Script vía runStrikeAlerts().
function sendPendingStrikeAlerts() {
  var YEAR = 2026, MONTH = 7; // backfill puntual de julio 2026
  var yearMonth = YEAR + '-' + String(MONTH).padStart(2, '0');

  var agents = getAgentsFromBase3();
  Logger.log('sendPendingStrikeAlerts: ' + agents.length + ' agentes a evaluar para ' + yearMonth);

  var mallaRows = getMallaRowsForMonth(YEAR, MONTH);
  var liderEmailMap = getLiderEmailMap();
  var allTurnos = getTurnosForMonthFromFirebase(YEAR, MONTH);

  var sentCount = 0;
  agents.forEach(function(agent) {
    var agentMallaRows = mallaRows.filter(function(m) { return m.usuario === agent.email; });
    if (!agentMallaRows.length) return;
    var agentTurnos = allTurnos.filter(function(t) { return t.userEmail === agent.email; });

    var strikesLeve = [], strikesModerado = [], strikesGrave = [], strikesNoDesconex = [];

    agentMallaRows.forEach(function(m) {
      // Excluir novedad de votaciones (medio día permitido, no cuenta como tardanza/desconexión)
      var novedadUpper = (m.novedad || '').toUpperCase();
      if (novedadUpper.indexOf('VOT') !== -1) return;
      if (m.novedad) return; // cualquier otra novedad tampoco genera strike ese día

      var mallaDate = parseMallaDateDDMMYYYY(m.fecha);
      if (!mallaDate) return;
      var scheduledStart = parseTimeToDate(m.inicio, mallaDate);
      var scheduledEnd = parseTimeToDate(m.fin, mallaDate);

      // Turno real de ese día — priorizar 'ended' > 'interrupted' > el primero, igual que el cliente
      var dayTurnos = agentTurnos.filter(function(t) {
        return t.startTime && sameCalendarDay(t.startTime, mallaDate);
      });
      var turno = null;
      for (var i = 0; i < dayTurnos.length; i++) { if (dayTurnos[i].status === 'ended') { turno = dayTurnos[i]; break; } }
      if (!turno) { for (var j = 0; j < dayTurnos.length; j++) { if (dayTurnos[j].status === 'interrupted') { turno = dayTurnos[j]; break; } } }
      if (!turno && dayTurnos.length) turno = dayTurnos[0];

      var realStart = turno ? turno.startTime : null;
      var realEnd = turno ? turno.endTime : null;

      if (realStart && scheduledStart) {
        var diffMins = Math.round((realStart - scheduledStart) / 60000);
        if (diffMins >= 60) {
          strikesGrave.push({ fecha: m.fecha, descripcion: 'Llegó ' + diffMins + ' min tarde (programado ' + m.inicio + ')' });
        } else if (diffMins >= 20) {
          strikesModerado.push({ fecha: m.fecha, descripcion: 'Llegó ' + diffMins + ' min tarde (programado ' + m.inicio + ')' });
        } else if (diffMins > 5) {
          strikesLeve.push({ fecha: m.fecha, descripcion: 'Llegó ' + diffMins + ' min tarde (programado ' + m.inicio + ')' });
        }
      }
      if (realEnd && scheduledEnd) {
        // Turno nocturno: si fin programado < inicio programado, sumar 24h para comparar correctamente
        var scheduledEndAdj = (scheduledEnd < scheduledStart) ? new Date(scheduledEnd.getTime() + 24 * 3600000) : scheduledEnd;
        var extraHrs = (realEnd - scheduledEndAdj) / 3600000;
        if (extraHrs > 4) {
          strikesNoDesconex.push({ fecha: m.fecha, descripcion: 'No se desconectó a tiempo — salida programada ' + m.fin });
        }
      }
    });

    var llamadosLeve = Math.floor(strikesLeve.length / 3);
    var llamadosModerado = Math.floor(strikesModerado.length / 2);
    var llamadosGrave = strikesGrave.length; // cada strike grave = 1 llamado
    var llamadosNoDesconex = Math.floor(strikesNoDesconex.length / 3);
    var totalLlamados = llamadosLeve + llamadosModerado + llamadosGrave + llamadosNoDesconex;

    if (totalLlamados <= 0) return;

    var docId = agent.email + '_' + yearMonth;
    var existing = firestoreGetDocRaw('strike_notifications/' + docId);
    if (existing) {
      Logger.log('Ya notificado: ' + docId + ' — se omite');
      return;
    }

    // Resolver email del líder — columna J de la malla del agente puede traer nombre o email
    var liderRaw = '';
    for (var k = 0; k < agentMallaRows.length; k++) { if (agentMallaRows[k].lider) { liderRaw = agentMallaRows[k].lider; break; } }
    var liderEmail = '';
    if (liderRaw) {
      liderEmail = liderRaw.indexOf('@') !== -1 ? liderRaw : (liderEmailMap[liderRaw] || '');
    }

    var detalle = []
      .concat(strikesLeve.map(function(s) { return { tipo: '🟡 Leve', fecha: s.fecha, descripcion: s.descripcion }; }))
      .concat(strikesModerado.map(function(s) { return { tipo: '🟠 Moderada', fecha: s.fecha, descripcion: s.descripcion }; }))
      .concat(strikesGrave.map(function(s) { return { tipo: '🔴 Grave', fecha: s.fecha, descripcion: s.descripcion }; }))
      .concat(strikesNoDesconex.map(function(s) { return { tipo: '🔵 No desconexión', fecha: s.fecha, descripcion: s.descripcion }; }));
    detalle.sort(function(a, b) { return parseMallaDateDDMMYYYY(a.fecha) - parseMallaDateDDMMYYYY(b.fecha); });

    var mesLabel = MESES_ES[MONTH - 1] + ' de ' + YEAR; // sendStrikeWarning igual lo recalcula desde detalle[0].fecha, pero se deja consistente aquí
    var totalStrikes = strikesLeve.length + strikesModerado.length + strikesGrave.length + strikesNoDesconex.length;

    sendStrikeWarning({
      agentName: agent.nombre,
      agentEmail: agent.email,
      liderEmail: liderEmail,
      mes: mesLabel,
      llamadoNumero: totalLlamados,
      totalStrikes: totalStrikes,
      esTercerLlamado: totalLlamados >= 3,
      detalle: detalle
    });

    firestoreSetDocRaw('strike_notifications/' + docId, {
      llamadoNumero: { integerValue: totalLlamados },
      notifiedAt: { timestampValue: new Date().toISOString() },
      source: { stringValue: 'sendPendingStrikeAlerts' }
    });

    sentCount++;
    Logger.log('Llamado #' + totalLlamados + ' notificado para ' + agent.email + (liderEmail ? ' (líder: ' + liderEmail + ')' : ' (sin líder resuelto)'));
  });

  Logger.log('sendPendingStrikeAlerts terminado — correos enviados: ' + sentCount + ' de ' + agents.length + ' agentes evaluados');
}

// Ejecutable directamente desde el editor de Apps Script (menú Ejecutar → runStrikeAlerts).
function runStrikeAlerts() {
  sendPendingStrikeAlerts();
}

function getAgentsFromBase3() {
  // Agentes activos desde BASE 3.0 — excluye coordinadores/admins, que no deben recibir su
  // propio llamado de atención vía este flujo.
  try {
    var ss = SpreadsheetApp.openById(getMallaSheetId());
    var sheet = ss.getSheetByName('BASE 3.0');
    if (!sheet) { Logger.log('No BASE 3.0 sheet found'); return []; }
    var data = sheet.getDataRange().getValues();
    var props = PropertiesService.getScriptProperties();
    var adminEmailsStr = props.getProperty('admin_emails') || 'cromero@pibox.app';
    var adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
    var agents = [];
    for (var i = 1; i < data.length; i++) {
      var nombre = data[i][4] ? data[i][4].toString().trim() : ''; // col E
      var cargo = data[i][5] ? data[i][5].toString().trim() : ''; // col F
      var email = data[i][6] ? data[i][6].toString().trim() : ''; // col G
      if (!email || !nombre) continue;
      var cargoUpper = cargo.toUpperCase();
      if (cargoUpper.indexOf('COORDINADOR') !== -1 || cargoUpper.indexOf('ADMIN') !== -1) continue;
      if (adminEmails.indexOf(email.toLowerCase()) !== -1) continue;
      if (email.toLowerCase() === 'cromero@pibox.app') continue;
      agents.push({ nombre: nombre, cargo: cargo, email: email });
    }
    Logger.log('getAgentsFromBase3: ' + agents.length + ' agentes (excluyendo coordinadores/admins)');
    return agents;
  } catch (e) {
    Logger.log('Error en getAgentsFromBase3: ' + e.message);
    return [];
  }
}

function getMallaRowsForMonth(year, month) {
  // Filas de la malla del mes indicado, con las mismas columnas que usa el resto del script
  // (fecha=col B, usuario=col C, inicio=col F, fin=col G, líder=col J, novedad=col K).
  try {
    var ss = SpreadsheetApp.openById(getMallaSheetId());
    var sheet = ss.getSheetByName(MALLA_SHEET_NAME);
    if (!sheet) { Logger.log('No Malla sheet tab found'); return []; }
    var data = sheet.getDataRange().getDisplayValues();
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var fecha = row[1] ? row[1].trim() : '';
      if (!fecha) continue;
      var parts = fecha.split('/');
      if (parts.length < 3) continue;
      var m = parseInt(parts[1]), y = parseInt(parts[2]);
      if (m !== month || y !== year) continue;
      rows.push({
        fecha: fecha,
        usuario: row[2] ? row[2].trim() : '',
        inicio: row[5] ? row[5].trim() : '',
        fin: row[6] ? row[6].trim() : '',
        lider: row[9] ? row[9].trim() : '',
        novedad: row[10] ? row[10].trim() : ''
      });
    }
    Logger.log('getMallaRowsForMonth ' + month + '/' + year + ': ' + rows.length + ' filas');
    return rows;
  } catch (e) {
    Logger.log('Error en getMallaRowsForMonth: ' + e.message);
    return [];
  }
}

function parseMallaDateDDMMYYYY(fechaStr) {
  if (!fechaStr) return null;
  var parts = fechaStr.split('/');
  if (parts.length < 3) return null;
  var d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2]);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m - 1, d, 0, 0, 0);
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── PAYROLL REPORT ──
function sendPayrollReport(data) {
  const weekStart = data.weekStart || '—';
  const weekEnd = data.weekEnd || '—';
  const records = data.records || [];
  const recipients = data.recipients || [];

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
  const recipients = reminderStr.split(',').map(function(e) { return e.trim(); }).filter(Boolean);
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
  const adminEmails = adminEmailsStr.split(',').map(function(e) { return e.trim(); }).filter(Boolean);

  // Get today's malla
  const ss = SpreadsheetApp.openById(getMallaSheetId());
  if (!ss) { Logger.log('No malla sheet found'); return; }
  const sheet = ss.getSheetByName(MALLA_SHEET_NAME);
  if (!sheet) { Logger.log('No Malla sheet tab found'); return; }

  const data = sheet.getDataRange().getDisplayValues();
  const today = Utilities.formatDate(now, 'America/Bogota', 'dd/MM/yyyy');
  const todayAlt1 = Utilities.formatDate(now, 'America/Bogota', 'd/M/yyyy');
  const todayAlt2 = Utilities.formatDate(now, 'America/Bogota', 'dd-MM-yyyy');
  const todayAlt3 = Utilities.formatDate(now, 'America/Bogota', 'M/d/yyyy');
  function matchesDate(f){ return f===today||f===todayAlt1||f===todayAlt2||f===todayAlt3; }
  Logger.log('Looking for date: ' + today + ' | alt: ' + todayAlt1);

  // Get today's entries
  const todayEntries = [];
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const fecha = row[1] ? row[1].trim() : '';
    if (!matchesDate(fecha)) continue;
    const usuario = row[2] ? row[2].trim() : '';
    const nombre = row[3] ? row[3].trim() : '';
    const inicio = row[5] ? row[5].trim() : '';
    const lider = row[9] ? row[9].trim() : '';
    const novedad = row[10] ? row[10].trim() : '';
    if (!usuario || !inicio || novedad) continue;
    todayEntries.push({ usuario: usuario, nombre: nombre, inicio: inicio, lider: lider });
  }

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

  // Get active turnos from Firebase
  const activeTurnos = getTodayTurnosFromFirebase();
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
    const isConnected = activeTurnos.some(function(t) { return t === entry.usuario; });
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

function sendAttendanceAlert(entry, minsLate, adminEmails, level) {
  const levelLabel = level === 1 ? 'Primer aviso (+10 min)' : level === 2 ? 'Segundo aviso (+20 min)' : 'Aviso final (+60 min)';
  const subject = 'Ausencia en turno: ' + entry.nombre + ' — ' + levelLabel;
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<p>Hola,</p>' +
    '<p>El colaborador <strong>' + entry.nombre + '</strong> (<a href="mailto:' + entry.usuario + '">' + entry.usuario + '</a>) ' +
    'aun no ha iniciado su turno programado para las <strong>' + entry.inicio + '</strong>.</p>' +
    '<p>Lleva <strong>' + minsLate + ' minutos</strong> de retraso. Este es el <strong>' + levelLabel + '</strong>.</p>' +
    '<p>Por favor verifica la situacion del colaborador.</p>' +
    '<br/><p>Saludos,<br/><strong>Pi GOps · Pibox Operaciones</strong></p>' +
    '</div>';

  // Notify only the agent's direct leader, fallback to all admins
  var liderEmail = entry.liderEmail ? entry.liderEmail.trim() : (entry.lider && entry.lider.includes('@') ? entry.lider.trim() : '');
  const SUPER_ADMIN_EMAIL = 'cromero@pibox.app';
  if (liderEmail) {
    // cc Super Admin unless lider IS Super Admin
    const cc = liderEmail !== SUPER_ADMIN_EMAIL ? SUPER_ADMIN_EMAIL : '';
    GmailApp.sendEmail(liderEmail, subject, '', { htmlBody: htmlBody, cc: cc || undefined });
    Logger.log('Alert sent to leader: ' + liderEmail + (cc ? ' (cc: ' + cc + ')' : ''));
  } else if (adminEmails.length > 0) {
    const to = adminEmails[0];
    const others = adminEmails.slice(1).concat([SUPER_ADMIN_EMAIL]).filter(function(e){return e!==to;});
    GmailApp.sendEmail(to, subject, '', { htmlBody: htmlBody, cc: others.join(',') || undefined });
    Logger.log('No leader found, alert sent to all admins');
  }

  // Always notify the agent directly
  const agentSubject = 'Recordatorio: Tu turno comenzó hace ' + minsLate + ' minutos';
  const agentBody = '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">' +
    '<p>Hola ' + entry.nombre + ',</p>' +
    '<p>Tu turno estaba programado para las <strong>' + entry.inicio + '</strong> y aun no has registrado tu ingreso en Pi GOps.</p>' +
    '<p>Por favor ingresa a <strong>Pi GOps</strong> e inicia tu turno a la brevedad.</p>' +
    '<p>Si tienes alguna novedad, informa a tu lider inmediato.</p>' +
    '<br/><p>Saludos,<br/><strong>Pi GOps · Pibox Operaciones</strong></p>' +
    '</div>';
  GmailApp.sendEmail(entry.usuario, agentSubject, '', { htmlBody: agentBody });
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
  const today = Utilities.formatDate(now, 'America/Bogota', 'dd/MM/yyyy');
  const todayAlt1 = Utilities.formatDate(now, 'America/Bogota', 'd/M/yyyy');
  function matchesToday(f){ return f===today||f===todayAlt1; }

  const reminderSentStr = props.getProperty('shift_reminders_sent') || '';
  const reminderSent = reminderSentStr ? JSON.parse(reminderSentStr) : {};

  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const fecha = row[1] ? row[1].trim() : '';
    if (!matchesToday(fecha)) continue;
    const usuario = row[2] ? row[2].trim() : '';
    const nombre = row[3] ? row[3].trim() : '';
    const inicio = row[5] ? row[5].trim() : '';
    const novedad = row[10] ? row[10].trim() : '';
    if (!usuario || !inicio || novedad) continue;

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

// ── DIAGNÓSTICO (no envía correos) ──
function diagnosticoAttendance() {
  const activeTurnos = getTodayTurnosFromFirebase();
  Logger.log('=== DIAGNÓSTICO ===');
  Logger.log('Active turnos found: ' + activeTurnos.length + ' | users: ' + activeTurnos.join(', '));

  const ss = SpreadsheetApp.openById(getMallaSheetId());
  const sheet = ss.getSheetByName(MALLA_SHEET_NAME);
  const data = sheet.getDataRange().getDisplayValues();
  const now = new Date();
  const today = Utilities.formatDate(now, 'America/Bogota', 'dd/MM/yyyy');
  const todayAlt1 = Utilities.formatDate(now, 'America/Bogota', 'd/M/yyyy');
  function matchesDate(f){ return f===today||f===todayAlt1; }

  var found = 0;
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const fecha = row[1] ? row[1].trim() : '';
    if (!matchesDate(fecha)) continue;
    const usuario = row[2] ? row[2].trim() : '';
    const inicio = row[5] ? row[5].trim() : '';
    const novedad = row[10] ? row[10].trim() : '';
    if (!usuario || !inicio || novedad) continue;
    found++;
    const scheduledStart = parseTimeToDate(inicio, now);
    const minsLate = scheduledStart ? Math.round((now - scheduledStart) / 60000) : 0;
    const isConnected = activeTurnos.some(function(t) { return t === usuario; });
    Logger.log('Agente: ' + usuario + ' | inicio: ' + inicio + ' | tardanza: ' + minsLate + ' min | conectado: ' + isConnected);
  }
  Logger.log('Total entradas hoy: ' + found);
  Logger.log('=== FIN DIAGNÓSTICO ===');
}

// ── COMBINED TRIGGER (every 10 min) ──
function runAttendanceCheck() {
  sendShiftReminders();
  checkAttendance();
  checkMallaChanges();
}

// ── FIREBASE REST ──
function getTodayTurnosFromFirebase() {
  try {
    const token = ScriptApp.getOAuthToken();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    // Usar structuredQuery para filtrar solo turnos de hoy
    const queryUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents:runQuery';
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'turnos' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'startTime' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { timestampValue: todayStartISO }
          }
        },
        limit: 200
      }
    };

    const response = UrlFetchApp.fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(queryBody),
      muteHttpExceptions: true
    });

    const results = JSON.parse(response.getContentText());
    const activeUsers = [];

    results.forEach(function(result) {
      if (!result.document) return;
      const fields = result.document.fields || {};
      const status = fields.status && fields.status.stringValue;
      const userEmail = fields.userEmail && fields.userEmail.stringValue;
      if (!userEmail) return;
      if (status === 'active' || status === 'ended' || status === 'interrupted') {
        if (activeUsers.indexOf(userEmail) === -1) activeUsers.push(userEmail);
      }
    });

    Logger.log('Turnos de hoy encontrados: ' + activeUsers.length);
    return activeUsers;
  } catch(e) {
    Logger.log('Firebase REST error: ' + e.message);
    return [];
  }
}

function getTurnosForMonthFromFirebase(year, month) {
  // Todos los turnos del mes indicado (rango con dos filtros sobre el MISMO campo startTime —
  // no requiere índice compuesto, igual que getRecentTurnos/getApprovedOvertimeEvents del
  // cliente). Se trae una sola vez y se filtra por agente en memoria en sendPendingStrikeAlerts,
  // en vez de una consulta por agente.
  try {
    var token = ScriptApp.getOAuthToken();
    var monthStart = new Date(year, month - 1, 1, 0, 0, 0);
    var monthEnd = new Date(year, month, 0, 23, 59, 59);
    var queryUrl = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents:runQuery';
    var queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'turnos' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: monthStart.toISOString() } } },
              { fieldFilter: { field: { fieldPath: 'startTime' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: monthEnd.toISOString() } } }
            ]
          }
        },
        limit: 1000
      }
    };

    var response = UrlFetchApp.fetch(queryUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify(queryBody),
      muteHttpExceptions: true
    });

    var results = JSON.parse(response.getContentText());
    var turnos = [];
    results.forEach(function(result) {
      if (!result.document) return;
      var fields = result.document.fields || {};
      var userEmail = fields.userEmail && fields.userEmail.stringValue;
      var status = fields.status && fields.status.stringValue;
      var startTimeVal = fields.startTime && fields.startTime.timestampValue;
      var endTimeVal = fields.endTime && fields.endTime.timestampValue;
      if (!userEmail || !startTimeVal) return;
      turnos.push({
        userEmail: userEmail,
        status: status || '',
        startTime: new Date(startTimeVal),
        endTime: endTimeVal ? new Date(endTimeVal) : null
      });
    });
    Logger.log('getTurnosForMonthFromFirebase ' + month + '/' + year + ': ' + turnos.length + ' turnos');
    return turnos;
  } catch (e) {
    Logger.log('getTurnosForMonthFromFirebase error: ' + e.message);
    return [];
  }
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

function firestoreSetDocRaw(path, fields) {
  // Crea/sobrescribe un documento puntual de Firestore con los campos ya en formato REST
  // tipado (ej. {llamadoNumero:{integerValue:1}}).
  try {
    var token = ScriptApp.getOAuthToken();
    var url = FIREBASE_REST + '/' + path;
    UrlFetchApp.fetch(url, {
      method: 'patch',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ fields: fields }),
      muteHttpExceptions: true
    });
    return true;
  } catch (e) {
    Logger.log('firestoreSetDocRaw error (' + path + '): ' + e.message);
    return false;
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
  // Retorna mapa email → { cedula, nombre } desde BASE 3.0
  try {
    const ss = SpreadsheetApp.openById(getMallaSheetId());
    const sheet = ss.getSheetByName('BASE 3.0');
    if (!sheet) return {};
    const data = sheet.getDataRange().getValues();
    const map = {};
    for (var i = 1; i < data.length; i++) {
      const cedula = data[i][3] ? data[i][3].toString().trim() : ''; // col D
      const nombre = data[i][4] ? data[i][4].toString().trim() : ''; // col E
      const email  = data[i][6] ? data[i][6].toString().trim() : ''; // col G
      if (email) map[email] = { cedula: cedula, nombre: nombre };
    }
    return map;
  } catch(e) {
    Logger.log('Error loading agent data: ' + e.message);
    return {};
  }
}

function getLiderEmailMap() {
  try {
    const ss = SpreadsheetApp.openById(getMallaSheetId());
    const sheet = ss.getSheetByName('BASE 3.0');
    if (!sheet) { Logger.log('No BASE 3.0 sheet found'); return {}; }
    const data = sheet.getDataRange().getValues();
    const map = {};
    for (var i = 1; i < data.length; i++) {
      const nombre = data[i][4] ? data[i][4].toString().trim() : ''; // col E
      const email  = data[i][6] ? data[i][6].toString().trim() : ''; // col G
      if (nombre && email) map[nombre] = email;
    }
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
