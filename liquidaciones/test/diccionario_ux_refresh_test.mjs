// Test ad-hoc — bug UX: el panel del diccionario no se actualizaba en
// tiempo real al agregar una equivalencia desde Novedades (solo aparecía
// tras recargar la página). Cubre:
//   Fix 1: dictSave() refresca dict-lista/dict-summary-label automáticamente
//          SOLO si el panel está visible (offsetParent !== null).
//   Fix 2: refrescarDiccionario() (botón 🔄) sincroniza con el backend,
//          re-renderiza, y muestra el toast correspondiente.
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
    offsetParent: {}, // visible por defecto — los tests que necesiten "oculto" lo ponen en null
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];},
  };
  return els[id];
}
global.document = { getElementById: (id) => fakeEl(id) };

let fetchCalls = [];
let mockGetResponse = { ok:true, entradas: [] };
global.fetch = (url, opts) => {
  fetchCalls.push({ url, opts });
  if(opts && opts.method === 'POST') return Promise.resolve({});
  return Promise.resolve({ json: () => Promise.resolve(mockGetResponse) });
};

const { dictSave, loadDict, refrescarDiccionario } = await import('../js/diccionario.js');

// ═══════════════════════════════════════════
// Fix 1a — panel visible (offsetParent !== null): dictSave() refresca dict-lista de inmediato
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
fakeEl('dict-lista'); fakeEl('dict-summary-label'); fakeEl('toast'); // asegurar inicialización antes de manipular directo
els['dict-lista'].offsetParent = {}; // visible
els['dict-lista'].innerHTML = '__SENTINEL_VACIO__';
els['dict-summary-label'].textContent = '';

dictSave('Pedro Nuevo', 'Pedro Malla', 'manual');

assert.notEqual(els['dict-lista'].innerHTML, '__SENTINEL_VACIO__',
  'con el panel visible, dictSave() debe re-renderizar dict-lista de inmediato');
assert.ok(els['dict-lista'].innerHTML.includes('Pedro Nuevo'),
  'la lista renderizada debe incluir la equivalencia recién guardada');
assert.equal(els['dict-summary-label'].textContent, 'Diccionario de equivalencias (1)');
console.log('OK: dictSave() refresca dict-lista y el contador cuando el panel está visible');

// ═══════════════════════════════════════════
// Fix 1b — panel OCULTO (offsetParent===null, ej. confirmando en el paso de
// Novedades, otro paso del stepper): dictSave() NO debe tocar dict-lista —
// nada que renderizar todavía, se mostrará correcto la próxima vez que se abra.
// ═══════════════════════════════════════════
els['dict-lista'].offsetParent = null; // oculto
els['dict-lista'].innerHTML = '__SENTINEL_OCULTO__';

dictSave('Maria Otra', 'Maria Malla', 'auto');

assert.equal(els['dict-lista'].innerHTML, '__SENTINEL_OCULTO__',
  'con el panel oculto, dictSave() no debe re-renderizar dict-lista (nada que mostrar)');
console.log('OK: dictSave() no re-renderiza cuando el panel del diccionario no está visible');

// Pero el dato sí debe haberse guardado correctamente aunque el panel esté oculto
const dictTrasOculto = loadDict();
assert.ok(dictTrasOculto.find(e=>e.tadaNombre==='Maria Otra'),
  'la equivalencia debe guardarse igual aunque el panel no esté visible en ese momento');
console.log('OK: la equivalencia se guarda igual aunque el panel esté oculto — solo se difiere el render');

// ═══════════════════════════════════════════
// Fix 2 — refrescarDiccionario() (botón 🔄): sincroniza con el backend,
// re-renderiza, y muestra el toast correspondiente.
// ═══════════════════════════════════════════
mockGetResponse = { ok:true, entradas: [
  { tadaNombre:'Del Servidor', mallaNombre:'Del Servidor Malla', fuente:'auto', fechaAprendido:'2026-01-01', usos:3 },
]};
els['dict-lista'].offsetParent = {}; // visible — simula el panel abierto cuando se hace clic en 🔄
els['dict-lista'].innerHTML = '';
els['toast'].textContent = '';

await refrescarDiccionario();

assert.ok(els['dict-lista'].innerHTML.includes('Del Servidor'),
  'refrescarDiccionario() debe re-renderizar la lista con los datos descargados del servidor');
assert.ok(els['toast'].textContent.includes('Diccionario sincronizado'),
  `debe mostrar el toast de éxito — actual: "${els['toast'].textContent}"`);
console.log('OK: refrescarDiccionario() sincroniza, re-renderiza y muestra el toast de éxito');

// Caso offline — el botón también debe avisar si no pudo conectar
global.fetch = () => Promise.reject(new Error('sin red en este test'));
els['toast'].textContent = '';
await refrescarDiccionario();
assert.ok(els['toast'].textContent.includes('No se pudo conectar'),
  `debe avisar que no pudo sincronizar — actual: "${els['toast'].textContent}"`);
console.log('OK: refrescarDiccionario() avisa cuando el backend no responde, sin romper el flujo');

console.log('\n✓ TODOS LOS CHECKS DEL REFRESH EN TIEMPO REAL DEL DICCIONARIO PASARON');
