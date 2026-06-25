// ═══════════════════════════════════════════
// DICCIONARIO DE EQUIVALENCIAS
// Estructura: [{id, tadaNombre, mallaNombre, fechaAprendido, usos, fuente}]
// ═══════════════════════════════════════════
import { LS_DICT, normStr, getBackendUrl } from './config.js';
import { toast, emptyStateHtml, addLog } from './ui.js';

// Claves de storage compartido — no usadas hoy (reservadas para sync futura vía Apps Script),
// se conservan tal cual existían en el archivo original.
const SHARED_DICT_KEY  = 'diccionario_v1';
const SHARED_TARIFF_KEY = 'tariff_v1';

const API_KEY = 'pibox-liq-2026-9605';

export function loadDict(){
  // Primero intentar desde variable en memoria (cargada desde storage compartido)
  if(window._dictCache) return window._dictCache;
  // Fallback a localStorage
  try{ return JSON.parse(localStorage.getItem(LS_DICT)||'[]'); }catch{ return []; }
}
export function saveDict(d){
  window._dictCache = d;
  // Guardar en localStorage como cache local
  try{ localStorage.setItem(LS_DICT, JSON.stringify(d)); }catch{}
  // Guardar en storage compartido
  try{ localStorage.setItem(LS_DICT, JSON.stringify(d)); }catch{}
}

export function syncSharedData(){
  // Por ahora sincroniza desde localStorage — en futuro vía Apps Script
  actualizarDictSummary();
}

export function dictFind(nombreTada){
  // Buscar equivalencia para un nombre TADA
  const dict = loadDict();
  const nTada = normStr(nombreTada);
  return dict.find(e => normStr(e.tadaNombre) === nTada) || null;
}

export function dictSave(tadaNombre, mallaNombre, fuente){
  const dict = loadDict();
  // Clave única: SIEMPRE por tadaNombre. Nunca se busca/compara por
  // mallaNombre — dos pilotos TADA distintos pueden mapear legítimamente
  // al mismo nombre de malla (ej. homónimos) sin que eso cuente como conflicto.
  const nTada = normStr(tadaNombre);
  const idx = dict.findIndex(e => normStr(e.tadaNombre) === nTada);
  const esNueva = idx < 0;
  if(idx >= 0){
    // Actualizar existente — solo mallaNombre/fuente, tadaNombre nunca cambia aquí
    dict[idx].mallaNombre = mallaNombre;
    dict[idx].fuente = fuente;
    dict[idx].fechaActualizado = new Date().toISOString().slice(0,10);
  } else {
    dict.push({
      id: Date.now().toString(),
      tadaNombre, mallaNombre, fuente,
      fechaAprendido: new Date().toISOString().slice(0,10),
      usos: 0,
    });
  }
  saveDict(dict);
  actualizarDictSummary();
  if(esNueva) addLog('log-conc', `[DICT] Aprendido: "${tadaNombre}" → "${mallaNombre}" (${fuente})`, 'ok');

  // Sincronizar al backend compartido (Google Sheets) en segundo plano —
  // fetch no-cors igual que el resto de llamadas al backend (auth.js,
  // email.js): no bloquea el flujo ni espera respuesta. Si falla (sin red,
  // backend caído), el localStorage ya quedó guardado arriba y sigue
  // sirviendo como fuente de verdad local — ningún usuario pierde su trabajo
  // por un fallo de sincronización.
  const entry = idx>=0 ? dict[idx] : dict[dict.length-1];
  syncDictEntryToBackend(entry);
}

function syncDictEntryToBackend(entry){
  const url = getBackendUrl();
  if(!url) return;
  const payload = JSON.stringify({
    apiKey: API_KEY,
    accion: 'saveDiccionario',
    entrada: {
      tadaNombre: entry.tadaNombre,
      mallaNombre: entry.mallaNombre,
      fuente: entry.fuente,
      fechaAprendido: entry.fechaActualizado || entry.fechaAprendido,
    },
  });
  fetch(url,{method:'POST',mode:'no-cors',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'payload='+encodeURIComponent(payload),
  }).catch(()=>{});
}

// ── Descargar el diccionario compartido desde el backend y mezclarlo con el
// local. Sheets tiene prioridad por tadaNombre (refleja lo que aprendieron
// TODOS los usuarios); entradas locales que aún no llegaron al servidor
// (por ejemplo, aprendidas en esta misma sesión justo antes de sincronizar)
// se conservan para no perder trabajo reciente. Si el backend no responde,
// se sigue con el diccionario local tal cual estaba — el pipeline nunca
// queda bloqueado por esto.
export async function syncDiccionarioFromBackend(){
  const local = loadDict();
  const url = getBackendUrl();
  if(!url) return { total: local.length, delServidor: 0, locales: local.length, offline: true };

  try{
    const params = new URLSearchParams({accion:'getDiccionario', apiKey:API_KEY});
    const resp = await fetch(`${url}?${params}`);
    const data = await resp.json();
    if(!data.ok || !Array.isArray(data.entradas)) throw new Error('respuesta inválida del backend');

    const remoto = data.entradas.map(r => ({
      id: r.id || `srv-${normStr(r.tadaNombre)}`,
      tadaNombre: r.tadaNombre,
      mallaNombre: r.mallaNombre,
      fuente: r.fuente || 'auto',
      fechaAprendido: r.fechaAprendido || '',
      usos: Number(r.usos) || 0,
    }));
    const remotoKeys = new Set(remoto.map(e => normStr(e.tadaNombre)));
    const merged = remoto.concat(local.filter(e => !remotoKeys.has(normStr(e.tadaNombre))));

    saveDict(merged);
    actualizarDictSummary();
    return { total: merged.length, delServidor: remoto.length, locales: merged.length - remoto.length };
  }catch{
    return { total: local.length, delServidor: 0, locales: local.length, offline: true };
  }
}

export function dictIncrementarUso(tadaNombre){
  const dict = loadDict();
  const nTada = normStr(tadaNombre);
  const entry = dict.find(e => normStr(e.tadaNombre) === nTada);
  if(entry){ entry.usos = (entry.usos||0) + 1; saveDict(dict); }
}

export function actualizarDictSummary(){
  const n = loadDict().length;
  const el = document.getElementById('dict-summary-label');
  if(el) el.textContent = `Diccionario de equivalencias (${n})`;
}

export function renderDiccionario(){
  const dict = loadDict();
  actualizarDictSummary();
  const lista = document.getElementById('dict-lista');
  if(!lista) return;

  if(dict.length === 0){
    lista.innerHTML = emptyStateHtml('Sin equivalencias guardadas aún', 'Se aprenden automáticamente al confirmar novedades, o agrega una manualmente con "+ Agregar"');
    return;
  }

  lista.innerHTML = `<div style="overflow-x:auto;border-radius:6px;border:1px solid var(--border);">
    <table class="dict-table">
      <thead><tr>
        <th>Nombre en TADA</th>
        <th>Nombre en Malla</th>
        <th>Aprendido</th>
        <th>Usos</th>
        <th>Fuente</th>
        <th style="width:110px;">Acciones</th>
      </tr></thead>
      <tbody id="dict-tbody">
        ${dict.map(e=>`
          <tr id="dict-row-${e.id}">
            <td><span id="dict-tada-${e.id}">${e.tadaNombre}</span></td>
            <td><span id="dict-malla-${e.id}">${e.mallaNombre}</span></td>
            <td style="color:var(--text3);">${e.fechaAprendido||''}</td>
            <td style="text-align:center;">${e.usos||0}</td>
            <td><span class="badge ${e.fuente==='manual'?'b-sin':'b-aprendido'}">${e.fuente||'auto'}</span></td>
            <td>
              <div style="display:flex;gap:4px;">
                <button class="btn btn-sm" onclick="editarEquivalencia('${e.id}')" style="padding:3px 7px;font-size:10px;">✏</button>
                <button class="btn btn-sm btn-danger" onclick="eliminarEquivalencia('${e.id}')" style="padding:3px 7px;font-size:10px;">🗑</button>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

export function editarEquivalencia(id){
  const dict = loadDict();
  const e = dict.find(x=>x.id===id);
  if(!e) return;
  const row = document.getElementById(`dict-row-${id}`);
  if(!row) return;
  // Reemplazar celdas con inputs
  document.getElementById(`dict-tada-${id}`).outerHTML =
    `<input class="dict-input" id="edit-tada-${id}" value="${e.tadaNombre}"/>`;
  document.getElementById(`dict-malla-${id}`).outerHTML =
    `<input class="dict-input" id="edit-malla-${id}" value="${e.mallaNombre}"/>`;
  // Cambiar botones
  row.querySelector('div').innerHTML =
    `<button class="btn btn-sm btn-primary" onclick="guardarEdicion('${id}')" style="padding:3px 7px;font-size:10px;">✓</button>
     <button class="btn btn-sm" onclick="renderDiccionario()" style="padding:3px 7px;font-size:10px;">✗</button>`;
}

export function guardarEdicion(id){
  const dict = loadDict();
  const idx  = dict.findIndex(x=>x.id===id);
  if(idx<0) return;
  const newTada  = document.getElementById(`edit-tada-${id}`)?.value.trim();
  const newMalla = document.getElementById(`edit-malla-${id}`)?.value.trim();
  if(!newTada||!newMalla){ toast('Ambos campos son requeridos'); return; }
  dict[idx].tadaNombre  = newTada;
  dict[idx].mallaNombre = newMalla;
  dict[idx].fuente      = 'manual';
  dict[idx].fechaActualizado = new Date().toISOString().slice(0,10);
  saveDict(dict);
  renderDiccionario();
  toast('✓ Equivalencia actualizada');
}

export function eliminarEquivalencia(id){
  const dict = loadDict().filter(e=>e.id!==id);
  saveDict(dict);
  renderDiccionario();
  toast('Equivalencia eliminada');
}

export function agregarEquivalencia(){
  const lista = document.getElementById('dict-lista');
  if(!lista) return;
  // Insertar fila de nueva equivalencia al inicio
  const newRow = document.createElement('div');
  newRow.id = 'dict-new-row';
  newRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:10px;background:var(--bg3);border-radius:6px;border:1px solid var(--accent);';
  newRow.innerHTML = `
    <div style="flex:1;"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Nombre en TADA</label>
      <input class="dict-input" id="new-tada" placeholder="Ej: Jeremy Acosta"/></div>
    <div style="flex:1;"><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Nombre en Malla</label>
      <input class="dict-input" id="new-malla" placeholder="Ej: Jeremy Santiago"/></div>
    <div style="display:flex;gap:4px;padding-top:16px;">
      <button class="btn btn-sm btn-primary" onclick="confirmarNuevaEquivalencia()">✓</button>
      <button class="btn btn-sm" onclick="document.getElementById('dict-new-row').remove()">✗</button>
    </div>`;
  // Remover si ya existe una fila de nueva
  const existing = document.getElementById('dict-new-row');
  if(existing) existing.remove();
  lista.insertBefore(newRow, lista.firstChild);
  document.getElementById('new-tada').focus();
}

export function confirmarNuevaEquivalencia(){
  const tada  = document.getElementById('new-tada')?.value.trim();
  const malla = document.getElementById('new-malla')?.value.trim();
  if(!tada||!malla){ toast('Ambos campos son requeridos'); return; }
  dictSave(tada, malla, 'manual');
  renderDiccionario();
  toast('✓ Equivalencia agregada');
}
