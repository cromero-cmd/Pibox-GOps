// Test ad-hoc — el adjunto del correo (enviarPorCorreo) debe enviarse como
// CSV de la hoja "Template Trump" únicamente, en vez de XLSX completo.
// El botón de descarga local (downloadTrump, no tocado en este cambio) y
// las demás hojas (Inconsistencias/Auditoria) ya no se generan para el
// correo — solo importan al archivo .xlsx que arma downloadTrump().
import { strict as assert } from 'node:assert';

// Stub mínimo de SheetJS — solo json_to_sheet + sheet_to_csv, lo único que
// usa enviarPorCorreo(). Evita depender del paquete npm real "xlsx" (no es
// parte de la convención de este test suite: ningún otro test requiere
// `npm install` previo, todos son autocontenidos) mientras reproduce el
// comportamiento real que importa aquí: encabezado = claves del primer
// objeto en su orden de inserción, separador configurable, sin BOM.
function csvEscape(v){
  const s = v==null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
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
    innerHTML:'', textContent:'', value:'', style:{}, disabled:false,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];},
  };
  return els[id];
}
global.document = { getElementById: (id) => fakeEl(id) };
global.XLSX = {
  utils: {
    json_to_sheet(rows){ return { __rows: rows }; },
    sheet_to_csv(sheet, opts={}){
      const FS = opts.FS || ',', RS = opts.RS || '\n';
      const rows = sheet.__rows;
      if(!rows.length) return '';
      const headers = Object.keys(rows[0]);
      const lines = [headers.join(FS), ...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(FS))];
      return lines.join(RS) + RS;
    },
  },
};

let fetchCalls = [];
global.fetch = (url, opts) => { fetchCalls.push({url, opts}); return Promise.resolve({}); };

const parser   = await import('../js/parser.js');
const tariffs   = await import('../js/tariffs.js');
const trumpMod  = await import('../js/trump.js');
const emailMod  = await import('../js/email.js');

tariffs.initTariffs();
parser.mallaRaw.length = 0; // sin malla — calcularPeriodoMalla() debe degradar con gracia

trumpMod.trumpRows.length = 0;
trumpMod.trumpRows.push(
  { _run_id:'LIQ-2026-06-25', BOOKING_ID:'BK-001', COMPANY_FINAL_COST:50000, ADDITIONAL_COMPANY_FINAL_COST:0,
    FINAL_COST:40000, ADDITIONAL_FINAL_COST:0, PACKAGES_COUNT:10, COMMENTS_PILOTO:'Pago normal' },
  { _run_id:'LIQ-2026-06-25', BOOKING_ID:'BK-002', COMPANY_FINAL_COST:30000, ADDITIONAL_COMPANY_FINAL_COST:5000,
    FINAL_COST:25000, ADDITIONAL_FINAL_COST:0, PACKAGES_COUNT:6,  COMMENTS_PILOTO:'Incluye bonificación' },
);

fakeEl('envio-url').value = 'https://script.google.com/macros/s/FAKE/exec';
fakeEl('envio-apikey').value = 'pibox-liq-2026-9605';
fakeEl('envio-analista').value = 'Camilo Romero';
fakeEl('envio-email-analista').value = 'cromero@pibox.app';
fakeEl('envio-extra').value = '';

await emailMod.enviarPorCorreo();

const postCall = fetchCalls.find(c=>c.opts?.method==='POST');
assert.ok(postCall, 'enviarPorCorreo() debe hacer un POST al backend');
const bodyStr = decodeURIComponent(postCall.opts.body.replace(/^payload=/, ''));
const enviado = JSON.parse(bodyStr);

// 1 — nombre de archivo .csv, no .xlsx
assert.equal(enviado.nombreArchivo, 'LIQ-2026-06-25.csv', 'el nombre de archivo debe terminar en .csv');
console.log('OK: nombreArchivo cambia de .xlsx a .csv');

// 2 — el contenido base64 decodifica a un CSV de la hoja Template Trump,
// con exactamente las mismas columnas que tiene hoy esa hoja.
const csvText = Buffer.from(enviado.archivoBase64, 'base64').toString('utf-8');
const lineas = csvText.trim().split('\n');
assert.equal(lineas[0], 'BOOKING_ID,COMPANY_FINAL_COST,ADDITIONAL_COMPANY_FINAL_COST,DISPUTED_COMPANY_FINAL_COST,FINAL_COST,ADDITIONAL_FINAL_COST,DISPUTED_FINAL_COST,PACKAGES_COUNT,IS_PER_HOUR,COMMENTS',
  `el encabezado del CSV debe tener exactamente las columnas de Template Trump — actual: ${lineas[0]}`);
assert.equal(lineas.length, 3, 'debe tener 1 línea de encabezado + 1 línea por cada trumpRow (2 filas)');
assert.ok(lineas[1].startsWith('BK-001,50000,0,,40000,0,,10,0,Pago normal'), `fila 1 inesperada: ${lineas[1]}`);
assert.ok(lineas[2].includes('BK-002') && lineas[2].includes('Incluye bonificación'), `fila 2 inesperada: ${lineas[2]}`);
console.log('OK: el CSV decodificado tiene exactamente las columnas y filas de la hoja Template Trump');

// 3 — separador coma, sin BOM
assert.ok(!csvText.startsWith('﻿'), 'el CSV no debe tener BOM al inicio');
assert.ok(lineas[0].includes(','), 'el separador debe ser coma');
console.log('OK: CSV sin BOM, separado por comas');

// 4 — acentos/ñ en COMMENTS sobreviven la codificación UTF-8 sin romper btoa()
parser.mallaRaw.length = 0;
trumpMod.trumpRows.length = 0;
trumpMod.trumpRows.push(
  { _run_id:'LIQ-TILDE', BOOKING_ID:'BK-003', COMPANY_FINAL_COST:10000, ADDITIONAL_COMPANY_FINAL_COST:0,
    FINAL_COST:8000, ADDITIONAL_FINAL_COST:0, PACKAGES_COUNT:3, COMMENTS_PILOTO:'Bonificación día festivo — Núñez' },
);
fetchCalls = [];
await emailMod.enviarPorCorreo();
const postCall2 = fetchCalls.find(c=>c.opts?.method==='POST');
const enviado2 = JSON.parse(decodeURIComponent(postCall2.opts.body.replace(/^payload=/, '')));
const csvText2 = Buffer.from(enviado2.archivoBase64, 'base64').toString('utf-8');
assert.ok(csvText2.includes('Bonificación día festivo — Núñez'),
  `los acentos/ñ deben sobrevivir la codificación UTF-8 — actual: ${csvText2}`);
console.log('OK: tildes/ñ en COMMENTS se codifican correctamente en UTF-8 sin romper btoa()');

console.log('\n✓ TODOS LOS CHECKS DEL ADJUNTO CSV DEL CORREO PASARON');
