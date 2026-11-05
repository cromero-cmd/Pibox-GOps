// Uso: node test/pigops_strikes_vigencia_test.js   (sin red ni Firestore; extrae el código real de index.html)
// Política de vigencia de strikes (v18.1): 3 meses calendario (mes actual + 2 anteriores completos), archivo por fecha
// al leer, apelaciones aprobadas fuera de todo conteo, llamados vigentes según el mes en que se emitieron.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
const ENGINE=slice("const STRIKE_CATS=","// Modelo completo de strikes de UN agente");
const REG=slice("const REGLAMENTO_DESDE=","const regIsoLocal"); // el motor de strikes separa las tardanzas del Reglamento (desde 1-nov-2026)
const code=[REG,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,
 'return{STRIKE_CATS,strikeVigencia,strikeExpiryDate,computeAgentStrikes,applyStrikePolicy,STRIKE_AVISO_INFO};'].join('\n');
const E=new Function(code)();
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x||'')));
const D=(y,m,d,hh=12,mm=0)=>new Date(y,m-1,d,hh,mm,0);
const cfg={tardanzaMins:5,nodescHrs:4};
const EM='ana@pibox.app';
const ts=d=>({toDate:()=>d});
// Un día de malla 8:00–16:00 con llegada tardía de `late` min (y salida `extraH` h después del fin programado)
function dia(fecha,late,extraH){
 const [d,m,y]=fecha.split('/').map(Number);
 const row={fecha,usuario:EM,inicio:'8:00:00',fin:'16:00:00',novedad:''};
 const start=new Date(y,m-1,d,8,late,0),end=new Date(y,m-1,d,16+(extraH||0),0,0);
 return{row,turno:{userEmail:EM,status:'ended',startTime:ts(start),endTime:ts(end)}};
}
function calc(dias,now,w,a){const wm=new Map();(w||[]).forEach(x=>wm.set(typeof x==='string'?x:x.id,typeof x==='string'?{motivo:'cita médica',waivedBy:'cromero@pibox.app',waivedByName:'Camilo',waivedAt:'2026-10-10T10:00:00.000Z'}:x));
 const st=E.computeAgentStrikes({email:EM,malla:dias.map(x=>x.row),turnos:dias.map(x=>x.turno),waiverMap:wm,appealMap:new Map((a||[]).map(x=>[x.id,x])),cfg,now});
 return E.applyStrikePolicy(st,now);}

// ── etiquetas / ventana ──
{let v=E.strikeVigencia(D(2026,10,17));
 t('V1 octubre: ventana Agosto–Octubre 2026 (nombres dinámicos)',v.label==='Agosto – Octubre 2026'&&v.nombres==='agosto, septiembre y octubre'&&v.start.getTime()===D(2026,8,1,0).getTime(),JSON.stringify(v.label));
 v=E.strikeVigencia(D(2026,11,1,0,0));t('V1b 1 de noviembre: Septiembre–Noviembre 2026',v.label==='Septiembre – Noviembre 2026'&&v.nombres==='septiembre, octubre y noviembre');
 v=E.strikeVigencia(D(2027,1,15));t('V1c enero: cruza el año («Noviembre 2026 – Enero 2027»)',v.label==='Noviembre 2026 – Enero 2027'&&v.nombres==='noviembre, diciembre y enero');}
// ── casos pedidos ──
{const p=calc([dia('31/7/2026',10)],D(2026,10,17));
 t('T1 un strike del 31 de julio NO cuenta en octubre (queda como Vencido)',p.totalActive===0&&p.vencidos.length===1&&p.counts.leve===0);}
{const dias=[dia('1/8/2026',10)];
 let p=calc(dias,D(2026,10,17));t('T2a un strike del 1 de agosto SÍ cuenta el 17 de octubre',p.totalActive===1&&p.vencidos.length===0);
 p=calc(dias,D(2026,10,31,23,59));t('T2b …y todavía cuenta el 31 de octubre 23:59',p.totalActive===1);
 p=calc(dias,D(2026,11,1,0,0));t('T2c …y el 1 de noviembre deja de contar (Vencido)',p.totalActive===0&&p.vencidos.length===1);
 t('T2d …fecha en que deja de contar = 1/11/2026',E.strikeExpiryDate(D(2026,8,1)).getTime()===D(2026,11,1,0).getTime());}
{const dias=[dia('3/9/2026',10),dia('10/9/2026',10),dia('17/9/2026',10)];
 let p=calc(dias,D(2026,10,17));t('T3a base: 3 leves vigentes = 1 llamado',p.totalActive===3&&p.totalLlamados===1);
 p=calc(dias,D(2026,10,17),[EM+'_20260910_tardanza']);
 t('T3b un strike con apelación aprobada NO cuenta: 2 vigentes, 0 llamados, 1 en «retirados»',p.totalActive===2&&p.totalLlamados===0&&p.waived.length===1&&p.counts.leve===2);
 t('T3c …y no suma al avance hacia el próximo llamado (pending=2, faltan 1)',p.pending.leve===2);
 const w=[{id:EM+'_20260910_tardanza',motivo:'cita',appealId:EM+'_20260910_tardanza',waivedByName:'Coord',waivedAt:'2026-10-12T00:00:00.000Z',appeal:null}];
 const apr={id:EM+'_20260910_tardanza',status:'approved',decidedByName:'Marta Coordinadora',decidedAt:'2026-10-12T15:00:00.000Z'};
 p=calc(dias,D(2026,10,17),w,[apr]);
 t('T3d la apelación aprobada queda en el Historial con quién y cuándo',p.waived.length===1&&p.waived[0].waived.appeal&&p.waived[0].waived.appeal.decidedByName==='Marta Coordinadora');}
{const dias=[dia('6/7/2026',10),dia('13/7/2026',10),dia('20/7/2026',10)];
 let p=calc(dias,D(2026,10,17));
 t('T4a un llamado originado por strikes archivados NO cuenta (julio, visto en octubre)',p.totalLlamados===0&&p.llamadosArchived.length===1&&p.totalActive===0);
 p=calc(dias,D(2026,8,25));t('T4b …pero en agosto sí contaba (control)',p.totalLlamados===1&&p.llamadosActive.length===1);}
// ── casos adicionales de la regla ──
{const dias=[dia('30/6/2026',10),dia('15/7/2026',10),dia('5/8/2026',10)];
 let p=calc(dias,D(2026,10,17));
 t('E1 llamado emitido en agosto con strikes de junio/julio: SIGUE vigente en octubre (cuenta el mes de emisión)',p.totalLlamados===1&&p.totalActive===1&&p.llamadosActive[0].issued.getMonth()===7,JSON.stringify([p.totalLlamados,p.totalActive]));
 p=calc(dias,D(2026,11,1,0,0));t('E1b …y el 1 de noviembre se archiva',p.totalLlamados===0&&p.llamadosArchived.length===1);}
{const dias=[dia('6/7/2026',10),dia('13/7/2026',10),dia('10/10/2026',10)];
 const p=calc(dias,D(2026,10,17));
 t('E2 los strikes archivados NO se acumulan hacia llamados nuevos (2 de julio + 1 de octubre = 0 llamados)',p.totalLlamados===0&&p.totalActive===1&&p.pending.leve===1);}
{const p=calc([dia('3/9/2026',70)],D(2026,10,17));t('E3 una tardanza grave (≥60 min) = 1 llamado',p.totalLlamados===1&&p.counts.grave===1);
 const q=calc([dia('3/9/2026',25),dia('4/9/2026',30)],D(2026,10,17));t('E4 2 moderadas (20–59 min) = 1 llamado',q.totalLlamados===1&&q.counts.moderada===2);
 const r=calc([dia('1/9/2026',0,5),dia('2/9/2026',0,5),dia('3/9/2026',0,5)],D(2026,10,17));t('E5 3 no desconexión (>4 h tras la salida) = 1 llamado',r.totalLlamados===1&&r.counts.nodesc===3);
 const s=calc([dia('1/9/2026',70),dia('2/9/2026',70),dia('3/9/2026',70)],D(2026,10,17));t('E6 3 llamados vigentes (cualquier combinación) = proceso disciplinario',s.totalLlamados===3);}
{const a=calc([dia('3/9/2026',5)],D(2026,10,17));const b=calc([dia('3/9/2026',6)],D(2026,10,17));
 t('E7 tolerancia: 5 min no es strike, 6 min es leve',a.totalActive===0&&b.counts.leve===1);
 const d1=dia('3/9/2026',30);d1.row.novedad='INCAPACIDAD';
 t('E8 un día con novedad en la malla no genera strike',calc([d1],D(2026,10,17)).totalActive===0);}
{const dias=[dia('3/9/2026',10),dia('4/9/2026',10),dia('5/9/2026',10)];
 const p=calc(dias,D(2026,10,17));
 t('E9 el motor sigue reconstruyendo 1 llamado de 3 leves SOLO como dato interno (la interfaz ya no lo muestra ni lo envía)',p.totalLlamados===1&&p.llamadosActive[0].strikes.length===3);
 const k=calc([dia('3/9/2026',10),dia('4/9/2026',10),dia('5/9/2026',10)],D(2026,10,17),[{id:EM+'_20260903_tardanza',motivo:'x',waivedBy:'admin@pibox.app'}]);
 t('E10 un retiro directo (sin apelación) también sale de todos los contadores',k.totalActive===2&&k.totalLlamados===0&&k.waived.length===1&&!k.waived[0].waived.appealId);}
{// turnos duplicados el mismo día (caso real de un agente, 16-oct): manda el inicio más temprano, no el orden de lectura
 const d=dia('16/10/2026',0);const dup={userEmail:EM,status:'active',startTime:ts(new Date(2026,9,16,8,56,0)),endTime:null};
 d.turno.status='active';d.turno.endTime=null;
 const a=E.computeAgentStrikes({email:EM,malla:[d.row],turnos:[dup,d.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,16,23,0)});
 const b=E.computeAgentStrikes({email:EM,malla:[d.row],turnos:[d.turno,dup],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,16,23,0)});
 t('E11 turnos activos duplicados el mismo día: mismo resultado sin importar el orden de lectura (usa el más temprano)',a.length===b.length&&a.every((x,i)=>x.cat===b[i].cat),JSON.stringify([a.map(x=>x.cat),b.map(x=>x.cat)]));}
{// turno activo huérfano (nunca se cerró) vs turno activo de hoy
 const orf=dia('1/10/2026',0);orf.turno.status='active';orf.turno.endTime=null;
 const a=E.computeAgentStrikes({email:EM,malla:[orf.row],turnos:[orf.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,17,22,0)});
 t('E12 turno «active» huérfano de hace días NO inventa un strike de no desconexión',a.length===0,JSON.stringify(a.map(x=>x.cat)));
 const hoy=dia('17/10/2026',0);hoy.turno.status='active';hoy.turno.endTime=null;
 const b=E.computeAgentStrikes({email:EM,malla:[hoy.row],turnos:[hoy.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,17,21,30)});
 t('E13 un turno activo de HOY (aún sin cierre) tampoco genera no desconexión: sin salida real no hay falta (regla: los turnos sin cierre no cuentan)',b.length===0,JSON.stringify(b.map(x=>x.cat)));}
// ═══ Desde el 1-nov-2026: strikes solo informativos, ventana de 3 meses y hora de salida real (5-nov-2026) ═══
{// No desconexión: una salida real ANTES de la programada nunca es no desconexión
 const NOW=D(2026,11,5,12,0);
 const mk=(fecha,ini,fin,s,e)=>{const [d,m,y]=fecha.split('/').map(Number);const row={fecha,usuario:EM,inicio:ini,fin,novedad:''};
  return{row,turno:{userEmail:EM,status:'ended',startTime:ts(s),endTime:ts(e)}};};
 const nodesc=(x,now)=>E.computeAgentStrikes({email:EM,malla:[x.row],turnos:[x.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:now||NOW}).filter(s=>s.cat==='nodesc');
 let x=mk('3/11/2026','7:00:00','15:30:00',D(2026,11,3,7,0),D(2026,11,3,9,30));
 t('ND1 salida real 09:30 a. m. con salida programada 15:30 (mismo día): NO es no desconexión',nodesc(x).length===0);
 x=mk('3/11/2026','7:00:00','15:30:00',D(2026,11,3,7,0),D(2026,11,3,15,29));
 t('ND2 salida real un minuto antes de lo programado: no es no desconexión',nodesc(x).length===0);
 x=mk('3/11/2026','7:00:00','15:30:00',D(2026,11,3,7,0),D(2026,11,4,9,30));
 t('ND3 caso del correo del 5-nov: turno 7:00–15:30 CERRADO AL DÍA SIGUIENTE a las 09:30 — no hay hora real de salida: no es no desconexión',nodesc(x).length===0,JSON.stringify(nodesc(x)));
 x=mk('3/11/2026','7:00:00','15:30:00',D(2026,11,3,7,0),D(2026,11,3,21,30));
 const n4=nodesc(x);t('ND4 salida real el MISMO día más de 4 h tarde (21:30) sí es no desconexión, y el texto lo dice completo',n4.length===1&&/salida programada 15:30:00, salida real 09:30 p\. m\./.test(n4[0].detalle),JSON.stringify(n4.map(s=>s.detalle)));
 x=mk('3/11/2026','7:00:00','15:30:00',D(2026,11,3,7,0),D(2026,11,3,19,30));
 t('ND5 exactamente 4 h tarde (19:30) no cuenta (se exige MÁS de 4 h)',nodesc(x).length===0);
 x=mk('3/11/2026','22:00:00','06:00:00',D(2026,11,3,22,0),D(2026,11,4,11,0));
 t('ND6 turno nocturno 22:00→06:00 con salida real 11:00 del día de su fin (5 h tarde): sí cuenta',nodesc(x).length===1,JSON.stringify(nodesc(x)));
 x=mk('3/11/2026','22:00:00','06:00:00',D(2026,11,3,22,0),D(2026,11,5,9,30));
 t('ND7 turno nocturno cerrado DOS días después: no es no desconexión',nodesc(x).length===0);
 x=mk('3/11/2026','22:00:00','06:00:00',D(2026,11,3,22,0),D(2026,11,4,5,30));
 t('ND8 turno nocturno que sale antes de su fin (05:30 < 06:00): no es no desconexión',nodesc(x).length===0);}
{// Ventana de 3 meses calendario al 5-nov-2026: septiembre–noviembre; lo anterior pasa a historial
 const NOW=D(2026,11,5,12,0);
 const p=calc([dia('13/6/2026',10),dia('2/8/2026',10),dia('31/8/2026',10),dia('1/9/2026',10),dia('15/10/2026',10),dia('2/11/2026',10)],NOW);
 t('W1 al 5-nov-2026 cuentan 1-sep y 15-oct (la tardanza del 2-nov es del Reglamento, no un strike); 13-jun, 2-ago y 31-ago están VENCIDOS',p.totalActive===2&&p.reglamento.length===1&&p.vencidos.length===3&&p.vencidos.map(s=>s.fecha).sort().join()==='13/6/2026,2/8/2026,31/8/2026',JSON.stringify({a:p.active.map(s=>s.fecha),v:p.vencidos.map(s=>s.fecha)}));
 t('W2 la ventana mostrada es «Septiembre – Noviembre 2026»',E.strikeVigencia(NOW).label==='Septiembre – Noviembre 2026');
 // 8 strikes de 13/06 a 02/11 (el caso del correo): solo los de la ventana cuentan
 const ocho=['13/6/2026','1/7/2026','15/7/2026','3/8/2026','2/9/2026','14/10/2026','28/10/2026','2/11/2026'].map(f=>dia(f,10));
 const q=calc(ocho,NOW);
 t('W3 de 8 faltas entre el 13/06 y el 02/11: 3 strikes vigentes, 4 pasan a historial y la tardanza del 02/11 es del Reglamento',q.totalActive===3&&q.vencidos.length===4&&q.reglamento.length===1,JSON.stringify({a:q.active.length,v:q.vencidos.length,r:q.reglamento.length}));}
{// Texto informativo y ausencia de contadores de llamados en la interfaz
 t('I1 el aviso informativo dice que los strikes no generan llamados y remite al Reglamento desde el 1 de noviembre de 2026',/solo informativos/.test(E.STRIKE_AVISO_INFO)&&/Reglamento Interno de Trabajo/.test(E.STRIKE_AVISO_INFO)&&/1 de noviembre de 2026/.test(E.STRIKE_AVISO_INFO)&&/no generan llamados de atención, escalamientos ni correos/.test(E.STRIKE_AVISO_INFO));
 const sinComentarios=html.replace(/^\s*\/\/.*$/gm,'');
 const prohibidos=['Llamados de atención vigentes','Un llamado más activa','llamado más = descargos','para un llamado de atención','= 1 llamado','Llamado de atención emitido','🚨 Proceso disciplinario','proceso disciplinario</','llamados de atención vencidos','Llamados de atención vencidos','Escala disciplinaria (sin justa causa)','llamado vigente'];
 const hallados=prohibidos.filter(x=>sinComentarios.includes(x));
 t('I2 la interfaz de strikes ya no muestra contadores, escala ni avisos de llamados del modelo antiguo',hallados.length===0,hallados);
 t('I3 index.html no tiene ningún envío de llamado/proceso disciplinario del modelo antiguo',!/type=strike_warning|type=disciplinary_warning|notifyStrikeLevels/.test(sinComentarios));
 t('I4 «totalLlamados» solo existe dentro del motor (sin uso en la interfaz)',(sinComentarios.match(/totalLlamados/g)||[]).length===1);
 t('I5 el aviso se muestra en Mis strikes, en Insights y en el historial del admin',(sinComentarios.match(/STRIKE_AVISO_INFO/g)||[]).length>=4);}
// ═══ Render real de «Mis strikes» (loadStrikes) con el modelo nuevo ═══
(async()=>{
 const badge=html.match(/^const STRIKE_BADGE=.*$/m)[0];
 const code2=[REG,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,badge,fn("function strikeWaivedInfo(s){"),fn("function strikeMonthsHTML(model,opts){"),fn("function strikeHistorialHTML(model,idp){"),fn("async function loadStrikes(){"),
  'return{loadStrikes};'].join('\n');
 const els={};const el=id=>els[id]=els[id]||{id,style:{},innerHTML:'',textContent:id==='user-email'?EM:id==='user-name'?'Ana':''};
 const doc={getElementById:id=>el(id)};
 const now=new Date();
 const wrap={window:{},document:doc};
 const dias=[dia('3/9/2026',10),dia('4/9/2026',30),dia('5/9/2026',70)];
 const mkModel=()=>{const p=calc(dias,D(2026,11,5,12,0));return{email:EM,now:D(2026,11,5,12,0),cfg,malla:[{fecha:'3/9/2026',usuario:EM,lider:'jefe@pibox.app'}],mallaFalló:false,...p};};
 const reglCalls=[];
 const L=new Function('document','window','buildAgentStrikeModel','loadReglamentoAgente','esc','isSuperAdminUser','ADMINS',code2)(doc,{},async()=>mkModel(),(...a)=>{reglCalls.push(a);return Promise.resolve();},x=>String(x),()=>false,[]);
 await L.loadStrikes();
 const H=el('strikes-list').innerHTML,S=el('strikes-summary').innerHTML,T=el('strikes-title').textContent;
 t('UI1 «Mis strikes» muestra el aviso informativo y el título dice «(informativo)»',H.includes(E.STRIKE_AVISO_INFO)&&/informativo/.test(T),T);
 t('UI2 muestra los strikes vigentes (3) y el distintivo «solo informativo»',/3 strikes · solo informativo/.test(S)&&/>3<\/div>/.test(H),S);
 t('UI3 NO muestra llamados, escalamiento ni proceso disciplinario del modelo antiguo',!/Llamados? de atención vigentes?|llamado más|Proceso disciplinario|descargos|Faltan \d+ strike|= 1 llamado|Escala disciplinaria/i.test(H+S),(H+S).match(/Llamados? de atención vigentes?|llamado más|Proceso disciplinario|descargos|Faltan \d+ strike|= 1 llamado|Escala disciplinaria/i));
 t('UI4 sigue entregando la sección del Reglamento y el botón de apelar',reglCalls.length===1&&/apelarStrike/.test(H));
 t('UI5 el medidor de llamados ya no existe en la página',!/id="strike-meter-fill"/.test(html));
})().then(()=>{out.forEach(l=>console.log(l));const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log(`\n${out.length-fails}/${out.length} pasan`);process.exit(fails?1:0);}).catch(e=>{console.error('ERROR',e);process.exit(2);});
