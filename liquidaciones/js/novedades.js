// ═══════════════════════════════════════════
// MÓDULO DE NOVEDADES — Resolución manual
// ═══════════════════════════════════════════
import { normStr } from './config.js';
import { mallaRaw } from './parser.js';
import { concResult } from './conciliacion.js';
import { distResult, runDistribucionSilent } from './distribucion.js';
import { dictSave } from './diccionario.js';
import { toast, navStep, setMaxStep } from './ui.js';
import { showProcessing, hideProcessing } from './ui.js';

export let novedades = [];    // lista construida una sola vez al abrir el módulo
// resoluciones{} se indexa por CLAVE ESTABLE (no por posición en novedades[]).
// BUGFIX: indexar por índice numérico `i` rompía cuando novedades[] se
// reconstruía en un nuevo procesamiento — los índices cambiaban de orden/longitud
// pero resoluciones{} seguía apuntando a las posiciones viejas, desalineando
// resoluciones manuales con pilotos incorrectos. La clave se calcula una sola
// vez en buildNovedades() y viaja con cada entrada (`n.clave`), así que no
// depende de en qué posición del array quede esa novedad.
export let resoluciones = {}; // clave → {accion, booking_id, driver_id, ...}

const TIPOS_NOVEDAD  = new Set(['LOW','FUZZY-LOW','AMBIGUOUS','SIN_MALLA','SIN_TADA']);
const TIPOS_SIN_BOOKING = 'SIN_BOOKING';

function claveNovedad(piloto, fecha, tipo){
  return `${normStr(piloto)}||${fecha}||${tipo}`;
}

// Booking ID real de la malla asociado a una novedad, si existe — usado para
// habilitar "Incluir en $0" (requiere un booking real, no un placeholder).
// BUGFIX: para SIN_TADA, conciliacion.js ya resuelve el booking correcto una
// sola vez (campo _booking_malla, propagado aquí como n.bookingMalla) — usar
// ese valor en vez de volver a derivar la columna de booking desde cero con
// la misma heurística de regex en un segundo archivo, que puede desalinearse
// si la malla tiene más de una columna que contenga "booking" en el nombre.
function bookingDeNovedad(n){
  // DIAGNÓSTICO TEMPORAL — remover una vez resuelto el caso de "Incluir en $0"
  // que no aparece para SIN_TADA en producción (piloto: ${n.piloto}).
  console.log('[DIAG bookingDeNovedad]', {
    piloto: n.piloto,
    tipo: n.tipo,
    bookingMalla: n.bookingMalla,
  });
  if(n.bookingMalla) return n.bookingMalla;
  if(!n.matches || !n.matches.length){
    console.log('[DIAG bookingDeNovedad] sin matches — matches.length:', n.matches?.length);
    return '';
  }
  const mKeys = Object.keys(mallaRaw[0]||{});
  const mBKey = mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
  const bk = String(n.matches[0][mBKey]||'').trim();
  console.log('[DIAG bookingDeNovedad]', {
    matchesLength: n.matches.length,
    mallaRawKeys: mKeys,
    mBKeyDetectado: mBKey,
    matches0RawValue: n.matches[0][mBKey],
    bkExtraido: bk,
    valorFinal: (bk && bk!=='SIN BOOKING') ? bk : '',
  });
  return (bk && bk!=='SIN BOOKING') ? bk : '';
}

export function buildNovedades(){
  const nov = [];
  // 1. Registros de conciliación que requieren atención
  concResult.forEach((r,idx)=>{
    if(TIPOS_NOVEDAD.has(r.nivel_confianza)){
      const tipo=r.nivel_confianza, fecha=r.fecha;
      nov.push({tipo, fuente:'conc', idx,
        piloto:r.piloto, ciudad:r.ciudad, seller:r.seller, fecha,
        nota:r.nota||'', matches:r.matches||[], driver_id:r.driver_id||'',
        bookingMalla:r._booking_malla||'',
        clave: claveNovedad(r.piloto, fecha, tipo)});
    }
  });
  // 2. Registros distribuidos SIN booking válido
  distResult.forEach((r,idx)=>{
    const bk = String(r.booking_id||'').trim();
    if(!bk || bk==='?' || bk==='SIN BOOKING' || bk==='__EXCLUIDO__'){
      const tipo=TIPOS_SIN_BOOKING, fecha=r.fecha_malla||r.fecha;
      nov.push({tipo, fuente:'dist', idx,
        piloto:r.piloto, ciudad:r.ciudad, seller:r.seller, fecha,
        nota:'Registro sin BOOKING SERVICIO en la malla', matches:[], driver_id:r.driver_id||'',
        clave: claveNovedad(r.piloto, fecha, tipo)});
    }
  });
  return nov;
}

export function badgeClass(tipo){
  if(tipo==='LOW'||tipo==='FUZZY-LOW') return 'b-med';
  if(tipo==='AMBIGUOUS'||tipo===TIPOS_SIN_BOOKING) return 'b-low';
  if(tipo==='SIN_TADA') return 'b-med';
  return 'b-sin';
}

let novFilter = null;  // filtro por tipo (AMBIGUOUS, LOW, etc.)
let novEstado = null;  // filtro por estado: 'ok' | 'excluir' | 'pendiente'

export function abrirNovedades(){
  novedades = buildNovedades();
  resoluciones = {};
  novFilter = null;
  novEstado = null;
  // Inicializar summary y lista
  const total = novedades.length;
  if(total===0){
    document.getElementById('nov-summary').innerHTML =
      '<span style="color:var(--green);font-family:var(--mono);font-size:12px;">✓ Sin novedades — todos los registros tienen match y booking válido</span>';
    document.getElementById('nov-lista').innerHTML = '';
  } else {
    actualizarSummary();
    renderListaNovedades();
  }
  navStep(4.5);
  setMaxStep(5);
}

export function filterNovedades(tipo){
  novFilter = novFilter===tipo ? null : tipo;
  novEstado = null;
  renderListaNovedades();
  actualizarSummary();
}

export function filterEstado(estado){
  novEstado = novEstado===estado ? null : estado;
  novFilter = null;
  renderListaNovedades();
  actualizarSummary();
}

export function renderListaNovedades(){
  let todos = novFilter
    ? novedades.map((n,i)=>({n,i})).filter(({n})=>n.tipo===novFilter)
    : novedades.map((n,i)=>({n,i}));

  // Filtro de estado: mostrar solo incluidos / excluidos / en $0 / pendientes
  if(novEstado==='ok')        todos = todos.filter(({n})=>resoluciones[n.clave]?.accion==='ok');
  else if(novEstado==='excluir') todos = todos.filter(({n})=>resoluciones[n.clave]?.accion==='excluir');
  else if(novEstado==='cero') todos = todos.filter(({n})=>resoluciones[n.clave]?.accion==='cero');
  else if(novEstado==='pendiente') todos = todos.filter(({n})=>!resoluciones[n.clave]);

  const pendientes = novEstado ? todos : todos.filter(({n})=>!resoluciones[n.clave]);
  const resueltos  = novEstado ? []    : todos.filter(({n})=> resoluciones[n.clave]);

  let html = '';

  // Vista filtrada por estado: lista plana con botón revertir
  if(novEstado){
    if(todos.length===0){
      const label = novEstado==='ok'?'incluidos':novEstado==='excluir'?'excluidos':novEstado==='cero'?'en $0':'pendientes';
      html=`<div style="padding:20px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:11px;">Sin registros en estado "${label}"</div>`;
    } else {
      html = todos.map(({n,i})=>{
        const res = resoluciones[n.clave];
        const accion = res?.accion==='ok'?'✓ Incluido':res?.accion==='excluir'?'✗ Excluido':res?.accion==='cero'?'⓪ En $0':'⏳ Pendiente';
        const color  = res?.accion==='ok'?'var(--green)':res?.accion==='excluir'?'var(--text3)':'var(--yellow)';
        const detalle= res?.booking_id ? `· booking: ${res.booking_id}` : res?.nombre_malla ? `· ${res.nombre_malla}` : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;
          background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-bottom:5px;">
          <span class="badge ${badgeClass(n.tipo)}">${n.tipo}</span>
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:600;">${n.piloto}</div>
            <div style="font-size:10px;color:var(--text3);font-family:var(--mono);">${n.ciudad} · ${n.fecha}</div>
          </div>
          <span style="font-size:11px;font-family:var(--mono);color:${color};">${accion}${detalle}</span>
          ${res ? `<button class="btn btn-sm" onclick="revertirResolucion(${i})" style="font-size:10px;padding:3px 8px;flex-shrink:0;">↩ Revertir</button>` : ''}
        </div>`;
      }).join('');
    }
    document.getElementById('nov-lista').innerHTML=html;
    return;
  }

  // Vista normal: pendientes visibles + resueltos en acordeón
  if(pendientes.length===0 && todos.length>0){
    html += `<div style="padding:16px;text-align:center;color:var(--green);font-family:var(--mono);font-size:12px;">✓ Todas las novedades han sido atendidas</div>`;
  } else {
    html += pendientes.map(({n,i})=>renderNovCard(n,i)).join('');
  }

  if(resueltos.length>0){
    html += `<details style="margin-top:12px;">
      <summary style="cursor:pointer;font-size:11px;font-family:var(--mono);color:var(--text3);
        padding:8px 12px;background:var(--bg3);border-radius:6px;border:1px solid var(--border);
        list-style:none;display:flex;align-items:center;gap:8px;">
        <span>▶</span><span>Resueltos (${resueltos.length})</span>
        <span style="margin-left:auto;">
          ${resueltos.filter(({n})=>resoluciones[n.clave]?.accion==='ok').length} incluidos ·
          ${resueltos.filter(({n})=>resoluciones[n.clave]?.accion==='excluir').length} excluidos
        </span>
      </summary>
      <div style="margin-top:6px;">${resueltos.map(({n,i})=>renderNovCardResuelto(n,i)).join('')}</div>
    </details>`;
  }

  document.getElementById('nov-lista').innerHTML = html || '<div style="padding:12px;color:var(--text3);font-size:11px;">Sin novedades</div>';

  // Adjuntar eventos a pendientes
  pendientes.forEach(({n,i})=>{
    const card = document.getElementById(`nov-card-${i}`);
    if(!card) return;
    const btnOk = card.querySelector('.btn-nov-ok');
    if(btnOk) btnOk.addEventListener('click',()=>confirmarOk(i));
    const btnEx = card.querySelector('.btn-nov-ex');
    if(btnEx) btnEx.addEventListener('click',()=>confirmarExcluir(i));
    const btnCero = card.querySelector('.btn-nov-cero');
    if(btnCero) btnCero.addEventListener('click',()=>confirmarCero(i));
    card.querySelectorAll('.nov-candidato').forEach(el=>{
      el.addEventListener('click',()=>seleccionarCandidato(i, el.dataset.bk, el.dataset.did, el.dataset.nom));
    });
    const inpBk = card.querySelector('.inp-booking');
    if(inpBk) inpBk.addEventListener('input',e=>{ novedades[i]._booking_manual=e.target.value.trim(); });
    const inpDriver = card.querySelector('.inp-driver');
    if(inpDriver) inpDriver.addEventListener('input',e=>{ novedades[i]._driver_manual=e.target.value.trim(); });
    const inpNom = card.querySelector('.inp-nom-manual');
    const inpBkM = card.querySelector('.inp-bk-manual');
    if(inpNom) inpNom.addEventListener('input',e=>{ novedades[i]._nombre_manual=e.target.value.trim(); });
    if(inpBkM) inpBkM.addEventListener('input',e=>{ novedades[i]._bk_manual=e.target.value.trim(); });
  });
}

export function revertirResolucion(i){
  const n = novedades[i];
  if(n){ delete resoluciones[n.clave]; delete n._booking_manual; delete n._nombre_manual; delete n._bk_manual; }
  novEstado = null;
  renderListaNovedades();
  actualizarSummary();
  toast('Resolución revertida — vuelve a pendientes');
}
// Tarjeta compacta para resueltos (sin acciones)
export function renderNovCardResuelto(n, i){
  const res = resoluciones[n.clave];
  const accion = res?.accion==='ok' ? '✓ Incluido' : res?.accion==='cero' ? '⓪ En $0' : '✗ Excluido';
  const color  = res?.accion==='ok' ? 'var(--green)' : res?.accion==='cero' ? 'var(--yellow)' : 'var(--text3)';
  const detalle = res?.accion==='cero'
    ? `→ booking: ${res.booking_id}`
    : res?.accion==='ok' && res?.booking_id
    ? `→ booking: ${res.booking_id}`
    : res?.accion==='ok' ? '→ match confirmado' : '→ excluido de la liquidación';
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;
    background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-bottom:4px;opacity:.6;">
    <span class="badge ${badgeClass(n.tipo)}" style="flex-shrink:0;">${n.tipo}</span>
    <span style="font-size:11px;font-weight:600;flex:1;">${n.piloto}</span>
    <span style="font-size:10px;font-family:var(--mono);color:var(--text3);">${n.fecha}</span>
    <span style="font-size:10px;font-family:var(--mono);color:${color};">${accion} ${detalle}</span>
  </div>`;
}

export function explicarNovedad(n){
  // Extraer datos relevantes de la nota técnica para generar explicación humana
  const tipo = n.tipo;

  if(tipo === 'LOW'){
    // Extraer sellers de la nota: seller TADA="X" vs malla="Y"
    const mTada  = n.nota.match(/seller TADA="([^"]+)"/);
    const mMalla = n.nota.match(/malla="([^"]+)"/);
    const sellerTada  = mTada  ? mTada[1]  : n.seller;
    const sellerMalla = mMalla ? mMalla[1] : '?';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--yellow);margin-bottom:6px;">⚠ El seller en TADA no coincide con el registrado en la malla.</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:4px;font-size:11px;font-family:var(--mono);line-height:1.8;">
        <span style="color:var(--text3);">TADA reporta:</span>  <span style="color:var(--text);">${sellerTada}</span>
        <span style="color:var(--text3);">Malla registra:</span><span style="color:var(--text);">${sellerMalla}</span>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text2);">
        ¿Es el mismo piloto trabajando en un punto diferente al registrado?<br>
        → <strong>Confirma</strong> si los datos son correctos y quieres incluirlo en la liquidación.<br>
        → <strong>Excluye</strong> si crees que es un error de asignación.
      </div>
    </div>`;
  }

  if(tipo === 'FUZZY-LOW'){
    const mTada  = n.nota.match(/TADA="([^"]+)"/);
    const mMalla = n.nota.match(/malla="([^"]+)"/i);
    const nomTada  = mTada  ? mTada[1]  : n.piloto;
    const nomMalla = mMalla ? mMalla[1] : '?';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--yellow);margin-bottom:6px;">⚠ El nombre del piloto es similar pero no idéntico, y el seller tampoco coincide.</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:4px;font-size:11px;font-family:var(--mono);line-height:1.8;">
        <span style="color:var(--text3);">TADA:</span>  <span style="color:var(--text);">${nomTada}</span>
        <span style="color:var(--text3);">Malla:</span> <span style="color:var(--text);">${nomMalla}</span>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text2);">
        ¿Es la misma persona con nombre escrito diferente en cada sistema?<br>
        → <strong>Confirma</strong> si es el mismo piloto y quieres incluirlo.<br>
        → <strong>Excluye</strong> si no estás seguro o es una persona diferente.
      </div>
    </div>`;
  }

  if(tipo === 'AMBIGUOUS'){
    const esDebil = n.nota && n.nota.includes('match débil');
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--red);margin-bottom:6px;">
        ${esDebil
          ? `⚠ Hay ${n.matches.length} piloto(s) en la malla con nombre similar en la misma fecha y punto de venta, pero sin suficiente coincidencia para asignación automática.`
          : `⚠ Hay ${n.matches.length} pilotos diferentes registrados en la malla para esta misma fecha y punto de venta.`}
      </div>
      <div style="font-size:11px;color:var(--text2);">
        ${esDebil
          ? `El nombre en TADA (<strong>${n.piloto}</strong>) solo comparte una palabra con los candidatos encontrados.<br>Revisa los candidatos y selecciona el correcto, o ingresa el booking manualmente.`
          : `El sistema no puede determinar cuál corresponde al registro de TADA porque comparten palabras en el nombre.`}<br>
        → <strong>Selecciona</strong> el candidato correcto de la lista de abajo.<br>
        → Si ninguno es correcto, <strong>ingresa manualmente</strong> el nombre y booking.<br>
        → <strong>Excluye</strong> si prefieres no incluirlo en esta liquidación.
      </div>
    </div>`;
  }

  if(tipo === 'SIN_BOOKING'){
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--red);margin-bottom:6px;">⚠ Este registro existe en la malla pero no tiene un Booking ID asignado.</div>
      <div style="font-size:11px;color:var(--text2);">
        Sin Booking ID no es posible cargar el pago en Trump.<br>
        → <strong>Ingresa el Booking ID</strong> manualmente si lo tienes disponible y confirma.<br>
        → <strong>Excluye</strong> si el servicio no debe liquidarse en este ciclo.
      </div>
    </div>`;
  }

  if(tipo === 'SIN_MALLA'){
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:6px;">ℹ Este piloto aparece en TADA con actividad pero no tiene registro en la malla. Puede que el booking se haya omitido.</div>
      <div style="font-size:11px;color:var(--text2);">
        Posibles causas: el servicio no se registró en la malla, la fecha no coincide, o el piloto no estaba activo ese día.<br>
        → <strong>Ingresa el Booking ID</strong> manualmente si lo tienes disponible y confirma — se liquidará con sus valores reales de TADA.<br>
        → <strong>Excluye</strong> si el servicio no debe liquidarse en este ciclo.
      </div>
    </div>`;
  }

  if(tipo === 'SIN_TADA'){
    const bk = n.nota.match(/booking: ([a-f0-9]+)/)?.[1] || '—';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:var(--yellow);margin-bottom:6px;">⚠ Este booking está en la malla Pibox pero no aparece en el reporte de TADA.</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:4px;font-size:11px;font-family:var(--mono);line-height:1.8;">
        <span style="color:var(--text3);">Booking ID:</span><span style="color:var(--text);">${bk}</span>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text2);">
        Posibles causas: el piloto trabajó ese día pero TADA no reportó actividad, o hay un desfase entre los sistemas.<br>
        → <strong>Confirma</strong> si debe incluirse en la liquidación (se liquidará con garantizado mínimo).<br>
        → <strong>Excluye</strong> si no debe pagarse en este ciclo.
      </div>
    </div>`;
  }

  // Fallback: mostrar nota técnica
  return `<div class="nov-nota">${n.nota}</div>`;
}

export function renderNovCard(n, i){
  const res = resoluciones[n.clave];
  const cardCls = res ? (res.accion==='ok'?'resuelto':res.accion==='cero'?'cero':'excluido') : '';
  const statusHtml = res
    ? `<span class="nov-status ${res.accion==='ok'?'ns-ok':res.accion==='cero'?'ns-cero':'ns-excl'}">${res.accion==='ok'?'✓ Incluido':res.accion==='cero'?'⓪ En $0':'✗ Excluido'}</span>`
    : '';
  const bookingDisponible = bookingDeNovedad(n);

  // Candidatos AMBIGUOUS
  let candidatosHtml='';
  if(n.tipo==='AMBIGUOUS' && n.matches.length>0){
    const mKeys=Object.keys(mallaRaw[0]||{});
    const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
    const mHKey=mKeys.find(k=>/inicio.*turno|hora.*inicio/i.test(k))||mKeys.find(k=>/inicio/i.test(k))||'INICIO DE TURNO';
    const mPKey=mKeys.find(k=>!/id/i.test(k)&&/nombre/i.test(k))||'NOMBRE';
    const mDKey=mKeys.find(k=>/^id[\s_]?piloto/i.test(k.trim()))||'ID PILOTO';
    candidatosHtml=`<div style="margin-bottom:8px;font-size:11px;color:var(--text3);font-family:var(--mono);">Selecciona el candidato correcto:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        ${n.matches.map(m=>{
          const bk=String(m[mBKey]||'SIN BOOKING');
          const hora=m[mHKey]||'?';
          const nom=m[mPKey]||'';
          const did=m[mDKey]||'';
          const selCls=res?.booking_id===bk?'selected':'';
          return `<div class="nov-candidato ${selCls}" data-bk="${bk}" data-did="${did}" data-nom="${nom}">
            <div style="font-weight:600;font-size:11px;">${nom}</div>
            <div style="color:var(--text3);font-size:10px;">${hora} · ${bk}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px;">O ninguno es correcto — ingresar manualmente:</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <input class="nov-input inp-nom-manual" type="text" placeholder="Nombre del piloto correcto..." value="${n._nombre_manual||''}"/>
        <input class="nov-input inp-bk-manual"  type="text" placeholder="Booking ID..."              value="${n._bk_manual||''}"/>
      </div>`;
  }

  // Input booking SIN_BOOKING
  let bookingHtml='';
  if(n.tipo===TIPOS_SIN_BOOKING){
    bookingHtml=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
      <input class="nov-input inp-booking" type="text" placeholder="Ingresar BOOKING SERVICIO manualmente..." value="${n._booking_manual||''}"/>
    </div>`;
  }

  // Inputs booking + driver SIN_MALLA — sin estos no hay forma de rescatar
  // el registro al template, ya que no existe ningún candidato en la malla.
  let sinMallaHtml='';
  if(n.tipo==='SIN_MALLA'){
    sinMallaHtml=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <input class="nov-input inp-booking" type="text" placeholder="Booking ID..." value="${n._booking_manual||''}"/>
      <input class="nov-input inp-driver" type="text" placeholder="Driver ID (opcional)..." value="${n._driver_manual||''}"/>
    </div>`;
  }

  return `<div class="nov-card ${cardCls}" id="nov-card-${i}">
    <div class="nov-header">
      <span class="nov-badge ${badgeClass(n.tipo)}">${n.tipo}</span>
      <div style="flex:1;">
        <div class="nov-piloto">${n.piloto}</div>
        <div class="nov-meta">${n.ciudad} · ${n.seller} · ${n.fecha}</div>
      </div>
      ${statusHtml}
    </div>
    <div class="nov-body">
      ${explicarNovedad(n)}
      <details style="margin-bottom:10px;">
        <summary style="font-size:10px;color:var(--text3);cursor:pointer;font-family:var(--mono);">Ver detalle técnico</summary>
        <div style="font-size:10px;font-family:var(--mono);color:var(--text3);margin-top:6px;padding:6px 8px;background:var(--bg3);border-radius:4px;line-height:1.6;">${n.nota}</div>
      </details>
      ${candidatosHtml}
      ${bookingHtml}
      ${sinMallaHtml}
      <div class="nov-actions">
        <button class="btn btn-sm btn-primary btn-nov-ok">✓ Confirmar</button>
        ${bookingDisponible ? `<button class="btn btn-sm btn-warn btn-nov-cero">⓪ Incluir en $0</button>` : ''}
        <button class="btn btn-sm btn-danger btn-nov-ex">✗ Excluir</button>
      </div>
    </div>
  </div>`;
}

export function seleccionarCandidato(i, bk, did, nom){
  const n = novedades[i];
  if(!n) return;
  // Solo guardar la selección y marcar visualmente — NO confirmar aún
  if(!resoluciones[n.clave]) resoluciones[n.clave]={};
  resoluciones[n.clave].booking_id  = bk;
  resoluciones[n.clave].driver_id   = did;
  resoluciones[n.clave].nombre_malla= nom;
  // NO setear accion='ok' todavía — el usuario debe presionar Confirmar

  // Actualizar visual: poner candidato en verde sin re-renderizar toda la lista
  const card = document.getElementById(`nov-card-${i}`);
  if(card){
    card.querySelectorAll('.nov-candidato').forEach(el=>{
      el.classList.toggle('selected', el.dataset.bk===bk);
    });
    // Mostrar hint de que hay selección pendiente de confirmar
    let hint = card.querySelector('.sel-hint');
    if(!hint){
      const actions = card.querySelector('.nov-actions');
      if(actions){
        hint = document.createElement('span');
        hint.className = 'sel-hint';
        hint.style.cssText = 'font-size:10px;font-family:var(--mono);color:var(--green);margin-right:auto;';
        actions.insertBefore(hint, actions.firstChild);
      }
    }
    if(hint) hint.textContent = `✓ Seleccionado: ${nom.split(' ').slice(0,2).join(' ')} — presiona Confirmar`;
  }
}

export function confirmarOk(i){
  const n=novedades[i];
  if(!n) return;
  if(n.tipo===TIPOS_SIN_BOOKING){
    const bk=n._booking_manual||'';
    if(!bk){ toast('Ingresa el Booking ID antes de confirmar'); return; }
    resoluciones[n.clave]={accion:'ok', booking_id:bk};
  } else if(n.tipo==='SIN_MALLA'){
    const bk=n._booking_manual||'';
    if(!bk){ toast('Ingresa el Booking ID antes de confirmar'); return; }
    resoluciones[n.clave]={accion:'ok', booking_id:bk, driver_id:n._driver_manual||''};
  } else if(n.tipo==='AMBIGUOUS'){
    const bkM=n._bk_manual||'';
    if(!resoluciones[n.clave]?.booking_id && !bkM){ toast('Selecciona un candidato o ingresa el booking'); return; }
    if(bkM && !resoluciones[n.clave]) resoluciones[n.clave]={accion:'ok', booking_id:bkM, nombre_manual:n._nombre_manual||''};
    else if(resoluciones[n.clave]) resoluciones[n.clave].accion='ok';
    else resoluciones[n.clave]={accion:'ok'};
    // Guardar en diccionario si hay nombre malla conocido
    const nombreMalla = resoluciones[n.clave].nombre_malla || n._nombre_manual || '';
    if(nombreMalla) dictSave(n.piloto, nombreMalla, 'auto');
  } else if(n.tipo==='FUZZY-LOW'||n.tipo==='LOW'){
    resoluciones[n.clave]={accion:'ok'};
    // Solo FUZZY-LOW aprende equivalencia de NOMBRE — LOW por definición ya
    // tiene match exacto de piloto+fecha (idx2 en conciliacion.js exige
    // normStr(piloto) idéntico); lo único que difiere ahí es el seller, no
    // el nombre. Guardar dictSave(piloto, piloto) en LOW no aprendería nada
    // y dejaría una entrada inútil en el diccionario.
    if(n.tipo==='FUZZY-LOW' && n.nota){
      // Si no se puede extraer el nombre malla de la nota, NO llamar
      // dictSave() — guardar con un valor vacío/incorrecto sería peor que
      // no guardar nada (corrompería el diccionario silenciosamente).
      const m = n.nota.match(/malla="([^"]+)"/);
      if(m) dictSave(n.piloto, m[1], 'auto');
    }
  } else {
    resoluciones[n.clave]={accion:'ok'};
  }
  renderListaNovedades();
  actualizarSummary();
}

export function confirmarCero(i){
  const n=novedades[i];
  if(!n) return;
  const bk = bookingDeNovedad(n);
  if(!bk){ toast('No hay booking ID disponible en la malla para incluir en $0'); return; }
  resoluciones[n.clave]={accion:'cero', booking_id:bk};
  renderListaNovedades();
  actualizarSummary();
}

export function confirmarExcluir(i){
  const n=novedades[i];
  if(!n) return;
  resoluciones[n.clave]={accion:'excluir'};
  renderListaNovedades();
  actualizarSummary();
}

export function actualizarSummary(){
  const resueltos=Object.values(resoluciones).filter(r=>r.accion==='ok').length;
  const excluidos=Object.values(resoluciones).filter(r=>r.accion==='excluir').length;
  const enCero=Object.values(resoluciones).filter(r=>r.accion==='cero').length;
  const pendientes=novedades.length-resueltos-excluidos-enCero;
  const tipos=novedades.reduce((acc,n)=>{ acc[n.tipo]=(acc[n.tipo]||0)+1; return acc; },{});
  const sumEl=document.getElementById('nov-summary');
  if(!sumEl) return;

  const tiposHtml=Object.entries(tipos).map(([t,n])=>
    `<span class="ns-item">
      <span class="badge ${badgeClass(t)}" onclick="filterNovedades('${t}')"
        style="cursor:pointer;${novFilter===t?'outline:2px solid var(--accent);outline-offset:2px;':''}">
        ${t}</span> <strong>${n}</strong>
    </span>`).join(' &nbsp; ');

  // Estilo de cada contador de estado — resaltado si está activo
  const stOk  = novEstado==='ok'      ? 'font-weight:700;text-decoration:underline;' : '';
  const stEx  = novEstado==='excluir' ? 'font-weight:700;text-decoration:underline;' : '';
  const stCe  = novEstado==='cero'    ? 'font-weight:700;text-decoration:underline;' : '';
  const stPe  = novEstado==='pendiente'?'font-weight:700;text-decoration:underline;' : '';

  // Determinar texto de ayuda contextual
  let ayuda = '';
  if(novEstado)    ayuda=`· Mostrando: <strong style="color:var(--accent);">${novEstado==='ok'?'incluidos':novEstado==='excluir'?'excluidos':novEstado==='cero'?'en $0':'pendientes'}</strong> <span style="cursor:pointer;color:var(--text3);" onclick="filterEstado(null)">[quitar]</span>`;
  else if(novFilter) ayuda=`· Filtro tipo: <strong style="color:var(--accent);">${novFilter}</strong>`;
  else               ayuda=`· Clic en badges o contadores para filtrar`;

  sumEl.innerHTML=`${tiposHtml} &nbsp;&nbsp;
    <span class="ns-item" onclick="filterEstado('ok')"
      style="cursor:pointer;color:var(--green);${stOk}">✓ ${resueltos} incluidos</span>
    <span class="ns-item" onclick="filterEstado('excluir')"
      style="cursor:pointer;color:var(--text3);${stEx}">✗ ${excluidos} excluidos</span>
    <span class="ns-item" onclick="filterEstado('cero')"
      style="cursor:pointer;color:var(--yellow);${stCe}">⓪ ${enCero} en $0</span>
    <span class="ns-item" onclick="filterEstado('pendiente')"
      style="cursor:pointer;color:var(--yellow);${stPe}">⏳ ${pendientes} pendientes</span>
    <span class="ns-item" style="color:var(--text3);font-size:10px;font-family:var(--mono);">${ayuda}</span>`;
}

export function excluirTodas(){
  novedades.forEach(n=>{ resoluciones[n.clave]={accion:'excluir'}; });
  renderListaNovedades();
  actualizarSummary();
}

export function aplicarResoluciones(){
  // Construir set de booking_ids excluidos por SIN_BOOKING
  const bookingsExcluidos = new Set();

  novedades.forEach((n,i)=>{
    const res=resoluciones[n.clave];

    if(n.tipo===TIPOS_SIN_BOOKING && n.fuente==='dist'){
      if(!res||res.accion==='excluir'){
        // Marcar para exclusión — guardar el índice del distResult
        distResult[n.idx]._excluido_sin_booking=true;
        bookingsExcluidos.add(n.idx); // índice en distResult
      } else if(res.accion==='ok'&&res.booking_id){
        distResult[n.idx].booking_id=res.booking_id;
        distResult[n.idx]._manual=true;
      }
    }

    if(TIPOS_NOVEDAD.has(n.tipo)&&n.fuente==='conc'){
      if(!res){
        // Pendiente no resuelto — excluir automáticamente
        concResult[n.idx]._excluido_manual=true;
        concResult[n.idx]._nivel_original=n.tipo;
        // SIN marcar _accion_manual → buildExclusiones lo identifica como PENDIENTE
      } else if(res.accion==='excluir'){
        concResult[n.idx]._excluido_manual=true;
        concResult[n.idx]._accion_manual='excluir'; // exclusión explícita del analista
        concResult[n.idx]._nivel_original=n.tipo;
      } else if(res.accion==='ok'){
        concResult[n.idx]._resolucion_manual=true;
        if(res.driver_id) concResult[n.idx].driver_id=res.driver_id;

        const mKeys=Object.keys(mallaRaw[0]||{});
        const mBKey=mKeys.find(k=>/booking/i.test(k))||'BOOKING SERVICIO';
        const mDKey=mKeys.find(k=>/^id[\s_]?piloto/i.test(k.trim()))||'ID PILOTO';

        if(res.booking_id){
          if(concResult[n.idx].matches.length>1){
            // Filtrar al candidato seleccionado
            const fil=concResult[n.idx].matches.filter(m=>m[mBKey]===res.booking_id);
            if(fil.length>0) concResult[n.idx].matches=fil;
          } else if(concResult[n.idx].matches.length===0){
            // Sin matches — buscar en mallaRaw por booking_id
            const mRow = mallaRaw.find(m=>m[mBKey]===res.booking_id);
            if(mRow) concResult[n.idx].matches=[mRow];
            else {
              // Crear un match mínimo con los datos disponibles
              const fakeMatch={};
              fakeMatch[mBKey] = res.booking_id;
              if(res.driver_id) fakeMatch[mDKey] = res.driver_id;
              concResult[n.idx].matches=[fakeMatch];
            }
          }
          // Si tiene 1 match pero booking diferente, actualizarlo
          if(concResult[n.idx].matches.length===1 &&
             concResult[n.idx].matches[0][mBKey] !== res.booking_id){
            const mRow = mallaRaw.find(m=>m[mBKey]===res.booking_id);
            if(mRow) concResult[n.idx].matches=[mRow];
          }
        }
        concResult[n.idx].nivel_confianza='MANUAL-OK';
      } else if(res.accion==='cero'){
        // Anulación a $0 — runTrump() inyecta la fila directamente desde
        // resoluciones{}; solo marcamos el registro original para que
        // buildExclusiones() no lo cuente también como SIN_TADA/AMBIGUOUS excluido.
        concResult[n.idx]._resolucion_cero=true;
      }
    }
  });

  showProcessing('Aplicando resoluciones...');
  setTimeout(()=>{
    try{
      runDistribucionSilent();
      // Después de re-generar distResult, aplicar exclusiones de SIN_BOOKING
      // Los SIN_BOOKING confirmados con booking nuevo ya están en distResult con booking correcto
      // Los SIN_BOOKING excluidos: marcarlos como __EXCLUIDO__ en el nuevo distResult
      // Identificarlos por piloto+fecha_malla+hora ya que idx cambió
      const excluirPorPiloto = novedades
        .filter(n=> n.tipo===TIPOS_SIN_BOOKING && (!resoluciones[n.clave]||resoluciones[n.clave].accion==='excluir'))
        .map(n=>(`${n.piloto}||${n.fecha}`));

      distResult.forEach(r=>{
        const key=`${r.piloto}||${r.fecha_malla||r.fecha}`;
        if(excluirPorPiloto.includes(key) && (!r.booking_id||r.booking_id==='?'||r.booking_id==='SIN BOOKING')){
          r.booking_id='__EXCLUIDO__';
        }
      });
    }catch(e){ console.error(e); }
    finally{ hideProcessing(); navStep(5); setMaxStep(6); toast('Resoluciones aplicadas'); }
  },100);
}
