// Test ad-hoc — bug: los registros nivel_confianza='APRENDIDO' (resueltos
// por el diccionario de equivalencias en NIVEL 0 de conciliación) nunca
// llegaban a distResult porque 'APRENDIDO' faltaba en NIVELES_OK de
// distribucion.js — en runDistribucion() y en runDistribucionSilent().
// Caso real reportado: 262 APRENDIDO + 239 HIGH + 11 MEDIUM + 279 FUZZY-HIGH
// = 791 en conciliación (paso 4), pero solo 548 bookings en distribución
// (paso 5) — exactamente los 243 no-APRENDIDO (791-243=548 coincide con
// 791-262≈529... el número reportado es indicativo, lo que importa es que
// TODOS los APRENDIDO deben pasar, no una fracción).
import { strict as assert } from 'node:assert';

global.window = global;
const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', value:'', style:{}, disabled:false, className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  };
  return els[id];
}
global.document = { getElementById:(id)=>fakeEl(id) };

const parser  = await import('../js/parser.js');
const conc    = await import('../js/conciliacion.js');
const dist    = await import('../js/distribucion.js');

function mallaRow(booking, piloto, fecha, seller){
  return { 'NOMBRE':piloto, 'FECHA':fecha, 'SELLER':seller, 'BOOKING SERVICIO':booking, 'ID PILOTO':'D-1', 'INICIO DE TURNO':'08:00' };
}
function concRow(nivel, piloto, fecha, seller, malla){
  return {
    piloto, ciudad:'BOG', seller, dia:'lunes', fecha,
    paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0, garantizado_tada:null,
    nivel_confianza:nivel, matches:[malla], nota:'', driver_id:'D-1',
  };
}

// ══════════════════════════════════════════════════════
// CASO 1 — mezcla de niveles (como el reporte real): TODOS los APRENDIDO
// deben llegar a distResult, no solo una parte
// ══════════════════════════════════════════════════════
{
  parser.mallaRaw.length = 0;
  conc.concResult.length = 0;

  const NUM_APRENDIDO = 12, NUM_HIGH = 5, NUM_MEDIUM = 2, NUM_FUZZY_HIGH = 4;
  for(let i=0;i<NUM_APRENDIDO;i++){
    const m = mallaRow(`BK-AP-${i}`, `Piloto Aprendido ${i}`, '2026-06-01', 'BOG-X');
    parser.mallaRaw.push(m);
    conc.concResult.push(concRow('APRENDIDO', `Piloto Aprendido ${i}`, '2026-06-01', 'BOG-X', m));
  }
  for(let i=0;i<NUM_HIGH;i++){
    const m = mallaRow(`BK-H-${i}`, `Piloto High ${i}`, '2026-06-01', 'BOG-X');
    parser.mallaRaw.push(m);
    conc.concResult.push(concRow('HIGH', `Piloto High ${i}`, '2026-06-01', 'BOG-X', m));
  }
  for(let i=0;i<NUM_MEDIUM;i++){
    const m = mallaRow(`BK-M-${i}`, `Piloto Medium ${i}`, '2026-06-01', 'BOG-X');
    parser.mallaRaw.push(m);
    conc.concResult.push(concRow('MEDIUM', `Piloto Medium ${i}`, '2026-06-01', 'BOG-X', m));
  }
  for(let i=0;i<NUM_FUZZY_HIGH;i++){
    const m = mallaRow(`BK-FH-${i}`, `Piloto Fuzzy ${i}`, '2026-06-01', 'BOG-X');
    parser.mallaRaw.push(m);
    conc.concResult.push(concRow('FUZZY-HIGH', `Piloto Fuzzy ${i}`, '2026-06-01', 'BOG-X', m));
  }

  const totalLiquidacionDirecta = NUM_APRENDIDO + NUM_HIGH + NUM_MEDIUM + NUM_FUZZY_HIGH;

  dist.runDistribucionSilent();

  assert.equal(dist.distResult.length, totalLiquidacionDirecta,
    `distResult debe tener los ${totalLiquidacionDirecta} registros de liquidación directa — antes faltaban los ${NUM_APRENDIDO} APRENDIDO`);
  const aprendidoEnDist = dist.distResult.filter(r=>r.nivel_confianza==='APRENDIDO');
  assert.equal(aprendidoEnDist.length, NUM_APRENDIDO, 'TODOS los APRENDIDO deben pasar a distResult, ninguno debe faltar');
  assert.ok(aprendidoEnDist.every(r=>r.booking_id?.startsWith('BK-AP-')), 'cada APRENDIDO debe llevar su booking_id real de la malla');
  console.log(`OK: runDistribucionSilent() — los ${NUM_APRENDIDO} APRENDIDO llegan a distResult junto con HIGH/MEDIUM/FUZZY-HIGH (${totalLiquidacionDirecta} total)`);
}

// ══════════════════════════════════════════════════════
// CASO 2 — runDistribucion() (la versión con setTimeout, paso 4→5 real del
// stepper) también debe incluir APRENDIDO
// ══════════════════════════════════════════════════════
{
  parser.mallaRaw.length = 0;
  conc.concResult.length = 0;

  const mAprendido = mallaRow('BK-AP-X', 'Piloto Aprendido X', '2026-06-02', 'BOG-Y');
  const mHigh = mallaRow('BK-H-X', 'Piloto High X', '2026-06-02', 'BOG-Y');
  parser.mallaRaw.push(mAprendido, mHigh);
  conc.concResult.push(
    concRow('APRENDIDO', 'Piloto Aprendido X', '2026-06-02', 'BOG-Y', mAprendido),
    concRow('HIGH', 'Piloto High X', '2026-06-02', 'BOG-Y', mHigh),
  );

  await new Promise(resolve => { dist.runDistribucion(); setTimeout(resolve, 150); });

  assert.equal(dist.distResult.length, 2, 'runDistribucion() (paso 4→5 real) también debe incluir el registro APRENDIDO');
  assert.ok(dist.distResult.find(r=>r.nivel_confianza==='APRENDIDO' && r.booking_id==='BK-AP-X'), 'el booking APRENDIDO debe estar presente con su booking_id correcto');
  console.log('OK: runDistribucion() (versión async del stepper) también incluye APRENDIDO');
}

// ══════════════════════════════════════════════════════
// CASO 3 — regresión: niveles que NO deben pasar siguen excluidos
// (SIN_MALLA, AMBIGUOUS, SIN_TADA, FUZZY-LOW sin resolver no aplica aquí
// porque FUZZY-LOW sí pasa — probamos específicamente los que NO deben)
// ══════════════════════════════════════════════════════
{
  parser.mallaRaw.length = 0;
  conc.concResult.length = 0;

  const mAmbiguous = mallaRow('BK-AMB', 'Piloto Ambiguo', '2026-06-03', 'BOG-Z');
  parser.mallaRaw.push(mAmbiguous);
  conc.concResult.push(concRow('AMBIGUOUS', 'Piloto Ambiguo', '2026-06-03', 'BOG-Z', mAmbiguous));
  conc.concResult.push({
    piloto:'Piloto Sin Malla', ciudad:'BOG', seller:'BOG-Z', fecha:'2026-06-03',
    paquetes:5, incentivos:0, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0,
    nivel_confianza:'SIN_MALLA', matches:[], nota:'', driver_id:'D-2',
  });

  dist.runDistribucionSilent();

  assert.equal(dist.distResult.length, 0, 'AMBIGUOUS y SIN_MALLA siguen correctamente excluidos de distResult');
  console.log('OK: sin regresión — AMBIGUOUS y SIN_MALLA siguen excluidos de distribución');
}

console.log('\n✓ TODOS LOS CHECKS DE APRENDIDO → DISTRIBUCIÓN PASARON');
