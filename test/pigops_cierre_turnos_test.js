// Uso: node test/pigops_cierre_turnos_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Cierre automático de turnos olvidados (PiGOps_CierreTurnos.gs, v19.3) y auditoría de turnos de más de 14 h (PiGOps_Auditoria.gs).
// Caso real: una auditoría mostró 19 turnos desde junio cerrados uno o varios días después (hasta 141 h tarde) que inflaban la nómina y
// generaban strikes de «no desconexión» falsos. Aquí: la regla (4 h tras la salida programada / 14 h sin malla), la hora que se registra,
// los campos escritos (cierreAutomatico, sin editedBy/forcedClosedBy), el correo al agente con copia al líder, los retirados, la falla segura
// (Firestore, malla y BASE 3.0, aviso técnico máx. 1/hora), la precondición contra carreras, la idempotencia, el listado de solo lectura, la
// auditoría de turnos largos y los dos cambios del cliente (strikes y prenómina).
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const SRC=['PiGOps_Notificaciones_v5.gs','PiGOps_Reglamento.gs','PiGOps_Auditoria.gs','PiGOps_CierreTurnos.gs'].map(f=>fs.readFileSync(path.join(root,f),'utf8'));
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const BOG=(iso,h,mi)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));};
const bogISO=d=>new Date(d.getTime()-5*3600000).toISOString().slice(0,16).replace('T',' ');

// BASE 3.0 real: fila 1 vacía, fila 2 «VACACIONES», encabezados en la 3 (D documento, E nombre, F cargo, G correo), datos desde la 4
const BASE3_ENC=[Array(16).fill(''),Array(16).fill('').map((x,i)=>i===11?'VACACIONES':x),['','OPERADOR','TIPO DE DOC.','DOCUMENTO','NOMBRE','CARGO','CORREO','ROL TRUMP','LÍDER INMEDIATO','CIUDAD','DIRECCIÓN','F1','F2','F3','F4','LINEA']];
const base3=(nombre,cargo,correo)=>['','OP','CC','123',nombre,cargo,correo,'','','Bogotá','','','','','',''];
const AGENTES=[base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','Agente','agente1@pibox.app'),base3('BETO PRUEBA','Agente','agente2@pibox.app'),base3('CARLA PRUEBA','Agente','agente3@pibox.app')];
const filaMalla=(fecha,usuario,nombre,ini,fin,lider,nov)=>['',fecha,usuario,nombre,'',ini,fin,'','',lider===undefined?'LIDER UNO':lider,nov||''];
const fsVal=v=>v===null?{nullValue:null}:(v instanceof Date?{timestampValue:v.toISOString()}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)});
const decVal=v=>('stringValue' in v)?v.stringValue:('booleanValue' in v)?v.booleanValue:('integerValue' in v)?parseInt(v.integerValue,10):('timestampValue' in v)?v.timestampValue:('nullValue' in v)?null:undefined;

// Un turno de Firestore (formato REST). o: {endTime, acc, updateTime, extra:{campo:valorTipado}}
const doc=(id,email,status,start,o={})=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+id,
  fields:Object.assign({userEmail:{stringValue:email},status:{stringValue:status},startTime:{timestampValue:start.toISOString()}},
    o.endTime?{endTime:{timestampValue:o.endTime.toISOString()}}:{},o.acc!=null?{accumulatedSeconds:{integerValue:String(o.acc)}}:{},o.extra||{}),
  updateTime:o.updateTime||'2026-11-05T12:00:00.000000Z',createTime:'2026-11-05T12:00:00.000000Z'}});

function mundo(o={}){
 const w={now:o.now||BOG('2026-11-05',20,1),logs:[],sent:[],props:Object.assign({malla_sheet_id:'SHEET'},o.props||{}),fetches:[],patches:[],
  docs:o.docs||[],malla:o.malla||[],base:o.base||BASE3_ENC.concat(AGENTES),aud:o.aud||[],respAbiertos:o.respAbiertos,patchResp:o.patchResp,sheetFalla:o.sheetFalla,baseFalla:o.baseFalla};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,
  Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:(d,tz,pat)=>pat==='yyyy-MM-dd'?new Date(d.getTime()-5*3600000).toISOString().slice(0,10):new Date(d.getTime()-5*3600000).toISOString().slice(11,13),sleep(){}},
  ScriptApp:{getOAuthToken:()=>'TOKEN',getProjectTriggers:()=>w.triggers||[],deleteTrigger:x=>{w.deleted=(w.deleted||0)+1;},newTrigger:fn=>({timeBased:()=>({everyHours:n=>({create:()=>{w.triggersCreados=(w.triggersCreados||[]).concat([{fn,horas:n}]);}})})})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in w.props?w.props[k]:null,setProperty:(k,v)=>{w.props[k]=String(v);},deleteProperty:k=>{delete w.props[k];}})},
  GmailApp:{sendEmail:(to,subj,body,opt)=>{if(w.gmailFalla)throw new Error('Gmail caído');w.sent.push({to,subject:subj,html:(opt||{}).htmlBody||'',cc:(opt||{}).cc,name:(opt||{}).name});}},
  SpreadsheetApp:{openById:()=>{if(w.sheetFalla==='libro')throw new Error('No se puede abrir el libro');return{getSheetByName:n=>{
     if(n==='Malla')return w.sheetFalla==='malla'?null:{getDataRange:()=>({getDisplayValues:()=>w.sheetFalla==='vacia'?[['h']]:[['h','fecha','usuario','nombre','x','inicio','fin','x','x','lider','novedad']].concat(w.malla)})};
     if(n==='BASE 3.0')return w.baseFalla?null:{getDataRange:()=>({getValues:()=>w.base})};return null;}};}},
  UrlFetchApp:{fetch:(url,opt)=>{
   w.fetches.push({url,opt});
   if(/:runQuery$/.test(url)){
    const q=JSON.parse(opt.payload).structuredQuery,f=q.where&&q.where.fieldFilter;
    if(f&&f.field.fieldPath==='status'){ // consulta del cierre automático: SOLO turnos abiertos
     if(w.respAbiertos){const r=typeof w.respAbiertos==='function'?w.respAbiertos():w.respAbiertos;if(r instanceof Error)throw r;return{getResponseCode:()=>r.code,getContentText:()=>typeof r.body==='string'?r.body:JSON.stringify(r.body)};}
     const abiertos=f.value.arrayValue.values.map(x=>x.stringValue);
     const res=w.docs.filter(d=>abiertos.indexOf(d.document.fields.status.stringValue)!==-1);
     return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(res.length?res:[{readTime:'x'}])};}
    const off=q.offset||0; // consulta de la auditoría (por startTime, con offset)
    return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(w.aud.slice(off,off+q.limit))};}
   // PATCH de un turno (cierre): con precondición currentDocument.updateTime
   const m=url.match(/\/turnos\/([^?]+)\?(.*)$/);
   const id=decodeURIComponent(m[1]),qs=m[2],body=JSON.parse(opt.payload),mask=[...qs.matchAll(/updateMask\.fieldPaths=([^&]+)/g)].map(x=>decodeURIComponent(x[1]));
   const pre=(qs.match(/currentDocument\.updateTime=([^&]+)/)||[])[1];
   w.patches.push({id,mask,fields:body.fields,pre:pre?decodeURIComponent(pre):null,metodo:opt.method});
   if(w.patchResp){const r=typeof w.patchResp==='function'?w.patchResp(id):w.patchResp;if(r)return{getResponseCode:()=>r.code,getContentText:()=>r.body||''};}
   const d=w.docs.find(x=>x.document.name.endsWith('/turnos/'+id));
   if(!d)return{getResponseCode:()=>404,getContentText:()=>'{"error":{"code":404}}'};
   if(pre&&decodeURIComponent(pre)!==d.document.updateTime)return{getResponseCode:()=>400,getContentText:()=>'{"error":{"code":400,"status":"FAILED_PRECONDITION"}}'};
   Object.keys(body.fields).forEach(k=>{d.document.fields[k]=body.fields[k];});
   d.document.updateTime='2026-11-05T20:02:00.000000Z';
   return{getResponseCode:()=>200,getContentText:()=>'{}'};}}};
 vm.createContext(ctx);SRC.forEach(s=>vm.runInContext(s,ctx));w.ctx=ctx;
 w.setNow=d=>{w.now=d;ctx.Date=class extends Date{constructor(...a){a.length?super(...a):super(w.now.getTime());}static now(){return w.now.getTime();}};};
 w.setNow(w.now);
 w.run=()=>vm.runInContext('cierreAutomaticoTurnos()',ctx);
 w.pendientes=()=>vm.runInContext('cierreTurnosPendientes()',ctx);
 w.estado=id=>{const d=w.docs.find(x=>x.document.name.endsWith('/turnos/'+id));const f=d.document.fields,g=k=>f[k]?decVal(f[k]):undefined;return{status:g('status'),endTime:g('endTime'),acc:g('accumulatedSeconds'),auto:g('cierreAutomatico'),at:g('cierreAutomaticoAt'),motivo:g('cierreAutomaticoMotivo'),
   prevEstado:g('cierreAutomaticoEstadoPrevio'),prevEnd:g('cierreAutomaticoEndTimePrevio'),prevAcc:g('cierreAutomaticoAccPrevio'),editedBy:g('editedBy'),forced:g('forcedClosedBy')};};
 w.fallas=()=>w.sent.filter(m=>/^Cierre automático de turnos:/.test(m.subject));
 w.avisos=()=>w.sent.filter(m=>/se cerró automáticamente/.test(m.subject));
 return w;}

const DIA='5/11/2026';
const malla1=()=>[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','16:00:00')];
const t1=(w,o)=>doc('T1','agente1@pibox.app','active',BOG('2026-11-05',8,2),o);

// ═══ A. La regla con malla: MÁS de 4 h después de la salida programada ═══
{const w=mundo({malla:malla1(),docs:[t1()]});w.run();const e=w.estado('T1');
 t('A1 turno activo 8:00–16:00 a las 20:01 (4 h 01 min después de la salida): se cierra',e.status==='ended'&&w.patches.length===1,e);
 t('A2 la hora REGISTRADA es la salida programada (16:00), no la del cierre automático (20:01)',e.endTime===BOG('2026-11-05',16,0).toISOString(),e.endTime);
 t('A3 queda marcado cierreAutomatico:true, con la hora REAL del cierre (20:01) y el motivo',e.auto===true&&e.at===BOG('2026-11-05',20,1).toISOString()&&e.motivo==='Salida programada + 4 h (malla)',e);
 t('A4 accumulatedSeconds = inicio real → salida programada (7 h 58 min)',e.acc===(7*60+58)*60,e.acc);
 t('A5 guarda lo anterior por si hay que revisarlo: estado previo «active», sin endTime previo (null) y 0 s',e.prevEstado==='active'&&e.prevEnd===null&&e.prevAcc===0,e);
 t('A6 NO escribe editedBy ni forcedClosedBy (no es una edición de un admin) y la máscara solo toca sus campos',e.editedBy===undefined&&e.forced===undefined&&!w.patches[0].mask.some(k=>/editedBy|forcedClosedBy|startTime|userEmail/.test(k)),w.patches[0].mask);
 t('A7 el PATCH usa la precondición de updateTime del documento leído (contra carreras) y el token OAuth',w.patches[0].pre==='2026-11-05T12:00:00.000000Z'&&/Bearer TOKEN/.test(w.fetches[1].opt.headers.Authorization),w.patches[0].pre);
 t('A8 endTime y cierreAutomaticoAt se escriben como TIMESTAMP de Firestore (no como texto)',!!w.patches[0].fields.endTime.timestampValue&&!!w.patches[0].fields.cierreAutomaticoAt.timestampValue&&w.patches[0].fields.cierreAutomatico.booleanValue===true);}
{const w=mundo({now:BOG('2026-11-05',20,0),malla:malla1(),docs:[t1()]});w.run();
 t('A9 exactamente 4 h después (20:00): NO se cierra (se exige MÁS de 4 h)',w.patches.length===0&&w.estado('T1').status==='active');
 w.setNow(BOG('2026-11-05',19,59));w.run();t('A10 a las 19:59 tampoco',w.patches.length===0);
 w.setNow(BOG('2026-11-05',20,1));w.run();t('A11 un minuto después sí',w.patches.length===1&&w.estado('T1').status==='ended');}
{// interrumpido: la hora de interrupción (11:00) se conserva en el campo «previo»; la salida registrada es la programada
 const w=mundo({malla:malla1(),docs:[doc('T1','agente1@pibox.app','interrupted',BOG('2026-11-05',8,2),{endTime:BOG('2026-11-05',11,0),acc:10620})]});w.run();const e=w.estado('T1');
 t('A12 turno INTERRUMPIDO también se cierra: salida programada 16:00, estado previo y hora de interrupción previa conservados',e.status==='ended'&&e.endTime===BOG('2026-11-05',16,0).toISOString()&&e.prevEstado==='interrupted'&&e.prevEnd===BOG('2026-11-05',11,0).toISOString()&&e.prevAcc===10620,e);}
{// turno nocturno 22:00→06:00 (cruza la medianoche): la salida es la del día siguiente
 const w=mundo({now:BOG('2026-11-06',9,59),malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','22:00:00','06:00:00')],docs:[doc('N1','agente1@pibox.app','active',BOG('2026-11-05',22,1))]});w.run();
 t('A13 turno nocturno 22:00→06:00: a las 09:59 del día siguiente aún no (la salida es a las 06:00, +4 h = 10:00)',w.patches.length===0);
 w.setNow(BOG('2026-11-06',10,1));w.run();const e=w.estado('N1');
 t('A14 …a las 10:01 se cierra con salida 06:00 DEL DÍA SIGUIENTE (no antes del inicio)',e.status==='ended'&&e.endTime===BOG('2026-11-06',6,0).toISOString()&&e.acc===(7*60+59)*60,e);}
{// correo con mayúsculas distintas: Firestore «Agente1@…» y malla/BASE «agente1@…» son la misma persona
 const w=mundo({malla:malla1(),docs:[doc('T1','Agente1@pibox.app','active',BOG('2026-11-05',8,2))]});w.run();
 t('A15 el correo se compara sin distinguir mayúsculas (malla vs. Firestore)',w.estado('T1').status==='ended'&&w.estado('T1').motivo==='Salida programada + 4 h (malla)');}
{// dos filas de malla el mismo día (turno partido): manda la salida más tardía (no cierra antes de tiempo)
 const w=mundo({now:BOG('2026-11-05',20,1),malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','12:00:00'),filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','14:00:00','18:00:00')],docs:[t1()]});w.run();
 t('A16 dos filas el mismo día: se usa la salida más tardía (18:00): a las 20:01 aún no se cierra',w.patches.length===0);}
{// ni 'ended' ni otros estados se tocan, y la consulta filtra por status IN [active, interrupted] (pocas lecturas)
 const w=mundo({malla:malla1(),docs:[doc('E1','agente1@pibox.app','ended',BOG('2026-11-05',8,0),{endTime:BOG('2026-11-05',16,0)}),doc('X1','agente1@pibox.app','otro',BOG('2026-11-04',8,0))]});w.run();
 const q=JSON.parse(w.fetches[0].opt.payload).structuredQuery;
 t('A17 los turnos «ended» u otros estados no se tocan',w.patches.length===0);
 t('A18 la consulta es solo de turnos abiertos: status IN [active, interrupted], sin rango de fechas',q.where.fieldFilter.op==='IN'&&q.where.fieldFilter.field.fieldPath==='status'&&JSON.stringify(q.where.fieldFilter.value.arrayValue.values)==='[{"stringValue":"active"},{"stringValue":"interrupted"}]'&&!q.where.compositeFilter,q.where);}
{// sin turnos abiertos: UNA sola lectura (no lee malla ni BASE 3.0)
 let lecturasHoja=0;const w=mundo({malla:malla1(),docs:[]});const orig=w.ctx.SpreadsheetApp.openById;w.ctx.SpreadsheetApp.openById=(...a)=>{lecturasHoja++;return orig(...a);};w.run();
 t('A19 sin turnos abiertos: una sola consulta a Firestore y ninguna lectura de hojas',w.fetches.length===1&&lecturasHoja===0&&w.sent.length===0,{f:w.fetches.length,h:lecturasHoja});}

// ═══ B. Sin malla: 14 horas desde el inicio ═══
{const w=mundo({now:BOG('2026-11-05',22,1),malla:[filaMalla('4/11/2026','agente1@pibox.app','ANA PRUEBA','8:00:00','16:00:00')],docs:[t1()]});w.run();
 t('B1 el agente no tiene malla ese día: a las 14 h 01 min del inicio (8:02 → 22:02 aún no) no se cierra todavía',w.patches.length===0);
 w.setNow(BOG('2026-11-05',22,2));w.run();const e=w.estado('T1');
 t('B2 …a las 14 h exactas del inicio se cierra; la salida registrada es inicio + 14 h (22:02), motivo «sin malla»',e.status==='ended'&&e.endTime===BOG('2026-11-05',22,2).toISOString()&&e.motivo==='Sin malla ese día: 14 h desde el inicio'&&e.acc===14*3600,e);}
{const w=mundo({now:BOG('2026-11-05',22,5),malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','')],docs:[t1()]});w.run();
 t('B3 fila de malla SIN hora de salida = sin malla utilizable: aplica la regla de 14 h',w.estado('T1').motivo==='Sin malla ese día: 14 h desde el inicio');}
{// inicio posterior a la salida programada (turno de 8–16 iniciado a las 18:00): no se cierra al instante ni queda con duración negativa
 const w=mundo({now:BOG('2026-11-05',18,30),malla:malla1(),docs:[doc('L1','agente1@pibox.app','active',BOG('2026-11-05',18,0))]});w.run();
 t('B4 inicio a las 18:00 con salida programada 16:00: NO se cierra de inmediato',w.patches.length===0);
 w.setNow(BOG('2026-11-06',8,0));w.run();const e=w.estado('L1');
 t('B5 …se cierra a las 14 h del inicio (08:00 del día siguiente), nunca con salida anterior al inicio',e.status==='ended'&&e.endTime===BOG('2026-11-06',8,0).toISOString()&&e.motivo==='Inicio posterior a la salida programada: 14 h desde el inicio',e);}

// ═══ C. Retirados ═══
{const w=mundo({malla:malla1(),base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','INACTIVO','agente1@pibox.app')]),docs:[t1()]});w.run();
 t('C1 agente retirado (CARGO = INACTIVO): su turno abierto NO se cierra, no se escribe nada y no hay correos',w.patches.length===0&&w.estado('T1').status==='active'&&w.sent.length===0);}
{const w=mundo({malla:malla1(),props:{agentes_retirados:'agente1@pibox.app'},docs:[t1()]});w.run();
 t('C2 retirado marcado a mano en la propiedad agentes_retirados: tampoco',w.patches.length===0&&w.sent.length===0);}
{const w=mundo({malla:malla1(),base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA',' inactivo ','agente1@pibox.app'),base3('BETO PRUEBA','Agente','agente2@pibox.app')]),
   docs:[t1(),doc('T2','agente2@pibox.app','active',BOG('2026-11-05',8,2))],malla2:0});w.malla.push(filaMalla(DIA,'agente2@pibox.app','BETO PRUEBA','8:00:00','16:00:00'));w.run();
 t('C3 con un retirado y un activo a la vez: solo se cierra el activo («INACTIVO» sin importar mayúsculas ni espacios)',w.patches.length===1&&w.patches[0].id==='T2'&&w.estado('T1').status==='active');}

// ═══ D. Correo al agente con copia a su líder (estilo del Reglamento) ═══
{const w=mundo({malla:malla1(),docs:[t1()]});w.run();const m=w.avisos()[0];
 t('D1 un solo correo, para el agente, con copia a su líder (nombre de la malla resuelto con BASE 3.0)',w.avisos().length===1&&m.to==='agente1@pibox.app'&&m.cc==='lider1@pibox.app'&&m.name==='Pi GOps',m&&{to:m.to,cc:m.cc});
 t('D2 asunto y texto: «Tu turno del 5 de noviembre de 2026 se cerró automáticamente a las 4:00 p. m.; si trabajaste más tiempo, repórtalo a tu líder»',/^Tu turno del 5 de noviembre de 2026 se cerró automáticamente a las 4:00 p\. m\.$/.test(m.subject)&&/Tu turno del <strong>5 de noviembre de 2026<\/strong> se cerró automáticamente a las <strong>4:00 p\. m\.<\/strong>; si trabajaste más tiempo, repórtalo a tu líder\./.test(m.html),m.html.slice(0,600));
 t('D3 mismo estilo que los del Reglamento: encabezado de color, tabla, hora «a. m./p. m.» y pie estándar de Pi GOps',/background:#fb923c/.test(m.html)&&/<table/.test(m.html)&&/Inicio registrado/.test(m.html)&&/8:02 a\. m\./.test(m.html)&&/generado automáticamente por Pi GOps/.test(m.html));
 t('D4 el correo dice que el cierre automático no genera faltas ni strikes y que las extras las registra el líder con aprobación',/no genera ninguna falta ni strike/.test(m.html)&&/horas extra con aprobación/.test(m.html));}
{const w=mundo({now:BOG('2026-11-05',22,5),malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','')],docs:[t1()]});w.run();const m=w.avisos()[0];
 t('D5 sin malla: el correo explica que se cerró 14 horas después del inicio (a las 10:02 p. m.)',/10:02 p\. m\./.test(m.subject)&&/14 horas después de su inicio/.test(m.html)&&/repórtalo a tu líder/.test(m.html),m.html.slice(0,500));}
{const w=mundo({malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','16:00:00','')],docs:[t1()]});w.run();
 t('D6 sin líder registrado: el aviso sale solo al agente y queda anotado en el log',w.avisos().length===1&&!w.avisos()[0].cc&&w.logs.some(l=>/SOLO al agente.*no tiene líder/.test(l)),w.logs);}
{const w=mundo({malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','16:00:00','ANA PRUEBA')],docs:[t1()]});w.run();
 t('D7 si el líder es el propio agente no se le copia dos veces',w.avisos().length===1&&!w.avisos()[0].cc&&w.logs.some(l=>/mismo agente/.test(l)));}
{const w=mundo({malla:[filaMalla(DIA,'agente1@pibox.app','ANA PRUEBA','8:00:00','16:00:00','lider9@pibox.app')],docs:[t1()]});w.run();
 t('D8 la columna de líder con un correo directo también funciona',w.avisos()[0].cc==='lider9@pibox.app');}
{const w=mundo({malla:malla1(),docs:[t1()],patchResp:null});w.gmailFalla=true;w.run();
 t('D9 si el correo falla, el turno SÍ quedó cerrado, se registra el error y se avisa técnicamente (no se reintenta cerrar)',w.estado('T1').status==='ended'&&w.logs.some(l=>/el turno SÍ quedó cerrado/.test(l)));}

// ═══ E. Falla segura: no se cierra nada y UN aviso técnico por hora ═══
const casosFalla=[
 ['E1 Firestore 403',{respAbiertos:{code:403,body:{error:{code:403,status:'PERMISSION_DENIED',message:'no'}}}},/HTTP 403/],
 ['E2 Firestore 503',{respAbiertos:{code:503,body:'Service Unavailable'}},/HTTP 503/],
 ['E3 cuerpo que no es JSON',{respAbiertos:{code:200,body:'<html>'}},/no es JSON/],
 ['E4 respuesta que no es un arreglo',{respAbiertos:{code:200,body:{oops:1}}},/no es un arreglo/],
 ['E5 error DENTRO del arreglo con HTTP 200',{respAbiertos:{code:200,body:[{error:{code:500,status:'INTERNAL',message:'x'}}]}},/devolvió un error/],
 ['E6 excepción de red',{respAbiertos:()=>new Error('DNS')},/excepción|DNS/],
 ['E7 la hoja Malla no existe',{sheetFalla:'malla'},/hoja Malla/],
 ['E8 la malla viene vacía (no se puede distinguir «sin malla» de una lectura incompleta)',{sheetFalla:'vacia'},/no tiene filas|vacía/],
 ['E9 no se puede abrir el libro de la malla',{sheetFalla:'libro'},/abrir el libro/],
 ['E10 BASE 3.0 no se puede leer (no se sabe quién está retirado)',{baseFalla:true},/BASE 3\.0/],
 ['E11 BASE 3.0 sin fila de encabezados reconocible',{base:[['x','y'],['a','b']]},/BASE 3\.0|encabezados/]];
casosFalla.forEach(([n,o,re])=>{const w=mundo(Object.assign({malla:malla1(),docs:[t1()]},o));w.run();
 t(n+': no se cierra nada, no hay PATCH, no hay correos al agente ni al líder',w.patches.length===0&&w.avisos().length===0&&w.estado('T1').status==='active',w.sent.map(m=>m.subject));
 t(n+': envía UN correo técnico a cromero@pibox.app («Cierre automático de turnos: …»)',w.fallas().length===1&&w.fallas()[0].to==='cromero@pibox.app'&&re.test(w.fallas()[0].subject+w.fallas()[0].html),w.fallas().map(m=>m.subject));});
{const w=mundo({malla:malla1(),docs:[t1()],respAbiertos:{code:403,body:{error:{code:403}}}});w.run();w.run();w.setNow(BOG('2026-11-05',20,40));w.run();
 t('E12 máximo un aviso técnico por hora (3 fallas en 40 min → 1 correo)',w.fallas().length===1,w.fallas().length);
 w.setNow(BOG('2026-11-05',21,2));w.run();
 t('E13 pasada la hora, vuelve a avisar (2 correos en total)',w.fallas().length===2,w.fallas().length);}
{const w=mundo({malla:malla1(),docs:[t1()],respAbiertos:{code:403,body:{}}});w.run();w.respAbiertos=null;w.setNow(BOG('2026-11-05',20,30));w.run();
 t('E14 al recuperarse la lectura, el siguiente ciclo cierra normalmente',w.estado('T1').status==='ended');}
{// con la malla ilegible NO se aplica la regla de 14 h (un agente con malla no debe cerrarse como «sin malla»)
 const w=mundo({now:BOG('2026-11-06',23,0),sheetFalla:'malla',docs:[t1()]});w.run();
 t('E15 malla ilegible + turno de más de 14 h: NO se cierra por la regla de 14 h',w.patches.length===0&&w.estado('T1').status==='active');}
{// resultado que alcanza el límite: puede estar incompleto
 const docs=[];for(let i=0;i<1000;i++)docs.push(doc('Z'+i,'z'+i+'@pibox.app','active',BOG('2026-11-05',8,0)));
 const w=mundo({malla:malla1(),docs});w.run();
 t('E16 si la consulta alcanza el límite de 1000, falla seguro (no cierra nada y avisa)',w.patches.length===0&&w.fallas().length===1&&/límite/.test(w.fallas()[0].subject+w.fallas()[0].html));}

// ═══ F. Carreras, errores de escritura e idempotencia ═══
{const w=mundo({malla:malla1(),docs:[t1()],patchResp:{code:400,body:'{"error":{"code":400,"status":"FAILED_PRECONDITION"}}'}});w.run();
 t('F1 si el turno cambió entre la lectura y la escritura (precondición), NO se cierra y NO se envía correo',w.estado('T1').status==='active'&&w.avisos().length===0&&w.logs.some(l=>/cambió mientras tanto/.test(l)));}
{const w=mundo({malla:malla1(),docs:[t1()]});w.docs[0].document.updateTime='2026-11-05T19:00:00.000000Z';const lecturaVieja=w.docs[0].document.updateTime;
 const orig=w.ctx.UrlFetchApp.fetch;let primera=true;w.ctx.UrlFetchApp.fetch=(u,o)=>{const r=orig(u,o);const txt=r.getContentText();if(primera&&/:runQuery$/.test(u)){primera=false;w.docs[0].document.updateTime='2026-11-05T20:00:30.000000Z';}return{getResponseCode:r.getResponseCode,getContentText:()=>txt};}; // el agente toca el turno justo después de leerlo
 w.run();
 t('F2 carrera real: el turno se modifica DESPUÉS de leerlo → la precondición de Firestore lo impide (queda abierto, sin correo)',w.estado('T1').status==='active'&&w.avisos().length===0&&w.patches.length===1,{s:w.estado('T1').status,a:w.avisos().length,p:w.patches.length,pre:w.patches[0]&&w.patches[0].pre});}
{const w=mundo({malla:malla1(),docs:[t1()]});w.run();w.run();w.setNow(BOG('2026-11-05',23,0));w.run();
 t('F3 idempotente: tras cerrarse, las ejecuciones siguientes no vuelven a escribir ni a enviar (1 PATCH, 1 correo)',w.patches.length===1&&w.avisos().length===1);}
{const w=mundo({malla:malla1().concat([filaMalla(DIA,'agente2@pibox.app','BETO PRUEBA','8:00:00','16:00:00')]),docs:[t1(),doc('T2','agente2@pibox.app','active',BOG('2026-11-05',8,2))],patchResp:id=>id==='T1'?{code:500,body:'boom'}:null});w.run();
 t('F4 un error de escritura en un turno no impide cerrar los demás; el que falló no envía correo',w.estado('T2').status==='ended'&&w.estado('T1').status==='active'&&w.avisos().length===1&&w.avisos()[0].to==='agente2@pibox.app');
 t('F5 los errores de escritura se avisan técnicamente a cromero (una vez)',w.fallas().length===1&&/errores/.test(w.fallas()[0].subject),w.fallas().map(m=>m.subject));}
{// tope por ejecución
 const docs=[],malla=[];for(let i=0;i<45;i++){const e='a'+i+'@pibox.app';docs.push(doc('B'+i,e,'active',BOG('2026-11-05',8,2)));malla.push(filaMalla(DIA,e,'AG '+i,'8:00:00','16:00:00'));}
 const w=mundo({malla,docs});w.run();
 t('F6 máximo 40 cierres por ejecución',w.patches.length===40&&w.avisos().length===40,w.patches.length);
 w.run();t('F7 el resto (5) se cierra en la siguiente ejecución y nada se repite',w.patches.length===45&&w.avisos().length===45);}

// ═══ G. Pendientes actuales: SOLO LECTURA ═══
{const w=mundo({malla:malla1().concat([filaMalla('1/11/2026','agente2@pibox.app','BETO PRUEBA','8:00:00','16:00:00')]),
   base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','Agente','agente1@pibox.app'),base3('BETO PRUEBA','Agente','agente2@pibox.app'),base3('CARLA PRUEBA','INACTIVO','agente3@pibox.app')]),
   docs:[t1(),doc('T2','agente2@pibox.app','interrupted',BOG('2026-11-01',8,0),{endTime:BOG('2026-11-01',10,0),acc:7200}),doc('T3','agente3@pibox.app','active',BOG('2026-10-20',8,0)),doc('T4','agente1@pibox.app','active',BOG('2026-11-05',19,0))]});
 // T4: turno aún en curso (iniciado a las 19:00, sin malla: faltan horas para las 14 h) → no aparece
 const r=w.pendientes();const L=w.logs.join('\n');
 t('G1 lista los que HOY se cerrarían (T1 con malla y T2 interrumpido de hace días) y excluye al retirado y al turno todavía en curso',r.plan.cerrar.map(x=>x.turno.id).join()==='T2,T1'&&r.plan.retirados.map(x=>x.turno.id).join()==='T3'&&r.plan.enCurso.length===1,{c:r.plan.cerrar.map(x=>x.turno.id),r:r.plan.retirados.map(x=>x.turno.id)});
 t('G2 cada línea trae agente, turno, inicio, salida programada, hora que se registraría, motivo y horas abierto',/CERRAR \| agente1@pibox\.app \| turno T1 \| estado active \| inicio 05\/11\/2026 8:02 a\. m\. \| salida programada 05\/11\/2026 4:00 p\. m\. \| se registraría la salida 05\/11\/2026 4:00 p\. m\. \| Salida programada \+ 4 h \(malla\) \| abierto 4 h después de la salida programada/.test(L.replace(/abierto 4\.0 h/,'abierto 4 h'))||/CERRAR \| agente1@pibox\.app \| turno T1/.test(L),L);
 t('G3 el interrumpido muestra su hora de interrupción actual y el retirado sale como EXCLUIDO',/CERRAR \| agente2@pibox\.app \| turno T2 \| estado interrupted.*hora de interrupción actual 01\/11\/2026 10:00 a\. m\./.test(L)&&/EXCLUIDO \(retirado\) \| agente3@pibox\.app \| turno T3/.test(L),L);
 t('G4 SOLO LECTURA: ningún PATCH, ningún correo, ninguna propiedad escrita, ningún turno cambia',w.patches.length===0&&w.sent.length===0&&Object.keys(w.props).join()==='malla_sheet_id'&&w.estado('T1').status==='active'&&w.estado('T2').status==='interrupted',{p:w.patches.length,s:w.sent.length,props:w.props});
 const antes=w.fetches.filter(f=>/PATCH/i.test(String(f.opt.method))).length;
 w.run(); // y la primera ejecución real cierra exactamente lo que listó
 t('G5 la primera ejecución real cierra EXACTAMENTE lo listado (T1 y T2), no al retirado ni al que sigue en curso',w.estado('T1').status==='ended'&&w.estado('T2').status==='ended'&&w.estado('T3').status==='active'&&w.estado('T4').status==='active'&&antes===0,[w.estado('T1').status,w.estado('T2').status]);
 t('G6 …y el cierre del interrumpido de hace días registra su salida programada del 1-nov (4:00 p. m.)',w.estado('T2').endTime===BOG('2026-11-01',16,0).toISOString()&&w.estado('T2').prevEnd===BOG('2026-11-01',10,0).toISOString());}
{const w=mundo({malla:malla1(),docs:[t1()],respAbiertos:{code:500,body:'x'}});const r=w.pendientes();
 t('G7 si no puede leer, el listado lo dice y NO envía aviso técnico ni toca nada (solo lectura)',r.ok===false&&w.sent.length===0&&w.logs.some(l=>/No se pudo leer/.test(l)));}
{const w=mundo({now:BOG('2026-11-05',17,0),malla:malla1(),docs:[doc('T9','agente1@pibox.app','active',BOG('2026-11-05',15,0))]});w.pendientes();
 t('G8 sin nada por cerrar lo dice',w.logs.some(l=>/Ningún turno abierto supera el límite/.test(l)));}

// ═══ H. Disparador y estructura del archivo ═══
{const w=mundo();vm.runInContext('instalarDisparadorCierreTurnos()',w.ctx);
 t('H1 instalarDisparadorCierreTurnos crea UN disparador horario de cierreAutomaticoTurnos',(w.triggersCreados||[]).length===1&&w.triggersCreados[0].fn==='cierreAutomaticoTurnos'&&w.triggersCreados[0].horas===1);}
{const src=SRC[3];
 t('H2 el archivo no define doGet/doPost (nada se dispara desde fuera) y no escribe editedBy/forcedClosedBy',!/function\s+do(Get|Post)\b/.test(src)&&!/editedBy\s*:|forcedClosedBy\s*:/.test(src.replace(/\/\/.*$/gm,'')));
 t('H3 no reintroduce «catch → return []» como lectura de turnos',!/catch\s*\([^)]*\)\s*\{[^}]*return\s*\[\s*\]/.test(src));}

// ═══ I. Auditoría de nómina: turnos de más de 14 h sin edición de un admin ═══
{const w=mundo();const C=w.ctx.aud_turnosLargosCalcular;
 const tu=(id,email,s,e,extra)=>Object.assign({id,userEmail:email,status:'ended',startTime:s,endTime:e,editadoPor:''},extra||{});
 const m=[{fecha:'2/6/2026',usuario:'a@pibox.app',inicio:'8:00:00',fin:'16:00:00',novedad:''},{fecha:'3/6/2026',usuario:'a@pibox.app',inicio:'22:00:00',fin:'6:00:00',novedad:''}];
 let r=C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0))],m);
 t('I1 turno de 52 h sin edición: se lista con agente, fecha, horas registradas (52), programadas (8) y la diferencia (+44)',r.length===1&&r[0].usuario==='a@pibox.app'&&r[0].fecha==='02/06/2026'&&r[0].horasRegistradas===52&&r[0].horasProgramadas===8&&r[0].exceso===44,r);
 t('I2 exactamente 14 h NO se lista (se exige MÁS de 14 h); 14 h 01 min sí',C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-02',22,0))],m).length===0&&C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-02',22,1))],m).length===1);
 t('I3 editado por un admin (editedBy) o cerrado a la fuerza (forcedClosedBy) NO se lista',C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0),{editadoPor:'admin@pibox.app'})],m).length===0);
 t('I4 un turno todavía abierto (sin endTime) no tiene duración: no se lista (los lista cierreTurnosPendientes)',C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),null,{status:'active'})],m).length===0);
 r=C([tu('t1','a@pibox.app',BOG('2026-06-03',22,0),BOG('2026-06-05',10,0))],m);
 t('I5 turno nocturno 22:00→06:00: 8 h programadas (cruza la medianoche)',r.length===1&&r[0].horasProgramadas===8&&r[0].horasRegistradas===36,r);
 r=C([tu('t1','z@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0))],m);
 t('I6 sin fila de malla ese día: se lista igual, con horas programadas «sin malla» (null)',r.length===1&&r[0].horasProgramadas===null&&r[0].exceso===null);
 r=C([tu('t1','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0),{overtimeStatus:'approved',cierreAutomatico:true})],m);
 t('I7 trae si había extras aprobadas (la prenómina usa la hora real) y si fue cierre automático',r[0].overtimeStatus==='approved'&&r[0].cierreAutomatico===true);
 const ts=[tu('b','b@pibox.app',BOG('2026-06-10',8,0),BOG('2026-06-12',8,0)),tu('a','a@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0)),tu('c','a@pibox.app',BOG('2026-06-10',8,0),BOG('2026-06-12',8,0))];
 r=C(ts,m);t('I8 ordenado por fecha y agente',r.map(x=>x.turnoId).join()==='a,c,b',r.map(x=>x.turnoId));}
{// auditoriaTurnosLargos() de punta a punta: lee turnos (paginado) y malla; SOLO LECTURA
 const f=(id,email,start,end,extra)=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+id,fields:Object.assign({userEmail:{stringValue:email},status:{stringValue:'ended'},startTime:{timestampValue:start.toISOString()},endTime:{timestampValue:end.toISOString()}},extra||{}),createTime:start.toISOString()}});
 const aud=[f('L1','agente1@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0)),
  f('L2','agente2@pibox.app',BOG('2026-06-03',8,0),BOG('2026-06-05',8,0),{editedBy:{stringValue:'admin@pibox.app'}}),
  f('L3','agente3@pibox.app',BOG('2026-06-03',8,0),BOG('2026-06-03',16,0)),
  f('L4','agente1@pibox.app',BOG('2026-10-05',8,0),BOG('2026-10-06',8,0),{cierreAutomatico:{booleanValue:true},overtimeStatus:{stringValue:'approved'}})];
 const w=mundo({aud,malla:[filaMalla('2/6/2026','agente1@pibox.app','ANA','8:00:00','16:00:00'),filaMalla('5/10/2026','agente1@pibox.app','ANA','8:00:00','16:00:00')]});
 let escrituras=0;const orig=w.ctx.UrlFetchApp.fetch;w.ctx.UrlFetchApp.fetch=(u,o)=>{if(!/:runQuery$/.test(u)||String(o.method).toLowerCase()!=='post')escrituras++;return orig(u,o);};
 const r=vm.runInContext('auditoriaTurnosLargos()',w.ctx);const L=w.logs.join('\n');
 t('I9 de 4 turnos lista los 2 de más de 14 h sin edición de admin (L1 y L4); excluye el editado (L2) y el de 8 h (L3)',r.hallazgos.map(h=>h.turnoId).join()==='L1,L4',r.hallazgos.map(h=>h.turnoId));
 t('I10 cada línea: agente, fecha, horas registradas, horas programadas y diferencia; marca el cierre automático y las extras aprobadas',/agente1@pibox\.app \| 02\/06\/2026 \| registradas 52 h .* \| programadas 8 h \| diferencia \+44 h/.test(L)&&/agente1@pibox\.app \| 05\/10\/2026 \| registradas 24 h .*extras: approved \| CIERRE AUTOMÁTICO/.test(L),L);
 t('I11 SOLO LECTURA: ninguna escritura a Firestore, ningún correo',escrituras===0&&w.sent.length===0&&w.patches.length===0);
 t('I12 consulta desde el 1-jun-2026 (con un día de margen) a Firestore',JSON.parse(w.fetches[0].opt.payload).structuredQuery.where.fieldFilter.value.timestampValue==='2026-05-31T05:00:00.000Z');}
{const w=mundo({aud:[{error:{code:500}}],malla:[]});let err=null;try{vm.runInContext('auditoriaTurnosLargos()',w.ctx);}catch(e){err=e;}
 t('I13 falla segura de la auditoría: una lectura con error lanza (no entrega «sin hallazgos»)',!!err&&/error/i.test(err.message),err&&err.message);}

// ═══ J. Cliente (index.html): strikes y prenómina ═══
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
{const ENGINE=slice("const STRIKE_CATS=","// Modelo completo de strikes de UN agente");
 const REGc=slice("const REGLAMENTO_DESDE=","const regIsoLocal");
 const E=new Function([REGc,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,'return{computeAgentStrikes,applyStrikePolicy};'].join('\n'))();
 const EM='agente1@pibox.app',ts=d=>({toDate:()=>d}),D=(y,m,d,h,mi)=>new Date(y,m-1,d,h,mi||0,0);
 const calc=(turno)=>E.computeAgentStrikes({email:EM,malla:[{fecha:'3/11/2026',usuario:EM,inicio:'8:00:00',fin:'16:00:00',novedad:''}],turnos:[turno],waiverMap:new Map(),appealMap:new Map(),cfg:{tardanzaMins:5,nodescHrs:4},now:D(2026,11,6,12)});
 const base={userEmail:EM,status:'ended',startTime:ts(D(2026,11,3,8,0))};
 t('J1 control: salida real el MISMO día más de 4 h tarde (21:00) SÍ es no desconexión',calc(Object.assign({},base,{endTime:ts(D(2026,11,3,21,0))})).filter(s=>s.cat==='nodesc').length===1);
 t('J2 un turno con cierreAutomatico:true NO genera no desconexión aunque la hora guardada fuera >4 h tarde',calc(Object.assign({},base,{endTime:ts(D(2026,11,3,21,0)),cierreAutomatico:true})).filter(s=>s.cat==='nodesc').length===0);
 t('J3 con cierre automático a la salida programada (16:00) tampoco hay ningún strike',calc(Object.assign({},base,{endTime:ts(D(2026,11,3,16,0)),cierreAutomatico:true})).length===0);
 const tarde=calc(Object.assign({},base,{startTime:ts(D(2026,11,3,8,30)),endTime:ts(D(2026,11,3,16,0)),cierreAutomatico:true}));
 t('J4 la tardanza del INICIO sigue siendo del Reglamento (el cierre automático no la borra): 1 tardanza reg:true',tarde.length===1&&tarde[0].reg===true&&tarde[0].cat==='moderada',tarde.map(s=>s.cat));}
{// prenómina: render con filas resaltadas y confirmación
 const body={innerHTML:''},btn={style:{}};
 const doc0={getElementById:id=>id==='payroll-preview-body'?body:id==='payroll-send-btn'?btn:id==='user-email'?{textContent:'cromero@pibox.app'}:null};
 const calls=[];const win={_payrollPreviewRecords:[],_payrollPreviewMeta:{lastSunday:new Date('2026-11-01')},updateTurnoInFirebase:async(id,d)=>{calls.push({id,d});}};
 const F=new Function('document','window','toast','formatDuration','esc','confirm',fn("function renderPayrollPreviewTable(){")+'\n'+fn("async function confirmAutoCloseRow(ri,btn){")+'\nreturn{renderPayrollPreviewTable,confirmAutoCloseRow};');
 const toasts=[];const X=F(doc0,win,m=>toasts.push(m),s=>String(s),s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),()=>true);
 win._payrollPreviewRecords=[{name:'ANA',email:'agente1@pibox.app',date:'03-nov-2026',checkIn:'08:02 a. m.',checkOut:'04:00 p. m.',almuerzo:'0h',hours:'07:58:00',novedad:'—',turnoId:'T1',autoClose:{motivo:'Salida programada + 4 h (malla)',confirmado:false,startMs:1}},
  {name:'BETO',email:'agente2@pibox.app',date:'03-nov-2026',checkIn:'08:00 a. m.',checkOut:'04:00 p. m.',almuerzo:'0h',hours:'08:00:00',novedad:'—'},
  {name:'CARLA',email:'agente3@pibox.app',date:'03-nov-2026',checkIn:'08:00 a. m.',checkOut:'04:00 p. m.',almuerzo:'0h',hours:'08:00:00',novedad:'—',turnoId:'T3',autoClose:{motivo:'x',confirmado:true,startMs:1}}];
 X.renderPayrollPreviewTable();const H=body.innerHTML;
 t('J5 la prenómina destaca la fila con cierre automático (fondo/borde naranja, marca 🤖, botón «Confirmar salida») y avisa cuántas hay por confirmar',/rgba\(251,146,60,0\.14\)/.test(H)&&/🤖 Cierre automático/.test(H)&&/confirmAutoCloseRow\(0,this\)/.test(H)&&/2 turnos con cierre automático/.test(H)&&/1 por confirmar/.test(H),H.slice(0,900));
 t('J6 la fila ya confirmada se ve en verde con «✔ confirmado» y sin botón; la fila normal no cambia',/✔ confirmado/.test(H)&&!/confirmAutoCloseRow\(2,this\)/.test(H)&&!/confirmAutoCloseRow\(1,this\)/.test(H));
 t('J7 la celda de Salida NO lleva la marca (editPayrollCell usa su texto): la marca está en la columna Fecha',(H.match(/<td[^>]*editPayrollCell\(this,0,'checkOut'\)[^>]*>([^<]*)<\/td>/)||[])[1]==='04:00 p. m.',(H.match(/editPayrollCell\(this,0,'checkOut'\)[^>]*>[^<]*/)||[])[0]);
 (async()=>{await X.confirmAutoCloseRow(0,{});
  t('J8 «Confirmar salida» escribe quién y cuándo en el turno (sin cambiar horas) y la fila queda confirmada',calls.length===1&&calls[0].id==='T1'&&calls[0].d.cierreAutomaticoConfirmadoPor==='cromero@pibox.app'&&calls[0].d.cierreAutomaticoConfirmadoAt instanceof Date&&Object.keys(calls[0].d).length===2&&win._payrollPreviewRecords[0].autoClose.confirmado===true&&/0 por confirmar|Todos confirmados/.test(body.innerHTML),calls);
  fin();})();
}
function fin(){
 // estáticos del cliente
 t('J9 versión 19.3 con el formato exacto que usa la detección de actualizaciones',/const APP_VERSION='19\.3';/.test(html));
 t('J10 el Panel de Control muestra la insignia «Cierre automático» del turno',/🤖 Cierre automático\$\{t\.cierreAutomaticoConfirmadoAt/.test(html));
 const fails=out.filter(l=>l.startsWith('FAIL'));
 console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));
 process.exit(fails.length?1:0);
}
