// Test ad-hoc — feature: doble turno. Un piloto con 2 filas en la malla la
// misma fecha (una con booking ID válido, otra con texto libre como "DOBLE
// TURNO") y 2 filas en TADA (una por turno, posiblemente en sellers
// distintos) debe combinarse en UN SOLO registro con los valores TADA
// sumados, usando el booking válido — sin pasar por Novedades ni generar
// un registro separado para la fila sin booking real.
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
// PARTE A — esBookingValido()
// ══════════════════════════════════════════════════════
assert.equal(conciliacion.esBookingValido('a1b2c3d4e5f6a1b2c3d4e5f6'), true, '24 hex minúsculas es válido');
assert.equal(conciliacion.esBookingValido('A1B2C3D4E5F6A1B2C3D4E5F6'), true, '24 hex mayúsculas también es válido (case-insensitive)');
assert.equal(conciliacion.esBookingValido('DOBLE TURNO'), false);
assert.equal(conciliacion.esBookingValido('doble turno'), false);
assert.equal(conciliacion.esBookingValido('turno doble'), false);
assert.equal(conciliacion.esBookingValido('-'), false);
assert.equal(conciliacion.esBookingValido(''), false);
assert.equal(conciliacion.esBookingValido(null), false);
assert.equal(conciliacion.esBookingValido(undefined), false);
assert.equal(conciliacion.esBookingValido('a1b2c3d4e5f6a1b2c3d4e5f'), false, '23 caracteres — muy corto');
assert.equal(conciliacion.esBookingValido('a1b2c3d4e5f6a1b2c3d4e5f6a'), false, '25 caracteres — muy largo');
console.log('OK: esBookingValido() clasifica correctamente 24-hex vs texto libre/vacío/longitud incorrecta');

// ══════════════════════════════════════════════════════
// PARTE B — runConciliacion(): detección y combinación de doble turno
// ══════════════════════════════════════════════════════
const BOOKING_VALIDO = 'a1b2c3d4e5f6a1b2c3d4e5f6';
parser.mallaRaw.length = 0;
parser.mallaRaw.push(
  { 'NOMBRE':'Juan Perez', 'FECHA':'2026-06-15', 'SELLER':'BOG-X', 'BOOKING SERVICIO':BOOKING_VALIDO, 'ID PILOTO':'D-600', 'INICIO DE TURNO':'08:00', 'CIUDAD':'BOG' },
  { 'NOMBRE':'Juan Perez', 'FECHA':'2026-06-15', 'SELLER':'BOG-Y', 'BOOKING SERVICIO':'DOBLE TURNO', 'ID PILOTO':'D-600', 'INICIO DE TURNO':'16:00', 'CIUDAD':'BOG' },
);
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push(
  { piloto:'Juan Perez', ciudad:'BOG', seller:'BOG-X', dia:'lunes', fecha:'2026-06-15', paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null },
  { piloto:'Juan Perez', ciudad:'BOG', seller:'BOG-Y', dia:'lunes', fecha:'2026-06-15', paquetes:3, incentivos:0, cancelados:1, tareas:0, garantizado:0, bonos:2000, ajustes:0, garantizado_tada:null },
);

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const entradasJuan = conciliacion.concResult.filter(r=>r.piloto==='Juan Perez');
assert.equal(entradasJuan.length, 1, 'debe generar UN SOLO registro para el piloto (no dos, no un SIN_TADA extra)');
const dt = entradasJuan[0];
assert.equal(dt.nivel_confianza, 'HIGH');
assert.equal(dt.matches[0]['BOOKING SERVICIO'], BOOKING_VALIDO, 'debe usar el booking ID válido');
assert.equal(dt.paquetes, 8, 'paquetes = suma de ambos turnos (5+3)');
assert.equal(dt.incentivos, 1);
assert.equal(dt.cancelados, 1);
assert.equal(dt.bonos, 2000);
assert.equal(dt.seller, 'BOG-X + BOG-Y', 'seller combinado con " + "');
assert.ok(dt.nota.includes('[DOBLE-TURNO]'), 'nota debe incluir [DOBLE-TURNO]');
assert.equal(dt._doble_turno, true);
assert.equal(dt._seller_combinado, 'BOG-X + BOG-Y');
assert.ok(!conciliacion.concResult.find(r=>r.nivel_confianza==='SIN_TADA'&&r.piloto==='Juan Perez'), 'la fila sin booking válido no debe generar un SIN_TADA separado');
console.log('OK: runConciliacion() combina doble turno en un solo registro HIGH con valores sumados y seller combinado');

// ══════════════════════════════════════════════════════
// PARTE C — distribucion.js: el registro combinado llega a distResult
// ══════════════════════════════════════════════════════
distribucion.runDistribucionSilent();
const distJuan = distribucion.distResult.filter(r=>r.piloto==='Juan Perez');
assert.equal(distJuan.length, 1, 'un solo booking en distResult (n_bookings=1, no se reparte)');
const dj = distJuan[0];
assert.equal(dj.booking_id, BOOKING_VALIDO);
assert.equal(dj.paquetes_dist, 8);
assert.equal(dj.incentivos_dist, 1);
assert.equal(dj.cancelados_dist, 1);
assert.equal(dj.bonos, 2000);
assert.equal(dj._doble_turno, true);
assert.equal(dj._seller_combinado, 'BOG-X + BOG-Y');
console.log('OK: distribucion.js propaga el registro combinado con booking_id válido y valores sumados');

// ══════════════════════════════════════════════════════
// PARTE D — trump.js: COMMENTS incluye el seller combinado
// ══════════════════════════════════════════════════════
const av = { version:'v1' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};
const mallaRawFixture = [{ FECHA:'2026-06-15' }];
const { rows } = trumpMod.buildTrumpRows([dj], t, av, mallaRawFixture, 'automatico');
const rTrump = rows[0];
assert.ok(rTrump.COMMENTS.includes('| DOBLE-TURNO: BOG-X + BOG-Y'), 'COMMENTS debe incluir el detalle del doble turno');
assert.equal(rTrump.BOOKING_ID, BOOKING_VALIDO);
assert.equal(rTrump._paquetes, 8);
assert.equal(rTrump._doble_turno, true);
console.log('OK: buildTrumpRows() incluye "DOBLE-TURNO: seller_A + seller_B" en COMMENTS');

// ══════════════════════════════════════════════════════
// PARTE E — regresión: piloto normal (un solo turno) sin cambios
// ══════════════════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
parser.mallaRaw.length = 0;
parser.mallaRaw.push(
  { 'NOMBRE':'Maria Lopez', 'FECHA':'2026-06-17', 'SELLER':'BOG-Z', 'BOOKING SERVICIO':'b2c3d4e5f6a1b2c3d4e5f6a1', 'ID PILOTO':'D-601', 'INICIO DE TURNO':'08:00', 'CIUDAD':'BOG' },
);
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push(
  { piloto:'Maria Lopez', ciudad:'BOG', seller:'BOG-Z', dia:'miercoles', fecha:'2026-06-17', paquetes:10, incentivos:2, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null },
);
await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });
const maria = conciliacion.concResult.find(r=>r.piloto==='Maria Lopez');
assert.ok(maria, 'piloto normal sigue matcheando');
assert.equal(maria.nivel_confianza, 'HIGH');
assert.equal(maria.paquetes, 10, 'sin doble turno, valores normales sin sumar nada extra');
assert.ok(!maria._doble_turno, 'piloto de un solo turno no debe marcarse como doble turno');
console.log('OK: piloto normal (un solo turno) sin cambios de comportamiento');

// ══════════════════════════════════════════════════════
// PARTE F — 2 booking IDs válidos en el mismo piloto+fecha → NO es doble
// turno (son bookings genuinamente distintos), cada uno se resuelve normal
// ══════════════════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
parser.mallaRaw.length = 0;
parser.mallaRaw.push(
  { 'NOMBRE':'Ana Torres', 'FECHA':'2026-06-18', 'SELLER':'BOG-A', 'BOOKING SERVICIO':'111111111111111111111111', 'ID PILOTO':'D-700', 'INICIO DE TURNO':'08:00', 'CIUDAD':'BOG' },
  { 'NOMBRE':'Ana Torres', 'FECHA':'2026-06-18', 'SELLER':'BOG-B', 'BOOKING SERVICIO':'222222222222222222222222', 'ID PILOTO':'D-700', 'INICIO DE TURNO':'16:00', 'CIUDAD':'BOG' },
);
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push(
  { piloto:'Ana Torres', ciudad:'BOG', seller:'BOG-A', dia:'jueves', fecha:'2026-06-18', paquetes:5, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null },
  { piloto:'Ana Torres', ciudad:'BOG', seller:'BOG-B', dia:'jueves', fecha:'2026-06-18', paquetes:3, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null },
);
await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });
const anaEntradas = conciliacion.concResult.filter(r=>r.piloto==='Ana Torres');
assert.equal(anaEntradas.length, 2, 'dos bookings válidos genuinamente distintos → dos registros, no se combinan');
assert.ok(anaEntradas.every(r=>!r._doble_turno), 'ninguno debe marcarse como doble turno');
assert.deepEqual(anaEntradas.map(r=>r.paquetes).sort(), [3,5], 'cada uno conserva su propio valor, sin sumar');
console.log('OK: 2 booking IDs válidos en la misma fecha NO se tratan como doble turno (bookings genuinamente distintos)');

console.log('\n✓ TODOS LOS CHECKS DE DOBLE TURNO PASARON');
