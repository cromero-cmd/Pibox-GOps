// Test ad-hoc — mismo fix aplicado a cobro_garantizado/pago_garantizado,
// ahora para cobro_bono/pago_bono: historial.js debe leer r._cobro_bono y
// r._pago_bono de buildTrumpRows(), sin recalcular. Antes de este fix:
//   1. historial.js leía "r.bonos" de un trumpRow — campo que NUNCA existió
//      en el objeto que retorna buildTrumpRows() (solo existe como variable
//      local dentro de la función) → bono siempre era 0, sin importar el
//      bono real del piloto.
//   2. Aun si hubiera leído el bono real, el gross-up estaba hardcodeado a
//      3%/15% nacional, ignorando Cali (7%/10% o el % configurado).
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

const tariffs   = await import('../js/tariffs.js');
const trumpMod  = await import('../js/trump.js');
const auth      = await import('../js/auth.js');
const historial = await import('../js/historial.js');

tariffs.initTariffs();
auth.setCurrentUser({ username:'cromero', nombre:'Camilo Romero', role:'superadmin' });

const HEADERS = [
  'run_id','periodo','id_piloto','piloto','ciudad','seller','fecha','dia',
  'booking_id','paquetes','incentivos','cancelados','tareas',
  'cobro_paquete','cobro_incentivo','cobro_cancelado','cobro_tarea',
  'cobro_garantizado','cobro_bono','cobro_total',
  'pago_paquete','pago_incentivo','pago_cancelado','pago_tarea',
  'pago_garantizado','pago_bono','pago_piloto',
  'guardado_por','fecha_guardado',
];
const idx = {}; HEADERS.forEach((h,i)=>idx[h]=i);

const av = tariffs.getAV();
const t  = tariffs.getCurrentEdits();
const mallaRawFixture = [{ FECHA:'2026-06-15' }]; // lunes → L-J

async function guardarYObtenerFila(){
  let fetchCalls = [];
  global.fetch = (url, opts) => { fetchCalls.push({url, opts}); return Promise.resolve({ json: async () => ({ ok:true }) }); };
  fakeEl('hist-url').value = 'https://script.google.com/macros/s/FAKE/exec';
  await historial.ejecutarGuardarHistorial();
  const postCall = fetchCalls.find(c=>c.opts?.method==='POST');
  const enviado = JSON.parse(decodeURIComponent(postCall.opts.body.replace(/^payload=/, '')));
  return enviado.registros[0];
}

// ══════════════════════════════════════════════════════
// CASO 1 — bono nacional (BOG): cobro_bono = round(bono/(1-0.03)/(1-0.15))
// ══════════════════════════════════════════════════════
{
  const distResult = [{
    booking_id:'BK-BONO-NAC', driver_id:'D-1', piloto:'Piloto Bono', ciudad:'BOG', seller:'BOG-X',
    fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:20, incentivos_dist:0, cancelados_dist:0, tareas_dist:0, // por encima del mínimo, sin garantizado
    garantizado_tada:null, bonos:66000, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  }];
  const { rows } = trumpMod.buildTrumpRows(distResult, t, av, mallaRawFixture, 'automatico');
  const r = rows[0];

  const pctMarg = (t.pct_margen ?? 3)/100, pctPlat = (t.pct_plataforma ?? 15)/100;
  const cobroBonoEsperado = Math.round(66000 / (1-pctMarg) / (1-pctPlat));

  assert.equal(r._pago_bono, 66000, 'pago_bono debe ser el valor neto exacto del bono');
  assert.equal(r._cobro_bono, cobroBonoEsperado, 'cobro_bono = round(bono / (1-pctMarg) / (1-pctPlat)) nacional');
  console.log('OK: buildTrumpRows() exporta _cobro_bono/_pago_bono correctos (nacional)');

  trumpMod.trumpRows.length = 0;
  trumpMod.trumpRows.push(r);
  const fila = await guardarYObtenerFila();
  assert.equal(fila[idx.cobro_bono], cobroBonoEsperado, 'cobro_bono en el Sheet debe venir de buildTrumpRows(), no recalculado');
  assert.equal(fila[idx.pago_bono], 66000, 'pago_bono en el Sheet debe venir de buildTrumpRows(), no recalculado (antes SIEMPRE era 0 — r.bonos no existía en el trumpRow)');
  console.log('OK: cobro_bono/pago_bono llegan intactos a ejecutarGuardarHistorial() (nacional)');
}

// ══════════════════════════════════════════════════════
// CASO 2 — bono en Cali: gross-up con % de Cali configurados en tarifas
// ══════════════════════════════════════════════════════
{
  const distResult = [{
    booking_id:'BK-BONO-CAL', driver_id:'D-2', piloto:'Piloto Bono Cali', ciudad:'CAL', seller:'CAL-X',
    fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:20, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
    garantizado_tada:null, bonos:66000, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  }];
  const { rows } = trumpMod.buildTrumpRows(distResult, t, av, mallaRawFixture, 'automatico');
  const r = rows[0];

  const pctMargCal = (t.pct_margen_cal ?? 7)/100, pctPlatCal = (t.pct_plataforma_cal ?? 10)/100;
  const cobroBonoEsperado = Math.round(66000 / (1-pctMargCal) / (1-pctPlatCal));

  assert.equal(r._cobro_bono, cobroBonoEsperado, 'cobro_bono en Cali debe usar % de Cali configurados, no el hardcode nacional 3%/15%');
  assert.notEqual(r._cobro_bono, Math.round(66000/(1-0.03)/(1-0.15)), 'debe diferir del cálculo nacional hardcodeado');
  console.log('OK: buildTrumpRows() usa % de Cali para _cobro_bono (antes historial.js siempre usaba 3%/15% nacional)');

  trumpMod.trumpRows.length = 0;
  trumpMod.trumpRows.push(r);
  const fila = await guardarYObtenerFila();
  assert.equal(fila[idx.cobro_bono], cobroBonoEsperado, 'cobro_bono en el Sheet (Cali) debe reflejar el % de Cali');
  console.log('OK: cobro_bono llega intacto a ejecutarGuardarHistorial() (Cali)');
}

// ══════════════════════════════════════════════════════
// CASO 3 — sin bono: ambos en 0
// ══════════════════════════════════════════════════════
{
  const distResult = [{
    booking_id:'BK-SIN-BONO', driver_id:'D-3', piloto:'Piloto Sin Bono', ciudad:'BOG', seller:'BOG-X',
    fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:20, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
    garantizado_tada:null, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  }];
  const { rows } = trumpMod.buildTrumpRows(distResult, t, av, mallaRawFixture, 'automatico');
  const r = rows[0];
  assert.equal(r._cobro_bono, 0);
  assert.equal(r._pago_bono, 0);
  console.log('OK: sin bono, _cobro_bono/_pago_bono quedan en 0 (sin regresión)');
}

console.log('\n✓ TODOS LOS CHECKS DE cobro_bono/pago_bono (buildTrumpRows → historial) PASARON');
