// Test ad-hoc — bug crítico: ejecutarGuardarHistorial() enviaba cada
// registro como OBJETO (con nombres de campo) en vez de ARRAY posicional
// de 29 valores en el orden exacto de HEADERS en Apps Script. Además
// run_id/guardado_por/fecha_guardado viajaban sueltos en el payload, nunca
// dentro de cada fila — eso desplazaba todo lo que venía después de
// cobro_garantizado en el Sheet real (evidencia: cobro_bono en col S
// terminaba con el valor de pago_garantizado, guardado_por/fecha_guardado
// se colaban en pago_paquete/pago_incentivo, y las últimas columnas
// quedaban vacías).
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', value:'', style:{}, disabled:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];}, remove(){},
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id), createElement:()=>fakeEl('__tmp__'), body:{appendChild(){}} };

let fetchCalls = [];
global.fetch = (url, opts) => { fetchCalls.push({url, opts}); return Promise.resolve({ json: async () => ({ ok: true }) }); };

const tariffs = await import('../js/tariffs.js');
const trumpMod = await import('../js/trump.js');
const auth     = await import('../js/auth.js');
const historial = await import('../js/historial.js');

tariffs.initTariffs();
auth.setCurrentUser({ username:'cromero', nombre:'Camilo Romero', role:'superadmin' });

// HEADERS exactos de Apps Script (29 columnas) — la fuente de verdad del orden esperado.
const HEADERS = [
  'run_id','periodo','id_piloto','piloto','ciudad','seller','fecha','dia',
  'booking_id','paquetes','incentivos','cancelados','tareas',
  'cobro_paquete','cobro_incentivo','cobro_cancelado','cobro_tarea',
  'cobro_garantizado','cobro_bono','cobro_total',
  'pago_paquete','pago_incentivo','pago_cancelado','pago_tarea',
  'pago_garantizado','pago_bono','pago_piloto',
  'guardado_por','fecha_guardado',
];
assert.equal(HEADERS.length, 29);

// Reproduce el caso real reportado: booking VD (Sábado) sin paquetes/incentivos/
// cancelados/tareas/bono — solo garantizado. Antes de este fix, este es
// exactamente el patrón de fila que terminaba desplazado en el Sheets real.
trumpMod.trumpRows.length = 0;
trumpMod.trumpRows.push({
  _run_id:'LIQ-2026-06-25', _driver_id:'D-100', _piloto:'Pedro Gomez', _ciudad:'BOG', _seller:'BOG-X',
  _fecha:'2026-06-20', _dia:'Sabado', BOOKING_ID:'6a35fdc99a8d66a14311ebac',
  _paquetes:0, _incentivos:0, _cancelados:0, _tareas:0, bonos:0,
  // cobro_garantizado/pago_garantizado ahora se leen directo de buildTrumpRows()
  // (ya no se recalculan en historial.js) — se simulan aquí los valores que
  // produciría el cálculo automático para un VD (Sabado) sin productivo:
  // cobro_garantizado = tarifa_garantizado_vd (97200, delta completo ya que
  // cobro_operativo=0) y pago_garantizado = minimo_vd (80000).
  _cobro_garantizado:97200, _complemento:80000,
  COMPANY_FINAL_COST:97200, ADDITIONAL_COMPANY_FINAL_COST:0, FINAL_COST:80000, ADDITIONAL_FINAL_COST:0,
});

fakeEl('hist-url').value = 'https://script.google.com/macros/s/FAKE/exec';

await historial.ejecutarGuardarHistorial();

const postCall = fetchCalls.find(c=>c.opts?.method==='POST');
assert.ok(postCall, 'debe hacer un POST al backend');
const enviado = JSON.parse(decodeURIComponent(postCall.opts.body.replace(/^payload=/, '')));

assert.equal(enviado.accion, 'guardarHistorial');
assert.equal(enviado.registros.length, 1);

const fila = enviado.registros[0];
assert.ok(Array.isArray(fila), 'cada registro debe ser un ARRAY posicional, no un objeto con nombres de campo');
assert.equal(fila.length, 29, `cada fila debe tener exactamente 29 valores — actual: ${fila.length}`);
console.log('OK: cada registro es un array de exactamente 29 valores (no un objeto)');

const idx = {}; HEADERS.forEach((h,i)=>idx[h]=i);

assert.equal(fila[idx.run_id], 'LIQ-2026-06-25');
assert.equal(fila[idx.periodo], enviado.periodo);
assert.equal(fila[idx.id_piloto], 'D-100');
assert.equal(fila[idx.piloto], 'Pedro Gomez');
assert.equal(fila[idx.booking_id], '6a35fdc99a8d66a14311ebac');
console.log('OK: run_id/periodo/id_piloto/piloto/booking_id en las posiciones correctas');

// El caso real del bug — sin paquetes/bono, solo garantizado de sábado (VD):
assert.equal(fila[idx.cobro_bono], 0, 'cobro_bono debe ser 0 (sin bono) — antes aparecía 80000 (valor de pago_garantizado, desplazado)');
assert.equal(fila[idx.cobro_total], 97200, 'cobro_total debe ser el garantizado VD (97200) — antes aparecía 0');
assert.equal(fila[idx.pago_paquete], 0, 'pago_paquete debe ser 0 — antes aparecía el nombre de guardado_por ("Sergio Romero"), desplazado');
assert.equal(typeof fila[idx.pago_incentivo], 'number', 'pago_incentivo debe ser numérico — antes aparecía la fecha_guardado, desplazada');
assert.equal(fila[idx.pago_garantizado], 80000, 'pago_garantizado debe ser 80000 (mínimo VD)');
assert.equal(fila[idx.pago_bono], 0);
assert.equal(fila[idx.pago_piloto], 80000, 'pago_piloto = garantizado cuando no hay productivo ni bono');
console.log('OK: ningún valor se desplaza — cobro_bono/cobro_total/pago_* en sus columnas reales, no las del bug reportado');

// guardado_por y fecha_guardado ahora viajan DENTRO de la fila, en las dos últimas columnas
assert.equal(fila[idx.guardado_por], 'Camilo Romero', 'guardado_por debe ir en la columna 28 (AB), no colado en pago_paquete');
assert.match(String(fila[idx.fecha_guardado]), /^\d{4}-\d{2}-\d{2}T/, 'fecha_guardado debe ser un timestamp ISO en la columna 29 (AC), no colado en pago_incentivo');
console.log('OK: guardado_por y fecha_guardado viajan dentro de cada fila, en las columnas 28 y 29');

console.log('\n✓ TODOS LOS CHECKS DEL FIX DE COLUMNAS DE HISTORIAL PASARON');
