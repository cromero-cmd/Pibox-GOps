// ═══════════════════════════════════════════
// PARSER — carga de archivos TADA/Malla, mapeo de columnas, diagnóstico
// ═══════════════════════════════════════════
import { DAYS_ES, normStr, parseDate } from './config.js';
import { addLog, clearLog, showProcessing, hideProcessing, navStep, setMaxStep } from './ui.js';

export let tadaRaw=[];
export let mallaRaw=[];
export let colMap=[];
export let loadedTada=false;
export let loadedMalla=false;

// Setter usado por main.js (proceedToConciliacion) — colMap es propiedad de
// este módulo, no puede reasignarse desde un binding importado.
export function setColMap(m){ colMap = m; }

// ═══════════════════════════════════════════
// PARSER TADA — v5 (sin forward-fill, grupos de 3)
// ═══════════════════════════════════════════
export function buildColMap(raw){
  if(!raw||raw.length<3) return {map:[],firstDayCol:-1,error:'Menos de 3 filas'};
  const maxCols=Math.max(...raw.slice(0,4).map(r=>Array.isArray(r)?r.length:0));
  const h0=Array.from({length:maxCols},(_,i)=>raw[0]?.[i]??'');
  const h1=Array.from({length:maxCols},(_,i)=>raw[1]?.[i]??'');
  const h2=Array.from({length:maxCols},(_,i)=>raw[2]?.[i]??'');

  // Detectar firstDayCol dinámicamente
  let firstDayCol=-1;
  for(let i=0;i<maxCols;i++){
    const v=String(h0[i]||'').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    if(DAYS_ES.has(String(h0[i]||'').trim().toUpperCase())||DAYS_ES.has(v)){ firstDayCol=i; break; }
  }
  if(firstDayCol<0) return {map:[],firstDayCol:-1,error:'No se detectó ningún día válido en fila 0'};

  const map=[];

  // Columnas fijas (antes de firstDayCol) — detectar por nombre en fila 2
  for(let i=0;i<firstDayCol;i++){
    const v2=normStr(String(h2[i]||''));
    let name=null;
    if(v2==='ciudad'||v2==='city') name='ciudad';
    else if(v2.includes('seller')||v2.includes('tienda')||v2.includes('punto')) name='seller';
    else if(v2.includes('domicili')||v2==='piloto'||v2.includes('nombre')||v2.includes('conductor')||v2.includes('driver')) name='piloto';
    if(name) map.push({t:'f',n:name,i});
  }

  // Bloque de días: 21 cols (7×3). Día = h0[ groupStart ], sub = h1[i], fecha = h2[i]
  for(let i=firstDayCol;i<firstDayCol+21&&i<maxCols;i++){
    const groupStart=firstDayCol+Math.floor((i-firstDayCol)/3)*3;
    const diaRaw=String(h0[groupStart]||'').trim();
    const subRaw=String(h1[i]||'').trim();
    const sub=normStr(subRaw);
    let metric=null;
    if(sub.startsWith('paq')) metric='paquetes';
    else if(sub.startsWith('inc')) metric='incentivos';
    else if(sub.startsWith('can')) metric='cancelados';
    if(!metric) continue;
    const fecha=parseDate(h2[i])||'';
    map.push({t:'d',dia:diaRaw,metric,fecha,i});
  }

  // Columnas extra/semanales (después del bloque)
  for(let i=firstDayCol+21;i<maxCols;i++){
    const v=normStr(String(h1[i]||'')||String(h2[i]||''));
    if(!v) continue;
    let name=null;
    if(v.includes('tarea')) name='tareas';
    else if(v==='garantizado basico') name='garantizado_tada';
    else if(v.includes('garantiza')) name='garantizado';
    else if(v.includes('bono')) name='bonos';
    else if(v.includes('ajuste')||v.includes('novedad')) name='ajustes';
    if(name) map.push({t:'e',n:name,i});
  }

  return {map,firstDayCol,error:null};
}

// ═══════════════════════════════════════════
// CARGA DE ARCHIVOS
// ═══════════════════════════════════════════
export function doDrag(e,src,on){ e.preventDefault(); document.getElementById('dz-'+src).classList.toggle('drag',!!on); }
export function doDrop(e,src){ e.preventDefault(); doDrag(e,src,0); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0],src); }

export function removeFile(src){
  if(src==='tada'){ tadaRaw=[]; loadedTada=false; colMap=[]; document.getElementById('lbl-tada').textContent='Excel TADA semanal'; document.getElementById('dz-tada').classList.remove('loaded'); document.getElementById('actions-tada').style.display='none'; }
  else{ mallaRaw=[]; loadedMalla=false; document.getElementById('lbl-malla').textContent='Malla operativa Pibox'; document.getElementById('dz-malla').classList.remove('loaded'); document.getElementById('actions-malla').style.display='none'; }
  // Reset input file para poder volver a seleccionar el mismo archivo
  const inp=document.getElementById('inp-'+src); if(inp) inp.value='';
  updateLoadStatus();
}

export function replaceFile(src){
  // Simular click en el input oculto
  removeFile(src);
  document.getElementById('inp-'+src).click();
}

export function loadFile(file,src){
  if(!file) return;
  showProcessing(`Leyendo ${src==='tada'?'archivo TADA':'malla Pibox'}...`);
  const reader=new FileReader();
  reader.onload=e=>{
    const wb=XLSX.read(e.target.result,{type:'array',raw:true,cellDates:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    if(src==='tada'){
      // Leer TADA con raw:true en TODAS las filas — incluyendo fila 2 (fechas)
      // raw:false convierte datetimes a strings locales del navegador (ej: "5/11/2026")
      // que parseDate puede invertir día/mes cuando ambos son ≤ 12.
      // Con raw:true las fechas llegan como seriales numéricos de Excel (ej: 46162)
      // que parseDate convierte vía XLSX.SSF.parse_date_code → siempre correcto.
      tadaRaw = XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:false});
      loadedTada=true;
      document.getElementById('lbl-tada').textContent=file.name+' ✓';
      document.getElementById('dz-tada').classList.add('loaded');
      document.getElementById('actions-tada').style.display='flex';
    } else {
      // Leer malla con raw:true para obtener seriales de fecha de Excel
      // y convertirlos a YYYY-MM-DD de forma confiable
      const mallaRawArr = XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});
      mallaRaw = mallaRawArr.map(row=>{
        const nr={...row};
        for(const k of Object.keys(nr)){
          // Convertir cualquier campo que parezca fecha
          if(/fecha/i.test(k)){
            const parsed = parseDate(nr[k]);
            if(parsed) nr[k] = parsed;
          }
          // Convertir horas (seriales decimales de Excel → HH:MM)
          if(/hora|turno|inicio|final/i.test(k) && typeof nr[k]==='number' && nr[k]<1){
            const totalMins = Math.round(nr[k] * 24 * 60);
            const hh = Math.floor(totalMins/60).toString().padStart(2,'0');
            const mm = (totalMins%60).toString().padStart(2,'0');
            nr[k] = `${hh}:${mm}`;
          }
        }
        return nr;
      });
      loadedMalla=true;
      document.getElementById('lbl-malla').textContent=file.name+' ✓';
      document.getElementById('dz-malla').classList.add('loaded');
      document.getElementById('actions-malla').style.display='flex';
    }
    hideProcessing();
    updateLoadStatus();
  };
  reader.readAsArrayBuffer(file);
}

export function updateLoadStatus(){
  const status=document.getElementById('load-status');
  const btn=document.getElementById('btn-continuar');
  const hint=document.getElementById('continuar-hint');
  if(loadedTada&&loadedMalla){
    status.innerHTML='<span style="color:var(--green)">✓ Ambos archivos listos</span>';
    btn.disabled=false;
    hint.textContent='Valida los archivos y haz clic en Continuar';
  } else {
    const falta=[]; if(!loadedTada) falta.push('TADA'); if(!loadedMalla) falta.push('Malla Pibox');
    status.textContent=`Falta cargar: ${falta.join(', ')}`;
    btn.disabled=true;
    hint.textContent='Carga ambos archivos para continuar';
  }
}

// ═══════════════════════════════════════════
// PERÍODO DE LA MALLA — usado por email.js e historial.js
// ═══════════════════════════════════════════
export function calcularPeriodoMalla(){
  // Detectar fechas mínima y máxima de la malla para construir el período
  const mKeys = Object.keys(mallaRaw[0]||{});
  const mFKey = mKeys.find(k=>/^fecha$/i.test(k.trim()))||mKeys.find(k=>/fecha/i.test(k))||'FECHA';
  const fechas = mallaRaw
    .map(r=>String(r[mFKey]||'').trim())
    .filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  if(!fechas.length) return null;
  const min = fechas[0], max = fechas[fechas.length-1];

  const MESES=['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
  const fmt = iso => {
    const [y,m,d] = iso.split('-').map(Number);
    return `${d} de ${MESES[m-1]} de ${y}`;
  };
  // Si mismo mes: "11 al 17 de mayo de 2026"
  const [y1,m1,d1] = min.split('-').map(Number);
  const [y2,m2,d2] = max.split('-').map(Number);
  if(m1===m2 && y1===y2)
    return `${d1} al ${d2} de ${MESES[m1-1]} de ${y1}`;
  return `${fmt(min)} al ${fmt(max)}`;
}

// ═══════════════════════════════════════════
// DIAGNÓSTICO
// ═══════════════════════════════════════════
export function runDiagnostico(){
  clearLog('log-diag');
  document.getElementById('btn-norm').disabled=true;
  if(!tadaRaw||tadaRaw.length<1){ addLog('log-diag','[ERR] Archivo TADA vacío','err'); return; }
  const totalRows=tadaRaw.length, totalCols=tadaRaw[0]?.length||0;
  addLog('log-diag',`[INFO] Dimensiones: ${totalRows} filas × ${totalCols} columnas`,'info');

  const SHOW=Math.min(16,totalCols);
  const RLAB=['F0','F1','F2','D0'], RCLS=['rc-h0','rc-h1','rc-h2','rc-data'];
  let gridHtml='<table class="raw-table"><tbody>';
  for(let ri=0;ri<Math.min(4,tadaRaw.length);ri++){
    gridHtml+=`<tr><td class="rc-label">${RLAB[ri]}</td>`;
    for(let ci=0;ci<SHOW;ci++){ const v=tadaRaw[ri]?.[ci]; const s=(v===''||v===null||v===undefined)?'·':String(v).slice(0,14); gridHtml+=`<td class="${RCLS[ri]}${s==='·'?' rc-empty':''}">${s}</td>`; }
    if(totalCols>SHOW) gridHtml+=`<td class="rc-label">+${totalCols-SHOW}</td>`;
    gridHtml+='</tr>';
  }
  gridHtml+='</tbody></table>';
  document.getElementById('raw-grid').innerHTML=gridHtml;

  const result=buildColMap(tadaRaw);
  colMap=result.map;

  if(result.error){ addLog('log-diag',`[ERR] ${result.error}`,'err'); document.getElementById('col-map-tags').innerHTML=`<span style="color:var(--red);font-size:11px;">${result.error}</span>`; document.getElementById('day-col-tags').innerHTML=''; return; }
  addLog('log-diag',`[INFO] Primera columna de días: col ${result.firstDayCol}`,'info');

  document.getElementById('col-map-tags').innerHTML=colMap.map(c=>{
    if(c.t==='f') return `<span class="col-tag ct-fixed">FIJO:${c.n} [${c.i}]</span>`;
    if(c.t==='d') return `<span class="col-tag ct-day">${c.dia}/${c.metric}/${c.fecha||'?'} [${c.i}]</span>`;
    if(c.t==='e') return `<span class="col-tag ct-extra">EXTRA:${c.n} [${c.i}]</span>`;
    return '';
  }).join('')||'<span style="color:var(--red);font-size:11px;">Sin columnas</span>';

  const dayCols=colMap.filter(c=>c.t==='d'), fixedCols=colMap.filter(c=>c.t==='f'), extraCols=colMap.filter(c=>c.t==='e');
  document.getElementById('day-col-tags').innerHTML=dayCols.map(c=>`<span class="col-tag ct-day">${c.dia}_${c.metric}_${c.fecha||'?'}</span>`).join('')||'<span style="color:var(--red);font-size:11px;">⚠ Sin columnas de días</span>';
  addLog('log-diag',`[INFO] Columnas fijas: ${fixedCols.map(c=>c.n).join(', ')||'ninguna'}`,'info');
  addLog('log-diag',`[INFO] Columnas días: ${dayCols.length} (esperado 21)`,'info');
  addLog('log-diag',`[INFO] Columnas extra: ${extraCols.map(c=>c.n).join(', ')||'ninguna'}`,'info');
  const dataRows=tadaRaw.slice(3).filter(r=>r.some(v=>v!==''&&v!==null&&v!==undefined));
  addLog('log-diag',`[INFO] Pilotos: ${dataRows.length}`,'info');
  if(dataRows.length>0&&fixedCols.length>0){
    const pCol=fixedCols.find(c=>c.n==='piloto'); const fr=dataRows[0];
    if(pCol) addLog('log-diag',`[INFO] Primer piloto: "${fr[pCol.i]}"  · primer día: ${dayCols[0]?.dia} ${dayCols[0]?.fecha}`,'info');
  }
  let ok=true;
  if(dayCols.length===0){ addLog('log-diag','[ERR] No se detectaron columnas de días','err'); ok=false; }
  else if(dayCols.length<21) addLog('log-diag',`[WARN] ${dayCols.length} columnas (esperado 21)`,'warn');
  else addLog('log-diag',`[OK] ${dayCols.length} columnas de días correctas`,'ok');
  if(fixedCols.length<2) addLog('log-diag','[WARN] Menos de 2 columnas fijas detectadas','warn');
  else addLog('log-diag',`[OK] Columnas fijas: ${fixedCols.map(c=>c.n).join(', ')}`,'ok');
  if(ok||dayCols.length>0){ document.getElementById('btn-norm').disabled=false; addLog('log-diag','[OK] Diagnóstico OK — confirma para normalizar','ok'); }
  setMaxStep(1);
  navStep(1);
}
