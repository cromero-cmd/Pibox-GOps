// Uso: node test/pigops_simultaneos_test.js   (sin red ni Firestore; extrae el código REAL de index.html)
// Gráfico «Agentes simultáneos por hora del día» (Insights, v19.7): cuántos agentes hay en turno al mismo tiempo en cada hora, programados (malla) vs. reales (turnos).
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const CODE=[fn('function esNovedadVotaciones(novedad){'),"const SIMUL_TIPOS=[['todos','Todos los días'],['semana','Lun–Vie'],['sabado','Sábados'],['domingo','Domingos']];",fn('function agentesPorHora(rows,opts){'),fn('function simulEscala(max){'),
 "const simulFmt=n=>(Math.round(n*10)/10).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:1});","const simulHora=h=>String(h).padStart(2,'0')+':00';",fn('function simulChartHTML(datos,tipo,metrica,tabla){'),
 'return{agentesPorHora,simulChartHTML,simulEscala,SIMUL_TIPOS};'].join('\n');
const E=new Function(CODE)();

// Días: lun 9-nov-2026, sáb 14, dom 15, lun 16 (festivo, pero cuenta como lunes)
const D=(d,h,mi=0)=>new Date(2026,10,d,h,mi,0);
const fila=(u,d,h1,h2,o={})=>Object.assign({usuario:u+'@pibox.app',scheduledStart:D(d,h1),scheduledEnd:D(d,h2),novedad:'',realStart:null,realEnd:null,turno:null},o);
const NOW=D(20,12); // 20-nov: ningún día de prueba es «hoy»
const calc=(rows,o={})=>E.agentesPorHora(rows,Object.assign({now:NOW},o));
const todos=r=>r.tipos.todos;
const r1=(a)=>a.map(x=>Math.round(x*100)/100);

// ═══ A. Programados ═══
{const r=calc([fila('a',9,8,16),fila('b',9,8,16),fila('c',9,8,16)]),p=todos(r).prog;
 t('A1 3 agentes de 8:00 a 16:00: 3 simultáneos de las 08 a las 15 y 0 el resto',p.slice(8,16).every(v=>Math.abs(v-3)<1e-9)&&p.slice(0,8).every(v=>v===0)&&p.slice(16).every(v=>v===0),r1(p));
 t('A1b …y el pico es 3 en esas horas',todos(r).progPico.slice(8,16).every(v=>v===3)&&todos(r).progPico[16]===0);}
{const r=calc([fila('a',9,6,14),fila('b',9,8,16),fila('c',9,10,18)]),p=todos(r).prog;
 t('A2 turnos escalonados 6–14, 8–16 y 10–18: 1 a las 06, 2 a las 08, 3 a las 10–13, 2 a las 14 y 1 a las 16',p[6]===1&&p[7]===1&&p[8]===2&&p[9]===2&&p[10]===3&&p[13]===3&&p[14]===2&&p[15]===2&&p[16]===1&&p[17]===1&&p[18]===0,r1(p));}
{const r=calc([fila('a',9,8,16)].map(x=>({...x,scheduledStart:D(9,8,30)}))),p=todos(r).prog;
 t('A3 entrar a las 08:30: la hora de las 08 cuenta 0,5 (promedio de minutos en turno, no «1 agente»)',Math.abs(p[8]-0.5)<1e-9&&p[9]===1&&p[15]===1&&p[16]===0,r1(p));}
{
 const r2=calc([fila('a',9,8,16),fila('b',9,8,16),fila('c',16,8,16)]);
 t('A4b dos días (lun 9 con 2 agentes, lun 16 con 1): promedio a las 10 = 1,5 y pico = 2',Math.abs(todos(r2).prog[10]-1.5)<1e-9&&todos(r2).progPico[10]===2&&todos(r2).dias===2,r1(todos(r2).prog));}
{// turno nocturno 22:00 → 06:00 en dos días consecutivos
 const n=(u,d)=>({usuario:u+'@pibox.app',scheduledStart:D(d,22),scheduledEnd:D(d,6),novedad:'',realStart:null,realEnd:null,turno:null});
 const r=calc([n('a',9),n('a',10)]),p=todos(r).prog;
 t('A5 turno nocturno (salida < entrada: +24 h): cuenta a las 22 y 23 de su día y a las 0–5 del siguiente; el promedio sobre 2 días refleja que el primer día no tiene al nocturno de la víspera',Math.abs(p[22]-1)<1e-9&&Math.abs(p[23]-1)<1e-9&&Math.abs(p[0]-0.5)<1e-9&&Math.abs(p[5]-0.5)<1e-9&&p[6]===0,r1(p));}
{// filtros: admin, novedad, votaciones, sin horas
 const r=calc([fila('a',9,8,16),fila('adm',9,8,16),fila('v',9,8,16,{novedad:'Vacaciones'}),fila('w',9,8,16,{novedad:'1/2 Día de Votaciones'}),{usuario:'x@pibox.app',scheduledStart:null,scheduledEnd:null}],{excluir:new Set(['adm@pibox.app'])});
 t('A6 se excluye a los admins, a quien tiene novedad (vacaciones, incapacidad…) y a las filas sin horario; la novedad de votaciones SÍ trabaja',todos(r).prog[10]===2&&r.agentes===2&&r.filas===2,{p:todos(r).prog[10],ag:r.agentes});}
{const r=calc([]);t('A7 sin filas: 0 días y todo en cero (no revienta)',todos(r).dias===0&&todos(r).prog.every(v=>v===0));}

// ═══ B. Tipo de día ═══
{const rows=[fila('a',9,8,16),fila('b',9,8,16),fila('a',14,8,16),fila('a',15,8,16),fila('b',15,8,16),fila('c',15,8,16)]; // lun 9: 2 · sáb 14: 1 · dom 15: 3
 const r=calc(rows);
 t('B1 los días se separan en Lun–Vie (1 día, 2 agentes), Sábados (1 día, 1) y Domingos (1 día, 3); «Todos» promedia los 3 (2 a las 10)',r.tipos.semana.dias===1&&r.tipos.semana.prog[10]===2&&r.tipos.sabado.prog[10]===1&&r.tipos.domingo.prog[10]===3&&r.tipos.todos.dias===3&&Math.abs(r.tipos.todos.prog[10]-2)<1e-9,{s:r.tipos.semana.prog[10],sa:r.tipos.sabado.prog[10],d:r.tipos.domingo.prog[10]});}

// ═══ C. Reales ═══
{const rows=[fila('a',9,8,16,{realStart:D(9,8,20),realEnd:D(9,16,0)}),fila('b',9,8,16,{realStart:D(9,8,0),realEnd:D(9,16,0)}),fila('c',9,8,16)]; // c no inició
 const r=calc(rows),x=todos(r);
 t('C1 reales: a las 08 hay 1 agente + el que llegó 08:20 (0,67) = 1,67; a las 09–15, 2; el que no inició no cuenta (programados sigue en 3)',Math.abs(x.real[8]-(1+40/60))<1e-9&&x.real[10]===2&&x.prog[10]===3&&x.realPico[8]===2,r1(x.real));}
{const base=fila('a',9,8,16);
 const largo=calc([{...base,realStart:D(9,8,0),realEnd:D(10,12,0)}]),sin=calc([{...base,realStart:D(9,8,0),realEnd:null}]);
 t('C2 un turno de más de 14 h (olvidado) NO cuenta como horas reales; tampoco uno sin cierre de un día pasado',todos(largo).real.every(v=>v===0)&&todos(sin).real.every(v=>v===0)&&largo.conReal===0);
 const ok=calc([{...base,realStart:D(9,8,0),realEnd:D(9,22,0)}]);
 t('C3 exactamente 14 h sí cuenta (de 08 a 22)',todos(ok).real[8]===1&&todos(ok).real[21]===1&&todos(ok).real[22]===0);}
{// hoy: un turno activo cuenta hasta «ahora»; con más días, hoy se excluye
 const hoy=D(20,0),ahora=D(20,11,30);
 const rows=[{...fila('a',20,8,16),scheduledStart:D(20,8),scheduledEnd:D(20,16),realStart:D(20,8,0),realEnd:null,turno:{status:'active'}}];
 const r=calc(rows,{now:ahora});
 t('C4 solo HOY: el turno activo cuenta hasta ahora (11:30): 1 a las 08–10, 0,5 a las 11, 0 después; los programados llegan a las 15',r.tipos.todos.real[10]===1&&Math.abs(r.tipos.todos.real[11]-0.5)<1e-9&&r.tipos.todos.real[12]===0&&r.tipos.todos.prog[15]===1&&!r.hoyExcluido,r1(r.tipos.todos.real));
 const r2=calc([...rows,fila('b',9,8,16,{realStart:D(9,8),realEnd:D(9,16)})],{now:ahora});
 t('C5 con más días, el día de HOY se excluye (está incompleto) y se avisa: solo cuenta el lunes 9',r2.hoyExcluido===true&&r2.tipos.todos.dias===1&&r2.tipos.todos.prog[10]===1);}

// ═══ D. Pico vs promedio ═══
{const r=calc([fila('a',9,8,16),fila('b',9,8,16),fila('a',16,8,16),fila('b',16,8,16),fila('c',16,8,16),fila('d',16,8,16)]),x=todos(r);
 t('D1 dos lunes con 2 y 4 agentes: promedio 3 y pico 4 en cada hora de 08 a 15',Math.abs(x.prog[9]-3)<1e-9&&x.progPico[9]===4);}

// ═══ E. Escala y HTML ═══
{const s=E.simulEscala;
 t('E1 la escala del eje usa marcas «bonitas» (≤ 6): máx. 3 → 0–3 de 1 en 1; 14 → 0–15 de 5 en 5; 37 → 0–40 de 10 en 10; 0 → tope 1',s(3).paso===1&&s(3).tope===3&&s(14).paso===5&&s(14).tope===15&&s(37).paso===10&&s(37).tope===40&&s(0).tope>=1,[s(3),s(14),s(37)]);}
{const rows=[fila('a',9,8,16,{realStart:D(9,8,10),realEnd:D(9,16)}),fila('b',9,10,18,{realStart:D(9,10),realEnd:D(9,18)})];
 const r=calc(rows),h=E.simulChartHTML(r,'todos','promedio',false);
 t('E2 el gráfico trae las 24 columnas de interacción (una por hora, enfocables con el teclado y con aria-label) y las 24 etiquetas de hora',(h.match(/class="hc-col"/g)||[]).length===24&&(h.match(/tabindex="0"/g)||[]).length===24&&/aria-label="10:00: programados 2, reales 2"/.test(h)&&/>23<\/text>/.test(h)&&/>00<\/text>/.test(h));
 t('E3 hay leyenda con las dos series, resumen con el pico, nota de método y ningún NaN/undefined',/Programados \(malla\)/.test(h)&&/Reales \(turnos iniciados\)/.test(h)&&/Pico programado: <b>2<\/b> a las 10:00/.test(h)&&/Promedio = minutos de agentes/.test(h)&&!/NaN|undefined/.test(h),h.slice(0,300));
 t('E4 las series usan los tokens de color (--hc-prog / --hc-real) y las etiquetas de valor van en tinta de texto, no en el color de la serie',/fill="var\(--hc-prog\)"/.test(h)&&/stroke="var\(--hc-real\)"/.test(h)&&!/<text[^>]*fill="var\(--hc-(prog|real)\)"/.test(h));
 const hp=E.simulChartHTML(r,'todos','pico',false);
 t('E5 la métrica «pico» cambia el texto de método y de la leyenda',/Pico = máximo de agentes simultáneos/.test(hp)&&/pico simultáneo por hora/.test(hp));
 const tb=E.simulChartHTML(r,'todos','promedio',true);
 t('E6 la vista de TABLA (accesible) lista las 24 horas con promedio y pico de cada serie, y sin el SVG',(tb.match(/<tr /g)||[]).length===25&&/Programados · prom\./.test(tb)&&!/<svg/.test(tb)&&/10:00–10:59/.test(tb));
 t('E7 un tipo de día sin datos muestra un mensaje en vez de un gráfico vacío',/Sin turnos programados de este tipo de día/.test(E.simulChartHTML(r,'sabado','promedio',false)));
 t('E8 el gráfico no contiene datos de agentes (nombres ni correos): solo conteos',!/pibox\.app/.test(h));}

// ═══ F. Integración en Insights ═══
t('F1 la tarjeta se inserta en Insights (primera de la columna), con falla aislada (try/catch) y enlazando el tooltip después de pintar',/simulHTML=simulCardHTML\(rows,\{excluir:new Set\(\[\.\.\.\(window\.ADMINS\|\|ADMINS\),SUPER_ADMIN\]\)\}\)/.test(html)&&/\$\{simulHTML\}\n \$\{tardanzaHTML\}/.test(html)&&/if\(simulHTML\)simulEnlazar\(\);/.test(html));
t('F2 colores de la serie para modo oscuro y claro definidos en CSS y versión 19.7',/\.hc-root\{--hc-prog:#3987e5;--hc-real:#d95926;\}/.test(html)&&/body\.light-mode \.hc-root\{--hc-prog:#2a78d6;--hc-real:#eb6834;\}/.test(html)&&/const APP_VERSION='19\.7';/.test(html));
t('F3 el tooltip se arma con textContent (nada de innerHTML con datos)',!/tip\.innerHTML/.test(html));

const fails=out.filter(l=>l.startsWith('FAIL'));console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));process.exit(fails.length?1:0);
