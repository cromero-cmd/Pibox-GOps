// ═══════════════════════════════════════════
// HISTORIAL DE LIQUIDACIONES
// ═══════════════════════════════════════════
import { LS_BACKEND_URL, getBackendUrl, cop } from './config.js';
import { mallaRaw, calcularPeriodoMalla } from './parser.js';
import { trumpRows } from './trump.js';
import { getAV } from './tariffs.js';
import { currentUser } from './auth.js';
import { toast, addLog } from './ui.js';

// ── Modal para guardar historial ──────────────────────────
export function abrirModalHistorial(){
  if(!trumpRows.length){ toast('Genera el template primero'); return; }
  document.getElementById('user-menu').classList.remove('open');

  const av      = getAV();
  const periodo = calcularPeriodoMalla() || 'período no especificado';
  const runId   = trumpRows[0]?._run_id || 'LIQ';
  const tc      = trumpRows.reduce((a,r)=>a+r.COMPANY_FINAL_COST+r.ADDITIONAL_COMPANY_FINAL_COST,0);
  const tp      = trumpRows.reduce((a,r)=>a+r.FINAL_COST+r.ADDITIONAL_FINAL_COST,0);

  const modal = document.createElement('div');
  modal.id    = 'modal-guardar-historial';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:800;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--purpleBorder);border-radius:12px;padding:24px;width:460px;max-width:95vw;">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">📊 Guardar en historial</div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:16px;">${periodo} · ${trumpRows.length} registros</div>

      <div class="t-item" style="margin-bottom:12px;">
        <label>URL del backend (Apps Script)</label>
        <input type="text" id="hist-url" value="${getBackendUrl()}"
          placeholder="https://script.google.com/macros/s/.../exec"
          style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 10px;color:var(--text);font-family:var(--mono);font-size:11px;"/>
      </div>

      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;font-size:11px;font-family:var(--mono);">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div><span style="color:var(--text3);">Run ID</span><br/><span style="color:var(--text);">${runId}</span></div>
          <div><span style="color:var(--text3);">Registros</span><br/><span style="color:var(--green);">${trumpRows.length}</span></div>
          <div><span style="color:var(--text3);">Cobro total</span><br/><span style="color:var(--blue);">${cop(tc)}</span></div>
        </div>
      </div>

      <div id="hist-status" style="min-height:18px;font-size:11px;font-family:var(--mono);margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="document.getElementById('modal-guardar-historial').remove()">Cancelar</button>
        <button class="btn" id="btn-guardar-hist" onclick="ejecutarGuardarHistorial()"
          style="background:var(--purpleBg);border-color:var(--purpleBorder);color:var(--purple);">
          Guardar →
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

export async function ejecutarGuardarHistorial(){
  const url    = document.getElementById('hist-url')?.value?.trim();
  const status = document.getElementById('hist-status');
  const btn    = document.getElementById('btn-guardar-hist');
  if(!url){ status.innerHTML='<span style="color:var(--red);">Ingresa la URL del backend</span>'; return; }

  // Guardar URL para próximas veces
  localStorage.setItem(LS_BACKEND_URL, url);

  const av      = getAV();
  const t       = av.values;
  const periodo = calcularPeriodoMalla() || 'período no especificado';
  const runId   = trumpRows[0]?._run_id || 'LIQ';
  const guardadoPor   = currentUser?.nombre || 'sistema';
  const fechaGuardado = new Date().toISOString();

  // Construir registros con toda la info necesaria
  const pPaq = t.p_paquete   ?? 7300;
  const pInc = t.p_incentivo ?? 1300;
  const pCan = t.p_cancelado ?? 8505;
  const pTar = t.p_tarea     ?? 5000;
  const cPaq = t.c_paquete   ?? 8870;
  const cInc = t.c_incentivo ?? 1580;
  const cCan = t.c_cancelado ?? 8505;
  const cTar = t.c_tarea     ?? 6075;

  const registros = trumpRows.map(r=>{
    const paq  = r._paquetes   || 0;
    const inc  = r._incentivos || 0;
    const can  = r._cancelados || 0;
    const tar  = r._tareas     || 0;
    const bono = r.bonos       || 0;

    // Cobros (tarifas fijas × unidades)
    const cobroPaqVal = paq * cPaq;
    const cobroIncVal = inc * cInc;
    const cobroCanVal = can * cCan;
    const cobroTarVal = tar * cTar;
    const productivoCobro = cobroPaqVal + cobroIncVal + cobroCanVal;
    const minimoCobroVD = t.c_garantizado_vd ?? 97200;
    const minimoCobroLJ = t.c_garantizado_lj ?? 85050;
    const diasVD = new Set(['Viernes','Sabado','Domingo']);
    const esVD   = diasVD.has(r._dia || '');
    const minimoC = esVD ? minimoCobroVD : minimoCobroLJ;
    const cobroGarVal = Math.max(0, minimoC - productivoCobro);
    const cobroBonoVal = bono > 0 ? Math.round(bono / (1 - 0.03) / (1 - 0.15)) : 0;
    const cobroTotVal = productivoCobro + cobroTarVal + cobroGarVal + cobroBonoVal;

    // Pagos (tarifas netas × unidades)
    const pagoPaqVal = paq * pPaq;
    const pagoIncVal = inc * pInc;
    const pagoCanVal = can * pCan;
    const pagoTarVal = tar * pTar;
    const productivoPago = pagoPaqVal + pagoIncVal + pagoCanVal;
    const minimoPageVD = t.p_garantizado_vd ?? 80000;
    const minimoPageLJ = t.p_garantizado_lj ?? 70000;
    const minimoP = esVD ? minimoPageVD : minimoPageLJ;
    const pagoGarVal  = Math.max(0, minimoP - productivoPago);
    const pagoBonoVal = bono;
    const pagoPilVal  = productivoPago + pagoTarVal + pagoGarVal + pagoBonoVal;

    // BUGFIX: el backend espera un ARRAY posicional de exactamente 29
    // valores en el mismo orden que HEADERS en Apps Script — antes se
    // enviaba un objeto con nombres de campo (sin run_id/guardado_por/
    // fecha_guardado, que viajaban sueltos en el payload, no por fila).
    // Cualquier desajuste de cantidad/orden desplaza todo lo que viene
    // después en la fila del Sheet (visto en producción: cobro_bono en
    // col S terminaba con el valor de pago_garantizado, y guardado_por/
    // fecha_guardado se colaban en pago_paquete/pago_incentivo).
    return [
      runId,               // run_id
      periodo,             // periodo
      r._driver_id || '',  // id_piloto
      r._piloto    || '',  // piloto
      r._ciudad    || '',  // ciudad
      r._seller    || '',  // seller
      r._fecha     || '',  // fecha
      r._dia       || '',  // dia
      r.BOOKING_ID || '',  // booking_id
      paq,                 // paquetes
      inc,                 // incentivos
      can,                 // cancelados
      tar,                 // tareas
      cobroPaqVal,         // cobro_paquete
      cobroIncVal,         // cobro_incentivo
      cobroCanVal,         // cobro_cancelado
      cobroTarVal,         // cobro_tarea
      cobroGarVal,         // cobro_garantizado
      cobroBonoVal,        // cobro_bono
      cobroTotVal,         // cobro_total
      pagoPaqVal,          // pago_paquete
      pagoIncVal,          // pago_incentivo
      pagoCanVal,          // pago_cancelado
      pagoTarVal,          // pago_tarea
      pagoGarVal,          // pago_garantizado
      pagoBonoVal,         // pago_bono
      pagoPilVal,          // pago_piloto
      guardadoPor,         // guardado_por
      fechaGuardado,       // fecha_guardado
    ];
  });

  btn.disabled = true;
  status.innerHTML = '<span style="color:var(--blue);">⏳ Guardando...</span>';

  try{
    const payload = JSON.stringify({
      apiKey:      t.API_KEY || 'pibox-liq-2026-9605',
      accion:      'guardarHistorial',
      runId, periodo, guardadoPor,
      registros,
    });
    await fetch(url,{method:'POST',mode:'no-cors',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'payload='+encodeURIComponent(payload)});

    status.innerHTML='<span style="color:var(--green);">✓ Historial guardado correctamente</span>';
    addLog('log-trump',`[OK] Historial guardado en Google Sheets · ${registros.length} registros · por ${currentUser?.nombre||'sistema'}`,'ok');
    setTimeout(()=>{ document.getElementById('modal-guardar-historial')?.remove(); }, 2000);
  }catch(err){
    status.innerHTML=`<span style="color:var(--red);">✗ Error: ${err.message}</span>`;
  }finally{
    btn.disabled = false;
  }
}

// ── Módulo de consulta del historial ─────────────────────
export async function abrirHistorialConsulta(){
  document.getElementById('user-menu').classList.remove('open');
  const url = getBackendUrl();

  const modal = document.createElement('div');
  modal.id    = 'modal-historial-consulta';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:800;display:flex;flex-direction:column;overflow:hidden;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:12px;flex-shrink:0;">
      <span style="font-size:14px;font-weight:600;">📊 Historial de liquidaciones</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono);flex:1;" id="hist-total-label"></span>
      <button class="btn btn-sm" onclick="exportarHistorial()">↓ Exportar Excel</button>
      <button class="btn" onclick="document.getElementById('modal-historial-consulta').remove()">✕ Cerrar</button>
    </div>

    <!-- Filtros -->
    <div style="background:var(--bg3);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;flex-shrink:0;">
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Piloto</div>
        <input id="hf-piloto" class="dict-input" placeholder="Buscar piloto..." style="width:180px;" oninput="aplicarFiltrosHist()"/>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Ciudad</div>
        <input id="hf-ciudad" class="dict-input" placeholder="BOG, CAL..." style="width:100px;" oninput="aplicarFiltrosHist()"/>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Seller</div>
        <input id="hf-seller" class="dict-input" placeholder="Buscar seller..." style="width:180px;" oninput="aplicarFiltrosHist()"/>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Semana</div>
        <select id="hf-semana" class="dict-input" style="width:200px;" onchange="aplicarFiltrosHist()">
          <option value="">Todas las semanas</option>
        </select>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Desde</div>
        <input id="hf-desde" type="date" class="dict-input" style="width:140px;" oninput="aplicarFiltrosHist()"/>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:3px;">Hasta</div>
        <input id="hf-hasta" type="date" class="dict-input" style="width:140px;" oninput="aplicarFiltrosHist()"/>
      </div>
      <button class="btn btn-sm" onclick="limpiarFiltrosHist()">✕ Limpiar</button>
    </div>

    <!-- Tabla -->
    <div style="flex:1;overflow:auto;padding:0;">
      <div id="hist-tabla-wrap" style="padding:16px 24px;">
        <div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);">⏳ Cargando historial...</div>
      </div>
    </div>

    <!-- Totales -->
    <div id="hist-totales" style="background:var(--bg3);border-top:1px solid var(--border);padding:10px 24px;font-size:11px;font-family:var(--mono);display:flex;gap:24px;flex-shrink:0;"></div>
  `;
  document.body.appendChild(modal);

  // Cargar datos
  await cargarHistorial(url);
}

let _historialDatos = []; // cache local de todos los registros
let _historialFiltrado = [];

export async function cargarHistorial(url){
  if(!url){
    document.getElementById('hist-tabla-wrap').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--red);font-family:var(--mono);">Configura la URL del backend en el modal de envío de correo primero.</div>';
    return;
  }
  try{
    const params = new URLSearchParams({accion:'consultarHistorial', apiKey:'pibox-liq-2026-9605'});
    const resp   = await fetch(`${url}?${params}`);
    const data   = await resp.json();
    if(!data.ok){ throw new Error(data.error||'Error desconocido'); }

    _historialDatos    = data.registros || [];
    _historialFiltrado = _historialDatos;

    // Poblar selector de semanas
    const sel = document.getElementById('hf-semana');
    if(sel && data.semanas){
      data.semanas.forEach(s=>{
        const opt=document.createElement('option'); opt.value=s; opt.textContent=s; sel.appendChild(opt);
      });
    }
    renderTablaHistorial(_historialDatos);
  }catch(err){
    document.getElementById('hist-tabla-wrap').innerHTML =
      `<div style="text-align:center;padding:40px;color:var(--red);font-family:var(--mono);">Error cargando historial: ${err.message}</div>`;
  }
}

export function normH(s){ return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }

export function aplicarFiltrosHist(){
  const piloto = normH(document.getElementById('hf-piloto')?.value||'');
  const ciudad = normH(document.getElementById('hf-ciudad')?.value||'');
  const seller = normH(document.getElementById('hf-seller')?.value||'');
  const semana = document.getElementById('hf-semana')?.value||'';
  const desde  = document.getElementById('hf-desde')?.value||'';
  const hasta  = document.getElementById('hf-hasta')?.value||'';

  _historialFiltrado = _historialDatos.filter(r=>{
    if(piloto && !normH(r.piloto).includes(piloto)) return false;
    if(ciudad && !normH(r.ciudad).includes(ciudad)) return false;
    if(seller && !normH(r.seller).includes(seller)) return false;
    if(semana && r.periodo !== semana) return false;
    if(desde  && String(r.fecha) < desde) return false;
    if(hasta  && String(r.fecha) > hasta) return false;
    return true;
  });
  renderTablaHistorial(_historialFiltrado);
}

export function limpiarFiltrosHist(){
  ['hf-piloto','hf-ciudad','hf-seller','hf-desde','hf-hasta'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const sel=document.getElementById('hf-semana'); if(sel) sel.value='';
  _historialFiltrado=_historialDatos;
  renderTablaHistorial(_historialDatos);
}

export function renderTablaHistorial(registros){
  const label = document.getElementById('hist-total-label');
  if(label) label.textContent = `${registros.length.toLocaleString('es-CO')} registros`;

  // Totales
  const totPaq   = registros.reduce((a,r)=>a+(Number(r.paquetes)||0),0);
  const totInc   = registros.reduce((a,r)=>a+(Number(r.incentivos)||0),0);
  const totCan   = registros.reduce((a,r)=>a+(Number(r.cancelados)||0),0);
  const totCobro = registros.reduce((a,r)=>a+(Number(r.cobro_total)||0),0);
  const totPago  = registros.reduce((a,r)=>a+(Number(r.pago_piloto)||0),0);
  const totComp  = registros.reduce((a,r)=>a+(Number(r.pago_garantizado)||0),0);

  const totEl = document.getElementById('hist-totales');
  if(totEl) totEl.innerHTML = `
    <span style="color:var(--text3);">Totales filtrados →</span>
    <span>📦 Paq: <strong style="color:var(--text);">${totPaq.toLocaleString('es-CO')}</strong></span>
    <span>🎯 Inc: <strong style="color:var(--text);">${totInc.toLocaleString('es-CO')}</strong></span>
    <span>❌ Can: <strong style="color:var(--text);">${totCan.toLocaleString('es-CO')}</strong></span>
    <span>💰 Cobro: <strong style="color:var(--blue);">${cop(totCobro)}</strong></span>
    <span>💚 Pago: <strong style="color:var(--green);">${cop(totPago)}</strong></span>
    <span>🔒 Garantizado: <strong style="color:var(--yellow);">${cop(totComp)}</strong></span>`;

  if(!registros.length){
    document.getElementById('hist-tabla-wrap').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);">Sin registros para los filtros seleccionados.</div>';
    return;
  }

  const cols = [
    {k:'periodo',           l:'Semana'},
    {k:'fecha',             l:'Fecha'},
    {k:'dia',               l:'Día'},
    {k:'id_piloto',         l:'ID Piloto'},
    {k:'piloto',            l:'Piloto'},
    {k:'ciudad',            l:'Ciudad'},
    {k:'seller',            l:'Seller'},
    {k:'booking_id',        l:'Booking ID'},
    {k:'paquetes',          l:'Paq',              tipo:'int'},
    {k:'incentivos',        l:'Inc',              tipo:'int'},
    {k:'cancelados',        l:'Can',              tipo:'int'},
    {k:'tareas',            l:'Tar',              tipo:'int'},
    {k:'cobro_paquete',     l:'Cobro Paq',        tipo:'cop'},
    {k:'cobro_incentivo',   l:'Cobro Inc',        tipo:'cop'},
    {k:'cobro_cancelado',   l:'Cobro Can',        tipo:'cop'},
    {k:'cobro_tarea',       l:'Cobro Tar',        tipo:'cop'},
    {k:'cobro_garantizado', l:'Cobro Garantizado',tipo:'cop'},
    {k:'cobro_bono',        l:'Cobro Bono',       tipo:'cop'},
    {k:'cobro_total',       l:'Cobro Total',      tipo:'cop'},
    {k:'pago_paquete',      l:'Pago Paq',         tipo:'cop'},
    {k:'pago_incentivo',    l:'Pago Inc',         tipo:'cop'},
    {k:'pago_cancelado',    l:'Pago Can',         tipo:'cop'},
    {k:'pago_tarea',        l:'Pago Tar',         tipo:'cop'},
    {k:'pago_garantizado',  l:'Pago Garantizado', tipo:'cop'},
    {k:'pago_bono',         l:'Pago Bono',        tipo:'cop'},
    {k:'pago_piloto',       l:'Pago Total',       tipo:'cop'},
  ];

  const thStyle = 'padding:7px 10px;text-align:left;background:var(--bg3);color:var(--text2);border-bottom:1px solid var(--border);white-space:nowrap;position:sticky;top:0;z-index:1;font-weight:500;';
  const tdStyle = 'padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap;font-size:10px;';

  const thead = `<thead><tr>${cols.map(c=>`<th style="${thStyle}">${c.l}</th>`).join('')}</tr></thead>`;
  const tbody = registros.map(r=>`<tr style="cursor:default;" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
    ${cols.map(c=>{
      const v = r[c.k];
      let fmt, color='';
      if(c.tipo==='int'){
        fmt = Number(v)||0;
      } else if(c.tipo==='cop'){
        fmt = cop(Number(v)||0);
        if(c.k==='cobro_total')        color='color:var(--blue);';
        if(c.k==='pago_piloto')        color='color:var(--green);';
        if(c.k==='cobro_garantizado'&&Number(v)>0) color='color:var(--blue);opacity:.7;';
        if(c.k==='pago_garantizado'&&Number(v)>0)  color='color:var(--yellow);';
        if(c.k==='cobro_bono'&&Number(v)>0)        color='color:var(--purple);';
        if(c.k==='pago_bono'&&Number(v)>0)         color='color:var(--purple);';
      } else {
        fmt = v||'—';
      }
      return `<td style="${tdStyle}${color}">${fmt}</td>`;
    }).join('')}
  </tr>`).join('');

  document.getElementById('hist-tabla-wrap').innerHTML =
    `<table style="width:100%;border-collapse:collapse;font-family:var(--mono);">${thead}<tbody>${tbody}</tbody></table>`;
}

export function exportarHistorial(){
  if(!_historialFiltrado.length){ toast('Sin datos para exportar'); return; }
  const cols = ['periodo','fecha','dia','id_piloto','piloto','ciudad','seller','booking_id',
    'paquetes','incentivos','cancelados','tareas',
    'cobro_paquete','cobro_incentivo','cobro_cancelado','cobro_tarea',
    'cobro_total','pago_piloto','complemento'];
  const ws = XLSX.utils.json_to_sheet(_historialFiltrado.map(r=>{
    const obj={}; cols.forEach(c=>obj[c]=r[c]||''); return obj;
  }));
  ws['!cols'] = cols.map(()=>({wch:16}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');
  XLSX.writeFile(wb, `Historial_Pibox_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('✓ Historial exportado');
}
