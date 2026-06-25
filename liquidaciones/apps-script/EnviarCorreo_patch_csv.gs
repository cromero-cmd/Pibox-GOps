/**
 * ═══════════════════════════════════════════
 * PATCH — enviarCorreo(): adjunto CSV en vez de XLSX
 * ═══════════════════════════════════════════
 *
 * No tengo acceso a tu proyecto de Apps Script desde esta sesión (vive en
 * script.google.com, fuera de este repositorio) — este archivo NO es una
 * función completa para pegar tal cual; es el patch puntual que debes
 * aplicar dentro de tu enviarCorreo() YA EXISTENTE.
 *
 * El frontend (js/email.js) ahora envía nombreArchivo terminado en ".csv"
 * en vez de ".xlsx", y archivoBase64 contiene el CSV codificado en UTF-8
 * (no un .xlsx binario). El único cambio necesario en Apps Script es cómo
 * se construye el Blob a partir de esos bytes — el resto de enviarCorreo()
 * (envío del correo, destinatarios, resumen, etc.) no cambia.
 *
 * Busca dentro de tu función enviarCorreo() la línea:
 *
 *   const blob = Utilities.newBlob(bytes,
 *     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 *     nombreArchivo);
 *
 * Y reemplázala por:
 *
 *   const mimeType = nombreArchivo.endsWith('.csv')
 *     ? 'text/csv'
 *     : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 *   const blob = Utilities.newBlob(bytes, mimeType, nombreArchivo);
 *
 * Esto mantiene compatibilidad retroactiva: si algún día se vuelve a enviar
 * un .xlsx (nombreArchivo no termina en .csv), el blob sigue usando el
 * MimeType de Excel; si termina en .csv (el caso nuevo, siempre a partir de
 * ahora), usa text/csv. No se requiere ningún otro cambio — Utilities.base64Decode
 * ya decodifica correctamente bytes UTF-8 de un CSV igual que lo hacía con
 * el binario del XLSX.
 */
