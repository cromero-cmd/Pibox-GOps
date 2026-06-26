// ═══════════════════════════════════════════
// TARIFAS — esquema, versiones, publicación, fechas especiales
// ═══════════════════════════════════════════
import { LS_TAR, cop, fmtDT } from './config.js';
import { toast } from './ui.js';
import { currentUser } from './auth.js';

export const TARIFF_SCHEMA = [
  // Cobro a TaDa (por unidad)
  {key:'c_paquete',     label:'Cobro TaDa · Paquete',           def:8870,  step:10,   group:'cobro'},
  {key:'c_incentivo',   label:'Cobro TaDa · Incentivo',         def:1580,  step:10,   group:'cobro'},
  {key:'c_cancelado',   label:'Cobro TaDa · Paquete cancelado', def:8505,  step:10,   group:'cobro'},
  {key:'c_tarea',       label:'Cobro TaDa · Tarea',             def:6075,  step:10,   group:'cobro'},
  {key:'c_gar_lj',      label:'Cobro TaDa · Garantizado L-J',   def:85050, step:50,   group:'cobro'},
  {key:'c_gar_vd',      label:'Cobro TaDa · Garantizado V-D',   def:97200, step:50,   group:'cobro'},
  // Pago neto al piloto (por unidad)
  {key:'p_paquete',     label:'Pago piloto · Paquete',          def:7300,  step:10,   group:'pago'},
  {key:'p_incentivo',   label:'Pago piloto · Incentivo',        def:1300,  step:10,   group:'pago'},
  {key:'p_cancelado',   label:'Pago piloto · Paquete cancelado',def:7000,  step:10,   group:'pago'},
  {key:'p_tarea',       label:'Pago piloto · Tarea',            def:5000,  step:10,   group:'pago'},
  {key:'p_min_lj',      label:'Mínimo diario piloto · L-J',     def:70000, step:1000, group:'pago'},
  {key:'p_min_vd',      label:'Mínimo diario piloto · V-D',     def:80000, step:1000, group:'pago'},
  // Porcentajes nacionales
  {key:'pct_plataforma',label:'Comisión plataforma · Nacional (%)', def:15, step:1, group:'pct'},
  {key:'pct_margen',    label:'Margen corporativo · Nacional (%)',  def:3,  step:1, group:'pct'},
  // Porcentajes Cali (ciudad CAL)
  {key:'pct_plataforma_cal',label:'Comisión plataforma · Cali (%)', def:10, step:1, group:'pct_cal'},
  {key:'pct_margen_cal',    label:'Margen corporativo · Cali (%)',  def:7,  step:1, group:'pct_cal'},
  // Fechas pico especiales — festivos L-J que se liquidan como V-D
  // Formato: YYYY-MM-DD separadas por coma. Ej: 2026-06-09, 2026-08-07
  {key:'fechas_pico_especiales', label:'Fechas pico especiales (YYYY-MM-DD, separadas por coma)',
   def:'', step:null, group:'fechas'},
];

export let tariffStore=null;
export let currentEdits={};

// Mantiene window.currentEdits sincronizado — el panel de tarifas usa
// oninput="currentEdits['${s.key}']=..." inline (scope global, no de módulo)
function setCurrentEdits(obj){
  currentEdits = obj;
  window.currentEdits = currentEdits;
}

export function initTariffs(){
  try{
    const r=localStorage.getItem(LS_TAR);
    tariffStore = r ? JSON.parse(r) : null;
    // Validar que la estructura es correcta
    if(tariffStore && (!tariffStore.versions || !tariffStore.active_version || !getAV())){
      tariffStore = null; // estructura inválida → resetear
    }
  }catch{ tariffStore=null; }

  if(!tariffStore){
    const defs={}; TARIFF_SCHEMA.forEach(s=>defs[s.key]=s.def);
    tariffStore={
      active_version:'v1',
      versions:[{version:'v1',fecha_creacion:new Date().toISOString(),
        autor:'sistema',nota:'Versión inicial',values:{...defs}}],
      log:[]
    };
    saveTariffs();
  }
  // Asegurar que el campo log existe aunque sea de una versión anterior
  if(!tariffStore.log) tariffStore.log=[];

  setCurrentEdits({...getAV().values});
  document.getElementById('nav-version').textContent=`Tarifas ${getAV().version}`;
}
export function saveTariffs(){
  try{ localStorage.setItem(LS_TAR,JSON.stringify(tariffStore)); }catch(e){}
  // Sincronizar al storage compartido (solo superadmin puede modificar tarifas)
  if(currentUser?.role==='superadmin'){
    // Sync compartido pendiente vía Apps Script
  }
}
export function getAV(){ return tariffStore.versions.find(v=>v.version===tariffStore.active_version); }
export function getNextVer(){ const n=tariffStore.versions.map(v=>parseInt(v.version.replace('v',''))||0); return 'v'+(Math.max(...n)+1); }

export function renderTariffPanel(){
  const av=getAV();
  document.getElementById('tariff-info').innerHTML=`Versión activa: <code>${av.version}</code> · <code>${fmtDT(av.fecha_creacion)}</code> · Autor: <code>${av.autor}</code>${av.nota?' · '+av.nota:''}`;

  const mkGroup=(group,title,color)=>{
    const items=TARIFF_SCHEMA.filter(s=>s.group===group);
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:10px;font-family:var(--mono);color:${color};text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">${title}</div>
      <div class="t-grid" style="margin-bottom:0;">
        ${items.map(s=>`<div class="t-item"><label>${s.label}</label>
          <input type="number" value="${currentEdits[s.key]??s.def}" step="${s.step}"
            oninput="currentEdits['${s.key}']=parseFloat(this.value)||0"/></div>`).join('')}
      </div>
    </div>`;
  };

  const mkFechasPico = () => {
    // Cargar fechas especiales desde tariff store
    let fechasEspeciales = [];
    try {
      fechasEspeciales = JSON.parse(currentEdits['fechas_especiales'] || tariffStore.fechas_especiales || '[]');
    } catch { fechasEspeciales = []; }

    const rows = fechasEspeciales.map((f,i) => `
      <tr id="fila-fe-${i}">
        <td style="padding:5px 8px;">
          <input class="dict-input" style="width:120px;" value="${f.fecha||''}"
            placeholder="YYYY-MM-DD"
            oninput="updateFechaEspecial(${i},'fecha',this.value)"/>
        </td>
        <td style="padding:5px 8px;">
          <select class="dict-input" style="width:120px;"
            onchange="updateFechaEspecial(${i},'tipo',this.value)">
            <option value="pico" ${f.tipo==='pico'?'selected':''}>Pico (V-D)</option>
            <option value="superpico" ${f.tipo==='superpico'?'selected':''}>Super pico</option>
          </select>
        </td>
        <td style="padding:5px 8px;">
          <input class="dict-input" style="width:110px;" type="number"
            value="${f.tarifa_custom||''}"
            placeholder="Ej: 100000"
            oninput="updateFechaEspecial(${i},'tarifa_custom',parseFloat(this.value)||0)"
            ${f.tipo!=='superpico'?'disabled style="opacity:.4;width:110px;"':''}/>
        </td>
        <td style="padding:5px 8px;">
          <button class="btn btn-sm btn-danger" onclick="removeFechaEspecial(${i})">✕</button>
        </td>
      </tr>`).join('');

    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:10px;font-family:var(--mono);color:var(--yellow);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">
        Fechas especiales · Pico y Super pico
      </div>
      <div style="overflow:hidden;border-radius:6px;border:1px solid var(--border);margin-bottom:8px;">
        <table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px;">
          <thead>
            <tr style="background:var(--bg3);">
              <th style="padding:6px 8px;text-align:left;color:var(--text2);border-bottom:1px solid var(--border);">Fecha</th>
              <th style="padding:6px 8px;text-align:left;color:var(--text2);border-bottom:1px solid var(--border);">Tipo</th>
              <th style="padding:6px 8px;text-align:left;color:var(--text2);border-bottom:1px solid var(--border);">Tarifa piloto neta</th>
              <th style="padding:6px 8px;border-bottom:1px solid var(--border);"></th>
            </tr>
          </thead>
          <tbody id="tbody-fechas-especiales">
            ${rows || `<tr><td colspan="4" style="padding:10px 8px;color:var(--text3);font-family:var(--mono);font-size:11px;">Sin fechas especiales configuradas</td></tr>`}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm" onclick="addFechaEspecial()"
        style="background:var(--yellowBg);border-color:var(--yellowBorder);color:var(--yellow);">
        + Agregar fecha
      </button>
      <div style="font-size:10px;color:var(--text3);margin-top:8px;font-family:var(--mono);">
        Pico → liquida L-J como V-D · Super pico → tarifa custom neta al piloto (se hará gross up para cobro)
      </div>
    </div>`;
  };

  document.getElementById('tariff-fields').innerHTML=
    mkGroup('cobro',   'Tarifas de cobro a TaDa (COP por unidad)',           'var(--blue)')+
    mkGroup('pago',    'Tarifas de pago al piloto — neto (COP por unidad)',   'var(--green)')+
    mkGroup('pct',     'Porcentajes · Nacional',                              'var(--yellow)')+
    mkGroup('pct_cal', 'Porcentajes · Cali (ciudad CAL)',                     'var(--purple)')+
    mkFechasPico();

  // Historial de versiones
  document.getElementById('tariff-history').innerHTML=[...tariffStore.versions].reverse().slice(0,5).map(v=>{
    const isA=v.version===tariffStore.active_version;
    const cobro  =TARIFF_SCHEMA.filter(s=>s.group==='cobro');
    const pago   =TARIFF_SCHEMA.filter(s=>s.group==='pago');
    const pct    =TARIFF_SCHEMA.filter(s=>s.group==='pct');
    const pctCal =TARIFF_SCHEMA.filter(s=>s.group==='pct_cal');
    const mkTags=(items,col)=>items.map(s=>`<span style="font-size:10px;background:var(--bg3);padding:2px 7px;border-radius:3px;font-family:var(--mono);color:${col};">${s.key.split('_').slice(1).join('_')}: <span style="color:var(--text);">${s.group==='pct'?(v.values[s.key]??s.def)+'%':cop(v.values[s.key]??s.def)}</span></span>`).join('');
    return `<div class="ver-card${isA?' active-ver':''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-family:var(--mono);font-size:12px;font-weight:600;">${v.version}${isA?'<span class="badge b-active" style="margin-left:6px;font-size:9px;">ACTIVA</span>':''}</span>
        <span style="font-size:10px;color:var(--text3);">${fmtDT(v.fecha_creacion)} · ${v.autor}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">${mkTags(cobro,'var(--blue)')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">${mkTags(pago,'var(--green)')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">${mkTags(pct,'var(--yellow)')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${mkTags(pctCal,'var(--purple)')}</div>
      ${!isA?`<div style="margin-top:8px;"><button class="btn btn-sm" onclick="activateVersion('${v.version}')">Activar</button></div>`:''}
    </div>`;
  }).join('');

  // Log de cambios
  const TIPO_FECHA_LABEL = {pico:'Pico (V-D)', superpico:'Super pico'};
  const log=(tariffStore.log||[]).slice().reverse().slice(0,10);
  const logHtml=log.length===0
    ? '<div style="font-size:11px;color:var(--text3);font-family:var(--mono);padding:8px 0;">Sin cambios registrados aún</div>'
    : log.map(e=>{
        const ts=fmtDT(e.timestamp);
        let accion;
        if(e.accion==='publicar'){
          accion = `<span style="color:var(--green);">publicó ${e.version}</span>`;
        } else if(e.accion==='activar'){
          accion = `<span style="color:var(--blue);">activó ${e.version}</span>`;
        } else { // fecha_especial
          const tipoLabel = TIPO_FECHA_LABEL[e.tipo]||e.tipo;
          let texto;
          if(e.operacion==='agregar'){
            texto = `📅 Agregada fecha especial: ${e.fecha||'—'} · ${tipoLabel}`;
          } else if(e.operacion==='eliminar'){
            texto = `📅 Eliminada fecha especial: ${e.fecha||'—'} · ${tipoLabel}`;
          } else if(e.campo==='tipo'){
            // El brief usa "Pico" (sin el sufijo "(V-D)") en la transición de
            // tipo de "modificar", a diferencia de "agregar"/"eliminar" que sí
            // lo incluyen — se respeta tal cual el formato exacto pedido.
            const TIPO_LABEL_CORTO = {pico:'Pico', superpico:'Super pico'};
            const antLabel=TIPO_LABEL_CORTO[e.valor_anterior]||e.valor_anterior;
            const nvoLabel=TIPO_LABEL_CORTO[e.valor_nuevo]||e.valor_nuevo;
            texto = `📅 Modificada: ${e.fecha||'—'} · ${antLabel} → ${nvoLabel}`;
            if(e.tipo==='superpico' && e.tarifa_custom>0) texto += ` · Tarifa: ${cop(e.tarifa_custom)}`;
          } else { // campo==='tarifa_custom'
            texto = `📅 Modificada: ${e.fecha||'—'} · ${tipoLabel} · Tarifa: ${cop(e.valor_anterior||0)} → ${cop(e.valor_nuevo||0)}`;
          }
          accion = `<span style="color:var(--yellow);">${texto}</span>`;
        }
        const cambiosHtml=e.cambios?.length
          ? e.cambios.map(c=>`<div style="font-size:10px;color:var(--text3);padding-left:8px;border-left:2px solid var(--border2);margin-top:3px;">${c}</div>`).join('')
          : '';
        return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-family:var(--mono);">${accion}${e.nota?' · '+e.nota:''}</span>
            <span style="font-size:10px;color:var(--text3);">${ts} · ${e.autor||'?'}</span>
          </div>${cambiosHtml}
        </div>`;
      }).join('');

  document.getElementById('tariff-history').innerHTML +=
    `<div class="sec" style="margin-top:16px;">Log de cambios</div>${logHtml}`;
}

export function publishTariff(){
  const av=getAV();
  if(!TARIFF_SCHEMA.some(s=>currentEdits[s.key]!==av.values[s.key])){ toast('Sin cambios'); return; }
  const autor=document.getElementById('t-autor').value.trim()||'sin especificar';
  const nota=document.getElementById('t-nota').value.trim()||'';
  const nv=getNextVer();
  // Registrar qué campos cambiaron para el log
  const cambios=TARIFF_SCHEMA.filter(s=>currentEdits[s.key]!==av.values[s.key])
    .map(s=>`${s.label}: ${av.values[s.key]} → ${currentEdits[s.key]}`);
  tariffStore.versions.push({
    version:nv, fecha_creacion:new Date().toISOString(), autor, nota,
    values:{...currentEdits}, cambios,
  });
  if(!tariffStore.log) tariffStore.log=[];
  tariffStore.log.push({
    timestamp:new Date().toISOString(), accion:'publicar',
    version:nv, autor, nota, cambios,
  });
  tariffStore.active_version=nv; saveTariffs();
  document.getElementById('t-autor').value=''; document.getElementById('t-nota').value='';
  document.getElementById('nav-version').textContent=`Tarifas ${nv}`;
  renderTariffPanel(); toast(`✓ ${nv} publicada`);
}

export function activateVersion(ver){
  const autor=document.getElementById('t-autor').value.trim()||'sin especificar';
  tariffStore.active_version=ver;
  setCurrentEdits({...tariffStore.versions.find(v=>v.version===ver).values});
  if(!tariffStore.log) tariffStore.log=[];
  tariffStore.log.push({
    timestamp:new Date().toISOString(), accion:'activar', version:ver, autor,
  });
  saveTariffs();
  document.getElementById('nav-version').textContent=`Tarifas ${ver}`;
  renderTariffPanel(); toast(`✓ ${ver} activada`);
}

export function getCurrentEdits(){ return currentEdits; }

// ── Fechas especiales ─────────────────────────────
export function getFechasEspeciales(){
  try{ return JSON.parse(tariffStore.fechas_especiales||'[]'); }catch{ return []; }
}
export function saveFechasEspeciales(arr){
  tariffStore.fechas_especiales = JSON.stringify(arr);
  currentEdits['fechas_especiales'] = JSON.stringify(arr);
}
function logFechaEspecial(operacion, fe, extra={}){
  if(!tariffStore.log) tariffStore.log=[];
  tariffStore.log.push({
    timestamp: new Date().toISOString(),
    accion: 'fecha_especial',
    operacion,
    fecha: fe.fecha,
    tipo: fe.tipo,
    tarifa_custom: fe.tarifa_custom || 0,
    autor: currentUser?.nombre || 'sistema',
    ...extra,
  });
}

export function addFechaEspecial(){
  const arr = getFechasEspeciales();
  const fe = {fecha:'', tipo:'pico', tarifa_custom:0};
  arr.push(fe);
  saveFechasEspeciales(arr);
  logFechaEspecial('agregar', fe);
  saveTariffs();
  renderTariffPanel();
}
export function removeFechaEspecial(i){
  const arr = getFechasEspeciales();
  const fe = arr[i];
  if(!fe) return;
  arr.splice(i,1);
  saveFechasEspeciales(arr);
  logFechaEspecial('eliminar', fe);
  saveTariffs();
  renderTariffPanel();
}
export function updateFechaEspecial(i, key, val){
  const arr = getFechasEspeciales();
  if(!arr[i]) return;
  const anterior = arr[i][key];
  arr[i][key] = val;
  // Si cambia a pico, limpiar tarifa_custom
  if(key==='tipo' && val==='pico') arr[i].tarifa_custom = 0;
  saveFechasEspeciales(arr);

  // Solo registrar cambios significativos — no cada tecla escrita en el
  // campo de fecha (oninput dispararía un log por carácter).
  if(key==='tipo' && val!==anterior){
    logFechaEspecial('modificar', arr[i], {campo:'tipo', valor_anterior:anterior, valor_nuevo:val});
  } else if(key==='tarifa_custom' && Math.abs((val||0)-(anterior||0))>0){
    logFechaEspecial('modificar', arr[i], {campo:'tarifa_custom', valor_anterior:anterior||0, valor_nuevo:val||0});
  }
  saveTariffs();

  // Re-render solo si cambió el tipo (para habilitar/deshabilitar el input)
  if(key==='tipo') renderTariffPanel();
}
