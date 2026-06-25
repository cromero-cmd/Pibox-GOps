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
// 2 — Sección de diferencias: TADA > malla
// ═══════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'X', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-1', 'ID PILOTO':'D-1' });
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-20', paquetes:5, incentivos:0, cancelados:0 });
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-21', paquetes:3, incentivos:0, cancelados:0 }); // mismo piloto, otro día

conciliacion.renderConcStats();
let diffHtml = els['stats-conc'].innerHTML;
assert.ok(diffHtml.includes('2 filas TADA procesadas · 1 bookings en malla · 1 filas sin booking correspondiente'),
  `debe mostrar los números correctos (TADA>malla) — actual: ${diffHtml}`);
assert.ok(diffHtml.includes('actividad en varios días'),
  'debe explicar que un piloto puede tener actividad en varios días sin booking propio para cada uno');
console.log('OK: explicación correcta cuando hay más filas TADA con actividad que bookings en malla');

// ═══════════════════════════════════════════
// 3 — Sección de diferencias: TADA < malla
// ═══════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'X', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-1', 'ID PILOTO':'D-1' });
parser.mallaRaw.push({ 'NOMBRE':'Y', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-2', 'ID PILOTO':'D-2' });
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-20', paquetes:5, incentivos:0, cancelados:0 });

conciliacion.renderConcStats();
diffHtml = els['stats-conc'].innerHTML;
assert.ok(diffHtml.includes('1 filas TADA procesadas · 2 bookings en malla · 1 filas sin booking correspondiente'),
  `debe mostrar los números correctos (TADA<malla) — actual: ${diffHtml}`);
assert.ok(diffHtml.includes('SIN_TADA'),
  'debe explicar que hay bookings en malla sin actividad reportada en TADA (SIN_TADA)');
console.log('OK: explicación correcta cuando hay más bookings en malla que filas TADA con actividad');

// ═══════════════════════════════════════════
// 4 — Sección de diferencias: TADA === malla
// ═══════════════════════════════════════════
parser.mallaRaw.length = 0;
parser.mallaRaw.push({ 'NOMBRE':'X', 'FECHA':'2026-06-20', 'SELLER':'S', 'BOOKING SERVICIO':'BK-1', 'ID PILOTO':'D-1' });
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push({ piloto:'X', fecha:'2026-06-20', paquetes:5, incentivos:0, cancelados:0 });

conciliacion.renderConcStats();
diffHtml = els['stats-conc'].innerHTML;
assert.ok(diffHtml.includes('1 filas TADA procesadas · 1 bookings en malla · 0 filas sin booking correspondiente'),
  `debe mostrar los números correctos (iguales) — actual: ${diffHtml}`);
assert.ok(diffHtml.includes('✓ Todos los bookings de la malla tienen correspondencia en TADA'),
  'debe mostrar el mensaje de confirmación cuando los totales coinciden');
console.log('OK: mensaje de confirmación correcto cuando TADA y malla coinciden exactamente');

console.log('\n✓ TODOS LOS CHECKS DE LOS GRUPOS DE CONCILIACIÓN CON TOTALES PASARON');
