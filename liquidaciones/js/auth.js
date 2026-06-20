// ═══════════════════════════════════════════
// SISTEMA DE AUTENTICACIÓN Y ROLES
// ═══════════════════════════════════════════
import { LS_SESSION, getBackendUrl } from './config.js';
import { toast } from './ui.js';
import { syncSharedData } from './diccionario.js';

// Clave de storage compartido — no usada hoy (reservada, ver diccionario.js
// para la misma situación con SHARED_DICT_KEY), se conserva tal cual existía.
const SHARED_USERS_KEY = 'users_v1';

export let currentUser = null; // {username, nombre, role:'superadmin'|'analista'}

// Setter usado por main.js al restaurar una sesión guardada — currentUser es
// propiedad de este módulo, no puede reasignarse desde un binding importado.
export function setCurrentUser(u){ currentUser = u; }

// Hash simple (sha256 simulado con suma de chars — suficiente para esta app)
export function hashPass(s){
  let h=0;
  for(let i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0;
  return Math.abs(h).toString(16).padStart(8,'0') + s.length.toString(16);
}

// ── Cargar usuarios: localStorage primero, luego backend ──
export function loadUsers(){
  try{
    const r = localStorage.getItem('pibox:users_v1');
    if(r) return JSON.parse(r);
  }catch{}
  return null;
}

// ── Guardar usuarios: localStorage + backend (async, no bloquea) ──
export function saveUsers(users){
  try{ localStorage.setItem('pibox:users_v1', JSON.stringify(users)); }catch(e){}
  // Sincronizar al backend en segundo plano
  const url = getBackendUrl();
  if(url){
    const payload = JSON.stringify({apiKey:'pibox-liq-2026-9605', accion:'saveUsuarios', usuarios: users});
    fetch(url,{method:'POST',mode:'no-cors',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'payload='+encodeURIComponent(payload)
    }).catch(()=>{});
  }
}

// ── Cargar usuarios desde el backend y sincronizar al localStorage ──
export async function syncUsersFromBackend(){
  const url = getBackendUrl();
  if(!url) return null;
  try{
    const params = new URLSearchParams({accion:'getUsuarios', apiKey:'pibox-liq-2026-9605'});
    const resp   = await fetch(`${url}?${params}`);
    const data   = await resp.json();
    if(data.ok && data.usuarios && Object.keys(data.usuarios).length > 0){
      // Guardar en localStorage para acceso offline
      try{ localStorage.setItem('pibox:users_v1', JSON.stringify(data.usuarios)); }catch{}
      return data.usuarios;
    }
  }catch{}
  return null;
}

// ── Inicializar usuario superadmin por defecto si no existe ──
export function initUsers(){
  const users = loadUsers();
  if(!users || Object.keys(users).length===0){
    const defaults = {
      cromero: {
        username: 'cromero',
        nombre: 'Camilo Romero',
        role: 'superadmin',
        passHash: hashPass('pibox2026'),
        creado: new Date().toISOString().slice(0,10),
      }
    };
    saveUsers(defaults);
    return defaults;
  }
  return users;
}

// ── Login: busca local primero, si falla sincroniza del backend ──
export async function doLogin(){
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const pass     = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  if(!username||!pass){ errEl.textContent='Ingresa usuario y contraseña'; return; }

  // Intentar con usuarios locales primero
  let users = loadUsers();
  let user  = users?.[username];

  // Si no encontró localmente, sincronizar desde el backend
  if(!user || user.passHash !== hashPass(pass)){
    errEl.textContent = '⏳ Verificando...';
    const remoteUsers = await syncUsersFromBackend();
    if(remoteUsers){
      users = remoteUsers;
      user  = users[username];
    }
  }

  if(!user || user.passHash !== hashPass(pass)){
    errEl.textContent = 'Usuario o contraseña incorrectos';
    return;
  }

  // Sesión válida
  currentUser = {username: user.username, nombre: user.nombre, role: user.role};
  try{ localStorage.setItem(LS_SESSION, JSON.stringify(currentUser)); }catch{}
  aplicarSesion();
}

export function aplicarSesion(){
  if(!currentUser) return;

  // Ocultar pantalla de login
  document.getElementById('auth-screen').style.display='none';

  // Mostrar user badge en navbar
  const menu = document.getElementById('user-menu');
  menu.style.display='flex';
  document.getElementById('user-avatar').textContent = currentUser.nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('user-display-name').textContent = currentUser.nombre;
  document.getElementById('user-display-role').textContent = currentUser.role==='superadmin'?'Super Admin':'Analista';

  // Mostrar link de admin solo para superadmin
  if(currentUser.role==='superadmin')
    document.getElementById('nav-admin-link').style.display='block';

  // Restringir tarifas para analistas
  aplicarRestriccionesRol();

  // Sincronizar datos compartidos al entrar
  syncSharedData();
}

export function aplicarRestriccionesRol(){
  if(!currentUser) return;
  if(currentUser.role==='analista'){
    // Deshabilitar botones de guardar tarifas
    const btnGuardar = document.getElementById('btn-guardar-tarifa');
    if(btnGuardar){ btnGuardar.disabled=true; btnGuardar.title='Solo el Super Admin puede modificar tarifas'; btnGuardar.style.opacity='.4'; }
  }
}

export function cerrarSesion(){
  currentUser = null;
  try{ localStorage.removeItem(LS_SESSION); }catch{}
  document.getElementById('auth-screen').style.display='flex';
  document.getElementById('user-menu').style.display='none';
  document.getElementById('login-pass').value='';
  document.getElementById('login-error').textContent='';
}

// Panel de gestión de usuarios (solo superadmin)
export async function abrirPanelUsuarios(){
  const users = loadUsers();
  const modal = document.createElement('div');
  modal.id='modal-usuarios';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:900;display:flex;align-items:center;justify-content:center;';

  const rows = Object.values(users).map(u=>`
    <tr>
      <td>${u.username}</td>
      <td>${u.nombre}</td>
      <td><span class="role-badge ${u.role==='superadmin'?'role-superadmin':'role-analista'}">${u.role==='superadmin'?'Super Admin':'Analista'}</span></td>
      <td>${u.creado||'—'}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-sm" onclick="editarUsuario('${u.username}')" style="font-size:10px;padding:3px 8px;">✏</button>
          ${u.username!==currentUser.username?`<button class="btn btn-sm btn-danger" onclick="eliminarUsuario('${u.username}')" style="font-size:10px;padding:3px 8px;">🗑</button>`:''}
        </div>
      </td>
    </tr>`).join('');

  modal.innerHTML=`
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:24px;width:560px;max-width:95vw;max-height:85vh;overflow-y:auto;">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px;">👥 Gestionar usuarios</div>

      <div style="overflow:hidden;border-radius:8px;border:1px solid var(--border);margin-bottom:16px;">
        <table class="users-table">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Creado</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;font-family:var(--mono);">+ Nuevo usuario</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Usuario</label>
            <input id="nu-user" class="dict-input" placeholder="ej: sromero"/></div>
          <div><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Nombre completo</label>
            <input id="nu-nombre" class="dict-input" placeholder="ej: Sergio Romero"/></div>
          <div><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Contraseña</label>
            <input id="nu-pass" type="password" class="dict-input" placeholder="contraseña inicial"/></div>
          <div><label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px;">Rol</label>
            <select id="nu-role" class="dict-input">
              <option value="analista">Analista</option>
              <option value="superadmin">Super Admin</option>
            </select></div>
        </div>
        <div id="nu-error" style="font-size:10px;color:var(--red);min-height:14px;margin-bottom:6px;font-family:var(--mono);"></div>
        <button class="btn btn-primary btn-sm" onclick="crearUsuario()">Crear usuario →</button>
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button class="btn" onclick="document.getElementById('modal-usuarios').remove()">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

export async function crearUsuario(){
  const username = document.getElementById('nu-user').value.trim().toLowerCase();
  const nombre   = document.getElementById('nu-nombre').value.trim();
  const pass     = document.getElementById('nu-pass').value;
  const role     = document.getElementById('nu-role').value;
  const errEl    = document.getElementById('nu-error');
  errEl.textContent='';

  if(!username||!nombre||!pass){ errEl.textContent='Todos los campos son requeridos'; return; }
  if(username.length<3){ errEl.textContent='El usuario debe tener al menos 3 caracteres'; return; }
  if(pass.length<6){ errEl.textContent='La contraseña debe tener al menos 6 caracteres'; return; }

  const users = loadUsers();
  if(users[username]){ errEl.textContent='Ese usuario ya existe'; return; }

  users[username]={username, nombre, role, passHash:hashPass(pass), creado:new Date().toISOString().slice(0,10)};
  saveUsers(users);
  toast(`✓ Usuario ${username} creado`);
  document.getElementById('modal-usuarios').remove();
  abrirPanelUsuarios();
}

export async function editarUsuario(username){
  const users = loadUsers();
  const u = users[username];
  if(!u) return;

  document.getElementById('modal-usuarios').remove();

  const modal = document.createElement('div');
  modal.id = 'modal-editar-usuario';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:900;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:24px;width:380px;max-width:95vw;">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px;">✏ Editar usuario · ${username}</div>
      <div class="auth-field">
        <label>Nombre completo</label>
        <input type="text" id="eu-nombre" class="dict-input" value="${u.nombre}"/>
      </div>
      <div class="auth-field" style="margin-top:10px;">
        <label>Rol</label>
        <select id="eu-role" class="dict-input">
          <option value="analista" ${u.role==='analista'?'selected':''}>Analista</option>
          <option value="superadmin" ${u.role==='superadmin'?'selected':''}>Super Admin</option>
        </select>
      </div>
      <div class="auth-field" style="margin-top:10px;">
        <label>Nueva contraseña <span style="color:var(--text3);font-size:10px;">(dejar vacío para no cambiar)</span></label>
        <input type="password" id="eu-pass" class="dict-input" placeholder="••••••••"/>
      </div>
      <div id="eu-error" style="font-size:11px;color:var(--red);min-height:16px;margin:10px 0;font-family:var(--mono);"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="document.getElementById('modal-editar-usuario').remove();abrirPanelUsuarios();">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarUsuario('${username}')">Guardar →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('eu-nombre').focus();
}

export function guardarUsuario(username){
  const nombre = document.getElementById('eu-nombre').value.trim();
  const role   = document.getElementById('eu-role').value;
  const pass   = document.getElementById('eu-pass').value;
  const errEl  = document.getElementById('eu-error');
  errEl.textContent = '';

  if(!nombre){ errEl.textContent='El nombre no puede estar vacío'; return; }
  if(pass && pass.length<6){ errEl.textContent='La contraseña debe tener al menos 6 caracteres'; return; }

  const users = loadUsers();
  users[username].nombre = nombre;
  users[username].role   = role;
  if(pass) users[username].passHash = hashPass(pass);
  saveUsers(users);

  // Si es el usuario actual, actualizar sesión
  if(username === currentUser.username){
    currentUser.nombre = nombre;
    currentUser.role   = role;
    try{ localStorage.setItem(LS_SESSION, JSON.stringify(currentUser)); }catch{}
    document.getElementById('user-display-name').textContent = nombre;
    document.getElementById('user-avatar').textContent = nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  }

  document.getElementById('modal-editar-usuario').remove();
  toast(`✓ Usuario ${username} actualizado`);
  abrirPanelUsuarios();
}

export async function eliminarUsuario(username){
  if(!confirm(`¿Eliminar al usuario "${username}"?`)) return;
  const users = loadUsers();
  delete users[username];
  saveUsers(users);
  toast(`Usuario ${username} eliminado`);
  document.getElementById('modal-usuarios').remove();
  abrirPanelUsuarios();
}

export function abrirEditarNombre(){
  document.getElementById('user-menu').classList.remove('open');
  const modal = document.createElement('div');
  modal.id = 'modal-editar-nombre';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:900;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:24px;width:340px;max-width:95vw;">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px;">✏ Editar mi nombre</div>
      <div class="auth-field">
        <label>Nombre completo</label>
        <input type="text" id="en-nombre" class="dict-input" value="${currentUser.nombre}" placeholder="Tu nombre completo"/>
      </div>
      <div id="en-error" style="font-size:11px;color:var(--red);min-height:16px;margin:10px 0;font-family:var(--mono);"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button class="btn" onclick="document.getElementById('modal-editar-nombre').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarNombre()">Guardar →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const inp = document.getElementById('en-nombre');
  inp.focus(); inp.select();
}

export function guardarNombre(){
  const nombre = document.getElementById('en-nombre').value.trim();
  const errEl  = document.getElementById('en-error');
  if(!nombre){ errEl.textContent='El nombre no puede estar vacío'; return; }

  const users = loadUsers();
  if(!users){ errEl.textContent='Error cargando usuarios'; return; }

  users[currentUser.username].nombre = nombre;
  saveUsers(users);
  currentUser.nombre = nombre;
  try{ localStorage.setItem(LS_SESSION, JSON.stringify(currentUser)); }catch{}

  // Actualizar navbar
  document.getElementById('user-display-name').textContent = nombre;
  document.getElementById('user-avatar').textContent = nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

  document.getElementById('modal-editar-nombre').remove();
  toast('✓ Nombre actualizado');
}

export function abrirCambiarPassword(){
  document.getElementById('user-menu').classList.remove('open');
  const modal = document.createElement('div');
  modal.id = 'modal-cambiar-pass';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:900;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:24px;width:360px;max-width:95vw;">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px;">🔑 Cambiar contraseña</div>
      <div class="auth-field">
        <label>Contraseña actual</label>
        <input type="password" id="cp-actual" class="dict-input" placeholder="••••••••"/>
      </div>
      <div class="auth-field" style="margin-top:10px;">
        <label>Nueva contraseña</label>
        <input type="password" id="cp-nueva" class="dict-input" placeholder="••••••••"/>
      </div>
      <div class="auth-field" style="margin-top:10px;">
        <label>Confirmar nueva contraseña</label>
        <input type="password" id="cp-confirmar" class="dict-input" placeholder="••••••••"/>
      </div>
      <div id="cp-error" style="font-size:11px;color:var(--red);min-height:16px;margin:10px 0;font-family:var(--mono);"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="document.getElementById('modal-cambiar-pass').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarCambioPass()">Guardar →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('cp-actual').focus();
}

export function confirmarCambioPass(){
  const actual    = document.getElementById('cp-actual').value;
  const nueva     = document.getElementById('cp-nueva').value;
  const confirmar = document.getElementById('cp-confirmar').value;
  const errEl     = document.getElementById('cp-error');
  errEl.textContent = '';

  if(!actual||!nueva||!confirmar){ errEl.textContent='Completa todos los campos'; return; }
  if(nueva.length<6){ errEl.textContent='La nueva contraseña debe tener al menos 6 caracteres'; return; }
  if(nueva !== confirmar){ errEl.textContent='Las contraseñas no coinciden'; return; }

  const users = loadUsers();
  if(!users){ errEl.textContent='Error cargando usuarios'; return; }

  const user = users[currentUser.username];
  if(!user || user.passHash !== hashPass(actual)){
    errEl.textContent='La contraseña actual es incorrecta';
    return;
  }

  user.passHash = hashPass(nueva);
  saveUsers(users);
  document.getElementById('modal-cambiar-pass').remove();
  toast('✓ Contraseña actualizada correctamente');
}

export function toggleUserMenu(){
  const menu = document.getElementById('user-menu');
  menu.classList.toggle('open');
}
