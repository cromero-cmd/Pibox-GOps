// ═══════════════════════════════════════════
// CONCILIACIÓN — fuzzy matching TADA↔Malla
// ═══════════════════════════════════════════
import { normStr } from './config.js';
import { mallaRaw } from './parser.js';
import { tadaNorm } from './normalizer.js';
import { loadDict, saveDict, dictIncrementarUso, syncDiccionarioFromBackend } from './diccionario.js';
import { addLog, clearLog, showProcessing, hideProcessing, mkTable, unlock, toast } from './ui.js';
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
  // Retorna {score, minWords, maxWords} — score = nº de palabras con match
  const wordsA = normStr(nameA).split(' ').filter(w=>w.length>1);
  const wordsB = normStr(nameB).split(' ').filter(w=>w.length>1);
  if(!wordsA.length||!wordsB.length) return {score:0, minWords:0, maxWords:0};

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
    maxWords: Math.max(wordsA.length, wordsB.length),
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

// ══════════════════════════════════════════════════════
// NIVEL 0 — resolución por diccionario de equivalencias, extraído como
// función pura reutilizable: la usa tanto runConciliacion() (primera
// pasada completa) como reaplicarDiccionario() (re-intento puntual sobre
// concResult ya existente, sin reiniciar el pipeline). Misma lógica,
// un solo lugar — evita que ambos flujos diverjan con el tiempo.
// Retorna {nivel, matches, nota} si encuentra equivalencia aplicable,
// o null si no hay ninguna entrada del diccionario utilizable para este
// piloto+fecha (el llamador decide qué hacer con el registro en ese caso).
// ══════════════════════════════════════════════════════
function resolverPorDiccionario(piloto, fecha, dict, idxF, mPKey, mDKey){
  const rp = normStr(piloto);
  const dictMatches = dict
    .map(e => ({ entry: e, ...scoreNames(piloto, e.tadaNombre) }))
    .filter(m => normStr(m.entry.tadaNombre) === rp || fuzzyNameMatch(piloto, m.entry.tadaNombre))
    .sort((x,y) => y.score - x.score || new Date(y.entry.fechaAprendido||0) - new Date(x.entry.fechaAprendido||0));

  let dictEntry = dictMatches.length ? dictMatches[0].entry : null;
  if(dictMatches.length > 1){
    addLog('log-conc',
      `[WARN] ${dictMatches.length} entradas del diccionario coinciden con "${piloto}" — se priorizó "${dictEntry.tadaNombre}" (score ${dictMatches[0].score})`,
      'warn');
  }
  if(dictEntry){
    const exact = normStr(dictEntry.tadaNombre) === rp;
    // Aprendizaje continuo SOLO con match de alta confianza: exigir
    // minWords===maxWords (mismo número de palabras en ambos nombres) y
    // score===minWords (cobertura del 100%). BUGFIX: antes solo se exigía
    // score===minWords, que es asimétrico — si el piloto actual tiene 2
    // palabras y la entrada del diccionario tiene 4, basta que esas 2
    // palabras encuentren match parcial en las 4 para disparar el
    // renombrado, sobreescribiendo una entrada de OTRO piloto sin relación
    // real (ej. "Marlon Parada" renombrando silenciosamente la entrada de
    // "Miguel Angel Parra Garzon" porque "Parada"≈"Parra" — homónimo
    // parcial, no la misma persona). Exigir minWords===maxWords descarta
    // cualquier match contra un nombre con distinto número de palabras.
    const m = dictMatches[0];
    if(!exact && m.score === m.minWords && m.minWords === m.maxWords){
      dictEntry.tadaNombre = piloto;
      saveDict(dict);
    }
  }
  if(!dictEntry) return null;

  const mallaNorm = normStr(dictEntry.mallaNombre);
  const candidatos = (idxF[fecha]||[]).filter(m => normStr(String(m[mPKey]||'')) === mallaNorm);
  if(candidatos.length===1){
    return {
      nivel:'APRENDIDO', matches:[candidatos[0]],
      nota:`Diccionario: "${piloto}" → "${dictEntry.mallaNombre}"`,
      driver_id: candidatos[0][mDKey]||'PENDIENTE',
    };
  } else if(candidatos.length>1){
    return {
      nivel:'MEDIUM', matches:candidatos,
      nota:`Diccionario (${candidatos.length} bookings): "${piloto}" → "${dictEntry.mallaNombre}"`,
      driver_id: candidatos[0][mDKey]||'PENDIENTE',
    };
  }
  return null;
}

export async function runConciliacion(){
  clearLog('log-conc');
  showProcessing('Sincronizando diccionario...');
  concFilter=new Set();
  // Al correr conciliación desde cero, concResult se reconstruye entero y los
  // idx que guardaban novedades.js apuntan a posiciones ya inválidas. Se limpia
  // resoluciones{} antes de que el usuario llegue a Novedades con datos viejos.
  // El call usa optional chaining porque en tests resetNovedades puede no estar
  // en window (no se expone al scope global en el harness de Node).
  window.resetNovedades?.();

  // Descargar el diccionario compartido (Google Sheets) antes de matchear —
  // así una equivalencia que aprendió otro usuario esta semana se aplica
  // automáticamente sin que nadie tenga que hacer nada manual. Si el backend
  // no responde, syncDiccionarioFromBackend() devuelve el diccionario local
  // tal cual estaba — el pipeline sigue funcionando sin bloquearse.
  const syncResult = await syncDiccionarioFromBackend();
  addLog('log-conc',
    `[DICT] Diccionario sincronizado: ${syncResult.total} entradas (${syncResult.delServidor} del servidor, ${syncResult.locales} locales)`,
    syncResult.offline ? 'warn' : 'info');

  showProcessing('Ejecutando conciliación...');
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
      // BUGFIX (lookup): antes se buscaba con comparación estricta
      // (normStr(e.tadaNombre)===rp), lo que ignoraba en silencio una
      // equivalencia ya aprendida cuando el nombre TADA variaba mínimamente
      // semana a semana (causó overbilling real en una prefactura). Ahora
      // resolverPorDiccionario() incluye también fuzzyNameMatch() — mismo
      // criterio que el resto del archivo usa para desambiguar — más el
      // match exacto explícito (cubre nombres de 1 sola palabra, que
      // fuzzyNameMatch nunca acepta por su mínimo de 2). El renombrado de
      // "aprendizaje continuo" (BUGFIX de corrupción) vive dentro de la
      // función — solo renombra cuando ambos nombres tienen el MISMO número
      // de palabras y coinciden el 100% (typo/tilde, nunca un nombre más
      // corto matcheando parcialmente dentro de uno más largo).
      const r0 = resolverPorDiccionario(row.piloto, rf, dict, idxF, mPKey, mDKey);
      if(r0){
        matches = r0.matches; nivel = r0.nivel; nota = r0.nota;
        matches.forEach(m=>matchados.add(m[mBKey]));
        dictIncrementarUso(row.piloto);
        dictAplicados++;
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

      // Candidatos en TADA con actividad real, misma fecha+seller — el
      // piloto probablemente SÍ existe en TADA pero con un nombre distinto
      // al de la malla (variante, apodo, orden de apellidos), por eso no
      // matcheó ni por nombre exacto ni por fuzzy más arriba. Se ordenan por
      // similitud de nombre (más probable primero) para que el analista
      // pueda resolverlo sin tener que buscar manualmente en TADA.
      const candidatosTada = tadaNorm
        .filter(r => r.fecha===fechaMalla && normStr(r.seller)===normStr(sellerMalla) &&
                     (r.paquetes>0||r.incentivos>0||r.cancelados>0))
        .map(r => ({ r, ...scoreNames(nombreMalla, r.piloto) }))
        .sort((x,y)=>y.score-x.score)
        .map(({r})=>({
          piloto:r.piloto, fecha:r.fecha, seller:r.seller,
          paquetes:r.paquetes, incentivos:r.incentivos, cancelados:r.cancelados,
          tareas:r.tareas, bonos:r.bonos, garantizado:r.garantizado,
        }));

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
        _candidatosTada: candidatosTada,
      });
      addLog('log-conc',
        `[SIN_TADA] ${nombreMalla} · ${fechaMalla} · booking: ${bookingId}`+
        (candidatosTada.length ? ` · ${candidatosTada.length} candidato(s) en TADA` : ''),
        'warn');
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

// ══════════════════════════════════════════════════════
// RE-APLICAR DICCIONARIO — sin reiniciar el pipeline
//
// Reutiliza resolverPorDiccionario() (misma lógica de NIVEL 0 que
// runConciliacion()) contra concResult ya existente, para que agregar una
// equivalencia nueva no obligue a recargar los Excel ni rehacer todo el
// fuzzy matching. Solo toca registros sin match resuelto (AMBIGUOUS,
// FUZZY-HIGH, FUZZY-LOW, LOW, SIN_MALLA) — HIGH/MEDIUM/APRENDIDO quedan
// intactos, igual que tadaNorm/mallaRaw.
// ══════════════════════════════════════════════════════
const APLICABLES_REAPLICAR = new Set(['AMBIGUOUS','FUZZY-HIGH','FUZZY-LOW','LOW','SIN_MALLA']);

export function reaplicarDiccionario(){
  const btn = document.getElementById('btn-reaplicar-dict');
  const label = btn ? btn.innerHTML : null;
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Re-aplicando...'; }

  setTimeout(()=>{
    try{
      if(!mallaRaw.length || !concResult.length){
        toast('No hay conciliación para re-aplicar');
        return;
      }

      window._dictCache = null; // forzar relectura real desde localStorage
      const dict = loadDict();

      const mKeys=Object.keys(mallaRaw[0]);
      const mFKey=mKeys.find(k=>/fecha/i.test(k))||'FECHA';
      const mPKey=mKeys.find(k=>!/id/i.test(k) && /nombre.*piloto|nombre de piloto/i.test(k))||
                  mKeys.find(k=>!/id/i.test(k) && /nombre.*conductor|nombre.*driver/i.test(k))||
                  mKeys.find(k=>!/id/i.test(k) && /^nombre$/i.test(k.trim()))||
                  mKeys.find(k=>!/id/i.test(k) && /nombre/i.test(k))||
                  mKeys.find(k=>!/id/i.test(k) && /piloto|conductor/i.test(k))||
                  'NOMBRE';
      const mDKey=mKeys.find(k=>/^id[\s_]?piloto$/i.test(k.trim()))||
                  mKeys.find(k=>/id.*piloto|driver.?id/i.test(k))||'ID PILOTO';

      const idxF={};
      mallaRaw.forEach(m=>{
        const mf=String(m[mFKey]||'').trim();
        (idxF[mf]||(idxF[mf]=[])).push(m);
      });

      let nuevosAprendido=0, sinCambios=0;
      concResult.forEach(r=>{
        if(!APLICABLES_REAPLICAR.has(r.nivel_confianza)){ return; }
        const r0 = resolverPorDiccionario(r.piloto, r.fecha, dict, idxF, mPKey, mDKey);
        if(r0){
          r.nivel_confianza = r0.nivel;
          r.matches = r0.matches;
          r.nota = r0.nota;
          r.driver_id = r0.matches[0]?.[mDKey] || 'PENDIENTE';
          if(r0.nivel==='APRENDIDO') nuevosAprendido++;
        } else {
          sinCambios++;
        }
      });

      renderConcStats();
      renderConcTable();
      toast(`✓ ${nuevosAprendido} registros actualizados por diccionario`);
      addLog('log-conc',
        `[DICT] Re-aplicado: ${nuevosAprendido} nuevos APRENDIDO, ${sinCambios} sin cambios`,
        nuevosAprendido?'ok':'dim');
    } finally {
      if(btn){ btn.disabled = false; btn.innerHTML = label; }
    }
  }, 0);
}

export function renderConcStats(){
  const h  =concResult.filter(r=>r.nivel_confianza==='HIGH').length;
  const ap =concResult.filter(r=>r.nivel_confianza==='APRENDIDO').length;
  const md =concResult.filter(r=>r.nivel_confianza==='MEDIUM').length;
  const fh =concResult.filter(r=>r.nivel_confianza==='FUZZY-HIGH').length;
  const fl =concResult.filter(r=>r.nivel_confianza==='FUZZY-LOW').length;
  const lo =concResult.filter(r=>r.nivel_confianza==='LOW').length;
  const amb=concResult.filter(r=>r.nivel_confianza==='AMBIGUOUS').length;
  const sn =concResult.filter(r=>r.nivel_confianza==='SIN_MALLA').length;
  const st =concResult.filter(r=>r.nivel_confianza==='SIN_TADA').length;
  const omitidas=tadaNorm.filter(r=>r.paquetes===0&&r.incentivos===0&&r.cancelados===0).length;

  const totalDirecta  = h+ap+md+fh;
  const totalRevision = fl+lo+amb+sn+st;

  const selCls=(n,base)=>concFilter.has(n)?` ${base}`:'';
  const item=(nivel,label,valor,base,colorCls)=>`
    <div class="stat-sm clickable${selCls(nivel,base)}" onclick="filterConc(event,'${nivel}')">
      <div class="stat-sm-l">${label}</div>
      <div class="stat-sm-v ${colorCls}">${valor}</div>
    </div>`;

  const itemsDirecta=[
    item('HIGH','HIGH · exacto',h,'selected-high','g'),
    ap>0?item('APRENDIDO','APRENDIDO · diccionario',ap,'selected-high','b'):'',
    item('MEDIUM','MEDIUM · franja horaria',md,'selected-med','y'),
    item('FUZZY-HIGH','FUZZY-HIGH · 1 candidato',fh,'selected-high','g'),
  ].join('');

  const itemsRevision=[
    item('FUZZY-LOW','FUZZY-LOW · sin seller',fl,'selected-med','y'),
    item('LOW','LOW · seller distinto',lo,'selected-low','r'),
    item('AMBIGUOUS','AMBIGUOUS · varios cand.',amb,'selected-low','r'),
    item('SIN_MALLA','SIN_MALLA · sin match',sn,'selected-sin',''),
    st>0?item('SIN_TADA','SIN_TADA · no en reporte',st,'selected-sin','y'):'',
  ].join('');

  // ── Diferencias ──
  // BUGFIX: la versión anterior mostraba filasConActividad.length ("filas
  // TADA procesadas") como si fuera comparable 1:1 contra concResult.length
  // (liquidación directa + revisión) — pero esos dos números miden cosas
  // distintas: concResult incluye también los SIN_TADA (bookings de la
  // MALLA sin actividad en TADA), que nunca fueron una "fila TADA". Eso
  // hacía que el total mostrado no cuadrara con la suma real de los grupos.
  //
  // Ahora se muestran los 3 totales que sí son comparables entre sí
  // (totalProcesadas = totalDirecta + totalRevision, siempre exacto por
  // construcción) y se usa filasConActividad.length SOLO internamente, para
  // decidir si hay bookings de malla sin actividad en TADA — no se expone
  // como si fuera "lo mismo" que totalProcesadas.
  const totalProcesadas = concResult.length; // = totalDirecta + totalRevision
  const totalMalla = mallaRaw.length;
  const totalTadaConActividad = tadaNorm.filter(r=>r.paquetes>0||r.incentivos>0||r.cancelados>0).length;

  const notas = [];
  if(totalProcesadas > totalMalla){
    notas.push(`${sn} filas de TADA no tienen booking correspondiente en la malla (SIN_MALLA)`);
  }
  if(totalMalla > totalTadaConActividad){
    notas.push(`${st} bookings de la malla no tienen actividad reportada en TADA (SIN_TADA)`);
  }
  const explicacionCls = notas.length ? '' : 'g';
  const explicacionDiff = notas.length
    ? notas.join(' · ')
    : '✓ Todas las filas procesadas tienen booking correspondiente y todos los bookings de la malla tienen actividad en TADA';

  document.getElementById('stats-conc').innerHTML=`
    <div class="conc-groups">
      <div class="conc-group conc-group-green">
        <div class="conc-group-head">
          <span class="conc-group-title">✓ Liquidación directa</span>
          <span class="conc-group-total g">${totalDirecta}</span>
        </div>
        <div class="conc-group-items">${itemsDirecta}</div>
      </div>
      <div class="conc-group conc-group-yellow">
        <div class="conc-group-head">
          <span class="conc-group-title">⚠ Revisión en Novedades</span>
          <span class="conc-group-total y">${totalRevision}</span>
        </div>
        <div class="conc-group-items">${itemsRevision}</div>
      </div>
    </div>
    <div class="conc-diff-box">
      <div class="conc-diff-nums">${totalProcesadas} filas procesadas · ${totalDirecta} liquidación directa · ${totalRevision} revisión · ${totalMalla} bookings en malla</div>
      <div class="conc-diff-explicacion ${explicacionCls}">${explicacionDiff}</div>
      <div class="conc-diff-omitidas">${omitidas} días sin actividad — omitidos del match</div>
    </div>
    <div style="grid-column:1/-1;font-size:10px;font-family:var(--mono);color:var(--text3);padding:4px 2px;">
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
