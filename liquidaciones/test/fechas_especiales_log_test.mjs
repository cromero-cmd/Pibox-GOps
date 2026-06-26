// Test ad-hoc — registro de fechas especiales (Pico/Super pico) en el Log de
// cambios de Tarifas. addFechaEspecial/removeFechaEspecial/updateFechaEspecial
// deben escribir en tariffStore.log[] con accion:'fecha_especial', y
// renderTariffPanel() debe mostrarlas en amarillo con el formato exacto del
// brief, sin afectar el log existente de publicar/activar versión.
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
  if(!els[id]) els[id] = { innerHTML:'', textContent:'', value:'', style:{} };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id) };

const tariffs = await import('../js/tariffs.js');
const auth    = await import('../js/auth.js');

auth.setCurrentUser({ username:'cromero', nombre:'Camilo Romero', role:'superadmin' });
tariffs.initTariffs();

function ultimoLog(){ return tariffs.tariffStore.log[tariffs.tariffStore.log.length-1]; }

// ── addFechaEspecial() ──
{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.addFechaEspecial();
  assert.equal(tariffs.tariffStore.log.length, nAntes+1, 'debe agregar exactamente 1 entrada al log');
  const e = ultimoLog();
  assert.equal(e.accion, 'fecha_especial');
  assert.equal(e.operacion, 'agregar');
  assert.equal(e.tipo, 'pico');
  assert.equal(e.tarifa_custom, 0);
  assert.equal(e.autor, 'Camilo Romero');
  assert.ok(e.timestamp);
  console.log('OK: addFechaEspecial() registra {accion:fecha_especial, operacion:agregar} con autor correcto');
}

// ── updateFechaEspecial() — cambio de fecha (campo no significativo): NO debe loguear ──
{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.updateFechaEspecial(0, 'fecha', '2026-06-15');
  assert.equal(tariffs.tariffStore.log.length, nAntes, 'cambiar el campo fecha no debe generar una entrada de log (evita flood por cada tecla)');
  assert.equal(tariffs.getFechasEspeciales()[0].fecha, '2026-06-15', 'el valor sí debe guardarse, solo no se loguea');
  console.log('OK: updateFechaEspecial() en el campo "fecha" actualiza el valor sin loguear (cambio no significativo)');
}

// ── updateFechaEspecial() — cambio de tipo: SÍ debe loguear con valor_anterior/valor_nuevo ──
{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.updateFechaEspecial(0, 'tipo', 'superpico');
  assert.equal(tariffs.tariffStore.log.length, nAntes+1, 'cambiar el tipo debe loguear');
  const e = ultimoLog();
  assert.equal(e.accion, 'fecha_especial');
  assert.equal(e.operacion, 'modificar');
  assert.equal(e.campo, 'tipo');
  assert.equal(e.valor_anterior, 'pico');
  assert.equal(e.valor_nuevo, 'superpico');
  assert.equal(e.fecha, '2026-06-15');
  console.log('OK: updateFechaEspecial() en "tipo" registra operacion:modificar con valor_anterior/valor_nuevo');
}

// ── updateFechaEspecial() — tarifa_custom cambia en más de 0: SÍ debe loguear ──
{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.updateFechaEspecial(0, 'tarifa_custom', 110000);
  assert.equal(tariffs.tariffStore.log.length, nAntes+1, 'cambiar tarifa_custom (de 0 a 110000) debe loguear');
  const e = ultimoLog();
  assert.equal(e.operacion, 'modificar');
  assert.equal(e.campo, 'tarifa_custom');
  assert.equal(e.valor_anterior, 0);
  assert.equal(e.valor_nuevo, 110000);
  console.log('OK: updateFechaEspecial() en "tarifa_custom" registra el cambio cuando la diferencia es distinta de 0');
}

// ── updateFechaEspecial() — tarifa_custom "cambia" al mismo valor: NO debe loguear ──
{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.updateFechaEspecial(0, 'tarifa_custom', 110000); // mismo valor que ya tenía
  assert.equal(tariffs.tariffStore.log.length, nAntes, 'sin cambio real en tarifa_custom no debe agregar entrada');
  console.log('OK: updateFechaEspecial() no loguea cuando tarifa_custom no cambia realmente');
}

// ── removeFechaEspecial() — debe loguear con los datos de la fecha eliminada ──
{
  const nAntes = tariffs.tariffStore.log.length;
  const feAntesDeEliminar = {...tariffs.getFechasEspeciales()[0]};
  tariffs.removeFechaEspecial(0);
  assert.equal(tariffs.tariffStore.log.length, nAntes+1, 'eliminar debe loguear');
  assert.equal(tariffs.getFechasEspeciales().length, 0);
  const e = ultimoLog();
  assert.equal(e.accion, 'fecha_especial');
  assert.equal(e.operacion, 'eliminar');
  assert.equal(e.fecha, feAntesDeEliminar.fecha);
  assert.equal(e.tipo, feAntesDeEliminar.tipo);
  assert.equal(e.tarifa_custom, feAntesDeEliminar.tarifa_custom);
  console.log('OK: removeFechaEspecial() registra operacion:eliminar con los datos de la fecha que se eliminó');
}

// ── renderTariffPanel() — formato y color amarillo, sin afectar el log de versiones ──
{
  // Entrada controlada de "agregar" con tipo pico
  tariffs.tariffStore.log.push({
    timestamp:new Date().toISOString(), accion:'fecha_especial', operacion:'agregar',
    fecha:'2026-06-20', tipo:'pico', tarifa_custom:0, autor:'Camilo Romero',
  });
  // Entrada controlada de "modificar" tipo, con tarifa
  tariffs.tariffStore.log.push({
    timestamp:new Date().toISOString(), accion:'fecha_especial', operacion:'modificar', campo:'tipo',
    fecha:'2026-06-15', tipo:'superpico', tarifa_custom:110000,
    valor_anterior:'pico', valor_nuevo:'superpico', autor:'Camilo Romero',
  });
  // Entrada de publicación (debe seguir intacta, verde)
  tariffs.tariffStore.log.push({
    timestamp:new Date().toISOString(), accion:'publicar', version:'v2', autor:'Camilo Romero', nota:'', cambios:[],
  });

  tariffs.renderTariffPanel();
  const html = fakeEl('tariff-history').innerHTML;

  assert.ok(html.includes('📅 Agregada fecha especial: 2026-06-20 · Pico (V-D)'), 'formato exacto de "agregar"');
  assert.ok(html.includes('📅 Modificada: 2026-06-15 · Pico → Super pico · Tarifa: $110.000'), 'formato exacto de "modificar" (tipo + tarifa)');
  assert.ok(html.includes('publicó v2'), 'el log de versiones (publicar/activar) sigue intacto');
  console.log('OK: renderTariffPanel() muestra el formato exacto del brief para agregar y modificar fechas especiales');

  // Color amarillo para las entradas de fecha_especial — verde/azul para las de versión
  const idxAgregada  = html.indexOf('Agregada fecha especial');
  const idxModificada= html.indexOf('Modificada:');
  const idxPublico    = html.indexOf('publicó v2');
  const ctxAgregada   = html.slice(Math.max(0,idxAgregada-60), idxAgregada);
  const ctxModificada = html.slice(Math.max(0,idxModificada-60), idxModificada);
  const ctxPublico    = html.slice(Math.max(0,idxPublico-60), idxPublico);
  assert.ok(ctxAgregada.includes('var(--yellow)'), 'la entrada "agregar" debe ir en amarillo');
  assert.ok(ctxModificada.includes('var(--yellow)'), 'la entrada "modificar" debe ir en amarillo');
  assert.ok(ctxPublico.includes('var(--green)'), 'la entrada "publicar" sigue en verde, sin cambios');
  console.log('OK: las entradas de fecha_especial usan var(--yellow); publicar/activar conservan sus colores originales');
}

console.log('\n✓ TODOS LOS CHECKS DEL LOG DE FECHAS ESPECIALES PASARON');
