// ═══════════════════════════════════════════
// TEMPLATE TRUMP — lógica financiera (pura) + orquestación (DOM)
// ═══════════════════════════════════════════
import { LS_RUNS, normStr, cop } from './config.js';
import { mallaRaw } from './parser.js';
import { concResult } from './conciliacion.js';
import { distResult } from './distribucion.js';
import { novedades, resoluciones } from './novedades.js';
import { TARIFF_SCHEMA, getAV, getCurrentEdits, getModoGarantizado } from './tariffs.js';
import { addLog, clearLog, showProcessing, hideProcessing, mkTable, unlock, toast } from './ui.js';

export let trumpRows = [];

// ═══════════════════════════════════════════
// CÁLCULO PURO — sin DOM, sin addLog. Aislado para tests unitarios.
// Calco exacto de la lógica financiera original (gross-up, garantizados,
// % Cali, fechas pico/super-pico).
// ═══════════════════════════════════════════
export function buildTrumpRows(distResultIn, t, av, mallaRawIn, modoGarantizado='automatico'){
  const runId=`LIQ-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${av.version}`;

  // ── Porcentajes nacionales ────────────────────────────────
  const pctPlatNac = (t.pct_plataforma    ?? 15) / 100;  // 0.15
  const pctMargNac = (t.pct_margen        ?? 3)  / 100;  // 0.03
  // ── Porcentajes Cali ──────────────────────────────────────
  const pctPlatCal = (t.pct_plataforma_cal ?? 10) / 100; // 0.10
  const pctMargCal = (t.pct_margen_cal     ?? 7)  / 100; // 0.07

  // ── Días valle (L-J) vs pico (V-D) ──────────────────────
  const DIAS_VD_SET = new Set(['viernes','sabado','sábado','domingo','friday','saturday','sunday']);
  const DIAS_LJ_SET = new Set(['lunes','martes','miercoles','miércoles','jueves','monday','tuesday','wednesday','thursday']);

  // Fechas especiales — pico y super pico
  let fechasEspeciales = [];
  try{ fechasEspeciales = JSON.parse(t.fechas_especiales||'[]'); }catch{}

  // Compatibilidad con formato anterior (campo fechas_pico_especiales de texto)
  if(fechasEspeciales.length===0 && t.fechas_pico_especiales){
    const viejas = String(t.fechas_pico_especiales).split(',')
      .map(f=>f.trim()).filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f));
    fechasEspeciales = viejas.map(f=>({fecha:f, tipo:'pico', tarifa_custom:0}));
  }

  // Filtrar por rango de malla
  const mFKeyT = Object.keys(mallaRawIn[0]||{}).find(k=>/^fecha$/i.test(k.trim()))||'FECHA';
  const fechasMalla = mallaRawIn
    .map(r=>String(r[mFKeyT]||'').trim())
    .filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  const mallaMin = fechasMalla[0]||'';
  const mallaMax = fechasMalla[fechasMalla.length-1]||'';

  const fechasEspMap = {}; // fecha → {tipo, tarifa_custom}
  const fechasIgnoradas = [];
  fechasEspeciales.forEach(fe=>{
    const f = String(fe.fecha||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(f)){ return; }
    if(f>=mallaMin && f<=mallaMax) fechasEspMap[f] = fe;
    else fechasIgnoradas.push(f);
  });

  function esDiaLJ(r){
    const fechaRef = String(r.fecha_malla||r.fecha||'').trim();

    // Prioridad 0: fecha especial → siempre V-D (pico o super pico)
    if(fechasEspMap[fechaRef]) return false;

    // Prioridad 1: nombre del día directo de la malla (más confiable)
    if(r.dia_malla){
      const d=r.dia_malla.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
      if(DIAS_VD_SET.has(d)) return false;
      if(DIAS_LJ_SET.has(d)) return true;
    }
    // Prioridad 2: calcular desde fecha_malla como fallback
    try{
      const parts=fechaRef.split('-');
      if(parts.length===3){
        let y=parseInt(parts[0]),p1=parseInt(parts[1]),p2=parseInt(parts[2]);
        let mon=p1>12?p2:p1, day=p1>12?p1:p2;
        const dow=new Date(y,mon-1,day).getDay();
        return dow>=1&&dow<=4;
      }
    }catch{}
    return true; // default L-J
  }

  const rows = distResultIn
    .filter(r=>r.booking_id!=='__EXCLUIDO__' && r.booking_id!=='?' && r.booking_id!=='SIN BOOKING')
    .map(r=>{
    const lj = esDiaLJ(r);

    // ── Seleccionar porcentajes según ciudad ─────────────
    // Cali (CAL) tiene comisión plataforma 10% y margen 7%
    // Resto del país: 15% y 3%
    const esCali = normStr(r.ciudad||'') === 'cal';
    const pctPlat = esCali ? pctPlatCal : pctPlatNac;
    const pctMarg = esCali ? pctMargCal : pctMargNac;

    // ── Tarifas cobro cliente ────────────────────────────
    const cPaq = t.c_paquete    ?? 8870;
    const cInc = t.c_incentivo  ?? 1580;
    const cCan = t.c_cancelado  ?? 8505;
    const cTar = t.c_tarea      ?? 6075;
    const cGarLJ = t.c_gar_lj   ?? 85050;
    const cGarVD = t.c_gar_vd   ?? 97200;

    // ── Tarifas pago piloto (neto) ───────────────────────
    const pPaq = t.p_paquete    ?? 7300;
    const pInc = t.p_incentivo  ?? 1300;
    const pCan = t.p_cancelado  ?? 7000;
    const pTar = t.p_tarea      ?? 5000;
    const pMinLJ = t.p_min_lj   ?? 70000;
    const pMinVD = t.p_min_vd   ?? 80000;

    // ── Ingresos operativos netos del piloto (sin tareas) ─
    // Tareas van en ADDITIONAL_FINAL_COST, no en FINAL_COST
    const ingresoNeto = r.paquetes_dist   * pPaq
                      + r.incentivos_dist * pInc
                      + r.cancelados_dist * pCan;

    // ── Cobro operativo a TaDa (sin tareas) ──────────────
    // Tareas van en ADDITIONAL_COMPANY_FINAL_COST
    const cobroOp = r.paquetes_dist   * cPaq
                  + r.incentivos_dist * cInc
                  + r.cancelados_dist * cCan;

    // ── Garantizado ───────────────────────────────────────
    // Para fechas super pico con tarifa custom, se usa esa tarifa como mínimo
    const fechaRef    = String(r.fecha_malla||r.fecha||'').trim();
    const feEsp       = fechasEspMap[fechaRef];
    const tarifaCustom = feEsp && feEsp.tipo==='superpico' && feEsp.tarifa_custom > 0
                         ? feEsp.tarifa_custom : 0;

    const minimoNeto  = tarifaCustom > 0 ? tarifaCustom : (lj ? pMinLJ : pMinVD);
    const tarifaGarCl = tarifaCustom > 0
                         ? Math.ceil(tarifaCustom / (1-pctMarg) / (1-pctPlat))
                         : (lj ? cGarLJ : cGarVD);

    let complementoPiloto = 0;
    let cobroGarantizado  = 0;
    let modoGarantizadoFila = 'automatico';

    if(modoGarantizado==='tada' && r.garantizado_tada != null){
      // Modo TaDa: el garantizado viene directo del archivo TADA (complemento
      // semanal neto ya calculado por TaDa) — reemplaza el cálculo automático.
      // Gross-up con los mismos % de margen/plataforma ya resueltos por ciudad.
      complementoPiloto = Number(r.garantizado_tada) || 0;
      cobroGarantizado  = complementoPiloto > 0
        ? Math.ceil(complementoPiloto / (1-pctMarg) / (1-pctPlat))
        : 0;
      modoGarantizadoFila = 'tada';
    } else if(ingresoNeto < minimoNeto){
      complementoPiloto = minimoNeto - ingresoNeto;
      cobroGarantizado = tarifaGarCl > cobroOp ? tarifaGarCl : cobroOp;
    }

    // ── Additional: tareas + bonos + ajustes ─────────────
    // Tareas: tarifa fija × unidades (neto piloto)
    // Bonos/ajustes: valores netos directos de TADA
    const vTarPiloto = r.tareas_dist * pTar;  // neto piloto
    const vTarCliente= r.tareas_dist * cTar;  // cobro cliente
    const bonos   = r.bonos   || 0;
    const ajustes = r.ajustes || 0;
    const adicNeto    = vTarPiloto + bonos + ajustes;  // pago piloto referencia
    const adicCliente = vTarCliente + bonos + ajustes; // base para gross-up cliente

    // ── COMPANY_FINAL_COST (cobro a TaDa) ────────────────
    const COMPANY_FINAL_COST = cobroGarantizado > 0 ? cobroGarantizado : cobroOp;

    // ── FINAL_COST ────────────────────────────────────────
    // Cascada desde COMPANY_FINAL_COST replicando la lógica de Trump:
    //   FINAL_COST = COMPANY_FINAL_COST × (1 - pct_margen)
    //   Trump descuenta pct_plataforma → piloto recibe FINAL_COST × (1 - pct_plat)
    // Esto garantiza que el valor coincida con el pago automático de Trump
    // y no genere ajustes negativos al piloto.
    // Math.floor garantiza que FINAL_COST nunca supere el valor exacto
    // evitando que Trump rechace por "comisión insuficiente" por centavos
    const FINAL_COST = Math.floor(COMPANY_FINAL_COST * (1 - pctMarg));

    // ── ADDITIONAL_FINAL_COST ─────────────────────────────
    // Trump NO descuenta plataforma en este campo.
    // → va el neto directo al piloto (tareas neto + bonos + ajustes)
    // No aplicar cascada aquí porque overpaga al piloto.
    const ADDITIONAL_FINAL_COST = adicNeto;

    // ── ADDITIONAL_COMPANY_FINAL_COST ────────────────────
    // Tareas: tarifa fija de cobro (ya incluye margen) → sin gross-up
    // Bonos/ajustes: gross-up secuencial desde neto
    const adicBonosAjustesGrossed = (bonos + ajustes) > 0
      ? Math.round((bonos + ajustes) / (1 - pctMarg) / (1 - pctPlat))
      : 0;
    const ADDITIONAL_COMPANY_FINAL_COST = vTarCliente + adicBonosAjustesGrossed;

    // ── COMMENTS detallado (auditoría interna) ───────────
    const COMMENTS =
      `Fecha malla:${r.fecha_malla||r.fecha} Dia:${lj?'L-J':'V-D'} ${esCali?'[CAL plat:'+Math.round(pctPlat*100)+'%]':''} | `+
      `Paq:${r.paquetes_dist}x${cop(pPaq)}=${cop(r.paquetes_dist*pPaq)} | `+
      `Inc:${r.incentivos_dist}x${cop(pInc)}=${cop(r.incentivos_dist*pInc)} | `+
      `Can:${r.cancelados_dist}x${cop(pCan)}=${cop(r.cancelados_dist*pCan)} | `+
      `[Additional] Tar:${r.tareas_dist}x${cop(pTar)}=${cop(vTarPiloto)} | `+
      `Min:${cop(minimoNeto)} Ingreso:${cop(ingresoNeto)} Compl:${cop(complementoPiloto)} | `+
      `Bonos:${cop(bonos)} Aj:${cop(ajustes)} | Conf:${r.nivel_confianza}`;

    // ── COMMENTS_PILOTO para Trump (sin caracteres especiales) ──
    // Sin tildes, comas, puntos, simbolos, enes — solo letras numeros y espacios
    function copClean(n){ return Math.round(Math.abs(n)).toLocaleString('es-CO').replace(/[^0-9]/g,''); }
    const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    function fechaLegible(fechaStr){
      // Parsear YYYY-MM-DD o YYYY-DD-MM robusto
      try{
        const p=String(fechaStr||'').trim().split('-');
        if(p.length===3){
          let y=parseInt(p[0]), p1=parseInt(p[1]), p2=parseInt(p[2]);
          let mon=p1>12?p2:p1, day=p1>12?p1:p2;
          return `${day} ${MESES[mon-1]||''}`;
        }
      }catch{}
      return fechaStr||'';
    }
    const fechaDisplay = fechaLegible(r.fecha_malla||r.fecha);
    const COMMENTS_PILOTO =
      `Servicio ${fechaDisplay} `+
      `Paq ${r.paquetes_dist} `+
      `Inc ${r.incentivos_dist} `+
      `Can ${r.cancelados_dist} `+
      `Tar ${r.tareas_dist} `+
      (complementoPiloto>0 ? `Garantizado ${copClean(minimoNeto)} ` : '')+
      (vTarPiloto>0        ? `Tareas ${r.tareas_dist} `              : '')+
      (bonos>0             ? `Bonos ${copClean(bonos)} `             : '')+
      (ajustes!==0         ? `Aj ${copClean(Math.abs(ajustes))} `    : '')+
      `COP`;

    return {
      BOOKING_ID:                    r.booking_id,
      COMPANY_FINAL_COST,
      ADDITIONAL_COMPANY_FINAL_COST,
      DISPUTED_COMPANY_FINAL_COST:   '',
      FINAL_COST,
      ADDITIONAL_FINAL_COST,
      DISPUTED_FINAL_COST:           '',
      PACKAGES_COUNT:                r.paquetes_dist,
      IS_PER_HOUR:                   0,
      COMMENTS,
      COMMENTS_PILOTO,
      // Metadata interna
      _driver_id:   r.driver_id,
      _piloto:      r.piloto,
      _ciudad:      r.ciudad,
      _seller:      r.seller,
      _fecha:       r.fecha_malla||r.fecha,
      _dia:         r.dia_malla||'',
      _dia_tipo:    lj?'L-J':'V-D',
      _paquetes:    r.paquetes_dist||0,
      _incentivos:  r.incentivos_dist||0,
      _cancelados:  r.cancelados_dist||0,
      _tareas:      r.tareas_dist||0,
      _ingreso_neto:ingresoNeto,
      _complemento: complementoPiloto,
      _cobro_garantizado: cobroGarantizado,
      _modo_garantizado:  modoGarantizadoFila,
      _confianza:   r.nivel_confianza,
      _run_id:      runId,
      _ver:         av.version,
    };
  });

  const nEsp = Object.keys(fechasEspMap).length;
  return {
    rows,
    meta:{ runId, fechasEspMap, fechasIgnoradas, nEsp, mallaMin, mallaMax },
  };
}

// ═══════════════════════════════════════════
// CÁLCULO PURO — filas de "Incluir en $0" (anulación de booking)
// Registros marcados en Novedades con accion:'cero' — existen en la malla
// con booking real pero deben entrar al template con todos los campos
// financieros en 0 (anula cualquier valor previo que Trump tuviera para ese
// booking). Aislado de buildTrumpRows porque no depende de distResult —
// la fuente de verdad es resoluciones{}, no la distribución normal.
// ═══════════════════════════════════════════
export function buildCeroRows(novedadesIn, resolucionesIn){
  return novedadesIn
    .filter(n => resolucionesIn[n.clave]?.accion === 'cero')
    .map(n => {
      const res = resolucionesIn[n.clave];
      return {
        BOOKING_ID:                    res.booking_id,
        COMPANY_FINAL_COST:            0,
        ADDITIONAL_COMPANY_FINAL_COST: 0,
        DISPUTED_COMPANY_FINAL_COST:   '',
        FINAL_COST:                    0,
        ADDITIONAL_FINAL_COST:         0,
        DISPUTED_FINAL_COST:           '',
        PACKAGES_COUNT:                0,
        IS_PER_HOUR:                   0,
        COMMENTS:                      'Anulacion $0',
        COMMENTS_PILOTO:               'Anulacion $0',
        _confianza:                    'CERO',
        _piloto:                       n.piloto,
        _ciudad:                       n.ciudad,
        _fecha:                        n.fecha,
      };
    });
}

// ═══════════════════════════════════════════
// ORQUESTADOR — DOM, logging, persistencia local
// ═══════════════════════════════════════════
export function runTrump(){
  showProcessing('Generando template Trump...');
  setTimeout(()=>{
    const t=getCurrentEdits(), av=getAV();
    const modoGarantizado = getModoGarantizado();
    const {rows, meta} = buildTrumpRows(distResult, t, av, mallaRaw, modoGarantizado);
    const ceroRows = buildCeroRows(novedades, resoluciones);
    trumpRows = rows.concat(ceroRows);

    if(modoGarantizado==='tada' && !distResult.some(r=>r.garantizado_tada!=null))
      addLog('log-trump','[WARN] Columna "Garantizado Basico" no encontrada en TADA — usando cálculo automático','warn');

    if(meta.nEsp>0)
      addLog('log-trump',`[INFO] Fechas especiales aplicadas (${meta.nEsp}): ${Object.entries(meta.fechasEspMap).map(([f,fe])=>`${f}(${fe.tipo}${fe.tarifa_custom?'/'+fe.tarifa_custom:''})`).join(' · ')}`,'ok');
    if(meta.fechasIgnoradas.length>0)
      addLog('log-trump',`[INFO] Fechas especiales fuera del rango (${meta.mallaMin} → ${meta.mallaMax}) — ignoradas: ${meta.fechasIgnoradas.join(' · ')}`,'info');

    const tp = trumpRows.reduce((a,r)=>a + r.FINAL_COST        + r.ADDITIONAL_FINAL_COST,         0);
    const tc = trumpRows.reduce((a,r)=>a + r.COMPANY_FINAL_COST + r.ADDITIONAL_COMPANY_FINAL_COST, 0);
    const margen = tc - tp;
    const margenPct = tc > 0 ? ((margen/tc)*100).toFixed(1) : '0.0';
    const rev = trumpRows.filter(r=>!['HIGH','FUZZY-HIGH'].includes(r._confianza)).length;

    document.getElementById('stats-trump').innerHTML=`
      <div class="stat"><div class="stat-l">Bookings</div><div class="stat-v">${trumpRows.length}</div></div>
      <div class="stat"><div class="stat-l">Total pago pilotos (FINAL_COST)</div><div class="stat-v g" style="font-size:13px;">${cop(tp)}</div></div>
      <div class="stat"><div class="stat-l">Total cobro TaDa (COMPANY)</div><div class="stat-v b" style="font-size:13px;">${cop(tc)}</div></div>
      <div class="stat"><div class="stat-l">Margen bruto</div>
        <div class="stat-v ${margen>=0?'g':'r'}" style="font-size:13px;">${cop(margen)}</div>
        <div style="font-size:11px;font-family:var(--mono);color:${margen>=0?'var(--green)':'var(--red)'};margin-top:4px;">${margenPct}% sobre cobro</div>
      </div>
      ${ceroRows.length>0?`<div class="stat"><div class="stat-l">⓪ Registros en $0</div><div class="stat-v y">${ceroRows.length}</div></div>`:''}
      ${modoGarantizado==='tada'?`<div class="stat"><div class="stat-l">📋 Garantizado</div><div class="stat-v" style="color:var(--purple);">Modo TaDa activo</div></div>`:''}`;

    const TC=['BOOKING_ID','COMPANY_FINAL_COST','ADDITIONAL_COMPANY_FINAL_COST',
      'DISPUTED_COMPANY_FINAL_COST','FINAL_COST','ADDITIONAL_FINAL_COST',
      'DISPUTED_FINAL_COST','PACKAGES_COUNT','IS_PER_HOUR','COMMENTS_PILOTO'];
    const TC_HEADS=['BOOKING_ID','COMPANY_FINAL_COST','ADDITIONAL_COMPANY_FINAL_COST',
      'DISPUTED_COMPANY_FINAL_COST','FINAL_COST','ADDITIONAL_FINAL_COST',
      'DISPUTED_FINAL_COST','PACKAGES_COUNT','IS_PER_HOUR','COMMENTS'];
    mkTable('tbl-trump',trumpRows,TC,TC_HEADS,
      r=>!['HIGH','FUZZY-HIGH'].includes(r._confianza)?' style="background:rgba(240,190,53,0.04)"':'','trump','trump-data');

    clearLog('log-trump');
    addLog('log-trump',`[OK] run_id: ${meta.runId} · tarifas: ${av.version} · ${trumpRows.length} bookings`,'ok');
    addLog('log-trump',`[OK] Cobro TaDa: ${cop(tc)} · Pago pilotos: ${cop(tp)} · Margen: ${cop(margen)}`,'ok');
    if(margen < 0) addLog('log-trump',`[ERR] Margen negativo — revisar tarifas o distribución`,'err');

    // Detalle de garantizados aplicados
    const conGar = trumpRows.filter(r=>r._complemento>0);
    if(conGar.length){
      addLog('log-trump',`[INFO] ${conGar.length} bookings con garantizado aplicado`,'info');
      conGar.forEach(r=>{
        if(r._modo_garantizado==='tada')
          addLog('log-trump',`[MODO-TADA] Garantizado TaDa aplicado: ${r._piloto} · pago ${cop(r._complemento)} · cobro ${cop(r._cobro_garantizado)}`,'info');
        else
          addLog('log-trump',`[AUTO] Garantizado automático: ${r._piloto} · pago ${cop(r._complemento)} · cobro ${cop(r._cobro_garantizado)}`,'info');
      });
    }

    trumpRows.filter(r=>r._confianza==='MEDIUM').forEach(r=>addLog('log-trump',`[MED] ${r.BOOKING_ID} — dist. equitativa`,'warn'));
    trumpRows.filter(r=>r._confianza==='LOW').forEach(r=>addLog('log-trump',`[LOW] ${r.BOOKING_ID} · ${r._piloto}`,'warn'));
    ceroRows.forEach(r=>addLog('log-trump',`[CERO] ${r.BOOKING_ID} · ${r._piloto} · ${r._fecha}`,'warn'));
    trumpRows.filter(r=>r._confianza==='MANUAL-OK').forEach(r=>
      addLog('log-trump',
        `[MANUAL-OK] ${r._piloto} · ${r._fecha} · ${r.BOOKING_ID} · ${cop(r.COMPANY_FINAL_COST+r.ADDITIONAL_COMPANY_FINAL_COST)}`,
        'info'));
    // Mismo criterio que el bucket SIN_MALLA de buildExclusiones() — una vez
    // resuelto (ok/excluir/pendiente) ya lo cubren los logs [PEND]/[EXCL] de
    // abajo; loguearlo aquí también duplicaría la línea.
    concResult.filter(r=>r.nivel_confianza==='SIN_MALLA'&&!r._resolucion_manual&&!r._excluido_manual).forEach(r=>
      addLog('log-trump',`[EXCL] ${r.piloto} · ${r.fecha} — SIN_MALLA`,'err'));
    concResult.filter(r=>r._excluido_manual&&r._accion_manual==='excluir').forEach(r=>
      addLog('log-trump',`[EXCL] ${r.piloto} · ${r.fecha} — excluido manualmente`,'err'));
    concResult.filter(r=>r._excluido_manual&&!r._accion_manual).forEach(r=>
      addLog('log-trump',`[PEND] ${r.piloto} · ${r.fecha} — pendiente no resuelto`,'warn'));
    distResult.filter(r=>r.booking_id==='__EXCLUIDO__').forEach(r=>
      addLog('log-trump',`[EXCL] ${r.piloto} · ${r.fecha_malla||r.fecha} — SIN_BOOKING excluido`,'err'));

    // Mostrar resumen visual de exclusiones
    renderResumenExclusiones(trumpRows.length);

    try{
      const runs=JSON.parse(localStorage.getItem(LS_RUNS)||'[]');
      runs.push({
        run_id:meta.runId, fecha_ejecucion:new Date().toISOString(),
        version_tarifas_usada:av.version, snapshot_tarifas:{...av.values},
        bookings_generados:trumpRows.length,
        sin_malla:concResult.filter(r=>r.nivel_confianza==='SIN_MALLA').length,
        requieren_revision:rev,
        cobro_tada:tc, pago_pilotos:tp, margen,
      });
      localStorage.setItem(LS_RUNS,JSON.stringify(runs.slice(-50)));
    }catch(e){}

    hideProcessing();
    unlock(6);
  },50);
}

// ═══════════════════════════════════════════
// DESCARGA TRUMP — 5 HOJAS
// ═══════════════════════════════════════════
export function downloadTrump(){
  if(!trumpRows.length) return;
  const av=getAV(), runId=trumpRows[0]?._run_id||'LIQ';
  // Hoja 1: Template Trump — COMMENTS_PILOTO va en la columna COMMENTS (limpio para Trump)
  const TC_TRUMP=['BOOKING_ID','COMPANY_FINAL_COST','ADDITIONAL_COMPANY_FINAL_COST',
    'DISPUTED_COMPANY_FINAL_COST','FINAL_COST','ADDITIONAL_FINAL_COST',
    'DISPUTED_FINAL_COST','PACKAGES_COUNT','IS_PER_HOUR','COMMENTS'];
  const ws1=XLSX.utils.json_to_sheet(trumpRows.map(r=>({
    BOOKING_ID:                    r.BOOKING_ID,
    COMPANY_FINAL_COST:            r.COMPANY_FINAL_COST,
    ADDITIONAL_COMPANY_FINAL_COST: r.ADDITIONAL_COMPANY_FINAL_COST,
    DISPUTED_COMPANY_FINAL_COST:   '',
    FINAL_COST:                    r.FINAL_COST,
    ADDITIONAL_FINAL_COST:         r.ADDITIONAL_FINAL_COST,
    DISPUTED_FINAL_COST:           '',
    PACKAGES_COUNT:                r.PACKAGES_COUNT,
    IS_PER_HOUR:                   0,
    COMMENTS:                      r.COMMENTS_PILOTO, // versión limpia para Trump
  })));
  ws1['!cols']=TC_TRUMP.map(c=>({wch:c==='COMMENTS'?55:c==='BOOKING_ID'?18:26}));

  // Hoja 1b: Referencia interna con COMMENTS detallado para auditoría
  // TIPO distingue bookings normales de anulaciones a $0 (sin separarlos
  // de la hoja "Template Trump" — ambos deben procesarse juntos en Trump).
  const ws1b=XLSX.utils.json_to_sheet(trumpRows.map(r=>({
    BOOKING_ID:       r.BOOKING_ID,
    TIPO:             r._confianza==='CERO' ? 'ANULACION_CERO' : 'NORMAL',
    PILOTO:           r._piloto,
    CIUDAD:           r._ciudad,
    SELLER:           r._seller,
    FECHA_MALLA:      r._fecha,
    DIA_TIPO:         r._dia_tipo,
    INGRESO_NETO:     r._ingreso_neto,
    COMPLEMENTO:      r._complemento,
    FINAL_COST:       r.FINAL_COST,
    COMPANY_FINAL_COST: r.COMPANY_FINAL_COST,
    CONFIANZA:        r._confianza,
    COMMENTS_DETALLE: r.COMMENTS,
    COMMENTS_PILOTO:  r.COMMENTS_PILOTO,
  })));
  ws1b['!cols']=[{wch:18},{wch:16},{wch:24},{wch:10},{wch:30},{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:18},{wch:12},{wch:80},{wch:55}];
  const mKeys=Object.keys(mallaRaw[0]||{});
  const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
  const mFKey=mKeys.find(k=>/^fecha$/i.test(k.trim()))||mKeys.find(k=>/fecha/i.test(k))||'FECHA';
  const mSKey=mKeys.find(k=>/seller/i.test(k))||'SELLER';
  const mPKey=mKeys.find(k=>!/id/i.test(k)&&/nombre.*piloto|nombre de piloto/i.test(k))||
              mKeys.find(k=>!/id/i.test(k)&&/^nombre$/i.test(k.trim()))||
              mKeys.find(k=>!/id/i.test(k)&&/nombre/i.test(k))||'NOMBRE';
  const incon=[];
  concResult.filter(r=>r.nivel_confianza==='SIN_MALLA').forEach(r=>incon.push({tipo:'SIN_MALLA',piloto:r.piloto,fecha:r.fecha,seller:r.seller,booking_id:'—',nota:'Sin match de ningún tipo — excluido'}));
  concResult.filter(r=>r.nivel_confianza==='AMBIGUOUS').forEach(r=>incon.push({tipo:'AMBIGUOUS',piloto:r.piloto,fecha:r.fecha,seller:r.seller,booking_id:'—',nota:r.nota}));
  mallaRaw.filter(m=>!distResult.find(d=>d.booking_id===m[mBKey])).forEach(m=>incon.push({tipo:'HUÉRFANO_MALLA',piloto:m[mPKey]||'',fecha:m[mFKey]||'',seller:m[mSKey]||'',booking_id:m[mBKey]||'?',nota:'Sin valores TADA'}));
  concResult.filter(r=>r.nivel_confianza==='LOW').forEach(r=>incon.push({tipo:'LOW_CONFIDENCE',piloto:r.piloto,fecha:r.fecha,seller:r.seller,booking_id:r.matches.map(m=>m[mBKey]).join('/'),nota:'Fallback piloto+fecha'}));
  concResult.filter(r=>r.nivel_confianza==='FUZZY-LOW').forEach(r=>incon.push({tipo:'FUZZY-LOW',piloto:r.piloto,fecha:r.fecha,seller:r.seller,booking_id:r.matches.map(m=>m[mBKey]).join('/'),nota:r.nota}));
  const ws2=XLSX.utils.json_to_sheet(incon.length?incon:[{tipo:'Sin inconsistencias'}]);
  ws2['!cols']=[{wch:18},{wch:24},{wch:12},{wch:26},{wch:20},{wch:65}];
  const tc2=trumpRows.reduce((a,r)=>a+r.COMPANY_FINAL_COST+r.ADDITIONAL_COMPANY_FINAL_COST,0);
  const tp2=trumpRows.reduce((a,r)=>a+r.FINAL_COST+r.ADDITIONAL_FINAL_COST,0);
  const ws3=XLSX.utils.json_to_sheet([
    {campo:'run_id',                    valor:runId},
    {campo:'fecha_ejecucion',           valor:new Date().toLocaleString('es-CO')},
    {campo:'version_tarifas_usada',     valor:av.version},
    {campo:'autor_tarifa',              valor:av.autor},
    {campo:'bookings_generados',        valor:trumpRows.length},
    {campo:'cobro_total_tada',          valor:tc2},
    {campo:'pago_total_pilotos',        valor:tp2},
    {campo:'margen_bruto',              valor:tc2-tp2},
    {campo:'sin_malla_excluidos',       valor:concResult.filter(r=>r.nivel_confianza==='SIN_MALLA').length},
    {campo:'ambiguous_excluidos',       valor:concResult.filter(r=>r.nivel_confianza==='AMBIGUOUS').length},
    {campo:'bookings_con_garantizado',  valor:trumpRows.filter(r=>r._complemento>0).length},
    {campo:'───────────────',           valor:'SNAPSHOT TARIFAS'},
    ...TARIFF_SCHEMA.map(s=>({campo:s.label, valor:av.values[s.key]??s.def})),
  ]);
  ws3['!cols']=[{wch:34},{wch:46}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws1,'Template Trump');
  XLSX.utils.book_append_sheet(wb,ws1b,'Referencia Interna');
  XLSX.utils.book_append_sheet(wb,ws2,'Inconsistencias');

  // Hoja de exclusiones completa
  const excl = buildExclusiones();
  const ws4 = XLSX.utils.json_to_sheet(excl.length ? excl : [{razon:'Sin exclusiones',descripcion:'Todos los registros fueron incluidos'}]);
  ws4['!cols'] = [{wch:20},{wch:55},{wch:30},{wch:12},{wch:28},{wch:28}];
  XLSX.utils.book_append_sheet(wb,ws4,'Exclusiones');

  XLSX.utils.book_append_sheet(wb,ws3,'Auditoria');
  XLSX.writeFile(wb,`${runId}.xlsx`);
  toast(`✓ ${runId}.xlsx descargado`);
}

// ═══════════════════════════════════════════
// RESUMEN DE EXCLUSIONES
// ═══════════════════════════════════════════
export function buildExclusiones(){
  const excl = [];

  // 1. SIN_MALLA — en TADA pero sin match en la malla, sin resolver en Novedades.
  // BUGFIX: ahora que SIN_MALLA pasa por Novedades, una vez resuelto el flag
  // _excluido_manual (excluir o pendiente) ya lo cubren los buckets 2/3 más
  // abajo — sin este filtro quedaba contado dos veces en el reporte.
  concResult.filter(r=>r.nivel_confianza==='SIN_MALLA'&&!r._resolucion_manual&&!r._excluido_manual).forEach(r=>{
    excl.push({
      razon:'SIN_MALLA',
      descripcion:'Piloto en TADA sin coincidencia en la malla Pibox',
      piloto:r.piloto, ciudad:r.ciudad, seller:r.seller,
      fecha:r.fecha, booking_id:'—',
    });
  });

  // 1b. SIN_TADA — en malla pero sin actividad en TADA
  concResult.filter(r=>r.nivel_confianza==='SIN_TADA'&&!r._resolucion_manual&&!r._excluido_manual&&!r._resolucion_cero).forEach(r=>{
    excl.push({
      razon:'SIN_TADA',
      descripcion:'Booking en malla sin actividad reportada en TADA — pendiente de revisión',
      piloto:r.piloto, ciudad:r.ciudad, seller:r.seller,
      fecha:r.fecha, booking_id:r._booking_malla||'—',
    });
  });

  // 2. Excluidos manualmente en Novedades (acción explícita del analista)
  concResult.filter(r=>r._excluido_manual && r._accion_manual==='excluir').forEach(r=>{
    const bk = r.matches?.[0]?.[Object.keys(mallaRaw[0]||{}).find(k=>/booking/i.test(k))||'BOOKING SERVICIO']||'—';
    excl.push({
      razon:'EXCLUIDO_MANUAL',
      descripcion:`Excluido manualmente en Novedades (nivel original: ${r.nivel_confianza})`,
      piloto:r.piloto, ciudad:r.ciudad, seller:r.seller,
      fecha:r.fecha, booking_id:bk,
    });
  });

  // 3. Pendientes no resueltos — excluidos automáticamente por no tomar acción
  concResult.filter(r=>r._excluido_manual && !r._accion_manual).forEach(r=>{
    const bk = r.matches?.[0]?.[Object.keys(mallaRaw[0]||{}).find(k=>/booking/i.test(k))||'BOOKING SERVICIO']||'—';
    excl.push({
      razon:'PENDIENTE',
      descripcion:`Novedad tipo ${r._nivel_original||r.nivel_confianza} no resuelta — excluida automáticamente`,
      piloto:r.piloto, ciudad:r.ciudad, seller:r.seller,
      fecha:r.fecha, booking_id:bk,
    });
  });

  // 3. SIN_BOOKING — en malla sin booking ID, excluidos en Novedades o automáticamente
  distResult.filter(r=>r.booking_id==='__EXCLUIDO__').forEach(r=>{
    excl.push({
      razon:'SIN_BOOKING',
      descripcion:'Registro en malla sin Booking ID — excluido de la liquidación',
      piloto:r.piloto, ciudad:r.ciudad, seller:r.seller,
      fecha:r.fecha_malla||r.fecha, booking_id:'—',
    });
  });

  // 3b. Anulados a $0 — incluidos en el template con booking real pero en $0,
  // NO son una exclusión real (sí entran al template Trump) — categoría propia.
  novedades.filter(n=>resoluciones[n.clave]?.accion==='cero').forEach(n=>{
    excl.push({
      razon:'ANULADO_CERO',
      descripcion:'Incluido en el template con booking real y todos los campos financieros en $0',
      piloto:n.piloto, ciudad:n.ciudad, seller:n.seller,
      fecha:n.fecha, booking_id:resoluciones[n.clave].booking_id,
    });
  });

  // NOTA: no existe un bucket "4. Novedades pendientes" separado por diseño —
  // BUGFIX: existía antes y contaba doble. Toda novedad de fuente 'conc' sin
  // resolver ya queda marcada _excluido_manual (sin _accion_manual) por
  // aplicarResoluciones() y la captura el bucket "3. Pendientes" arriba; toda
  // novedad de fuente 'dist' (SIN_BOOKING) sin resolver ya queda con
  // booking_id='__EXCLUIDO__' y la captura el bucket "SIN_BOOKING". Un bucket
  // adicional que recorriera novedades{} sin resolver las contaría dos veces.

  return excl;
}

export function renderResumenExclusiones(totalIncluidos){
  const excl = buildExclusiones();
  const el   = document.getElementById('resumen-exclusiones');
  const tbl  = document.getElementById('exclusiones-tabla');
  if(!el||!tbl) return;

  // Calcular manualOkCount ANTES del early-return: si el usuario confirmó todas las
  // novedades sin excluir ninguna, excl.length===0 pero el badge aún debe aparecer.
  const manualOkCount = trumpRows.filter(r=>r._confianza==='MANUAL-OK').length;

  if(excl.length===0 && manualOkCount===0){
    el.style.display='none';
    return;
  }

  el.style.display='block';

  // Agrupar por razón
  const grupos = {};
  excl.forEach(e=>{ grupos[e.razon]=(grupos[e.razon]||[]); grupos[e.razon].push(e); });

  const colores = {
    SIN_MALLA:        {bg:'rgba(239,68,68,.08)',  border:'#ef4444', label:'SIN_MALLA'},
    EXCLUIDO_MANUAL:  {bg:'rgba(234,179,8,.08)',  border:'#eab308', label:'EXCLUIDO MANUAL'},
    SIN_BOOKING:      {bg:'rgba(239,68,68,.08)',  border:'#ef4444', label:'SIN_BOOKING'},
    NOVEDAD_PENDIENTE:{bg:'rgba(234,179,8,.08)',  border:'#eab308', label:'PENDIENTE'},
    ANULADO_CERO:     {bg:'rgba(245,200,66,.08)', border:'#f5c842', label:'INCLUIDO EN $0'},
  };

  const totalMalla = mallaRaw.filter(r=>{
    const mBKey=Object.keys(mallaRaw[0]||{}).find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
    return r[mBKey];
  }).length;
  // ANULADO_CERO no es una exclusión real — el booking sí entra al template (en $0).
  const exclReales = excl.filter(e=>e.razon!=='ANULADO_CERO').length;

  let html = `<div style="padding:12px 14px;border-bottom:1px solid var(--border);background:var(--bg3);">
    <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;font-family:var(--mono);">
        <span style="color:var(--green);font-weight:600;">${totalIncluidos}</span>
        <span style="color:var(--text3);"> incluidos en template</span>
      </span>
      ${manualOkCount > 0 ? `<span style="font-size:12px;font-family:var(--mono);">
        <span style="color:var(--accent);font-weight:600;">${manualOkCount}</span>
        <span style="color:var(--text3);"> confirmados manualmente</span>
      </span>` : ''}
      <span style="font-size:12px;font-family:var(--mono);">
        <span style="color:var(--red);font-weight:600;">${exclReales}</span>
        <span style="color:var(--text3);"> excluidos de ${totalMalla} bookings en malla</span>
      </span>
      ${Object.entries(grupos).map(([r,items])=>`
        <span style="font-size:11px;font-family:var(--mono);background:${colores[r]?.bg||'var(--bg2)'};
          border:1px solid ${colores[r]?.border||'var(--border)'};padding:2px 8px;border-radius:3px;">
          ${colores[r]?.label||r}: ${items.length}
        </span>`).join('')}
    </div>
  </div>`;

  // Tabla de detalle colapsable por grupo
  Object.entries(grupos).forEach(([razon, items])=>{
    const c = colores[razon]||{bg:'var(--bg2)',border:'var(--border)',label:razon};
    html += `<details style="border-top:1px solid var(--border);">
      <summary style="padding:10px 14px;cursor:pointer;font-size:11px;font-family:var(--mono);
        background:${c.bg};display:flex;align-items:center;gap:8px;list-style:none;">
        <span style="color:${c.border};font-weight:600;">${c.label}</span>
        <span style="color:var(--text2);">${items.length} registro${items.length>1?'s':''}</span>
        <span style="margin-left:auto;color:var(--text3);">▶ ver detalle</span>
      </summary>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--mono);">
          <thead>
            <tr style="background:var(--bg3);">
              <th style="padding:6px 10px;text-align:left;color:var(--text3);border-bottom:1px solid var(--border);">Piloto</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text3);border-bottom:1px solid var(--border);">Ciudad</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text3);border-bottom:1px solid var(--border);">Fecha</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text3);border-bottom:1px solid var(--border);">Booking ID</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text3);border-bottom:1px solid var(--border);">Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(e=>`<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:5px 10px;color:var(--text);">${e.piloto}</td>
              <td style="padding:5px 10px;color:var(--text2);">${e.ciudad}</td>
              <td style="padding:5px 10px;color:var(--text2);">${e.fecha}</td>
              <td style="padding:5px 10px;color:var(--text3);">${e.booking_id}</td>
              <td style="padding:5px 10px;color:var(--text3);">${e.descripcion}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>`;
  });

  tbl.innerHTML = html;
}
