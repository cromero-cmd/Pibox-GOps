/**
 * ═══════════════════════════════════════════
 * PATCH — nueva acción 'sobreescribirHistorial' en doPost()
 * ═══════════════════════════════════════════
 *
 * No tengo acceso a tu proyecto de Apps Script desde esta sesión (vive en
 * script.google.com, fuera de este repositorio) — este archivo NO reemplaza
 * tu guardarHistorial() existente; es una función nueva que se agrega junto
 * a la que ya tienes.
 *
 * Contexto: hoy guardarHistorial() ya rechaza un run_id repetido con
 *   {ok:false, error:"El run X ya fue guardado."}
 * El frontend (js/historial.js) detecta ese mensaje y, si el usuario
 * confirma el reemplazo en un modal, hace una SEGUNDA llamada con:
 *   {accion:'sobreescribirHistorial', apiKey, runId, periodo, registros, guardadoPor}
 * donde "registros" es el mismo array de arrays posicionales de 29 columnas
 * que ya usa guardarHistorial() (ver HEADERS más abajo).
 *
 * Pasos:
 *   1. Ajusta las 3 líneas marcadas "AJUSTA ESTO" abajo para que apunten a
 *      las MISMAS constantes/funciones que ya usa tu guardarHistorial()
 *      existente (mismo spreadsheet, misma hoja, misma constante de apiKey).
 *      Si esos nombres no existen como funciones reusables en tu proyecto
 *      (por ejemplo si guardarHistorial() abre el spreadsheet inline en vez
 *      de via un helper), reemplaza esas 3 líneas por el equivalente directo
 *      que ya usas ahí (mismo ss = SpreadsheetApp.openById(...), mismo
 *      getSheetByName(...)).
 *   2. Pega esta función completa en un archivo .gs de tu proyecto (puede
 *      ser el mismo donde vive guardarHistorial()).
 *   3. En tu doPost(e), junto a la línea existente:
 *        if(data.accion === 'guardarHistorial')  return guardarHistorial(data);
 *      agrega:
 *        if(data.accion === 'sobreescribirHistorial') return sobreescribirHistorial(data);
 *   4. Implementa → Administrar implementaciones → edita la implementación
 *      activa para que tome esta nueva versión (la URL /exec no cambia).
 *
 * Comportamiento:
 *   1. Verifica apiKey.
 *   2. Bajo LockService (igual que guardarHistorial()) para evitar carreras
 *      si dos personas reemplazan el mismo run a la vez.
 *   3. Lee todas las filas, elimina (de abajo hacia arriba, para no romper
 *      los índices mientras borra) toda fila cuya columna A === runId.
 *   4. Agrega los nuevos registros al final.
 *   5. Retorna {ok:true, mensaje:"Run X reemplazado. N registros anteriores
 *      eliminados, M nuevos registros guardados."}
 */

function sobreescribirHistorial(data){
  // AJUSTA ESTO — debe ser la misma constante de apiKey que ya valida tu guardarHistorial()
  const API_KEY_HISTORIAL = 'pibox-liq-2026-9605';
  if(data.apiKey !== API_KEY_HISTORIAL){
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'apiKey inválida' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if(!data.runId || !Array.isArray(data.registros) || !data.registros.length){
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'runId y registros son requeridos' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    // AJUSTA ESTO — mismo spreadsheet/hoja que usa guardarHistorial()
    const ss   = SpreadsheetApp.openById('TU_SPREADSHEET_ID_DE_HISTORIAL');
    const hoja = ss.getSheetByName('Historial'); // AJUSTA ESTO — nombre real de tu hoja

    const filas = hoja.getDataRange().getValues();
    const runId = String(data.runId);

    // Eliminar de abajo hacia arriba: borrar una fila por índice desde el
    // final evita que los índices de las filas restantes se desplacen
    // mientras se sigue iterando.
    let eliminados = 0;
    for(let i = filas.length - 1; i >= 1; i--){ // i=0 es la fila de HEADERS
      if(String(filas[i][0]) === runId){
        hoja.deleteRow(i + 1); // +1: las filas de Sheets son 1-indexed
        eliminados++;
      }
    }

    data.registros.forEach(fila => hoja.appendRow(fila));

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      mensaje: `Run ${runId} reemplazado. ${eliminados} registros anteriores eliminados, ${data.registros.length} nuevos registros guardados.`,
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
