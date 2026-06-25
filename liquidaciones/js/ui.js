// ═══════════════════════════════════════════
// UI — toasts, log, banner de procesamiento, tablas con paginación/export, stepper
// ═══════════════════════════════════════════
import { cop, PAGE_SIZE } from './config.js';

// ── LOG ──────────────────────────────────────
// Resumen dinámico para los logs colapsables (panel de Conciliación y
// Template Trump) — el conteo se mantiene en JS en vez de contar hijos del
// DOM, así funciona igual en navegador real y en los tests headless.
const LOG_SUMMARY = {
  'log-conc':  { summaryId:'log-conc-summary',  label:'Log de conciliación', colorBySeverity:false },
  'log-trump': { summaryId:'log-trump-summary', label:'Log final',           colorBySeverity:true  },
};
const logState = {};

function actualizarResumenLog(id){
  const cfg = LOG_SUMMARY[id];
  if(!cfg) return;
  const summaryEl = document.getElementById(cfg.summaryId);
  if(!summaryEl) return;
  const st = logState[id] || {count:0, hasErr:false, hasWarn:false};
  summaryEl.textContent = `📋 ${cfg.label} (${st.count} líneas)`;
  if(cfg.colorBySeverity){
    summaryEl.style.color = st.hasErr ? 'var(--red)' : st.hasWarn ? 'var(--yellow)' : 'var(--green)';
  }
}

export function addLog(id,msg,cls='info'){
  const el=document.getElementById(id); if(!el)return;
  el.innerHTML+=`<div class="${cls}">${msg}</div>`;
  el.scrollTop=el.scrollHeight;
  if(LOG_SUMMARY[id]){
    const st = logState[id] || (logState[id]={count:0, hasErr:false, hasWarn:false});
    st.count++;
    if(cls==='err') st.hasErr=true;
    if(cls==='warn') st.hasWarn=true;
    actualizarResumenLog(id);
  }
}
export function clearLog(id){
  const el=document.getElementById(id); if(el) el.innerHTML='';
  if(LOG_SUMMARY[id]){
    logState[id] = {count:0, hasErr:false, hasWarn:false};
    actualizarResumenLog(id);
  }
}

// ── TOAST — con ícono y duración por tipo ────
const TOAST_META = {
  success:{icon:'✓', cls:'toast-success', duration:2400},
  error:  {icon:'✗', cls:'toast-error',   duration:4000},
  warn:   {icon:'⚠', cls:'toast-warn',    duration:3200},
  info:   {icon:'ℹ', cls:'toast-info',    duration:2400},
};
function detectToastType(msg){
  if(/^✗/.test(msg)) return 'error';
  if(/^⚠/.test(msg)) return 'warn';
  return 'success'; // comportamiento original: toast siempre era verde por defecto
}
export function toast(msg, type){
  const el=document.getElementById('toast');
  if(!el) return;
  const t = type || detectToastType(msg);
  const meta = TOAST_META[t] || TOAST_META.success;
  el.className = `toast show ${meta.cls}`;
  el.textContent = `${meta.icon} ${msg}`.trim();
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'), meta.duration);
}

// ── BANNER DE PROCESAMIENTO ──────────────────
export function showProcessing(msg='Procesando...'){
  const b=document.getElementById('proc-banner');
  document.getElementById('proc-msg').textContent=msg;
  b.classList.add('show');
}
export function hideProcessing(){ document.getElementById('proc-banner').classList.remove('show'); }

// ── ESTADO VACÍO REUTILIZABLE (SVG + acción sugerida) ──
export function emptyStateHtml(title, action){
  return `<div class="empty-state">
    <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.4" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M8 16h5"/><path d="M8 8h2"/>
    </svg>
    <div class="empty-title">${title}</div>
    ${action?`<div class="empty-action">${action}</div>`:''}
  </div>`;
}

// ═══════════════════════════════════════════
// TABLA CON PAGINACIÓN + EXPORT
// ═══════════════════════════════════════════
export const COP_SET=new Set(['garantizado','bonos','ajustes','COMPANY_FINAL_COST','ADDITIONAL_COMPANY_FINAL_COST','FINAL_COST','ADDITIONAL_FINAL_COST']);
export const NUM_SET=new Set(['paquetes','incentivos','cancelados','tareas','paquetes_dist','incentivos_dist','cancelados_dist','tareas_dist','n_bookings','PACKAGES_COUNT','IS_PER_HOUR']);

// Niveles de confianza → ícono adicional junto al color existente (badge)
function confidenceIcon(v){
  if(['HIGH','FUZZY-HIGH','APRENDIDO','MANUAL-OK'].includes(v)) return '✓';
  if(['MEDIUM','FUZZY-LOW'].includes(v)) return '~';
  if(['LOW','AMBIGUOUS','SIN_MALLA','SIN_TADA'].includes(v)) return '✕';
  return '';
}

export const tableData={'conc-data':[],'dist-data':[],'trump-data':[],'tada-norm-data':[],'malla-norm-data':[]};
const pageStates={};

export function mkTable(containerId, rows, cols, heads, rowFn, tid, dataKey){
  const el=document.getElementById(containerId);
  if(!el) return;
  if(dataKey) tableData[dataKey]=rows; // guardar para export
  if(!rows||!rows.length){ el.innerHTML=emptyStateHtml('Sin datos', 'Carga o procesa un paso anterior para ver resultados aquí'); return; }
  if(!pageStates[tid]) pageStates[tid]=0;
  el._d={rows,cols,heads,rowFn,tid};
  renderTblPage(el);
}

export function renderTblPage(el){
  const {rows,cols,heads,rowFn,tid}=el._d;
  const page=pageStates[tid]||0, total=rows.length;
  const start=page*PAGE_SIZE, end=Math.min(start+PAGE_SIZE,total);
  const totalPages=Math.ceil(total/PAGE_SIZE);
  let html=`<div class="tbl-container"><div class="tbl-header"><span class="tbl-counter">Mostrando <strong>${start+1}–${end}</strong> de <strong>${total}</strong> filas</span></div><div class="tbl-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  rows.slice(start,end).forEach(r=>{
    const rc=rowFn?rowFn(r):'';
    html+=`<tr${rc}>${cols.map(c=>{
      const v=r[c];
      if(c==='nivel_confianza'){ const cl=v==='HIGH'?'b-high':v==='MEDIUM'?'b-med':v==='LOW'?'b-low':'b-sin'; return `<td><span class="badge ${cl}">${confidenceIcon(v)} ${v||'—'}</span></td>`; }
      if(c==='ciudad') return `<td><span class="city">${v||'—'}</span></td>`;
      if(COP_SET.has(c)&&typeof v==='number') return `<td class="num cop">${v!==0?cop(v):'—'}</td>`;
      if(NUM_SET.has(c)&&typeof v==='number') return `<td class="num">${v}</td>`;
      return `<td>${v??'—'}</td>`;
    }).join('')}</tr>`;
  });
  html+=`</tbody></table></div>`;
  if(totalPages>1){ html+=`<div class="tbl-pagination"><span class="pag-info">Página ${page+1} de ${totalPages}</span><div class="pag-btns"><button class="pag-btn" onclick="chPage('${tid}',${page-1})" ${page===0?'disabled':''}>← Anterior</button><button class="pag-btn" onclick="chPage('${tid}',${page+1})" ${page>=totalPages-1?'disabled':''}>Siguiente →</button></div></div>`; }
  html+='</div>';
  el.innerHTML=html;
}

export function chPage(tid,pg){
  pageStates[tid]=pg;
  ['tbl-tada-norm','tbl-malla-norm','tbl-conc','tbl-dist','tbl-trump'].forEach(cid=>{
    const el=document.getElementById(cid); if(el&&el._d&&el._d.tid===tid) renderTblPage(el);
  });
}

// ═══════════════════════════════════════════
// EXPORTAR TABLA A EXCEL
// ═══════════════════════════════════════════
export function exportTable(dataKey, filename){
  const rows=tableData[dataKey];
  if(!rows||!rows.length){ toast('Sin datos para exportar'); return; }
  // Limpiar campos internos (_*)
  const clean=rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('_'))));
  const ws=XLSX.utils.json_to_sheet(clean);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,filename.slice(0,31));
  XLSX.writeFile(wb,`${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`✓ ${filename}.xlsx exportado`);
}

// ═══════════════════════════════════════════
// STEPPER
// ═══════════════════════════════════════════
export const STEPS=[
  {panel:'p0', stp:'stp0'},
  {panel:'p1', stp:'stp1'},
  {panel:'p2', stp:'stp2'},
  {panel:'p3', stp:'stp3'},
  {panel:'p4', stp:'stp4'},
  {panel:'p4b',stp:'stp4b'},
  {panel:'p5', stp:'stp5'},
  {panel:'p6', stp:'stp6'},
];

export let maxStep = 0;

// Callback opcional invocado cuando se navega al índice 6 (tarifas) —
// se registra desde main.js para evitar que ui.js dependa de tariffs.js
let onNavStep6 = null;
export function setOnNavStep6(fn){ onNavStep6 = fn; }

export function navStep(i){
  // Convertir 4.5 → índice 5 (p4b)
  const idx = i===4.5 ? 5 : i>4 ? i+1 : i;
  if(idx > maxStep) return;
  STEPS.forEach((s,j)=>{
    const panel=document.getElementById(s.panel);
    const step =document.getElementById(s.stp);
    if(panel) panel.classList.toggle('active', j===idx);
    if(step){
      step.classList.remove('active','done','locked');
      if(j===idx) step.classList.add('active');
      else if(j<idx) step.classList.add('done');
      else step.classList.add('locked');
    }
  });
  if(idx===6 && onNavStep6) onNavStep6(); // tarifas es ahora índice 6
}
export function unlock(i){
  const idx = i===4.5 ? 5 : i>4 ? i+1 : i;
  if(idx>maxStep) maxStep=idx;
  navStep(i);
}
export function setMaxStep(v){ if(v>maxStep) maxStep=v; }
