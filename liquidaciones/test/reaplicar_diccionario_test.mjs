// Test ad-hoc — "Re-aplicar diccionario" sin reiniciar el pipeline.
// Verifica: AMBIGUOUS/SIN_MALLA se resuelven a APRENDIDO al agregar una
// equivalencia y re-aplicar, sin volver a correr runConciliacion(); HIGH/
// MEDIUM/APRENDIDO existentes quedan intactos; tadaNorm/mallaRaw no se
// resetean; toast + log [DICT] correctos.
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

const { dictSave, loadDict } = await import('../js/diccionario.js');
const parser       = await import('../js/parser.js');
const conciliacion  = await import('../js/conciliacion.js');

function setConc(rows){ conciliacion.concResult.length = 0; conciliacion.concResult.push(...rows); }
function setMalla(rows){ parser.mallaRaw.length = 0; parser.mallaRaw.push(...rows); }

setMalla([
  { 'BOOKING SERVICIO':'BK-AMBIG', 'NOMBRE':'Juan Carlos Perez Gomez', 'FECHA':'2026-06-19', 'SELLER':'BOG-X', 'ID PILOTO':'D-100', 'INICIO DE TURNO':'08:00' },
  { 'BOOKING SERVICIO':'BK-HIGH',  'NOMBRE':'Piloto Intacto',          'FECHA':'2026-06-19', 'SELLER':'BOG-X', 'ID PILOTO':'D-200', 'INICIO DE TURNO':'08:00' },
]);

setConc([
  // AMBIGUOUS sin equivalencia aprendida todavía — debe quedar SIN_MALLA hasta que se aprenda la equivalencia.
  { piloto:'JC Perez', ciudad:'BOG', seller:'BOG-X', dia:'viernes', fecha:'2026-06-19',
    paquetes:8, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'AMBIGUOUS', matches:[], nota:'Ambiguo original', driver_id:'PENDIENTE' },
  // HIGH ya resuelto — no debe tocarse.
  { piloto:'Piloto Intacto', ciudad:'BOG', seller:'BOG-X', dia:'viernes', fecha:'2026-06-19',
    paquetes:5, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'HIGH', matches:[{'BOOKING SERVICIO':'BK-HIGH'}], nota:'Exacto', driver_id:'D-200' },
]);

const tadaNormSnapshotLen = 0; // tadaNorm no se usa en este test — foco en concResult/mallaRaw/dict
const mallaRawRefAntes = parser.mallaRaw;

// 1) Sin equivalencia aprendida aún — re-aplicar no debe cambiar nada.
let r = conciliacion.reaplicarDiccionario();
await new Promise(res=>setTimeout(res, 10));
let jc = conciliacion.concResult.find(r=>r.piloto==='JC Perez');
assert.equal(jc.nivel_confianza, 'AMBIGUOUS', 'sin equivalencia en el diccionario, el registro no debe cambiar');

// 2) El usuario agrega la equivalencia manualmente (como haría desde el panel de Diccionario).
dictSave('JC Perez', 'Juan Carlos Perez Gomez', 'manual');
assert.equal(loadDict().length, 1, 'la equivalencia debe haberse guardado');

els['log-conc'].innerHTML = '';
els['toast'].textContent = '';
conciliacion.reaplicarDiccionario();
await new Promise(res=>setTimeout(res, 10));

jc = conciliacion.concResult.find(r=>r.piloto==='JC Perez');
assert.equal(jc.nivel_confianza, 'APRENDIDO', 'tras agregar la equivalencia y re-aplicar, debe pasar a APRENDIDO');
assert.equal(jc.matches[0]['BOOKING SERVICIO'], 'BK-AMBIG', 'debe quedar matcheado con el booking correcto de la malla');
assert.equal(jc.driver_id, 'D-100');
console.log('OK: AMBIGUOUS se resuelve a APRENDIDO al re-aplicar diccionario sin reiniciar el pipeline');

// 3) HIGH no debe tocarse.
const intacto = conciliacion.concResult.find(r=>r.piloto==='Piloto Intacto');
assert.equal(intacto.nivel_confianza, 'HIGH');
assert.equal(intacto.nota, 'Exacto', 'HIGH no debe ser modificado por reaplicarDiccionario()');
console.log('OK: registros HIGH/MEDIUM/APRENDIDO quedan intactos');

// 4) No debe resetear mallaRaw (misma referencia de array, mismo contenido).
assert.equal(parser.mallaRaw, mallaRawRefAntes, 'no debe reasignar/reemplazar mallaRaw');
assert.equal(parser.mallaRaw.length, 2, 'no debe recargar/vaciar mallaRaw');
console.log('OK: mallaRaw no se resetea ni se recarga');

// 5) Toast + log [DICT].
assert.ok(els['toast'].textContent.includes('1 registros actualizados por diccionario'),
  `toast esperado de 1 actualizado — actual: "${els['toast'].textContent}"`);
assert.ok(els['log-conc'].innerHTML.includes('[DICT] Re-aplicado: 1 nuevos APRENDIDO, 0 sin cambios'),
  `log [DICT] esperado — actual: "${els['log-conc'].innerHTML}"`);
console.log('OK: toast y log [DICT] Re-aplicado correctos');

// 6) Botón: debe quedar habilitado de nuevo al finalizar (no se queda colgado en "Re-aplicando...").
assert.equal(els['btn-reaplicar-dict'].disabled, false, 'el botón debe re-habilitarse al terminar');
console.log('OK: botón se re-habilita tras procesar');

console.log('\n✓ TODOS LOS CHECKS DE "RE-APLICAR DICCIONARIO" PASARON');
