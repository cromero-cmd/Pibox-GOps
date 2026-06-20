// ═══════════════════════════════════════════
// DICCIONARIO DE EQUIVALENCIAS
// Estructura: [{id, tadaNombre, mallaNombre, fechaAprendido, usos, fuente}]
// ═══════════════════════════════════════════
import { LS_DICT, normStr } from './config.js';
import { toast, emptyStateHtml } from './ui.js';

// Claves de storage compartido — no usadas hoy (reservadas para sync futura vía Apps Script),
// se conservan tal cual existían en el archivo original.
const SHARED_DICT_KEY  = 'diccionario_v1';
const SHARED_TARIFF_KEY = 'tariff_v1';

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
  const nTada = normStr(tadaNombre);
  const idx = dict.findIndex(e => normStr(e.tadaNombre) === nTada);
  if(idx >= 0){
    // Actualizar existente
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
