// Test ad-hoc — tarjetas de conciliación reorganizadas en dos grupos con
// totales (Liquidación directa / Revisión en Novedades) + sección de
// diferencias (filas TADA con actividad vs. bookings en malla). Cubre:
//   - Totales de cada grupo = suma correcta de sus niveles.
//   - Las tarjetas individuales siguen siendo clickeables (mismo
//     onclick="filterConc(event,'NIVEL')" de siempre) y reflejan selección.
//   - Las 3 variantes de la explicación de diferencias (TADA>malla,
//     TADA<malla, iguales).
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
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
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const conciliacion = await import('../js/conciliacion.js');
const parser        = await import('../js/parser.js');
const normalizer     = await import('../js/normalizer.js');

function setConc(rows){ conciliacion.concResult.length = 0; conciliacion.concResult.push(...rows); }

// ═══════════════════════════════════════════
// 1 — Totales de grupo correctos + botón "Re-aplicar diccionario" no se ve afectado
// (vive en el toolbar, fuera de #stats-conc — no lo tocamos)
// ═══════════════════════════════════════════
setConc([
  { piloto:'A', fecha:'2026-06-20', nivel_confianza:'HIGH',       matches:[], nota:'' },
  { piloto:'B', fecha:'2026-06-20', nivel_confianza:'HIGH',       matches:[], nota:'' },
  { piloto:'C', fecha:'2026-06-20', nivel_confianza:'APRENDIDO',  matches:[], nota:'' },
  { piloto:'D', fecha:'2026-06-20', nivel_confianza:'MEDIUM',     matches:[], nota:'' },
  { piloto:'E', fecha:'2026-06-20', nivel_confianza:'FUZZY-HIGH', matches:[], nota:'' },
  { piloto:'F', fecha:'2026-06-20', nivel_confianza:'FUZZY-LOW',  matches:[], nota:'' },
  { piloto:'G', fecha:'2026-06-20', nivel_confianza:'LOW',        matches:[], nota:'' },
  { piloto:'H', fecha:'2026-06-20', nivel_confianza:'AMBIGUOUS',  matches:[], nota:'' },
  { piloto:'I', fecha:'2026-06-20', nivel_confianza:'SIN_MALLA',  matches:[], nota:'' },
  { piloto:'J', fecha:'2026-06-20', nivel_confianza:'SIN_TADA',   matches:[], nota:'' },
]);
// directa = HIGH(2) + APRENDIDO(1) + MEDIUM(1) + FUZZY-HIGH(1) = 5
// revision = FUZZY-LOW(1) + LOW(1) + AMBIGUOUS(1) + SIN_MALLA(1) + SIN_TADA(1) = 5
parser.mallaRaw.length = 0;
normalizer.tadaNorm.length = 0;

conciliacion.renderConcStats();
const html = els['stats-conc'].innerHTML;

assert.ok(html.includes('Liquidación directa'), 'debe mostrar el título del grupo de liquidación directa');
assert.ok(html.includes('Revisión en Novedades'), 'debe mostrar el título del grupo de revisión');
assert.match(html, /conc-group-total g">5</, 'el total del grupo verde (directa) debe ser 5 (2+1+1+1)');
assert.match(html, /conc-group-total y">5</, 'el total del grupo amarillo (revisión) debe ser 5 (1+1+1+1+1)');
console.log('OK: los totales de cada grupo suman correctamente sus niveles');

// Las tarjetas individuales siguen siendo clickeables con el mismo filterConc(event,'NIVEL')
assert.ok(html.includes(`onclick="filterConc(event,'HIGH')"`), 'HIGH debe seguir siendo clickeable para filtrar');
assert.ok(html.includes(`onclick="filterConc(event,'AMBIGUOUS')"`), 'AMBIGUOUS debe seguir siendo clickeable para filtrar');
assert.ok(html.includes(`onclick="filterConc(event,'SIN_TADA')"`), 'SIN_TADA debe seguir siendo clickeable para filtrar');
console.log('OK: las tarjetas individuales conservan filterConc(event,nivel) para filtrar');

// La selección de filtro (concFilter) sigue reflejándose visualmente
conciliacion.filterConc(null, 'HIGH');
const htmlSel = els['stats-conc'].innerHTML;
assert.match(htmlSel, /stat-sm clickable selected-high.*onclick="filterConc\(event,'HIGH'\)"/,
  'al filtrar por HIGH, su tarjeta debe mostrar la clase selected-high');
conciliacion.filterConc(null, 'HIGH'); // deseleccionar para no afectar los siguientes checks
console.log('OK: el filtro activo (concFilter) sigue reflejándose en las tarjetas individuales');

// ═══════════════════════════════════════════
// 2 — Bug real reportado: el total mostrado no cuadraba porque se usaba
// filasConActividad.length (que excluye los SIN_TADA, filas de la MALLA sin
// actividad en TADA) como si fuera comparable 1:1 contra concResult.length.
// Ahora totalProcesadas = concResult.length = totalDirecta + totalRevision,
// siempre exacto por construcción, y filasConActividad.length solo se usa
// internamente para decidir la nota de SIN_TADA — nunca se muestra como si
// fuera "lo mismo" que totalProcesadas. Caso: ambas notas simultáneas.
// ═══════════════════════════════════════════
setConc([
  { piloto:'A', fecha:'2026-06-20', nivel_confianza:'HIGH',      matches:[], nota:'' },
  { piloto:'B', fecha:'2026-06-20', nivel_confianza:'HIGH',      matches:[], nota:'' },
  { piloto:'C', fecha:'2026-06-20', nivel_confianza:'HIGH',      matches:[], nota:'' },
  { piloto:'D', fecha:'2026-06-20', nivel_confianza:'SIN_MALLA', matches:[], nota:'' },
  { piloto:'E', fecha:'2026-06-20', nivel_confianza:'SIN_TADA',  matches:[], nota:'' },
]);
// totalDirecta=3, totalRevision=2 (SIN_MALLA+SIN_TADA), totalProcesadas=5
parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'X', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-1', 'ID PILOTO':'D-1' });
parser.mallaRaw.push({ 'NOMBRE':'Y', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-2', 'ID PILOTO':'D-2' });
parser.mallaRaw.push({ 'NOMBRE':'Z', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-3', 'ID PILOTO':'D-3' });
// totalMalla=3 (< totalProcesadas=5 → dispara nota SIN_MALLA)
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-20', paquetes:5, incentivos:0, cancelados:0 });
normalizer.tadaNorm.push({ piloto:'Y', fecha:'2026-06-20', paquetes:2, incentivos:0, cancelados:0 });
// filasConActividad.length=2 (< totalMalla=3 → dispara nota SIN_TADA)

conciliacion.renderConcStats();
let diffHtml = els['stats-conc'].innerHTML;
assert.ok(diffHtml.includes('5 filas procesadas · 3 liquidación directa · 2 revisión · 3 bookings en malla'),
  `el resumen debe cuadrar exactamente con los grupos (619+55=674 en el caso real) — actual: ${diffHtml}`);
assert.ok(diffHtml.includes('1 filas de TADA no tienen booking correspondiente en la malla (SIN_MALLA)'),
  'debe mostrar la nota de SIN_MALLA cuando totalProcesadas > bookings en malla');
assert.ok(diffHtml.includes('1 bookings de la malla no tienen actividad reportada en TADA (SIN_TADA)'),
  'debe mostrar la nota de SIN_TADA cuando bookings en malla > filas TADA con actividad');
console.log('OK: el resumen ya no mezcla filasConActividad.length con concResult.length — los números cuadran');
console.log('OK: ambas notas (SIN_MALLA y SIN_TADA) pueden mostrarse simultáneamente');

// ═══════════════════════════════════════════
// 3 — Ninguna de las dos condiciones se cumple → mensaje de confirmación
// ═══════════════════════════════════════════
setConc([
  { piloto:'A', fecha:'2026-06-20', nivel_confianza:'HIGH',      matches:[], nota:'' },
  { piloto:'B', fecha:'2026-06-20', nivel_confianza:'AMBIGUOUS', matches:[], nota:'' },
]);
// totalProcesadas=2
parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'X', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-1', 'ID PILOTO':'D-1' });
parser.mallaRaw.push({ 'NOMBRE':'Y', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-2', 'ID PILOTO':'D-2' });
// totalMalla=2 (no es > totalProcesadas=2 → no dispara SIN_MALLA)
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-20', paquetes:5, incentivos:0, cancelados:0 });
normalizer.tadaNorm.push({ piloto:'Y', fecha:'2026-06-20', paquetes:2, incentivos:0, cancelados:0 });
normalizer.tadaNorm.push({ piloto:'Z', fecha:'2026-06-20', paquetes:1, incentivos:0, cancelados:0 });
// filasConActividad.length=3 (totalMalla=2 no es > 3 → no dispara SIN_TADA)

conciliacion.renderConcStats();
diffHtml = els['stats-conc'].innerHTML;
assert.ok(diffHtml.includes('2 filas procesadas · 1 liquidación directa · 1 revisión · 2 bookings en malla'));
assert.ok(diffHtml.includes('✓ Todas las filas procesadas tienen booking correspondiente y todos los bookings de la malla tienen actividad en TADA'),
  'sin diferencias en ningún sentido, debe mostrar el mensaje de confirmación');
console.log('OK: mensaje de confirmación cuando ninguna de las dos condiciones se cumple');

console.log('\n✓ TODOS LOS CHECKS DE LOS GRUPOS DE CONCILIACIÓN CON TOTALES PASARON');
