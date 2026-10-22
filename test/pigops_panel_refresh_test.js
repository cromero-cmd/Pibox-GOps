// Uso: node test/pigops_panel_refresh_test.js   (sin red ni Firestore: todo está simulado, nada se escribe en producción)
// Botón ↻ del Panel de Control (v18.3): refresca TODO el panel con datos frescos, con una lectura por módulo.
// Ejecuta el código REAL de index.html (los wrappers de Firestore del bloque module y el script clásico completo,
// incluidos loadPanel2 / refreshPanel / Insights / badges / modales) dentro de un contexto `vm` con un DOM mínimo y un
// Firestore falso que CUENTA cada consulta (getDocs) y puede fallar o demorarse a demanda.
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(process.env.HTML_PATH||path.join(__dirname,'..','index.html'),'utf8'); // HTML_PATH: para comparar contra una versión anterior
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const CLASSIC=scripts.sort((a,b)=>b.length-a.length)[0];
const mod=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const WRAPPERS=mod.slice(mod.indexOf('window.getAbsences = async'),mod.indexOf('window.loadAnalytics = async'));
const STATIC_IDS=new Set([...html.replace(/<script[\s\S]*?<\/script>/g,'').matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sum=r=>Object.values(r).reduce((a,b)=>a+b,0);

function build(){
 const today=new Date();const sod=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const mk=(email,nombre,linea,lider)=>({email,nombre,linea,lider});
 const AG=[mk('a1@pibox.app','Ana Uno','L1','jefe1@pibox.app'),mk('a2@pibox.app','Beto Dos','L1','jefe1@pibox.app'),mk('a3@pibox.app','Carla Tres','L2','jefe2@pibox.app'),
  mk('a4@pibox.app','Dario Cuatro','L2','jefe2@pibox.app'),mk('a5@pibox.app','Elsa Cinco','L1','jefe1@pibox.app')];
 const ts=d=>({toDate:()=>d,seconds:Math.floor(d.getTime()/1000)});
 const F={ // «Firestore»
  turnos:[
   {id:'T1',userEmail:'a1@pibox.app',userName:'Ana Uno',status:'active',startTime:ts(new Date(sod.getTime()+1000)),endTime:null},
   {id:'T2',userEmail:'a2@pibox.app',userName:'Beto Dos',status:'ended',startTime:ts(new Date(sod.getTime()+2000)),endTime:ts(new Date(sod.getTime()+3000))},
   {id:'T3',userEmail:'a3@pibox.app',userName:'Carla Tres',status:'active',startTime:ts(new Date(sod.getTime()+4000)),endTime:null},
   {id:'T5',userEmail:'a5@pibox.app',userName:'Elsa Cinco',status:'ended',startTime:ts(new Date(sod.getTime()+5000)),endTime:ts(new Date(sod.getTime()+6000)),earlyLeave:true,earlyLeaveStatus:'pending_review',earlyLeaveMins:30,earlyLeaveReason:'cita'},
   // turnos de meses anteriores (para la caché de strikes de 5 meses)
   {id:'OLD1',userEmail:'a1@pibox.app',userName:'Ana Uno',status:'ended',startTime:ts(new Date(sod.getFullYear(),sod.getMonth()-2,10,8,0,0)),endTime:ts(new Date(sod.getFullYear(),sod.getMonth()-2,10,16,0,0))},
   {id:'OLD2',userEmail:'a2@pibox.app',userName:'Beto Dos',status:'ended',startTime:ts(new Date(sod.getFullYear(),sod.getMonth()-3,12,8,0,0)),endTime:ts(new Date(sod.getFullYear(),sod.getMonth()-3,12,16,0,0))}
  ],
  absences:[],
  events:[
   {id:'E1',type:'overtime',status:'pending_review',agentEmail:'a1@pibox.app',agentName:'Ana Uno',extraMins:30,timestamp:ts(new Date(sod.getTime()+1000)),date:'hoy'},
   {id:'E2',type:'overtime',status:'approved',agentEmail:'a2@pibox.app',agentName:'Beto Dos',extraMins:20,timestamp:ts(new Date(sod.getTime()+2000)),mallaEntry:{fecha:`${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}`}}
  ],
  strike_waivers:[{id:'a1@pibox.app_20260101_tardanza',userEmail:'a1@pibox.app',cat:'tardanza',fecha:'1/1/2026'}],
  reglamento_casos:[{id:'ana_20261104_reg',tipoRegistro:'tardanza',userEmail:'a1@pibox.app',userName:'Ana Uno',tipo:'llamado',estado:'En plazo de justificación',fecha:'04/11/2026',fechaISO:'2026-11-04',limiteISO:'2026-11-09',minutos:14,programada:'8:00 a. m.',inicioReal:'8:14 a. m.'}],
  comunicados_lectura:[{id:'reglamento-tardanzas-2026-11_a1@pibox.app',email:'a1@pibox.app',nombre:'Ana Uno',comunicadoId:'reglamento-tardanzas-2026-11',confirmadoAt:{toDate:()=>new Date(2026,9,22,9,30,0)}},{id:'otro_a2@pibox.app',email:'a2@pibox.app',nombre:'Beto Dos',comunicadoId:'otro',confirmadoAt:{toDate:()=>new Date()}}],
  strike_appeals:[{id:'AP1',userEmail:'a2@pibox.app',userName:'Beto Dos',status:'pending',fecha:'2/10/2026',detalle:'llegó tarde',motivo:'trancón',createdAt:new Date().toISOString()}]
 };
 const log=[];const toasts=[];const errors=[];
 const ctrl={fail:{},delay:0,mallaFail:false,mallaCalls:0};
 // ── Firestore falso ──
 const collection=(db,name)=>({name});
 const where=(field,op,val)=>({t:'where',field,op,val});
 const orderBy=(field,dir)=>({t:'order',field,dir});
 const limit=n=>({t:'limit',n});
 const query=(col,...cons)=>({col:col.name,cons});
 const getTime=v=>v&&v.toDate?v.toDate().getTime():(v instanceof Date?v.getTime():v);
 const kindOf=q=>{
  if(q.col==='turnos'){const w=q.cons.filter(c=>c.t==='where');if(!w.length)return'turnos300';if(w.some(x=>x.field==='userEmail'))return'turnosAgente';
   const from=w.find(x=>x.op==='>=').val;return from.getTime()===sod.getTime()?'periodo':'strike';}
  if(q.col==='events')return q.cons.some(c=>c.t==='where')?'aprobadas':'extras';
  if(q.col==='absences')return'ausencias';
  if(q.col==='strike_waivers')return q.cons.some(c=>c.t==='where')?'waiversAgente':'waivers';
  if(q.col==='strike_appeals')return q.cons.some(c=>c.t==='where')?'apelacionesAgente':'apelaciones';
  return q.col;};
 const getDocs=async q0=>{
  const q=q0.cons?q0:{col:q0.name,cons:[]}; // getDocs(collection) sin query
  const kind=kindOf(q);const w=q.cons.filter(c=>c.t==='where');
  log.push({kind,from:w.find(x=>x.op==='>=')?.val,to:w.find(x=>x.op==='<=')?.val});
  if(ctrl.delay)await sleep(ctrl.delay);
  if(ctrl.fail[kind])throw new Error('boom '+kind);
  let rows=(F[q.col]||[]).slice();
  w.forEach(c=>{rows=rows.filter(r=>{const v=(c.field==='timestamp'||c.field==='startTime')?getTime(r[c.field]):r[c.field];const x=getTime(c.val);
   return c.op==='>='?v>=x:c.op==='<='?v<=x:c.op==='=='?v===x:true;});});
  const lim=q.cons.find(c=>c.t==='limit');if(lim)rows=rows.slice(0,lim.n);
  return{docs:rows.map(r=>{const {id,...rest}=r;return{id,data:()=>rest};})};
 };
 const getDoc=async()=>({exists:()=>false,data:()=>null});
 // ── DOM mínimo: solo existen los ids estáticos del HTML; los modales «se abren» agregando su id ──
 const present=new Set(STATIC_IDS);const els={};
 const mkEl=id=>{const base={id,innerHTML:'',textContent:'',value:'',style:{},dataset:{},disabled:false,
  classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,f){f?this._s.add(c):this._s.delete(c)},contains(c){return this._s.has(c)}},
  _attrs:{},setAttribute(k,v){this._attrs[k]=v},removeAttribute(k){delete this._attrs[k]},insertAdjacentHTML(pos,h){this.innerHTML=h+this.innerHTML},remove(){present.delete(id)}};
  return new Proxy(base,{get(tg,k){if(k in tg)return tg[k];if(k==='querySelector'||k==='closest')return()=>null;if(k==='querySelectorAll')return()=>[];if(k==='options')return[];if(typeof k==='symbol')return undefined;return()=>{};},set(tg,k,v){tg[k]=(k==='textContent'||k==='innerHTML'||k==='value')?String(v):v;return true;}});};
 const getEl=id=>{if(!present.has(id))return null;return els[id]||(els[id]=mkEl(id));};
 const document={getElementById:getEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('__new'),body:mkEl('body'),addEventListener(){},documentElement:mkEl('html'),head:mkEl('head')};
 const store={};
 const mallaCsv=()=>{const f=`${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}`;
  const rows=['"Día","FECHA","Usuario","NOMBRE","Rol","Inicio","Fin","Almuerzo","Línea","Líder","Novedad"'];
  for(let i=0;i<25;i++)rows.push(`x,1/1/2026,fill${i}@pibox.app,Fill${i},R,8:00:00,16:00:00,1,L9,jefe9@pibox.app,`);
  AG.forEach(a=>rows.push(`x,${f},${a.email},${a.nombre},R,8:00:00,16:00:00,1,${a.linea},${a.lider},`));
  return rows.join('\n');};
 const fetchImpl=async url=>{
  if(String(url).startsWith('https://script.google.com/macros/s/AKfycbyxBZ')){
   ctrl.mallaCalls++;
   if(ctrl.mallaFail)return{ok:false,status:500,text:async()=>''};
   return{ok:true,status:200,text:async()=>mallaCsv()};}
  return{ok:false,status:404,text:async()=>''};};
 const con={log(){},warn(){},info(){},error:(...a)=>errors.push(a.map(x=>x&&x.message||String(x)).join(' '))};
 const ctx={document,navigator:{userAgent:'x',maxTouchPoints:0},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
  console:con,setTimeout,clearTimeout,setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval,fetch:fetchImpl,URL,Date,Math,JSON,Promise,Map,Set,AbortController,
  collection,where,orderBy,limit,query,getDocs,getDoc,doc:(db,c,i)=>({c,i}),setDoc:async()=>{throw new Error('ESCRITURA PROHIBIDA EN LA PRUEBA');},deleteDoc:async()=>{throw new Error('ESCRITURA PROHIBIDA');},
  serverTimestamp:()=>new Date(),db:{},auth:{currentUser:{email:'cromero@pibox.app'}}};
 ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.matchMedia=()=>({matches:false,addEventListener(){}});
 ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.SUPER_ADMIN='cromero@pibox.app';ctx.ADMINS=['cromero@pibox.app'];
 vm.createContext(ctx);
 vm.runInContext(WRAPPERS,ctx);
 vm.runInContext(CLASSIC,ctx,{timeout:8000});
 ctx.toast=m=>toasts.push(m);
 getEl('user-email').textContent='cromero@pibox.app';
 getEl('user-name').textContent='Camilo';
 return{ctx,F,log,toasts,errors,ctrl,getEl,present,els,AG,sod,ts,store,run:src=>vm.runInContext(src,ctx),
  reads:()=>log.reduce((m,r)=>(m[r.kind]=(m[r.kind]||0)+1,m),{}),reset:()=>{log.length=0;toasts.length=0;errors.length=0;ctrl.mallaCalls=0;}};
}
const H=(app,id)=>String(app.getEl(id)?.innerHTML||'');
const txt=s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

(async()=>{
 // ═══ 1. Carga normal: UNA lectura por módulo (antes: eventos y apelaciones se leían dos veces) ═══
 {const A=build();A.reset();
  await A.ctx.loadPanel2();
  const r=A.reads();
  t('N1 carga normal: turnos recientes se leen 1 vez (badge de salidas anticipadas comparte la lectura)',r.turnos300===1,r);
  t('N2 carga normal: eventos de horas extras 1 vez (badge + tabla Extras comparten)',r.extras===1,r);
  t('N3 carga normal: apelaciones 1 vez (badge + Insights comparten)',r.apelaciones===1,r);
  t('N4 carga normal: ausencias, retiros, período, extras aprobadas, strikes y llamados de atención: 1 lectura cada una',r.ausencias===1&&r.waivers===1&&r.periodo===1&&r.aprobadas===1&&r.strike===1&&r.reglamento_casos===1&&r.comunicados_lectura===1,r);
  t('N5 carga normal: 10 consultas en total',sum(r)===10,r);
  t('N6 carga normal pinta las tarjetas «En turno ahora» (Ana y Carla)',/Ana Uno/.test(H(A,'panel2-active'))&&/Carla Tres/.test(H(A,'panel2-active'))&&!/Beto Dos/.test(H(A,'panel2-active')));
  const bal=txt(H(A,'panel2-balance-card'));
  t('N7 balance hoy: 5 programados, 4 registraron, 1 pendiente',/Programados 5 .*Registraron turno 4 .*Pendientes 1/.test(bal),bal);
  t('N8 badges: horas extras 1, salidas anticipadas 1, apelaciones 1, llamados en plazo 1',A.getEl('overtime-badge').textContent==='1'&&A.getEl('earlyleave-badge').textContent==='1'&&A.getEl('strike-appeals-badge').textContent==='1'&&A.getEl('reg-casos-badge').textContent==='1',[A.getEl('overtime-badge').textContent,A.getEl('earlyleave-badge').textContent,A.getEl('strike-appeals-badge').textContent]);
  t('N9 la carga normal deja el texto «Actualizado …» junto al ↻',/^Actualizado \d/.test(A.getEl('panel-last-update').textContent),A.getEl('panel-last-update').textContent);
  t('N10 sin errores en consola en la carga normal',A.errors.length===0,A.errors);
  A.reset();await A.ctx.loadPanel2();const r2=A.reads();
  t('N11 un cambio de filtro inmediato sigue usando la caché (sin releer turnos recientes ni período)',!r2.turnos300&&!r2.periodo,r2);
 }
 // ═══ 2. Refresco: ignora la caché, una lectura por módulo, caché actualizada ═══
 {const A=build();await A.ctx.loadPanel2();
  // cambios «en el servidor» DESPUÉS de la carga: nuevo turno activo de Dario, nueva extra pendiente y nueva apelación
  A.F.turnos.unshift({id:'T4',userEmail:'a4@pibox.app',userName:'Dario Cuatro',status:'active',startTime:A.ts(new Date(A.sod.getTime()+7000)),endTime:null});
  A.F.events.push({id:'E3',type:'overtime',status:'pending_review',agentEmail:'a3@pibox.app',agentName:'Carla Tres',extraMins:15,timestamp:A.ts(new Date(A.sod.getTime()+8000)),date:'hoy'});
  A.F.strike_appeals.push({id:'AP2',userEmail:'a3@pibox.app',userName:'Carla Tres',status:'pending',fecha:'3/10/2026',detalle:'x',motivo:'y',createdAt:new Date().toISOString()});
  A.reset();
  const p=A.ctx.refreshPanel();
  const btn=A.getEl('btn-panel-refresh');
  t('R1 mientras carga el botón queda deshabilitado y girando',btn.disabled===true&&btn.classList.contains('spinning'));
  await p;
  const r=A.reads();
  t('R2 un refresh completo = 10 consultas (1 por módulo), con los modales cerrados',sum(r)===10,r);
  t('R3 cada módulo se lee exactamente una vez',r.turnos300===1&&r.ausencias===1&&r.extras===1&&r.apelaciones===1&&r.waivers===1&&r.periodo===1&&r.aprobadas===1&&r.strike===1&&r.reglamento_casos===1&&r.comunicados_lectura===1,r);
  t('R4 el refresh ignoró la caché de 60 s: vio el turno nuevo de Dario en «En turno ahora»',/Dario Cuatro/.test(H(A,'panel2-active')));
  t('R5 balance hoy actualizado (5 registraron, 0 pendientes)',/Registraron turno 5 .*Pendientes 0/.test(txt(H(A,'panel2-balance-card'))),txt(H(A,'panel2-balance-card')));
  t('R6 badges actualizados: horas extras 2, apelaciones 2',A.getEl('overtime-badge').textContent==='2'&&A.getEl('strike-appeals-badge').textContent==='2',[A.getEl('overtime-badge').textContent,A.getEl('strike-appeals-badge').textContent]);
  t('R7 la caché en memoria quedó actualizada con lo nuevo',A.run('window._turnosCache').some(x=>x.id==='T4'));
  t('R8 al terminar el botón vuelve a estar habilitado y sin girar',btn.disabled===false&&!btn.classList.contains('spinning'));
  t('R9 texto «Actualizado h:mm» sin avisos',/^Actualizado \d{1,2}:\d{2}/.test(A.getEl('panel-last-update').textContent)&&!/⚠/.test(A.getEl('panel-last-update').textContent),A.getEl('panel-last-update').textContent);
  t('R10 toast de éxito',A.toasts.some(m=>/Panel actualizado/.test(m)),A.toasts);
  t('R11 sin errores en consola',A.errors.length===0,A.errors);
  t('R12 la malla se pidió 1 vez (Apps Script) ignorando la caché caliente de 1 min',A.ctrl.mallaCalls===1,A.ctrl.mallaCalls);
  const strikeRead=A.log.find(x=>x.kind==='strike');
  const m0=new Date(Math.min(new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime(),Date.now()-7*86400000));
  t('R13 strikes: refresco INCREMENTAL (desde el inicio del mes, no 5 meses atrás)',strikeRead&&strikeRead.from.getTime()===m0.getTime(),strikeRead&&String(strikeRead.from));
  const sc=A.run('window._strikeTurnosCache.data');
  t('R14 …y la caché de strikes conserva los meses anteriores y suma lo nuevo',sc.some(x=>x.id==='OLD1')&&sc.some(x=>x.id==='OLD2')&&sc.some(x=>x.id==='T4'));
  A.reset();A.ctrl.delay=30;
  const p1=A.ctx.refreshPanel();const p2=A.ctx.refreshPanel();await Promise.all([p1,p2]);A.ctrl.delay=0;
  t('R15 un segundo clic mientras carga se ignora (sigue siendo 1 sola ronda de 10 lecturas)',sum(A.reads())===10,A.reads());
  A.run('window._strikeTurnosCache.ts=Date.now()-16*60000');A.reset();await A.ctx.refreshPanel();
  const sr=A.log.find(x=>x.kind==='strike');const s5=new Date(new Date().getFullYear(),new Date().getMonth()-4,1);
  t('R16 con la caché de strikes vencida (>15 min) el refresh hace la lectura completa de 5 meses',sr&&sr.from.getTime()===s5.getTime(),sr&&String(sr.from));
 }
 // ═══ 3. Un módulo falla: los demás se actualizan igual ═══
 {const A=build();await A.ctx.loadPanel2();
  A.F.turnos.unshift({id:'T4',userEmail:'a4@pibox.app',userName:'Dario Cuatro',status:'active',startTime:A.ts(new Date(A.sod.getTime()+7000)),endTime:null});
  A.F.strike_appeals.push({id:'AP2',userEmail:'a3@pibox.app',userName:'Carla Tres',status:'pending',fecha:'3/10/2026',detalle:'x',motivo:'y',createdAt:new Date().toISOString()});
  A.ctrl.fail.extras=true;A.reset();
  await A.ctx.refreshPanel();
  t('F1 falla «Horas extras»: el badge conserva el valor anterior (no se pone en 0)',A.getEl('overtime-badge').textContent==='1'&&A.getEl('overtime-badge').style.display!=='none');
  t('F2 …pero las tarjetas, el balance y las apelaciones SÍ se actualizaron',/Dario Cuatro/.test(H(A,'panel2-active'))&&A.getEl('strike-appeals-badge').textContent==='2');
  t('F3 aviso puntual junto al ↻ nombra el módulo',/⚠.*Horas extras/.test(A.getEl('panel-last-update').textContent),A.getEl('panel-last-update').textContent);
  t('F4 toast de aviso con el módulo que falló',A.toasts.some(m=>/No se pudo actualizar/.test(m)&&/Horas extras/.test(m)),A.toasts);
  t('F5 el botón del módulo queda marcado',A.getEl('btn-overtime-requests').classList.contains('p2-stale'));
  t('F6 el botón ↻ queda habilitado tras el fallo',A.getEl('btn-panel-refresh').disabled===false);
  A.ctrl.fail.extras=false;A.reset();await A.ctx.refreshPanel();
  t('F7 el siguiente refresh correcto limpia el aviso y la marca',!/⚠/.test(A.getEl('panel-last-update').textContent)&&!A.getEl('btn-overtime-requests').classList.contains('p2-stale')&&A.getEl('overtime-badge').textContent==='1');
 }
 // ═══ 4. Falla la lectura del período: la tabla NO se repinta con «Ausente» falsos ═══
 {const A=build();await A.ctx.loadPanel2();
  const tablaAntes=H(A,'panel2-table');
  A.ctrl.fail.periodo=true;A.reset();await A.ctx.refreshPanel();
  t('P1 si falla el período, la tabla queda como estaba (no se vacía ni marca a todos ausentes)',H(A,'panel2-table')===tablaAntes&&tablaAntes.length>0);
  t('P2 …y «En turno ahora» sí se actualiza; el aviso nombra «Turnos del período»',/Turnos del período/.test(A.getEl('panel-last-update').textContent)&&/Ana Uno/.test(H(A,'panel2-active')),A.getEl('panel-last-update').textContent);
 }
 // ═══ 5. Falla TODO Firestore: el panel no se rompe ni se vacía ═══
 {const A=build();await A.ctx.loadPanel2();const activosAntes=H(A,'panel2-active');
  ['turnos300','periodo','ausencias','extras','apelaciones','waivers','aprobadas','strike','reglamento_casos','comunicados_lectura'].forEach(k=>A.ctrl.fail[k]=true);
  A.reset();await A.ctx.refreshPanel();
  t('X1 con Firestore caído el panel conserva lo que mostraba (usa los últimos datos válidos)',H(A,'panel2-active')===activosAntes&&A.getEl('btn-panel-refresh').disabled===false);
  t('X2 el aviso lista los módulos afectados',/⚠/.test(A.getEl('panel-last-update').textContent)&&/Horas extras/.test(A.getEl('panel-last-update').textContent),A.getEl('panel-last-update').textContent);
  t('X3 las fallas de lectura no vacían los badges',A.getEl('overtime-badge').textContent==='1'&&A.getEl('earlyleave-badge').textContent==='1'&&A.getEl('strike-appeals-badge').textContent==='1');
 }
 // ═══ 6. Modales abiertos se actualizan sin cerrarse y SIN lecturas extra ═══
 {const A=build();await A.ctx.loadPanel2();
  ['overtime-list','earlyleave-list','strike-appeals-list','exceeded-weeks-table-wrap','exceeded-weeks-filters'].forEach(id=>A.present.add(id));
  A.F.events.push({id:'E3',type:'overtime',status:'pending_review',agentEmail:'a3@pibox.app',agentName:'Carla Tres',extraMins:15,timestamp:A.ts(new Date(A.sod.getTime()+8000)),date:'hoy'});
  A.F.strike_appeals.push({id:'AP2',userEmail:'a3@pibox.app',userName:'Carla Tres',status:'pending',fecha:'3/10/2026',detalle:'x',motivo:'y',createdAt:new Date().toISOString()});
  A.F.turnos.unshift({id:'T6',userEmail:'a4@pibox.app',userName:'Dario Cuatro',status:'ended',startTime:A.ts(new Date(A.sod.getTime()+9000)),endTime:A.ts(new Date(A.sod.getTime()+9500)),earlyLeave:true,earlyLeaveStatus:'pending_review',earlyLeaveMins:10,earlyLeaveReason:'x'});
  A.reset();await A.ctx.refreshPanel();
  const r=A.reads();
  t('M1 modales abiertos: el refresh sigue haciendo solo 10 consultas (comparten las lecturas del ciclo)',sum(r)===10,r);
  t('M2 modal de horas extras repintado con la solicitud nueva',/Carla Tres/.test(H(A,'overtime-list'))&&/Ana Uno/.test(H(A,'overtime-list')));
  t('M3 modal de salidas anticipadas repintado con la nueva',/Dario Cuatro/.test(H(A,'earlyleave-list'))&&/Elsa Cinco/.test(H(A,'earlyleave-list')));
  t('M4 modal de apelaciones repintado con la nueva',/Carla Tres/.test(H(A,'strike-appeals-list')));
  t('M5 modal de semanas excedidas recalculado sin cerrarse',H(A,'exceeded-weeks-table-wrap').length>0);
  t('M6 los modales siguen presentes (no se cerraron)',['overtime-list','earlyleave-list','strike-appeals-list'].every(id=>A.present.has(id)));
  A.ctrl.fail.extras=true;A.reset();await A.ctx.refreshPanel();
  t('M7 falla de «Horas extras» con el modal abierto: conserva el listado y agrega aviso puntual',/No se pudieron actualizar/.test(H(A,'overtime-list'))&&/Carla Tres/.test(H(A,'overtime-list')),H(A,'overtime-list').slice(0,200));
 }
 // ═══ 6b. Módulos «Llamados de atención» y «Casos para Talento Humano» ═══
 {const A=build();await A.ctx.loadPanel2();
  t('LL0 tras la carga los badges muestran 1 llamado en plazo y 0 casos para TH',A.getEl('reg-casos-badge').textContent==='1'&&A.getEl('th-casos-badge').style.display==='none');
  ['reg-casos-list','th-casos-list'].forEach(id=>A.present.add(id));
  const nuevos=[
   {id:'c_gr1',tipoRegistro:'tardanza',userEmail:'a3@pibox.app',userName:'Carla Tres',tipo:'falta_grave',estado:'Enviado',prueba:false,fecha:'05/11/2026',fechaISO:'2026-11-05',enviadoISO:'2026-11-13',soporteUrl:'https://drive.google.com/file/d/ABC123/view',minutos:15,programada:'8:00 a. m.',inicioReal:'8:15 a. m.',numeroEnVentana:3,causal:'art60_2'},
   {id:'c_gr2',tipoRegistro:'tardanza',userEmail:'a3@pibox.app',userName:'Carla Tres',tipo:'falta_grave',estado:'Enviado',prueba:false,reincidencia:true,fecha:'17/11/2026',fechaISO:'2026-11-17',enviadoISO:'2026-11-23',soporteUrl:'https://drive.google.com/file/d/DEF456/view',minutos:30,programada:'8:00 a. m.',inicioReal:'8:30 a. m.',numeroEnVentana:4},
   {id:'c_gr3',tipoRegistro:'tardanza',userEmail:'a4@pibox.app',userName:'Dario Cuatro',tipo:'falta_grave',estado:'En plazo de justificación',limiteISO:'2026-11-20',fecha:'16/11/2026',fechaISO:'2026-11-16',minutos:12,programada:'8:00 a. m.',inicioReal:'8:12 a. m.',numeroEnVentana:3},
   {id:'c_gr4',tipoRegistro:'art60_13',userEmail:'a2@pibox.app',userName:'Beto Dos',tipo:'falta_grave',estado:'Cerrado',prueba:false,enviadoISO:'2026-11-10',cerradoPor:'cromero@pibox.app',cerradoAt:'2026-11-12T15:30:00.000Z',notaCierre:'Descargos realizados',soporteUrl:'https://drive.google.com/file/d/GHI789/view'},
   {id:'c_l2',tipoRegistro:'tardanza',userEmail:'a3@pibox.app',userName:'Carla Tres',tipo:'llamado',estado:'Enviado',prueba:false,llamadoNumero:1,fecha:'03/11/2026',fechaISO:'2026-11-03',enviadoISO:'2026-11-12',pdfUrl:'https://drive/pdf/1',minutos:9}];
  nuevos.forEach(c=>A.F.reglamento_casos.push(c));
  A.reset();await A.ctx.refreshPanel();
  const L=txt(H(A,'reg-casos-list')),T=txt(H(A,'th-casos-list'));
  t('LL1 «Llamados de atención» se refresca con el ↻ (modal abierto, sin lecturas extra): en plazo y enviados, solo llamados (no faltas graves)',/Llamados en plazo de justificación \(1\)/.test(L)&&/Llamados enviados \(1\)/.test(L)&&!/Falta grave/.test(L)&&sum(A.reads())===10,[L.slice(0,200),A.reads()]);
  t('LL2 tiene botón para cancelar un registro en plazo (con motivo)',/Cancelar \(con motivo\)/.test(H(A,'reg-casos-list')));
  t('LL3 indicador por agente de faltas leves vigentes: Ana 1 de 3, y quien está a una de la falta grave se destaca',/Faltas leves vigentes por agente/.test(L)&&/Ana Uno a1@pibox\.app 1 de 3/.test(L)&&/Carla Tres a3@pibox\.app 3 de 3 · falta grave/.test(L),L.slice(0,400));
  t('TH1 «Casos para Talento Humano» con los 3 estados: Pendiente de enviar (1), Enviado a Talento Humano (2) y Cerrado (1)',/Pendiente de enviar \(1\)/.test(T)&&/Enviado a Talento Humano \(2\)/.test(T)&&/Cerrado \(1\)/.test(T),T.slice(0,300));
  t('TH2 el caso cerrado registra quién y cuándo (y la nota)',/Cerrado por cromero@pibox\.app el 12\/11\/2026/.test(T)&&/Descargos realizados/.test(T),T.slice(-300));
  t('TH3 botón de descarga del Excel de soporte (enlace directo de Drive) en enviados y cerrados',(H(A,'th-casos-list').match(/⬇ Excel de soporte/g)||[]).length===3&&/uc\?export=download&amp;id=ABC123|uc\?export=download&id=ABC123/.test(H(A,'th-casos-list')),H(A,'th-casos-list').slice(0,0));
  t('TH4 la reincidencia se marca, cada caso muestra la causal literal del Reglamento y hay botones de cerrar y de cancelar',/REINCIDENCIA/.test(T)&&/Artículo 60, numeral 2: El retardo injustificado en la hora de entrada, por tercera vez\./.test(T)&&/Artículo 60, numeral 13: Acumular tres \(3\) llamados de atención realizados por su jefe inmediato\./.test(T)&&/Marcar como cerrado/.test(H(A,'th-casos-list'))&&/Cancelar \(con motivo\)/.test(H(A,'th-casos-list')));
  t('TH5 badge de Casos para TH = pendientes + enviados sin cerrar (3); el de llamados sigue en 1',A.getEl('th-casos-badge').textContent==='3'&&A.getEl('reg-casos-badge').textContent==='1',[A.getEl('th-casos-badge').textContent,A.getEl('reg-casos-badge').textContent]);
  A.ctrl.fail.reglamento_casos=true;A.reset();await A.ctx.refreshPanel();
  t('LL4 si falla la lectura: el resto del panel se actualiza, ambos módulos conservan lo anterior y avisan, y los dos botones se marcan',/Llamados de atención/.test(A.getEl('panel-last-update').textContent)&&/Carla Tres/.test(H(A,'th-casos-list'))&&/No se pudieron actualizar/.test(H(A,'th-casos-list'))&&A.getEl('btn-reg-casos').classList.contains('p2-stale')&&A.getEl('btn-th-casos').classList.contains('p2-stale'),A.getEl('panel-last-update').textContent);
 }
 // ═══ 6c. Módulo «Comunicados» ═══
 {const A=build();await A.ctx.loadPanel2();
  t('CO0 tras la carga el badge del módulo muestra 4 pendientes (5 agentes, 1 confirmó el comunicado vigente; la confirmación de OTRO comunicado no cuenta)',A.getEl('comunicados-badge').textContent==='4'&&A.getEl('comunicados-badge').style.display!=='none',A.getEl('comunicados-badge').textContent);
  A.present.add('comunicados-list');
  A.F.comunicados_lectura.push({id:'reglamento-tardanzas-2026-11_a3@pibox.app',email:'a3@pibox.app',nombre:'Carla Tres',comunicadoId:'reglamento-tardanzas-2026-11',confirmadoAt:{toDate:()=>new Date(2026,9,22,10,45,0)}});
  A.reset();await A.ctx.refreshPanel();
  const C=txt(H(A,'comunicados-list'));
  t('CO1 el módulo muestra «2 de 5 leyeron» tras el ↻ (con el modal abierto, 1 sola consulta de lecturas)',/2 de 5 leyeron/.test(C)&&A.reads().comunicados_lectura===1&&sum(A.reads())===10,[C.slice(0,200),A.reads()]);
  t('CO2 lista quién confirmó (con fecha y hora) y quién falta',/Confirmaron \(2\)/.test(C)&&/Ana Uno/.test(C)&&/Carla Tres/.test(C)&&/Faltan por confirmar \(3\)/.test(C)&&/Beto Dos/.test(C)&&/Dario Cuatro/.test(C)&&/Elsa Cinco/.test(C)&&/22\/10\/2026/.test(C),C.slice(0,500));
  t('CO3 hay botón para descargar la lista en Excel',/Descargar lista en Excel/.test(H(A,'comunicados-list')));
  t('CO4 el badge baja a 3 pendientes',A.getEl('comunicados-badge').textContent==='3');
  // Excel: captura de lo que se exporta
  let exportado=null;A.ctx.exportToXLSX=(h,r,f)=>{exportado={h,r,f};};
  A.ctx.descargarComunicadosExcel();
  t('CO5 el Excel trae nombre, correo, estado y fecha y hora de confirmación (confirmaron primero, luego faltan)',exportado&&exportado.h.join()==='Nombre,Correo,Estado,Fecha y hora de confirmación'&&exportado.r.length===5&&exportado.r.filter(x=>x[2]==='Confirmó').length===2&&exportado.r.filter(x=>x[2]==='Falta').length===3&&/^comunicado_reglamento-tardanzas-2026-11_/.test(exportado.f),exportado);
  A.ctrl.fail.comunicados_lectura=true;A.reset();await A.ctx.refreshPanel();
  t('CO6 si falla la lectura de comunicados: el resto del panel se actualiza, el módulo conserva lo anterior y avisa',/Comunicados/.test(A.getEl('panel-last-update').textContent)&&/2 de 5 leyeron/.test(txt(H(A,'comunicados-list')))&&/No se pudo actualizar/.test(H(A,'comunicados-list'))&&A.getEl('btn-comunicados').classList.contains('p2-stale'),A.getEl('panel-last-update').textContent);
 }
 // ═══ 7. Historial de strikes y Nómina abiertos ═══
 {const A=build();await A.ctx.loadPanel2();
  let llamado=null;A.present.add('strike-hist-modal');A.present.add('strike-hist-body');
  A.ctx._strikeHistRefresh=async cyc=>{llamado=cyc;return A.ctx.buildAgentStrikeModel('a1@pibox.app',new Date(),cyc);};
  A.reset();await A.ctx.refreshPanel();
  const r=A.reads();
  t('H1 historial abierto: reutiliza retiros/apelaciones del ciclo y lee solo los turnos del agente (1 consulta extra)',r.turnosAgente===1&&!r.waiversAgente&&!r.apelacionesAgente&&sum(r)===11,r);
  t('H2 el historial recibió el ciclo del refresh',llamado&&llamado.force===true);
  A.ctx._strikeHistRefresh=undefined;A.present.delete('strike-hist-modal');
  A.present.add('payroll-preview-body');A.present.add('payroll-preview-table');A.present.add('payroll-send-btn');
  const lm=new Date();lm.setDate(lm.getDate()-lm.getDay()-6);lm.setHours(0,0,0,0);const ls=new Date(lm);ls.setDate(lm.getDate()+6);ls.setHours(23,59,59);
  A.run(`window._payrollPreviewMeta={weekStart:'x',weekEnd:'y',payrollEmails:'a@b.c',lastSunday:new Date(${ls.getTime()}),lastMonday:new Date(${lm.getTime()})};window._payrollPreviewRecords=[{name:'EDITADO',email:'a1@pibox.app',date:'1-ene-2026',checkIn:'08:00',checkOut:'16:00',almuerzo:'1h',hours:'07:00:00',novedad:'—'}];window._payrollDirty=true;`);
  A.reset();await A.ctx.refreshPanel();
  t('H3 nómina con ediciones sin enviar: NO se sobrescribe y se avisa',A.run('window._payrollPreviewRecords[0].name')==='EDITADO'&&A.toasts.some(m=>/ediciones sin enviar/.test(m)),A.toasts);
  A.run('window._payrollDirty=false;');A.reset();await A.ctx.refreshPanel();
  const r2=A.reads();
  t('H4 nómina abierta sin ediciones: se recalcula con las lecturas del ciclo (+1 consulta: extras aprobadas de la semana pasada)',r2.aprobadas===2&&r2.turnos300===1&&r2.waivers===1&&sum(r2)===11,r2);
  t('H5 …y la tabla de nómina se repinta con datos de la malla',A.run('window._payrollPreviewRecords').every(x=>x.name!=='EDITADO'));
 }
 // ═══ 8. Filtros activos de línea y líder ═══
 {const A=build();A.getEl('panel2-linea-filter-top').value='L2';A.getEl('panel2-linea-filter').value='L2';
  await A.ctx.loadPanel2();A.reset();await A.ctx.refreshPanel();
  const act=txt(H(A,'panel2-active'));
  t('L1 respeta el filtro de línea: solo Carla (L2) en «En turno ahora»',/Carla Tres/.test(act)&&!/Ana Uno/.test(act),act.slice(0,200));
  t('L2 el balance respeta el filtro (L2: 2 programados, 1 registró, 1 pendiente)',/Programados 2 .*Registraron turno 1 .*Pendientes 1/.test(txt(H(A,'panel2-balance-card'))),txt(H(A,'panel2-balance-card')));
  A.getEl('panel2-linea-filter-top').value='';A.getEl('panel2-linea-filter').value='';A.run("window._panel2LiderFilterTop='jefe1@pibox.app'");A.reset();await A.ctx.refreshPanel();
  const act2=H(A,'panel2-active');
  t('L3 respeta el filtro de líder: solo la gente de jefe1',/Ana Uno/.test(act2)&&!/Carla Tres/.test(act2));
 }
 // ═══ 9. Sin escrituras en Firestore ═══
 {const A=build();await A.ctx.loadPanel2();A.reset();await A.ctx.refreshPanel();
  t('W1 ninguna escritura a Firestore durante la carga/refresh (setDoc/deleteDoc lanzarían)',!A.errors.some(e=>/ESCRITURA/.test(e)));
 }
 const fails=out.filter(l=>l.startsWith('FAIL'));
 console.log(out.join('\n'));
 console.log(`\n${out.length-fails.length}/${out.length} pruebas OK`);
 process.exit(fails.length?1:0);
})().catch(e=>{console.error('ERROR en la prueba:',e);process.exit(2);});
