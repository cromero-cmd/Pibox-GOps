// Test ad-hoc — feature: pilotos con 0 actividad en TADA van automáticamente
// en $0, sin pasar por Novedades. Antes, un piloto en la malla con booking
// real que también aparecía en TADA con paq=inc=can=0 se marcaba SIN_TADA
// (requería intervención manual). Ahora debe reconocerse como
// CERO_ACTIVIDAD: incluido directo en el template en $0, sin garantizado.
import { strict as assert } from 'node:assert';

global.window = global;
const lsStore = {};
global.localStorage = {
  getItem:k=>(k in lsStore ? lsStore[k] : null),
  setItem:(k,v)=>{ lsStore[k]=String(v); },
  removeItem:k=>{ delete lsStore[k]; },
};
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', style:{}, disabled:false, className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];},
  };
  return els[id];
}
global.document = { getElementById: (id) => fakeEl(id) };
global.fetch = () => Promise.reject(new Error('sin red en este test'));
global.XLSX = { utils:{}, writeFile(){} };

const parser       = await import('../js/parser.js');
const normalizer    = await import('../js/normalizer.js');
const conciliacion  = await import('../js/conciliacion.js');
const distribucion  = await import('../js/distribucion.js');
const trumpMod      = await import('../js/trump.js');

// ══════════════════════════════════════════════════════
// CASO 1 — piloto en malla con booking real, y match en TADA (mismo
// piloto+fecha+seller) con paq=inc=can=0 → debe ser CERO_ACTIVIDAD
// ══════════════════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Jorge Ramirez', 'FECHA':'2026-06-15', 'SELLER':'BOG-X',
  'BOOKING SERVICIO':'BK-CERO-ACT', 'ID PILOTO':'D-500', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({
  piloto:'Jorge Ramirez', ciudad:'BOG', seller:'BOG-X', dia:'lunes', fecha:'2026-06-15',
  paquetes:0, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null,
});

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const cero = conciliacion.concResult.find(r=>r.piloto==='Jorge Ramirez');
assert.ok(cero, 'debe existir el registro del piloto');
assert.equal(cero.nivel_confianza, 'CERO_ACTIVIDAD', 'debe marcarse CERO_ACTIVIDAD, no SIN_TADA');
assert.equal(cero._booking_malla, 'BK-CERO-ACT', 'debe incluir el booking_id de la malla');
assert.equal(cero.matches[0]['BOOKING SERVICIO'], 'BK-CERO-ACT');
assert.ok(!conciliacion.concResult.find(r=>r.nivel_confianza==='SIN_TADA'), 'no debe quedar ningún SIN_TADA para este caso');
console.log('OK: piloto con match en TADA (paq/inc/can=0) se marca CERO_ACTIVIDAD, no SIN_TADA');

// ══════════════════════════════════════════════════════
// CASO 2 — sin match en TADA en absoluto → sigue siendo SIN_TADA (regresión)
// ══════════════════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Piloto Fantasma 2', 'FECHA':'2026-06-16', 'SELLER':'BOG-Y',
  'BOOKING SERVICIO':'BK-FANTASMA-2', 'ID PILOTO':'D-501', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0; // ninguna fila de TADA ese día/seller

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const sinTada = conciliacion.concResult.find(r=>r.piloto==='Piloto Fantasma 2');
assert.equal(sinTada.nivel_confianza, 'SIN_TADA', 'sin ningún match en TADA, debe seguir siendo SIN_TADA (sin regresión)');
console.log('OK: sin match alguno en TADA, sigue siendo SIN_TADA (comportamiento previo intacto)');

// ══════════════════════════════════════════════════════
// CASO 3 — distribucion.js: CERO_ACTIVIDAD entra a distResult en $0, sin excluir
// ══════════════════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Jorge Ramirez', 'FECHA':'2026-06-15', 'SELLER':'BOG-X',
  'BOOKING SERVICIO':'BK-CERO-ACT', 'ID PILOTO':'D-500', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({
  piloto:'Jorge Ramirez', ciudad:'BOG', seller:'BOG-X', dia:'lunes', fecha:'2026-06-15',
  paquetes:0, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null,
});
await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

distribucion.runDistribucionSilent();
const distRow = distribucion.distResult.find(r=>r.piloto==='Jorge Ramirez');
assert.ok(distRow, 'CERO_ACTIVIDAD debe incluirse en distResult, no excluirse');
assert.equal(distRow.booking_id, 'BK-CERO-ACT');
assert.equal(distRow.paquetes_dist, 0);
assert.equal(distRow.incentivos_dist, 0);
assert.equal(distRow.cancelados_dist, 0);
assert.equal(distRow.tareas_dist, 0);
assert.equal(distRow.garantizado, 0);
assert.equal(distRow.bonos, 0);
assert.equal(distRow.ajustes, 0);
assert.equal(distRow.nivel_confianza, 'CERO_ACTIVIDAD');
console.log('OK: distribucion.js incluye CERO_ACTIVIDAD en distResult con todos los valores en 0, sin excluir');

// ══════════════════════════════════════════════════════
// CASO 4 — trump.js: bypass total, $0 incluso con tarifas que dispararían
// garantizado automático (ingresoNeto=0 está bajo cualquier mínimo)
// ══════════════════════════════════════════════════════
const av = { version: 'v1' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};
const mallaRawFixture = [{ FECHA:'2026-06-15' }];
const ceroActRow = {
  booking_id:'BK-CERO-ACT', driver_id:'D-500', piloto:'Jorge Ramirez', ciudad:'BOG', seller:'BOG-X',
  fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
  paquetes_dist:0, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
  garantizado:0, garantizado_tada:0, bonos:0, ajustes:0, nivel_confianza:'CERO_ACTIVIDAD', n_bookings:1,
};

// modo automático — sin el bypass, ingresoNeto=0 dispararía el garantizado completo
{
  const { rows } = trumpMod.buildTrumpRows([ceroActRow], t, av, mallaRawFixture, 'automatico');
  const r = rows[0];
  assert.equal(r.COMPANY_FINAL_COST, 0, 'COMPANY_FINAL_COST debe ser 0 (sin garantizado automático)');
  assert.equal(r.FINAL_COST, 0);
  assert.equal(r.ADDITIONAL_COMPANY_FINAL_COST, 0);
  assert.equal(r.ADDITIONAL_FINAL_COST, 0);
  assert.equal(r._confianza, 'CERO_ACTIVIDAD');
  assert.equal(r.BOOKING_ID, 'BK-CERO-ACT');
  console.log('OK: Modo automático — CERO_ACTIVIDAD da $0 en todos los campos financieros (bypass del garantizado automático)');
}

// modo TaDa — tampoco debe aplicar gross-up de ningún tipo
{
  const { rows } = trumpMod.buildTrumpRows([ceroActRow], t, av, mallaRawFixture, 'tada');
  const r = rows[0];
  assert.equal(r.COMPANY_FINAL_COST, 0);
  assert.equal(r.FINAL_COST, 0);
  console.log('OK: Modo TaDa — CERO_ACTIVIDAD también da $0 (bypass independiente del modo activo)');
}

console.log('\n✓ TODOS LOS CHECKS DE CERO_ACTIVIDAD (0 actividad TADA → $0 automático) PASARON');
