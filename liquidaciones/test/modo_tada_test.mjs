// Test ad-hoc — feature "Modo TaDa" para la columna "Garantizado Basico".
// Cubre: detección exacta de la columna en buildColMap(), el toggle
// persistente en tariffStore (tariffs.js), y la lógica financiera de
// buildTrumpRows() (reemplazo completo del garantizado automático +
// gross-up nacional/Cali + fallback cuando la columna no viene en TADA).
import { strict as assert } from 'node:assert';

// ── Shims de entorno de navegador (mismo patrón que fechas_especiales_log_test.mjs) ──
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
    innerHTML:'', textContent:'', value:'', style:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id) };

const { buildColMap } = await import('../js/parser.js');
const tariffs = await import('../js/tariffs.js');
const auth    = await import('../js/auth.js');
const { buildTrumpRows } = await import('../js/trump.js');
const { cop } = await import('../js/config.js');

// ══════════════════════════════════════════════════════
// PARTE A — buildColMap(): detección exacta de "Garantizado Basico"
// ══════════════════════════════════════════════════════
{
  // 2 cols fijas (ciudad, piloto) + 21 cols de días (7×3) + 1 col extra
  const h0 = ['','', 'LUNES','LUNES','LUNES', 'MARTES','MARTES','MARTES', 'MIERCOLES','MIERCOLES','MIERCOLES',
              'JUEVES','JUEVES','JUEVES', 'VIERNES','VIERNES','VIERNES', 'SABADO','SABADO','SABADO',
              'DOMINGO','DOMINGO','DOMINGO', ''];
  const h1 = ['','', 'Paquetes','Incentivos','Cancelados', 'Paquetes','Incentivos','Cancelados',
              'Paquetes','Incentivos','Cancelados', 'Paquetes','Incentivos','Cancelados',
              'Paquetes','Incentivos','Cancelados', 'Paquetes','Incentivos','Cancelados',
              'Paquetes','Incentivos','Cancelados', 'Garantizado Basico'];
  const h2 = ['ciudad','piloto', '2026-06-15','2026-06-15','2026-06-15', '2026-06-16','2026-06-16','2026-06-16',
              '2026-06-17','2026-06-17','2026-06-17', '2026-06-18','2026-06-18','2026-06-18',
              '2026-06-19','2026-06-19','2026-06-19', '2026-06-20','2026-06-20','2026-06-20',
              '2026-06-21','2026-06-21','2026-06-21', ''];
  const raw = [h0,h1,h2,['BOG','Piloto Test']];
  const { map, error } = buildColMap(raw);
  assert.equal(error, null, 'no debe haber error de diagnóstico');
  const extra = map.find(c=>c.t==='e' && c.n==='garantizado_tada');
  assert.ok(extra, 'debe detectar "Garantizado Basico" como columna extra garantizado_tada');
  assert.equal(extra.i, 23, 'debe apuntar al índice correcto de la columna');
  console.log('OK: buildColMap() detecta "Garantizado Basico" (nombre exacto) como garantizado_tada');
}

{
  // La columna genérica "Garantizado" (sin "Basico") debe seguir mapeando a
  // 'garantizado' — el nuevo match exacto no debe romper el comportamiento previo.
  const h0 = ['','', 'LUNES','LUNES','LUNES', ''];
  const h1 = ['','', 'Paquetes','Incentivos','Cancelados', 'Garantizado'];
  const h2 = ['ciudad','piloto', '2026-06-15','2026-06-15','2026-06-15', ''];
  // Nota: buildColMap espera 21 columnas de días — este caso usa un raw más
  // corto solo para validar la clasificación de la col extra en aislamiento;
  // se agregan columnas de relleno hasta completar el bloque de 21.
  const fill = Array.from({length:18},()=> '');
  const raw = [
    [...h0.slice(0,5), ...fill, ''],
    [...h1.slice(0,5), ...fill, 'Garantizado'],
    [...h2.slice(0,5), ...fill, ''],
    ['BOG','Piloto Test'],
  ];
  const { map } = buildColMap(raw);
  const extra = map.find(c=>c.t==='e' && c.i===23);
  assert.ok(extra, 'debe seguir detectando la columna extra');
  assert.equal(extra.n, 'garantizado', 'columna "Garantizado" genérica sigue mapeando a garantizado, no a garantizado_tada');
  console.log('OK: "Garantizado" (genérico) no se confunde con "Garantizado Basico"');
}

// ══════════════════════════════════════════════════════
// PARTE B — toggle modo_garantizado en tariffs.js (persistencia + log)
// ══════════════════════════════════════════════════════
auth.setCurrentUser({ username:'cromero', nombre:'Camilo Romero', role:'superadmin' });
tariffs.initTariffs();

assert.equal(tariffs.getModoGarantizado(), 'automatico', 'valor por defecto debe ser automatico');
console.log('OK: getModoGarantizado() default = automatico');

{
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.setModoGarantizado('tada');
  assert.equal(tariffs.getModoGarantizado(), 'tada');
  assert.equal(tariffs.tariffStore.log.length, nAntes+1, 'debe registrar 1 entrada en el log');
  const e = tariffs.tariffStore.log[tariffs.tariffStore.log.length-1];
  assert.equal(e.accion, 'modo_garantizado');
  assert.equal(e.modo, 'tada');
  assert.equal(e.autor, 'Camilo Romero');
  console.log('OK: setModoGarantizado("tada") persiste y loguea el cambio');
}

{
  // Volver a fijar el mismo valor no debe generar una entrada duplicada
  const nAntes = tariffs.tariffStore.log.length;
  tariffs.setModoGarantizado('tada');
  assert.equal(tariffs.tariffStore.log.length, nAntes, 'no debe loguear si el valor no cambia');
  console.log('OK: setModoGarantizado() es idempotente — no duplica el log si el valor no cambia');
}

{
  // Persistencia real: re-cargar tariffStore desde localStorage (simula recarga de página)
  tariffs.setModoGarantizado('tada');
  const raw = JSON.parse(localStorage.getItem('pibox:tariff_v6'));
  assert.equal(raw.modo_garantizado, 'tada', 'modo_garantizado debe persistir en localStorage');
  console.log('OK: modo_garantizado persiste entre sesiones (localStorage)');
}
tariffs.setModoGarantizado('automatico'); // reset para no afectar otros tests si compartieran proceso

// ══════════════════════════════════════════════════════
// PARTE C — buildTrumpRows(): lógica financiera de Modo TaDa
// ══════════════════════════════════════════════════════
const av = { version: 'v1' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};
const mallaRaw = [{ FECHA:'2026-06-15' }];
const baseRow = {
  booking_id:'BK001', driver_id:'D1', piloto:'Test Piloto', ciudad:'BOG', seller:'BOG-X',
  fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
  paquetes_dist:2, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
  garantizado:0, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
};

// C1 — Modo TaDa, ciudad nacional (BOG): COMPANY_FINAL_COST = cobro_operativo + gross-up
// (SUMA, no reemplaza) — caso real: Alberto Jose Chamorro Salas, booking 26 jun (bugfix)
{
  const distResult = [{
    ...baseRow, piloto:'Alberto Jose Chamorro Salas',
    paquetes_dist:6, incentivos_dist:6, cancelados_dist:0, tareas_dist:0,
    garantizado_tada:48400, bonos:66000,
  }];
  const { rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'tada');
  const r = rows[0];
  const cobroOp = 6*8870 + 6*1580; // 62700
  const grossGar = Math.ceil(48400 / (1-0.03) / (1-0.15)); // 58703
  const companyEsperado = cobroOp + grossGar; // SUMA — no MAX/reemplazo
  const finalEsperado = Math.floor(companyEsperado * (1-0.03));
  const addCompanyEsperado = Math.round(66000 / (1-0.03) / (1-0.15)); // sin cambios (solo bono)

  assert.equal(r._modo_garantizado, 'tada');
  assert.equal(r._complemento, 48400, 'pago_garantizado debe ser el valor exacto de la columna TADA');
  assert.equal(r._cobro_garantizado, grossGar, 'cobro_garantizado = gross-up nacional (÷0.97÷0.85)');
  assert.equal(r.COMPANY_FINAL_COST, companyEsperado, 'COMPANY_FINAL_COST = cobro_operativo + gross-up del garantizado');
  assert.equal(r.FINAL_COST, finalEsperado, 'FINAL_COST = floor(COMPANY_FINAL_COST × 0.97)');
  assert.equal(r.ADDITIONAL_COMPANY_FINAL_COST, addCompanyEsperado, 'ADDITIONAL_COMPANY_FINAL_COST sin cambios (solo bono, sin garantizado)');
  assert.equal(r.ADDITIONAL_FINAL_COST, 66000, 'ADDITIONAL_FINAL_COST sin cambios (bono neto)');
  assert.ok(r.COMMENTS.includes(`GarTaDa:${cop(48400)} gross:${cop(grossGar)}`), 'COMMENTS debe incluir el detalle GarTaDa/gross');
  assert.ok(r.COMMENTS_PILOTO.includes(`Garantizado ${Math.round(48400).toLocaleString('es-CO').replace(/[^0-9]/g,'')}`),
    'COMMENTS_PILOTO debe mostrar el complemento real de TADA, no el mínimo automático');
  console.log('OK: Modo TaDa nacional — COMPANY_FINAL_COST/FINAL_COST/ADDITIONAL se suman correctamente (caso real Alberto Chamorro)');
}

// C2 — Modo TaDa, ciudad Cali: gross-up con % de Cali configurados en tarifas (SUMA, no reemplaza)
{
  const distResult = [{ ...baseRow, ciudad:'CAL', garantizado_tada:50000 }];
  const { rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'tada');
  const r = rows[0];
  const cobroOp = 2*8870; // baseRow: paquetes_dist:2
  const grossGar = Math.ceil(50000 / (1-t.pct_margen_cal/100) / (1-t.pct_plataforma_cal/100));
  assert.equal(r._cobro_garantizado, grossGar, 'cobro_garantizado debe usar % de Cali configurados');
  assert.equal(r.COMPANY_FINAL_COST, cobroOp + grossGar, 'COMPANY_FINAL_COST = cobro_operativo + gross-up (Cali)');
  console.log('OK: Modo TaDa Cali — gross-up con % de Cali + suma sobre cobro operativo correcto');
}

// C3 — Modo TaDa con garantizado_tada===null (columna ausente en TADA): NO usar tarifa
// automática — simplemente sin garantizado esa fila (cobro = solo operativo)
{
  const distResult = [{ ...baseRow, garantizado_tada:null }];
  const { rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'tada');
  const r = rows[0];
  assert.equal(r._modo_garantizado, 'tada', 'sigue en modo tada, no cae a automático');
  assert.equal(r._complemento, 0);
  assert.equal(r._cobro_garantizado, 0);
  assert.equal(r.COMPANY_FINAL_COST, 2*8870, 'sin columna TADA, COMPANY_FINAL_COST = solo cobro operativo (nunca la tarifa automática)');
  console.log('OK: Modo TaDa con garantizado_tada=null → cobro = solo operativo, sin usar tarifa automática');
}

// C4 — Modo automático (default): garantizado_tada presente pero se ignora — sin regresión
{
  const distResult = [{ ...baseRow, garantizado_tada:50000 }];
  const { rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'automatico');
  const r = rows[0];
  assert.equal(r._modo_garantizado, 'automatico');
  assert.equal(r.COMPANY_FINAL_COST, 85050, 'en modo automático garantizado_tada no debe afectar el cálculo');
  console.log('OK: Modo automático ignora garantizado_tada — comportamiento idéntico al actual');
}

// C5 — Modo TaDa con garantizado_tada=0 (no hizo falta complemento esa semana)
{
  const distResult = [{ ...baseRow, paquetes_dist:20, garantizado_tada:0 }]; // por encima del mínimo
  const { rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'tada');
  const r = rows[0];
  assert.equal(r._complemento, 0);
  assert.equal(r._cobro_garantizado, 0);
  assert.equal(r.COMPANY_FINAL_COST, 20*8870, 'sin complemento, cobro = solo operativo (cobroOp)');
  console.log('OK: Modo TaDa con garantizado_tada=0 no aplica gross-up ni complemento');
}

console.log('\n✓ TODOS LOS CHECKS DE MODO TADA (GARANTIZADO BASICO) PASARON');
