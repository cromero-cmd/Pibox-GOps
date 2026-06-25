// Test ad-hoc — diccionario de equivalencias compartido vía Google Sheets.
// Cubre: (1) dictSave() envía el payload correcto al backend en segundo
// plano, (2) syncDiccionarioFromBackend() mezcla con prioridad del servidor
// y preserva entradas locales que el servidor no tiene, (3) fallback
// offline si el backend no responde, (4) runConciliacion() descarga y
// aplica automáticamente una equivalencia que SOLO existe en el servidor
// — el escenario central del brief: "Usuario B ejecuta conciliación →
// descarga la equivalencia de Sheets → la aplica automáticamente".
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

// Fetch controlable: distingue GET (lecturas, ej. getDiccionario) de
// POST no-cors (escrituras fire-and-forget, ej. saveDiccionario) y registra
// cada llamada para poder inspeccionarla.
let fetchCalls = [];
let mockGetResponse = { ok:true, entradas: [] };
let forzarFalloRed = false;
global.fetch = (url, opts) => {
  fetchCalls.push({ url, opts });
  if(forzarFalloRed) return Promise.reject(new Error('sin red en este test'));
  if(opts && opts.method === 'POST') return Promise.resolve({}); // no-cors: respuesta opaca
  return Promise.resolve({ json: () => Promise.resolve(mockGetResponse) });
};

const dictMod      = await import('../js/diccionario.js');
const { dictSave, loadDict, syncDiccionarioFromBackend } = dictMod;
const parser        = await import('../js/parser.js');
const normalizer     = await import('../js/normalizer.js');
const conciliacion   = await import('../js/conciliacion.js');

// ═══════════════════════════════════════════
// 1 — dictSave() sincroniza al backend en segundo plano con el payload correcto
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
fetchCalls = [];
dictSave('Juan Perez', 'Juan P Malla', 'manual');

const postCall = fetchCalls.find(c => c.opts?.method === 'POST');
assert.ok(postCall, 'dictSave() debe llamar a fetch POST para sincronizar al backend');
assert.equal(postCall.opts.mode, 'no-cors', 'debe usar fetch no-cors como el resto de llamadas al backend');
const bodyStr = decodeURIComponent(postCall.opts.body.replace(/^payload=/, ''));
const enviado = JSON.parse(bodyStr);
assert.equal(enviado.accion, 'saveDiccionario');
assert.equal(enviado.apiKey, 'pibox-liq-2026-9605');
assert.equal(enviado.entrada.tadaNombre, 'Juan Perez');
assert.equal(enviado.entrada.mallaNombre, 'Juan P Malla');
assert.equal(enviado.entrada.fuente, 'manual');
assert.ok(enviado.entrada.fechaAprendido, 'debe incluir fechaAprendido');
console.log('OK: dictSave() sincroniza al backend con el payload {accion, apiKey, entrada} correcto');

// ═══════════════════════════════════════════
// 2 — syncDiccionarioFromBackend(): el servidor tiene prioridad por
// tadaNombre; las entradas solo-locales se conservan.
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');
dictSave('A Piloto', 'A Malla Local', 'auto');   // existe en ambos lados, distinto en cada uno
dictSave('B Piloto', 'B Malla Local', 'auto');   // solo existe local

mockGetResponse = { ok:true, entradas: [
  { tadaNombre:'A Piloto', mallaNombre:'A Malla Servidor', fuente:'auto', fechaAprendido:'2026-01-01', usos:7 },
]};

const syncRes = await syncDiccionarioFromBackend();
assert.equal(syncRes.delServidor, 1);
assert.equal(syncRes.locales, 1);
assert.equal(syncRes.total, 2);

const dictMezclado = loadDict();
assert.equal(dictMezclado.length, 2);
const aEntry = dictMezclado.find(e=>e.tadaNombre==='A Piloto');
assert.equal(aEntry.mallaNombre, 'A Malla Servidor', 'el servidor debe ganar sobre la entrada local para el mismo tadaNombre');
assert.equal(aEntry.usos, 7);
const bEntry = dictMezclado.find(e=>e.tadaNombre==='B Piloto');
assert.ok(bEntry, 'la entrada que solo existe local debe conservarse');
assert.equal(bEntry.mallaNombre, 'B Malla Local');
console.log('OK: syncDiccionarioFromBackend() mezcla con prioridad del servidor y conserva entradas solo-locales');

// ═══════════════════════════════════════════
// 3 — Fallback offline: si el backend no responde, el diccionario local
// sigue intacto y el pipeline no se bloquea.
// ═══════════════════════════════════════════
forzarFalloRed = true;
const totalAntes = loadDict().length;
const syncOffline = await syncDiccionarioFromBackend();
assert.equal(syncOffline.offline, true);
assert.equal(syncOffline.total, totalAntes, 'sin red, debe devolver el diccionario local tal cual estaba');
assert.equal(loadDict().length, totalAntes, 'no debe alterar el diccionario local cuando el backend falla');
forzarFalloRed = false;
console.log('OK: syncDiccionarioFromBackend() cae a fallback local cuando el backend no responde');

// ═══════════════════════════════════════════
// 4 — runConciliacion() descarga y aplica automáticamente una equivalencia
// que SOLO existe en el servidor (nunca se agregó localmente) — el
// escenario central del brief: Usuario B no hace nada manual y la
// conciliación ya resuelve el piloto como APRENDIDO.
// ═══════════════════════════════════════════
window._dictCache = null; localStorage.removeItem('pibox:diccionario_v1');

parser.mallaRaw.length = 0;
parser.mallaRaw.push({
  'NOMBRE':'Nuevo Piloto Malla', 'FECHA':'2026-06-20', 'SELLER':'BOG-X',
  'BOOKING SERVICIO':'BK-NUEVO', 'ID PILOTO':'D-500', 'INICIO DE TURNO':'08:00',
});
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({
  piloto:'Distinto Conductor Tada', ciudad:'BOG', seller:'BOG-X', dia:'sabado', fecha:'2026-06-20',
  paquetes:9, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
});

// La equivalencia vive SOLO en "Sheets" (el mock) — nunca se llamó dictSave() localmente.
mockGetResponse = { ok:true, entradas: [
  { tadaNombre:'Distinto Conductor Tada', mallaNombre:'Nuevo Piloto Malla', fuente:'manual', fechaAprendido:'2026-06-01', usos:0 },
]};
assert.equal(loadDict().length, 0, 'precondición: el diccionario local debe estar vacío antes de conciliar');

els['log-conc'].innerHTML = '';
await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 250); });

const fila = conciliacion.concResult.find(r=>r.piloto==='Distinto Conductor Tada');
assert.ok(fila, 'debe existir un resultado para el piloto');
assert.equal(fila.nivel_confianza, 'APRENDIDO',
  `debe resolver como APRENDIDO usando la equivalencia descargada de Sheets (sin pasos manuales) — obtuve: ${fila.nivel_confianza}`);
console.log('OK: runConciliacion() descarga la equivalencia del servidor y la aplica automáticamente (APRENDIDO)');

assert.ok(els['log-conc'].innerHTML.includes('[DICT] Diccionario sincronizado: 1 entradas (1 del servidor, 0 locales)'),
  `debe loguear el resumen de sincronización — log actual: ${els['log-conc'].innerHTML}`);
console.log('OK: runConciliacion() loguea el resumen de sincronización del diccionario');

console.log('\n✓ TODOS LOS CHECKS DEL DICCIONARIO COMPARTIDO VÍA GOOGLE SHEETS PASARON');
