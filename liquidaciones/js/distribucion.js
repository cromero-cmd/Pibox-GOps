// ═══════════════════════════════════════════
// DISTRIBUCIÓN — de conciliación a nivel de booking
// ═══════════════════════════════════════════
import { mallaRaw } from './parser.js';
import { concResult } from './conciliacion.js';
import { addLog, showProcessing, hideProcessing, mkTable, unlock, setMaxStep } from './ui.js';

export let distResult=[];

export function runDistribucion(){
  showProcessing('Distribuyendo valores a bookings...');
  setTimeout(()=>{
    try{
      distResult=[];
      const mKeys=Object.keys(mallaRaw[0]||{});
      const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
      const mDKey=mKeys.find(k=>/^id[\s_]?piloto$/i.test(k.trim()))||
                  mKeys.find(k=>/id.*piloto|driver.?id/i.test(k))||'ID PILOTO';
      const mSKey=mKeys.find(k=>/seller|punto|tienda/i.test(k))||'SELLER';
      const mHKey=mKeys.find(k=>/inicio.*turno|hora.*inicio|hora_inicio/i.test(k))||
                  mKeys.find(k=>/inicio/i.test(k))||'INICIO DE TURNO';
      const mFKey=mKeys.find(k=>/^fecha$/i.test(k.trim()))||
                  mKeys.find(k=>/fecha/i.test(k))||'FECHA';
      // Columna DÍA — viene como "DÍA" en la malla real
      const mDiaKey=mKeys.find(k=>/^d[íi]a$/i.test(k.trim()))||
                    mKeys.find(k=>/d[íi]a/i.test(k))||null;

      // Niveles que pasan a distribución (los demás se excluyen)
      const NIVELES_OK=new Set(['HIGH','MEDIUM','LOW','FUZZY-HIGH','FUZZY-LOW','MANUAL-OK']);
      concResult.filter(r=>NIVELES_OK.has(r.nivel_confianza)).forEach(row=>{
        const n=row.matches.length;
        [...row.matches].sort((a,b)=>String(a[mHKey]||'').localeCompare(String(b[mHKey]||''))).forEach((m,i)=>{
          const first=i===0;
          // fecha_malla: fecha real del booking en la malla → fuente de verdad para L-J/V-D
          const fechaMalla = String(m[mFKey]||row.fecha||'').trim();
          const diaMalla   = mDiaKey ? String(m[mDiaKey]||'').trim() : '';
          distResult.push({
            booking_id:m[mBKey]||'?', driver_id:m[mDKey]||'PENDIENTE',
            piloto:row.piloto, ciudad:row.ciudad, seller:m[mSKey]||row.seller,
            fecha:row.fecha, fecha_malla:fechaMalla, dia_malla:diaMalla,
            hora_inicio:m[mHKey]||'—',
            paquetes_dist: Math.round(row.paquetes/n),
            incentivos_dist:Math.round(row.incentivos/n),
            cancelados_dist:Math.round(row.cancelados/n),
            tareas_dist:    first?row.tareas:0,
            garantizado:    first?row.garantizado:0,
            bonos:          first?row.bonos:0,
            ajustes:        first?row.ajustes:0,
            garantizado_tada: first?row.garantizado_tada:(row.garantizado_tada===null?null:0),
            nivel_confianza:row.nivel_confianza, n_bookings:n,
          });
        });
      });

      const excluidos=concResult.filter(r=>!['HIGH','MEDIUM','LOW','FUZZY-HIGH','FUZZY-LOW'].includes(r.nivel_confianza)).length;
      document.getElementById('stats-dist').innerHTML=`
        <div class="stat"><div class="stat-l">Bookings generados</div><div class="stat-v">${distResult.length}</div></div>
        <div class="stat"><div class="stat-l">Excluidos (SIN_MALLA + AMBIGUOUS)</div><div class="stat-v r">${excluidos}</div></div>
        <div class="stat"><div class="stat-l">Match exacto (HIGH+MEDIUM)</div><div class="stat-v g">${distResult.filter(r=>['HIGH','MEDIUM'].includes(r.nivel_confianza)).length}</div></div>
        <div class="stat"><div class="stat-l">Fuzzy + LOW (revisión)</div><div class="stat-v y">${distResult.filter(r=>['FUZZY-HIGH','FUZZY-LOW','LOW'].includes(r.nivel_confianza)).length}</div></div>`;

      mkTable('tbl-dist',distResult,
        ['booking_id','driver_id','piloto','ciudad','seller','fecha','fecha_malla','hora_inicio','paquetes_dist','incentivos_dist','cancelados_dist','tareas_dist','garantizado','bonos','ajustes','nivel_confianza'],
        ['Booking ID','Driver ID','Piloto','Ciudad','Seller','Fecha TADA','Fecha Malla','Hora','Paq.','Inc.','Canc.','Tareas','Garantizado','Bonos','Ajustes','Confianza'],null,'dist','dist-data');

    }catch(err){
      addLog('log-norm','[ERR] Error en distribución: '+err.message,'err');
      console.error('runDistribucion error:',err);
    }finally{
      hideProcessing();
      unlock(4);
      setMaxStep(5);
    }
  },50);
}

export function runDistribucionSilent(){
  const mKeys=Object.keys(mallaRaw[0]||{});
  const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
  const mDKey=mKeys.find(k=>/^id[\s_]?piloto/i.test(k.trim()))||'ID PILOTO';
  const mSKey=mKeys.find(k=>/seller|punto|tienda/i.test(k))||'SELLER';
  const mHKey=mKeys.find(k=>/inicio.*turno|hora.*inicio/i.test(k))||'INICIO DE TURNO';
  const mFKey=mKeys.find(k=>/^fecha$/i.test(k.trim()))||'FECHA';
  const mDiaKey=mKeys.find(k=>/^d[íi]a$/i.test(k.trim()))||null;
  const NIVELES_OK=new Set(['HIGH','MEDIUM','LOW','FUZZY-HIGH','FUZZY-LOW','MANUAL-OK']);
  distResult=[];
  concResult.filter(r=>NIVELES_OK.has(r.nivel_confianza)&&!r._excluido_manual).forEach(row=>{
    const n=row.matches.length||1;
    [...row.matches].sort((a,b)=>String(a[mHKey]||'').localeCompare(String(b[mHKey]||''))).forEach((m,i)=>{
      const first=i===0;
      distResult.push({
        booking_id:m[mBKey]||'?', driver_id:m[mDKey]||row.driver_id||'PENDIENTE',
        piloto:row.piloto, ciudad:row.ciudad, seller:m[mSKey]||row.seller,
        fecha:row.fecha, fecha_malla:String(m[mFKey]||row.fecha||'').trim(),
        dia_malla:mDiaKey?String(m[mDiaKey]||'').trim():'',
        hora_inicio:m[mHKey]||'—',
        paquetes_dist:Math.round(row.paquetes/n), incentivos_dist:Math.round(row.incentivos/n),
        cancelados_dist:Math.round(row.cancelados/n),
        tareas_dist:first?row.tareas:0, garantizado:first?row.garantizado:0,
        bonos:first?row.bonos:0, ajustes:first?row.ajustes:0,
        garantizado_tada: first?row.garantizado_tada:(row.garantizado_tada===null?null:0),
        nivel_confianza:row.nivel_confianza, n_bookings:n,
        _manual:row._resolucion_manual||false,
      });
    });
  });

  // Actualizar stats-dist para reflejar el estado post-novedades (incluye MANUAL-OK)
  const manualOkCount = distResult.filter(r=>r.nivel_confianza==='MANUAL-OK').length;
  if(manualOkCount > 0){
    document.getElementById('stats-dist').innerHTML=`
      <div class="stat"><div class="stat-l">Bookings generados</div><div class="stat-v">${distResult.length}</div></div>
      <div class="stat"><div class="stat-l">✓ Confirmados manualmente</div><div class="stat-v" style="color:var(--accent);">${manualOkCount}</div></div>
      <div class="stat"><div class="stat-l">Match exacto (HIGH+MEDIUM)</div><div class="stat-v g">${distResult.filter(r=>['HIGH','MEDIUM','APRENDIDO','FUZZY-HIGH'].includes(r.nivel_confianza)).length}</div></div>
      <div class="stat"><div class="stat-l">Fuzzy + LOW</div><div class="stat-v y">${distResult.filter(r=>['FUZZY-LOW','LOW'].includes(r.nivel_confianza)).length}</div></div>`;
  }
}
