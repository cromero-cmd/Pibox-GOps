// Test de regresión — BUGFIX: flags obsoletas de aplicarResoluciones() previas.
//
// Escenario: el usuario excluye una novedad en la pasada 1 (sin re-correr
// conciliación), luego abre Novedades de nuevo y la confirma en la pasada 2.
// Antes del fix, _excluido_manual y _accion_manual quedaban sucios en concResult,
// haciendo que runDistribucionSilent() la filtrara fuera y runTrump() la
// registrara como "[EXCL] … excluido manualmente" a pesar de haber sido confirmada.
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
    firstChild: null,
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

// ── Setup: una fila en la malla y un registro LOW en concResult ──────────────
function setup(){
  parser.mallaRaw.length = 0;
  parser.mallaRaw.push({
    'BOOKING SERVICIO':'BK-100', 'NOMBRE':'Pedro Gomez',
    'FECHA':'2026-06-10', 'SELLER':'BOG', 'ID PILOTO':'D-1',
    'INICIO DE TURNO':'08:00', 'DÍA':'martes',
  });

  // Limpiar concResult dejando un solo registro LOW con su match
  concMod.concResult.length = 0;
  concMod.concResult.push({
    piloto:'Pedro Gomez', ciudad:'BOG', seller:'BOG', fecha:'2026-06-10',
    nivel_confianza:'LOW',
    paquetes:5, incentivos:1, cancelados:0, tareas:0,
    garantizado:0, bonos:0, ajustes:0,
    matches:[{ 'BOOKING SERVICIO':'BK-100', 'NOMBRE':'Pedro Gomez',
               'FECHA':'2026-06-10', 'SELLER':'BOG', 'ID PILOTO':'D-1',
               'INICIO DE TURNO':'08:00', 'DÍA':'martes' }],
    nota:'seller LOW', driver_id:'D-1',
  });

  // Limpiar distResult y novedades/resoluciones
  distMod.distResult.length = 0;
  novMod.novedades.length = 0;
  Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]);
}

// ── CASO 1: pasada simple (sin flags previos) — baseline, debe seguir OK ─────
{
  setup();
  novMod.novedades.push(...novMod.buildNovedades());
  assert.equal(novMod.novedades.length, 1, 'debe haber 1 novedad LOW');

  // Confirmar directamente
  novMod.confirmarOk(0);
  assert.equal(novMod.resoluciones[novMod.novedades[0].clave]?.accion, 'ok');

  novMod.aplicarResoluciones();

  assert.equal(concMod.concResult[0].nivel_confianza, 'MANUAL-OK', 'pasada 1 ok → MANUAL-OK');
  assert.ok(!concMod.concResult[0]._excluido_manual, 'no debe tener _excluido_manual');

  distMod.runDistribucionSilent();
  assert.equal(distMod.distResult.length, 1, 'debe aparecer en distResult');
  assert.equal(distMod.distResult[0].booking_id, 'BK-100');
  console.log('OK: pasada simple — confirmar produce MANUAL-OK e incluye en distResult');
}

// ── CASO 2: exclusión en pasada 1 → confirmación en pasada 2 ─────────────────
// Este es el bug que se reportó: los flags sucios bloqueaban la inclusión
// incluso después de confirmación explícita.
{
  setup();
  novMod.novedades.push(...novMod.buildNovedades());

  // Simular pasada 1: el usuario EXCLUYE la novedad
  novMod.confirmarExcluir(0);
  novMod.aplicarResoluciones();

  // Verificar que la pasada 1 dejó los flags sucios en concResult
  assert.ok(concMod.concResult[0]._excluido_manual, 'pasada 1: _excluido_manual debe estar set');
  assert.equal(concMod.concResult[0]._accion_manual, 'excluir', 'pasada 1: _accion_manual="excluir"');
  assert.equal(concMod.concResult[0].nivel_confianza, 'LOW', 'pasada 1: nivel_confianza no cambia al excluir');
  console.log('OK: pasada 1 (excluir) deja flags _excluido_manual + _accion_manual en concResult');

  // Simular pasada 2: el usuario abre Novedades de nuevo y CONFIRMA el mismo registro
  // abrirNovedades() reconstruye novedades y resetea resoluciones
  novMod.novedades.length = 0;
  novMod.novedades.push(...novMod.buildNovedades());
  Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]);

  // El registro LOW sigue apareciendo (nivel_confianza='LOW', que sí está en TIPOS_NOVEDAD)
  assert.equal(novMod.novedades.length, 1, 'pasada 2: el registro sigue apareciendo como novedad');

  // El usuario confirma
  novMod.confirmarOk(0);
  assert.equal(novMod.resoluciones[novMod.novedades[0].clave]?.accion, 'ok', 'pasada 2: resolución ok guardada');

  // Aplicar resoluciones de la pasada 2
  novMod.aplicarResoluciones();

  // ── Verificaciones del BUGFIX ──
  assert.equal(concMod.concResult[0].nivel_confianza, 'MANUAL-OK',
    'BUGFIX: pasada 2 confirmar → nivel_confianza debe ser MANUAL-OK');
  assert.ok(!concMod.concResult[0]._excluido_manual,
    'BUGFIX: _excluido_manual debe quedar borrado tras confirmar en pasada 2');
  assert.ok(!concMod.concResult[0]._accion_manual,
    'BUGFIX: _accion_manual debe quedar borrado tras confirmar en pasada 2');
  assert.ok(concMod.concResult[0]._resolucion_manual,
    'BUGFIX: _resolucion_manual debe estar set tras confirmar');
  console.log('OK: pasada 2 (confirmar) borra _excluido_manual y _accion_manual — BUGFIX confirmado');

  // Verificar que runDistribucionSilent() incluye el registro
  distMod.runDistribucionSilent();
  assert.equal(distMod.distResult.length, 1,
    'BUGFIX: el registro confirmado en pasada 2 debe aparecer en distResult');
  assert.equal(distMod.distResult[0].booking_id, 'BK-100');
  console.log('OK: runDistribucionSilent() incluye el registro confirmado en pasada 2');
}

// ── CASO 3: pendiente en pasada 1 → confirmación en pasada 2 ─────────────────
// Variante: el registro no fue tocado en la pasada 1 (pendiente auto-excluido)
// y se confirma en la pasada 2.
{
  setup();
  novMod.novedades.push(...novMod.buildNovedades());
  Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]);

  // Pasada 1: no hacer nada con el registro (pendiente) — aplicarResoluciones
  // lo marca _excluido_manual=true sin _accion_manual
  novMod.aplicarResoluciones();

  assert.ok(concMod.concResult[0]._excluido_manual, 'pasada 1 pendiente: _excluido_manual set');
  assert.ok(!concMod.concResult[0]._accion_manual, 'pasada 1 pendiente: NO _accion_manual');

  // Pasada 2: confirmar
  novMod.novedades.length = 0;
  novMod.novedades.push(...novMod.buildNovedades());
  Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]);

  assert.equal(novMod.novedades.length, 1, 'pasada 2: el registro pendiente sigue en novedades');
  novMod.confirmarOk(0);
  novMod.aplicarResoluciones();

  assert.equal(concMod.concResult[0].nivel_confianza, 'MANUAL-OK', 'pasada 2 desde pendiente → MANUAL-OK');
  assert.ok(!concMod.concResult[0]._excluido_manual, '_excluido_manual borrado desde pendiente');

  distMod.runDistribucionSilent();
  assert.equal(distMod.distResult.length, 1, 'registro desde pendiente → incluido en distResult');
  console.log('OK: pasada 2 confirma registro que era pendiente en pasada 1 (flag limpio)');
}

console.log('\n✓ TODOS LOS CHECKS DE RESOLUCIONES STALE FLAGS PASARON');
