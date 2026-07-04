// Test ad-hoc — verifica que cobro_garantizado/pago_garantizado se calculan
// correctamente según el modo activo (automático vs TaDa) en buildTrumpRows(),
// y que esos valores llegan SIN RECALCULAR hasta ejecutarGuardarHistorial()
// y terminan en las columnas correctas del Sheet (cobro_garantizado,
// pago_garantizado). Antes de este fix, historial.js reimplementaba su propia
// fórmula (ignorando Modo TaDa por completo y usando llaves de tarifa que no
// existen: c_garantizado_vd/lj en vez de c_gar_vd/lj) en lugar de leer los
// campos que buildTrumpRows() ya resuelve correctamente por fila.
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
const parserMod = await import('../js/parser.js');

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
// CASO 1 — Modo automático: piloto bajo el mínimo L-J nacional
// ══════════════════════════════════════════════════════
{
  const distResult = [{
    booking_id:'BK-AUTO', driver_id:'D-1', piloto:'Piloto Auto', ciudad:'BOG', seller:'BOG-X',
    fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:2, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
    garantizado_tada:null, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  }];
  const { rows } = trumpMod.buildTrumpRows(distResult, t, av, mallaRawFixture, 'automatico');
  const r = rows[0];

  const cobroOp = 2 * (t.c_paquete ?? 8870); // 17740
  const cGarLJ  = t.c_gar_lj ?? 85050;
  const pMinLJ  = t.p_min_lj ?? 70000;
  const pagoOp  = 2 * (t.p_paquete ?? 7300); // 14600

  const cobroGarEsperado = Math.max(0, cGarLJ - cobroOp);
  const pagoGarEsperado  = Math.max(0, pMinLJ - pagoOp);

  assert.equal(r._cobro_garantizado, cobroGarEsperado, 'cobro_garantizado (auto) = MAX(0, tarifa_garantizado - cobro_operativo)');
  assert.equal(r._complemento, pagoGarEsperado, 'pago_garantizado (auto) = MAX(0, minimo_piloto - pago_operativo)');
  // La suma cobro_operativo + cobro_garantizado debe seguir dando el mismo
  // COMPANY_FINAL_COST que antes del fix (MAX, no una nueva cifra):
  assert.equal(r.COMPANY_FINAL_COST, cobroOp + cobroGarEsperado);
  assert.equal(r.COMPANY_FINAL_COST, Math.max(cobroOp, cGarLJ), 'COMPANY_FINAL_COST sigue siendo MAX(cobro_operativo, tarifa_garantizado)');
  console.log('OK: Modo automático — cobro_garantizado/pago_garantizado calculados como delta (MAX con 0), COMPANY_FINAL_COST sin cambios');

  // ── Propagación end-to-end hasta ejecutarGuardarHistorial() ──
  trumpMod.trumpRows.length = 0;
  trumpMod.trumpRows.push(r);
  const fila = await guardarYObtenerFila();
  assert.equal(fila[idx.cobro_garantizado], cobroGarEsperado, 'cobro_garantizado en el Sheet debe ser el valor de buildTrumpRows(), no recalculado');
  assert.equal(fila[idx.pago_garantizado], pagoGarEsperado, 'pago_garantizado en el Sheet debe ser el valor de buildTrumpRows(), no recalculado');
  console.log('OK: Modo automático — cobro_garantizado/pago_garantizado llegan intactos a ejecutarGuardarHistorial()');
}

// ══════════════════════════════════════════════════════
// CASO 2 — Modo TaDa: garantizado_tada real (columna "Garantizado Basico")
// ══════════════════════════════════════════════════════
{
  const distResult = [{
    booking_id:'BK-TADA', driver_id:'D-2', piloto:'Piloto TaDa', ciudad:'BOG', seller:'BOG-X',
    fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:6, incentivos_dist:6, cancelados_dist:0, tareas_dist:0,
    garantizado_tada:48400, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  }];
  const { rows } = trumpMod.buildTrumpRows(distResult, t, av, mallaRawFixture, 'tada');
  const r = rows[0];

  const pctMarg = (t.pct_margen ?? 3)/100, pctPlat = (t.pct_plataforma ?? 15)/100;
  const cobroGarEsperado = Math.ceil(48400 / (1-pctMarg) / (1-pctPlat));

  assert.equal(r._cobro_garantizado, cobroGarEsperado, 'cobro_garantizado (TaDa) = ceil(garantizado_tada / (1-pctMarg) / (1-pctPlat))');
  assert.equal(r._complemento, 48400, 'pago_garantizado (TaDa) = garantizado_tada exacto (valor neto de TaDa)');
  console.log('OK: Modo TaDa — cobro_garantizado/pago_garantizado calculados según la fórmula de gross-up');

  // ── Propagación end-to-end hasta ejecutarGuardarHistorial() ──
  trumpMod.trumpRows.length = 0;
  trumpMod.trumpRows.push(r);
  const fila = await guardarYObtenerFila();
  assert.equal(fila[idx.cobro_garantizado], cobroGarEsperado, 'cobro_garantizado en el Sheet (Modo TaDa) debe ser el gross-up exacto, no el cálculo automático');
  assert.equal(fila[idx.pago_garantizado], 48400, 'pago_garantizado en el Sheet (Modo TaDa) debe ser el valor neto exacto de TaDa');
  console.log('OK: Modo TaDa — cobro_garantizado/pago_garantizado llegan intactos a ejecutarGuardarHistorial() (antes se perdían: siempre caía al cálculo automático)');
}

console.log('\n✓ TODOS LOS CHECKS DE cobro_garantizado/pago_garantizado (buildTrumpRows → historial) PASARON');
