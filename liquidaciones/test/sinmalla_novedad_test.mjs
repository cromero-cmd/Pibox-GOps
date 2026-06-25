// Test ad-hoc — SIN_MALLA pasa a Novedades en vez de excluirse automáticamente.
// Tres escenarios: (1) booking manual confirmado → liquidado con valores
// reales de TADA, (2) excluido explícitamente, (3) sin tocar → excluido
// automáticamente. Verifica además que buildExclusiones() no cuenta doble
// (bug encontrado al implementar este cambio: el bucket SIN_MALLA original
// no filtraba por estado de resolución, a diferencia del bucket SIN_TADA).
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const fakeEl = {
  innerHTML:'', textContent:'', style:{},
  classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  querySelector(){return null;}, querySelectorAll(){return [];},
};
global.document = { getElementById: () => fakeEl };
global.fetch = () => Promise.reject(new Error('sin red en este test'));
global.XLSX = { utils:{}, writeFile(){} };

const conciliacion = await import('../js/conciliacion.js');
const distribucion  = await import('../js/distribucion.js');
const parser        = await import('../js/parser.js');
const novMod         = await import('../js/novedades.js');
const trumpMod       = await import('../js/trump.js');

function setConc(rows){ conciliacion.concResult.length = 0; conciliacion.concResult.push(...rows); }
function setMalla(rows){ parser.mallaRaw.length = 0; parser.mallaRaw.push(...rows); }

setMalla([{ 'BOOKING SERVICIO':'BK-EXISTENTE', 'NOMBRE':'Otro Piloto', 'FECHA':'2026-06-19', 'SELLER':'BOG-X', 'ID PILOTO':'D-999', 'INICIO DE TURNO':'08:00' }]);

// 3 pilotos SIN_MALLA — actividad real en TADA, sin ningún match en la malla.
setConc([
  { piloto:'Piloto Confirmado', ciudad:'BOG', seller:'BOG-X', dia:'viernes', fecha:'2026-06-19',
    paquetes:10, incentivos:2, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'SIN_MALLA', matches:[], nota:'', driver_id:'PENDIENTE' },
  { piloto:'Piloto Excluido', ciudad:'BOG', seller:'BOG-X', dia:'viernes', fecha:'2026-06-19',
    paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'SIN_MALLA', matches:[], nota:'', driver_id:'PENDIENTE' },
  { piloto:'Piloto Pendiente', ciudad:'BOG', seller:'BOG-X', dia:'viernes', fecha:'2026-06-19',
    paquetes:3, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'SIN_MALLA', matches:[], nota:'', driver_id:'PENDIENTE' },
]);

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
const sinMallaNovs = novMod.novedades.filter(n=>n.tipo==='SIN_MALLA');
assert.equal(sinMallaNovs.length, 3, 'los 3 SIN_MALLA deben aparecer como novedades');
console.log('OK: SIN_MALLA aparece en Novedades (TIPOS_NOVEDAD ya lo incluía)');

const iConfirmado = novMod.novedades.findIndex(n=>n.piloto==='Piloto Confirmado');
const iExcluido   = novMod.novedades.findIndex(n=>n.piloto==='Piloto Excluido');
const iPendiente  = novMod.novedades.findIndex(n=>n.piloto==='Piloto Pendiente');

// confirmarOk() sin booking_id debe rechazar
novMod.confirmarOk(iConfirmado);
assert.equal(novMod.resoluciones[novMod.novedades[iConfirmado].clave], undefined,
  'no debe confirmar sin booking_id ingresado');
console.log('OK: confirmarOk() rechaza SIN_MALLA sin Booking ID');

// Ingresar booking + driver manual y confirmar
novMod.novedades[iConfirmado]._booking_manual = 'BK-MANUAL-001';
novMod.novedades[iConfirmado]._driver_manual  = 'D-MANUAL-001';
novMod.confirmarOk(iConfirmado);
assert.deepEqual(novMod.resoluciones[novMod.novedades[iConfirmado].clave],
  {accion:'ok', booking_id:'BK-MANUAL-001', driver_id:'D-MANUAL-001'});
console.log('OK: confirmarOk() guarda booking_id + driver_id manual');

// Driver ID vacío no debe causar error (criterio explícito del brief)
novMod.novedades[iExcluido]._booking_manual = ''; // sin booking -> se excluye en vez
novMod.confirmarExcluir(iExcluido);
assert.equal(novMod.resoluciones[novMod.novedades[iExcluido].clave].accion, 'excluir');
console.log('OK: confirmarExcluir() funciona igual para SIN_MALLA');

// Piloto Pendiente: no se toca

novMod.aplicarResoluciones();
await new Promise(r=>setTimeout(r, 200));

const rConfirmado = conciliacion.concResult.find(r=>r.piloto==='Piloto Confirmado');
assert.equal(rConfirmado.nivel_confianza, 'MANUAL-OK');
assert.equal(rConfirmado.matches[0]['BOOKING SERVICIO'], 'BK-MANUAL-001');
assert.equal(rConfirmado.matches[0]['ID PILOTO'], 'D-MANUAL-001');
console.log('OK: aplicarResoluciones() marca MANUAL-OK con el booking/driver manual (fakeMatch — no existe en la malla)');

// runDistribucionSilent ya corrió dentro de aplicarResoluciones (via setTimeout) —
// volver a ejecutarla explícitamente para tener distResult fresco y determinista en el test.
distribucion.runDistribucionSilent();
const dConfirmado = distribucion.distResult.find(r=>r.piloto==='Piloto Confirmado');
assert.ok(dConfirmado, 'debe generarse un distResult para el confirmado');
assert.equal(dConfirmado.booking_id, 'BK-MANUAL-001');
assert.equal(dConfirmado.paquetes_dist, 10, 'debe usar los paquetes REALES de TADA, no 0');
assert.equal(dConfirmado.incentivos_dist, 2);
console.log('OK: distResult usa los valores reales de TADA (10 paquetes, 2 incentivos) — no $0');

const av = { version:'v1' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};
const { rows } = trumpMod.buildTrumpRows(distribucion.distResult, t, av, parser.mallaRaw);
const trumpRowConfirmado = rows.find(r=>r.BOOKING_ID==='BK-MANUAL-001');
assert.ok(trumpRowConfirmado, 'debe generarse una fila de Trump para el booking manual');
assert.ok(trumpRowConfirmado.FINAL_COST > 0, 'FINAL_COST debe ser real, no $0 — liquidacion normal');
assert.equal(trumpRowConfirmado.PACKAGES_COUNT, 10);
console.log('OK: buildTrumpRows() calcula FINAL_COST real (no $0) para el SIN_MALLA confirmado:', trumpRowConfirmado.FINAL_COST);

// El excluido y el pendiente NO deben aparecer en distResult/trumpRows
assert.ok(!distribucion.distResult.find(r=>r.piloto==='Piloto Excluido'));
assert.ok(!distribucion.distResult.find(r=>r.piloto==='Piloto Pendiente'));
console.log('OK: el excluido y el pendiente no llegan a distResult/template');

// buildExclusiones() no debe contar doble — cada piloto SIN_MALLA en exactamente 1 categoria
const excl = trumpMod.buildExclusiones();
const porPiloto = {};
excl.forEach(e=>{ porPiloto[e.piloto] = (porPiloto[e.piloto]||0)+1; });
assert.equal(porPiloto['Piloto Excluido'], 1, 'el excluido debe aparecer exactamente 1 vez en el reporte');
assert.equal(porPiloto['Piloto Pendiente'], 1, 'el pendiente debe aparecer exactamente 1 vez en el reporte');
assert.equal(porPiloto['Piloto Confirmado'], undefined, 'el confirmado (MANUAL-OK) no debe aparecer como excluido');
const razonExcluido = excl.find(e=>e.piloto==='Piloto Excluido').razon;
const razonPendiente = excl.find(e=>e.piloto==='Piloto Pendiente').razon;
assert.equal(razonExcluido, 'EXCLUIDO_MANUAL');
assert.equal(razonPendiente, 'PENDIENTE');
console.log('OK: buildExclusiones() no cuenta doble los SIN_MALLA (bug encontrado y corregido)');

console.log('\n✓ TODOS LOS CHECKS DE SIN_MALLA → NOVEDADES PASARON');
