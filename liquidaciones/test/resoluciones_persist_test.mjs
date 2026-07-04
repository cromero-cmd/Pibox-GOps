// Test de regresión — BUGFIX: resoluciones{} se perdían al volver a Novedades.
//
// Escenario real: usuario confirma novedades manualmente → va al diccionario,
// agrega equivalencias → re-aplica diccionario (algunos registros pasan a
// APRENDIDO) → vuelve a Novedades (abrirNovedades()) → antes del fix,
// resoluciones{} quedaba vacío y las confirmaciones se perdían.
//
// También verifica que resetNovedades() (llamado por runConciliacion() al
// inicio de una pasada fresca) sí limpia todo correctamente.
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', value:'', style:{},
    disabled:false, className:'',
    classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    remove(){}, insertBefore(){}, appendChild(){},
  };
  return els[id];
}
global.document = {
  getElementById:(id)=>fakeEl(id),
  createElement:()=>fakeEl('__tmp__'),
  body:{ appendChild(){} },
};
global.fetch = () => Promise.reject(new Error('sin red'));
global.XLSX = { utils:{}, writeFile(){} };

const concMod = await import('../js/conciliacion.js');
const distMod = await import('../js/distribucion.js');
const parser   = await import('../js/parser.js');
const novMod   = await import('../js/novedades.js');

// Exponer resetNovedades al global (simula lo que hace main.js)
global.resetNovedades = novMod.resetNovedades;

function setupBase(){
  parser.mallaRaw.length = 0;
  parser.mallaRaw.push(
    { 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez',  'FECHA':'2026-06-10', 'SELLER':'BOG', 'ID PILOTO':'D-1', 'INICIO DE TURNO':'08:00', 'DÍA':'martes' },
    { 'BOOKING SERVICIO':'BK-B', 'NOMBRE':'Juan Perez',   'FECHA':'2026-06-10', 'SELLER':'BOG', 'ID PILOTO':'D-2', 'INICIO DE TURNO':'09:00', 'DÍA':'martes' },
  );

  concMod.concResult.length = 0;
  concMod.concResult.push(
    // Registro LOW — el usuario lo confirmará manualmente
    { piloto:'Pedro Gomez', ciudad:'BOG', seller:'BOG', fecha:'2026-06-10',
      nivel_confianza:'LOW', paquetes:5, incentivos:1, cancelados:0, tareas:0,
      garantizado:0, bonos:0, ajustes:0, driver_id:'D-1',
      matches:[{ 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez', 'ID PILOTO':'D-1', 'INICIO DE TURNO':'08:00', 'FECHA':'2026-06-10', 'SELLER':'BOG', 'DÍA':'martes' }],
      nota:'seller distinto', },
    // Registro AMBIGUOUS — también confirmado manualmente, luego "se resuelve"
    // por el diccionario (simularemos cambiando nivel_confianza a APRENDIDO)
    { piloto:'Juan Perez', ciudad:'BOG', seller:'BOG', fecha:'2026-06-10',
      nivel_confianza:'AMBIGUOUS', paquetes:3, incentivos:0, cancelados:0, tareas:0,
      garantizado:0, bonos:0, ajustes:0, driver_id:'D-2',
      matches:[{ 'BOOKING SERVICIO':'BK-B', 'NOMBRE':'Juan Perez', 'ID PILOTO':'D-2', 'INICIO DE TURNO':'09:00', 'FECHA':'2026-06-10', 'SELLER':'BOG', 'DÍA':'martes' }],
      nota:'ambiguo original', },
  );

  distMod.distResult.length = 0;
  novMod.novedades.length = 0;
  Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]);
}

// ── CASO 1: resoluciones se preservan al volver a Novedades (BUGFIX core) ────
{
  setupBase();

  // Primera visita a Novedades
  novMod.abrirNovedades();
  assert.equal(novMod.novedades.length, 2, 'primera visita: deben aparecer 2 novedades');

  // Confirmar la novedad LOW (idx 0)
  novMod.confirmarOk(0);
  const claveLow = novMod.novedades[0].clave;
  assert.equal(novMod.resoluciones[claveLow]?.accion, 'ok', 'LOW confirmado → resoluciones[clave].accion="ok"');

  // Simular que reaplicarDiccionario() resuelve el AMBIGUOUS → APRENDIDO
  // (en producción esto pasaría mediante reaplicarDiccionario(); aquí lo hacemos directo)
  concMod.concResult[1].nivel_confianza = 'APRENDIDO';

  // Segunda visita a Novedades (lo que hace el botón del stepper)
  novMod.abrirNovedades();

  // Ahora solo debería haber 1 novedad (APRENDIDO no aparece)
  assert.equal(novMod.novedades.length, 1, 'segunda visita: solo 1 novedad (APRENDIDO ya no aparece)');
  assert.equal(novMod.novedades[0].tipo, 'LOW');

  // BUGFIX: la confirmación del LOW debe haberse preservado
  assert.equal(novMod.resoluciones[claveLow]?.accion, 'ok',
    'BUGFIX: resoluciones[clave] debe sobrevivir a la segunda abrirNovedades()');

  // La clave del AMBIGUOUS resuelto debe haber sido limpiada (era stale)
  const claveAmbig = `${claveLow.split('||')[0].replace('pedro gomez','juan perez')}||2026-06-10||AMBIGUOUS`;
  // No importa su valor exacto — lo que importa es que la resolución del LOW siga
  assert.ok(!Object.values(novMod.resoluciones).some(r=>r.accion==='excluir'),
    'no debe haber resoluciones de exclusión (el AMBIGUOUS no fue resuelto manualmente)');

  console.log('OK: resoluciones{} se preserva al volver a Novedades tras reaplicar diccionario (BUGFIX)');
}

// ── CASO 2: la limpieza de stale entries funciona correctamente ───────────────
{
  setupBase();

  // Simular que hay una resolución "huérfana" (clave que no corresponde a ninguna novedad)
  novMod.novedades.length = 0;
  novMod.novedades.push(...novMod.buildNovedades()); // 2 novedades
  novMod.resoluciones['clave-obsoleta-fantasma'] = { accion:'ok' };
  novMod.resoluciones[novMod.novedades[0].clave]  = { accion:'ok' };

  // Simular que una novedad desaparece (se resuelve por diccionario)
  concMod.concResult[1].nivel_confianza = 'APRENDIDO';

  novMod.abrirNovedades(); // rebuild novedades → 1 novedad

  // La clave huérfana debe haber desaparecido
  assert.ok(!novMod.resoluciones['clave-obsoleta-fantasma'],
    'la clave stale/huérfana debe limpiarse al reconstruir novedades');

  // La resolución de la novedad que sigue vigente debe persistir
  assert.equal(novMod.resoluciones[novMod.novedades[0].clave]?.accion, 'ok',
    'la resolución de la novedad vigente debe persistir');

  // actualizarSummary() con 1 novedad y 1 resolución no debe sobre-contar
  // (sin stale entries, Object.values(resoluciones).filter(accion==='ok').length === 1)
  const resueltos = Object.values(novMod.resoluciones).filter(r=>r.accion==='ok').length;
  assert.equal(resueltos, 1, 'conteo correcto: solo la 1 resolución vigente');
  assert.equal(novMod.novedades.length - resueltos, 0, 'pendientes: 0 (todos resueltos)');
  console.log('OK: limpieza de stale entries correcta — actualizarSummary() no sobre-cuenta');
}

// ── CASO 3: resetNovedades() limpia TODO (llamado por runConciliacion()) ──────
{
  setupBase();
  novMod.novedades.push(...novMod.buildNovedades());
  novMod.resoluciones['pedro-gomez||2026-06-10||LOW'] = { accion:'ok' };
  assert.equal(Object.keys(novMod.resoluciones).length, 1, 'hay 1 resolución antes del reset');

  novMod.resetNovedades();

  assert.equal(novMod.novedades.length, 0, 'resetNovedades() vacía novedades[]');
  assert.equal(Object.keys(novMod.resoluciones).length, 0, 'resetNovedades() vacía resoluciones{}');
  console.log('OK: resetNovedades() limpia todo — correcto para inicio de runConciliacion()');
}

// ── CASO 4: window.resetNovedades?.() es llamado por runConciliacion() ────────
// Verificar que la señal de resetNovedades en el global funciona
{
  setupBase();
  novMod.novedades.push(...novMod.buildNovedades());
  novMod.resoluciones['prueba'] = { accion:'ok' };

  // window.resetNovedades (ya expuesto en el global al inicio del test)
  window.resetNovedades?.();

  assert.equal(Object.keys(novMod.resoluciones).length, 0,
    'window.resetNovedades?.() debe limpiar resoluciones (simulando llamada desde runConciliacion)');
  console.log('OK: window.resetNovedades?.() funciona — runConciliacion() puede llamarla de forma segura');
}

console.log('\n✓ TODOS LOS CHECKS DE PERSISTENCIA DE RESOLUCIONES PASARON');
