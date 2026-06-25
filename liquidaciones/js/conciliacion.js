// ═══════════════════════════════════════════
// CONCILIACIÓN — fuzzy matching TADA↔Malla
// ═══════════════════════════════════════════
import { normStr } from './config.js';
import { mallaRaw } from './parser.js';
import { tadaNorm } from './normalizer.js';
import { loadDict, saveDict, dictIncrementarUso } from './diccionario.js';
import { addLog, clearLog, showProcessing, hideProcessing, mkTable, unlock } from './ui.js';
import { actualizarDictSummary } from './diccionario.js';

export let concResult=[];
export let concFilter=new Set(); // filtros activos en conciliación (multiselecc con Ctrl)

// ══════════════════════════════════════════════════════
// FUZZY MATCHING DE NOMBRES — v2
//
// Maneja: acentos, errores tipográficos (Vaquero/Baquero,
// Bryan/Brahyan), nombres parciales en cualquier dirección
// (TADA más largo que malla o viceversa).
//
// Algoritmo:
//   1. Normalizar (sin acentos, minúsculas)
//   2. Por cada palabra de A, buscar la palabra más similar en B
//      usando distancia de Levenshtein
//   3. Contar palabras con match en ambas direcciones
//   4. Score = max(matches_AenB, matches_BenA)
//   5. Match válido si score ≥ 2 Y score ≥ 50% del nombre más corto
// ══════════════════════════════════════════════════════

export function levenshtein(a, b){
  if(!a) return b.length; if(!b) return a.length;
  if(a===b) return 0;
  const al=a.length, bl=b.length;
  let prev=Array.from({length:bl+1},(_,i)=>i);
  for(let i=0;i<al;i++){
    const curr=[i+1];
    for(let j=0;j<bl;j++)
      curr.push(Math.min(prev[j]+(a[i]===b[j]?0:1), curr[j]+1, prev[j+1]+1));
    prev=curr;
  }
  return prev[bl];
}

export function wordMatch(w1, w2){
  // Dos palabras hacen match si son idénticas,
  // o su distancia de edición es ≤ 2 (palabras > 4 letras)
  // o ≤ 1 (palabras de 4 letras o menos)
  if(w1===w2) return true;
  const maxLen=Math.max(w1.length, w2.length);
  const threshold = maxLen > 4 ? 2 : 1;
  return levenshtein(w1,w2) <= threshold;
}

export function scoreNames(nameA, nameB){
  // Retorna {score, minWords} — score = nº de palabras con match
  const wordsA = normStr(nameA).split(' ').filter(w=>w.length>1);
  const wordsB = normStr(nameB).split(' ').filter(w=>w.length>1);
  if(!wordsA.length||!wordsB.length) return {score:0, minWords:0};

  // Dirección A→B: cuántas palabras de A encuentran match en B
  let matchAB=0;
  wordsA.forEach(wa=>{
    if(wordsB.some(wb=>wordMatch(wa,wb))) matchAB++;
  });

  // Dirección B→A: cuántas palabras de B encuentran match en A
  let matchBA=0;
  wordsB.forEach(wb=>{
    if(wordsA.some(wa=>wordMatch(wa,wb))) matchBA++;
  });

  return {
    score:    Math.max(matchAB, matchBA),
    minWords: Math.min(wordsA.length, wordsB.length),
  };
}

export function fuzzyNameMatch(nameA, nameB){
  // Match válido: al menos 2 palabras coinciden
  // Y cubre al menos el 50% del nombre más corto
  const {score, minWords} = scoreNames(nameA, nameB);
  return score >= 2 && score >= minWords * 0.5;
}

export function fuzzyNameMatch1(nameA, nameB){
  // Match débil: al menos 1 palabra coincide (solo se usa cuando seller+fecha confirman)
  const {score} = scoreNames(nameA, nameB);
  return score >= 1;
}

export function runConciliacion(){
  clearLog('log-conc');
  showProcessing('Ejecutando conciliación...');
  concFilter=new Set();
  setTimeout(()=>{
    try{
      concResult=[];
      if(!mallaRaw.length){ addLog('log-conc','[ERR] Carga la malla Pibox','err'); return; }

      const mKeys=Object.keys(mallaRaw[0]);
    const mFKey=mKeys.find(k=>/fecha/i.test(k))||'FECHA';
    const mSKey=mKeys.find(k=>/seller|punto|tienda/i.test(k))||'SELLER';
    // mPKey: buscar columna de NOMBRE — excluir explícitamente columnas de ID
    const mPKey=mKeys.find(k=>!/id/i.test(k) && /nombre.*piloto|nombre de piloto/i.test(k))||
                mKeys.find(k=>!/id/i.test(k) && /nombre.*conductor|nombre.*driver/i.test(k))||
                mKeys.find(k=>!/id/i.test(k) && /^nombre$/i.test(k.trim()))||
                mKeys.find(k=>!/id/i.test(k) && /nombre/i.test(k))||
                mKeys.find(k=>!/id/i.test(k) && /piloto|conductor/i.test(k))||
                'NOMBRE';
    const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
    const mDKey=mKeys.find(k=>/^id[\s_]?piloto$/i.test(k.trim()))||
                mKeys.find(k=>/id.*piloto|driver.?id/i.test(k))||'ID PILOTO';
    const mHKey=mKeys.find(k=>/inicio.*turno|hora.*inicio/i.test(k))||
                mKeys.find(k=>/inicio/i.test(k))||'INICIO DE TURNO';
    addLog('log-conc',`[INFO] Malla — fecha:"${mFKey}" seller:"${mSKey}" piloto:"${mPKey}" booking:"${mBKey}" hora:"${mHKey}"`,'info');

    // ── Índices de match exacto ─────────────────────────────
    const idx3={}, idx2={};
    mallaRaw.forEach(m=>{
      const mp=normStr(String(m[mPKey]||'')), mf=String(m[mFKey]||'').trim(), ms=normStr(String(m[mSKey]||''));
      const a=`${mp}||${mf}||${ms}`, b=`${mp}||${mf}`;
      (idx3[a]||(idx3[a]=[])).push(m);
      if(!(idx2[b]||[]).find(x=>x[mBKey]===m[mBKey]))(idx2[b]||(idx2[b]=[])).push(m);
    });

    // ── Índices de fuzzy por fecha+seller y fecha sola ──────
    // Clave: fecha||seller → lista de registros malla ese día en ese seller
    // Clave: fecha         → lista de registros malla ese día (cualquier seller)
    const idxFS={}, idxF={};
    // Detectar columna ciudad en malla
    const mCKey=mKeys.find(k=>/^ciudad$|^city$/i.test(k))||mKeys.find(k=>/ciudad|city/i.test(k))||null;
    if(mCKey) addLog('log-conc',`[INFO] Columna ciudad malla: "${mCKey}" — usada para desempate fuzzy`,'info');
    mallaRaw.forEach(m=>{
      const mf=String(m[mFKey]||'').trim(), ms=normStr(String(m[mSKey]||''));
      const fs=`${mf}||${ms}`, f=mf;
      (idxFS[fs]||(idxFS[fs]=[])).push(m);
      (idxF[f] ||(idxF[f] =[])).push(m);
    });

    // ── Filtrar filas con actividad ─────────────────────────
    const filasConActividad=tadaNorm.filter(r=>r.paquetes>0||r.incentivos>0||r.cancelados>0);
    const filasVacias=tadaNorm.filter(r=>r.paquetes===0&&r.incentivos===0&&r.cancelados===0);
    addLog('log-conc',`[INFO] Filas con actividad (a conciliar): ${filasConActividad.length}`,'info');
    addLog('log-conc',`[INFO] Filas sin actividad (omitidas): ${filasVacias.length}`,'dim');

    // DIAG TEMPORAL — todas las filas de tadaNorm (con o sin actividad) cuyo
    // piloto contiene "yoverty" — para confirmar si la fila con actividad real
    // está siendo excluida de filasConActividad o llega con otra fecha/nombre.
    const diagYoverty = tadaNorm.filter(r=>String(r.piloto||'').toLowerCase().includes('yoverty'));
    if(diagYoverty.length){
      console.log('[DIAG tadaNorm — todas las filas "yoverty"]', diagYoverty.map(r=>({
        piloto_raw: r.piloto, normStr_piloto: normStr(r.piloto), fecha: r.fecha,
        paquetes: r.paquetes, incentivos: r.incentivos, cancelados: r.cancelados,
        seller: r.seller, ciudad: r.ciudad,
        tieneActividad: (r.paquetes>0||r.incentivos>0||r.cancelados>0),
      })));
    } else {
      console.log('[DIAG tadaNorm] NINGUNA fila de tadaNorm contiene "yoverty" en el piloto — el problema está en normalizer.js/parser.js, no en conciliacion.js');
    }

    const matchados=new Set();
    // Cargar diccionario para aplicar equivalencias aprendidas
    const dict = loadDict();
    let dictAplicados = 0;

    filasConActividad.forEach(row=>{
      const rp=normStr(row.piloto), rf=row.fecha, rs=normStr(row.seller);
      const a=`${rp}||${rf}||${rs}`, b=`${rp}||${rf}`;
      let matches=[], nivel='SIN_MALLA', nota='';

      // Helper: describir un candidato de la malla con su booking y horario
      const descCandidato=(m)=>{
        const bk  = m[mBKey]||'SIN BOOKING';
        const hora= m[mHKey]||'sin hora';
        const nom = m[mPKey]||'';
        return `${nom} · ${hora} · booking:${bk}`;
      };

      // ── NIVEL 0: Diccionario de equivalencias aprendidas (fuzzy) ──
      // BUGFIX: antes se buscaba con comparación estricta (normStr(e.tadaNombre)===rp),
      // lo que ignoraba en silencio una equivalencia ya aprendida cuando el nombre
      // TADA variaba mínimamente semana a semana (causó overbilling real en una
      // prefactura). Ahora se usa fuzzyNameMatch() — mismo criterio que el resto
      // del archivo usa para desambiguar (≥2 palabras y ≥50% del nombre más corto).
      const dictMatches = dict
        .map(e => ({ entry: e, score: scoreNames(row.piloto, e.tadaNombre).score }))
        .filter(({entry}) => fuzzyNameMatch(row.piloto, entry.tadaNombre))
        .sort((x,y) => y.score - x.score);

      let dictEntry = dictMatches.length ? dictMatches[0].entry : null;
      if(dictMatches.length > 1){
        addLog('log-conc',
          `[WARN] ${dictMatches.length} entradas del diccionario coinciden con "${row.piloto}" — se priorizó "${dictEntry.tadaNombre}" (score ${dictMatches[0].score})`,
          'warn');
      }
      if(dictEntry && normStr(dictEntry.tadaNombre) !== rp){
        // Aprendizaje continuo: el nombre TADA de esta semana reemplaza al guardado
        dictEntry.tadaNombre = row.piloto;
        saveDict(dict);
      }

      if(dictEntry){
        const mallaNorm = normStr(dictEntry.mallaNombre);
        // Buscar en la malla por nombre equivalente + fecha
        const candidatos = (idxF[rf]||[]).filter(m => normStr(String(m[mPKey]||'')) === mallaNorm);
        if(candidatos.length===1){
          matches=[candidatos[0]]; nivel='APRENDIDO';
          nota=`Diccionario: "${row.piloto}" → "${dictEntry.mallaNombre}"`;
          matches.forEach(m=>matchados.add(m[mBKey]));
          dictIncrementarUso(row.piloto);
          dictAplicados++;
        } else if(candidatos.length>1){
          // Múltiples bookings del mismo piloto equivalente ese día → MEDIUM
          matches=candidatos; nivel='MEDIUM';
          nota=`Diccionario (${candidatos.length} bookings): "${row.piloto}" → "${dictEntry.mallaNombre}"`;
          matches.forEach(m=>matchados.add(m[mBKey]));
          dictIncrementarUso(row.piloto);
          dictAplicados++;
        }
        // Si no hay candidatos, continuar con matching normal
      }

      if(nivel !== 'SIN_MALLA'){
        concResult.push({...row, nivel_confianza:nivel, matches, nota, driver_id:matches[0]?.[mDKey]||'PENDIENTE'});
        addLog('log-conc',`[APRENDIDO] ${row.piloto} · ${row.fecha} — ${nota}`,'ok');
        return;
      }

      // ── NIVEL 1: Match exacto piloto+fecha+seller ────────
      if(idx3[a]?.length){
        matches=idx3[a];
        if(matches.length===1){
          nivel='HIGH';
          nota='Exacto piloto+fecha+seller';
        } else {
          nivel='MEDIUM';
          // Detectar si algún registro no tiene booking
          const sinBooking = matches.filter(m=>!m[mBKey]||String(m[mBKey]).trim()==='');
          const conBooking = matches.filter(m=> m[mBKey]&&String(m[mBKey]).trim()!=='');
          if(sinBooking.length>0){
            nota=`${matches.length} registros en malla · ${sinBooking.length} SIN BOOKING SERVICIO · `+
                 `Con booking: ${conBooking.map(m=>`${m[mHKey]||'?'} → ${m[mBKey]}`).join(' / ')} · `+
                 `Sin booking: turnos ${sinBooking.map(m=>m[mHKey]||'sin hora').join(' / ')}`;
          } else {
            nota=`${matches.length} bookings mismo piloto+fecha+seller · desambiguar por turno: `+
                 matches.map(m=>`${m[mHKey]||'?'} → ${m[mBKey]}`).join(' / ');
          }
        }
        matches.forEach(m=>matchados.add(m[mBKey]));
      }
      // ── NIVEL 2: Match exacto piloto+fecha (seller distinto)
      else if(idx2[b]?.length){
        matches=idx2[b]; nivel='LOW';
        nota=`Exacto piloto+fecha · seller TADA="${row.seller}" vs malla="${[...new Set(matches.map(m=>m[mSKey]))].join('/')}"`;
        matches.forEach(m=>matchados.add(m[mBKey]));
      }
      // ── NIVEL 3: Fuzzy nombre + fecha + seller ───────────
      else {
        const fsKey=`${rf}||${rs}`;
        let candidatesFS=(idxFS[fsKey]||[]).filter(m=>fuzzyNameMatch(row.piloto,String(m[mPKey]||'')));

        // Desempate por ciudad si hay más de 1 candidato
        if(candidatesFS.length>1 && mCKey && row.ciudad){
          const withCity=candidatesFS.filter(m=>normStr(String(m[mCKey]||''))===normStr(row.ciudad));
          if(withCity.length>=1) candidatesFS=withCity;
        }

        if(candidatesFS.length===1){
          matches=candidatesFS; nivel='FUZZY-HIGH';
          const {score,minWords}=scoreNames(row.piloto,String(candidatesFS[0][mPKey]||''));
          nota=`Fuzzy nombre+fecha+seller (${score}/${minWords} palabras) · TADA="${row.piloto}" → malla="${candidatesFS[0][mPKey]}"`;
          matches.forEach(m=>matchados.add(m[mBKey]));
        }
        else if(candidatesFS.length>1){
          // ── Desempate automático antes de declarar AMBIGUOUS ──────────

          // Regla 1: Eliminar candidatos SIN booking — no pueden liquidarse
          const conBooking=candidatesFS.filter(m=>m[mBKey]&&String(m[mBKey]).trim()!==''&&m[mBKey]!=='SIN BOOKING');
          if(conBooking.length===1){
            matches=conBooking; nivel='FUZZY-HIGH';
            const {score,minWords}=scoreNames(row.piloto,String(conBooking[0][mPKey]||''));
            nota=`Fuzzy nombre+fecha+seller (${score}/${minWords} palabras · desempate: otro candidato sin booking) · TADA="${row.piloto}" → malla="${conBooking[0][mPKey]}"`;
            matches.forEach(m=>matchados.add(m[mBKey]));
          }
          // Regla 2: El candidato con score notablemente mayor gana
          else {
            const scored=candidatesFS.map(m=>({m, s:scoreNames(row.piloto,String(m[mPKey]||'')).score}));
            scored.sort((a,b)=>b.s-a.s);
            const best=scored[0], second=scored[1];
            if(best.s > second.s){
              // El mejor tiene más palabras coincidentes que el segundo
              matches=[best.m]; nivel='FUZZY-HIGH';
              const {score,minWords}=scoreNames(row.piloto,String(best.m[mPKey]||''));
              nota=`Fuzzy nombre+fecha+seller (${score}/${minWords} palabras · desempate por score: ${best.s} vs ${second.s}) · TADA="${row.piloto}" → malla="${best.m[mPKey]}"`;
              matches.forEach(m=>matchados.add(m[mBKey]));
            } else {
              // Scores iguales → genuinamente ambiguo
              matches=candidatesFS; nivel='AMBIGUOUS';
              const horarios=[...new Set(candidatesFS.map(m=>m[mHKey]||'sin hora'))];
              const horariosDistintos=horarios.length===candidatesFS.length;
              nota=`AMBIGUOUS: ${candidatesFS.length} candidatos con score igual (${best.s}) en misma fecha+seller · `+
                   (horariosDistintos?`turnos DISTINTOS (TADA sin horario para desambiguar) · `:`mismo horario · `)+
                   `Candidatos: ${candidatesFS.map(m=>descCandidato(m)).join(' | ')}`;
            }
          }
        }
        else {
          // ── NIVEL 4: Fuzzy nombre + fecha (cualquier seller) ─
          let candidatesF=(idxF[rf]||[]).filter(m=>fuzzyNameMatch(row.piloto,String(m[mPKey]||'')));

          // Desempate por ciudad
          if(candidatesF.length>1 && mCKey && row.ciudad){
            const withCity=candidatesF.filter(m=>normStr(String(m[mCKey]||''))===normStr(row.ciudad));
            if(withCity.length>=1) candidatesF=withCity;
          }

          if(candidatesF.length===1){
            matches=candidatesF; nivel='FUZZY-LOW';
            const {score,minWords}=scoreNames(row.piloto,String(candidatesF[0][mPKey]||''));
            nota=`Fuzzy nombre+fecha (${score}/${minWords} palabras) · TADA="${row.piloto}" → malla="${candidatesF[0][mPKey]}" · seller TADA="${row.seller}" vs malla="${candidatesF[0][mSKey]||''}"`;
            matches.forEach(m=>matchados.add(m[mBKey]));
          }
          else if(candidatesF.length>1){
            // Desempate automático
            const conBookingF=candidatesF.filter(m=>m[mBKey]&&String(m[mBKey]).trim()!==''&&m[mBKey]!=='SIN BOOKING');
            if(conBookingF.length===1){
              matches=conBookingF; nivel='FUZZY-LOW';
              const {score,minWords}=scoreNames(row.piloto,String(conBookingF[0][mPKey]||''));
              nota=`Fuzzy nombre+fecha (${score}/${minWords} palabras · desempate: otro candidato sin booking) · TADA="${row.piloto}" → malla="${conBookingF[0][mPKey]}"`;
              matches.forEach(m=>matchados.add(m[mBKey]));
            } else {
              const scoredF=candidatesF.map(m=>({m,s:scoreNames(row.piloto,String(m[mPKey]||'')).score}));
              scoredF.sort((a,b)=>b.s-a.s);
              const bestF=scoredF[0], secondF=scoredF[1];
              if(bestF.s > secondF.s){
                matches=[bestF.m]; nivel='FUZZY-LOW';
                const {score,minWords}=scoreNames(row.piloto,String(bestF.m[mPKey]||''));
                nota=`Fuzzy nombre+fecha (${score}/${minWords} palabras · desempate score: ${bestF.s} vs ${secondF.s}) · TADA="${row.piloto}" → malla="${bestF.m[mPKey]}"`;
                matches.forEach(m=>matchados.add(m[mBKey]));
              } else {
                matches=candidatesF; nivel='AMBIGUOUS';
                const horariosF=[...new Set(candidatesF.map(m=>m[mHKey]||'sin hora'))];
                nota=`AMBIGUOUS: ${candidatesF.length} candidatos score igual (${bestF.s}) misma fecha · `+
                     (horariosF.length===candidatesF.length?`turnos DISTINTOS · `:`mismo horario · `)+
                     `Candidatos: ${candidatesF.map(m=>descCandidato(m)).join(' | ')}`;
              }
            }
          }
        }

        // ── NIVEL 5: Fuzzy débil (1 palabra) + seller + fecha + ciudad ─
        // Cuando el nombre corto de TADA solo comparte 1 palabra con candidatos de la malla
        // pero seller, fecha y ciudad coinciden → AMBIGUOUS para revisión manual
        // (mejor que SIN_MALLA pues hay candidatos plausibles)
        if(nivel==='SIN_MALLA'){
          const fsKey=`${rf}||${rs}`;
          const weak=(idxFS[fsKey]||[]).filter(m=>fuzzyNameMatch1(row.piloto,String(m[mPKey]||'')));
          // Filtrar también por ciudad si está disponible
          const weakFiltered = mCKey && row.ciudad
            ? weak.filter(m=>normStr(String(m[mCKey]||''))===normStr(row.ciudad) || weak.length===0)
            : weak;
          const final = weakFiltered.length>0 ? weakFiltered : weak;
          if(final.length>0){
            matches=final; nivel='AMBIGUOUS';
            const horarios=[...new Set(final.map(m=>m[mHKey]||'sin hora'))];
            nota=`AMBIGUOUS (match débil 1 palabra + seller+fecha): ${final.length} candidato(s) · `+
                 (horarios.length===final.length && final.length>1 ? `turnos DISTINTOS · ` : ``)+
                 `TADA="${row.piloto}" · Candidatos: ${final.map(m=>descCandidato(m)).join(' | ')}`;
          }
        }
      }

      // DIAG TEMPORAL — verificación de normStr()/tildes para los 3 pilotos
      // reportados. Sustring (no exacto) para detectar si rp llega con un
      // valor ligeramente distinto al esperado (espacios, orden, etc.).
      // Remover una vez confirmada la causa real del SIN_TADA.
      const DIAG_WATCH = ['yoverty','suarez suarez','sanchez diaz'];
      if(DIAG_WATCH.some(w=>rp.includes(w))){
        // Candidatos en la malla con el MISMO piloto (normStr) sin importar
        // la fecha — para comparar el formato exacto de fecha de cada lado
        // incluso cuando idx2/idxF no encuentran nada por un mismatch de fecha.
        const mallaMismoPilotoCualquierFecha = mallaRaw
          .filter(m=>normStr(String(m[mPKey]||''))===rp)
          .map(m=>({fecha_malla_raw: m[mFKey], fecha_malla_tipo: typeof m[mFKey], fecha_malla_json: JSON.stringify(m[mFKey])}));
        console.log('[DIAG conciliacion]', {
          piloto_tada_raw: row.piloto,
          normStr_piloto_tada: rp,
          fecha_tada_raw: rf,
          fecha_tada_tipo: typeof rf,
          fecha_tada_json: JSON.stringify(rf),
          seller_tada_raw: row.seller,
          normStr_seller_tada: rs,
          idx3_key: a, idx3_match_count: idx3[a]?.length||0,
          idx2_key: b, idx2_match_count: idx2[b]?.length||0,
          idx2_candidatos: (idx2[b]||[]).map(m=>({nombre_raw:m[mPKey], normStr_nombre:normStr(String(m[mPKey]||'')), fecha_malla:m[mFKey]})),
          idxF_candidatos_misma_fecha: (idxF[rf]||[]).map(m=>({nombre_raw:m[mPKey], normStr_nombre:normStr(String(m[mPKey]||''))})),
          mallaMismoPilotoCualquierFecha,
          nivel_asignado: nivel,
        });
      }

      concResult.push({...row, nivel_confianza:nivel, matches, nota, driver_id:matches[0]?.[mDKey]||'PENDIENTE'});
      const cls=nivel==='HIGH'||nivel==='FUZZY-HIGH'?'ok': nivel==='SIN_MALLA'||nivel==='AMBIGUOUS'?'err':'warn';
      addLog('log-conc',`[${nivel}] ${row.piloto} · ${row.fecha} · ${row.seller} — ${nota||'Sin match'}`,cls);
    });

    // Huérfanos en malla — bookings en malla que no matchearon con ningún registro TADA
    // Los agregamos a concResult como SIN_TADA para que sean visibles y gestionables
    const huerfanosMalla = mallaRaw.filter(m=>m[mBKey]&&!matchados.has(m[mBKey]));
    huerfanosMalla.forEach(m=>{
      const nombreMalla = String(m[mPKey]||'');
      const fechaMalla  = String(m[mFKey]||'');
      const sellerMalla = String(m[mSKey]||'');
      const ciudadMalla = String(m[mCKey]||'');
      const bookingId   = String(m[mBKey]||'');
      concResult.push({
        piloto:    nombreMalla,
        ciudad:    ciudadMalla,
        seller:    sellerMalla,
        fecha:     fechaMalla,
        driver_id: String(m[mDKey]||'PENDIENTE'),
        paquetes:0, incentivos:0, cancelados:0, tareas:0,
        garantizado:0, bonos:0, ajustes:0,
        nivel_confianza: 'SIN_TADA',
        matches: [m],  // el registro de malla está disponible
        nota: `Booking en malla sin actividad reportada en TADA · booking: ${bookingId}`,
        _booking_malla: bookingId,
      });
      addLog('log-conc',`[SIN_TADA] ${nombreMalla} · ${fechaMalla} · booking: ${bookingId}`,'warn');
    });

    if(dictAplicados>0)
      addLog('log-conc',`[INFO] Diccionario: ${dictAplicados} coincidencias resueltas automáticamente`,'ok');
    if(huerfanosMalla.length>0)
      addLog('log-conc',`[WARN] ${huerfanosMalla.length} bookings en malla sin actividad en TADA — aparecen como SIN_TADA`,'warn');

    renderConcStats();
    renderConcTable();
    actualizarDictSummary();
    unlock(3);

    }catch(err){
      addLog('log-conc','[ERR] Error en conciliación: '+err.message,'err');
      console.error('runConciliacion error:', err);
    }finally{
      hideProcessing();
    }
  },50);
}

export function renderConcStats(){
  const h  =concResult.filter(r=>r.nivel_confianza==='HIGH').length;
  const ap =concResult.filter(r=>r.nivel_confianza==='APRENDIDO').length;
  const md =concResult.filter(r=>r.nivel_confianza==='MEDIUM').length;
  const lo =concResult.filter(r=>r.nivel_confianza==='LOW').length;
  const fh =concResult.filter(r=>r.nivel_confianza==='FUZZY-HIGH').length;
  const fl =concResult.filter(r=>r.nivel_confianza==='FUZZY-LOW').length;
  const amb=concResult.filter(r=>r.nivel_confianza==='AMBIGUOUS').length;
  const sn =concResult.filter(r=>r.nivel_confianza==='SIN_MALLA').length;
  const st =concResult.filter(r=>r.nivel_confianza==='SIN_TADA').length;
  const omitidas=tadaNorm.filter(r=>r.paquetes===0&&r.incentivos===0&&r.cancelados===0).length;

  const selCls=(n,base)=>concFilter.has(n)?` ${base}`:'';

  document.getElementById('stats-conc').innerHTML=`
    <div class="stat clickable${selCls('HIGH','selected-high')}"       onclick="filterConc(event,'HIGH')">       <div class="stat-l">HIGH · exacto</div>         <div class="stat-v g">${h}</div>  <div class="stat-hint">→ liquidación directa</div></div>
    ${ap>0?`<div class="stat clickable${selCls('APRENDIDO','selected-high')}" onclick="filterConc(event,'APRENDIDO')"><div class="stat-l">APRENDIDO · diccionario</div><div class="stat-v" style="color:#60a5fa;">${ap}</div><div class="stat-hint">→ liquidación directa</div></div>`:''}
    <div class="stat clickable${selCls('MEDIUM','selected-med')}"      onclick="filterConc(event,'MEDIUM')">     <div class="stat-l">MEDIUM · franja horaria</div><div class="stat-v y">${md}</div> <div class="stat-hint">→ liquidación directa</div></div>
    <div class="stat clickable${selCls('FUZZY-HIGH','selected-high')}" onclick="filterConc(event,'FUZZY-HIGH')"> <div class="stat-l">FUZZY-HIGH · 1 candidato</div><div class="stat-v g">${fh}</div><div class="stat-hint">→ liquidación directa</div></div>
    <div class="stat clickable${selCls('FUZZY-LOW','selected-med')}"   onclick="filterConc(event,'FUZZY-LOW')">  <div class="stat-l">FUZZY-LOW · sin seller</div><div class="stat-v y">${fl}</div> <div class="stat-hint">→ marcado revisión</div></div>
    <div class="stat clickable${selCls('LOW','selected-low')}"         onclick="filterConc(event,'LOW')">        <div class="stat-l">LOW · seller distinto</div><div class="stat-v r">${lo}</div>  <div class="stat-hint">→ marcado revisión</div></div>
    <div class="stat clickable${selCls('AMBIGUOUS','selected-low')}"   onclick="filterConc(event,'AMBIGUOUS')">  <div class="stat-l">AMBIGUOUS · varios cand.</div><div class="stat-v r">${amb}</div><div class="stat-hint">→ revisión manual</div></div>
    <div class="stat clickable${selCls('SIN_MALLA','selected-sin')}"   onclick="filterConc(event,'SIN_MALLA')">  <div class="stat-l">SIN_MALLA · sin match</div><div class="stat-v" style="color:var(--text2)">${sn}</div><div class="stat-hint">→ excluido</div></div>
    ${st>0?`<div class="stat clickable${selCls('SIN_TADA','selected-sin')}" onclick="filterConc(event,'SIN_TADA')"><div class="stat-l">SIN_TADA · no en reporte</div><div class="stat-v" style="color:var(--yellow);">${st}</div><div class="stat-hint">→ revisar en Novedades</div></div>`:''}
    <div class="stat" style="border-color:var(--border2);background:var(--bg3);">
      <div class="stat-l">Días sin actividad</div>
      <div class="stat-v" style="font-size:13px;color:var(--text3)">${omitidas}</div>
      <div class="stat-hint">omitidos del match</div>
    </div>
    <div style="grid-column:span 4;font-size:10px;font-family:var(--mono);color:var(--text3);padding:4px 2px;">
      Clic para filtrar · Ctrl+Clic para seleccionar múltiples · Clic en activo para deseleccionar
    </div>`;
}

export function filterConc(event, nivel){
  if(event && event.ctrlKey){
    if(concFilter.has(nivel)) concFilter.delete(nivel);
    else concFilter.add(nivel);
  } else {
    if(concFilter.size===1 && concFilter.has(nivel)) concFilter.clear();
    else { concFilter.clear(); concFilter.add(nivel); }
  }
  renderConcStats();
  renderConcTable();
  const badge=document.getElementById('conc-filter-badge');
  if(concFilter.size>0){
    badge.style.display='inline';
    badge.textContent='Filtro: '+[...concFilter].join(' + ');
  } else {
    badge.style.display='none';
  }
}

export function renderConcTable(){
  const rows=(concFilter.size>0
    ? concResult.filter(r=>concFilter.has(r.nivel_confianza))
    : concResult)
    .map(r=>({piloto:r.piloto,ciudad:r.ciudad,seller:r.seller,fecha:r.fecha,
      driver_id:r.driver_id, bookings:r.matches.length,
      nivel_confianza:r.nivel_confianza, nota:r.nota||'Sin match'}));
  mkTable('tbl-conc',rows,
    ['piloto','ciudad','seller','fecha','driver_id','bookings','nivel_confianza','nota'],
    ['Piloto','Ciudad','Seller','Fecha','Driver ID','Bookings','Confianza','Nota'],null,'conc','conc-data');
}
