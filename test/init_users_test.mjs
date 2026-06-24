// Test ad-hoc: verifica que initUsers() crea el usuario por defecto
// (cromero / Camilo Romero / superadmin / pibox2026) cuando localStorage
// está vacío — escenario de "primera vez en un navegador nuevo".
import { strict as assert } from 'node:assert';

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k,v) => { store[k]=String(v); },
  removeItem: k => { delete store[k]; },
};
// fetch falla (sin backend disponible) — saveUsers() debe ser no-bloqueante
global.fetch = () => Promise.reject(new Error('sin red en este test'));
global.window = global;
// Shim mínimo de document — replica que #envio-url existe en el HTML estático
// (dentro del modal de correo, oculto, con value='' hasta que el usuario lo abra)
global.document = { getElementById: (id) => id === 'envio-url' ? { value: '' } : null };

const { initUsers, loadUsers, hashPass } = await import('../js/auth.js');

console.log('localStorage antes de initUsers():', JSON.stringify(store));
assert.equal(loadUsers(), null, 'no debe haber usuarios antes de initUsers()');

const result = await initUsers();
console.log('initUsers() retornó:', JSON.stringify(result));

const users = loadUsers();
assert.ok(users, 'debe haber usuarios después de initUsers()');
assert.ok(users.cromero, 'debe existir el usuario cromero');
assert.equal(users.cromero.username, 'cromero');
assert.equal(users.cromero.nombre, 'Camilo Romero');
assert.equal(users.cromero.role, 'superadmin');
assert.equal(users.cromero.passHash, hashPass('pibox2026'), 'el hash debe coincidir con la contraseña pibox2026');
console.log('OK: usuario por defecto creado correctamente en localStorage');

const usersAgain = await initUsers();
assert.deepEqual(usersAgain, users, 'una segunda llamada no debe modificar usuarios existentes');
console.log('OK: llamadas repetidas a initUsers() son idempotentes (no duplica/sobrescribe)');

console.log('\n✓ TODOS LOS CHECKS DE initUsers() PASARON');
