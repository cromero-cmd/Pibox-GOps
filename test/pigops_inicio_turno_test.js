// Uso: node test/pigops_inicio_turno_test.js   (no necesita red ni Firestore: todo está simulado)
// Pruebas del flujo de inicio de turno (v17.9): ubicación (regla A), Windows error 1 (B), Apps Script caído (C).
// Extrae el código REAL de index.html; todo lo externo (Firestore, DOM, geolocalización, fetch, reloj) está simulado.
// No escribe nada en Firestore: saveTurnoToFirebase/updateTurnoInFirebase son stubs que registran las llamadas.
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const lineFn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
const BLOCK_A=slice("const AGENT_CITY_CACHE_KEY","function showTurnoBlocked(");
const BLOCK_B=slice("const MALLA_CACHE_KEY","async function loadMallaPersonal(");
const EXTRA=[lineFn("function parseDate(s){"),lineFn("function parseTime(dateStr,timeStr){"),lineFn("function esNovedadVotaciones(novedad){"),
 html.split('\n').find(l=>l.startsWith('function parseCSVLine(line)'))].join('\n');
const K=50; // los tiempos se aceleran 50×: 45 s de «límite duro» = 0,9 s reales
const realST=setTimeout,realSI=setInterval;
const sleep=ms=>new Promise(r=>realST(r,ms));
const vsleep=ms=>sleep(ms/K); // espera en «tiempo de la app»

function build(env){
 const names=['window','document','localStorage','navigator','fetch','setTimeout','clearTimeout','setInterval','clearInterval','toast','esc','MALLA_SCRIPT','TOLERANCE_MINS','getDeviceInfo','reloadIfOutdated','initTurnoView','setTurnoActive','startTimer','scheduleEndNotification','loadStrikes','showTurnoBlocked','alert','console','screen','E'];
 const body=`let turnoInterval=null,currentTurnoId=null,turnoStartTime=null,accumulatedSeconds=0;
${EXTRA}\n${BLOCK_A}\n${BLOCK_B}
return {startTurno,_doStartTurno,requireLocationForStart,fetchMallaCSV,getMallaForStart,evaluateStartLocation,finishLocationInBackground,
 get currentTurnoId(){return currentTurnoId},get turnoStartTime(){return turnoStartTime},set turnoStartTime(v){turnoStartTime=v}};`;
 const f=new Function(...names,body);
 return f(env.window,env.document,env.localStorage,env.navigator,env.fetch,
 (fn,ms,...a)=>realST(fn,ms/K,...a),clearTimeout,(fn,ms,...a)=>realSI(fn,ms/K,...a),clearInterval,
 env.toast,s=>String(s??''),'https://script.example/exec',5,()=>({isMobile:false,label:'Desktop',ua:'UA'}),async()=>false,
 env.initTurnoView,env.setTurnoActive,()=>{},()=>{},()=>Promise.resolve(),env.showTurnoBlocked,env.alert,{log(){},warn(){},error(){},info(){}},{width:1366},env);
}
function mkEnv(o={}){
 const calls={saved:[],updated:[],toasts:[],alerts:[],blocked:[],active:0,initView:0,notices:[],overlays:[],geo:[],fetchUrls:[]};
 const els={};
 const el=id=>els[id]||(els[id]={id,textContent:id==='user-email'?'lromero@pibox.app':'',style:{},innerHTML:'',disabled:false,_processing:false});
 const doc={overlays:calls.overlays,getElementById:el,body:{appendChild:e=>calls.overlays.push(e)},
  createElement:()=>{const q={};return{style:{},innerHTML:'',removed:false,querySelector(s){return q[s]||(q[s]={onclick:null,textContent:''});},remove(){this.removed=true;}};}};
 // geolocalización simulada: lista de comportamientos por llamada
 const seq=(o.geoSeq||[{ok:true}]).slice();let gi=0;
 const permState={state:o.perm||'granted',onchange:null};
 const nav={userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0',maxTouchPoints:0,
  geolocation:{getCurrentPosition:(ok,err,opts)=>{
   const b=seq[Math.min(gi,seq.length-1)];gi++;calls.geo.push({high:opts.enableHighAccuracy,timeout:opts.timeout,maximumAge:opts.maximumAge});
   if(b.hang)return;
   realST(()=>{if(b.ok)ok({coords:{latitude:6.2,longitude:-75.57}});else err({code:b.err,message:b.err===1?'User denied Geolocation':'x'});},(b.delay||0)/K);}},
  permissions:{query:async()=>permState}};
 if(o.noGeo)delete nav.geolocation;
 const store={};
 if(o.mallaCache)store.pg_malla_csv_cache=JSON.stringify(o.mallaCache);
 const ls={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}};
 const csv=o.csv||mkCsv('lromero@pibox.app',o.novedad||'');
 const fetchImpl=async(url,opts)=>{
  calls.fetchUrls.push(String(url).split('?')[0].slice(-12));
  if(String(url).includes('nominatim')){
   if(o.nominatim==='down')throw new Error('Nominatim caído');
   if(o.nominatim==='flaky'&&(calls.nomN=(calls.nomN||0)+1)===1)throw new Error('Nominatim caído (1.ª vez)');
   if(o.nominatim==='hang')return new Promise(()=>{});
   return {ok:true,json:async()=>({address:{city:o.city||'Medellín'}})};
  }
  if(String(url).includes('BASE')||String(url).includes('BASE%203.0')){return {ok:true,text:async()=>'a,b,c,d,e,f,lromero@pibox.app,h,i,'+(o.registered===undefined?'Medellín':o.registered)};}
  // malla
  const m=(o.mallaSeq||['ok']).slice();const idx=(calls.mallaN=(calls.mallaN||0));calls.mallaN++;
  const b=m[Math.min(idx,m.length-1)];
  if(b==='hang')return new Promise((_,rej)=>{if(opts&&opts.signal)opts.signal.addEventListener('abort',()=>rej(new Error('abort')));});
  if(b==='404')return {ok:false,status:404,text:async()=>''};
  if(b==='fail')throw new Error('network');
  return {ok:true,status:200,text:async()=>csv};
 };
 const win={_requireLocation:o.requireLocation,
  getTodayTurno:async()=>o.today||null,
  newTurnoId:()=>'ID'+(win._ids=(win._ids||0)+1),
  saveTurnoToFirebase:async(data,id)=>{calls.saved.push({data,id,at:Date.now()});if(o.saveFail&&calls.saved.length<=o.saveFail)return null;if(o.saveHang)return new Promise(()=>{});return id||'GEN';},
  updateTurnoInFirebase:async(id,upd)=>{calls.updated.push({id,upd});}};
 return {window:win,document:doc,localStorage:ls,navigator:nav,fetch:fetchImpl,permState,calls,els,store,
  toast:m=>calls.toasts.push(m),alert:m=>calls.alerts.push(m),initTurnoView:async()=>{calls.initView++;},
  setTurnoActive:()=>{calls.active++;},showTurnoBlocked:m=>calls.blocked.push(m)};
}
function mkCsv(email,novedad){
 const d=new Date();const f=`${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
 const start=new Date(d.getTime()-2*60000);const hhmm=`${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')}:00`;
 const rows=['"Día","FECHA","Usuario","NOMBRE","Rol","Inicio","Fin","Almuerzo","Línea","Líder","Novedad"'];
 for(let i=0;i<30;i++)rows.push(`x,${f},u${i}@pibox.app,N${i},R,7:00:00,15:00:00,1,L,J,`);
 rows.push(`x,${f},${email},Lilleyra,R,${hhmm},23:59:00,1,L,Jefe,${novedad}`);
 return rows.join('\n');
}
const out=[];const t=(n,c,extra)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(extra||'')));
const click=(env,id)=>{const ov=env.calls.overlays.filter(o=>!o.removed);const last=ov[ov.length-1];if(!last)return false;const b=last.querySelector(id);if(b&&b.onclick){b.onclick();return true;}return false;};
async function waitOverlay(env,n=1){for(let i=0;i<400;i++){if(env.calls.overlays.filter(o=>!o.removed).length>=n)return true;await sleep(2);}return false;}

(async()=>{
 // ───────── A / B: ubicación nunca bloquea ─────────
 {let e=mkEnv({geoSeq:[{ok:true}]});let G=build(e);let r=await G.requireLocationForStart();
  t('A1 permiso OK: inicia con la posición, sin avisos',r.ok&&r.pos.status==='ok'&&e.calls.overlays.length===0);}
 {let e=mkEnv({geoSeq:[{err:1},{err:1}]});let G=build(e);let r=await G.requireLocationForStart();
  t('A2/B1 permiso concedido + error 1 (Windows): NO bloquea, estado os_blocked, sin modal',r.ok&&r.pos.status==='os_blocked'&&r.pos.code===1&&e.calls.overlays.length===0);
  t('B2 …y se reintentó una vez con alta precisión y sin caché (mitigación)',e.calls.geo.length===2&&e.calls.geo[1].high===true&&e.calls.geo[1].maximumAge===0,JSON.stringify(e.calls.geo));}
 {let e=mkEnv({geoSeq:[{err:1},{ok:true}]});let G=build(e);let r=await G.requireLocationForStart();
  t('B3 error 1 y el reintento con alta precisión SÍ obtiene la ubicación: queda ok',r.ok&&r.pos.status==='ok'&&e.calls.geo.length===2);}
 {let e=mkEnv({geoSeq:[{err:2},{err:2}]});let G=build(e);let r=await G.requireLocationForStart();
  t('A3 error 2 (posición no disponible): inicia, estado unavailable',r.ok&&r.pos.status==='unavailable'&&e.calls.overlays.length===0);}
 {let e=mkEnv({geoSeq:[{err:3},{err:3}]});let G=build(e);let r=await G.requireLocationForStart();
  t('A4 error 3 (timeout): inicia, estado timeout',r.ok&&r.pos.status==='timeout');}
 {let e=mkEnv({geoSeq:[{hang:true},{hang:true}]});let G=build(e);const t0=Date.now();let r=await G.requireLocationForStart();const virt=(Date.now()-t0)*K/1000;
  t('A5 el navegador NUNCA responde: se rinde sola (≈19 s virtuales) y el turno inicia',r.ok&&r.pos.status==='timeout'&&virt>15&&virt<30,'virt='+virt.toFixed(1));}
 {let e=mkEnv({perm:'denied'});let G=build(e);const p=G.requireLocationForStart();await waitOverlay(e);
  const html=e.calls.overlays[0].innerHTML;
  t('A6 permiso bloqueado: modal informativo CON «Continuar sin ubicación»',/Continuar sin ubicación/.test(html)&&/Si no puedes activarla ahora, tu turno inicia igual/.test(html)&&!/Cancelar/.test(html));
  click(e,'#loc-skip');const r=await p;
  t('A7 …al continuar sin ubicación: inicia con estado denied',r.ok&&r.pos.status==='denied'&&r.pos.skipped===true);}
 {let e=mkEnv({perm:'denied',geoSeq:[{ok:true}]});let G=build(e);const p=G.requireLocationForStart();await waitOverlay(e);e.permState.state='granted';click(e,'#loc-retry');const r=await p;
  t('A8 permiso bloqueado → lo activa → reintentar: obtiene la ubicación',r.ok&&r.pos.status==='ok');}
 {let e=mkEnv({perm:'prompt',geoSeq:[{hang:true}]});let G=build(e);const p=G.requireLocationForStart();await waitOverlay(e);
  t('A9 aviso del navegador sin responder: overlay con «Continuar sin ubicación»',/Continuar sin ubicación/.test(e.calls.overlays[0].innerHTML));
  click(e,'#loc-skip');const r=await p;t('A10 …continuar: inicia (estado timeout, sin bloquear)',r.ok&&r.pos.status==='timeout'&&r.pos.skipped);}
 {let e=mkEnv({perm:'prompt',geoSeq:[{hang:true}]});let G=build(e);const t0=Date.now();const r=await G.requireLocationForStart();const virt=(Date.now()-t0)*K/1000;
  t('A11 aviso del navegador ignorado: tope de 90 s virtuales y el turno inicia',r.ok&&virt>85&&virt<100,'virt='+virt.toFixed(1));}
 {let e=mkEnv({perm:'denied'});let G=build(e);const t0=Date.now();const r=await G.requireLocationForStart();const virt=(Date.now()-t0)*K/1000;
  t('A12 modal sin respuesta: se continúa solo a los 180 s virtuales',r.ok&&r.pos.status==='denied'&&virt>170&&virt<195,'virt='+virt.toFixed(1));}
 {let e=mkEnv({noGeo:true});let G=build(e);let r=await G.requireLocationForStart();t('A13 navegador sin geolocalización: inicia (unsupported)',r.ok&&r.pos.status==='unsupported');}
 {let e=mkEnv({perm:'denied'});let G=build(e);const ctl={};const p=G.requireLocationForStart(ctl);await waitOverlay(e);ctl.cancelled=true;ctl._close&&ctl._close();const r=await p;
  t('A14 si el inicio se aborta (malla bloquea) el aviso de ubicación se cierra solo',r.ok&&e.calls.overlays.every(o=>o.removed));}

 // ───────── C: Apps Script / malla ─────────
 {let e=mkEnv({mallaSeq:['hang','ok']});let G=build(e);const t0=Date.now();const r=await G.getMallaForStart();const virt=(Date.now()-t0)*K/1000;
  t('C1 el 1.er pedido se cuelga: el de cobertura (a los 5 s) responde y se usa',!!r.csv&&!r.fromCache&&virt>4&&virt<12,'virt='+virt.toFixed(1)+' fromCache='+r.fromCache);}
 {let e=mkEnv({mallaSeq:['404','ok']});let G=build(e);const t0=Date.now();const r=await G.getMallaForStart();const virt=(Date.now()-t0)*K/1000;
  t('C2 el 1.er pedido da 404: se lanza el segundo de inmediato',!!r.csv&&virt<3,'virt='+virt.toFixed(1));}
 {const ageMs=60*60000;let e=mkEnv({mallaSeq:['hang'],mallaCache:{csv:mkCsv('lromero@pibox.app',''),ts:Date.now()-ageMs}});let G=build(e);const t0=Date.now();const r=await G.getMallaForStart();const virt=(Date.now()-t0)*K/1000;
  t('C3 Apps Script caído y hay caché de hace 60 min: se usa la caché (no se queda esperando)',!!r.csv&&r.fromCache&&r.ageMin>=59&&virt<45,'virt='+virt.toFixed(1)+' '+JSON.stringify({fc:r.fromCache,age:r.ageMin}));
  t('C4 …y se avisa con el toast de caché local',e.calls.toasts.some(x=>/Malla desde caché local/.test(x)),JSON.stringify(e.calls.toasts));}
 {let e=mkEnv({mallaSeq:['hang']});let G=build(e);const t0=Date.now();const r=await G.getMallaForStart();const virt=(Date.now()-t0)*K/1000;
  t('C5 Apps Script caído y SIN caché: devuelve csv:null en ≤22 s (el turno inicia sin validar)',r.csv===null&&virt<25,'virt='+virt.toFixed(1));}

 // ───────── Flujo completo _doStartTurno / startTurno ─────────
 const run=async(o,pre)=>{const e=mkEnv(o);const G=build(e);if(pre)await pre(e,G);const t0=Date.now();await G.startTurno();e.virt=(Date.now()-t0)*K/1000;e.G=G;return e;};
 {const e=await run({});const s=e.calls.saved[0];
  t('F1 camino feliz: 1 turno guardado, ubicación validada, UI activada',e.calls.saved.length===1&&s.data.locationStatus==='ok'&&s.data.locationMatch===true&&e.calls.active===1&&e.G.currentTurnoId===s.id);
  const badKeys=Object.keys(s.data).filter(k=>/^(lat|lon|latitude|longitude|coords|position)/i.test(k));t('F2 no se guardan coordenadas (solo la ciudad)',badKeys.length===0&&s.data.locationCity==='Medellín',JSON.stringify(Object.keys(s.data)));}
 {const e=mkEnv({perm:'denied'});const G=build(e);const before=new Date();const p=G.startTurno();await waitOverlay(e);await vsleep(60000);click(e,'#loc-skip');await p;
  const s=e.calls.saved[0];
  t('F3 la hora de inicio se fija ANTES del modal (60 s virtuales en el modal no le suman tardanza)',s&&(s.data.startTime.getTime()-before.getTime())<2000,'delta='+(s&&(s.data.startTime-before)));
  t('F4 …y el turno inicia con estado denied',s&&s.data.locationStatus==='denied'&&e.calls.active===1);}
 {const e=await run({geoSeq:[{err:1},{err:1}]});const s=e.calls.saved[0];
  t('F5 Windows error 1 con permiso: turno iniciado, locationStatus os_blocked, sin modal',s&&s.data.locationStatus==='os_blocked'&&s.data.locationErrorCode===1&&e.calls.overlays.length===0);
  t('F6 …y el agente ve un aviso persistente con los pasos de Windows',e.els['turno-start-notice']&&/Windows|Configuración/.test(e.els['turno-start-notice'].innerHTML));}
 {const e=await run({geoSeq:[{err:2},{err:2}]});t('F7 error 2: turno iniciado (unavailable)',e.calls.saved[0]&&e.calls.saved[0].data.locationStatus==='unavailable');}
 {const e=await run({geoSeq:[{err:3},{err:3}]});t('F8 error 3: turno iniciado (timeout)',e.calls.saved[0]&&e.calls.saved[0].data.locationStatus==='timeout');}
 {const e=await run({nominatim:'down'});const s=e.calls.saved[0];
  t('F9 Nominatim caído: turno iniciado con geocode_failed, sin demora',s&&s.data.locationStatus==='geocode_failed'&&e.virt<15,'virt='+e.virt.toFixed(1));
}
 {const e=await run({nominatim:'flaky'});const id=e.calls.saved[0].id;await vsleep(8000);const u=e.calls.updated.find(x=>x.id===id);
  t('F10 Nominatim falla 1 vez: el turno inicia con geocode_failed y la ciudad se completa en segundo plano',e.calls.saved[0].data.locationStatus==='geocode_failed'&&u&&u.upd.locationStatus==='ok'&&u.upd.locationCity==='Medellín'&&u.upd.locationMatch===true,JSON.stringify(e.calls.updated));
  t('F10b …sin guardar coordenadas en la actualización',u&&!Object.keys(u.upd).some(k=>/^(lat|lon)/i.test(k)));}
 {const e=await run({geoSeq:[{hang:true},{hang:true},{ok:true}]});const id=e.calls.saved[0].id;await vsleep(40000);const u=e.calls.updated.find(x=>x.id===id);
  t('F10c ubicación que expiró al iniciar: el turno inicia (timeout) y se recupera en segundo plano cuando el SO la entrega',e.calls.saved[0].data.locationStatus==='timeout'&&u&&u.upd.locationStatus==='ok',JSON.stringify(e.calls.updated)+' geo='+e.calls.geo.length);}
 {const e=await run({geoSeq:[{err:1},{err:1}]});await vsleep(40000);t('F10d error 1 con permiso: no hay reintentos tardíos ni escrituras extra',e.calls.updated.length===0&&e.calls.geo.length===2);}
 {const e=await run({nominatim:'hang'});const s=e.calls.saved[0];
  t('F11 Nominatim colgado: tope de 4 s, turno iniciado (geocode_failed)',s&&s.data.locationStatus==='geocode_failed'&&e.virt<20,'virt='+e.virt.toFixed(1));}
 {const e=await run({registered:''});const s=e.calls.saved[0];
  t('F12 agente sin ciudad en BASE 3.0: turno iniciado (no_registered_city)',s&&s.data.locationStatus==='no_registered_city'&&s.data.locationCity==='Medellín');}
 {const e=await run({mallaSeq:['hang'],mallaCache:{csv:mkCsv('lromero@pibox.app',''),ts:Date.now()-60*60000}});const s=e.calls.saved[0];
  t('F13 Apps Script caído + caché de 60 min: el turno INICIA con la caché y el botón se libera',s&&e.calls.active===1&&e.els['btn-turno-start'].disabled===false&&e.els['btn-turno-start']._processing===false,'virt='+e.virt.toFixed(1));
  t('F14 …sin quedarse en «Iniciando…» más de ~45 s virtuales',e.virt<45,'virt='+e.virt.toFixed(1));}
 {const e=await run({mallaSeq:['hang']});const s=e.calls.saved[0];
  t('F15 Apps Script caído y sin caché: el turno inicia igual, con aviso persistente',s&&e.calls.active===1&&/No se pudo consultar tu malla/.test(e.els['turno-start-notice'].innerHTML),'virt='+e.virt.toFixed(1));}
 {const e=await run({novedad:'VACACIONES'});
  t('F16 novedad en la malla (datos frescos): se bloquea el inicio y NO se guarda nada',e.calls.blocked.length===1&&e.calls.saved.length===0);}
 {const e=await run({saveFail:1});
  t('F17 Firestore no guarda: NO se activa la pantalla fantasma, se avisa y el botón queda usable',e.calls.active===0&&e.calls.alerts.some(a=>/No pudimos registrar tu turno/.test(a))&&e.els['btn-turno-start'].disabled===false);
  const first=e.calls.saved[0];const G=e.G;await G.startTurno();
  t('F18 …el reintento reutiliza el MISMO id y la misma hora de clic (sin duplicar)',e.calls.saved.length===2&&e.calls.saved[1].id===first.id&&e.calls.saved[1].data.startTime.getTime()===first.data.startTime.getTime()&&e.calls.active===1);}
 {const e=await run({today:{status:'active',id:'X'}});
  t('F19 ya había un turno activo hoy: se restaura, NO se crea un duplicado',e.calls.saved.length===0&&e.calls.initView===1);}
 {const e=mkEnv({});const G=build(e);const a=G.startTurno();const b=G.startTurno();await Promise.all([a,b]);
  t('F20 doble clic: un solo turno guardado',e.calls.saved.length===1);}
 {const lk={held:false,request(n,o,cb){if(this.held&&o.ifAvailable)return Promise.resolve(cb(null));this.held=true;return Promise.resolve(cb({name:n})).finally(()=>{this.held=false;});}};
  const e1=mkEnv({perm:'denied'}),e2=mkEnv({});e1.navigator.locks=lk;e2.navigator.locks=lk;const G1=build(e1),G2=build(e2);
  const p1=G1.startTurno();await waitOverlay(e1);await G2.startTurno();
  t('F25 dos pestañas: la segunda NO inicia (candado entre pestañas) y avisa',e2.calls.saved.length===0&&e2.calls.toasts.some(x=>/otra pestaña/.test(x)));
  click(e1,'#loc-skip');await p1;t('F26 …y la primera sí inicia: un solo turno en total',e1.calls.saved.length===1&&e2.calls.saved.length===0);}
 {const e=mkEnv({saveHang:true});const G=build(e);const p=G.startTurno();await vsleep(70000);
  t('F21 un paso técnico que nunca termina: a los 45 s virtuales sale el aviso y el botón se libera',e.calls.alerts.some(a=>/tardando más de lo normal/.test(a))&&e.els['btn-turno-start'].disabled===false);
  await G.startTurno();t('F22 …y un nuevo clic NO crea un segundo inicio en paralelo (toast «ya se está iniciando»)',e.calls.saved.length===1&&e.calls.toasts.some(x=>/ya se está iniciando/.test(x)));}
 {const e=mkEnv({perm:'denied'});const G=build(e);const p=G.startTurno();await waitOverlay(e);await vsleep(100000);
  t('F23 el modal abierto 100 s NO dispara el límite duro de 45 s (espera humana)',e.calls.alerts.length===0);click(e,'#loc-skip');await p;t('F24 …y al continuar el turno inicia',e.calls.saved.length===1);}


 // ───────── Avisos de llamado: respaldo local cuando Firestore niega strike_notifications ─────────
 {const a=html.indexOf('async function getStrikeNotifSafe'),b=html.indexOf('async function loadStrikes(){');
  const mk=(remoteGet,remoteSave)=>{const store={};const ls={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}};
   const f=new Function('window','localStorage',html.slice(a,b)+'\nreturn {getStrikeNotifSafe,saveStrikeNotifSafe};');
   return f({getStrikeNotification:remoteGet,saveStrikeNotification:remoteSave},ls);};
  const denied={get:async()=>({_readError:true}),save:async()=>false};
  let H=mk(denied.get,denied.save);
  t('N1 Firestore niega la lectura y no hay registro local: se notifica (null)',(await H.getStrikeNotifSafe('a_llamados'))===null);
  await H.saveStrikeNotifSafe('a_llamados',{llamadoNumero:1,notifiedAt:'x'});
  const last=await H.getStrikeNotifSafe('a_llamados');
  t('N2 …tras notificar queda el registro local aunque la escritura falle (no se reenvía en cada carga)',last&&last.llamadoNumero===1);
  t('N3 …y si el contador SUBE (2 > 1) se vuelve a notificar',2>(last.llamadoNumero||0));
  H=mk(async()=>({llamadoNumero:2}),async()=>true);
  t('N4 Firestore sano: manda el registro remoto',(await H.getStrikeNotifSafe('b'))?.llamadoNumero===2);}
 out.forEach(l=>console.log(l));
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log(`\n${out.length-fails}/${out.length} pasan`);process.exit(fails?1:0);
})().catch(e=>{console.error('ERROR en la prueba:',e);process.exit(2);});
