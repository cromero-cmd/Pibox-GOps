// Test ad-hoc — "Incluir en $0" disponible para TODOS los tipos de novedad
// que tengan un booking ID válido (antes solo aparecía para tipos distintos
// de SIN_TADA — esta corre el caso contrario: ahora también debe aparecer
// para SIN_TADA, y seguir oculto solo para SIN_MALLA/SIN_BOOKING, que no
// tienen booking por definición).
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', value:'', style:{}, disabled:false, className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];}, remove(){},
    insertBefore(){},
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id), createElement:()=>fakeEl('__tmp__'), body:{appendChild(){}} };

const parser  = await import('../js/parser.js');
const novMod  = await import('../js/novedades.js');

function setMalla(rows){ parser.mallaRaw.length = 0; parser.mallaRaw.push(...rows); }
// `export let resoluciones` es un binding vivo — no se puede reasignar desde
// fuera del módulo (novMod.resoluciones = {} lanza TypeError), hay que limpiar
// las claves del objeto existente en su lugar.
function clearRes(){ Object.keys(novMod.resoluciones).forEach(k=>delete novMod.resoluciones[k]); }

setMalla([
  { 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez',  'FECHA':'2026-06-10', 'SELLER':'X', 'ID PILOTO':'D-1', 'INICIO DE TURNO':'08:00' },
  { 'BOOKING SERVICIO':'BK-B', 'NOMBRE':'Pedro Gomez 2','FECHA':'2026-06-10', 'SELLER':'X', 'ID PILOTO':'D-2', 'INICIO DE TURNO':'09:00' },
]);

// ── AMBIGUOUS — debe mostrar el botón y, si hay un candidato seleccionado,
//    confirmarCero() debe usar el booking del CANDIDATO, no matches[0] ──
{
  novMod.novedades.length = 0;
  clearRes();
  const n = {
    tipo:'AMBIGUOUS', piloto:'Pedro Gomez', ciudad:'BOG', seller:'X', fecha:'2026-06-10',
    nota:'2 candidatos', matches:[
      { 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez' },
      { 'BOOKING SERVICIO':'BK-B', 'NOMBRE':'Pedro Gomez 2' },
    ],
    driver_id:'', clave:'pedro-gomez||2026-06-10||AMBIGUOUS',
  };
  novMod.novedades.push(n);

  let html = novMod.renderNovCard(n, 0);
  assert.ok(html.includes('btn-nov-cero'), 'AMBIGUOUS con matches debe mostrar el botón ⓪ Incluir en $0');
  console.log('OK: AMBIGUOUS muestra el botón ⓪ Incluir en $0 cuando hay matches (antes oculto solo para SIN_TADA, ahora universal)');

  // Sin selección aún → usa matches[0] (comportamiento previo, sin cambios)
  novMod.confirmarCero(0);
  assert.equal(novMod.resoluciones[n.clave].booking_id, 'BK-A', 'sin selección, debe usar matches[0] como antes');
  delete novMod.resoluciones[n.clave];

  // El usuario selecciona el SEGUNDO candidato (no el primero)
  novMod.seleccionarCandidato(0, 'BK-B', 'D-2', 'Pedro Gomez 2');
  novMod.confirmarCero(0);
  assert.equal(novMod.resoluciones[n.clave].accion, 'cero');
  assert.equal(novMod.resoluciones[n.clave].booking_id, 'BK-B', 'con un candidato seleccionado, debe anular ESE booking, no el primer match por defecto');
  console.log('OK: AMBIGUOUS con candidato seleccionado usa el booking del candidato seleccionado, no matches[0]');
}

// ── FUZZY-LOW / LOW — deben mostrar el botón usando matches[0] ──
for(const tipo of ['FUZZY-LOW','LOW']){
  novMod.novedades.length = 0;
  clearRes();
  const n = {
    tipo, piloto:'Pedro Gomez', ciudad:'BOG', seller:'X', fecha:'2026-06-10',
    nota:'', matches:[{ 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez' }],
    driver_id:'', clave:`pedro-gomez||2026-06-10||${tipo}`,
  };
  novMod.novedades.push(n);

  const html = novMod.renderNovCard(n, 0);
  assert.ok(html.includes('btn-nov-cero'), `${tipo} con matches debe mostrar el botón ⓪ Incluir en $0`);
  novMod.confirmarCero(0);
  assert.equal(novMod.resoluciones[n.clave].booking_id, 'BK-A');
  console.log(`OK: ${tipo} muestra el botón y confirmarCero() usa matches[0]`);
}

// ── SIN_TADA — ahora también debe mostrar el botón (antes estaba oculto explícitamente) ──
{
  novMod.novedades.length = 0;
  clearRes();
  const n = {
    tipo:'SIN_TADA', piloto:'Pedro Gomez', ciudad:'BOG', seller:'X', fecha:'2026-06-10',
    nota:'Booking en malla sin actividad reportada en TADA · booking: BK-A',
    matches:[{ 'BOOKING SERVICIO':'BK-A', 'NOMBRE':'Pedro Gomez' }],
    bookingMalla:'BK-A', candidatosTada:[], driver_id:'D-1',
    clave:'pedro-gomez||2026-06-10||SIN_TADA',
  };
  novMod.novedades.push(n);

  const html = novMod.renderNovCard(n, 0);
  assert.ok(html.includes('btn-nov-cero'), 'SIN_TADA con booking de malla debe mostrar el botón ⓪ Incluir en $0 (ya no se oculta)');
  novMod.confirmarCero(0);
  assert.equal(novMod.resoluciones[n.clave].accion, 'cero');
  assert.equal(novMod.resoluciones[n.clave].booking_id, 'BK-A');
  console.log('OK: SIN_TADA ahora también muestra y permite confirmar ⓪ Incluir en $0, con el mismo comportamiento de siempre (booking real, $0)');
}

// ── SIN_MALLA — sin booking por definición, el botón sigue sin aparecer ──
{
  novMod.novedades.length = 0;
  clearRes();
  const n = {
    tipo:'SIN_MALLA', piloto:'Pedro Gomez', ciudad:'BOG', seller:'X', fecha:'2026-06-10',
    nota:'', matches:[], driver_id:'',
    clave:'pedro-gomez||2026-06-10||SIN_MALLA',
  };
  novMod.novedades.push(n);

  const html = novMod.renderNovCard(n, 0);
  assert.ok(!html.includes('btn-nov-cero'), 'SIN_MALLA no tiene booking por definición — el botón no debe aparecer');
  console.log('OK: SIN_MALLA sigue sin mostrar el botón ⓪ Incluir en $0 (no tiene booking)');
}

console.log('\n✓ TODOS LOS CHECKS DE "INCLUIR EN $0" PARA TODOS LOS TIPOS PASARON');
