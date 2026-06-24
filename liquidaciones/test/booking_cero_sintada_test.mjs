// Test ad-hoc — reproduce el reporte: el botón "Incluir en $0" no aparecía
// en tarjetas SIN_TADA con booking ID válido.
//
// Causa real: buildNovedades() nunca copiaba el campo _booking_malla
// (que conciliacion.js ya resuelve correctamente una sola vez para SIN_TADA)
// al objeto de la novedad. bookingDeNovedad() tenía que volver a derivar la
// columna de booking desde mallaRaw[0] con la misma heurística de regex en
// un segundo archivo — frágil ante cualquier cambio de mallaRaw entre el
// momento de la conciliación y el momento de abrir Novedades (por ejemplo,
// si el usuario reemplaza el archivo de malla sin volver a correr
// conciliación, removeFile('malla') deja mallaRaw=[]).
//
// Este test reproduce justo ese escenario para confirmar que, con el campo
// bookingMalla propagado desde concResult, el booking se sigue detectando
// aunque mallaRaw ya no tenga los datos originales.
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const fakeEl = { innerHTML:'', textContent:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}}, querySelector(){return null;}, querySelectorAll(){return [];} };
global.document = { getElementById: () => fakeEl };
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const parser       = await import('../js/parser.js');
const normalizer    = await import('../js/normalizer.js');
const conciliacion  = await import('../js/conciliacion.js');
const distribucion  = await import('../js/distribucion.js');
const novMod        = await import('../js/novedades.js');

// Malla real con un booking sin actividad TADA → huérfano → SIN_TADA
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Duvan Santiago Castro Alvarez', 'FECHA':'2026-06-10', 'SELLER':'BOG-X',
  'BOOKING SERVICIO':'6a332f729b932fde19685c99', 'ID PILOTO':'D-555', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0; // sin actividad TADA reportada

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const sinTada = conciliacion.concResult.find(r => r.nivel_confianza === 'SIN_TADA');
assert.ok(sinTada, 'debe existir un registro SIN_TADA');
assert.equal(sinTada._booking_malla, '6a332f729b932fde19685c99');

distribucion.distResult.length = 0; // SIN_TADA no participa en distribución

// Escenario del reporte: el usuario reemplaza/recarga el archivo de malla
// (p.ej. removeFile('malla') en parser.js) SIN volver a correr conciliación
// antes de abrir Novedades — mallaRaw queda vacío.
parser.mallaRaw.length = 0;

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
const novSinTada = novMod.novedades.find(n => n.tipo === 'SIN_TADA');
assert.ok(novSinTada, 'debe construirse la novedad SIN_TADA');
assert.equal(novSinTada.bookingMalla, '6a332f729b932fde19685c99',
  'bookingMalla debe propagarse desde concResult._booking_malla independientemente del estado de mallaRaw');

// confirmarCero() debe poder resolver el booking pese a que mallaRaw esté vacío
novMod.confirmarCero(novMod.novedades.indexOf(novSinTada));
assert.equal(novMod.resoluciones[novSinTada.clave]?.accion, 'cero');
assert.equal(novMod.resoluciones[novSinTada.clave]?.booking_id, '6a332f729b932fde19685c99');

console.log('OK: bookingMalla se propaga desde concResult y sobrevive a un mallaRaw vaciado/recargado');
console.log('OK: confirmarCero() resuelve el booking real (6a332f729b932fde19685c99) para SIN_TADA');
console.log('\n✓ TODOS LOS CHECKS DEL FIX DE bookingDeNovedad() PARA SIN_TADA PASARON');
