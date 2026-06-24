// Test ad-hoc: verifica el fix del Bug 3 — resoluciones manuales no deben
// desalinearse cuando novedades[] se reconstruye con un orden/longitud distinto
// en un nuevo procesamiento del pipeline.
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
// Stub mínimo de elemento DOM — solo necesitamos que innerHTML/querySelector
// no lancen excepción; el contenido renderizado no es lo que este test verifica.
const fakeEl = { innerHTML:'', querySelector(){return null;}, querySelectorAll(){return [];} };
global.document = { getElementById: () => fakeEl };
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const conciliacion = await import('../js/conciliacion.js');
const distribucion = await import('../js/distribucion.js');
const novMod = await import('../js/novedades.js');

function setConc(rows){ conciliacion.concResult.length = 0; conciliacion.concResult.push(...rows); }
function setDist(rows){ distribucion.distResult.length = 0; distribucion.distResult.push(...rows); }

// --- Procesamiento #1: 3 pilotos con novedad LOW, en cierto orden ---
setConc([
  { piloto:'Yoverty Matta Sanchez', ciudad:'CALI', seller:'A', fecha:'2026-06-01', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
  { piloto:'Juan Perez',            ciudad:'BOG',  seller:'B', fecha:'2026-06-02', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
  { piloto:'Aldair Perez',          ciudad:'MED',  seller:'C', fecha:'2026-06-03', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
]);
setDist([]);

novMod.novedades.length = 0;
novMod.novedades.push(...novMod.buildNovedades());
assert.equal(novMod.novedades.length, 3, 'deben construirse 3 novedades');

// Resolver manualmente la novedad en posición 1 (Juan Perez) y la de posición 2 (Aldair Perez)
novMod.confirmarOk(1);
novMod.confirmarExcluir(2);

const claveJuan   = novMod.novedades[1].clave;
const claveAldair = novMod.novedades[2].clave;
assert.equal(novMod.resoluciones[claveJuan]?.accion, 'ok');
assert.equal(novMod.resoluciones[claveAldair]?.accion, 'excluir');

// --- Procesamiento #2: el pipeline se vuelve a correr y concResult llega en OTRO ORDEN
// (y con una novedad nueva insertada al principio) — esto es lo que rompía antes del fix:
// las resoluciones quedaban ancladas a la posición numérica vieja, no al piloto correcto.
setConc([
  { piloto:'Aldair Perez',          ciudad:'MED',  seller:'C', fecha:'2026-06-03', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
  { piloto:'Nuevo Piloto',          ciudad:'BAQ',  seller:'D', fecha:'2026-06-04', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
  { piloto:'Yoverty Matta Sanchez', ciudad:'CALI', seller:'A', fecha:'2026-06-01', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
  { piloto:'Juan Perez',            ciudad:'BOG',  seller:'B', fecha:'2026-06-02', nivel_confianza:'LOW', nota:'', matches:[], driver_id:'' },
]);

const rebuilt = novMod.buildNovedades();
novMod.novedades.length = 0;
novMod.novedades.push(...rebuilt);
assert.equal(novMod.novedades.length, 4, 'deben construirse 4 novedades tras el reprocesamiento');

// Las posiciones cambiaron: Juan Perez ahora está en idx 3 (antes 1), Aldair en idx 0 (antes 2)
const juanAhora   = novMod.novedades.find(n=>n.piloto==='Juan Perez');
const aldairAhora = novMod.novedades.find(n=>n.piloto==='Aldair Perez');
assert.equal(juanAhora.clave, claveJuan, 'la clave de Juan Perez debe ser estable entre procesamientos');
assert.equal(aldairAhora.clave, claveAldair, 'la clave de Aldair Perez debe ser estable entre procesamientos');

// La resolución sigue correctamente asociada al piloto correcto, sin importar su nueva posición
assert.equal(novMod.resoluciones[juanAhora.clave]?.accion, 'ok', 'Juan Perez debe seguir incluido');
assert.equal(novMod.resoluciones[aldairAhora.clave]?.accion, 'excluir', 'Aldair Perez debe seguir excluido');

// El piloto nuevo y Yoverty no deben tener ninguna resolución previa asociada por error
const nuevoPiloto = novMod.novedades.find(n=>n.piloto==='Nuevo Piloto');
const yoverty      = novMod.novedades.find(n=>n.piloto==='Yoverty Matta Sanchez');
assert.equal(novMod.resoluciones[nuevoPiloto.clave], undefined, 'piloto nuevo no debe heredar una resolución ajena');
assert.equal(novMod.resoluciones[yoverty.clave], undefined, 'Yoverty no debe heredar una resolución ajena');

console.log('✓ TODOS LOS CHECKS DEL FIX DE resoluciones POR CLAVE ESTABLE PASARON');
