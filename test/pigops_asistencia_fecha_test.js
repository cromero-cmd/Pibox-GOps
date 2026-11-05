// Uso: node test/pigops_asistencia_fecha_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
//   GS_NOTIF=/ruta/al/.gs node test/pigops_asistencia_fecha_test.js   → corre las mismas pruebas contra otra versión del script (p. ej. la anterior)
// Falsas alertas de «Ausencia en turno» por fecha (5-nov-2026): checkAttendance aceptaba también el formato M/d/yyyy; la malla es SIEMPRE
// día/mes/año, así que del 1 al 12 de cada mes «hoy» coincidía con el día 11 de otro mes (5-nov → «11/5/2026» = 11 de mayo).
// Aquí: fechas simuladas (5, 4, 12 y 13 de noviembre, 22 de octubre), agentes retirados (BASE 3.0 y propiedad) en checkAttendance, recordatorios
// y Reglamento, y el diagnóstico de solo lectura.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const GS0=fs.readFileSync(process.env.GS_NOTIF||path.join(root,'PiGOps_Notificaciones_v5.gs'),'utf8');
const GSR=fs.readFileSync(path.join(root,'PiGOps_Reglamento.gs'),'utf8');
const HTML=fs.readFileSync(path.join(root,'index.html'),'utf8');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

const BOG=(iso,h,mi)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));};
function fmt(d,pat){const P=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return pat.replace('yyyy',P.year).replace('dd',P.day).replace('MM',P.month).replace('HH',P.hour).replace('mm',P.minute).replace(/\bd\b/,String(+P.day)).replace(/\bM\b/,String(+P.month));}

// BASE 3.0 con la estructura REAL: fila 1 vacía; fila 2 con «VACACIONES» sobre L–O; encabezados en la fila 3; datos desde la fila 4.
// Columnas: A vacía, B OPERADOR, C TIPO DE DOC., D DOCUMENTO, E NOMBRE, F CARGO, G CORREO, H ROL TRUMP, I LÍDER INMEDIATO, J ciudad, K dirección,
// L–O FECHA 1–4 (vacaciones), P LINEA DE EXPERIENCIA.
const ENC=['','OPERADOR','TIPO DE DOC.','DOCUMENTO','NOMBRE','CARGO','CORREO','ROL TRUMP','LÍDER INMEDIATO','CIUDAD','DIRECCIÓN','FECHA 1','FECHA 2','FECHA 3','FECHA 4','LINEA DE EXPERIENCIA'];
const VAC=['','','','','','','','','','','','VACACIONES','','','',''];
const VACIA=ENC.map(()=>'');
const base=(email,nombre,cargo)=>['','Pibox','CC','100',nombre||email.split('@')[0].toUpperCase(),cargo===undefined?'AGENTE DE OPERACIONES':cargo,email,'','JEFE','Bogotá','Calle 1','','','','',''];
const hoja=(datos,arriba)=>[VACIA,VAC,ENC].concat(datos||[]);   // la hoja completa tal como la devuelve getValues()
function mundo(o={}){
 const w={now:o.now||BOG('2026-11-05',10,32),sent:[],logs:[],props:Object.assign({admin_emails:'cromero@pibox.app',malla_sheet_id:'SHEET'},o.props||{}),fetches:[],
  malla:o.malla||[],base:o.base===undefined?hoja([]):o.base,resp:o.resp===undefined?{code:200,body:[{readTime:'x'}]}:o.resp};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,
  Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:(d,tz,pat)=>fmt(d,pat),sleep(){}},
  ScriptApp:{getOAuthToken:()=>'TOKEN'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in w.props?w.props[k]:null,setProperty:(k,v)=>{w.props[k]=String(v);},deleteProperty:k=>{delete w.props[k];}})},
  GmailApp:{sendEmail:(to,subj,body,opt)=>w.sent.push({to,subject:subj,html:(opt||{}).htmlBody||'',cc:(opt||{}).cc})},
  SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='Malla'?{getDataRange:()=>({getDisplayValues:()=>[['h','fecha','usuario','nombre','x','inicio','fin','x','x','lider','novedad']].concat(w.malla)})}
     :n==='BASE 3.0'&&w.base?{getDataRange:()=>({getValues:()=>w.base})}:null})},
  UrlFetchApp:{fetch:(url,opt)=>{w.fetches.push({url,opt});const r=typeof w.resp==='function'?w.resp(url,opt):w.resp;if(r instanceof Error)throw r;
    return{getResponseCode:()=>r.code,getContentText:()=>typeof r.body==='string'?r.body:JSON.stringify(r.body)};}}};
 vm.createContext(ctx);vm.runInContext(GS0,ctx);vm.runInContext(GSR,ctx);
 w.ctx=ctx;
 w.run=(fn,now)=>{if(now)w.now=now;ctx.Date=class extends Date{constructor(...a){a.length?super(...a):super(w.now.getTime());}static now(){return w.now.getTime();}};
   return vm.runInContext(fn,ctx);};
 // fila de la malla: texto de la fecha TAL COMO la muestra la hoja (d/M/yyyy sin ceros, o con ellos)
 w.fila=(fecha,usuario,inicio,extra)=>Object.assign(['',fecha,usuario,usuario.split('@')[0].toUpperCase(),'',inicio,'','','','jefe@pibox.app',''],extra||{});
 return w;}
const ausencias=w=>w.sent.filter(m=>/^Ausencia en turno/.test(m.subject));
const aAgente=w=>w.sent.filter(m=>/^Recordatorio: Tu turno comenzó/.test(m.subject));
const nombresAlertados=w=>ausencias(w).map(m=>m.subject.replace(/^Ausencia en turno: /,'').split(' — ')[0]).sort();
const fallas=w=>w.sent.filter(m=>/No se pudo verificar la asistencia/.test(m.subject));

// ═══ A. Interpretación de fechas de la malla (siempre día/mes/año) ═══
{const w=mundo();const F=s=>w.ctx.mallaFechaISO_(s);
 t('A1 «5/11/2026», «05/11/2026», «05-11-2026» y «5/11/26» son el 5 de noviembre',['5/11/2026','05/11/2026','05-11-2026','5/11/26'].every(s=>F(s)==='2026-11-05'));
 t('A2 «11/5/2026» es el 11 de MAYO, no el 5 de noviembre',F('11/5/2026')==='2026-05-11');
 t('A3 «11/13/2026» no es una fecha (mes 13) y «31/02/2026» tampoco',F('11/13/2026')===null&&F('31/02/2026')===null);
 t('A4 el formato ISO es inequívoco; vacío y texto raro dan null',F('2026-11-05')==='2026-11-05'&&F('')===null&&F(null)===null&&F('hoy')===null);
 t('A5 una fecha con hora pegada («05/11/2026 0:00:00») se lee igual',F('05/11/2026 0:00:00')==='2026-11-05');
 t('A6 el 29-feb de un año bisiesto existe y el de uno común no',F('29/02/2028')==='2028-02-29'&&F('29/02/2026')===null);}

// ═══ B. checkAttendance con fechas simuladas ═══
// Cada caso: un agente con fila REAL de hoy (sin turno → debe alertarse) y una fila «fantasma» = el texto M/d/yyyy de hoy, que es OTRO día.
function caso(nombre,hoyISO,filaReal,filaFantasma,hh=10,mm=32){
 const w=mundo({now:BOG(hoyISO,hh,mm),malla:[w0.fila(filaReal,'ana@pibox.app','9:00:00'),w0.fila(filaFantasma,'luis@pibox.app','9:00:00')]});
 w.run('checkAttendance()');
 return w;}
const w0=mundo();
{const w=caso('5-nov','2026-11-05','5/11/2026','11/5/2026');
 t('B1 5-nov: alerta a quien está en la malla de hoy (ana) y NO a la fila del 11 de mayo (luis)',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));
 t('B1b …y el agente fantasma tampoco recibe el correo «Tu turno comenzó hace N minutos»',aAgente(w).map(m=>m.to).join()==='ana@pibox.app',aAgente(w).map(m=>m.to));
 t('B1c el log dice qué fecha se busca y revisa 1 sola fila',w.logs.some(l=>/Looking for date: 05\/11\/2026/.test(l))&&w.logs.some(l=>/Checking 1 entries for today/.test(l)),w.logs);}
{const w=caso('4-nov','2026-11-04','4/11/2026','11/4/2026');
 t('B2 4-nov: no toma el 11 de abril',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));}
{const w=caso('12-nov','2026-11-12','12/11/2026','11/12/2026');
 t('B3 12-nov: no toma el 11 de diciembre («11/12/2026»)',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));}
{const w=mundo({now:BOG('2026-11-13',10,32),malla:[w0.fila('13/11/2026','ana@pibox.app','9:00:00'),w0.fila('11/13/2026','luis@pibox.app','9:00:00')]});w.run('checkAttendance()');
 t('B4 13-nov: ya no hay ambigüedad posible; «11/13/2026» no es fecha y no se toma',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));}
{const w=mundo({now:BOG('2026-10-22',10,32),malla:[w0.fila('22/10/2026','ana@pibox.app','9:00:00'),w0.fila('10/22/2026','luis@pibox.app','9:00:00')]});w.run('checkAttendance()');
 t('B5 22-oct: toma «22/10/2026»; la fila malformada «10/22/2026» (la que aceptaba el formato M/d) no cuenta',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));}
{const w=mundo({now:BOG('2026-11-11',10,32),malla:[w0.fila('11/11/2026','ana@pibox.app','9:00:00')]});w.run('checkAttendance()');
 t('B6 11-nov (día = mes): una sola fila, una sola alerta',JSON.stringify(nombresAlertados(w))==='["ANA"]'&&w.sent.length===2,w.sent.map(m=>m.subject));}
{const w=mundo({malla:[w0.fila('05-11-2026','a1@pibox.app','9:00:00'),w0.fila('5/11/2026','a2@pibox.app','9:00:00'),w0.fila('05/11/2026','a3@pibox.app','9:00:00')]});w.run('checkAttendance()');
 t('B7 las tres escrituras de la fecha de hoy (05-11-2026, 5/11/2026, 05/11/2026) siguen funcionando',JSON.stringify(nombresAlertados(w))==='["A1","A2","A3"]',w.sent.map(m=>m.subject));}
{// conectado: no se alerta aunque el correo difiera en mayúsculas
 const w=mundo({malla:[w0.fila('5/11/2026','Ana@pibox.app','9:00:00')],resp:{code:200,body:[{document:{name:'x',fields:{userEmail:{stringValue:'ana@pibox.app'},status:{stringValue:'active'},startTime:{timestampValue:'2026-11-05T14:00:00Z'}}}}]}});
 w.run('checkAttendance()');
 t('B8 agente conectado con el correo en otra capitalización: no se alerta',w.sent.length===0,w.sent.map(m=>m.subject));}

// ═══ C. Retirados: CARGO = INACTIVO en BASE 3.0 (encabezados en la fila 3, no en la 1) ═══
const hoyFilas=()=>[w0.fila('5/11/2026','ana@pibox.app','9:00:00'),w0.fila('5/11/2026','beto@pibox.app','9:00:00')];
{const w=mundo({malla:hoyFilas(),base:hoja([base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO')])});w.run('checkAttendance()');
 t('C1 agente con CARGO = INACTIVO en la malla de hoy: no recibe alerta de ausencia ni correo; el activo sí',JSON.stringify(nombresAlertados(w))==='["BETO"]'&&!w.sent.some(m=>m.to==='ana@pibox.app'),w.sent.map(m=>m.subject+'→'+m.to));
 t('C1b el log dice por qué se ignora (fila de BASE 3.0 y valor)',w.logs.some(l=>/Se ignora a ana@pibox\.app: figura como retirado \(BASE 3\.0, fila 4, CARGO = INACTIVO\)/.test(l)),w.logs);}
for(const [etq,cargo] of [['minúsculas','inactivo'],['con espacios',' Inactivo  '],['mezcla','InAcTiVo'],['espacio interno','IN ACTIVO']]){
 const w=mundo({malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00')],base:hoja([base('ana@pibox.app','ANA',cargo)])});w.run('checkAttendance()');
 t('C2 CARGO «'+cargo+'» ('+etq+') cuenta como INACTIVO',w.sent.length===0,w.sent.map(m=>m.subject));}
for(const cargo of ['AGENTE DE OPERACIONES','COORDINADOR','','ACTIVO','INACTIVO TEMPORAL']){
 const w=mundo({malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00')],base:hoja([base('ana@pibox.app','ANA',cargo)])});w.run('checkAttendance()');
 t('C3 CARGO «'+cargo+'» NO es retirado: sí se alerta',JSON.stringify(nombresAlertados(w))==='["ANA"]',w.sent.map(m=>m.subject));}
{const w=mundo({malla:hoyFilas(),base:hoja([base('ana@pibox.app','ANA'),base('beto@pibox.app','BETO')]),props:{agentes_retirados:' Ana@pibox.app ;otro@pibox.app'}});w.run('checkAttendance()');
 t('C4 la propiedad agentes_retirados (mayúsculas y espacios incluidos) excluye aunque BASE 3.0 diga activo',JSON.stringify(nombresAlertados(w))==='["BETO"]',w.sent.map(m=>m.subject));}
{const w=mundo({malla:[w0.fila('5/11/2026','Ana@pibox.app','9:00:00')],base:hoja([base('ana@pibox.app','ANA','INACTIVO')])});w.run('checkAttendance()');
 t('C5 la comparación de correos no distingue mayúsculas (malla «Ana@», BASE «ana@»)',w.sent.length===0,w.sent.map(m=>m.subject));}
// Encabezados movidos: la fila se BUSCA, no se supone
{const filas=[base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO')];
 const casos={'en la fila 1':[ENC].concat(filas),'en la fila 3 (real)':[VACIA,VAC,ENC].concat(filas),'en la fila 7 (alguien agregó filas arriba)':[VACIA,VACIA,VACIA,VACIA,VAC,VACIA,ENC].concat(filas),
  'con una fila de totales y otra vacía entre encabezados y datos':[VACIA,ENC,VACIA].concat(filas)};
 for(const [etq,sheet] of Object.entries(casos)){
  const w=mundo({malla:hoyFilas(),base:sheet});w.run('checkAttendance()');
  t('C6 encabezados '+etq+': ana (INACTIVO) ignorada, beto alertado',JSON.stringify(nombresAlertados(w))==='["BETO"]'&&fallas(w).length===0,w.sent.map(m=>m.subject));}}
{const w=mundo({malla:hoyFilas(),base:[VACIA,VAC,ENC.map(h=>h==='CORREO'?'EMAIL':h),base('ana@pibox.app','ANA','INACTIVO')]});w.run('checkAttendance()');
 t('C7 BASE 3.0 sin ninguna fila con «CORREO»: FALLA SEGURA — ninguna alerta y UN aviso técnico que lo explica',ausencias(w).length===0&&aAgente(w).length===0&&fallas(w).length===1&&/CORREO/.test(fallas(w)[0].html),w.sent.map(m=>m.subject));}
{const w=mundo({malla:hoyFilas(),base:null});w.run('checkAttendance()');
 t('C8 BASE 3.0 inexistente: FALLA SEGURA — ninguna alerta de ausencia y UN aviso técnico',ausencias(w).length===0&&aAgente(w).length===0&&fallas(w).length===1,w.sent.map(m=>m.subject));
 t('C8b el aviso técnico dice que no se pudo leer BASE 3.0',fallas(w).length&&/BASE 3\.0/.test(fallas(w)[0].subject+fallas(w)[0].html),fallas(w).map(m=>m.subject));
 w.run('checkAttendance()');
 t('C8c un segundo intento en la misma hora no repite el aviso técnico',fallas(w).length===1);}
{// el líder por nombre y la cédula se leen bien con los encabezados en la fila 3 (antes se leía desde la fila 1)
 const w=mundo({base:hoja([base('laura@pibox.app','Laura Líder'),base('ana@pibox.app','ANA','INACTIVO')])});
 const lm=w.run('getLiderEmailMap()'),dm=w.run('getAgentDataMap()');
 t('C9 getLiderEmailMap con los encabezados en la fila 3: nombre → correo, sin la fila de encabezados como «agente»',lm['Laura Líder']==='laura@pibox.app'&&!lm['NOMBRE']&&!('CORREO' in lm),lm);
 t('C10 getAgentDataMap: cédula (columna DOCUMENTO) y nombre; incluye al retirado (la nómina pasada lo necesita) y no la fila de encabezados',dm['laura@pibox.app']&&dm['laura@pibox.app'].cedula==='100'&&dm['ana@pibox.app']&&!dm['CORREO'],dm);}

// ═══ C2. Strikes: sendPendingStrikeAlerts / getAgentsFromBase3 ═══
{const w=mundo({base:hoja([base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO'),base('coord@pibox.app','COORD','COORDINADOR DE OPERACIONES'),base('cromero@pibox.app','SUPER','GERENTE'),base('dani@pibox.app','DANI','AGENTE')]),props:{agentes_retirados:'dani@pibox.app'}});
 const ag=w.run('getAgentsFromBase3()');
 t('S1 getAgentsFromBase3 excluye a los INACTIVO (y a los de la propiedad) y a coordinadores/admins; ya no toma la fila de encabezados como agente',JSON.stringify(ag.map(a=>a.email))==='["beto@pibox.app"]',ag);}
{ // sendPendingStrikeAlerts de punta a punta: un agente activo con 3 tardanzas y uno INACTIVO con 3 tardanzas → solo el activo se evalúa
 const w=mundo({base:hoja([base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO')])});
 w.run('sendPendingStrikeAlerts()');
 t('S2 sendPendingStrikeAlerts evalúa solo 1 agente (el INACTIVO queda fuera)',w.logs.some(l=>/sendPendingStrikeAlerts: 1 agentes a evaluar/.test(l)),w.logs.filter(l=>/agentes/.test(l)));}

// ═══ D. Recordatorio de inicio de turno (sendShiftReminders) ═══
{const w=mundo({now:BOG('2026-11-05',8,50),malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00'),w0.fila('11/5/2026','luis@pibox.app','9:00:00'),w0.fila('5/11/2026','retirada@pibox.app','9:00:00')],
   base:hoja([base('ana@pibox.app','ANA'),base('luis@pibox.app','LUIS'),base('retirada@pibox.app','RETIRADA','INACTIVO')])});
 w.run('sendShiftReminders()');
 t('D1 recordatorio de las 8:50: solo a quien tiene turno HOY y no está retirado (ni a la fila del 11 de mayo)',w.sent.length===1&&w.sent[0].to==='ana@pibox.app',w.sent.map(m=>m.to));}

// ═══ E. Reglamento: la malla se lee día/mes/año y los retirados se ignoran ═══
{const w=mundo({malla:[w0.fila('11/5/2026','ana@pibox.app','9:00:00'),w0.fila('5/11/2026','ana@pibox.app','9:00:00')]});
 const iso=w.ctx.reg_isoDesdeDDMMYYYY;
 t('E1 reg_isoDesdeDDMMYYYY: «11/5/2026» = 11-may y «5/11/2026» = 5-nov',iso('11/5/2026')==='2026-05-11'&&iso('5/11/2026')==='2026-11-05');
 const filas=w.run('reg_leerMalla("2026-11-05")');
 t('E2 reg_leerMalla desde el 5-nov incluye «5/11/2026» y deja fuera «11/5/2026»',filas.length===1&&filas[0].fecha==='5/11/2026',filas);}
{ // reg_correr con deps falsos: dos agentes con la misma tardanza (3-nov), una retirada
 const w=mundo({base:hoja([base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO')])});const R=n=>w.ctx[n];
 const db={reglamento_casos:{},strike_waivers:{},strike_appeals:{}},sent=[];
 const turno=e=>({userEmail:e,status:'ended',startTime:new Date(BOG('2026-11-03',9,0).getTime()+15*60000),endTime:BOG('2026-11-03',17,0)});
 const mallaR=['ana@pibox.app','beto@pibox.app'].map(e=>({fecha:'3/11/2026',usuario:e,inicio:'9:00:00',fin:'16:00:00',novedad:'',lider:'jefe@pibox.app'}));
 const mk=(now,conRetirados)=>{const d={now:()=>now,config:()=>({modoPrueba:false,thEmail:'th@pibox.app',firmanteNombre:'F',firmanteCargo:'C',testEmail:'cromero@pibox.app',templateId:'T'}),
   leerMalla:()=>mallaR,leerTurnos:()=>['ana@pibox.app','beto@pibox.app'].map(turno),
   agentes:()=>({'ana@pibox.app':{nombre:'Ana',cargo:'A',cedula:'1',liderEmail:'jefe@pibox.app'},'beto@pibox.app':{nombre:'Beto',cargo:'A',cedula:'2',liderEmail:'jefe@pibox.app'}}),
   listar:c=>JSON.parse(JSON.stringify(db[c]||{})),
   crear:(c,id,o)=>{db[c]=db[c]||{};if(db[c][id])return false;db[c][id]=JSON.parse(JSON.stringify(o));return true;},
   actualizar:(c,id,o)=>{db[c][id]=Object.assign(db[c][id]||{},JSON.parse(JSON.stringify(o)));},
   enviarCorreo:m=>sent.push(m),generarPdfLlamado:()=>({blob:{name:'l.pdf'},url:'u'}),generarSoporte:()=>({blob:{name:'s.xlsx'},url:'u'})};
   if(conRetirados)d.retirados=w.ctx.reg_depsProduccion().retirados;return d;}; // el dep REAL de producción, leyendo BASE 3.0 (ana = INACTIVO)
 const r1=R('reg_correr')(mk(BOG('2026-11-04',7,0),true),{avisos:true,plazos:false});
 t('E3 Reglamento (con el dep de producción y BASE 3.0, ana = INACTIVO): la tardanza de la retirada no genera aviso, ni registro; la del agente activo sí',r1.avisos===1&&r1.retirados===1&&Object.keys(db.reglamento_casos).length===1&&Object.keys(db.reglamento_casos)[0].indexOf('beto@')===0,{r1,k:Object.keys(db.reglamento_casos)});
 sent.length=0;
 const r2=R('reg_correr')(mk(BOG('2026-11-09',7,0),true),{avisos:true,plazos:true});
 t('E4 vencido el plazo: llamado solo para el activo; la retirada no recibe llamado (ni siquiera con un caso previo)',r2.llamados===1&&sent.every(m=>!/ana@/.test(JSON.stringify(m.to))),{r2,to:sent.map(m=>m.to)});
 // sin deps.retirados (compatibilidad): se comporta como antes
 const db2=db;Object.keys(db).forEach(k=>db[k]={});sent.length=0;
 const r3=R('reg_correr')(mk(BOG('2026-11-04',7,0),false),{avisos:true,plazos:false});
 t('E5 sin lista de retirados (compatibilidad) ambos reciben aviso',r3.avisos===2,r3);}
{ // reg_agentes lee BASE 3.0 con los encabezados en la fila 3
 const wa=mundo({base:hoja([base('beto@pibox.app','BETO','AGENTE DE OPERACIONES')])});const ag=wa.run('reg_agentes([])');
 t('E5b reg_agentes toma nombre, cargo y cédula de BASE 3.0 con los encabezados en la fila 3 (sin la fila de encabezados como agente)',ag['beto@pibox.app']&&ag['beto@pibox.app'].cargo==='AGENTE DE OPERACIONES'&&ag['beto@pibox.app'].cedula==='100'&&!ag['CORREO'],ag);}
{ // producción: el dep lee BASE 3.0 y lanza si no se puede
 const w=mundo({base:hoja([base('ana@pibox.app','ANA','INACTIVO'),base('beto@pibox.app','BETO')])});
 const set=w.run('reg_depsProduccion().retirados("2026-11-05")');
 t('E6 reg_depsProduccion().retirados lee BASE 3.0',set['ana@pibox.app']===true&&!set['beto@pibox.app'],set);
 const w2=mundo({base:null});let lanzo=false;try{w2.run('reg_depsProduccion().retirados("2026-11-05")');}catch(e){lanzo=/BASE 3\.0/.test(e.message);}
 t('E7 si BASE 3.0 no se puede leer, el Reglamento ABORTA (lanza) en vez de actuar sin saber quién está retirado',lanzo);}

// ═══ F. Diagnóstico de solo lectura ═══
{const w=mundo({malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00'),w0.fila('11/5/2026','luis@pibox.app','9:00:00'),w0.fila('5/11/2026','sin@pibox.app',''),w0.fila('5/11/2026','novedad@pibox.app','9:00:00',{10:'Incapacidad'}),w0.fila('5/11/2026','retirada@pibox.app','9:00:00')],
   base:hoja([base('ana@pibox.app'),base('luis@pibox.app'),base('retirada@pibox.app','RETIRADA','INACTIVO')]),props:{pigops_marca:'x'}});
 const props0=JSON.stringify(w.props);
 const r=w.run('diagnosticoAsistencia()');
 const L=w.logs.join('\n');
 t('F1 el diagnóstico no envía ningún correo ni escribe propiedades',w.sent.length===0&&JSON.stringify(w.props)===props0,w.sent);
 t('F2 solo lee Firestore (runQuery) y no escribe: una única consulta POST a :runQuery',w.fetches.length===1&&/:runQuery$/.test(w.fetches[0].url),w.fetches.map(f=>f.url));
 t('F3 lista como TOMADA solo a ana y explica las descartadas (sin hora, con novedad, retirada)',r.tomadas.length===1&&r.tomadas[0].usuario==='ana@pibox.app'&&/sin hora de inicio/.test(L)&&/con novedad «Incapacidad»/.test(L)&&/retirado — BASE 3\.0, fila 6, CARGO = INACTIVO/.test(L),L);
 t('F4 muestra la FILA FANTASMA: «11/5/2026» = 11/05/2026, NO es 05/11/2026, y qué habría hecho el código anterior',r.fantasmas.length===1&&/FILAS FANTASMA.*: 1/.test(L)&&/texto «11\/5\/2026» = 11\/05\/2026 \(NO es 05\/11\/2026\) \| luis@pibox\.app/.test(L)&&/el código anterior: ALERTA nivel 3/.test(L),L);
 t('F5 el diagnóstico dice en qué FILA están los encabezados, qué columnas usa y lista los retirados con su fila',/Encabezados encontrados en la FILA 3 de BASE 3\.0 \(datos desde la fila 4\)/.test(L)&&/CORREO: G · CARGO: F · NOMBRE: E · DOCUMENTO: D/.test(L)&&/Retirados detectados \(CARGO = INACTIVO o propiedad agentes_retirados\): 1/.test(L)&&/retirada@pibox\.app — BASE 3\.0, fila 6, CARGO = INACTIVO/.test(L),L);}
{const w=mundo({malla:[],base:[VACIA,VACIA,VACIA,VACIA,VAC,ENC,base('ana@pibox.app','ANA','INACTIVO')]});w.run('diagnosticoAsistencia()');
 t('F5b con los encabezados en la fila 6 el diagnóstico lo informa',w.logs.some(l=>/Encabezados encontrados en la FILA 6 de BASE 3\.0 \(datos desde la fila 7\)/.test(l))&&w.logs.some(l=>/ana@pibox\.app — BASE 3\.0, fila 7, CARGO = INACTIVO/.test(l)),w.logs);}
{const w=mundo({malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00'),w0.fila('11/5/2026','luis@pibox.app','9:00:00')],base:hoja([base('ana@pibox.app'),base('luis@pibox.app')])});const r=w.run('diagnosticoAsistencia()');const L=w.logs.join('\n');
 t('F6 indica el texto que buscaba el código anterior',/«11\/5\/2026» \(interpretado día\/mes sería el 11\/05\/2026\)/.test(L),L);}
{const w=mundo({malla:[w0.fila('4/11/2026','ana@pibox.app','9:00:00'),w0.fila('11/4/2026','garcia@pibox.app','9:00:00')]});
 const r=w.run('diagnosticoAsistenciaCaso4Nov()');
 const q=JSON.parse(w.fetches[0].opt.payload).structuredQuery.where;
 t('F7 el caso 4-nov 10:32 evalúa ese día (no hoy), acota la consulta a ese día y reproduce la alerta fantasma de la fila del 11 de abril',r.dia==='2026-11-04'&&r.fantasmas.length===1&&r.fantasmas[0].real==='2026-04-11'&&q.compositeFilter&&q.compositeFilter.filters.length===2&&q.compositeFilter.filters[0].fieldFilter.value.timestampValue==='2026-11-04T05:00:00.000Z'&&q.compositeFilter.filters[1].fieldFilter.value.timestampValue==='2026-11-05T05:00:00.000Z'&&w.logs.some(l=>/garcia@pibox\.app.*ALERTA nivel 3 \(\+60\) \(92 min\)/.test(l)),{r,q,l:w.logs.filter(l=>/garcia/.test(l))});}
{const w=mundo({malla:[w0.fila('5/11/2026','ana@pibox.app','9:00:00')]});w.run('checkAttendance()');
 t('F8 producción sigue consultando con un único filtro (sin cota superior): la consulta de checkAttendance no cambió',!!JSON.parse(w.fetches[0].opt.payload).structuredQuery.where.fieldFilter);}

// ═══ G. Estático: no queda ningún formato mes/día contra la malla ═══
{const fuentes={'PiGOps_Notificaciones_v5.gs':GS0,'PiGOps_Reglamento.gs':GSR,'PiGOps_Auditoria.gs':fs.readFileSync(path.join(root,'PiGOps_Auditoria.gs'),'utf8')};
 const codigo=s=>s.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
 for(const [n,s] of Object.entries(fuentes))
  t('G1 '+n+': ningún formatDate con M/d ni MM/dd',!/formatDate\([^)]*['"](M\/d|MM\/dd)/.test(codigo(s)));
 t('G2 index.html: ningún formato M/d/yyyy ni toLocaleDateString(\'en-US\')',!/M\/d\/yyyy|MM\/dd\/yyyy|toLocaleDateString\(\s*['"]en-US/.test(HTML));
 t('G3 checkAttendance y sendShiftReminders ya no comparan texto de fecha: usan asistenciaFilasDeDia_',/asistenciaFilasDeDia_\(data, todayISO, retirados\.set\)/.test(GS0)&&(GS0.match(/asistenciaFilasDeDia_\(/g)||[]).length>=4);}

out.forEach(l=>console.log(l));
const fail=out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length-fail}/${out.length} OK`);process.exit(fail?1:0);
