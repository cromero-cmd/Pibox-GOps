// Test ad-hoc — feature: sobreescribir historial desde el pipeline.
// Cuando el backend responde {ok:false, error:"El run X ya fue guardado."}
// al intentar guardarHistorial, en vez de mostrar ese error y bloquear, el
// frontend debe ofrecer un modal de confirmación para reemplazar el run
// (accion:'sobreescribirHistorial'). Si el usuario cancela, no se modifica
// nada en el backend.
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', value:'', style:{}, disabled:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];}, remove(){},
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id), createElement:()=>fakeEl('__tmp__'), body:{appendChild(){}} };

const tariffs   = await import('../js/tariffs.js');
const trumpMod  = await import('../js/trump.js');
const auth      = await import('../js/auth.js');
const historial = await import('../js/historial.js');

tariffs.initTariffs();
auth.setCurrentUser({ username:'cromero', nombre:'Camilo Romero', role:'superadmin' });

trumpMod.trumpRows.length = 0;
trumpMod.trumpRows.push({
  _run_id:'LIQ-2026-06-25', _driver_id:'D-100', _piloto:'Pedro Gomez', _ciudad:'BOG', _seller:'BOG-X',
  _fecha:'2026-06-20', _dia:'Sabado', BOOKING_ID:'6a35fdc99a8d66a14311ebac',
  _paquetes:0, _incentivos:0, _cancelados:0, _tareas:0, bonos:0,
  COMPANY_FINAL_COST:97200, ADDITIONAL_COMPANY_FINAL_COST:0, FINAL_COST:80000, ADDITIONAL_FINAL_COST:0,
});

fakeEl('hist-url').value = 'https://script.google.com/macros/s/FAKE/exec';

function parsePayload(opts){
  return JSON.parse(decodeURIComponent(opts.body.replace(/^payload=/, '')));
}

// ── Caso 1 — guardado normal, sin duplicado: no debe consultar ni mostrar el modal ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    return Promise.resolve({ json: async () => ({ ok: true }) });
  };

  await historial.ejecutarGuardarHistorial();

  assert.equal(fetchCalls.length, 1, 'guardado sin duplicado debe hacer un solo fetch');
  assert.equal(fetchCalls[0].opts.method, 'POST');
  assert.equal(parsePayload(fetchCalls[0].opts).accion, 'guardarHistorial');
  console.log('OK: guardado normal (sin duplicado) hace un solo POST, sin consultar ni mostrar el modal de sobreescritura');
}

// ── Caso 2 — error genérico (no es duplicado): no debe activar el flujo de sobreescritura ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    return Promise.resolve({ json: async () => ({ ok: false, error: 'apiKey inválida' }) });
  };

  await historial.ejecutarGuardarHistorial();

  assert.equal(fetchCalls.length, 1, 'un error que no es de duplicado no debe disparar la consulta de conteo');
  console.log('OK: error genérico no activa el flujo de sobreescritura');

  // confirmar sin que haya un pending no debe hacer nada
  await historial.confirmarSobrescribirHistorial();
  assert.equal(fetchCalls.length, 1, 'confirmarSobrescribirHistorial() sin estado pendiente no debe hacer fetch');
  console.log('OK: confirmarSobrescribirHistorial() es un no-op si no hay sobreescritura pendiente');
}

// ── Caso 3 — run duplicado, el usuario confirma el reemplazo ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    if(opts?.method === 'POST'){
      const data = parsePayload(opts);
      if(data.accion === 'guardarHistorial'){
        return Promise.resolve({ json: async () => ({ ok:false, error:'El run LIQ-2026-06-25 ya fue guardado.' }) });
      }
      if(data.accion === 'sobreescribirHistorial'){
        return Promise.resolve({ json: async () => ({ ok:true, mensaje:'Run LIQ-2026-06-25 reemplazado. 2 registros anteriores eliminados, 1 nuevos registros guardados.' }) });
      }
    }
    // GET consultarHistorial — usado por contarRegistrosRun()
    return Promise.resolve({ json: async () => ({ ok:true, registros:[
      {run_id:'LIQ-2026-06-25'}, {run_id:'LIQ-2026-06-25'}, {run_id:'OTRO-RUN'},
    ] }) });
  };

  await historial.ejecutarGuardarHistorial();

  assert.equal(fetchCalls.length, 2, 'run duplicado debe: 1) intentar guardarHistorial, 2) consultar el conteo existente');
  assert.equal(parsePayload(fetchCalls[0].opts).accion, 'guardarHistorial');
  assert.ok(fetchCalls[1].url.includes('consultarHistorial'), 'la segunda llamada debe ser la consulta de conteo (GET consultarHistorial)');
  console.log('OK: al detectar "ya fue guardado" consulta el conteo de registros existentes antes de pedir confirmación');

  await historial.confirmarSobrescribirHistorial();

  assert.equal(fetchCalls.length, 3, 'al confirmar debe hacer un tercer fetch: sobreescribirHistorial');
  const enviado = parsePayload(fetchCalls[2].opts);
  assert.equal(enviado.accion, 'sobreescribirHistorial');
  assert.equal(enviado.runId, 'LIQ-2026-06-25');
  assert.equal(enviado.guardadoPor, 'Camilo Romero');
  assert.ok(Array.isArray(enviado.registros) && enviado.registros.length === 1, 'debe reenviar los mismos registros ya construidos (29 columnas), sin reconstruirlos');
  assert.equal(enviado.registros[0].length, 29);
  console.log('OK: al confirmar, sobreescribirHistorial() envía runId/periodo/registros/guardadoPor/apiKey — los mismos registros ya construidos');

  // Tras confirmar, un segundo intento de confirmar no debe repetir el POST (estado ya limpiado)
  await historial.confirmarSobrescribirHistorial();
  assert.equal(fetchCalls.length, 3, 'tras confirmar una vez, el estado pendiente se limpia — no debe reenviar');
  console.log('OK: el estado de sobreescritura pendiente se limpia después de confirmar (no se reenvía dos veces)');
}

// ── Caso 4 — run duplicado, el usuario cancela: no debe tocar el backend ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    if(opts?.method === 'POST'){
      return Promise.resolve({ json: async () => ({ ok:false, error:'El run LIQ-2026-06-25 ya fue guardado.' }) });
    }
    return Promise.resolve({ json: async () => ({ ok:true, registros:[{run_id:'LIQ-2026-06-25'}] }) });
  };

  await historial.ejecutarGuardarHistorial();
  assert.equal(fetchCalls.length, 2, 'detección de duplicado: intento + conteo');

  historial.cancelarSobrescribirHistorial();
  await historial.confirmarSobrescribirHistorial();

  assert.equal(fetchCalls.length, 2, 'cancelar debe impedir cualquier llamada de sobreescritura — el backend no se modifica');
  console.log('OK: cancelar la sobreescritura no hace ninguna llamada adicional al backend');
}

console.log('\n✓ TODOS LOS CHECKS DEL FLUJO DE SOBREESCRITURA DE HISTORIAL PASARON');
