// ═══════════════════════════════════════════
// ENVÍO DE CORREO — vía Apps Script (mismo payload/endpoint de siempre)
// ═══════════════════════════════════════════
import { LS_EMAIL, DEFAULT_BACKEND_URL, cop } from './config.js';
import { calcularPeriodoMalla } from './parser.js';
import { trumpRows } from './trump.js';
import { getAV } from './tariffs.js';
import { addLog, toast } from './ui.js';

export function abrirModalEnvio(){
  if(!trumpRows.length){ toast('Genera el template primero'); return; }

  // Restaurar config guardada
  try{
    const cfg = JSON.parse(localStorage.getItem(LS_EMAIL)||'{}');
    if(cfg.url)           document.getElementById('envio-url').value            = cfg.url;
    else                  document.getElementById('envio-url').value            = DEFAULT_BACKEND_URL;
    if(cfg.apikey)        document.getElementById('envio-apikey').value         = cfg.apikey;
    if(cfg.analista)      document.getElementById('envio-analista').value       = cfg.analista;
    if(cfg.emailAnalista) document.getElementById('envio-email-analista').value = cfg.emailAnalista;
  }catch{}

  const periodo = calcularPeriodoMalla();
  document.getElementById('modal-periodo-label').textContent =
    periodo ? `Período detectado: ${periodo}` : 'Período: no detectado — revisa la malla';
  document.getElementById('envio-status').textContent = '';
  document.getElementById('envio-extra').value = '';

  const modal = document.getElementById('modal-envio');
  modal.style.display = 'flex';
}

export function cerrarModalEnvio(){
  document.getElementById('modal-envio').style.display = 'none';
}

export async function enviarPorCorreo(){
  const url     = document.getElementById('envio-url').value.trim();
  const apikey  = document.getElementById('envio-apikey').value.trim();
  const analista      = document.getElementById('envio-analista').value.trim()||'Analista';
  const emailAnalista = document.getElementById('envio-email-analista').value.trim();
  const extra         = document.getElementById('envio-extra').value
                          .split(',').map(s=>s.trim()).filter(s=>s.includes('@'));

  const status  = document.getElementById('envio-status');
  const btnEnviar = document.getElementById('btn-enviar-correo');

  if(!url)    { status.innerHTML='<span style="color:var(--red);">Ingresa la URL del Web App</span>'; return; }
  if(!apikey) { status.innerHTML='<span style="color:var(--red);">Ingresa la API Key</span>'; return; }

  // Guardar config para próxima vez
  try{ localStorage.setItem(LS_EMAIL, JSON.stringify({url, apikey, analista, emailAnalista})); }catch{}

  const av    = getAV();
  const runId = trumpRows[0]?._run_id || 'LIQ';
  const tc    = trumpRows.reduce((a,r)=>a+r.COMPANY_FINAL_COST+r.ADDITIONAL_COMPANY_FINAL_COST,0);
  const tp    = trumpRows.reduce((a,r)=>a+r.FINAL_COST+r.ADDITIONAL_FINAL_COST,0);
  const margen= tc - tp;
  const periodo = calcularPeriodoMalla() || 'período no especificado';

  // El adjunto del correo es solo la hoja "Template Trump", como CSV — el
  // botón de descarga local (downloadTrump) sigue generando el XLSX
  // completo de 4 hojas sin cambios, esto es exclusivo del adjunto del correo.
  const ws1=XLSX.utils.json_to_sheet(trumpRows.map(r=>({
    BOOKING_ID:r.BOOKING_ID, COMPANY_FINAL_COST:r.COMPANY_FINAL_COST,
    ADDITIONAL_COMPANY_FINAL_COST:r.ADDITIONAL_COMPANY_FINAL_COST,
    DISPUTED_COMPANY_FINAL_COST:'', FINAL_COST:r.FINAL_COST,
    ADDITIONAL_FINAL_COST:r.ADDITIONAL_FINAL_COST, DISPUTED_FINAL_COST:'',
    PACKAGES_COUNT:r.PACKAGES_COUNT, IS_PER_HOUR:0, COMMENTS:r.COMMENTS_PILOTO,
  })));
  const csvText = XLSX.utils.sheet_to_csv(ws1, {FS:',', RS:'\n'});

  // Convertir a base64 — TextEncoder (no btoa directo) porque el CSV puede
  // tener tildes/ñ en COMMENTS y btoa() solo acepta Latin1; TextEncoder
  // codifica a UTF-8 real sin anteponer BOM.
  const csvBytes = new TextEncoder().encode(csvText);
  let binary = '';
  csvBytes.forEach(b=>binary+=String.fromCharCode(b));
  const base64 = btoa(binary);
  const nombreArchivo = `${runId}.csv`;

  // Enviar al Apps Script
  btnEnviar.disabled = true;
  status.innerHTML   = '<span style="color:var(--blue);">⏳ Enviando...</span>';

  // Enviar con fetch no-cors — no podemos leer la respuesta pero el correo sí se envía
  // Apps Script procesa el POST aunque el navegador bloquee la lectura de la respuesta
  try{
    const payload = JSON.stringify({
      apiKey: apikey,
      accion: 'enviarCorreo',
      archivoBase64: base64,
      nombreArchivo,
      destinatarios: extra,
      resumen: {
        periodo,
        bookings:     trumpRows.length.toString(),
        cobro:        cop(tc),
        pago:         cop(tp),
        margen:       cop(margen),
        runId,
        version:      av.version,
        analista,
        emailAnalista,
      },
    });

    // fetch con mode:'no-cors' evita el bloqueo cross-origin
    // Apps Script recibe y procesa el POST normalmente
    // La respuesta no es legible desde el navegador, pero el correo se envía
    await fetch(url, {
      method:   'POST',
      mode:     'no-cors',
      headers:  {'Content-Type': 'application/x-www-form-urlencoded'},
      body:     'payload=' + encodeURIComponent(payload),
    });

    // Con no-cors no podemos confirmar éxito/error desde la respuesta
    // Mostramos confirmación optimista — Apps Script enviará el correo
    status.innerHTML=`<span style="color:var(--green);">✓ Solicitud enviada — revisa tu bandeja en unos segundos</span>`;
    addLog('log-trump',`[OK] Correo enviado a ${[...new Set(['cromero@pibox.app','aperez@pibox.app',emailAnalista,...extra].filter(Boolean))].join(', ')}`,'ok');
    setTimeout(cerrarModalEnvio, 2500);

  }catch(err){
    status.innerHTML=`<span style="color:var(--red);">✗ Error: ${err.message}</span>`;
  }finally{
    btnEnviar.disabled = false;
  }
}
