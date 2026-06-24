// Test ad-hoc: "Incluir en $0" — un registro SIN_TADA (booking real en la
// malla, sin actividad en TADA) marcado en Novedades con accion:'cero' debe
// aparecer en trumpRows con todos los campos financieros en 0 y el booking
// ID real, y NO debe contarse como excluido en buildExclusiones().
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const fakeEl = { innerHTML:'', style:{}, querySelector(){return null;}, querySelectorAll(){return [];} };
global.document = { getElementById: () => fakeEl };
global.fetch = () => Promise.reject(new Error('sin red en este test'));
global.XLSX = { utils:{}, writeFile(){} };

const conciliacion = await import('../js/conciliacion.js');
const distribucion  = await import('../js/distribucion.js');
const parser        = await import('../js/parser.js');
const novMod         = await import('../js/novedades.js');
const trumpMod       = await import('../js/trump.js');

function setConc(rows){ conciliacion.concResult.length = 0; conciliacion.concResult.push(...rows); }
function setDist(rows){ distribucion.distResult.length = 0; distribucion.distResult.push(...rows); }
function setMalla(rows){ parser.mallaRaw.length = 0; parser.mallaRaw.push(...rows); }

// Un booking real en la malla (BOOKING SERVICIO: BK-999) sin actividad TADA.
setMalla([{ 'BOOKING SERVICIO':'BK-999', 'NOMBRE':'Pedro Gomez', 'FECHA':'2026-06-10', 'SELLER':'X', 'ID PILOTO':'D-777', 'INICIO DE TURNO':'08:00' }]);

setConc([
  { piloto:'Pedro Gomez', ciudad:'BOG', seller:'X', fecha:'2026-06-10',
    nivel_confianza:'SIN_TADA', matches:[{ 'BOOKING SERVICIO':'BK-999', 'NOMBRE':'Pedro Gomez' }],
    nota:'Booking en malla sin actividad reportada en TADA · booking: BK-999',
    driver_id:'D-777', _booking_malla:'BK-999' },
]);
setDist([]); // no hay distribución normal para este booking — es el caso de uso del brief

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
assert.equal(novMod.novedades.length, 1);
assert.equal(novMod.novedades[0].tipo, 'SIN_TADA');

// Confirmar "Incluir en $0" para esta novedad
novMod.confirmarCero(0);
assert.equal(novMod.resoluciones[novMod.novedades[0].clave]?.accion, 'cero');
assert.equal(novMod.resoluciones[novMod.novedades[0].clave]?.booking_id, 'BK-999');
console.log('OK: confirmarCero() guarda accion:cero con el booking real de la malla');

// buildCeroRows() debe generar la fila exacta especificada
const ceroRows = trumpMod.buildCeroRows(novMod.novedades, novMod.resoluciones);
assert.equal(ceroRows.length, 1);
const r = ceroRows[0];
assert.equal(r.BOOKING_ID, 'BK-999');
assert.equal(r.COMPANY_FINAL_COST, 0);
assert.equal(r.ADDITIONAL_COMPANY_FINAL_COST, 0);
assert.equal(r.FINAL_COST, 0);
assert.equal(r.ADDITIONAL_FINAL_COST, 0);
assert.equal(r.PACKAGES_COUNT, 0);
assert.equal(r.IS_PER_HOUR, 0);
assert.equal(r.COMMENTS, 'Anulacion $0');
assert.equal(r.COMMENTS_PILOTO, 'Anulacion $0');
assert.equal(r._confianza, 'CERO');
assert.equal(r._piloto, 'Pedro Gomez');
console.log('OK: buildCeroRows() genera la fila con la estructura exacta del brief');

// Simular aplicarResoluciones() marcando el flag _resolucion_cero en concResult,
// que es lo que evita que buildExclusiones() lo cuente como SIN_TADA excluido.
conciliacion.concResult[0]._resolucion_cero = true;

const excl = trumpMod.buildExclusiones();
const sinTadaExcl = excl.filter(e=>e.razon==='SIN_TADA');
const anuladoCero = excl.filter(e=>e.razon==='ANULADO_CERO');
assert.equal(sinTadaExcl.length, 0, 'el registro en $0 no debe contarse como SIN_TADA excluido');
assert.equal(anuladoCero.length, 1, 'debe aparecer en su propia categoria ANULADO_CERO');
assert.equal(anuladoCero[0].booking_id, 'BK-999');
console.log('OK: buildExclusiones() no cuenta el registro en $0 como excluido — categoria propia ANULADO_CERO');

// El registro NO debe aparecer como NOVEDAD_PENDIENTE (ya está resuelto, aunque con accion:cero)
const pendientes = excl.filter(e=>e.razon==='NOVEDAD_PENDIENTE');
assert.equal(pendientes.length, 0, 'no debe quedar como pendiente');
console.log('OK: no se duplica como NOVEDAD_PENDIENTE');

console.log('\n✓ TODOS LOS CHECKS DE "INCLUIR EN $0" PASARON');
