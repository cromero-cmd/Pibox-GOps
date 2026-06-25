// Test ad-hoc — fixes del diccionario de equivalencias:
//   Bug 1: lookup en NIVEL 0 ignoraba equivalencias por comparación estricta
//          (ya era fuzzy desde un fix anterior; aquí se agrega match exacto
//          explícito para nombres de 1 sola palabra + tie-break por fecha).
//   Bug 2: una entrada se corrompía cuando un piloto distinto, con match
//          fuzzy PARCIAL (comparte solo 2 de 4 palabras con un homónimo),
//          disparaba el renombrado de "aprendizaje continuo".
//   Bug 3: consistencia del aprendizaje automático en confirmarOk().
import { strict as assert } from 'node:assert';

global.window = global;
const lsStore = {};
global.localStorage = {
  getItem:k=>(k in lsStore ? lsStore[k] : null),
  setItem:(k,v)=>{ lsStore[k]=String(v); },
  removeItem:k=>{ delete lsStore[k]; },
};
// Captura el contenido real de cada log por id, para verificar [DICT]/[WARN].
const logEls = {};
function fakeLogEl(id){
  if(!logEls[id]) logEls[id] = { innerHTML:'', scrollTop:0, textContent:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}} };
  return logEls[id];
}
global.document = { getElementById: (id) => fakeLogEl(id) };
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const { normStr } = await import('../js/config.js');
const { dictSave, loadDict } = await import('../js/diccionario.js');
const parser       = await import('../js/parser.js');
const normalizer    = await import('../js/normalizer.js');
const conciliacion  = await import('../js/conciliacion.js');

// ═══════════════════════════════════════════
// Bug 2 — dictSave() nunca debe corromper otra entrada
// ═══════════════════════════════════════════
window._dictCache = null;
localStorage.removeItem('pibox:diccionario_v1');

dictSave('Edwin Romero', 'Camilo Romero', 'auto');
dictSave('Carlos Clavijo', 'Camilo Romero', 'auto'); // mismo mallaNombre, tadaNombre distinto

let dict = loadDict();
assert.equal(dict.length, 2, 'deben existir 2 entradas separadas, no una sobreescrita');
assert.ok(dict.find(e=>e.tadaNombre==='Edwin Romero' && e.mallaNombre==='Camilo Romero'),
  'la entrada de Edwin Romero debe seguir intacta');
assert.ok(dict.find(e=>e.tadaNombre==='Carlos Clavijo' && e.mallaNombre==='Camilo Romero'),
  'Carlos Clavijo debe tener su propia entrada con el mismo mallaNombre (homónimo permitido)');
console.log('OK: dos tadaNombre distintos pueden mapear al mismo mallaNombre sin conflicto');

// Actualizar Edwin Romero — debe modificar SU entrada, no crear una nueva ni tocar Carlos Clavijo
dictSave('Edwin Romero', 'Camilo Romero Actualizado', 'auto');
dict = loadDict();
assert.equal(dict.length, 2, 'actualizar una entrada existente no debe crear una tercera');
assert.equal(dict.find(e=>e.tadaNombre==='Edwin Romero').mallaNombre, 'Camilo Romero Actualizado');
assert.equal(dict.find(e=>e.tadaNombre==='Carlos Clavijo').mallaNombre, 'Camilo Romero',
  'actualizar Edwin Romero no debe afectar la entrada de Carlos Clavijo');
console.log('OK: actualizar una entrada por tadaNombre no afecta entradas de otros pilotos');

// [DICT] log al aprender una equivalencia NUEVA
logEls['log-conc'].innerHTML = '';
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
dictSave('Jeremy Acosta', 'Jeremy Santiago', 'manual');
assert.ok(logEls['log-conc'].innerHTML.includes('[DICT] Aprendido: "Jeremy Acosta" → "Jeremy Santiago" (manual)'),
  'debe registrar [DICT] al aprender una equivalencia nueva');
console.log('OK: dictSave() registra [DICT] al aprender una equivalencia nueva');

// No debe volver a logear [DICT] al solo actualizar la misma entrada
const lenAntes = logEls['log-conc'].innerHTML.length;
dictSave('Jeremy Acosta', 'Jeremy Santiago Actualizado', 'manual');
assert.equal(logEls['log-conc'].innerHTML.length, lenAntes, 'actualizar una entrada existente no debe re-logear [DICT]');
console.log('OK: actualizar una entrada existente no duplica el log [DICT]');

// ═══════════════════════════════════════════
// Bug 1 — lookup fuzzy en NIVEL 0 + match exacto para nombres de 1 palabra
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
dictSave('Anderson', 'Anderson Malla', 'auto'); // nombre de 1 sola palabra

parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'Anderson Malla', 'FECHA':'2026-06-22', 'SELLER':'BOG-X', 'BOOKING SERVICIO':'BK-AND', 'ID PILOTO':'D-1' });
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'Anderson', ciudad:'BOG', seller:'BOG-X', dia:'lunes', fecha:'2026-06-22', paquetes:5, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 });

logEls['log-conc'].innerHTML = '';
conciliacion.runConciliacion();
await new Promise(r=>setTimeout(r, 150));
const rAnderson = conciliacion.concResult.find(r=>r.piloto==='Anderson');
assert.equal(rAnderson.nivel_confianza, 'APRENDIDO', 'nombre de 1 palabra con match exacto debe encontrarse en el diccionario (antes fuzzyNameMatch lo rechazaba por su minimo de 2 palabras)');
console.log('OK: lookup exacto en NIVEL 0 funciona para nombres de 1 sola palabra');

// ═══════════════════════════════════════════
// Bug 2 (continuación) — homónimo parcial NO debe corromper la entrada
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
dictSave('Maria Fernanda Lopez Diaz', 'Lopez Diaz Malla', 'auto');

parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'Otra Persona Cualquiera', 'FECHA':'2026-06-23', 'SELLER':'BOG-Y', 'BOOKING SERVICIO':'BK-XXX', 'ID PILOTO':'D-2' });
normalizer.tadaNorm.length = 0;
// "Maria Cristina Sanchez Diaz" comparte solo 2/4 palabras (Maria, Diaz) con
// la entrada guardada — score=2, minWords=4 → NO debe disparar el renombrado.
normalizer.tadaNorm.push({ piloto:'Maria Cristina Sanchez Diaz', ciudad:'BOG', seller:'BOG-Y', dia:'martes', fecha:'2026-06-23', paquetes:3, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 });

conciliacion.runConciliacion();
await new Promise(r=>setTimeout(r, 150));
const dictDespues = loadDict();
assert.equal(dictDespues.length, 1, 'no debe crearse una entrada nueva ni duplicarse');
assert.equal(dictDespues[0].tadaNombre, 'Maria Fernanda Lopez Diaz',
  'la entrada de Maria Fernanda Lopez Diaz NO debe ser sobreescrita por un homónimo parcial (Maria Cristina Sanchez Diaz)');
console.log('OK: un match fuzzy parcial (2/4 palabras) no corrompe una entrada de otro piloto');

// ═══════════════════════════════════════════
// Bug 1 (continuación) — empate de score se resuelve por fechaAprendido
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
let d = loadDict();
d.push({id:'e1', tadaNombre:'Carlos Ramirez Lopez', mallaNombre:'MallaVieja', fechaAprendido:'2026-01-01', usos:0});
d.push({id:'e2', tadaNombre:'Carlos Ramirez Gomez', mallaNombre:'MallaReciente', fechaAprendido:'2026-06-01', usos:0});
window._dictCache = d; localStorage.setItem('pibox:diccionario_v1', JSON.stringify(d));

parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'MallaReciente', 'FECHA':'2026-06-24', 'SELLER':'BOG-Z', 'BOOKING SERVICIO':'BK-REC', 'ID PILOTO':'D-3' });
normalizer.tadaNorm.length = 0;
// "Carlos Ramirez Torres" empata en score (2) contra ambas entradas (comparte
// "carlos ramirez" con las dos, ninguna comparte "torres") — debe ganar la
// entrada más reciente (MallaReciente, fechaAprendido 2026-06-01).
normalizer.tadaNorm.push({ piloto:'Carlos Ramirez Torres', ciudad:'BOG', seller:'BOG-Z', dia:'miercoles', fecha:'2026-06-24', paquetes:4, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 });

logEls['log-conc'].innerHTML = '';
conciliacion.runConciliacion();
await new Promise(r=>setTimeout(r, 150));
const rTorres = conciliacion.concResult.find(r=>r.piloto==='Carlos Ramirez Torres');
assert.equal(rTorres.nivel_confianza, 'APRENDIDO');
assert.ok(rTorres.nota.includes('MallaReciente'), `debe priorizar la entrada más reciente en empate — nota: ${rTorres.nota}`);
assert.ok(logEls['log-conc'].innerHTML.includes('[WARN] 2 entradas del diccionario coinciden'), 'debe loguear WARN por ambigüedad');
console.log('OK: empate de score se resuelve por fechaAprendido (más reciente gana)');

console.log('\n✓ TODOS LOS CHECKS DE LOS FIXES DEL DICCIONARIO PASARON');
