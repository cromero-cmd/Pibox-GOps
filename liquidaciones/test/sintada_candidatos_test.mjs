// Test ad-hoc — SIN_TADA con candidatos y resolución manual igual que AMBIGUOUS.
// Caso real del brief: "Adriana Gutiérrez Cruz" en la malla, "Catherinne
// Gutierrez" en TADA, misma fecha+seller — antes era SIN_TADA sin más
// opción que $0 o excluir; ahora debe mostrar el candidato de TADA y, al
// confirmarlo, liquidar con sus valores reales (no $0) y aprender la
// equivalencia en el diccionario.
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

const { loadDict } = await import('../js/diccionario.js');
const parser       = await import('../js/parser.js');
const normalizer   = await import('../js/normalizer.js');
const conciliacion  = await import('../js/conciliacion.js');
const distribucion  = await import('../js/distribucion.js');
const novMod        = await import('../js/novedades.js');

// ═══════════════════════════════════════════
// Escenario 1 — booking en malla con candidato real en TADA (nombre distinto)
// ═══════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Adriana Gutierrez Cruz', 'FECHA':'2026-06-15', 'SELLER':'BOG-TY-BOSA',
  'BOOKING SERVICIO':'BK-ADRIANA', 'ID PILOTO':'D-300', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({
  piloto:'Catherinne Gutierrez', ciudad:'BOG', seller:'BOG-TY-BOSA', dia:'lunes', fecha:'2026-06-15',
  paquetes:12, incentivos:3, cancelados:0, tareas:1, garantizado:0, bonos:5000, ajustes:0,
});

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const sinTada = conciliacion.concResult.find(r=>r.nivel_confianza==='SIN_TADA');
assert.ok(sinTada, 'debe existir un registro SIN_TADA');
assert.equal(sinTada._candidatosTada.length, 1, 'debe encontrar 1 candidato en TADA (misma fecha+seller, con actividad)');
assert.equal(sinTada._candidatosTada[0].piloto, 'Catherinne Gutierrez');
console.log('OK: SIN_TADA se enriquece con _candidatosTada por fecha+seller+actividad');

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
const nov = novMod.novedades.find(n=>n.tipo==='SIN_TADA');
assert.ok(nov, 'debe construirse la novedad SIN_TADA');
assert.equal(nov.candidatosTada.length, 1, 'candidatosTada debe propagarse a la novedad');
const idxNov = novMod.novedades.indexOf(nov);

// Confirmar sin seleccionar candidato ni nombre manual → debe rechazar
novMod.confirmarOk(idxNov);
assert.ok(!novMod.resoluciones[nov.clave], 'no debe poder confirmar sin seleccionar un candidato (hay candidatos disponibles)');
console.log('OK: confirmarOk() rechaza SIN_TADA con candidatos sin selección/nombre manual');

// Seleccionar el candidato y confirmar
novMod.seleccionarCandidatoTada(idxNov, 'Catherinne Gutierrez');
novMod.confirmarOk(idxNov);
const res = novMod.resoluciones[nov.clave];
assert.equal(res.accion, 'ok');
assert.equal(res.booking_id, 'BK-ADRIANA', 'el booking ya es el de la malla — no se vuelve a preguntar');
assert.equal(res.nombre_tada, 'Catherinne Gutierrez');
console.log('OK: confirmarOk() guarda accion:ok con booking de malla + nombre_tada seleccionado');

// El diccionario debe aprender malla→tada automáticamente
const dict = loadDict();
assert.equal(dict.length, 1);
assert.equal(dict[0].tadaNombre, 'Catherinne Gutierrez');
assert.equal(dict[0].mallaNombre, 'Adriana Gutierrez Cruz');
assert.equal(dict[0].fuente, 'auto-sintada');
console.log('OK: la equivalencia se guarda automáticamente en el diccionario al confirmar');

// aplicarResoluciones() debe copiar los valores reales de TADA al registro de malla
novMod.aplicarResoluciones();
await new Promise(r=>setTimeout(r, 150));

const sinTadaResuelto = conciliacion.concResult.find(r=>r.piloto==='Adriana Gutierrez Cruz');
assert.equal(sinTadaResuelto.nivel_confianza, 'MANUAL-OK');
assert.equal(sinTadaResuelto.paquetes, 12, 'debe copiar paquetes reales de TADA, no quedarse en 0');
assert.equal(sinTadaResuelto.incentivos, 3);
assert.equal(sinTadaResuelto.bonos, 5000);
console.log('OK: aplicarResoluciones() copia los valores reales de TADA (no $0, no garantizado mínimo)');

// ═══════════════════════════════════════════
// Escenario 2 — booking sin ningún candidato en TADA (otra fecha/seller, o sin actividad)
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Piloto Fantasma', 'FECHA':'2026-06-16', 'SELLER':'BOG-X',
  'BOOKING SERVICIO':'BK-FANTASMA', 'ID PILOTO':'D-400', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0; // sin actividad ese día en ese seller

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const sinTada2 = conciliacion.concResult.find(r=>r.nivel_confianza==='SIN_TADA');
assert.equal(sinTada2._candidatosTada.length, 0, 'sin candidatos cuando no hay actividad TADA ese día/seller');

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
const nov2 = novMod.novedades.find(n=>n.tipo==='SIN_TADA');
const idxNov2 = novMod.novedades.indexOf(nov2);

// Sin candidatos → confirmar SIN nombre manual debe permitirse (no hay nada que seleccionar)
novMod.confirmarOk(idxNov2);
const res2 = novMod.resoluciones[nov2.clave];
assert.equal(res2.accion, 'ok', 'sin candidatos, debe poder confirmar sin nombre manual');
assert.equal(res2.nombre_tada, '');
console.log('OK: confirmarOk() permite confirmar SIN_TADA sin candidatos ni nombre manual (sin info no hay nada que validar)');

novMod.aplicarResoluciones();
await new Promise(r=>setTimeout(r, 150));
const sinTada2Resuelto = conciliacion.concResult.find(r=>r.piloto==='Piloto Fantasma');
assert.equal(sinTada2Resuelto.nivel_confianza, 'MANUAL-OK');
assert.equal(sinTada2Resuelto.paquetes, 0, 'sin nombre TADA resuelto, los campos financieros quedan en 0 (mismo comportamiento que antes)');
console.log('OK: sin nombre_tada resuelto, los valores quedan en 0 (sin regresión del comportamiento anterior)');

console.log('\n✓ TODOS LOS CHECKS DE SIN_TADA CON CANDIDATOS PASARON');
