// Test ad-hoc — feature: recarga automática de pestañas abiertas cuando se
// publica una versión nueva. version-check.js consulta version.json
// periódicamente y, si detecta un cambio respecto a la versión con la que
// cargó la pestaña, avisa con un toast y recarga sola (location.reload()).
import { strict as assert } from 'node:assert';

global.window = global;
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', className:'', style:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    _t:null,
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id) };

let reloadCalls = 0;
global.location = { reload(){ reloadCalls++; } };

let fetchCalls = [];
let nextVersion = 'v1';
let nextOk = true;
global.fetch = async (url, opts) => {
  fetchCalls.push({url, opts});
  return {
    ok: nextOk,
    status: nextOk ? 200 : 500,
    json: async () => ({ version: nextVersion }),
  };
};

// Interceptar setTimeout para verificar que se programa el reload con el
// delay correcto, sin tener que esperarlo en tiempo real dentro del test.
const scheduledTimeouts = [];
const origSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => { scheduledTimeouts.push({fn, ms}); return origSetTimeout(fn, 0); };

const vc = await import('../js/version-check.js');

// ══════════════════════════════════════════════════════
// CASO 1 — primera consulta establece la versión base, sin recargar
// ══════════════════════════════════════════════════════
vc._resetForTests();
fetchCalls = []; reloadCalls = 0; scheduledTimeouts.length = 0;
nextVersion = 'v1';
{
  const changed = await vc.checkForNewVersion();
  assert.equal(changed, false, 'la primera consulta solo establece la base, no dispara recarga');
  assert.equal(reloadCalls, 0);
  assert.equal(fetchCalls.length, 1);
  console.log('OK: primera consulta establece la versión base sin recargar');
}

// ══════════════════════════════════════════════════════
// CASO 2 — misma versión en la siguiente consulta → no recarga
// ══════════════════════════════════════════════════════
{
  const changed = await vc.checkForNewVersion();
  assert.equal(changed, false, 'misma versión no debe disparar recarga');
  assert.equal(reloadCalls, 0);
  console.log('OK: sin cambio de versión, no recarga');
}

// ══════════════════════════════════════════════════════
// CASO 3 — versión distinta → avisa y programa el reload
// ══════════════════════════════════════════════════════
{
  nextVersion = 'v2';
  const changed = await vc.checkForNewVersion();
  assert.equal(changed, true, 'debe detectar la versión nueva');
  // toast() también programa su propio setTimeout interno (auto-hide) —
  // filtramos por el de mayor delay, que es el del reload.
  const reloadTimeout = scheduledTimeouts.reduce((max,t)=>t.ms>(max?.ms??-1)?t:max, null);
  assert.ok(reloadTimeout, 'debe programar el reload con setTimeout, no ejecutarlo inmediato');
  assert.ok(reloadTimeout.ms >= 1000, 'debe dar un margen de aviso antes de recargar, no recargar en 0ms');
  assert.equal(fakeEl('toast').textContent.includes('Nueva versión'), true, 'debe mostrar un toast avisando');
  // El setTimeout interceptado ya se disparó (ejecutamos la fn real con delay 0 vía origSetTimeout)
  await new Promise(r=>origSetTimeout(r, 10));
  assert.equal(reloadCalls, 1, 'debe llamar location.reload() tras el aviso');
  console.log('OK: detecta versión nueva, avisa con toast y recarga');
}

// ══════════════════════════════════════════════════════
// CASO 4 — cache-busting: el fetch debe evitar servirse del caché HTTP
// ══════════════════════════════════════════════════════
{
  const ultimaLlamada = fetchCalls[fetchCalls.length-1];
  assert.ok(ultimaLlamada.url.includes('version.json'), 'debe consultar version.json');
  assert.ok(ultimaLlamada.url.includes('?t='), 'debe llevar un query param de cache-busting');
  assert.equal(ultimaLlamada.opts?.cache, 'no-store', 'debe pedir explícitamente no usar caché HTTP');
  console.log('OK: la consulta a version.json evita el caché HTTP (query param + cache:no-store)');
}

// ══════════════════════════════════════════════════════
// CASO 5 — error de red no debe romper la app, solo omitir el chequeo
// ══════════════════════════════════════════════════════
{
  vc._resetForTests();
  reloadCalls = 0;
  nextOk = false; // simula un fetch que responde con error HTTP
  const changed = await vc.checkForNewVersion();
  assert.equal(changed, false, 'un error de red no debe reportarse como cambio de versión');
  assert.equal(reloadCalls, 0, 'un error de red nunca debe disparar un reload');
  nextOk = true;
  console.log('OK: un error de red no interrumpe el uso normal de la app (sin throw, sin reload)');
}

// ══════════════════════════════════════════════════════
// CASO 6 — startVersionPolling()/stopVersionPolling() arman y limpian el intervalo
// ══════════════════════════════════════════════════════
{
  vc._resetForTests();
  const intervalCalls = [];
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  global.setInterval = (fn, ms) => { intervalCalls.push({fn, ms}); return 12345; };
  global.clearInterval = (id) => { intervalCalls.push({cleared:id}); };

  const id = vc.startVersionPolling(60000);
  assert.equal(intervalCalls.length, 1, 'debe registrar exactamente un intervalo');
  assert.equal(intervalCalls[0].ms, 60000, 'debe respetar el intervalo pasado como parámetro');
  assert.equal(id, 12345);

  vc.stopVersionPolling();
  assert.equal(intervalCalls[intervalCalls.length-1].cleared, 12345, 'debe limpiar el intervalo registrado');

  global.setInterval = origSetInterval;
  global.clearInterval = origClearInterval;
  console.log('OK: startVersionPolling()/stopVersionPolling() arman y limpian el setInterval correctamente');
}

global.setTimeout = origSetTimeout;
console.log('\n✓ TODOS LOS CHECKS DE version-check.js (recarga automática) PASARON');
