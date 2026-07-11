// ═══════════════════════════════════════════
// VERSION CHECK — recarga automática cuando hay una versión nueva desplegada
// ═══════════════════════════════════════════
// Los módulos ES quedan en memoria mientras la pestaña esté abierta — ningún
// mecanismo de invalidación de caché (headers HTTP, Service Worker, import
// maps) puede alcanzar código que ya está cargado y ejecutándose. La única
// forma de que una pestaña abierta reciba una versión nueva es que ELLA
// MISMA detecte el cambio y se recargue: location.reload() reinicia el
// motor JS por completo, forzando un fetch fresco de todo el grafo de
// módulos (ver evaluación de opciones en el commit que introduce este archivo).
import { toast } from './ui.js';

const VERSION_URL = 'version.json';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const RELOAD_DELAY_MS = 4000; // aviso breve antes de recargar — evita perder trabajo en curso sin avisar

let initialVersion = null;
let intervalId = null;

async function fetchVersion(){
  // Cache-busting explícito con query param + cache:'no-store' — sin esto el
  // fetch podría servirse del caché HTTP de GitHub Pages (max-age=600) y
  // nunca detectar el cambio real dentro de esa ventana de 10 minutos.
  const resp = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if(!resp.ok) throw new Error(`version.json respondió ${resp.status}`);
  const data = await resp.json();
  return data.version;
}

// Consulta version.json una vez. La primera llamada establece la versión
// base (la que trae la pestaña actual); llamadas siguientes comparan contra
// esa base. Retorna true si detectó una versión nueva (y ya programó el
// reload), false en cualquier otro caso (primera llamada, sin cambios, o
// error de red — nunca debe interrumpir el uso normal de la app).
export async function checkForNewVersion(){
  try{
    const version = await fetchVersion();
    if(initialVersion === null){
      initialVersion = version;
      return false;
    }
    if(version !== initialVersion){
      toast('Nueva versión disponible — recargando...', 'warn');
      setTimeout(()=>{ location.reload(); }, RELOAD_DELAY_MS);
      return true;
    }
    return false;
  }catch(e){
    console.warn('[version-check] no se pudo verificar la versión:', e.message);
    return false;
  }
}

export function startVersionPolling(intervalMs = CHECK_INTERVAL_MS){
  checkForNewVersion(); // establece la versión base inmediatamente al cargar
  if(intervalId) clearInterval(intervalId);
  intervalId = setInterval(checkForNewVersion, intervalMs);
  return intervalId;
}

export function stopVersionPolling(){
  if(intervalId){ clearInterval(intervalId); intervalId = null; }
}

// Solo para tests — resetea el estado interno del módulo entre corridas.
export function _resetForTests(){
  initialVersion = null;
  if(intervalId){ clearInterval(intervalId); intervalId = null; }
}
