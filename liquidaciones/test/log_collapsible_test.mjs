// Test ad-hoc — logs colapsables con contador dinámico (paso 4 y paso 8):
//   - addLog()/clearLog() mantienen el conteo de líneas por log id y
//     actualizan el <summary> correspondiente: "📋 {label} (X líneas)".
//   - log-trump además colorea el summary según severidad: rojo si hay
//     [ERR], amarillo si solo hay [WARN], verde si todo OK.
//   - log-norm/log-diag (otros logs del pipeline, sin <details> nuevo) no
//     deben verse afectados — no tienen summary asociado, addLog() para
//     esos ids debe seguir funcionando igual que antes.
import { strict as assert } from 'node:assert';

const els = {};
function fakeEl(id){
  if(!els[id]) els[id] = {
    innerHTML:'', textContent:'', style:{}, scrollTop:0,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;}, querySelectorAll(){return [];},
  };
  return els[id];
}
global.document = { getElementById: (id) => fakeEl(id) };
global.window = global;

const { addLog, clearLog } = await import('../js/ui.js');

// ═══════════════════════════════════════════
// log-conc — contador simple, sin color por severidad
// ═══════════════════════════════════════════
clearLog('log-conc');
assert.equal(els['log-conc-summary'].textContent, '📋 Log de conciliación (0 líneas)');

addLog('log-conc', '[INFO] primera línea', 'info');
assert.equal(els['log-conc-summary'].textContent, '📋 Log de conciliación (1 líneas)');

addLog('log-conc', '[OK] segunda línea', 'ok');
addLog('log-conc', '[WARN] tercera línea', 'warn');
assert.equal(els['log-conc-summary'].textContent, '📋 Log de conciliación (3 líneas)');
console.log('OK: el summary de log-conc actualiza el contador en cada addLog()');

clearLog('log-conc');
assert.equal(els['log-conc-summary'].textContent, '📋 Log de conciliación (0 líneas)',
  'clearLog() debe reiniciar el contador a 0');
console.log('OK: clearLog() reinicia el contador del summary a 0');

// ═══════════════════════════════════════════
// log-trump — contador + color por severidad
// ═══════════════════════════════════════════
clearLog('log-trump');
addLog('log-trump', '[OK] todo bien', 'ok');
addLog('log-trump', '[INFO] info', 'info');
assert.equal(els['log-trump-summary'].textContent, '📋 Log final (2 líneas)');
assert.equal(els['log-trump-summary'].style.color, 'var(--green)', 'sin errores ni warnings, debe quedar verde');
console.log('OK: log-trump sin errores/warnings → summary verde');

addLog('log-trump', '[WARN] cuidado', 'warn');
assert.equal(els['log-trump-summary'].style.color, 'var(--yellow)', 'con un warning (sin errores), debe quedar amarillo');
console.log('OK: log-trump con warning → summary amarillo');

addLog('log-trump', '[ERR] algo falló', 'err');
assert.equal(els['log-trump-summary'].style.color, 'var(--red)', 'con al menos un error, debe quedar rojo (máxima severidad)');
assert.equal(els['log-trump-summary'].textContent, '📋 Log final (4 líneas)');
console.log('OK: log-trump con error → summary rojo, incluso habiendo también warnings');

// El rojo debe persistir aunque se agreguen más líneas OK después
addLog('log-trump', '[OK] otra línea ok', 'ok');
assert.equal(els['log-trump-summary'].style.color, 'var(--red)', 'el rojo no debe revertirse por líneas OK posteriores en la misma corrida');
console.log('OK: la severidad roja persiste para el resto de la corrida una vez detectado un error');

clearLog('log-trump');
assert.equal(els['log-trump-summary'].textContent, '📋 Log final (0 líneas)');
addLog('log-trump', '[OK] corrida limpia', 'ok');
assert.equal(els['log-trump-summary'].style.color, 'var(--green)', 'tras clearLog(), la severidad debe reiniciarse para la nueva corrida');
console.log('OK: clearLog() reinicia también la severidad para la siguiente corrida');

// ═══════════════════════════════════════════
// Otros logs del pipeline (log-norm, log-diag) — sin summary asociado,
// addLog()/clearLog() deben seguir funcionando exactamente igual que antes.
// ═══════════════════════════════════════════
clearLog('log-norm');
addLog('log-norm', '[INFO] normalización ok', 'info');
assert.equal(els['log-norm'].innerHTML, '<div class="info">[INFO] normalización ok</div>');
assert.equal(els['log-norm-summary'], undefined, 'log-norm no debe crear ni tocar ningún summary');
console.log('OK: log-norm/log-diag (sin <details> nuevo) no se ven afectados por el cambio');

console.log('\n✓ TODOS LOS CHECKS DE LOS LOGS COLAPSABLES PASARON');
