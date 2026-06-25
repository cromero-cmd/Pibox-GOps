// Test ad-hoc para verificar el fix del bug de diccionario (Tarea 2).
// No es parte de la app — harness Node con shims mínimos de DOM/localStorage
// para ejercitar runConciliacion() fuera del navegador.
import { strict as assert } from 'node:assert';

// ── Shims de entorno de navegador ─────────────────────────
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k,v) => { store[k]=String(v); },
  removeItem: k => { delete store[k]; },
};

function fakeEl(){
  const el = {
    _html:'', _text:'', style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    children:[], value:'', disabled:false,
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html=v; },
    get textContent(){ return this._text; }, set textContent(v){ this._text=v; },
    appendChild(){}, addEventListener(){}, querySelector(){return fakeEl();}, querySelectorAll(){return [];},
    scrollTop:0, scrollHeight:0,
  };
  return el;
}
global.document = {
  getElementById: () => fakeEl(),
  addEventListener: () => {},
  createElement: () => fakeEl(),
  body: fakeEl(),
};
global.window = global;
// Sin esto, runConciliacion() llamaría al fetch() nativo de Node (18+) y
// pegaría de verdad al backend de Apps Script en producción al sincronizar
// el diccionario compartido — igual que el resto de los tests, se simula
// "sin red" para que el test sea hermético y no dependa de la red real.
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const logs = [];
const origLog = console.log;

const { loadDict, saveDict } = await import('../js/diccionario.js');
const { fuzzyNameMatch, scoreNames, runConciliacion, concResult } = await import('../js/conciliacion.js');
const parserMod = await import('../js/parser.js');
const normalizerMod = await import('../js/normalizer.js');
const uiMod = await import('../js/ui.js');

// Capturar lo que runConciliacion escribe al log (sustituye addLog real)
const origAddLog = uiMod.addLog;

// ── Datos sintéticos ───────────────────────────────────────
// Diccionario ya "aprendido" la semana pasada con un nombre TADA que YA NO
// coincide exactamente con el de esta semana (variación mínima, como dice el
// brief) — ej: "Brahyan" (semana pasada) vs "Brayan" (esta semana).
const dict = [{
  id: '1', tadaNombre: 'Brahyan Vaquero', mallaNombre: 'Brayan Vaquero Gomez',
  fuente: 'auto', fechaAprendido: '2026-05-01', usos: 92,
}];
saveDict(dict);

// Fila TADA de esta semana — nombre ligeramente distinto al guardado
parserMod.mallaRaw.length = 0;
parserMod.mallaRaw.push({
  'NOMBRE': 'Brayan Vaquero Gomez',
  'FECHA': '2026-06-15',
  'SELLER': 'BOG-TD-CENTRO',
  'BOOKING SERVICIO': 'BK001',
  'ID PILOTO': 'D-001',
  'INICIO DE TURNO': '08:00',
  'CIUDAD': 'BOG',
});

normalizerMod.tadaNorm.length = 0;
normalizerMod.tadaNorm.push({
  piloto: 'Brayan Vaquero', ciudad: 'BOG', seller: 'BOG-TD-OTRO',
  dia: 'LUNES', fecha: '2026-06-15',
  paquetes: 10, incentivos: 2, cancelados: 0,
  tareas: 0, garantizado: 0, bonos: 0, ajustes: 0,
});

console.log('--- Pre-check: fuzzyNameMatch("Brayan Vaquero", "Brahyan Vaquero") ---');
assert.equal(fuzzyNameMatch('Brayan Vaquero', 'Brahyan Vaquero'), true, 'fuzzyNameMatch debe matchear la variante de nombre');
console.log('OK: fuzzyNameMatch detecta la variante de nombre (Brahyan/Brayan)');

console.log('--- Ejecutando runConciliacion() ---');
runConciliacion();
// runConciliacion usa setTimeout(...,50) internamente — esperar a que corra
await new Promise(r=>setTimeout(r, 150));

const { concResult: resultAfter } = await import('../js/conciliacion.js');
console.log('concResult:', JSON.stringify(resultAfter, (k,v)=>k==='matches'?undefined:v, 2));

const row = resultAfter.find(r=>r.piloto==='Brayan Vaquero');
assert.ok(row, 'Debe existir un resultado para Brayan Vaquero');
assert.equal(row.nivel_confianza, 'APRENDIDO', `Esperaba nivel APRENDIDO via fuzzy-match del diccionario, obtuve: ${row.nivel_confianza}`);
console.log('OK: nivel_confianza = APRENDIDO (el bug fix encontró la equivalencia por fuzzy match)');

const dictAfter = loadDict();
const entry = dictAfter.find(e=>e.id==='1');
assert.equal(entry.tadaNombre, 'Brayan Vaquero', 'El diccionario debe haber aprendido el nombre exacto de esta semana');
console.log('OK: diccionario actualizado — tadaNombre ahora es "Brayan Vaquero" (aprendizaje continuo)');

console.log('\n✓ TODOS LOS CHECKS DEL BUG FIX PASARON');
