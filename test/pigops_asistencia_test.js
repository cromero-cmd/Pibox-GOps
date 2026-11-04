// Uso: node test/pigops_asistencia_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Alertas de «Ausencia en turno» (checkAttendance en PiGOps_Notificaciones_v5.gs). Caso real del 4-nov-2026 10:32: la lectura de turnos
// falló, getTodayTurnosFromFirebase() devolvió [] y se concluyó «nadie inició turno» → falsas alertas +20/+60 a agentes conectados.
// Aquí: falla segura (403, cuerpo inválido, error dentro del arreglo, excepción de red), aviso técnico máx. 1/hora, formato de los correos,
// destinatarios y niveles sin cambios, y la misma validación estricta en reg_leerTurnos (Reglamento).
process.env.TZ='America/Bogota'; // la zona del proyecto de Apps Script
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const GS0=fs.readFileSync(path.join(root,'PiGOps_Notificaciones_v5.gs'),'utf8');
const GSR=fs.readFileSync(path.join(root,'PiGOps_Reglamento.gs'),'utf8');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

const BOG=(iso,h,mi)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));};
function fmt(d,pat){const P=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return pat.replace('yyyy',P.year).replace('dd',P.day).replace('MM',P.month).replace('HH',P.hour).replace(/\bd\b/,String(+P.day)).replace(/\bM\b/,String(+P.month));}

function mundo(o={}){
 const w={now:o.now||BOG('2026-11-04',10,32),sent:[],logs:[],props:Object.assign({admin_emails:'cromero@pibox.app,otro@pibox.app',malla_sheet_id:'SHEET'},o.props||{}),fetches:[],
  malla:o.malla||[],resp:o.resp,lideres:o.lideres||[]};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,
  Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:(d,tz,pat)=>fmt(d,pat),sleep(){}},
  ScriptApp:{getOAuthToken:()=>'TOKEN'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in w.props?w.props[k]:null,setProperty:(k,v)=>{w.props[k]=String(v);},deleteProperty:k=>{delete w.props[k];}})},
  GmailApp:{sendEmail:(to,subj,body,opt)=>w.sent.push({to,subject:subj,body,html:(opt||{}).htmlBody||'',cc:(opt||{}).cc,name:(opt||{}).name})},
  SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Malla'?{getDataRange:()=>({getDisplayValues:()=>[['h','fecha','usuario','nombre','x','inicio','fin','x','x','lider','novedad']].concat(w.malla)})}
     :n==='BASE 3.0'?{getDataRange:()=>({getValues:()=>[['h']].concat(w.lideres)})}:null})},
  UrlFetchApp:{fetch:(url,opt)=>{w.fetches.push({url,opt});const r=typeof w.resp==='function'?w.resp(url,opt):w.resp;if(r instanceof Error)throw r;
    return{getResponseCode:()=>r.code,getContentText:()=>typeof r.body==='string'?r.body:JSON.stringify(r.body)};}}};
 vm.createContext(ctx);vm.runInContext(GS0,ctx);vm.runInContext(GSR,ctx);
 w.ctx=ctx;
 w.run=(now)=>{if(now)w.now=now;ctx.Date=class extends Date{constructor(...a){a.length?super(...a):super(w.now.getTime());}static now(){return w.now.getTime();}};
   // las clases Date del contexto se reemplazan para que new Date() sea el reloj simulado
   vm.runInContext('checkAttendance()',Object.assign(ctx,{Date:ctx.Date}));};
 w.fila=(fecha,usuario,nombre,inicio,lider)=>[ '', fecha,usuario,nombre,'',inicio,'','','',lider||'jefe@pibox.app',''];
 return w;}
const docTurno=(email,status='active')=>({document:{name:'x',fields:{userEmail:{stringValue:email},status:{stringValue:status},startTime:{timestampValue:'2026-11-04T12:00:00Z'}}}});
const HOY='4/11/2026';
const fallas=w=>w.sent.filter(m=>/No se pudo verificar la asistencia/.test(m.subject));
const ausencias=w=>w.sent.filter(m=>/^Ausencia en turno/.test(m.subject));
const recordatorios=w=>w.sent.filter(m=>/^Recordatorio: Tu turno/.test(m.subject));

// Malla del caso real: 5 agentes con turno a las 9:00, todos CONECTADOS (turno iniciado antes de las 9:05), a las 10:32 → 92 min tarde
const cinco=['agente1','agente2','agente3','agente4','agente5'].map(n=>n+'@pibox.app');
const mallaCinco=()=>cinco.map(e=>['', '04/11/2026',e,e.split('@')[0].toUpperCase(),'','9:00:00','','','','jefe@pibox.app','']);

// ═══ A. Lectura normal ═══
{const w=mundo({malla:mallaCinco(),resp:{code:200,body:cinco.map(e=>docTurno(e))}});w.run();
 t('A1 lectura normal con todos conectados: cero alertas de ausencia y cero avisos técnicos',w.sent.length===0,w.sent.map(m=>m.subject));
 t('A2 la consulta usa el token OAuth y la medianoche de HOY en Bogotá (05:00Z)',w.fetches.length===1&&/Bearer TOKEN/.test(w.fetches[0].opt.headers.Authorization)&&JSON.parse(w.fetches[0].opt.payload).structuredQuery.where.fieldFilter.value.timestampValue==='2026-11-04T05:00:00.000Z',w.fetches[0]&&w.fetches[0].opt.payload);
 t('A3 el límite de la consulta ya no es 200',JSON.parse(w.fetches[0].opt.payload).structuredQuery.limit>200);}
{// a las 23:30 de Bogotá (04:30Z del día siguiente) sigue siendo el día de Bogotá
 const w=mundo({now:BOG('2026-11-04',23,30),malla:[],resp:{code:200,body:[]}});
 const r=vm.runInContext('(function(){return leerTurnosHoyRest_(new Date('+JSON.stringify(BOG('2026-11-04',23,30).toISOString())+'));})()',w.ctx);
 t('A4 a las 23:30 en Bogotá la medianoche sigue siendo la de ese día (no la de UTC)',JSON.parse(w.fetches[0].opt.payload).structuredQuery.where.fieldFilter.value.timestampValue==='2026-11-04T05:00:00.000Z'&&r.ok===true);}
{// Lectura legítimamente vacía ([{readTime}]): ok, y los ausentes reales SÍ reciben alerta
 const w=mundo({malla:[['', '04/11/2026','ana@pibox.app','ANA','','10:00:00','','','','jefe@pibox.app','']],resp:{code:200,body:[{readTime:'2026-11-04T15:32:00Z'}]}});w.run();
 t('A5 sin turnos hoy (respuesta válida vacía) y alguien 32 min tarde: sí se alerta (nivel 2) — el comportamiento normal no cambió',ausencias(w).length===1&&/Segundo aviso \(\+20 min\)/.test(ausencias(w)[0].subject)&&fallas(w).length===0,w.sent.map(m=>m.subject));}
{// un agente conectado y otro ausente
 const w=mundo({malla:[['', '04/11/2026','ana@pibox.app','ANA','','10:00:00','','','','jefe@pibox.app',''],['', '04/11/2026','luis@pibox.app','LUIS','','10:00:00','','','','jefe@pibox.app','']],resp:{code:200,body:[docTurno('ana@pibox.app')]}});w.run();
 t('A6 conectada no recibe nada; ausente recibe aviso al líder + recordatorio a sí misma',ausencias(w).length===1&&/LUIS/.test(ausencias(w)[0].subject)&&recordatorios(w).length===1&&recordatorios(w)[0].to==='luis@pibox.app'&&w.sent.every(m=>!/ANA|ana@/.test(m.subject+m.to)),w.sent.map(m=>m.to+' '+m.subject));}

// ═══ B. Fallas de lectura → falla segura ═══
const fallos={
 'HTTP 403':{code:403,body:[{error:{code:403,status:'PERMISSION_DENIED',message:'Missing or insufficient permissions.'}}]},
 'HTTP 401':{code:401,body:{error:{code:401,status:'UNAUTHENTICATED',message:'Request had invalid authentication credentials.'}}},
 'HTTP 429':{code:429,body:{error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota exceeded.'}}},
 'HTTP 503 con HTML':{code:503,body:'<html>Service Unavailable</html>'},
 'HTTP 200 con cuerpo que no es JSON':{code:200,body:'<html>Login</html>'},
 'HTTP 200 con cuerpo vacío':{code:200,body:''},
 'HTTP 200 con objeto (no arreglo)':{code:200,body:{error:{code:500,message:'boom'}}},
 'HTTP 200 con error dentro del arreglo':{code:200,body:[{error:{code:403,status:'PERMISSION_DENIED',message:'denegado'}}]},
 'excepción de red':new Error('Address unavailable: https://firestore.googleapis.com/'),
 'HTTP 200 con null':{code:200,body:'null'}};
for(const [nombre,resp] of Object.entries(fallos)){
 const w=mundo({malla:mallaCinco(),resp});
 // estado previo: la agente 5 ya tenía registro de avisos; no debe tocarse
 w.props.attendance_notified_today=JSON.stringify({_date:'2026-11-04',['ana@pibox.app']:{n10:true,n20:false,n60:false}});
 const antes=w.props.attendance_notified_today;
 let lanzo=false;try{w.run();}catch(e){lanzo=true;}
 t(`B ${nombre}: no lanza, NO envía ninguna alerta de ausencia ni recordatorio a agentes`,!lanzo&&ausencias(w).length===0&&recordatorios(w).length===0,w.sent.map(m=>m.subject));
 t(`B ${nombre}: envía UN aviso técnico a cromero «No se pudo verificar la asistencia: …»`,fallas(w).length===1&&fallas(w)[0].to==='cromero@pibox.app'&&/^No se pudo verificar la asistencia: .+/.test(fallas(w)[0].subject)&&fallas(w)[0].name==='Pi GOps',fallas(w).map(m=>m.subject));
 t(`B ${nombre}: el estado de «ya notificados» queda intacto (no se borra el de nadie)`,w.props.attendance_notified_today===antes);
 t(`B ${nombre}: el log registra el error`,w.logs.some(l=>/ABORTADA|Firestore turnos de hoy/.test(l))&&w.logs.some(l=>/no se pudo verificar la asistencia/i.test(l)));
 if(/^HTTP (?!200)/.test(nombre)) t(`B ${nombre}: el log incluye el código y el cuerpo`,w.logs.some(l=>l.includes('HTTP '+resp.code)&&l.includes(typeof resp.body==='string'?resp.body.slice(0,20):(resp.body.error||resp.body[0].error).message.slice(0,15))),w.logs.filter(l=>/HTTP/.test(l)));
}
{// límite alcanzado = resultado posiblemente incompleto → también falla segura
 const docs=Array.from({length:1000},(_, i)=>docTurno('u'+i+'@pibox.app'));
 const w=mundo({malla:mallaCinco(),resp:{code:200,body:docs}});w.run();
 t('B límite de 1000 turnos alcanzado: falla segura (no se asume que es la lista completa)',ausencias(w).length===0&&fallas(w).length===1&&/límite/.test(fallas(w)[0].subject+fallas(w)[0].html),w.sent.map(m=>m.subject));}

// ═══ C. Aviso técnico: máximo uno por hora ═══
{const w=mundo({malla:mallaCinco(),resp:{code:403,body:[{error:{code:403,message:'denegado'}}]}});
 w.run(BOG('2026-11-04',10,32));w.run(BOG('2026-11-04',10,42));w.run(BOG('2026-11-04',11,0));w.run(BOG('2026-11-04',11,31));
 t('C1 cuatro ejecuciones fallidas en 59 min → un solo aviso técnico',fallas(w).length===1,fallas(w).length);
 w.run(BOG('2026-11-04',11,33));
 t('C2 pasada una hora desde el último aviso se envía otro',fallas(w).length===2,fallas(w).length);
 t('C3 el aviso técnico lleva encabezado rojo, el motivo, el pie de Pi GOps y aclara que no se envió ninguna alerta',/#dc2626/.test(fallas(w)[0].html)&&/HTTP 403/.test(fallas(w)[0].html)&&/Este mensaje fue generado automáticamente por Pi GOps · Pibox Operaciones/.test(fallas(w)[0].html)&&/no se envió ninguna alerta de ausencia/.test(fallas(w)[0].html));
 // recuperación: la lectura vuelve a funcionar → comportamiento normal, sin tormenta de alertas para los conectados
 w.resp={code:200,body:cinco.map(e=>docTurno(e))};const antes=w.sent.length;w.run(BOG('2026-11-04',11,40));
 t('C4 al recuperarse la lectura, los 5 conectados no reciben nada',w.sent.length===antes,w.sent.slice(antes).map(m=>m.subject));}
{// si el correo técnico mismo falla: no lanza y no marca la hora
 const w=mundo({malla:mallaCinco(),resp:{code:500,body:'x'}});w.ctx.GmailApp.sendEmail=()=>{throw new Error('cuota de correo');};
 let lanzo=false;try{w.run();}catch(e){lanzo=true;}
 t('C5 si falla el envío del aviso técnico no se propaga el error ni se marca como enviado',!lanzo&&!w.props.attendance_fail_notified_at&&w.logs.some(l=>/No se pudo enviar el aviso técnico/.test(l)));}

// ═══ D. Niveles y destinatarios (sin cambios) ═══
function unoAusente(min,lider,extra={}){const ini=new Date(BOG('2026-11-04',10,32).getTime()-min*60000);const hh=parseInt(fmt(ini,'HH')),mm=ini.getMinutes();
 const w=mundo(Object.assign({malla:[['', '04/11/2026','ana@pibox.app','ANA PÉREZ','',`${hh}:${String(mm).padStart(2,'0')}:00`,'','','',lider===undefined?'jefe@pibox.app':lider,'']],resp:{code:200,body:[]}},extra));w.run();return w;}
{const niveles=[[4,0,null],[6,0,null],[12,1,'Primer aviso (+10 min)'],[25,1,'Segundo aviso (+20 min)'],[59,1,'Segundo aviso (+20 min)'],[60,1,'Aviso final (+60 min)'],[92,1,'Aviso final (+60 min)']];
 for(const [min,n,lab] of niveles){const w=unoAusente(min);t(`D niveles: ${min} min tarde → ${lab||'sin aviso'}`,ausencias(w).length===n&&(!lab||ausencias(w)[0].subject==='Ausencia en turno: ANA PÉREZ — '+lab),w.sent.map(m=>m.subject));}
 const w=unoAusente(25);const a=ausencias(w)[0],r=recordatorios(w)[0];
 t('D líder recibe el aviso con copia a cromero; el agente recibe el recordatorio (mismos asuntos de siempre)',a.to==='jefe@pibox.app'&&a.cc==='cromero@pibox.app'&&r.to==='ana@pibox.app'&&r.subject==='Recordatorio: Tu turno comenzó hace 25 minutos'&&!r.cc,[a.to,a.cc,r.to,r.subject]);
 const w2=unoAusente(25,'cromero@pibox.app');
 t('D si el líder es cromero no hay copia',ausencias(w2)[0].to==='cromero@pibox.app'&&!ausencias(w2)[0].cc);
 const w3=unoAusente(25,'');
 t('D sin líder: va a los admins (primero para, resto y cromero en copia) y el agente también',ausencias(w3)[0].to==='cromero@pibox.app'&&ausencias(w3)[0].cc==='otro@pibox.app'&&recordatorios(w3).length===1,[ausencias(w3)[0].to,ausencias(w3)[0].cc]);
 const w4=unoAusente(25,'Laura Líder',{lideres:[['','','','','Laura Líder','','laura@pibox.app']]});
 t('D líder por nombre se resuelve con BASE 3.0',ausencias(w4)[0].to==='laura@pibox.app'&&ausencias(w4)[0].cc==='cromero@pibox.app');
 const w6=unoAusente(25);const n6=w6.sent.length;w6.run(BOG('2026-11-04',10,40));
 t('D segunda ejecución con el mismo nivel no reenvía',w6.sent.length===n6,w6.sent.map(m=>m.subject));
 w6.malla[0][5]='9:00:00';w6.run(BOG('2026-11-04',10,40)); // ahora 100 min tarde → nivel 3 (nuevo)
 t('D un nivel distinto sí se envía',w6.sent.length>n6&&/Aviso final/.test(w6.sent[w6.sent.length-2].subject),w6.sent.map(m=>m.subject));}

// ═══ E. Formato de los correos ═══
{const niv=[[12,'#eab308','Primer aviso (+10 min)'],[25,'#fb923c','Segundo aviso (+20 min)'],[92,'#dc2626','Aviso final (+60 min)']];
 for(const [min,color,lab] of niv){const w=unoAusente(min);const a=ausencias(w)[0],r=recordatorios(w)[0];
  t(`E ${lab}: remitente «Pi GOps» y encabezado ${color}`,a.name==='Pi GOps'&&r.name==='Pi GOps'&&new RegExp('background:'+color).test(a.html)&&new RegExp('background:'+color).test(r.html),[a.name,a.html.slice(0,160)]);}
 const w=unoAusente(92);const h=ausencias(w)[0].html,r=recordatorios(w)[0].html;
 t('E tabla con colaborador, correo, turno programado, minutos de retraso y nivel del aviso',['Colaborador','Correo','Turno programado','Minutos de retraso','Nivel del aviso'].every(c=>h.includes('>'+c+'<'))&&h.includes('ANA PÉREZ')&&h.includes('ana@pibox.app')&&h.includes('92 minutos')&&h.includes('Aviso final (+60 min)'));
 t('E pie «Este mensaje fue generado automáticamente por Pi GOps · Pibox Operaciones» en ambos correos',[h,r].every(x=>x.includes('Este mensaje fue generado automáticamente por Pi GOps · Pibox Operaciones')));
 t('E ortografía: «aún» y «situación»; sin «aun no», «situacion» ni «lider»',/aún no ha iniciado/.test(h)&&/situación/.test(h)&&/aún no has registrado/.test(r)&&!/aun no|situacion|\blider\b/i.test(h+r));
 t('E hora colombiana «9:00 a. m.», sin segundos',h.includes('9:00 a. m.')&&!/9:00:00/.test(h)&&r.includes('9:00 a. m.')&&!/9:00:00/.test(r),h.match(/Turno programado[\s\S]{0,120}/)[0]);
 const hc=vm.runInContext('horaColombiana_',w.ctx);
 t('E horaColombiana_: 9:00:00→9:00 a. m., 14:30→2:30 p. m., 12:05→12:05 p. m., 0:15→12:15 a. m., 09:00 AM→9:00 a. m., 2:30 PM→2:30 p. m., texto raro intacto',hc('9:00:00')==='9:00 a. m.'&&hc('14:30')==='2:30 p. m.'&&hc('12:05')==='12:05 p. m.'&&hc('0:15')==='12:15 a. m.'&&hc('09:00 AM')==='9:00 a. m.'&&hc('2:30 PM')==='2:30 p. m.'&&hc('mañana')==='mañana'&&hc('')==='',[hc('9:00:00'),hc('14:30'),hc('12:05'),hc('0:15'),hc('09:00 AM'),hc('2:30 PM')]);
 const wx=mundo({malla:[['', '04/11/2026','ana@pibox.app','<b>ANA</b> & "X"','','9:00:00','','','','jefe@pibox.app','']],resp:{code:200,body:[]}});wx.run();
 t('E el nombre se escapa en el HTML (sin inyección)',!/<b>ANA<\/b>/.test(ausencias(wx)[0].html)&&/&lt;b&gt;ANA&lt;\/b&gt; &amp; &quot;X&quot;/.test(ausencias(wx)[0].html));}

// ═══ F. Reglamento: lectura de turnos estricta ═══
function rw(resp){const w=mundo({resp});return w;}
for(const [nombre,resp] of Object.entries({'HTTP 403':fallos['HTTP 403'],'cuerpo no arreglo (HTTP 200)':fallos['HTTP 200 con objeto (no arreglo)'],'error dentro del arreglo (HTTP 200)':fallos['HTTP 200 con error dentro del arreglo'],'excepción de red':fallos['excepción de red']})){
 const w=rw(resp);let msg='';try{vm.runInContext('reg_leerTurnos("2026-11-01", new Date("2026-11-04T20:00:00Z"))',w.ctx);}catch(e){msg=e.message;}
 t(`F reg_leerTurnos ${nombre}: lanza (el proceso aborta, no lo lee como «sin turnos»)`,!!msg,msg);}
{const w=rw({code:200,body:[docTurno('ana@pibox.app'),{readTime:'x'}]});const r=vm.runInContext('reg_leerTurnos("2026-11-01", new Date("2026-11-04T20:00:00Z"))',w.ctx);
 t('F reg_leerTurnos con respuesta válida devuelve los turnos',r.length>=1&&r[0].userEmail==='ana@pibox.app',r);}

// ═══ G. Estático ═══
t('G getTodayTurnosFromFirebase ya no traga el error en un catch que devuelve []: solo existe como envoltorio de leerTurnosHoyRest_',(GS0.match(/function getTodayTurnosFromFirebase\(/g)||[]).length===1&&!/Firebase REST error/.test(GS0));
for(const f of ['checkAttendance','sendAttendanceAlert','leerTurnosHoyRest_','avisoTecnicoAsistencia_','horaColombiana_','escHtml_','filaAlerta_','resumenErrorFirestore_']) t(`G ${f} definida una sola vez`,(GS0.match(new RegExp('function '+f+'\\('))||[]).length===1&&(GSR.match(new RegExp('function '+f+'\\('))||[]).length===0);

console.log(out.join('\n'));
const bad=out.filter(l=>l.startsWith('FAIL'));
console.log(`\n${out.length-bad.length}/${out.length} OK`);
process.exit(bad.length?1:0);
