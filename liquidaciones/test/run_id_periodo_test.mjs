// Test ad-hoc — bug: run_id se generaba con la fecha de EJECUCIÓN, no con el
// período de la malla. Procesar varias semanas distintas el mismo día
// producía el mismo run_id para todas (ej. LIQ-20260711-v1), disparando
// falsos duplicados en guardarHistorial(). Ahora run_id = LIQ-{fechaMin}-
// {fechaMax}-{version}, usando el rango real de fechas de la malla.
import { strict as assert } from 'node:assert';
import { buildTrumpRows } from '../js/trump.js';

const av = { version: 'v2' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};

function fila(fecha){
  return {
    booking_id:'BK-'+fecha, driver_id:'D-1', piloto:'Piloto Test', ciudad:'BOG', seller:'BOG-X',
    fecha, fecha_malla:fecha, dia_malla:'lunes', hora_inicio:'08:00',
    paquetes_dist:20, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
    garantizado:0, garantizado_tada:null, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
  };
}

// ══════════════════════════════════════════════════════
// CASO 1 — run_id = LIQ-{fechaMinMalla}-{fechaMaxMalla}-{version}
// ══════════════════════════════════════════════════════
{
  const mallaRaw = [{ FECHA:'2026-06-01' }, { FECHA:'2026-06-04' }, { FECHA:'2026-06-07' }];
  const distResult = [fila('2026-06-01'), fila('2026-06-04'), fila('2026-06-07')];
  const { meta, rows } = buildTrumpRows(distResult, t, av, mallaRaw, 'automatico');

  assert.equal(meta.runId, 'LIQ-20260601-20260607-v2', 'run_id debe usar fecha mínima y máxima de la malla, no la fecha de hoy');
  assert.ok(rows.every(r=>r._run_id === 'LIQ-20260601-20260607-v2'), 'todas las filas deben llevar el mismo run_id de período');
  console.log('OK: run_id = LIQ-{fechaMin}-{fechaMax}-{version} usando el rango real de la malla');
}

// ══════════════════════════════════════════════════════
// CASO 2 — dos semanas DISTINTAS procesadas "el mismo día" (misma versión
// de tarifas, misma ejecución) deben producir run_id DISTINTOS
// ══════════════════════════════════════════════════════
{
  const mallaSemana1 = [{ FECHA:'2026-06-01' }, { FECHA:'2026-06-07' }];
  const mallaSemana2 = [{ FECHA:'2026-06-08' }, { FECHA:'2026-06-14' }];
  const dist1 = [fila('2026-06-01'), fila('2026-06-07')];
  const dist2 = [fila('2026-06-08'), fila('2026-06-14')];

  const r1 = buildTrumpRows(dist1, t, av, mallaSemana1, 'automatico');
  const r2 = buildTrumpRows(dist2, t, av, mallaSemana2, 'automatico');

  assert.notEqual(r1.meta.runId, r2.meta.runId, 'semanas distintas procesadas el mismo día NO deben compartir run_id (bug original)');
  assert.equal(r1.meta.runId, 'LIQ-20260601-20260607-v2');
  assert.equal(r2.meta.runId, 'LIQ-20260608-20260614-v2');
  console.log('OK: procesar múltiples semanas el mismo día genera run_id distintos — ya no hay falsos duplicados');
}

// ══════════════════════════════════════════════════════
// CASO 3 — la MISMA semana procesada dos veces (aunque en momentos de
// ejecución distintos) debe seguir dando el MISMO run_id — esto es lo que
// permite que guardarHistorial() detecte el duplicado real correctamente
// ══════════════════════════════════════════════════════
{
  const mallaRaw = [{ FECHA:'2026-06-01' }, { FECHA:'2026-06-07' }];
  const distResult = [fila('2026-06-01'), fila('2026-06-07')];

  const primeraCorrida = buildTrumpRows(distResult, t, av, mallaRaw, 'automatico');
  await new Promise(r=>setTimeout(r, 50)); // simula que pasa tiempo real entre corridas
  const segundaCorrida = buildTrumpRows(distResult, t, av, mallaRaw, 'automatico');

  assert.equal(primeraCorrida.meta.runId, segundaCorrida.meta.runId, 'la misma semana debe producir el mismo run_id sin importar cuándo se ejecute');
  console.log('OK: reprocesar la misma semana da el mismo run_id, incluso en momentos de ejecución distintos');
}

// ══════════════════════════════════════════════════════
// CASO 4 — fallback: malla sin fechas válidas no debe producir un run_id
// malformado (ej. "LIQ--v2")
// ══════════════════════════════════════════════════════
{
  const mallaVacia = [{ FECHA:'' }];
  const distResult = [fila('2026-06-01')];
  const { meta } = buildTrumpRows(distResult, t, av, mallaVacia, 'automatico');

  assert.ok(!meta.runId.includes('LIQ--'), 'sin fechas válidas en la malla, no debe quedar un run_id con huecos vacíos');
  assert.match(meta.runId, /^LIQ-\d{8}-\d{8}-v2$/, 'debe caer al formato con la fecha de hoy como fallback, pero bien formado');
  console.log('OK: malla sin fechas válidas cae a un run_id bien formado (fallback a la fecha de hoy)');
}

// ══════════════════════════════════════════════════════
// CASO 5 — regresión: fechas especiales (pico/super-pico) siguen
// filtrándose correctamente contra el rango de la malla tras mover el
// cálculo de mallaMin/mallaMax antes en la función
// ══════════════════════════════════════════════════════
{
  const mallaRaw = [{ FECHA:'2026-06-01' }, { FECHA:'2026-06-07' }];
  const distResult = [{ ...fila('2026-06-03'), dia_malla:'miercoles' }];
  const tConFechaEspecial = {
    ...t,
    fechas_especiales: JSON.stringify([{ fecha:'2026-06-03', tipo:'pico', tarifa_custom:0 }]),
  };
  const { rows, meta } = buildTrumpRows(distResult, t, av, mallaRaw, 'automatico');
  const { rows: rowsPico } = buildTrumpRows(distResult, tConFechaEspecial, av, mallaRaw, 'automatico');

  assert.equal(meta.mallaMin, '2026-06-01');
  assert.equal(meta.mallaMax, '2026-06-07');
  assert.equal(rows[0]._dia_tipo, 'L-J', 'miércoles sin fecha especial es L-J');
  assert.equal(rowsPico[0]._dia_tipo, 'V-D', 'con fecha especial "pico" dentro del rango de la malla, se trata como V-D');
  console.log('OK: fechasEspMap sigue calculándose correctamente contra mallaMin/mallaMax tras el refactor');
}

console.log('\n✓ TODOS LOS CHECKS DE run_id BASADO EN PERÍODO PASARON');
