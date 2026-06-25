// Test ad-hoc — feature: detección de duplicados por booking_id al guardar
// historial. El run_id se genera por fecha de ejecución, no por período —
// dos corridas de la misma semana producen run_id distintos aunque tengan
// los mismos bookings. El verdadero identificador de duplicado son los
// booking_id; cuando el backend los detecta, retorna
// {ok:false, tipo:'duplicado_booking', runIdExistente, ...} y el frontend
// debe ofrecer reemplazar el run VIEJO (runIdExistente), no el nuevo.
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
  _run_id:'LIQ-20260625-v3', _driver_id:'D-100', _piloto:'Pedro Gomez', _ciudad:'BOG', _seller:'BOG-X',
  _fecha:'2026-06-20', _dia:'Sabado', BOOKING_ID:'6a35fdc99a8d66a14311ebac',
  _paquetes:5, _incentivos:0, _cancelados:0, _tareas:0, bonos:0,
  COMPANY_FINAL_COST:97200, ADDITIONAL_COMPANY_FINAL_COST:0, FINAL_COST:80000, ADDITIONAL_FINAL_COST:0,
});

fakeEl('hist-url').value = 'https://script.google.com/macros/s/FAKE/exec';

function parsePayload(opts){
  return JSON.parse(decodeURIComponent(opts.body.replace(/^payload=/, '')));
}

const respuestaDuplicadoBooking = {
  ok: false,
  tipo: 'duplicado_booking',
  runIdExistente: 'LIQ-20260625-v2',
  periodoExistente: '15 al 21 de junio de 2026',
  guardadoPorExistente: 'Sergio Romero',
  fechaGuardadoExistente: '25/6/2026',
  totalExistentes: 611,
  totalNuevos: 1,
  bookingsDuplicados: ['6a35fdc99a8d66a14311ebac'],
  error: '1 bookings ya existen en el historial en el run LIQ-20260625-v2',
};

// ── Caso 1 — duplicado por booking_id: NO debe consultar conteo por run_id
//    (esa consulta es solo del flujo run_id-duplicado, no aplica aquí) ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    return Promise.resolve({ json: async () => respuestaDuplicadoBooking });
  };

  await historial.ejecutarGuardarHistorial();

  assert.equal(fetchCalls.length, 1, 'detectar duplicado por booking_id no debe disparar ninguna consulta adicional (el backend ya da todo el contexto)');
  assert.equal(parsePayload(fetchCalls[0].opts).accion, 'guardarHistorial');
  console.log('OK: duplicado por booking_id se detecta directamente desde la respuesta del primer POST, sin consultas extra');
}

// ── Caso 2 — al confirmar, debe reemplazar el run EXISTENTE (viejo), no el nuevo ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    if(opts?.method === 'POST'){
      const data = parsePayload(opts);
      if(data.accion === 'guardarHistorial') return Promise.resolve({ json: async () => respuestaDuplicadoBooking });
      if(data.accion === 'sobreescribirHistorial') return Promise.resolve({ json: async () => ({ ok:true, mensaje:'Run LIQ-20260625-v2 reemplazado. 611 registros anteriores eliminados, 1 nuevos registros guardados.' }) });
    }
    return Promise.resolve({ json: async () => ({ ok:true, registros:[] }) });
  };

  await historial.ejecutarGuardarHistorial();
  await historial.confirmarSobrescribirHistorial();

  assert.equal(fetchCalls.length, 2, 'guardarHistorial (rechazado) + sobreescribirHistorial (confirmado) = 2 llamadas, sin GET de conteo intermedio');
  const enviado = parsePayload(fetchCalls[1].opts);
  assert.equal(enviado.accion, 'sobreescribirHistorial');
  assert.equal(enviado.runId, 'LIQ-20260625-v2', 'debe borrar el run EXISTENTE (runIdExistente), no el run_id nuevo generado en esta corrida');
  assert.notEqual(enviado.runId, 'LIQ-20260625-v3', 'no debe usar el run_id nuevo para la eliminación');
  // Los registros reenviados siguen llevando el run_id NUEVO en su columna 0 (el run viejo se reemplaza por uno nuevo)
  assert.equal(enviado.registros[0][0], 'LIQ-20260625-v3', 'los registros insertados deben llevar el run_id nuevo, aunque se borre el run viejo');
  console.log('OK: al confirmar, sobreescribirHistorial() borra el run EXISTENTE (runIdExistente) e inserta los registros con el run_id nuevo');
}

// ── Caso 3 — cancelar no debe tocar el backend ──
{
  let fetchCalls = [];
  global.fetch = (url, opts) => {
    fetchCalls.push({url, opts});
    return Promise.resolve({ json: async () => respuestaDuplicadoBooking });
  };

  await historial.ejecutarGuardarHistorial();
  assert.equal(fetchCalls.length, 1);

  historial.cancelarSobrescribirHistorial();
  await historial.confirmarSobrescribirHistorial();

  assert.equal(fetchCalls.length, 1, 'cancelar debe impedir cualquier llamada de sobreescritura — el backend no se modifica');
  console.log('OK: cancelar bookings duplicados no hace ninguna llamada adicional al backend');
}

console.log('\n✓ TODOS LOS CHECKS DE DETECCIÓN DE DUPLICADOS POR BOOKING_ID PASARON');
