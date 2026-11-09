// Uso: node test/pigops_tolerancia_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Tolerancia de la tardanza (v19.5). Caso real: un aviso decía «inicio 11:05 a. m. (6 minutos de retardo)» para un turno de las 11:00: el retardo se
// calculaba CON segundos y se REDONDEABA, y la hora se mostraba SIN segundos; además 5 min 40 s era tardanza y 5 min 20 s no.
// Regla nueva: es tardanza solo desde el minuto 6 COMPLETO (11:06:00 para las 11:00; hasta 11:05:59 está dentro de la tolerancia) y los minutos se
// TRUNCAN. Aquí: Reglamento (detección, avisos, llamados, faltas graves y Excel de soporte), strikes informativos y estado del Panel, prenómina,
// alertas de ausencia (ver también pigops_asistencia_test.js) y los dos diagnósticos de solo lectura.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const GS0=rd('PiGOps_Notificaciones_v5.gs'),GSR=rd('PiGOps_Reglamento.gs'),html=rd('index.html');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const BOG=(iso,h,mi,s=0,ms=0)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,s,ms));};

// ── contexto de Apps Script (Notificaciones + Reglamento) ──
function ctxNuevo(extra){
 const logs=[];const c=Object.assign({console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,Logger:{log:m=>logs.push(String(m))}},extra||{});
 vm.createContext(c);vm.runInContext(GS0,c);vm.runInContext(GSR,c);c._logs=logs;return c;}
const C=ctxNuevo();const R=n=>C[n];

// ═══ A. Detección: 11:05:59 no; 11:06:00 sí con 6 minutos; 11:05:30 no ═══
const prog1100={fecha:'3/11/2026',usuario:'a@pibox.app',inicio:'11:00:00',fin:'19:00:00',novedad:''};
const det=(inicio,fecha='3/11/2026')=>R('reg_detectarTardanzas')([Object.assign({},prog1100,{fecha})],[{userEmail:'a@pibox.app',status:'ended',startTime:inicio,endTime:BOG('2026-11-03',19,0)}]);
{let r=det(BOG('2026-11-03',11,5,59));t('A1 11:05:59 NO es tardanza (dentro de la tolerancia)',r.length===0,r);
 r=det(BOG('2026-11-03',11,6,0));t('A2 11:06:00 SÍ es tardanza, con 6 minutos',r.length===1&&r[0].minutos===6,r);
 r=det(BOG('2026-11-03',11,5,30));t('A3 11:05:30 NO es tardanza (antes, redondeado, daba 6 y SÍ lo era)',r.length===0,r);
 r=det(BOG('2026-11-03',11,5,40));t('A4 11:05:40 NO es tardanza y 11:05:20 tampoco: la tolerancia ya es consistente (5 min 40 s y 5 min 20 s dan lo mismo)',r.length===0&&det(BOG('2026-11-03',11,5,20)).length===0);
 r=det(BOG('2026-11-03',11,5,59,999));t('A5 11:05:59.999 (con milisegundos) tampoco',r.length===0);
 r=det(BOG('2026-11-03',11,6,59,999));t('A6 11:06:59 → 6 minutos (se TRUNCA, no se redondea a 7)',r.length===1&&r[0].minutos===6,r);
 r=det(BOG('2026-11-03',11,7,0));t('A7 11:07:00 → 7 minutos',r.length===1&&r[0].minutos===7);
 r=det(BOG('2026-11-03',11,5,0));t('A8 11:05:00 (5 min exactos) no; 11:04 y a tiempo tampoco',r.length===0&&det(BOG('2026-11-03',11,4,0)).length===0&&det(BOG('2026-11-03',10,58,0)).length===0);
 r=det(BOG('2026-11-03',11,6,12));
 t('A9 la hora de inicio se guarda y se muestra CON SEGUNDOS («11:06:12 a. m.») y los minutos truncados; la programada sin segundos',r[0].inicioTexto==='11:06:12 a. m.'&&r[0].minutos===6&&r[0].progTexto==='11:00 a. m.',r[0]);
 r=det(BOG('2026-11-03',14,6,5));t('A10 formato de la tarde: 2:06:05 p. m.',/^$/.test('')&&R('reg_horaAmPmSeg')(BOG('2026-11-03',14,6,5))==='2:06:05 p. m.'&&R('reg_horaAmPmSeg')(BOG('2026-11-03',0,0,0))==='12:00:00 a. m.'&&R('reg_horaAmPmSeg')(BOG('2026-11-03',12,0,1))==='12:00:01 p. m.');
 t('A11 reg_minutosRetardo trunca (359 s = 5; 360 s = 6; 719 s = 11)',R('reg_minutosRetardo')(new Date(359000),new Date(0))===5&&R('reg_minutosRetardo')(new Date(360000),new Date(0))===6&&R('reg_minutosRetardo')(new Date(719999),new Date(0))===11);}

// ═══ B. Avisos, llamados, falta grave y Excel de soporte: hora con segundos y minutos truncados ═══
function world(starts,now,modoPrueba){ // starts: [[iso, h, mi, s]] → una malla de 11:00 por día
 const w={sent:[],pdfs:[],soportes:[],db:{reglamento_casos:{},strike_waivers:{},strike_appeals:{}},now,malla:[],turnos:[]};
 starts.forEach(([iso,h,mi,s])=>{const p=iso.split('-');w.malla.push({fecha:`${+p[2]}/${+p[1]}/${p[0]}`,usuario:'ana@pibox.app',inicio:'11:00:00',fin:'19:00:00',novedad:'',lider:'jefe@pibox.app'});
  w.turnos.push({userEmail:'ana@pibox.app',status:'ended',startTime:BOG(iso,h,mi,s),endTime:BOG(iso,19,0)});});
 w.deps=()=>({now:()=>w.now,config:()=>({modoPrueba:!!modoPrueba,thEmail:'th@pibox.app',firmanteNombre:'Firmante',firmanteCargo:'Cargo',testEmail:'prueba@pibox.app',templateId:'TPL'}),
  leerMalla:()=>w.malla,leerTurnos:()=>w.turnos,agentes:()=>({'ana@pibox.app':{nombre:'Ana Uno',cargo:'Agente',cedula:'1',liderEmail:'jefe@pibox.app'}}),
  listar:c=>JSON.parse(JSON.stringify(w.db[c]||{})),retirados:()=>({}),
  crear:(c,id,o)=>{w.db[c]=w.db[c]||{};if(w.db[c][id])return false;w.db[c][id]=JSON.parse(JSON.stringify(o));return true;},
  actualizar:(c,id,o)=>{w.db[c][id]=Object.assign(w.db[c][id]||{},JSON.parse(JSON.stringify(o)));},
  enviarCorreo:m=>w.sent.push(m),
  generarPdfLlamado:d=>{w.pdfs.push(d);return{blob:{},url:'u'};},generarSoporte:d=>{w.soportes.push(d);return{blob:{},url:'u'};}});
 w.correr=(opts,n)=>{if(n)w.now=n;return R('reg_correr')(w.deps(),opts);};return w;}
{// miércoles 4-nov 11:06:12 (tardanza), jueves 5-nov 11:05:59 (NO), viernes 6-nov 11:06:00 (tardanza)
 const w=world([['2026-11-04',11,6,12],['2026-11-05',11,5,59],['2026-11-06',11,6,0]],BOG('2026-11-06',12,0));w.correr({avisos:true,plazos:false});
 const casos=Object.values(w.db.reglamento_casos);
 t('B1 solo se crean registros para las dos tardanzas reales (4-nov y 6-nov); el 5-nov (11:05:59) no genera nada',casos.length===2&&casos.map(c=>c.fechaISO).sort().join()==='2026-11-04,2026-11-06',casos.map(c=>c.fechaISO));
 t('B2 el registro guarda la hora con segundos y los minutos truncados («11:06:12 a. m.», 6 min)',casos.find(c=>c.fechaISO==='2026-11-04').inicioReal==='11:06:12 a. m.'&&casos.every(c=>c.minutos===6),casos);
 const a=w.sent.find(m=>/4 de noviembre/.test(m.subject));
 t('B3 el AVISO al agente dice «inicio 11:06:12 a. m.» y «6 minutos de retardo» (ya no hay un 11:05 con 6 minutos)',/registró a las <strong>11:06:12 a\. m\.<\/strong>|el inicio se registró a las <strong>11:06:12 a\. m\.<\/strong> \(6 minutos de retardo\)/.test(a.html)&&!/11:05/.test(a.html),a.html.slice(0,700));
 t('B4 el aviso va al agente con copia a su líder (sin cambios) y la tabla repite la hora con segundos',String(a.to)==='ana@pibox.app'&&String(a.cc)==='jefe@pibox.app');
 // llamado: pasan los plazos del 4 y del 6 (lunes 9 y martes 10 de nov → ambas vencen el 11-nov a más tardar)
 w.correr({avisos:true,plazos:true},BOG('2026-11-12',7,0));
 t('B5 el LLAMADO DE ATENCIÓN (un solo PDF, un párrafo por falta) trae las horas con segundos y los minutos truncados',w.pdfs.length===1&&w.pdfs[0].faltas.length===2&&/registró su inicio a las 11:06:12 a\. m\., con 6 minutos de retardo/.test(w.pdfs[0].faltas[0])&&/registró su inicio a las 11:06:00 a\. m\., con 6 minutos de retardo/.test(w.pdfs[0].faltas[1]),w.pdfs[0]&&w.pdfs[0].faltas);
 const ll=w.sent.find(m=>/Llamado de atenci/.test(m.subject));
 t('B6 el correo del llamado también muestra la hora con segundos',ll&&/11:06:12 a\. m\./.test(ll.html)||ll&&/6 minutos/.test(ll.html),ll&&ll.html.slice(0,500));}
{// tres tardanzas → 3.ª = falta grave: correo a TH + Excel de soporte
 const w=world([['2026-11-03',11,6,0],['2026-11-04',11,6,59],['2026-11-05',11,6,12]],BOG('2026-11-12',7,0));w.correr({avisos:true,plazos:true});
 const fg=w.sent.find(m=>/Falta grave/i.test(m.subject)&&!/Reincidencia/.test(m.subject));
 t('B7 la FALTA GRAVE (3.ª tardanza) se notifica a TH con la hora con segundos',!!fg&&/11:06:12 a\. m\./.test(fg.html),fg&&fg.html.slice(0,600));
 const sop=w.soportes[0];
 t('B8 el EXCEL de soporte recibe las tres tardanzas con hora de inicio con segundos y minutos truncados (11:06:59 = 6, no 7)',!!sop&&sop.tardanzas.length===3&&sop.tardanzas.map(f=>f.t.inicioTexto).join()==='11:06:00 a. m.,11:06:59 a. m.,11:06:12 a. m.'&&sop.tardanzas.every(f=>f.t.minutos===6),sop&&sop.tardanzas.map(f=>[f.t.inicioTexto,f.t.minutos]));
 t('B9 el Excel se arma con t.inicioTexto (misma cadena con segundos) y la columna «Hora de inicio»',/f\.t\.inicioTexto, f\.t\.minutos/.test(GSR));}

// ═══ C. Strikes informativos y estado del Panel (cliente) ═══
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
{const ENGINE=slice("const STRIKE_CATS=","// Modelo completo de strikes de UN agente"),REGc=slice("const REGLAMENTO_DESDE=","const regIsoLocal");
 const E=new Function([REGc,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,'return{computeAgentStrikes};'].join('\n'))();
 const EM='a@pibox.app',ts=d=>({toDate:()=>d}),L=(y,m,d,h,mi,s)=>new Date(y,m-1,d,h,mi,s||0,0);
 const calc=(fecha,start)=>E.computeAgentStrikes({email:EM,malla:[{fecha,usuario:EM,inicio:'11:00:00',fin:'19:00:00',novedad:''}],turnos:[{userEmail:EM,status:'ended',startTime:ts(start),endTime:ts(new Date(start.getTime()+3600000))}],waiverMap:new Map(),appealMap:new Map(),cfg:{tardanzaMins:5,nodescHrs:4},now:L(2026,11,20,12,0)});
 t('C1 Reglamento (desde el 1-nov): 11:05:59 no genera tardanza; 11:05:30 tampoco',calc('3/11/2026',L(2026,11,3,11,5,59)).length===0&&calc('3/11/2026',L(2026,11,3,11,5,30)).length===0);
 let r=calc('3/11/2026',L(2026,11,3,11,6,0));
 t('C2 11:06:00 es tardanza del Reglamento (reg:true, 6 min) y la evidencia trae segundos',r.length===1&&r[0].reg===true&&r[0].min===6&&/11:06:00 a\. m\./.test(r[0].real)&&/11:06:00 a\. m\./.test(r[0].detalle)&&/Llegó 6 min tarde/.test(r[0].detalle),r[0]);
 r=calc('3/11/2026',L(2026,11,3,11,6,59));t('C3 11:06:59 → 6 min (truncado, no 7)',r[0].min===6&&/Llegó 6 min/.test(r[0].detalle));
 // strikes informativos (antes del 1-nov): mismos cortes sobre minutos TRUNCADOS
 const cat=(m,s)=>{const x=calc('3/10/2026',L(2026,10,3,11,m,s));return x.length?x[0].cat+':'+((x[0].detalle.match(/Llegó (\d+) min/)||[])[1]):'ninguno';};
 t('C4 strikes informativos (octubre): 5:59 = ninguno; 6:00 = leve (6); 19:59 = leve (19); 20:00 = moderada; 59:59 = moderada (59); 60:00 = grave',cat(5,59)==='ninguno'&&cat(6,0)==='leve:6'&&cat(19,59)==='leve:19'&&cat(20,0)==='moderada:20'&&cat(59,59)==='moderada:59'&&cat(60,0)==='grave:60',[cat(5,59),cat(6,0),cat(19,59),cat(20,0),cat(59,59),cat(60,0)]);
 // estado del Panel (getStatus)
 const GS=new Function('TOLERANCE_MINS','minsRetraso',fn("function getStatus(scheduledStart,realStart,novedad,now,absenceStatus,absenceMotivo,hasEnded){")+'\nreturn getStatus;')(5,(a,b)=>Math.trunc((a-b)/60000));
 const prog=L(2026,11,3,11,0,0),nowT=L(2026,11,3,20,0,0);
 t('C5 estado del Panel: 11:05:59 = «Cumplió»; 11:06:00 = «Tardanza +6 min»; 11:05:30 = «Cumplió»',GS(prog,L(2026,11,3,11,5,59),'',nowT,'','',true).cls==='cumplió'&&GS(prog,L(2026,11,3,11,6,0),'',nowT,'','',true).label==='Tardanza +6 min'&&GS(prog,L(2026,11,3,11,5,30),'',nowT,'','',true).cls==='cumplió');
 t('C6 el indicador «X de 3» y la política usan la misma cuenta: la tardanza del Reglamento sale de computeAgentStrikes (reg:true) con la tolerancia fija REG_TOLERANCIA_MIN sobre minutos truncados',/const umbral=regla\?REG_TOLERANCIA_MIN:cfg\.tardanzaMins;/.test(html)&&/const diff=minsRetraso\(rs,ss\);/.test(html)&&!/Math\.round\(\(rs-ss\)/.test(html)&&!/Math\.round\(\(realStart-scheduledStart\)/.test(html)&&!/Math\.round\(\(r\.realStart-r\.scheduledStart\)/.test(html));
 t('C7 el aviso de tolerancia de la pantalla explica «desde el minuto 6 completo (11:06:00)»',/desde el minuto 6 completo \(para un turno de las 11:00, desde las 11:06:00\)/.test(html));}

// ═══ D. Prenómina real: la entrada real solo reemplaza a la programada si la tardanza cuenta ═══
{const code=['const minsRetraso=(real,prog)=>Math.trunc((real-prog)/60000);',fn('function parseDate(s){'),fn('function parseTime(dateStr,timeStr){'),fn('function strikeWaiverId(email,fecha,cat){'),html.split('\n').find(l=>l.startsWith('function parseCSVLine(')),fn('function pickTurnoDelDia(allTurnos,email,d){'),fn('async function loadFreshPayrollData(cyc){')].join('\n');
 const ts=d=>({toDate:()=>d});
 async function run(start){const monday=new Date(2026,10,2),win={_payrollPreviewMeta:{lastMonday:monday,lastSunday:new Date(2026,10,8,23,59,59)},ADMINS:[],getRecentTurnos:async()=>[{id:'T',userEmail:'a@pibox.app',status:'ended',startTime:ts(start),endTime:ts(new Date(start.getTime()+8*3600000))}],getApprovedOvertimeEvents:async()=>[],getStrikeWaivers:async()=>[],_payrollDirty:false};
  const F=new Function('window','document','console','fetchMallaCSV','panelMalla','ADMINS','SUPER_ADMIN','TOLERANCE_MINS','esNovedadVotaciones','formatDuration','renderPayrollPreviewTable',code+'\nreturn loadFreshPayrollData;');
  const csv='h\n,3/11/2026,a@pibox.app,X,,11:00:00,19:00:00,,,L,,,';
  await F(win,{querySelector:()=>null},{log(){},error(){}},async()=>csv,async()=>csv,[],'root@pibox.app',5,()=>false,s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00';},()=>{})();
  return win._payrollPreviewRecords[0];}
 const L=(h,mi,s)=>new Date(2026,10,3,h,mi,s,0);
 (async()=>{let r=await run(L(11,5,59));
  t('D1 prenómina: llegada 11:05:59 (dentro de la tolerancia) se paga desde la hora PROGRAMADA (11:00 → 8 h)',/11:00 a\. m\./.test(r.checkIn)&&r.hours==='08:00:00',r);
  r=await run(L(11,6,0));t('D2 llegada 11:06:00 (tardanza) se paga desde la hora REAL (11:06 → 7 h 54 min)',/11:06 a\. m\./.test(r.checkIn)&&r.hours==='07:54:00',r);
  r=await run(L(11,5,30));t('D3 11:05:30 se paga completo (antes, redondeado a 6, se descontaba)',r.hours==='08:00:00',r);
  fin();})();
}

// ═══ E. Diagnósticos de solo lectura ═══
const fsStr=v=>({stringValue:String(v)}),fsTs=d=>({timestampValue:d.toISOString()}),fsInt=n=>({integerValue:String(n)});
function mundoDiag(o){
 const w={logs:[],fetches:[],writes:0,casos:o.casos||[],turnos:o.turnos||[],malla:o.malla||[]};
 const c=ctxNuevo({
  ScriptApp:{getOAuthToken:()=>'T'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>(o.props||{})[k]||null,setProperty:()=>{w.writes++;},deleteProperty:()=>{w.writes++;}})},
  GmailApp:{sendEmail:()=>{w.writes++;}},
  SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Malla'?{getDataRange:()=>({getDisplayValues:()=>[['h']].concat(w.malla)})}:null})},
  UrlFetchApp:{fetch:(url,opt)=>{w.fetches.push({url,m:String(opt&&opt.method||'get').toLowerCase()});
   const m=String(opt&&opt.method||'get').toLowerCase();
   if(m!=='post'&&!/\/reglamento_casos\?/.test(url)&&!/runQuery/.test(url))w.writes++;
   if(m!=='post'){ // lista de reglamento_casos
    return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({documents:w.casos.map(x=>({name:'projects/p/databases/(default)/documents/reglamento_casos/'+x.id,fields:Object.fromEntries(Object.entries(x.f).map(([k,v])=>[k,v]))}))})};}
   const q=JSON.parse(opt.payload).structuredQuery,wh=q.where;let docs=w.turnos;
   if(wh.fieldFilter&&wh.fieldFilter.field.fieldPath==='userEmail')docs=docs.filter(d=>d.f.userEmail.stringValue===wh.fieldFilter.value.stringValue);
   else if(wh.compositeFilter){const a=wh.compositeFilter.filters;const lo=a[0].fieldFilter.value.timestampValue,hi=a[1].fieldFilter.value.timestampValue;docs=docs.filter(d=>d.f.startTime.timestampValue>=lo&&d.f.startTime.timestampValue<hi);}
   return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(docs.length?docs.map(d=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+d.id,fields:d.f,createTime:d.createTime||d.f.startTime.timestampValue}})):[{readTime:'x'}])};}}});
 w.ctx=c;c.Logger.log=m=>w.logs.push(String(m));return w;}
const caso=(email,iso,min,inicioReal,estado,extra)=>({id:email+'_'+iso.replace(/-/g,'')+'_reg',f:Object.assign({tipoRegistro:{stringValue:'tardanza'},userEmail:fsStr(email),fechaISO:fsStr(iso),minutos:fsInt(min),inicioReal:fsStr(inicioReal),estado:fsStr(estado),tipo:fsStr('llamado')},extra||{})});
const turno=(id,email,start,status='ended',extra)=>{const e=Object.assign({},extra||{}),cr=e._create;delete e._create;return{id,f:Object.assign({userEmail:fsStr(email),status:fsStr(status),startTime:fsTs(start)},e),createTime:cr};};
const mrow=(fecha,usuario,ini)=>['',fecha,usuario,'X','',ini,'19:00:00','','','L',''];
{const U1='agente1@pibox.app',U2='agente2@pibox.app',U3='agente3@pibox.app',U4='agente4@pibox.app';
 const w=mundoDiag({
  casos:[caso(U1,'2026-11-03',6,'11:05 a. m.','En plazo de justificación'),            // 11:05:20 → deja de ser tardanza (se guardó 6 por el redondeo)
         caso(U2,'2026-11-03',6,'11:06 a. m.','Enviado',{enviadoISO:fsStr('2026-11-09')}), // 11:06:10 → sigue
         caso(U3,'2026-11-04',6,'11:05 a. m.','Enviado',{enviadoISO:fsStr('2026-11-10')}), // 11:05:41 → deja de serlo y YA se envió
         caso(U4,'2026-11-04',9,'11:09 a. m.','En plazo de justificación')],              // sin turno → sin verificar
  turnos:[turno('t1',U1,BOG('2026-11-03',11,5,20)),turno('t2',U2,BOG('2026-11-03',11,6,10)),turno('t3',U3,BOG('2026-11-04',11,5,41))],
  malla:[mrow('3/11/2026',U1,'11:00:00'),mrow('3/11/2026',U2,'11:00:00'),mrow('4/11/2026',U3,'11:00:00'),mrow('4/11/2026',U4,'11:00:00')]});
 w.ctx.Date=class extends Date{constructor(...a){a.length?super(...a):super(BOG('2026-11-12',8,0).getTime());}static now(){return BOG('2026-11-12',8,0).getTime();}};
 const r=vm.runInContext('diagnosticoToleranciaReglamento()',w.ctx);const L=w.logs.join('\n');
 t('E1 lista los registros que DEJARÍAN de ser tardanza (U1 y U3), los que siguen (U2) y los que no se pueden verificar (U4)',r.dejan.map(x=>x.userEmail).join()===U1+','+U3&&r.siguen.map(x=>x.userEmail).join()===U2&&r.sinDatos.map(x=>x.userEmail).join()===U4,{d:r.dejan.map(x=>x.userEmail),s:r.siguen.map(x=>x.userEmail),sd:r.sinDatos.map(x=>x.userEmail)});
 t('E2 cada línea trae agente, fecha, hora CON SEGUNDOS, retardo en segundos, minutos truncados vs. guardados y estado actual',new RegExp('DEJA DE SER TARDANZA \\| '+U1+' \\| 03/11/2026 \\| programada 11:00 a\\. m\\. \\| inicio 11:05:20 a\\. m\\. \\| retardo 320 s = 5 min \\(guardado: 6 min, «11:05 a\\. m\\.»\\) \\| estado actual: En plazo de justificación').test(L),L);
 t('E3 un registro YA ENVIADO que dejaría de ser tardanza se marca como tal (no se deshace solo)',new RegExp('DEJA DE SER TARDANZA \\| '+U3+'.* \\| estado actual: Enviado · llamado · YA ENVIADO el 2026-11-10').test(L)&&/un llamado YA ENVIADO no se deshace solo/.test(L),L);
 t('E4 resumen: 4 registros · 1 sigue · 2 dejarían de ser tardanza · 1 sin verificar',/4 registros de tardanza.*seguirían: 1.*DEJARÍAN DE SER TARDANZA: 2.*sin verificar: 1/.test(L),L);
 t('E5 SOLO LECTURA: ningún PATCH/POST de escritura, ningún correo, ninguna propiedad; y NO cancela nada',w.writes===0&&w.fetches.every(f=>f.m==='post'||f.m==='get')&&!w.fetches.some(f=>/patch|delete|put/.test(f.m)),w.fetches.map(f=>f.m));}
{// diagnóstico de la hora exacta del inicio de un turno (agente y día por propiedades de script)
 const U='agente1@pibox.app';
 const w=mundoDiag({props:{diag_turno_email:U,diag_turno_dia:'2026-11-09'},
  casos:[caso(U,'2026-11-09',6,'11:05 a. m.','En plazo de justificación')],
  turnos:[turno('tA',U,BOG('2026-11-09',11,5,48,213),'ended',{_create:BOG('2026-11-09',11,5,49,400).toISOString()}),turno('tB',U,BOG('2026-11-08',11,5,0))],
  malla:[mrow('9/11/2026',U,'11:00:00')]});
 const r=vm.runInContext('diagnosticoInicioTurno()',w.ctx);const L=w.logs.join('\n');
 t('E6 muestra la hora EXACTA con segundos (11:05:48) y con milisegundos (ISO), y la que fijó el SERVIDOR al crear el documento',/turno tA \| estado ended \| inicio 11:05:48 a\. m\. \(2026-11-09T16:05:48\.213Z\) \| creado en el servidor 11:05:49 a\. m\. \(2026-11-09T16:05:49\.400Z\)/.test(L),L);
 t('E7 el retardo exacto: 348.2 s = 5 min truncados (regla nueva: dentro de la tolerancia) / 6 min redondeados (regla anterior: tardanza)',/retardo 348\.2 s = 5 min truncados \(regla nueva: dentro de la tolerancia\) \/ 6 min redondeados \(regla anterior: tardanza\)/.test(L),L);
 t('E8 solo lista los turnos de ESE día (el del 8-nov no) y muestra el registro de reglamento_casos de ese día',r.turnos.length===1&&/Registro de reglamento_casos agente1@pibox\.app_20261109_reg: estado En plazo de justificación .* minutos guardados 6 · inicio guardado «11:05 a\. m\.»/.test(L),L);
 t('E9 solo lectura (sin escrituras)',w.writes===0);
 const w2=mundoDiag({props:{},casos:[],turnos:[],malla:[]});let err=null;try{vm.runInContext('diagnosticoInicioTurno()',w2.ctx);}catch(e){err=e;}
 t('E10 sin la propiedad diag_turno_email falla con un mensaje claro (no consulta nada)',!!err&&/diag_turno_email/.test(err.message)&&w2.fetches.length===0,err&&err.message);}
{// falla segura de los diagnósticos: una lectura fallida lanza, no entrega «sin hallazgos»
 const w=mundoDiag({casos:[],turnos:[],malla:[]});w.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>503,getContentText:()=>'x'});let err=null;try{vm.runInContext('diagnosticoToleranciaReglamento()',w.ctx);}catch(e){err=e;}
 t('E11 si no se puede leer Firestore el diagnóstico lanza (no dice «ningún registro dejaría de ser tardanza»)',!!err&&/HTTP 503/.test(err.message),err&&err.message);}
// ═══ F. Estáticos ═══
t('F1 el Reglamento ya no redondea los minutos de retardo y exige el minuto 6 completo',!/Math\.round\(\(turno\.startTime/.test(GSR)&&/reg_minutosRetardo\(turno\.startTime, prog\)/.test(GSR)&&/minutos <= REG\.TOLERANCIA_MIN/.test(GSR));
t('F2 alertas de ausencia: minutos truncados (Math.floor) en checkAttendance y en su diagnóstico',/const minsLate = Math\.floor\(\(now - scheduledStart\) \/ 60000\)/.test(GS0)&&/mins = prog \? Math\.floor\(\(ahora - prog\) \/ 60000\) : 0/.test(GS0));

function fin(){const fails=out.filter(l=>l.startsWith('FAIL'));console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));process.exit(fails.length?1:0);}
