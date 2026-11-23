// Uso: node test/pigops_simultaneos_test.js   (sin red ni Firestore; extrae el código REAL de index.html)
// Mapa de calor «Agentes simultáneos por día y hora» (Insights, v19.7; mapa de calor desde la v19.8): horas en el eje Y, días de la semana en el eje X,
// con el número en cada celda: programados (malla) vs. reales (turnos) y la brecha entre ambos.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
const line=(pref)=>{const i=html.indexOf(pref);if(i<0)throw new Error('no encontrado: '+pref);return html.slice(i,html.indexOf('\n',i));};
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const CODE=[fn('function esNovedadVotaciones(novedad){'),line('const SIMUL_DIAS='),line('const SIMUL_VISTAS='),fn('function simulEsStorage(r){'),fn('function agentesPorHora(rows,opts){'),fn('function simulMatriz(datos,campo,metrica){'),fn('function simulExtremo(m,modo){'),fn('function simulRango(datos,h24){'),
 line('const simulFmt='),line('const simulFmtS='),line('const simulHora='),fn('function simulPanelHTML(datos,campo,metrica,h0,h1,max,grande){'),fn('function simulChartHTML(datos,vista,metrica,tabla,h24){'),
 'return{simulEsStorage,agentesPorHora,simulMatriz,simulExtremo,simulRango,simulChartHTML,simulFmt,simulFmtS,SIMUL_DIAS};'].join('\n');
const E=new Function(CODE)();

// Días: lun 9-nov-2026, mar 10, sáb 14, dom 15, lun 16 (festivo, pero cuenta como lunes)
const D=(d,h,mi=0)=>new Date(2026,10,d,h,mi,0);
const fila=(u,d,h1,h2,o={})=>Object.assign({usuario:u+'@pibox.app',scheduledStart:D(d,h1),scheduledEnd:D(d,h2),novedad:'',realStart:null,realEnd:null,turno:null},o);
const NOW=D(25,12); // 25-nov: ningún día de prueba es «hoy»
const calc=(rows,o={})=>E.agentesPorHora(rows,Object.assign({now:NOW},o));
const LUN=0,MAR=1,SAB=5,DOM=6;
const r1=(a)=>a.map(x=>Math.round(x*100)/100);

// ═══ A. Programados ═══
{const r=calc([fila('a',9,8,16),fila('b',9,8,16),fila('c',9,8,16)]),p=r.dias[LUN].prog;
 t('A1 3 agentes de 8:00 a 16:00 un lunes: 3 simultáneos de las 08 a las 15 y 0 el resto',p.slice(8,16).every(v=>Math.abs(v-3)<1e-9)&&p.slice(0,8).every(v=>v===0)&&p.slice(16).every(v=>v===0),r1(p));
 t('A1b …y el pico es 3 en esas horas; los demás días de la semana quedan sin fechas (n=0)',r.dias[LUN].progPico.slice(8,16).every(v=>v===3)&&r.dias[LUN].n===1&&[1,2,3,4,5,6].every(i=>r.dias[i].n===0));}
{const r=calc([fila('a',9,6,14),fila('b',9,8,16),fila('c',9,10,18)]),p=r.dias[LUN].prog;
 t('A2 turnos escalonados 6–14, 8–16 y 10–18: 1 a las 06, 2 a las 08, 3 a las 10–13, 2 a las 14 y 1 a las 16',p[6]===1&&p[7]===1&&p[8]===2&&p[9]===2&&p[10]===3&&p[13]===3&&p[14]===2&&p[15]===2&&p[16]===1&&p[17]===1&&p[18]===0,r1(p));}
{const r=calc([{...fila('a',9,8,16),scheduledStart:D(9,8,30)}]),p=r.dias[LUN].prog;
 t('A3 entrar a las 08:30: la hora de las 08 cuenta 0,5 (promedio de minutos en turno, no «1 agente»)',Math.abs(p[8]-0.5)<1e-9&&p[9]===1&&p[15]===1&&p[16]===0,r1(p));}
{const r=calc([fila('a',9,8,16),fila('b',9,8,16),fila('c',16,8,16)]); // lun 9 con 2 · lun 16 con 1
 t('A4 dos lunes (con 2 y 1 agentes): la columna del lunes promedia 1,5 y su pico es 2; n=2',Math.abs(r.dias[LUN].prog[10]-1.5)<1e-9&&r.dias[LUN].progPico[10]===2&&r.dias[LUN].n===2&&r.fechas===2,r1(r.dias[LUN].prog));}
{// turno nocturno 22:00 → 06:00 en dos días consecutivos (lun 9 y mar 10)
 const n=(u,d)=>({usuario:u+'@pibox.app',scheduledStart:D(d,22),scheduledEnd:D(d,6),novedad:'',realStart:null,realEnd:null,turno:null});
 const r=calc([n('a',9),n('a',10)]);
 t('A5 turno nocturno (salida < entrada: +24 h): del lunes cuenta a las 22 y 23 y, pasada la medianoche, cae en la columna del MARTES (0–5)',r.dias[LUN].prog[22]===1&&r.dias[LUN].prog[23]===1&&r.dias[LUN].prog[0]===0&&r.dias[MAR].prog[0]===1&&r.dias[MAR].prog[5]===1&&r.dias[MAR].prog[6]===0&&r.dias[MAR].prog[22]===1,{lun:r1(r.dias[LUN].prog),mar:r1(r.dias[MAR].prog)});}
{// filtros: admin, novedad, votaciones, sin horas
 const r=calc([fila('a',9,8,16),fila('adm',9,8,16),fila('v',9,8,16,{novedad:'Vacaciones'}),fila('w',9,8,16,{novedad:'1/2 Día de Votaciones'}),{usuario:'x@pibox.app',scheduledStart:null,scheduledEnd:null}],{excluir:new Set(['adm@pibox.app'])});
 t('A6 se excluye a los admins, a quien tiene novedad (vacaciones, incapacidad…) y a las filas sin horario; la novedad de votaciones SÍ trabaja',r.dias[LUN].prog[10]===2&&r.agentes===2&&r.filas===2,{p:r.dias[LUN].prog[10],ag:r.agentes});}
{const r=calc([]);t('A7 sin filas: 0 fechas y todo en cero (no revienta)',r.fechas===0&&r.dias.every(d=>d.n===0&&d.prog.every(v=>v===0)));}

// ═══ B. Días de la semana ═══
{const rows=[fila('a',9,8,16),fila('b',9,8,16),fila('a',14,8,16),fila('a',15,8,16),fila('b',15,8,16),fila('c',15,8,16)]; // lun 9: 2 · sáb 14: 1 · dom 15: 3
 const r=calc(rows);
 t('B1 cada fecha cae en la columna de su día: lunes 2 agentes, sábado 1, domingo 3; los otros días no tienen fechas',r.dias[LUN].prog[10]===2&&r.dias[SAB].prog[10]===1&&r.dias[DOM].prog[10]===3&&r.dias[MAR].n===0&&r.fechas===3,{l:r.dias[LUN].prog[10],s:r.dias[SAB].prog[10],d:r.dias[DOM].prog[10]});}
{const rows=[fila('a',9,8,16),fila('b',16,8,16)]; // lunes 9 y lunes 16 (festivo)
 const r=calc(rows);t('B2 el lunes festivo cuenta como lunes (la columna agrupa por día de la semana, no por laborable)',r.dias[LUN].n===2);}

// ═══ C. Reales ═══
{const rows=[fila('a',9,8,16,{realStart:D(9,8,20),realEnd:D(9,16,0)}),fila('b',9,8,16,{realStart:D(9,8,0),realEnd:D(9,16,0)}),fila('c',9,8,16)]; // c no inició
 const r=calc(rows),x=r.dias[LUN];
 t('C1 reales: a las 08 hay 1 agente + el que llegó 08:20 (0,67) = 1,67; a las 09–15, 2; el que no inició no cuenta (programados sigue en 3)',Math.abs(x.real[8]-(1+40/60))<1e-9&&x.real[10]===2&&x.prog[10]===3&&x.realPico[8]===2,r1(x.real));}
{const base=fila('a',9,8,16);
 const largo=calc([{...base,realStart:D(9,8,0),realEnd:D(10,12,0)}]),sin=calc([{...base,realStart:D(9,8,0),realEnd:null}]);
 t('C2 un turno de más de 14 h (olvidado) NO cuenta como horas reales; tampoco uno sin cierre de un día pasado',largo.dias[LUN].real.every(v=>v===0)&&sin.dias[LUN].real.every(v=>v===0)&&largo.conReal===0&&sin.conReal===0);
 const ok=calc([{...base,realStart:D(9,8,0),realEnd:D(9,22,0)}]);
 t('C3 exactamente 14 h sí cuenta (de 08 a 22)',ok.dias[LUN].real[8]===1&&ok.dias[LUN].real[21]===1&&ok.dias[LUN].real[22]===0);}
{// hoy: un turno activo cuenta hasta «ahora»; con más días, hoy se excluye. 20-nov-2026 = viernes
 const ahora=D(20,11,30);
 const rows=[{...fila('a',20,8,16),realStart:D(20,8,0),realEnd:null,turno:{status:'active'}}];
 const r=calc(rows,{now:ahora}),V=4;
 t('C4 solo HOY (viernes, 11:30): el turno activo cuenta hasta ahora: 1 a las 08–10 y 1 a las 11 (promedio sobre los 30 min transcurridos, no 0,5); los programados completos llegan a las 15',r.dias[V].real[10]===1&&Math.abs(r.dias[V].real[11]-1)<1e-9&&r.dias[V].prog[15]===1&&r.hoyParcial===true&&r.ahoraTxt==='11:30',r1(r.dias[V].real));
 t('C4b las horas de hoy que aún no llegan NO son «0 agentes»: en reales y brecha salen null (sin dato), y los programados sí se ven',E.simulMatriz(r,'real','promedio')[V][12]===null&&E.simulMatriz(r,'brecha','promedio')[V][12]===null&&E.simulMatriz(r,'prog','promedio')[V][12]===1&&E.simulMatriz(r,'real','promedio')[V][11]===1);
 const r2=calc([...rows,fila('b',9,8,16,{realStart:D(9,8),realEnd:D(9,16)})],{now:ahora});
 t('C5 con más días, los programados de HOY (viernes) SÍ aparecen en su columna junto con los del lunes 9; antes se excluía todo el día y la columna quedaba vacía («Esta semana»)',r2.fechas===2&&r2.dias[V].n===1&&r2.dias[V].prog[10]===1&&r2.dias[LUN].prog[10]===1&&r2.hoyParcial===true);
 // el viernes 13 completo + hoy parcial: los reales de hoy no diluyen el promedio de las horas que aún no llegan
 const r3=calc([fila('a',13,8,16,{realStart:D(13,8),realEnd:D(13,16)}),fila('a',20,8,16,{realStart:D(20,8),realEnd:null,turno:{status:'active'}}),fila('b',20,8,16,{realStart:D(20,8),realEnd:null,turno:{status:'active'}})],{now:ahora});
 t('C6 dos viernes (13 completo con 1 agente, hoy con 2 hasta las 11:30): a las 10 el promedio real es 1,5; a las 14 solo cuenta el viernes 13 (1), no se diluye con el 0 de hoy',Math.abs(r3.dias[V].real[10]-1.5)<1e-9&&Math.abs(r3.dias[V].real[14]-1)<1e-9&&Math.abs(r3.dias[V].prog[14]-1.5)<1e-9,{r10:r3.dias[V].real[10],r14:r3.dias[V].real[14],p14:r3.dias[V].prog[14]});
 const hh=E.simulChartHTML(r,'todo','promedio',false,false);
 t('C7 el HTML avisa que hoy es parcial (hasta las 11:30) y las celdas sin dato llevan «–» y su aria-label',/\(hoy cuenta hasta las 11:30\)/.test(hh)&&/aún sin dato real/.test(hh)&&!/NaN|undefined|null/.test(hh));}

// ═══ D. Pico vs promedio ═══
{const r=calc([fila('a',9,8,16),fila('b',9,8,16),fila('a',16,8,16),fila('b',16,8,16),fila('c',16,8,16),fila('d',16,8,16)]),x=r.dias[LUN];
 t('D1 dos lunes con 2 y 4 agentes: promedio 3 y pico 4 en cada hora de 08 a 15',Math.abs(x.prog[9]-3)<1e-9&&x.progPico[9]===4);}

// ═══ E. Matrices, brecha, rango de horas ═══
{const rows=[fila('a',9,8,16,{realStart:D(9,8,0),realEnd:D(9,16)}),fila('b',9,8,16),fila('c',10,9,17,{realStart:D(10,9),realEnd:D(10,17)})]; // lun: 2 prog/1 real · mar: 1/1
 const r=calc(rows),mp=E.simulMatriz(r,'prog','promedio'),mr=E.simulMatriz(r,'real','promedio'),mb=E.simulMatriz(r,'brecha','promedio');
 t('E1 la matriz es de 7 columnas × 24 horas; los días sin fechas son null',mp.length===7&&mp[0].length===24&&mp[2][10]===null&&mp[0][10]===2);
 t('E2 brecha = reales − programados: el lunes a las 10 faltó 1 agente (−1); el martes a las 10 coincide (0)',mb[0][10]===-1&&mb[1][10]===0&&mb[2][10]===null,[mb[0][10],mb[1][10]]);
 t('E3 la matriz de «pico» usa el máximo simultáneo y la brecha de pico también',E.simulMatriz(r,'prog','pico')[0][10]===2&&E.simulMatriz(r,'brecha','pico')[0][10]===-1);
 const ex=E.simulExtremo(mp,'max'),mn=E.simulExtremo(mb,'min');
 t('E4 celda más alta de programados: lunes a las 08 (2, la primera en empate); mayor faltante: −1, lunes',ex.v===2&&ex.d===0&&ex.h===8&&mn.v===-1&&mn.d===0,{ex,mn});
 t('E5 rango de horas: solo las que tienen actividad (08–16 aquí: el martes entra hasta las 16); con h24 siempre 0–23',JSON.stringify(E.simulRango(r,false))==='[8,16]'&&JSON.stringify(E.simulRango(r,true))==='[0,23]',E.simulRango(r,false));
 t('E6 sin ninguna actividad el rango es 0–23 (no queda vacío)',JSON.stringify(E.simulRango(calc([]),false))==='[0,23]');}
{t('E7 el formato de brecha usa signo + y − real (U+2212) y «0» sin signo',E.simulFmtS(2)==='+2'&&E.simulFmtS(-1.5)==='−1,5'&&E.simulFmtS(0)==='0'&&E.simulFmtS(0.04)==='0'&&E.simulFmt(7.6)==='7,6'&&E.simulFmt(18)==='18');}

// ═══ F. HTML ═══
{const rows=[fila('a',9,8,16,{realStart:D(9,8,10),realEnd:D(9,16)}),fila('b',9,10,18,{realStart:D(9,10),realEnd:D(9,18)}),fila('c',10,9,17,{realStart:D(10,9),realEnd:D(10,17)})];
 const r=calc(rows),h=E.simulChartHTML(r,'todo','promedio',false,false);
 const celdas=(h.match(/class="hc-c[ "]/g)||[]).length,horas=10; // 08–17 = 10 filas
 t('F1 «Comparar» pinta 3 mapas (programados, reales, brecha), cada uno con 7 columnas × las horas con actividad: una celda por combinación, TODAS con etiqueta',(h.match(/class="hc-p"/g)||[]).length===3&&celdas===3*7*horas&&!/><\/div>\s*<div class="hc-c/.test('')&&(h.match(/class="hc-c[^"]*"[^>]*><\/div>/g)||[]).length===0,{celdas});
 t('F2 las horas van en el eje Y y los días en el X: encabezados Lun…Dom, con ×N fechas, y etiquetas 08:00…17:00',/<b>Lun<\/b><span>×1<\/span>/.test(h)&&/<b>Dom<\/b><span>—<\/span>/.test(h)&&/>08:00<\/div>/.test(h)&&/>17:00<\/div>/.test(h)&&!/>07:00<\/div>/.test(h)&&!/>18:00<\/div>/.test(h));
 t('F3 una sola parada de tabulador por mapa (roving tabindex): 3 celdas con tabindex 0 y el resto -1; cada celda con aria-label',(h.match(/tabindex="0"/g)||[]).length===3&&(h.match(/aria-label="[^"]+: /g)||[]).length===celdas);
 t('F4 el resumen nombra el pico programado, el pico real y el mayor faltante con día y hora; hay leyenda de escala y nota de método; sin NaN/undefined',/Pico programado: <b>2<\/b> · Lun 10:00/.test(h)&&/Pico real: <b>/.test(h)&&/Mayor faltante: <b>−/.test(h)&&/class="hc-leg"/.test(h)&&/Promedio = minutos de agentes/.test(h)&&!/NaN|undefined/.test(h),h.slice(0,500));
 t('F5 programados y reales usan la MISMA escala (mismo tope en la leyenda) y una rampa de un solo tono cada uno (azul / naranja); la brecha usa los polos opuestos',(h.match(/var\(--hc-b-hi\)/g)||[]).length>0&&(h.match(/var\(--hc-o-hi\)/g)||[]).length>0&&/--hc-neg/.test(h)&&/--hc-pos/.test(h)&&(()=>{const m=[...h.matchAll(/<span>([\d,]+) agentes<\/span>/g)].map(x=>x[1]);return m.length===2&&m[0]===m[1];})());
 t('F6 la celda extrema de cada mapa lleva marca (hc-pk) y las de cero van sin relleno (hc-z)',(h.match(/hc-pk/g)||[]).length===3&&/hc-z/.test(h));
 t('F7 vista «Programados» pinta un solo mapa y ancho completo; «Brecha», uno solo con su leyenda de faltan/sobran',(E.simulChartHTML(r,'prog','promedio',false,false).match(/class="hc-p"/g)||[]).length===1&&/faltan/.test(E.simulChartHTML(r,'brecha','promedio',false,false))&&/sobran/.test(E.simulChartHTML(r,'brecha','promedio',false,false)));
 t('F8 h24 muestra las 24 filas y quita la nota de horas ocultas',(E.simulChartHTML(r,'prog','promedio',false,true).match(/class="hc-hl"/g)||[]).length===24&&/Se ocultan las horas sin actividad/.test(h)&&!/Se ocultan las horas sin actividad/.test(E.simulChartHTML(r,'prog','promedio',false,true)));
 const tb=E.simulChartHTML(r,'todo','promedio',true,false);
 t('F9 la TABLA (accesible) lista una fila por hora y una columna por día con «programados / reales», sin mapas',(tb.match(/<tr /g)||[]).length===11&&/Programados \/ reales/.test(tb)&&/<th[^>]*>Lun ×1<\/th>/.test(tb)&&!/hc-c/.test(tb)&&/08:00–08:59/.test(tb));
 t('F10 el pico cambia el texto de método',/Pico = máximo de agentes simultáneos/.test(E.simulChartHTML(r,'todo','pico',false,false)));
 t('F11 sin turnos reales (nadie ha cerrado turno) «Comparar» solo muestra programados y «Reales» avisa en vez de pintar ceros',(E.simulChartHTML(calc([fila('a',9,8,16)]),'todo','promedio',false,false).match(/class="hc-p"/g)||[]).length===1&&/Aún no hay turnos reales/.test(E.simulChartHTML(calc([fila('a',9,8,16)]),'real','promedio',false,false)));
 t('F12 un período sin programación muestra un mensaje',/Sin turnos programados en el período/.test(E.simulChartHTML(calc([]),'todo','promedio',false,false)));
 t('F13 el HTML no contiene datos de agentes (nombres ni correos): solo conteos',!/pibox\.app/.test(h));}

// ═══ H. Filtro «Sin Storage» ═══
{const S=(u,d,h1,h2,o={})=>fila(u,d,h1,h2,o);
 t('H1 detecta Storage en la línea o en el rol, sin distinguir mayúsculas ni tildes («STORAGE», «Storage Pibox», «Línea Storage»); no confunde otras líneas',E.simulEsStorage({linea:'STORAGE'})&&E.simulEsStorage({rol:'Operador storage'})&&E.simulEsStorage({linea:'Línea Storage',rol:''})&&!E.simulEsStorage({linea:'Soporte',rol:'Agente'})&&!E.simulEsStorage({})&&!E.simulEsStorage({linea:null,rol:undefined}));
 const rows=[S('a',9,8,16),S('b',9,8,16),S('s1',9,8,16,{linea:'Storage'}),S('s2',9,8,16,{rol:'Auxiliar Storage'})];
 const con=calc(rows),sin=calc(rows,{sinStorage:true});
 t('H2 sin el filtro cuentan los 4 (programados 4); con «Sin Storage» solo 2; el filtro cuenta a las 2 personas de Storage para el botón en ambos casos',con.dias[LUN].prog[10]===4&&sin.dias[LUN].prog[10]===2&&con.storageN===2&&sin.storageN===2&&con.sinStorage===false&&sin.sinStorage===true&&con.agentes===4&&sin.agentes===2,{c:con.dias[LUN].prog[10],s:sin.dias[LUN].prog[10],n:sin.storageN});
 const reales=rows.map(r=>({...r,realStart:D(9,8),realEnd:D(9,16)})),rs=calc(reales,{sinStorage:true});
 t('H3 también quita sus turnos REALES y la brecha (no solo la malla): reales 2 y brecha 0 a las 10',rs.dias[LUN].real[10]===2&&E.simulMatriz(rs,'brecha','promedio')[LUN][10]===0);
 t('H4 Storage que ya estaba fuera por novedad o por ser admin no se cuenta en el botón (solo cuenta a quien aportaría al gráfico)',calc([S('s1',9,8,16,{linea:'Storage',novedad:'Vacaciones'}),S('a',9,8,16)]).storageN===0&&calc([S('s1',9,8,16,{linea:'Storage'}),S('a',9,8,16)],{excluir:new Set(['s1@pibox.app'])}).storageN===0);
 t('H5 el resumen lo anuncia («sin Storage») y sin Storage en el período el botón queda deshabilitado con su explicación',/\(sin Storage\)/.test(E.simulChartHTML(sin,'todo','promedio',false,false))&&!/\(sin Storage\)/.test(E.simulChartHTML(con,'todo','promedio',false,false))&&/setSimul\('sinStorage',\$\{!s\.sinStorage\}\)/.test(html)&&/<button disabled title="No hay personal de Storage/.test(html));
 t('H6 el filtro se conserva al repintar Insights (estado en window._simul) y al activarlo se recalculan los datos desde las filas guardadas',/sinStorage:!!prev\.sinStorage/.test(html)&&/if\(campo==='sinStorage'\)s\.datos=agentesPorHora\(s\.rows,/.test(html));}

// ═══ I. Fechas futuras (filtro «Esta semana»): sin dato real, fuera de los promedios y del resumen ═══
{// semana: lun 9 y mar 10 pasadas, mié 11 es HOY a las 10:30, jue 12 y vie 13 futuras. Todos con 2 agentes programados de 08 a 16; los reales solo existen hasta ahora
 const AHORA=D(11,10,30),MIE=2,JUE=3,VIE=4;
 const prog2=(d,o1={},o2={})=>[fila('a',d,8,16,o1),fila('b',d,8,16,o2)];
 const real=(d)=>({realStart:D(d,8),realEnd:D(d,16)});
 const rows=[...prog2(9,real(9),real(9)),...prog2(10,real(10),{}), // martes: solo 1 de 2 trabajó → faltó 1
  ...prog2(11,{realStart:D(11,8),realEnd:null,turno:{status:'active'}},{realStart:D(11,8),realEnd:null,turno:{status:'active'}}),...prog2(12),...prog2(13)];
 const r=calc(rows,{now:AHORA}),mr=E.simulMatriz(r,'real','promedio'),mb=E.simulMatriz(r,'brecha','promedio'),mp=E.simulMatriz(r,'prog','promedio');
 t('I1 los días futuros (jue y vie) salen null en Reales y Brecha, en TODAS las horas, y no «0»',mr[JUE].every(v=>v===null)&&mr[VIE].every(v=>v===null)&&mb[JUE].every(v=>v===null)&&mb[VIE].every(v=>v===null));
 t('I2 Programados NO cambia: la malla de los días futuros sí se muestra (2 agentes a las 10 el jueves y el viernes)',mp[JUE][10]===2&&mp[VIE][10]===2&&r.dias[JUE].n===1&&r.dias[VIE].n===1);
 t('I3 el ×N de Reales/Brecha cuenta solo fechas ya ocurridas o en curso: jue y vie 0, mié (hoy) 1, lun 1; el de Programados sigue contando las futuras (jue 1)',r.dias[JUE].nReal===0&&r.dias[VIE].nReal===0&&r.dias[MIE].nReal===1&&r.dias[LUN].nReal===1&&r.futuras===2);
 const h=E.simulChartHTML(r,'todo','promedio',false,false);
 const paneles=h.split('class="hc-p"').slice(1);
 const x=(i)=>[...paneles[i].matchAll(/<b>(Lun|Mar|Mié|Jue|Vie|Sáb|Dom)<\/b><span>([^<]*)<\/span>/g)].map(m=>m[1]+m[2]);
 t('I4 en el encabezado, Programados muestra Jue ×1 y Vie ×1; Reales y Brecha muestran Jue — y Vie —',x(0).includes('Jue×1')&&x(0).includes('Vie×1')&&x(1).includes('Jue—')&&x(1).includes('Vie—')&&x(2).includes('Jue—')&&x(2).includes('Vie—')&&x(1).includes('Mié×1'),[x(0),x(1)]);
 // brecha comparable: el martes faltó 1 de 2 → −1 (no se diluye con otras fechas); hoy a las 10 hay 2 de 2 → 0; hoy a las 12 (aún no llega) → null
 t('I5 la brecha de las fechas ocurridas es real (martes −1 a las 10; hoy 0 a las 10) y la hora de hoy que no ha llegado es null',mb[1][10]===-1&&mb[MIE][10]===0&&mb[MIE][12]===null&&mr[MIE][12]===null,{mar:mb[1][10],mie:mb[MIE][10]});
 // un mismo día de la semana con una fecha pasada y otra futura: la brecha compara solo contra la malla de la pasada
 const rows2=[fila('a',9,8,16,real(9)),fila('b',9,8,16,real(9)),fila('a',16,8,16),fila('b',16,8,16),fila('c',16,8,16),fila('d',16,8,16)]; // lun 9 pasado (2 prog, 2 reales) · lun 16 futuro (4 prog)
 const r2=calc(rows2,{now:D(11,10,30)});
 t('I6 lunes con una fecha pasada (2 prog, 2 reales) y una futura (4 prog): programados promedia 3, reales 2 y brecha 0 — la malla del lunes futuro NO aparece como faltante',Math.abs(r2.dias[LUN].prog[10]-3)<1e-9&&r2.dias[LUN].real[10]===2&&E.simulMatriz(r2,'brecha','promedio')[LUN][10]===0&&E.simulMatriz(r2,'brecha','pico')[LUN][10]===0&&E.simulMatriz(r2,'prog','pico')[LUN][10]===4,{p:r2.dias[LUN].prog[10],b:E.simulMatriz(r2,'brecha','promedio')[LUN][10]});
 // resumen: pico real y mayor faltante sin fechas futuras
 t('I7 el resumen no apunta a un día futuro: el pico real y el mayor faltante caen en lun/mar/mié; «Mayor faltante» es −1 el martes (nunca jue ni vie)',/Pico real: <b>[^<]+<\/b> · (Lun|Mar|Mié) /.test(h)&&/Mayor faltante: <b>−1<\/b> · Mar /.test(h)&&!/Mayor faltante: <b>[^<]+<\/b> · (Jue|Vie)/.test(h),h.slice(0,400));
 const todoFuturo=calc([...prog2(12),...prog2(13),...prog2(9,real(9),real(9))],{now:D(11,10,30)});
 t('I8 la nota al pie dice que los días y horas que aún no ocurren salen con «–» (y que Programados muestra la malla futura); sin fechas futuras ni hoy en curso no aparece',/Los días y horas que aún no ocurren salen con «–» en Reales y Brecha \(hoy cuenta hasta las 10:30\)/.test(h)&&/Programados sí muestra la malla de los días que faltan/.test(h)&&!/aún no ocurren/.test(E.simulChartHTML(calc([fila('a',9,8,16,real(9))]),'todo','promedio',false,false)));
 t('I9 las celdas sin dato llevan «–» y su aria-label; el tooltip lo explica y el HTML no trae NaN/undefined',/aria-label="Jueves 10:00: aún sin dato real"/.test(h)&&!/NaN|undefined/.test(h)&&/Reales: aún sin dato \(todavía no ocurre\)/.test(html)&&/reales: '\+o\.nReal\+' ya ocurrida'/.test(html));
 t('I10 la tabla muestra «–» en reales de los días futuros',/10:00–10:59<\/td>[^]*?<td[^>]*>2 \/ –<\/td>/.test(E.simulChartHTML(r,'todo','promedio',true,false)));}

// ═══ J. Filas con entrada = salida y sin novedad (v19.12): no son un turno de 24 h ═══
{const vacia=fila('a',9,8,8),ok=fila('b',9,8,16),conNov=fila('c',9,8,8,{novedad:'Vacaciones'}),votos=fila('d',9,8,16,{novedad:'1/2 Día de Votaciones'});
 const r=calc([vacia,ok,conNov,votos]);
 t('J1 una fila con entrada = salida y sin novedad se ignora (antes sumaba 24 h seguidas); con novedad ya se ignoraba; la media jornada de votaciones sigue trabajando',r.dias[LUN].prog[3]===0&&r.dias[LUN].prog[10]===2&&r.agentes===2&&r.filas===2,{p3:r.dias[LUN].prog[3],p10:r.dias[LUN].prog[10],ag:r.agentes});}

// ═══ G. Integración en Insights, colores y accesibilidad de color ═══
t('G1 la tarjeta se inserta en Insights (primera de la columna), con falla aislada (try/catch) y enlazando el tooltip después de pintar',/simulHTML=simulCardHTML\(rows,\{excluir:new Set\(\[\.\.\.\(window\.ADMINS\|\|ADMINS\),SUPER_ADMIN\]\)\}\)/.test(html)&&/\$\{simulHTML\}\n \$\{tardanzaHTML\}/.test(html)&&/if\(simulHTML\)simulEnlazar\(\);/.test(html));
t('G2 versión 19.12 y colores definidos para modo oscuro (por defecto) y claro',/const APP_VERSION='19\.12';/.test(html)&&/\.hc-root\{--hc-prog:#3987e5;--hc-real:#d95926;--hc-b-lo:#1a3a66;/.test(html)&&/body\.light-mode \.hc-root\{--hc-prog:#2a78d6;--hc-real:#eb6834;--hc-b-lo:#dcebfc;/.test(html));
t('G3 el tooltip se arma con textContent (nada de innerHTML con datos)',!/tip\.innerHTML/.test(html));
{// Contraste de la etiqueta de cada celda contra su relleno (WCAG ≥ 4,5) en todo el recorrido de cada rampa y en ambos temas (el texto NO cambia de color: la rampa no cruza el punto medio)
 const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255),lin=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
 const toLab=([r,g,b])=>{r=lin(r);g=lin(g);b=lin(b);const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);return[0.2104542553*l+0.793617785*m-0.0040720468*s,1.9779984951*l-2.428592205*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.808675766*s];};
 const unl=c=>c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055;
 const fromLab=([L,a,b])=>{const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.291485548*b)**3;return[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.707614701*s].map(c=>unl(Math.min(1,Math.max(0,c))));};
 const mix=(a,b,k)=>{const A=toLab(hex(a)),B=toLab(hex(b));return fromLab(A.map((v,i)=>v+(B[i]-v)*k));};
 const Y=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b),cr=(p,q)=>{const a=Y(p),b=Y(q);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);};
 const bloque=(pre)=>{const i=html.indexOf(pre);return html.slice(i,html.indexOf('}',i));};
 const v=(b,n)=>(b.match(new RegExp('--'+n+':(#[0-9a-fA-F]{6})'))||[])[1];
 let peor=99,det=[];
 [[bloque('.hc-root{--hc-prog'),'oscuro'],[bloque('body.light-mode .hc-root{'),'claro']].forEach(([b,tema])=>{
  const ink=v(b,'hc-ink'),mid=v(b,'hc-mid');
  [['b-lo','b-hi'],['o-lo','o-hi'],['mid','neg'],['mid','pos']].forEach(([lo,hi])=>{
   const A=lo==='mid'?mid:v(b,'hc-'+lo),B=v(b,'hc-'+hi);
   for(let k=0;k<=20;k++){const c=cr(mix(A,B,k/20),hex(ink));if(c<peor){peor=c;det=[tema,lo,hi,k];}}
  });
 });
 t('G4 contraste de la etiqueta de cada celda ≥ 4,5:1 en todo el recorrido de las rampas (azul, naranja, brecha) en modo oscuro y claro',peor>=4.5,{peor:peor.toFixed(2),det});}

const fails=out.filter(l=>l.startsWith('FAIL'));console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));process.exit(fails.length?1:0);
