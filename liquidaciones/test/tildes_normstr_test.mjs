// Test ad-hoc — verifica con los 3 casos reportados que normStr() ignora
// tildes consistentemente en TODOS los puntos de comparación de
// runConciliacion() (construcción de idx3/idx2/idxF y búsqueda en ellos).
//
// Contexto: se reportó que estos pilotos resultaban SIN_TADA en producción
// pese a que TADA y malla solo difieren en tildes. Se reprodujo el pipeline
// completo (parser → normalizer → conciliacion) contra los archivos Excel
// reales (Malla Pipeline 2 (2).xlsx + Tabla TaDa.xlsx) y los 3 casos
// resultaron HIGH — el bug no es reproducible con esos datos. Este test fija
// ese comportamiento con datos sintéticos equivalentes para que quede como
// regresión permanente sin commitear nombres/booking IDs reales al repo.
import { strict as assert } from 'node:assert';

global.window = global;
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const fakeEl = {
  innerHTML:'', textContent:'', style:{},
  classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  querySelector(){return null;}, querySelectorAll(){return [];},
};
global.document = { getElementById: () => fakeEl };
global.fetch = () => Promise.reject(new Error('sin red en este test'));

const parser      = await import('../js/parser.js');
const normalizer   = await import('../js/normalizer.js');
const conciliacion = await import('../js/conciliacion.js');

// Malla con tildes en un caso, sin tildes en otro — exactamente los 3 pares
// reportados (TADA con tilde vs malla sin tilde, igual que en producción).
parser.mallaRaw.length = 0;
parser.mallaRaw.push(
  { 'NOMBRE DE PILOTO':'Yoverty Matta Sanchez',          'FECHA':'2026-06-16', 'SELLER':'CAL-X', 'BOOKING SERVICIO':'bk-1', 'ID PILOTO':'D-1' },
  { 'NOMBRE DE PILOTO':'Erick Santiago Suarez Suarez',   'FECHA':'2026-06-15', 'SELLER':'BOG-X', 'BOOKING SERVICIO':'bk-2', 'ID PILOTO':'D-2' },
  { 'NOMBRE DE PILOTO':'Maria Cristina Sanchez Diaz',    'FECHA':'2026-06-19', 'SELLER':'BOG-Y', 'BOOKING SERVICIO':'bk-3', 'ID PILOTO':'D-3' },
);

// tadaNorm normalmente lo produce runNorm() a partir del Excel TADA — aquí
// se inyecta directamente (ya con tildes, como llega en el reporte real)
// porque lo que se está probando es runConciliacion(), no el parsing previo.
normalizer.tadaNorm.length = 0;
normalizer.tadaNorm.push(
  { piloto:'Yoverty Matta Sánchez',        ciudad:'CAL', seller:'CAL-X', dia:'martes',  fecha:'2026-06-16', paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 },
  { piloto:'Erick Santiago Suárez Suárez', ciudad:'BOG', seller:'BOG-X', dia:'lunes',   fecha:'2026-06-15', paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 },
  { piloto:'Maria Cristina Sánchez Díaz',  ciudad:'BOG', seller:'BOG-Y', dia:'viernes', fecha:'2026-06-19', paquetes:5, incentivos:1, cancelados:0, tareas:0, garantizado:0, bonos:0, ajustes:0 },
);

await new Promise(resolve => { conciliacion.runConciliacion(); setTimeout(resolve, 200); });

const casos = [
  ['Yoverty Matta Sánchez', '2026-06-16'],
  ['Erick Santiago Suárez Suárez', '2026-06-15'],
  ['Maria Cristina Sánchez Díaz', '2026-06-19'],
];

for(const [piloto, fecha] of casos){
  const r = conciliacion.concResult.find(x => x.piloto === piloto && x.fecha === fecha);
  assert.ok(r, `debe existir un resultado de conciliación para "${piloto}"`);
  assert.ok(['HIGH','FUZZY-HIGH'].includes(r.nivel_confianza),
    `"${piloto}" debe ser HIGH o FUZZY-HIGH (fue: ${r.nivel_confianza}) — normStr() debe ignorar la diferencia de tildes`);
  console.log(`OK: "${piloto}" → ${r.nivel_confianza} (esperado HIGH/FUZZY-HIGH)`);
}

console.log('\n✓ TODOS LOS CHECKS DE NORMALIZACIÓN DE TILDES PASARON');
