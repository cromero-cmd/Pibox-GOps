// Uso: node test/pigops_reversiones_test.js   (sin red, sin Firestore: todo simulado; extrae el código REAL de index.html)
// Reversión de decisiones (v19.6). Caso real: un admin canceló por error el llamado de atención de un agente («el agente logra justificar su tardanza»…).
// Toda decisión debe poder revertirse pidiendo un MOTIVO y dejando constancia del correo de quien lo hace: llamados cancelados, casos de Talento Humano
// cerrados, apelaciones, retiros de strikes, salida anticipada, ausencias, reanudación, horas extras, cierre forzado y edición de tiempos.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

const MOTOR=slice('// ══════════ REVERSIÓN DE DECISIONES (v19.6)','async function renderPanel2Insights(');
const UI=slice('const regQuien=','async function pmCasos(');
const TAG=html.split('\n').find(l=>l.startsWith('const regTag='))||'const regTag=()=>"";';
const ADMIN='coord@pibox.app',SUPER='cromero@pibox.app',AGENTE='agente1@pibox.app';

// Mundo simulado: registra el ORDEN de las operaciones (bitácora antes que el cambio)
function mundo(o={}){
 const w={ops:[],toasts:[],asks:[],answers:o.answers||[],sesion:o.sesion||ADMIN,domEmail:o.domEmail,bitacoraFalla:!!o.bitacoraFalla,accionFalla:o.accionFalla||null,
  refrescos:0,waivers:o.waivers||[],appeals:o.appeals||[],panel:o.panel||[],insights:0,loadPanel:0,listas:0};
 const win={
  sessionEmail:()=>w.sesion,
  registrarReversion:async e=>{w.ops.push(['log',JSON.parse(JSON.stringify(e))]);return w.bitacoraFalla&&!e.fallo?{ok:false,error:'permission-denied'}:{ok:true};},
  revertirReglamentoCaso:async(id,c)=>{w.ops.push(['reg',id,JSON.parse(JSON.stringify(c))]);return w.accionFalla==='reg'?{ok:false,error:'permission-denied'}:{ok:true};},
  getStrikeWaivers:async()=>w.waivers,getStrikeAppeals:async()=>w.appeals,
  deleteStrikeWaiver:async id=>{w.ops.push(['delWaiver',id]);return w.accionFalla==='del'?{ok:false,error:'permission-denied'}:{ok:true};},
  saveStrikeAppeal:async(id,d)=>{w.ops.push(['appeal',id,JSON.parse(JSON.stringify(d))]);return{ok:true};},
  updateTurnoInFirebase:async(id,d)=>{w.ops.push(['turno',id,d]);},
  saveAbsenceToFirebase:async d=>{w.ops.push(['absence',JSON.parse(JSON.stringify(d))]);},
  updateOvertimeEvent:async(id,d)=>{w.ops.push(['event',id,JSON.parse(JSON.stringify(d))]);return true;},
  loadOvertimeEvents:async()=>[]};
 const docEl={textContent:w.domEmail||w.sesion};
 const doc={getElementById:id=>id==='user-email'?docEl:id==='user-name'?{textContent:'Nombre Admin'}:id==='reg-casos-modal'?{}:null};
 const isSuper=e=>e===SUPER,isAdmin=e=>e===ADMIN||e===SUPER;
 const F=new Function('window','document','toast','askText','isAdminEmail','isSuperAdminUser','esc','refrescarModalesReg','renderPanel2Insights','loadStrikeAppealsBadge','renderStrikeAppealsList','loadPanel2','loadTurnoHistory','loadOvertimeList','panel2AllRows','setTimeout','REG_CAUSAL_6013','REG_CAUSAL_602','regDDMMYYYY','regColorContador','regInicioVentana','regIsoLocal',
  TAG+'\n'+MOTOR+'\n'+UI+'\nreturn{revertirDecision,revertirCancelacionReg,revertirCierreRegTH,restaurarStrike,revertirApelacion,revertirSalidaAnticipada,revocarReanudacion,revertirAusencia,revertirHorasExtra,deshacerCierreForzado,deshacerEdicionTiempos,turnoSnap,snapAUpdate,renderRegCasosList,renderThCasosList,regRevInfo,set casos(v){window._regCasos=v;}};');
 w.F=F(win,doc,m=>w.toasts.push(m),async(tit,sub,ph,req)=>{w.asks.push({tit,sub,ph,req});return w.answers.length?w.answers.shift():null;},isAdmin,isSuper,s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  async()=>{w.refrescos++;},()=>{w.insights++;},async()=>[],()=>{},()=>{w.loadPanel++;},()=>{},()=>{w.listas++;},w.panel,fn=>fn(),'Art. 60 num. 13','Art. 60 num. 2',iso=>iso.split('-').reverse().join('/'),()=>'#fff',iso=>'2026-09-01',d=>d.toISOString().slice(0,10));
 w.win=win;w.docEl=docEl;
 w.log=()=>w.ops.filter(o=>o[0]==='log');w.cambios=()=>w.ops.filter(o=>o[0]!=='log');
 return w;}
const cancelado=(o={})=>Object.assign({id:AGENTE+'_20261112_reg',tipoRegistro:'tardanza',userEmail:AGENTE,userName:'AGENTE UNO',fecha:'12/11/2026',fechaISO:'2026-11-12',minutos:19,programada:'7:00 a. m.',inicioReal:'7:19:09 a. m.',
 tipo:'llamado',estado:'Cancelado',motivoCancelacion:'El agente logra justificar su tardanza',canceladoPor:'otro@pibox.app',canceladoAt:'2026-11-17T15:00:00.000Z'},o);

(async()=>{
// ═══ A. Motor: motivo, sesión, bitácora primero, fallas ═══
{const w=mundo({answers:['Me equivoqué: el biométrico no cubre ese día']});w.F.casos=[cancelado()];
 const r=await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A1 revertir una cancelación pide el motivo (obligatorio) y lo explica: quién lo hizo, fecha y hora quedan registrados',r===undefined&&w.asks.length===1&&w.asks[0].req===true&&/Revertir cancelación/.test(w.asks[0].tit)&&new RegExp('revertiste tú \\('+ADMIN).test(w.asks[0].sub)&&/Motivo de la reversión/.test(w.asks[0].ph),w.asks[0]);
 t('A2 la BITÁCORA se escribe ANTES de tocar el registro (primero «log», luego «reg»)',w.ops.length===2&&w.ops[0][0]==='log'&&w.ops[1][0]==='reg',w.ops.map(o=>o[0]));
 const e=w.log()[0][1],c=w.ops[1][2];
 t('A3 la bitácora trae tipo, referencia, agente, decisión anterior y resultante, motivo y quién lo hizo',e.tipo==='reglamento_cancelacion'&&e.ref==='reglamento_casos/'+AGENTE+'_20261112_reg'&&e.agente===AGENTE&&e.antes.estado==='Cancelado'&&e.antes.por==='otro@pibox.app'&&e.despues.estado==='En plazo de justificación'&&e.motivo==='Me equivoqué: el biométrico no cubre ese día'&&e.porNombre==='Nombre Admin',e);
 t('A4 el registro vuelve a «En plazo de justificación» con quién lo revirtió, cuándo y el motivo, y la reversión queda en su historial (reversiones)',c.estado==='En plazo de justificación'&&c.revertidoPor===ADMIN&&!!c.revertidoAt&&c.motivoReversion==='Me equivoqué: el biométrico no cubre ese día'&&c.reversiones.length===1&&c.reversiones[0].de==='Cancelado'&&c.reversiones[0].revertidoPor===ADMIN,c);
 t('A5 NO se borran los datos de la cancelación original (quedan como historia) y se refrescan los módulos',!('motivoCancelacion' in c)&&!('canceladoPor' in c)&&w.refrescos===1&&w.toasts.some(m=>/Cancelación revertida/.test(m)));}
{const w=mundo({answers:['algo suficientemente largo'],domEmail:'otro.falso@pibox.app'});w.F.casos=[cancelado()];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A6 el correo sale SIEMPRE de la sesión de Firebase, no del texto de la página (aunque alguien lo edite en el DOM)',w.ops[1][2].revertidoPor===ADMIN&&w.log()[0][1].porNombre==='Nombre Admin'&&!JSON.stringify(w.ops).includes('otro.falso'));}
for(const [n,resp] of [['cancela el diálogo (null)',null],['motivo muy corto («ok»)','ok'],['motivo solo espacios','     ']]){
 const w=mundo({answers:[resp]});w.F.casos=[cancelado()];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A7 si el usuario '+n+', no se escribe NADA (ni bitácora ni registro)',w.ops.length===0,w.ops);}
{const w=mundo({answers:['motivo válido aquí'],sesion:AGENTE});w.F.casos=[cancelado()];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A8 un usuario que no es admin no puede revertir (ni siquiera se le pide el motivo)',w.ops.length===0&&w.asks.length===0&&w.toasts.some(m=>/No tienes permiso/.test(m)));}
{const w=mundo({answers:['motivo válido aquí'],bitacoraFalla:true});w.F.casos=[cancelado()];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A9 si la BITÁCORA no se puede escribir (p. ej. falta la regla), NO se revierte nada y se explica por qué',w.cambios().length===0&&w.toasts.some(m=>/por eso no se hizo/.test(m)&&/reversiones/.test(m)),w.toasts);}
{const w=mundo({answers:['motivo válido aquí'],accionFalla:'reg'});w.F.casos=[cancelado()];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A10 si el cambio falla (permiso de Firestore), queda una SEGUNDA entrada en la bitácora con fallo:true y se avisa; no se refresca como éxito',w.log().length===2&&w.log()[1][1].fallo===true&&/permission-denied/.test(w.log()[1][1].error)&&w.toasts.some(m=>/No se pudo revertir/.test(m))&&w.refrescos===0,w.toasts);}
{const w=mundo({answers:['motivo válido aquí']});w.F.casos=[cancelado({estado:'En plazo de justificación'})];await w.F.revertirCancelacionReg(AGENTE+'_20261112_reg');
 t('A11 un registro que NO está cancelado no se toca',w.ops.length===0&&w.asks.length===0);}

// ═══ B. Reglamento: caso de TH cerrado → Enviado; cancelados de TH ahora visibles ═══
{const w=mundo({answers:['Se cerró sin la respuesta de TH']});w.F.casos=[cancelado({id:'th1',tipo:'falta_grave',estado:'Cerrado',cerradoPor:'otro@pibox.app',cerradoAt:'2026-11-16T10:00:00.000Z',notaCierre:'ok'})];
 await w.F.revertirCierreRegTH('th1');const c=(w.ops.find(o=>o[0]==='reg')||[])[2];
 t('B1 un caso de TH cerrado se reabre («Enviado») con motivo y quién lo hizo',c&&c.estado==='Enviado'&&c.revertidoPor===ADMIN&&c.reversiones[0].de==='Cerrado'&&w.log()[0][1].tipo==='reglamento_cierre_th',c);}
{const w=mundo();const el={innerHTML:''};
 w.F.renderRegCasosList(el,[cancelado(),cancelado({id:'j1',estado:'Justificado',motivoCancelacion:undefined,canceladoPor:undefined}),cancelado({id:'p1',estado:'En plazo de justificación',limiteISO:'2026-11-18',reversiones:[{revertidoPor:ADMIN,revertidoAt:'2026-11-18T12:00:00.000Z',motivoReversion:'Me equivoqué'}]})]);
 const H=el.innerHTML;
 t('B2 «Llamados de atención»: el registro CANCELADO trae «↩ Revertir cancelación» y el JUSTIFICADO «↩ Revertir justificación» (para admins)',/revertirCancelacionReg\('agente1@pibox\.app_20261112_reg'\)/.test(H)&&/↩ Revertir cancelación/.test(H)&&new RegExp("restaurarStrike\\('"+AGENTE+"_20261112_tardanza'\\)").test(H)&&/↩ Revertir justificación/.test(H),H.slice(0,300));
 t('B3 un registro ya revertido muestra quién lo revirtió y por qué («Revertido por … : Me equivoqué»)',/↩ Revertido por coord@pibox\.app.*Me equivoqué/.test(H));
 const w2=mundo({sesion:AGENTE});const el2={innerHTML:''};w2.F.renderRegCasosList(el2,[cancelado()]);
 t('B4 quien no es admin no ve los botones de reversión',!/revertirCancelacionReg/.test(el2.innerHTML));
 const el3={innerHTML:''};w.F.renderThCasosList(el3,[cancelado({id:'t1',tipo:'falta_grave'}),cancelado({id:'t2',tipo:'falta_grave',estado:'Cerrado',cerradoPor:'x@pibox.app',cerradoAt:'2026-11-16T10:00:00.000Z'})]);
 t('B5 «Casos para TH»: los CANCELADOS ahora se listan (antes desaparecían) con «↩ Revertir cancelación», y los cerrados con «↩ Reabrir caso»',/🚫 Cancelados \/ justificados/.test(el3.innerHTML)&&/revertirCancelacionReg\('t1'\)/.test(el3.innerHTML)&&/revertirCierreRegTH\('t2'\)/.test(el3.innerHTML)&&/↩ Reabrir caso/.test(el3.innerHTML),el3.innerHTML.slice(0,200));}

// ═══ C. Strikes y apelaciones ═══
const waiver=(o={})=>Object.assign({id:AGENTE+'_20261112_tardanza',userEmail:AGENTE,userName:'AGENTE UNO',fecha:'12/11/2026',cat:'tardanza',detalle:'Tardanza 19 min',motivo:'cita médica',waivedBy:SUPER,waivedAt:'2026-11-13T10:00:00.000Z'},o);
{const w=mundo({sesion:SUPER,answers:['El retiro fue por error de digitación'],waivers:[waiver()]});w.win._insightsArgs=[];await w.F.restaurarStrike(AGENTE+'_20261112_tardanza');
 t('C1 retiro directo de un strike: el Super Admin lo restaura con motivo; se borra el retiro (después de la bitácora)',w.ops.map(o=>o[0]).join()==='log,delWaiver'&&w.log()[0][1].tipo==='strike_retirado'&&w.log()[0][1].motivo==='El retiro fue por error de digitación'&&w.insights===1,w.ops.map(o=>o[0]));}
{const w=mundo({sesion:ADMIN,answers:['motivo suficiente'],waivers:[waiver()]});await w.F.restaurarStrike(AGENTE+'_20261112_tardanza');
 t('C2 un retiro directo NO lo puede restaurar un admin que no es Super Admin (mismo permiso que para retirarlo)',w.ops.length===0&&w.asks.length===0&&w.toasts.some(m=>/Solo el Super Admin/.test(m)),w.toasts);}
{const ap={id:AGENTE+'_20261112_tardanza',userEmail:AGENTE,status:'approved',respuesta:'Aprobada',decidedBy:'otro@pibox.app',decidedAt:'2026-11-13T10:00:00.000Z',motivo:'cita'};
 const w=mundo({sesion:ADMIN,answers:['Aprobé la apelación equivocada'],waivers:[waiver({appealId:AGENTE+'_20261112_tardanza'})],appeals:[ap]});await w.F.restaurarStrike(AGENTE+'_20261112_tardanza');
 const a=(w.ops.find(o=>o[0]==='appeal')||[])[2];
 t('C3 apelación APROBADA: la revierte un admin (como la aprobó); se borra el retiro y la apelación vuelve a «pendiente» con su decisión previa y la reversión',w.ops.map(o=>o[0]).join()==='log,delWaiver,appeal'&&a.status==='pending'&&a.decisionPrevia.status==='approved'&&a.decisionPrevia.decidedBy==='otro@pibox.app'&&a.revertidoPor===ADMIN&&a.reversiones[0].de==='approved',w.ops.map(o=>o[0]));
 const w2=mundo({sesion:ADMIN,answers:['Aprobé la apelación equivocada'],waivers:[waiver({appealId:'x'})],appeals:[ap],accionFalla:'del'});await w2.F.restaurarStrike(AGENTE+'_20261112_tardanza');
 t('C4 si no se puede borrar el retiro, la apelación NO se toca (no quedan estados a medias)',!w2.ops.some(o=>o[0]==='appeal')&&w2.log().some(l=>l[1].fallo));}
{const ap={id:'a1',userEmail:AGENTE,userName:'AGENTE UNO',fecha:'12/11/2026',detalle:'Tardanza',status:'rejected',respuesta:'No procede',decidedBy:'otro@pibox.app',decidedAt:'2026-11-13T10:00:00.000Z'};
 const w=mundo({sesion:ADMIN,answers:['Rechacé sin ver el soporte'],appeals:[ap]});await w.F.revertirApelacion('a1');const a=(w.ops.find(o=>o[0]==='appeal')||[])[2];
 t('C5 apelación RECHAZADA → vuelve a «pendiente» (con la decisión previa y la reversión); la bitácora antes del cambio',w.ops.map(o=>o[0]).join()==='log,appeal'&&a.status==='pending'&&a.decisionPrevia.respuesta==='No procede'&&a.revertidoPor===ADMIN&&w.log()[0][1].tipo==='apelacion_rechazada',w.ops.map(o=>o[0]));
 const w2=mundo({sesion:ADMIN,answers:['motivo válido aquí'],appeals:[{...ap,status:'approved'}],waivers:[waiver({appealId:'a1',id:'a1'})]});await w2.F.revertirApelacion('a1');
 t('C6 una apelación APROBADA se revierte por la misma vía que restaurar el strike (borra el retiro)',w2.ops.some(o=>o[0]==='delWaiver')&&w2.ops.some(o=>o[0]==='appeal'));}

// ═══ D. Panel: salida anticipada, reanudación, ausencia ═══
const rowTurno=(t,o={})=>Object.assign({turnoId:'T1',usuario:AGENTE,nombre:'AGENTE UNO',fecha:'12/11/2026',turno:t},o);
{const w=mundo({answers:['Me equivoqué con la salida'],panel:[rowTurno({earlyLeave:true,earlyLeaveStatus:'not_justified'})]});await w.F.revertirSalidaAnticipada('T1');
 t('D1 salida anticipada NO justificada → «pendiente de revisión» (bitácora primero)',w.ops.map(o=>o[0]).join()==='log,turno'&&w.ops[1][2].earlyLeaveStatus==='pending_review'&&w.log()[0][1].antes.earlyLeaveStatus==='not_justified',w.ops);
 const w2=mundo({answers:['motivo válido aquí'],panel:[rowTurno({earlyLeave:true,earlyLeaveStatus:'pending_review'})]});await w2.F.revertirSalidaAnticipada('T1');
 t('D2 una salida que ya está pendiente no se toca',w2.ops.length===0);}
{const w=mundo({answers:['Autoricé al turno equivocado'],panel:[rowTurno({resumeAuthorized:true,resumeAuthorizedBy:'otro@pibox.app',status:'interrupted'})]});await w.F.revocarReanudacion('T1');
 t('D3 reanudación autorizada → revocada: el turno vuelve a «ended» y resumeAuthorized:false',w.ops[1][2].resumeAuthorized===false&&w.ops[1][2].status==='ended'&&w.log()[0][1].tipo==='reanudacion_autorizada');
 const w2=mundo({answers:['motivo válido aquí'],panel:[rowTurno({resumeAuthorized:true,status:'active'})]});await w2.F.revocarReanudacion('T1');
 t('D4 si el agente YA reanudó (turno activo) no se puede revocar: se avisa y no se escribe nada',w2.ops.length===0&&w2.toasts.some(m=>/ya reanudó/.test(m)));}
{const w=mundo({answers:['La justifiqué por error'],panel:[{turnoId:null,usuario:AGENTE,nombre:'AGENTE UNO',fecha:'12/11/2026',absenceStatus:'justified',absenceMotivo:'Incapacidad'}]});await w.F.revertirAusencia(AGENTE,'12/11/2026');
 const a=(w.ops.find(o=>o[0]==='absence')||[])[1];
 t('D5 ausencia justificada → vuelve a «pending» (se muestra como «Ausente» sin revisar), con la decisión previa y quién la revirtió',a&&a.status==='pending'&&a.decisionPrevia.status==='justified'&&a.decisionPrevia.motivo==='Incapacidad'&&a.revertidoPor===ADMIN&&a.motivoReversion==='La justifiqué por error',a);}

// ═══ E. Horas extras ═══
const ev=(o={})=>Object.assign({id:'E1',type:'overtime',agentEmail:AGENTE,agentName:'AGENTE UNO',date:'12/11/2026',extraMins:90,turnoId:'T9'},o);
{const w=mundo({sesion:SUPER,answers:['Aprobé las extras equivocadas']});w.win&&0;
 const cache={E1:ev({status:'approved',decidedBy:SUPER,decidedAt:'2026-11-14T10:00:00.000Z'})};
 const w2=mundo({sesion:SUPER,answers:['Aprobé las extras equivocadas']});
 const F=new Function('window','document','toast','askText','isAdminEmail','isSuperAdminUser','esc','loadOvertimeList','loadTurnoHistory','setTimeout',MOTOR+'\nreturn{revertirHorasExtra};');
 const run=async(estado,sesion,resp)=>{const ww=mundo({sesion,answers:[resp]});ww.win._overtimeEventsCache={E1:estado};
  const X=new Function('window','document','toast','askText','isAdminEmail','isSuperAdminUser','esc','refrescarModalesReg','renderPanel2Insights','loadStrikeAppealsBadge','renderStrikeAppealsList','loadPanel2','loadTurnoHistory','loadOvertimeList','panel2AllRows','setTimeout',MOTOR+'\nreturn{revertirHorasExtra};')(ww.win,{getElementById:id=>id==='user-email'?{textContent:sesion}:id==='user-name'?{textContent:'N'}:id==='overtime-list'?{}:id==='overtime-badge'?{style:{},textContent:''}:null},m=>ww.toasts.push(m),async(a,b,c,d)=>{ww.asks.push({a,b});return ww.answers.shift();},e=>e===ADMIN||e===SUPER,e=>e===SUPER,s=>s,async()=>{},()=>{},async()=>[],()=>{},()=>{},()=>{},()=>{},[],fn=>fn());
  await X.revertirHorasExtra('E1');return ww;};
 let r=await run(cache.E1,SUPER,'Aprobé las extras equivocadas');const e1=(r.ops.find(o=>o[0]==='event')||[])[2],tu=r.ops.find(o=>o[0]==='turno');
 t('E1 Super Admin revierte una APROBACIÓN directa: el evento vuelve a «pendiente de revisión» y el turno deja de tener las extras aprobadas (nómina)',r.ops.map(o=>o[0]).join()==='log,event,turno'&&e1.status==='pending_review'&&e1.decidedBy===null&&e1.revertidoPor===SUPER&&e1.reversiones[0].de==='approved'&&tu[2].overtimeStatus==='pending_review'&&tu[2].overtimeApprovedBy===null,r.ops.map(o=>o[0]));
 r=await run(ev({status:'rejected',decidedBy:SUPER,decidedAt:'2026-11-14T10:00:00.000Z',firstDecidedBy:'coord@pibox.app',firstDecidedAt:'2026-11-13T09:00:00.000Z',rejectReason:'no aplica'}),SUPER,'Rechacé sin ver el soporte');
 const e2=(r.ops.find(o=>o[0]==='event')||[])[2];
 t('E2 un RECHAZO final sobre lo que ya aprobó un coordinador vuelve a «pendiente de aprobación final», restaurando la decisión del coordinador y limpiando el motivo del rechazo',e2.status==='pending_super_admin'&&e2.decidedBy==='coord@pibox.app'&&e2.decidedAt==='2026-11-13T09:00:00.000Z'&&e2.firstDecidedBy===null&&e2.rejectReason===null,e2);
 t('E3 aviso honesto: el correo del rechazo ya salió y no se puede deshacer',/ya salió y no se puede deshacer/.test(r.asks[0].b),r.asks[0]);
 r=await run(ev({status:'pending_super_admin',decidedBy:ADMIN,decidedAt:'2026-11-13T09:00:00.000Z'}),ADMIN,'Aprobé por error la solicitud');
 const e3=(r.ops.find(o=>o[0]==='event')||[])[2];
 t('E4 el coordinador retira SU aprobación (pendiente de aprobación final → pendiente de revisión)',e3&&e3.status==='pending_review'&&e3.decidedBy===null&&e3.reversiones[0].revertidoPor===ADMIN,e3);
 r=await run(ev({status:'pending_super_admin',decidedBy:'otro@pibox.app'}),ADMIN,'motivo válido aquí');
 t('E5 un coordinador NO puede retirar la aprobación de otro; un coordinador tampoco revierte una decisión final',r.ops.length===0&&(await run(ev({status:'approved',decidedBy:SUPER}),ADMIN,'motivo válido aquí')).ops.length===0);}

// ═══ F. Cierre forzado y edición de tiempos (con respaldo desde la v19.6) ═══
{const ts=d=>({toDate:()=>d});
 const antes={status:'active',startTime:ts(new Date('2026-11-12T12:02:00Z')),endTime:null,accumulatedSeconds:0};
 const w0=mundo();const snap=w0.F.turnoSnap(antes);
 t('F1 el respaldo guarda estado, inicio, fin y acumulado como valores simples (ISO), con null donde no había',snap.status==='active'&&snap.startTime==='2026-11-12T12:02:00.000Z'&&snap.endTime===null&&snap.accumulatedSeconds===0&&snap.editedBy===null);
 const w=mundo({sesion:SUPER,answers:['Cerré el turno equivocado'],panel:[rowTurno({status:'ended',forcedClosedBy:SUPER,forcedClosedAt:'x',forzadoPrevio:snap,endTime:ts(new Date('2026-11-12T21:00:00Z'))})]});
 await w.F.deshacerCierreForzado('T1');const u=(w.ops.find(o=>o[0]==='turno')||[])[2];
 t('F2 deshacer un cierre forzado restaura el estado «active», quita el fin y limpia forcedClosedBy/forzadoPrevio',w.ops.map(o=>o[0]).join()==='log,turno'&&u.status==='active'&&u.endTime===null&&u.accumulatedSeconds===0&&u.forcedClosedBy===null&&u.forzadoPrevio===null&&u.startTime instanceof Date,u);
 const w2=mundo({sesion:SUPER,answers:['motivo válido aquí'],panel:[rowTurno({status:'ended',forcedClosedBy:SUPER})]});await w2.F.deshacerCierreForzado('T1');
 t('F3 un cierre forzado SIN respaldo (hecho antes de la v19.6) no se puede deshacer: se avisa y no se escribe nada',w2.ops.length===0&&w2.toasts.some(m=>/antes de la v19\.6/.test(m)));
 const previo={status:'ended',startTime:'2026-11-12T12:02:00.000Z',endTime:'2026-11-12T21:00:00.000Z',accumulatedSeconds:32280,editedBy:null,editedAt:null,editReason:null,overtimeStatus:null,overtimeMinutes:null,overtimeApprovedBy:null,overtimeDecidedAt:null};
 const w3=mundo({sesion:SUPER,answers:['Corregí la hora equivocada'],panel:[rowTurno({status:'ended',editedBy:SUPER,editReason:'Corrección manual',edicionPrevia:previo,startTime:ts(new Date('2026-11-12T12:00:00Z')),endTime:ts(new Date('2026-11-12T23:00:00Z')),overtimeStatus:'approved',overtimeMinutes:120})]});
 await w3.F.deshacerEdicionTiempos('T1');const u3=(w3.ops.find(o=>o[0]==='turno')||[])[2];
 t('F4 deshacer una edición restaura inicio, fin y acumulado, quita editedBy/editReason y las EXTRAS aprobadas por esa edición, y borra el respaldo',u3.startTime.toISOString()==='2026-11-12T12:02:00.000Z'&&u3.endTime.toISOString()==='2026-11-12T21:00:00.000Z'&&u3.accumulatedSeconds===32280&&u3.editedBy===null&&u3.editReason===null&&u3.overtimeStatus===null&&u3.overtimeMinutes===null&&u3.edicionPrevia===null,u3);}

// ═══ G. Estáticos: todo está conectado ═══
t('G1 las 9 acciones tienen su botón en la interfaz',['revertirCancelacionReg(','revertirCierreRegTH(','restaurarStrike(','revertirApelacion(','revertirSalidaAnticipada(','revocarReanudacion(','revertirAusencia(','revertirHorasExtra(','deshacerCierreForzado(','deshacerEdicionTiempos('].every(f=>html.split("onclick=\"").concat(html.split('`')).join('').includes(f)||new RegExp(f.replace('(','\\(')+"[^)]*\\)`").test(html)));
t('G2 forzar el cierre y editar tiempos guardan el respaldo (forzadoPrevio / edicionPrevia) antes de modificar el turno',/forzadoPrevio:turnoPrevio\?turnoSnap\(turnoPrevio\):null/.test(html)&&/updates\.edicionPrevia=turnoSnap\(panelRow\.turno\)/.test(html));
t('G3 la bitácora es append-only desde el cliente (solo addDoc; por = correo de la sesión; sin setDoc/updateDoc/deleteDoc sobre «reversiones»)',/addDoc\(collection\(db, 'reversiones'\), \{ \.\.\.limpio, por: email, at: serverTimestamp\(\), atISO/.test(html)&&!/doc\(db, 'reversiones'/.test(html));
t('G4 la bitácora se consulta desde un botón solo para el Super Admin',/id="btn-reversiones"/.test(html)&&/bR\.style\.display=isSuperAdminUser/.test(html)&&/async function showReversiones\(\)\{\n if\(!isSuperAdminUser/.test(html));
t('G5 las horas extras decididas se cargan con una consulta aparte: loadOvertimeEvents (que alimenta el resumen de Extras) NO cambia',/window\.loadOvertimeDecididas = async/.test(html)&&/if\(isSuperAdmin\) return e\.status==='pending_review'\|\|e\.status==='pending_super_admin';/.test(html));
t('G6 la versión mantiene el formato exacto que usa la detección de actualizaciones',/const APP_VERSION='\d+\.\d+';/.test(html));

const fails=out.filter(l=>l.startsWith('FAIL'));console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));process.exit(fails.length?1:0);
})();
