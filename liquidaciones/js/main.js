// ═══════════════════════════════════════════
// MAIN — punto de entrada: wiring de window.*, boot, listeners globales
// ═══════════════════════════════════════════
import { LS_SESSION } from './config.js';
import { setOnNavStep6, navStep, exportTable, chPage, showProcessing, hideProcessing, setMaxStep } from './ui.js';

import { tadaRaw, mallaRaw, buildColMap, setColMap, doDrag, doDrop, loadFile, replaceFile, removeFile, runDiagnostico } from './parser.js';
import { tadaNorm, setTadaNorm, runNorm } from './normalizer.js';
import { runConciliacion, filterConc, reaplicarDiccionario } from './conciliacion.js';
import { runDistribucion } from './distribucion.js';
import { abrirNovedades, excluirTodas, aplicarResoluciones, filterNovedades, filterEstado, revertirResolucion } from './novedades.js';
import { initTariffs, renderTariffPanel, publishTariff, activateVersion, addFechaEspecial, removeFechaEspecial, updateFechaEspecial } from './tariffs.js';
import { runTrump, downloadTrump } from './trump.js';
import { abrirModalEnvio, cerrarModalEnvio, enviarPorCorreo } from './email.js';
import { abrirModalHistorial, ejecutarGuardarHistorial, abrirHistorialConsulta, aplicarFiltrosHist, limpiarFiltrosHist, exportarHistorial, cancelarSobrescribirHistorial, confirmarSobrescribirHistorial } from './historial.js';
import { actualizarDictSummary, renderDiccionario, agregarEquivalencia, confirmarNuevaEquivalencia, editarEquivalencia, guardarEdicion, eliminarEquivalencia, refrescarDiccionario } from './diccionario.js';
import {
  doLogin, toggleUserMenu, abrirPanelUsuarios, abrirEditarNombre, abrirCambiarPassword, cerrarSesion,
  crearUsuario, editarUsuario, guardarUsuario, eliminarUsuario, guardarNombre, confirmarCambioPass,
  initUsers, loadUsers, aplicarSesion, setCurrentUser,
} from './auth.js';

// ═══════════════════════════════════════════
// GLUE — "fast path" carga→conciliación (duplica diagnóstico+normalización
// igual que el original, en vez de llamar runNorm(), para no disparar su
// renderizado de tablas intermedias). Vive en main.js porque necesita
// funciones de parser.js, normalizer.js y conciliacion.js sin crear ciclos.
// ═══════════════════════════════════════════
function proceedToConciliacion(){
  showProcessing('Analizando archivos...');
  setTimeout(()=>{
    const result = buildColMap(tadaRaw);
    setColMap(result.map);

    if(result.error || result.map.filter(c=>c.t==='d').length === 0){
      hideProcessing();
      runDiagnostico();
      return;
    }

    setTadaNorm([]);
    const fixedCols=result.map.filter(c=>c.t==='f');
    const extraCols =result.map.filter(c=>c.t==='e');
    const dayCols   =result.map.filter(c=>c.t==='d');
    const groups={};
    dayCols.forEach(c=>{
      const key=`${c.dia}||${c.fecha}`;
      if(!groups[key]) groups[key]={dia:c.dia,fecha:c.fecha,cols:{}};
      groups[key].cols[c.metric]=c.i;
    });
    const sortedGroups=Object.values(groups).sort((a,b)=>a.fecha.localeCompare(b.fecha));
    const parseMoney=v=>{ if(typeof v==='number') return v; if(!v&&v!==0) return 0; return parseFloat(String(v).replace(/[$\s.]/g,'').replace(',','.'))||0; };
    const getExtra=(row,name)=>{ const col=extraCols.find(c=>c.n===name); return col?row[col.i]:0; };
    const dataRows=tadaRaw.slice(3).filter(r=>r.some(v=>v!==''&&v!==null&&v!==undefined&&v!==0));

    dataRows.forEach(row=>{
      const fixed={};
      fixedCols.forEach(c=>{ fixed[c.n]=String(row[c.i]||'').trim(); });
      if(!fixed.piloto||!fixed.piloto.trim()) return;
      const tareas     =parseInt(getExtra(row,'tareas'))||0;
      const garantizado=parseMoney(getExtra(row,'garantizado'));
      const bonos      =parseMoney(getExtra(row,'bonos'));
      const ajustes    =parseMoney(getExtra(row,'ajustes'));
      const filas=sortedGroups.map(g=>({
        piloto:fixed.piloto,
        // Si ciudad está vacía, inferir desde el seller (ej: 'CAL-TD-FLORESTA...' → 'CAL')
        ciudad: fixed.ciudad || (fixed.seller ? String(fixed.seller).split('-')[0].trim() : ''),
        seller:fixed.seller||'',
        dia:g.dia, fecha:g.fecha,
        paquetes:  parseInt(row[g.cols.paquetes])||0,
        incentivos:parseInt(row[g.cols.incentivos])||0,
        cancelados:parseInt(row[g.cols.cancelados])||0,
        tareas:0, garantizado:0, bonos:0, ajustes:0,
      }));
      let targetIdx=filas.findIndex(f=>f.paquetes>0||f.incentivos>0||f.cancelados>0);
      if(targetIdx===-1) targetIdx=0;
      filas[targetIdx].tareas=tareas; filas[targetIdx].garantizado=garantizado;
      filas[targetIdx].bonos=bonos; filas[targetIdx].ajustes=ajustes;
      tadaNorm.push(...filas);
    });

    if(tadaNorm.length === 0){
      hideProcessing();
      runDiagnostico();
      return;
    }

    // Verificar que las fechas están en formato correcto
    const fechasTada = [...new Set(tadaNorm.map(r=>r.fecha))].filter(Boolean).sort();

    // Si hay mismatch de formatos, ir a diagnóstico
    const formatOk = fechasTada.every(f=>/^\d{4}-\d{2}-\d{2}$/.test(f));
    if(!formatOk){
      hideProcessing();
      runDiagnostico();
      return;
    }

    setMaxStep(3);
    hideProcessing();
    runConciliacion();
  }, 100);
}

// ═══════════════════════════════════════════
// WIRING — expone al scope global las funciones invocadas por atributos
// inline (onclick/oninput/onchange) tanto del HTML estático como de las
// plantillas que generan innerHTML dinámicamente. Sin esto, los módulos ES
// (con scope propio) dejarían esos handlers rotos.
// ═══════════════════════════════════════════
Object.assign(window, {
  // auth
  doLogin, toggleUserMenu, abrirPanelUsuarios, abrirEditarNombre, abrirCambiarPassword, cerrarSesion,
  crearUsuario, editarUsuario, guardarUsuario, eliminarUsuario, guardarNombre, confirmarCambioPass,
  // ui / stepper / tablas
  navStep, exportTable, chPage,
  // parser / carga de archivos
  doDrag, doDrop, loadFile, replaceFile, removeFile, proceedToConciliacion,
  // normalización
  runNorm,
  // conciliación
  runConciliacion, filterConc, reaplicarDiccionario,
  // diccionario
  renderDiccionario, agregarEquivalencia, confirmarNuevaEquivalencia, editarEquivalencia, guardarEdicion, eliminarEquivalencia, refrescarDiccionario,
  // distribución
  runDistribucion,
  // novedades
  abrirNovedades, excluirTodas, aplicarResoluciones, filterNovedades, filterEstado, revertirResolucion,
  // tarifas — NOTA: resetTarifas() no se expone: el botón "Descartar" referencia
  // una función que nunca existió en el original (bug preexistente, no introducido
  // por esta migración — se documenta, no se corrige sin pedirlo explícitamente).
  publishTariff, activateVersion, addFechaEspecial, removeFechaEspecial, updateFechaEspecial,
  // trump
  runTrump, downloadTrump,
  // email
  abrirModalEnvio, cerrarModalEnvio, enviarPorCorreo,
  // historial
  abrirModalHistorial, ejecutarGuardarHistorial, abrirHistorialConsulta, aplicarFiltrosHist, limpiarFiltrosHist, exportarHistorial,
  cancelarSobrescribirHistorial, confirmarSobrescribirHistorial,
});

// El panel de tarifas usa oninput="currentEdits['key']=..." inline (scope
// global) — tariffs.js mantiene window.currentEdits sincronizado en cada
// reasignación interna; aquí solo conectamos el render de tarifas al paso 6.
setOnNavStep6(renderTariffPanel);

// ═══════════════════════════════════════════
// LISTENERS GLOBALES
// ═══════════════════════════════════════════
document.addEventListener('click', e=>{
  const menu = document.getElementById('user-menu');
  if(menu && !menu.contains(e.target)) menu.classList.remove('open');
});

document.addEventListener('keydown', e=>{
  if(e.key==='Enter' && document.getElementById('auth-screen').style.display!=='none'){
    doLogin();
  }
});

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
initTariffs();
actualizarDictSummary();

// Verificar sesión guardada
(async()=>{
  await initUsers(); // asegurar que existe el usuario por defecto

  try{
    const sess = localStorage.getItem(LS_SESSION);
    if(sess){
      const saved = JSON.parse(sess);
      // Verificar que el usuario aún existe en el storage compartido
      const users = loadUsers();
      if(users && users[saved.username]){
        setCurrentUser(saved);
        aplicarSesion();
        return;
      }
    }
  }catch{}

  // No hay sesión válida — mostrar login
  document.getElementById('auth-screen').style.display='flex';
  document.getElementById('login-user').focus();
})();
