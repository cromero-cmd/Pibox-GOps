/**
 * ═══════════════════════════════════════════
 * PATCH — detección de duplicados por booking_id en guardarHistorial()
 * ═══════════════════════════════════════════
 *
 * No tengo acceso a tu proyecto de Apps Script desde esta sesión — este
 * archivo NO es una función completa para pegar tal cual; es el bloque
 * puntual que debes insertar AL INICIO de tu guardarHistorial(data)
 * existente, antes de tu verificación actual de run_id duplicado.
 *
 * Motivo: el run_id se genera a partir de la fecha de ejecución, no del
 * período de la liquidación — dos corridas de la MISMA semana producen
 * run_id distintos aunque contengan los mismos bookings. El verdadero
 * identificador de duplicado son los booking_id (columna I, índice 8 — ver
 * HEADERS más abajo), así que esa verificación debe ir primero. La
 * verificación de run_id duplicado que ya tienes se conserva igual, como
 * segundo control (por si dos corridas comparten run_id sin compartir
 * ningún booking, caso raro pero posible si todo el período cambió).
 *
 * HEADERS (orden exacto de columnas en el Sheet — ya usado por
 * ejecutarGuardarHistorial() en el frontend):
 *   0 run_id, 1 periodo, 2 id_piloto, 3 piloto, 4 ciudad, 5 seller, 6 fecha,
 *   7 dia, 8 booking_id, 9 paquetes, 10 incentivos, 11 cancelados,
 *   12 tareas, 13 cobro_paquete, 14 cobro_incentivo, 15 cobro_cancelado,
 *   16 cobro_tarea, 17 cobro_garantizado, 18 cobro_bono, 19 cobro_total,
 *   20 pago_paquete, 21 pago_incentivo, 22 pago_cancelado, 23 pago_tarea,
 *   24 pago_garantizado, 25 pago_bono, 26 pago_piloto, 27 guardado_por,
 *   28 fecha_guardado.
 *
 * Pasos:
 *   1. Dentro de tu guardarHistorial(data), justo después de adquirir el
 *      lock y leer las filas existentes (algo como
 *      `const filas = hoja.getDataRange().getValues();`), e ANTES de tu
 *      chequeo actual de run_id duplicado, pega el bloque "NUEVO CHEQUEO"
 *      de abajo.
 *   2. Ajusta el nombre de la variable que contiene las filas leídas
 *      (`filas` abajo) y la función que arma la respuesta JSON
 *      (`jsonOutputHistorial_` abajo) para que coincidan con los nombres
 *      reales que ya usas en tu guardarHistorial().
 *   3. Implementa → Administrar implementaciones → edita la implementación
 *      activa para tomar esta nueva versión (la URL /exec no cambia).
 *
 * ── NUEVO CHEQUEO (insertar antes de tu verificación de run_id) ──
 *
 *   const COL_RUN_ID = 0, COL_PERIODO = 1, COL_BOOKING_ID = 8,
 *         COL_GUARDADO_POR = 27, COL_FECHA_GUARDADO = 28;
 *
 *   const bookingsNuevos = new Set(
 *     data.registros.map(function(r){ return String(r[COL_BOOKING_ID]); }).filter(Boolean)
 *   );
 *
 *   const bookingsDuplicados = [];
 *   let filaConflicto = null;
 *   for(let i = 1; i < filas.length; i++){ // i=0 es la fila de HEADERS
 *     const bId = String(filas[i][COL_BOOKING_ID]);
 *     if(bId && bookingsNuevos.has(bId)){
 *       bookingsDuplicados.push(bId);
 *       if(!filaConflicto) filaConflicto = filas[i]; // primera fila en conflicto → identifica el run viejo
 *     }
 *   }
 *
 *   if(bookingsDuplicados.length > 0){
 *     const runIdExistente = String(filaConflicto[COL_RUN_ID]);
 *     let totalExistentes = 0;
 *     for(let i = 1; i < filas.length; i++){
 *       if(String(filas[i][COL_RUN_ID]) === runIdExistente) totalExistentes++;
 *     }
 *     return jsonOutputHistorial_({
 *       ok: false,
 *       tipo: 'duplicado_booking',
 *       runIdExistente: runIdExistente,
 *       periodoExistente: String(filaConflicto[COL_PERIODO]),
 *       guardadoPorExistente: String(filaConflicto[COL_GUARDADO_POR]),
 *       fechaGuardadoExistente: Utilities.formatDate(
 *         new Date(filaConflicto[COL_FECHA_GUARDADO]), Session.getScriptTimeZone(), 'd/M/yyyy'
 *       ),
 *       totalExistentes: totalExistentes,
 *       totalNuevos: data.registros.length,
 *       bookingsDuplicados: bookingsDuplicados,
 *       error: bookingsDuplicados.length + ' bookings ya existen en el historial en el run ' + runIdExistente,
 *     });
 *   }
 *
 *   // ── A partir de aquí sigue tu verificación existente de run_id duplicado,
 *   //    sin cambios — queda como segundo control. ──
 *
 * Nota sobre el reemplazo: cuando el frontend confirma el reemplazo, llama
 * a sobreescribirHistorial() pasando runId = runIdExistente (el run viejo
 * que se debe borrar), no el run_id nuevo — esto ya funciona con la función
 * sobreescribirHistorial() del patch anterior (GuardarHistorial_sobrescribir_patch.gs)
 * sin ningún cambio adicional: borra todas las filas con ese run_id viejo y
 * agrega los registros nuevos (que llevan su propio run_id nuevo en la
 * columna 0) — el run viejo queda completamente reemplazado por uno nuevo.
 */
