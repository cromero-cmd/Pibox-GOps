// Test ad-hoc: valida que buildTrumpRows() (extracción pura de trump.js)
// reproduce la aritmética financiera esperada (garantizado, % Cali, etc.)
import { strict as assert } from 'node:assert';
import { buildTrumpRows } from '../js/trump.js';

const av = { version: 'v1' };
const t = {
  c_paquete:8870, c_incentivo:1580, c_cancelado:8505, c_tarea:6075,
  c_gar_lj:85050, c_gar_vd:97200,
  p_paquete:7300, p_incentivo:1300, p_cancelado:7000, p_tarea:5000,
  p_min_lj:70000, p_min_vd:80000,
  pct_plataforma:15, pct_margen:3, pct_plataforma_cal:10, pct_margen_cal:7,
  fechas_especiales:'[]',
};
const mallaRaw = [{ FECHA:'2026-06-15' }]; // lunes 15 jun 2026 → L-J

// Caso 1: bajo el mínimo L-J nacional → debe aplicar garantizado
const distResult = [{
  booking_id:'BK001', driver_id:'D1', piloto:'Test Piloto', ciudad:'BOG', seller:'BOG-X',
  fecha:'2026-06-15', fecha_malla:'2026-06-15', dia_malla:'lunes', hora_inicio:'08:00',
  paquetes_dist:2, incentivos_dist:0, cancelados_dist:0, tareas_dist:0,
  garantizado:0, bonos:0, ajustes:0, nivel_confianza:'HIGH', n_bookings:1,
}];

const { rows } = buildTrumpRows(distResult, t, av, mallaRaw);
assert.equal(rows.length, 1);
const r = rows[0];

const ingresoNeto = 2*7300; // 14600
assert.equal(r._ingreso_neto, ingresoNeto);
assert.ok(ingresoNeto < 70000, 'debe estar bajo el mínimo L-J para activar garantizado');
assert.equal(r._complemento, 70000 - ingresoNeto, 'complemento = mínimo - ingreso neto');
assert.equal(r.COMPANY_FINAL_COST, 85050, 'garantizado L-J nacional de cobro');
assert.equal(r.FINAL_COST, Math.floor(85050*0.97), 'FINAL_COST = COMPANY*(1-margen)');
console.log('OK: caso 1 (garantizado L-J nacional) — montos correctos');

// Caso 2: ciudad Cali → debe usar % distintos (10/7 en vez de 15/3)
const distCali = [{...distResult[0], ciudad:'CAL', paquetes_dist:20}]; // por encima del mínimo
const { rows: rowsCali } = buildTrumpRows(distCali, t, av, mallaRaw);
const rc = rowsCali[0];
const cobroOp = 20*8870;
assert.equal(rc.COMPANY_FINAL_COST, cobroOp, 'sin garantizado (supera el mínimo)');
assert.equal(rc.FINAL_COST, Math.floor(cobroOp*0.93), 'Cali usa margen 7% (0.93), no 3%');
console.log('OK: caso 2 (Cali usa % distintos) — montos correctos');

console.log('\n✓ TODOS LOS CHECKS DE buildTrumpRows PASARON');
