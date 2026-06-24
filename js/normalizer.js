// ═══════════════════════════════════════════
// NORMALIZACIÓN
// ★ LÓGICA VALORES SEMANALES:
//   - Solo se asignan UNA VEZ por piloto
//   - A la primera fila con actividad (paq>0 OR inc>0 OR can>0)
//   - Si no hay actividad en ningún día → primera fila
// ═══════════════════════════════════════════
import { tadaRaw, mallaRaw, colMap } from './parser.js';
import { addLog, clearLog, showProcessing, hideProcessing, mkTable, unlock } from './ui.js';

export let tadaNorm=[];

// Setter usado por main.js (proceedToConciliacion) — tadaNorm es propiedad de
// este módulo, no puede reasignarse desde un binding importado.
export function setTadaNorm(arr){ tadaNorm = arr; }

export function runNorm(){
  clearLog('log-norm');
  showProcessing('Normalizando datos TADA...');
  setTimeout(()=>{
    tadaNorm=[];
    const fixedCols=colMap.filter(c=>c.t==='f');
    const extraCols =colMap.filter(c=>c.t==='e');
    const dayCols   =colMap.filter(c=>c.t==='d');
    // Agrupar cols de día por (dia, fecha)
    const groups={};
    dayCols.forEach(c=>{
      const key=`${c.dia}||${c.fecha}`;
      if(!groups[key]) groups[key]={dia:c.dia,fecha:c.fecha,cols:{}};
      groups[key].cols[c.metric]=c.i;
    });
    // Ordenar grupos por fecha para cronología
    const sortedGroups=Object.values(groups).sort((a,b)=>a.fecha.localeCompare(b.fecha));

    const parseMoney=v=>{ if(typeof v==='number') return v; if(!v&&v!==0) return 0; return parseFloat(String(v).replace(/[$\s.]/g,'').replace(',','.'))||0; };
    const getExtra=(row,name)=>{ const col=extraCols.find(c=>c.n===name); return col?row[col.i]:0; };

    const dataRows=tadaRaw.slice(3).filter(r=>r.some(v=>v!==''&&v!==null&&v!==undefined));

    dataRows.forEach(row=>{
      const fixed={};
      fixedCols.forEach(c=>{ fixed[c.n]=String(row[c.i]||'').trim(); });
      if(!fixed.piloto||!fixed.piloto.trim()) return;

      // Valores semanales del piloto
      const tareas     =parseInt(getExtra(row,'tareas'))||0;
      const garantizado=parseMoney(getExtra(row,'garantizado'));
      const bonos      =parseMoney(getExtra(row,'bonos'));
      const ajustes    =parseMoney(getExtra(row,'ajustes'));

      // Construir las 7 filas diarias (sin valores semanales aún)
      const filas=sortedGroups.map(g=>({
        piloto:    fixed.piloto,
        ciudad:    fixed.ciudad || (fixed.seller ? String(fixed.seller).split('-')[0].trim() : ''),
        seller:    fixed.seller||'',
        dia:       g.dia,
        fecha:     g.fecha,
        paquetes:  parseInt(row[g.cols.paquetes])||0,
        incentivos:parseInt(row[g.cols.incentivos])||0,
        cancelados:parseInt(row[g.cols.cancelados])||0,
        tareas:0, garantizado:0, bonos:0, ajustes:0, // inicializar en 0
      }));

      // ★ Asignar valores semanales UNA SOLA VEZ
      // Buscar primera fila con actividad (orden cronológico)
      let targetIdx=filas.findIndex(f=>f.paquetes>0||f.incentivos>0||f.cancelados>0);
      if(targetIdx===-1) targetIdx=0; // si no hay actividad, asignar al primer día
      filas[targetIdx].tareas     =tareas;
      filas[targetIdx].garantizado=garantizado;
      filas[targetIdx].bonos      =bonos;
      filas[targetIdx].ajustes    =ajustes;

      tadaNorm.push(...filas);
    });

    const pilotos=[...new Set(tadaNorm.map(r=>r.piloto))];
    addLog('log-norm',`[OK] ${tadaNorm.length} filas · ${pilotos.length} pilotos · 7 días c/u`,'ok');
    addLog('log-norm',`[OK] Valores semanales asignados a 1ª fila con actividad por piloto`,'ok');
    addLog('log-norm',`[INFO] Fechas TADA:  ${[...new Set(tadaNorm.map(r=>r.fecha))].slice(0,5).join(' · ')}`,'info');

    // Mostrar muestra de fechas de la malla para verificar alineación
    if(mallaRaw.length>0){
      const mFKeyNorm = Object.keys(mallaRaw[0]).find(k=>/^fecha$/i.test(k.trim()))||
                        Object.keys(mallaRaw[0]).find(k=>/fecha/i.test(k))||'FECHA';
      const sampleMalla = [...new Set(mallaRaw.map(r=>r[mFKeyNorm]).filter(Boolean))].slice(0,5);
      addLog('log-norm',`[INFO] Fechas Malla: ${sampleMalla.join(' · ')}`,'info');
      // Alerta si los formatos no coinciden
      const tadaFmt  = tadaNorm[0]?.fecha||'';
      const mallaFmt = String(sampleMalla[0]||'');
      const misma = /^\d{4}-\d{2}-\d{2}$/.test(tadaFmt) && /^\d{4}-\d{2}-\d{2}$/.test(mallaFmt);
      if(!misma) addLog('log-norm','[WARN] Formatos de fecha pueden no coincidir — verificar antes de conciliar','warn');
      else addLog('log-norm','[OK] Fechas TADA y Malla en formato YYYY-MM-DD — listas para conciliar','ok');
    }

    if(tadaNorm.length===0){ addLog('log-norm','[ERR] Sin filas normalizadas','err'); hideProcessing(); return; }

    mkTable('tbl-tada-norm',tadaNorm,
      ['piloto','ciudad','seller','dia','fecha','paquetes','incentivos','cancelados','tareas','garantizado','bonos','ajustes'],
      ['Piloto','Ciudad','Seller','Día','Fecha','Paq.','Inc.','Canc.','Tareas','Garantizado','Bonos','Ajustes'],
      null,'tada-norm','tada-norm-data');

    // MALLA — siempre independiente
    if(mallaRaw.length>0){
      const mCols=Object.keys(mallaRaw[0]);
      mkTable('tbl-malla-norm',mallaRaw,mCols,mCols,null,'malla-norm','malla-norm-data');
      const mFKey=mCols.find(k=>/fecha/i.test(k))||'fecha';
      addLog('log-norm',`[INFO] Malla: ${mallaRaw.length} bookings · Fechas: ${[...new Set(mallaRaw.map(r=>r[mFKey]))].slice(0,5).join(' · ')}`,'info');
    } else {
      document.getElementById('tbl-malla-norm').innerHTML='<div style="padding:12px;color:var(--text3);font-size:11px;font-family:var(--mono);">Malla no cargada</div>';
    }

    hideProcessing();
    unlock(2);
  },50);
}
