/**
 * ═══════════════════════════════════════════
 * DICCIONARIO DE EQUIVALENCIAS — Apps Script backend
 * ═══════════════════════════════════════════
 *
 * No tengo acceso directo a tu proyecto de Apps Script desde esta sesión
 * (vive en script.google.com, fuera de este repositorio) — este archivo es
 * la referencia que debes pegar tú mismo en el editor de tu proyecto ya
 * desplegado en:
 *   https://script.google.com/macros/s/AKfycbwmbBFIA_VbmC8P_W0igDb2tBP0Y9m73h00WGM9DbI-jd9Fd6toHcmRF0YyOOEAioTKYQ/exec
 *
 * Pasos:
 *   1. Abre tu proyecto en script.google.com.
 *   2. Crea un archivo nuevo (ej. "Diccionario.gs") y pega TODO este código.
 *   3. En tu doGet(e) existente, agrega antes del resto de condiciones:
 *        if(e.parameter.accion === 'getDiccionario') return getDiccionario(e);
 *   4. En tu doPost(e) existente — donde ya parseas el payload entrante como
 *      JSON (la misma variable que usas para accion==='saveUsuarios' etc.,
 *      probablemente algo como `var data = JSON.parse(e.parameter.payload);`)
 *      agrega:
 *        if(data.accion === 'saveDiccionario')  return saveDiccionario(data);
 *        if(data.accion === 'incrementarUso')   return incrementarUsoDiccionario(data);
 *   5. Implementa → Administrar implementaciones → edita la implementación
 *      activa para que tome esta nueva versión del código (la URL /exec no
 *      cambia).
 */

const SPREADSHEET_ID_DICCIONARIO = '1z2GL8uhv-atmsWNjdEvckUrnS09X8FEOCWYpDSQ3UoE';
const API_KEY_DICCIONARIO = 'pibox-liq-2026-9605';
const HOJA_DICCIONARIO = 'Diccionario';
const HEADERS_DICCIONARIO = ['tadaNombre', 'mallaNombre', 'fuente', 'fechaAprendido', 'usos'];

function getHojaDiccionario_(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_DICCIONARIO);
  let hoja = ss.getSheetByName(HOJA_DICCIONARIO);
  if(!hoja){
    hoja = ss.insertSheet(HOJA_DICCIONARIO);
    hoja.appendRow(HEADERS_DICCIONARIO);
  }
  return hoja;
}

function jsonOutputDiccionario_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET ?accion=getDiccionario&apiKey=... ──
function getDiccionario(e){
  if(e.parameter.apiKey !== API_KEY_DICCIONARIO){
    return jsonOutputDiccionario_({ ok:false, error:'apiKey inválida' });
  }
  const hoja = getHojaDiccionario_();
  const filas = hoja.getDataRange().getValues();
  const entradas = [];
  for(let i = 1; i < filas.length; i++){
    const tadaNombre = filas[i][0];
    if(!tadaNombre) continue;
    entradas.push({
      tadaNombre:     tadaNombre,
      mallaNombre:    filas[i][1],
      fuente:         filas[i][2],
      fechaAprendido: filas[i][3],
      usos:           Number(filas[i][4]) || 0,
    });
  }
  return jsonOutputDiccionario_({ ok:true, entradas:entradas });
}

// ── POST {accion:'saveDiccionario', apiKey, entrada:{tadaNombre, mallaNombre, fuente, fechaAprendido}} ──
function saveDiccionario(data){
  if(data.apiKey !== API_KEY_DICCIONARIO){
    return jsonOutputDiccionario_({ ok:false, error:'apiKey inválida' });
  }
  const entrada = data.entrada || {};
  if(!entrada.tadaNombre || !entrada.mallaNombre){
    return jsonOutputDiccionario_({ ok:false, error:'tadaNombre y mallaNombre son requeridos' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const hoja = getHojaDiccionario_();
    const filas = hoja.getDataRange().getValues();
    const nTada = String(entrada.tadaNombre).trim().toLowerCase();
    let filaIdx = -1;
    for(let i = 1; i < filas.length; i++){
      if(String(filas[i][0] || '').trim().toLowerCase() === nTada){ filaIdx = i; break; }
    }
    if(filaIdx >= 0){
      // Fila existente — actualizar mallaNombre, fuente, fechaAprendido. El
      // contador de usos (columna 5) se conserva tal cual estaba.
      hoja.getRange(filaIdx + 1, 2, 1, 3).setValues([[
        entrada.mallaNombre, entrada.fuente || 'auto', entrada.fechaAprendido || '',
      ]]);
    } else {
      hoja.appendRow([entrada.tadaNombre, entrada.mallaNombre, entrada.fuente || 'auto', entrada.fechaAprendido || '', 0]);
    }
    return jsonOutputDiccionario_({ ok:true });
  } finally {
    lock.releaseLock();
  }
}

// ── (Opcional) POST {accion:'incrementarUso', apiKey, tadaNombre} ──
function incrementarUsoDiccionario(data){
  if(data.apiKey !== API_KEY_DICCIONARIO){
    return jsonOutputDiccionario_({ ok:false, error:'apiKey inválida' });
  }
  if(!data.tadaNombre){
    return jsonOutputDiccionario_({ ok:false, error:'tadaNombre es requerido' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const hoja = getHojaDiccionario_();
    const filas = hoja.getDataRange().getValues();
    const nTada = String(data.tadaNombre).trim().toLowerCase();
    for(let i = 1; i < filas.length; i++){
      if(String(filas[i][0] || '').trim().toLowerCase() === nTada){
        const usosActual = Number(filas[i][4]) || 0;
        hoja.getRange(i + 1, 5).setValue(usosActual + 1);
        return jsonOutputDiccionario_({ ok:true });
      }
    }
    return jsonOutputDiccionario_({ ok:false, error:'no se encontró la entrada' });
  } finally {
    lock.releaseLock();
  }
}
