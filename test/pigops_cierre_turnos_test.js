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
   mask.forEach(k=>{if(!(k in body.fields))delete d.document.fields[k];});
   Object.keys(body.fields).forEach(k=>{d.document.fields[k]=body.fields[k];});
   d.document.updateTime='2026-11-05T20:02:00.000000Z';
   return{getResponseCode:()=>200,getContentText:()=>'{}'};}}};
 vm.createContext(ctx);SRC.forEach(s=>vm.runInContext(s,ctx));w.ctx=ctx;
 w.setNow=d=>{w.now=d;ctx.Date=class extends Date{constructor(...a){a.length?super(...a):super(w.now.getTime());}static now(){return w.now.getTime();}};};
 w.setNow(w.now);
 w.run=()=>vm.runInContext('cierreAutomaticoTurnos()',ctx);
 w.pendientes=()=>vm.runInContext('cierreTurnosPendientes()',ctx);
 w.estado=id=>{const d=w.docs.find(x=>x.document.name.endsWith('/turnos/'+id));const f=d.document.fields,g=k=>f[k]?decVal(f[k]):undefined;return{status:g('status'),endTime:g('endTime'),acc:g('accumulatedSeconds'),auto:g('cierreAutomatico'),at:g('cierreAutomaticoAt'),motivo:g('cierreAutomaticoMotivo'),
   archMotivo:g('archivoMotivo'),archPrevio:g('archivoEstadoPrevio'),archLote:g('archivoLote'),archAt:g('archivadoAt'),archPor:g('archivadoPor'),prevEstado:g('cierreAutomaticoEstadoPrevio'),prevEnd:g('cierreAutomaticoEndTimePrevio'),prevAcc:g('cierreAutomaticoAccPrevio'),editedBy:g('editedBy'),forced:g('forcedClosedBy')};};
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
 t('A12 turno INTERRUMPIDO antes de su salida: la salida registrada es la hora de INTERRUPCIÓN (11:00), no la programada (16:00); se conserva el acumulado real (10620 s) y el estado previo',e.status==='ended'&&e.endTime===BOG('2026-11-05',11,0).toISOString()&&e.acc===10620&&e.prevEstado==='interrupted'&&e.prevEnd===BOG('2026-11-05',11,0).toISOString()&&e.prevAcc===10620&&e.motivo==='Hora de interrupción (anterior a la salida programada)',e);}
{// interrumpido DESPUÉS de la salida programada (17:30 > 16:00): rige la salida programada
 const w=mundo({malla:malla1(),docs:[doc('T1','agente1@pibox.app','interrupted',BOG('2026-11-05',8,2),{endTime:BOG('2026-11-05',17,30),acc:30000})]});w.run();const e=w.estado('T1');
 t('A12b interrumpido DESPUÉS de la salida programada (17:30 > 16:00): se registra la programada (16:00), como antes',e.endTime===BOG('2026-11-05',16,0).toISOString()&&e.motivo==='Salida programada + 4 h (malla)'&&e.prevEnd===BOG('2026-11-05',17,30).toISOString(),e);}
{// interrumpido con la hora anterior al inicio (dato inconsistente): se ignora y rige la programada
 const w=mundo({malla:malla1(),docs:[doc('T1','agente1@pibox.app','interrupted',BOG('2026-11-05',8,2),{endTime:BOG('2026-11-05',7,0),acc:0})]});w.run();
 t('A12c hora de interrupción anterior al inicio (dato inconsistente): se ignora, rige la programada',w.estado('T1').endTime===BOG('2026-11-05',16,0).toISOString());}
{// el correo de un interrumpido dice la hora de interrupción
 const w=mundo({malla:malla1(),docs:[doc('T1','agente1@pibox.app','interrupted',BOG('2026-11-05',8,2),{endTime:BOG('2026-11-05',11,0),acc:10620})]});w.run();const m=w.avisos()[0];
 t('A12d el correo de un interrumpido dice la hora de interrupción (11:00 a. m.) y no la programada',/a las 11:00 a\. m\.$/.test(m.subject)&&/la hora en que se interrumpió tu turno/.test(m.html)&&!/4:00 p\. m\./.test(m.html));}
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

// ═══ C. Retirados: archivo SILENCIOSO (no se cierra, no hay correo, no se toca endTime) ═══
const CIE_MOTIVO_RET='Agente retirado (CARGO = INACTIVO): turno abierto vencido (archivo silencioso)';
const archivado=(w,id)=>{const e=w.estado(id);return e.status==='archivado'&&e.auto===undefined&&e.endTime===undefined;};
{const w=mundo({malla:malla1(),base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','INACTIVO','agente1@pibox.app')]),docs:[t1()]});w.run();
 t('C1 agente retirado (CARGO = INACTIVO): su turno abierto VENCIDO se ARCHIVA en silencio (status «archivado», sin endTime, sin cierre) y NO hay correos',archivado(w,'T1')&&w.sent.length===0&&w.patches.length===1,w.estado('T1'));
 const f=w.patches[0].fields;
 t('C1b el archivo guarda motivo, estado previo («active»), fecha, lote y quién lo hizo; NO escribe endTime ni accumulatedSeconds ni cierreAutomatico',f.archivoMotivo.stringValue===CIE_MOTIVO_RET&&f.archivoEstadoPrevio.stringValue==='active'&&!!f.archivadoAt.timestampValue&&/^retirado-20261105-/.test(f.archivoLote.stringValue)&&!('endTime' in f)&&!('accumulatedSeconds' in f)&&!('cierreAutomatico' in f),Object.keys(f));}
{const w=mundo({now:BOG('2026-11-05',17,0),malla:malla1(),base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','INACTIVO','agente1@pibox.app')]),docs:[t1()]});w.run();
 t('C1c un turno de retirado que AÚN no venció (17:00, +4 h = 20:00) no se toca',w.patches.length===0&&w.estado('T1').status==='active');}
{const w=mundo({malla:malla1(),props:{agentes_retirados:'agente1@pibox.app'},docs:[t1()]});w.run();
 t('C2 retirado marcado a mano en la propiedad agentes_retirados: también se archiva en silencio',archivado(w,'T1')&&w.sent.length===0);}
{const w=mundo({malla:malla1(),base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA',' inactivo ','agente1@pibox.app'),base3('BETO PRUEBA','Agente','agente2@pibox.app')]),
   docs:[t1(),doc('T2','agente2@pibox.app','active',BOG('2026-11-05',8,2))]});w.malla.push(filaMalla(DIA,'agente2@pibox.app','BETO PRUEBA','8:00:00','16:00:00'));w.run();
 t('C3 con un retirado y un activo a la vez: el activo se cierra (con correo) y el retirado se archiva (sin correo); «INACTIVO» sin importar mayúsculas ni espacios',w.estado('T2').status==='ended'&&archivado(w,'T1')&&w.avisos().length===1&&w.avisos()[0].to==='agente2@pibox.app');}

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
{const w=mundo({malla:malla1().concat([filaMalla('1/11/2026','agente2@pibox.app','BETO PRUEBA','8:00:00','16:00:00'),filaMalla('2/11/2026','agente3@pibox.app','CARLA PRUEBA','8:00:00','16:00:00')]),
   base:BASE3_ENC.concat([base3('LIDER UNO','Líder','lider1@pibox.app'),base3('ANA PRUEBA','Agente','agente1@pibox.app'),base3('BETO PRUEBA','Agente','agente2@pibox.app'),base3('CARLA PRUEBA','INACTIVO','agente3@pibox.app')]),
   docs:[t1(),doc('T2','agente2@pibox.app','interrupted',BOG('2026-11-01',8,0),{endTime:BOG('2026-11-01',10,0),acc:7200}),doc('T3','agente3@pibox.app','active',BOG('2026-11-02',8,0)),doc('T4','agente1@pibox.app','active',BOG('2026-11-05',19,0)),
     doc('H1','agente1@pibox.app','active',BOG('2026-10-20',8,0)),doc('H2','agente1@pibox.app','interrupted',BOG('2026-04-10',8,0),{endTime:BOG('2026-04-10',9,0)})]});
 const r=w.pendientes();const L=w.logs.join('\n');
 t('G1 lista los que HOY se cerrarían (T1 y T2, desde el 1-nov), el retirado va a «archivar» y el turno todavía en curso no aparece',r.plan.cerrar.map(x=>x.turno.id).join()==='T2,T1'&&r.plan.archivar.map(x=>x.turno.id).join()==='T3'&&r.plan.enCurso.length===1,{c:r.plan.cerrar.map(x=>x.turno.id),a:r.plan.archivar.map(x=>x.turno.id)});
 t('G1b los turnos ANTERIORES al 1-nov (H1 de octubre, H2 de abril) NO entran: se cuentan aparte y no aparecen en CERRAR',r.plan.historicos.map(x=>x.turno.id).join()==='H2,H1'&&!/CERRAR \| .* \| turno H[12]/.test(L)&&/anteriores al corte, ignorados: 2/.test(L),L);
 t('G2 cada línea CERRAR trae agente, turno, inicio, salida programada, hora que se registraría y motivo',/CERRAR \| agente1@pibox\.app \| turno T1 \| estado active \| inicio 05\/11\/2026 8:02 a\. m\. \| salida programada 05\/11\/2026 4:00 p\. m\. \| se registraría la salida 05\/11\/2026 4:00 p\. m\. \| Salida programada \+ 4 h \(malla\)/.test(L),L);
 t('G3 el interrumpido muestra su hora de interrupción y que se registraría ESA hora (10:00 a. m.); el retirado sale como ARCHIVAR en silencio',/CERRAR \| agente2@pibox\.app \| turno T2 \| estado interrupted.*se registraría la salida 01\/11\/2026 10:00 a\. m\. \| Hora de interrupción.*hora de interrupción actual 01\/11\/2026 10:00 a\. m\./.test(L)&&/ARCHIVAR \(retirado, en silencio\) \| agente3@pibox\.app \| turno T3/.test(L),L);
 t('G4 SOLO LECTURA: ningún PATCH, ningún correo, ninguna propiedad escrita, ningún turno cambia',w.patches.length===0&&w.sent.length===0&&Object.keys(w.props).join()==='malla_sheet_id'&&['T1','T2','T3','H1','H2'].every(i=>w.estado(i).status!=='ended'&&w.estado(i).status!=='archivado'),{p:w.patches.length,s:w.sent.length});
 w.run(); // la primera ejecución real hace EXACTAMENTE lo listado
 t('G5 la primera ejecución real cierra T1 y T2, archiva a T3 y NO toca los históricos (H1, H2), que siguen abiertos',w.estado('T1').status==='ended'&&w.estado('T2').status==='ended'&&archivado(w,'T3')&&w.estado('T4').status==='active'&&w.estado('H1').status==='active'&&w.estado('H2').status==='interrupted'&&w.patches.length===3,w.patches.map(x=>x.id));
 t('G6 …el interrumpido del 1-nov queda con salida = su hora de interrupción (10:00) y los correos solo van a quienes se les cerró el turno (T1, T2)',w.estado('T2').endTime===BOG('2026-11-01',10,0).toISOString()&&w.avisos().map(m=>m.to).sort().join()==='agente1@pibox.app,agente2@pibox.app',w.avisos().map(m=>m.to));}
{const w=mundo({malla:malla1(),docs:[t1()],respAbiertos:{code:500,body:'x'}});const r=w.pendientes();
 t('G7 si no puede leer, el listado lo dice y NO envía aviso técnico ni toca nada (solo lectura)',r.ok===false&&w.sent.length===0&&w.logs.some(l=>/No se pudo leer/.test(l)));}
{const w=mundo({now:BOG('2026-11-05',17,0),malla:malla1(),docs:[doc('T9','agente1@pibox.app','active',BOG('2026-11-05',15,0))]});w.pendientes();
 t('G8 sin nada por cerrar lo dice',w.logs.some(l=>/Ningún turno abierto desde el corte supera el límite/.test(l)));}

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


// ═══ K. v19.4 — Corte por fecha, clasificación de históricos, archivo silencioso y su reversión ═══
{// corte: 1-nov 00:00 de Bogotá entra; 31-oct 23:59 no
 const docs=[doc('C1','agente1@pibox.app','active',BOG('2026-10-31',23,59)),doc('C2','agente2@pibox.app','active',BOG('2026-11-01',0,0)),doc('C3','agente3@pibox.app','active',BOG('2026-11-02',8,2))];
 const w=mundo({now:BOG('2026-11-06',12,0),malla:[filaMalla('1/11/2026','agente2@pibox.app','BETO','0:00:00','6:00:00'),filaMalla('2/11/2026','agente3@pibox.app','CARLA','8:00:00','16:00:00'),filaMalla('31/10/2026','agente1@pibox.app','ANA','8:00:00','16:00:00')],docs});w.run();
 t('K1 el corte es el 1-nov 00:00 de Bogotá: un turno del 31-oct 23:59 NO se cierra; el del 1-nov 00:00 y el del 2-nov SÍ',w.estado('C1').status==='active'&&w.estado('C2').status==='ended'&&w.estado('C3').status==='ended'&&w.patches.length===2,w.patches.map(x=>x.id));
 t('K2 el turno del 31-oct no recibe correo ni marca de cierre automático; los de noviembre sí (2 correos)',w.avisos().map(m=>m.to).sort().join()==='agente2@pibox.app,agente3@pibox.app'&&w.estado('C1').auto===undefined);}
{// un agente con ~20 turnos abiertos desde abril: NADA se escribe ni se envía, y ni siquiera se lee la malla
 const docs=[];for(let i=0;i<20;i++)docs.push(doc('H'+i,'agente1@pibox.app',i%2?'active':'interrupted',BOG('2026-04-'+String(10+i).padStart(2,'0'),8,0),i%2?{}:{endTime:BOG('2026-04-'+String(10+i).padStart(2,'0'),9,0)}));
 let hojas=0;const w=mundo({malla:malla1(),docs});const o=w.ctx.SpreadsheetApp.openById;w.ctx.SpreadsheetApp.openById=(...a)=>{hojas++;return o(...a);};w.run();
 t('K3 20 turnos huérfanos de abril en adelante: el cierre automático no escribe, no envía correos y no lee malla ni BASE 3.0 (1 sola lectura a Firestore)',w.patches.length===0&&w.sent.length===0&&hojas===0&&w.fetches.length===1&&w.logs.some(l=>/anteriores al 2026-11-01.*20/.test(l)),w.logs);}

// Mundo de clasificación: duplicado, único, sin malla, interrumpido antes de su salida, uno del 2 de noviembre y agentes con dos turnos el mismo día
function mundoHist(extra){
 const E=(id,email,s,e)=>doc(id,email,'ended',s,{endTime:e});
 const docs=[
  doc('DUP','agente1@pibox.app','active',BOG('2026-10-10',8,5)),E('DUPE','agente1@pibox.app',BOG('2026-10-10',8,0),BOG('2026-10-10',16,0)),   // DUPLICADO: otro turno cerrado el mismo día
  doc('UNI','agente2@pibox.app','active',BOG('2026-10-12',8,0)),                                                                          // ÚNICO (malla 8–16 → 8,0 h)
  doc('SIN','agente3@pibox.app','active',BOG('2026-10-13',8,0)),                                                                          // SIN MALLA
  doc('INT','agente2@pibox.app','interrupted',BOG('2026-10-14',8,0),{endTime:BOG('2026-10-14',10,0),acc:7200}),                          // interrumpido a las 10:00, antes de su salida (16:00)
  doc('V1','agente3@pibox.app','active',BOG('2026-10-15',8,0)),doc('V2','agente3@pibox.app','interrupted',BOG('2026-10-15',9,0),{endTime:BOG('2026-10-15',9,30)}), // dos turnos abiertos el mismo día, ninguno cerrado
  doc('NOC','agente1@pibox.app','active',BOG('2026-10-21',3,0)),E('NOCE','agente1@pibox.app',BOG('2026-10-20',22,0),BOG('2026-10-21',6,0)), // DUPLICADO por solape: un turno nocturno cerrado cuyo intervalo contiene el inicio
  doc('NOV2','agente1@pibox.app','active',BOG('2026-11-02',8,2)),                                                                          // del 2 de noviembre: NO es histórico
  E('OTRO','agente2@pibox.app',BOG('2026-10-20',8,0),BOG('2026-10-20',16,0))];                                                            // turno cerrado de otro agente/día: no duplica nada
 const malla=[filaMalla('10/10/2026','agente1@pibox.app','ANA','8:00:00','16:00:00'),filaMalla('12/10/2026','agente2@pibox.app','BETO','8:00:00','16:00:00'),filaMalla('14/10/2026','agente2@pibox.app','BETO','8:00:00','16:00:00'),
  filaMalla('15/10/2026','agente3@pibox.app','CARLA','8:00:00','16:00:00'),filaMalla('21/10/2026','agente1@pibox.app','ANA','8:00:00','16:00:00'),filaMalla('2/11/2026','agente1@pibox.app','ANA','8:00:00','16:00:00')];
 return mundo(Object.assign({now:BOG('2026-11-06',12,0),docs,aud:docs,malla},extra||{}));}
{const w=mundoHist();const r=vm.runInContext('auditoriaHistoricosAbiertos()',w.ctx);const L=w.logs.join('\n');const cat=id=>(r.hallazgos.find(h=>h.id===id)||{}).categoria;
 t('K4 clasifica los históricos: DUP=DUPLICADO, UNI=ÚNICO, SIN=SIN_MALLA, INT=ÚNICO (interrumpido), V1 y V2=VARIOS_ABIERTOS, NOC=DUPLICADO por solape nocturno',cat('DUP')==='DUPLICADO'&&cat('UNI')==='UNICO'&&cat('SIN')==='SIN_MALLA'&&cat('INT')==='UNICO'&&cat('V1')==='VARIOS_ABIERTOS'&&cat('V2')==='VARIOS_ABIERTOS'&&cat('NOC')==='DUPLICADO',r.hallazgos.map(h=>h.id+':'+h.categoria));
 t('K5 el turno del 2 de noviembre NO se clasifica (es del cierre automático) y el cerrado de otro día no genera duplicados',cat('NOV2')===undefined&&r.hallazgos.length===7&&!r.hallazgos.some(h=>h.id==='OTRO'),r.hallazgos.map(h=>h.id));
 const hr=id=>r.hallazgos.find(h=>h.id===id);
 t('K6 horas si se cerrara con la salida programada: ÚNICO 8,0 h (8:00→16:00); el interrumpido también 8,0 h (programada) y muestra su hora de interrupción; sin malla = «sin horario» (null)',hr('UNI').horas===8&&hr('INT').horas===8&&!!hr('INT').interrupcion&&hr('INT').interrupcion.getTime()===BOG('2026-10-14',10,0).getTime()&&hr('SIN').horas===null,[hr('UNI').horas,hr('INT').horas,hr('SIN').horas]);
 t('K7 cada línea muestra agente, fecha, estado, hora de interrupción y horas; el duplicado dice con qué turno cerrado se solapa',/ÚNICO|UNICO \| agente2@pibox\.app \| 14\/10\/2026 \| estado interrupted \| inicio 14\/10\/2026 8:00 a\. m\. \| interrumpido 14\/10\/2026 10:00 a\. m\. \| horas si se cerrara con la salida programada: 8 h \(salida 4:00 p\. m\.\)/.test(L)&&/DUPLICADO \| agente1@pibox\.app \| 10\/10\/2026 .* otro turno cerrado DUPE/.test(L)&&/SIN_MALLA \| agente3@pibox\.app \| 13\/10\/2026 .* sin horario/.test(L),L);
 t('K8 resumen POR AGENTE (agente1: 2 duplicados; agente2: 2 únicos, 16 h; agente3: 1 sin malla + 2 varios) y POR MES (octubre: 7)',r.porAgente['agente1@pibox.app'].DUPLICADO===2&&r.porAgente['agente2@pibox.app'].UNICO===2&&r.porAgente['agente2@pibox.app'].horas===16&&r.porAgente['agente3@pibox.app'].SIN_MALLA===1&&r.porAgente['agente3@pibox.app'].VARIOS_ABIERTOS===2&&r.porMes['2026-10'].total===7&&/RESUMEN POR AGENTE/.test(L)&&/RESUMEN POR MES/.test(L)&&/2026-10 → 7/.test(L),r.porMes);
 t('K9 SOLO LECTURA: ningún PATCH, ningún correo, ninguna propiedad escrita',w.patches.length===0&&w.sent.length===0&&Object.keys(w.props).join()==='malla_sheet_id');}
{const w=mundoHist({respAbiertos:{code:503,body:'x'}});let err=null;try{vm.runInContext('auditoriaHistoricosAbiertos()',w.ctx);}catch(e){err=e;}
 t('K10 falla segura de la clasificación: una lectura fallida lanza (no entrega una lista vacía)',!!err&&/HTTP 503/.test(err.message),err&&err.message);}
{const w=mundoHist({aud:[{error:{code:500}}]});let err=null;try{vm.runInContext('auditoriaHistoricosAbiertos()',w.ctx);}catch(e){err=e;}
 t('K11 con un error al leer los turnos cerrados tampoco entrega resultados parciales',!!err&&/error/i.test(err.message),err&&err.message);}

// Archivo silencioso
{const w=mundoHist();const abiertosAntes=w.docs.filter(d=>/active|interrupted/.test(d.document.fields.status.stringValue)).length;
 const prev=vm.runInContext('archivarTurnosHistoricosVistaPrevia()',w.ctx);
 t('K12 la vista previa del archivo es de solo lectura y lista los 7 históricos abiertos (no el del 2-nov)',prev.length===7&&w.patches.length===0&&w.sent.length===0&&Object.keys(w.props).join()==='malla_sheet_id'&&w.logs.some(l=>/VISTA PREVIA DEL ARCHIVO.*7 turnos/.test(l)));
 const antesEnd={INT:w.estado('INT').endTime,INTacc:w.estado('INT').acc};
 const r=vm.runInContext('archivarTurnosHistoricosAprobado()',w.ctx);
 t('K13 archivar: los 7 históricos pasan a status «archivado»; el del 2-nov y los cerrados no se tocan',r.archivados.length===7&&['DUP','UNI','SIN','INT','V1','V2','NOC'].every(i=>w.estado(i).status==='archivado')&&w.estado('NOV2').status==='active'&&w.estado('DUPE').status==='ended'&&w.estado('OTRO').status==='ended',r);
 const f=w.patches[0].fields,m=w.patches[0].mask;
 t('K14 SIN endTime nuevo, SIN tocar accumulatedSeconds, SIN correos, SIN marca de cierre automático (el interrumpido conserva su hora y su acumulado)',w.sent.length===0&&!m.includes('endTime')&&!m.includes('accumulatedSeconds')&&!m.includes('cierreAutomatico')&&w.estado('INT').endTime===antesEnd.INT&&w.estado('INT').acc===antesEnd.INTacc&&w.estado('INT').auto===undefined,m);
 const e=w.estado('INT');
 t('K15 deja motivo, estado previo, fecha, lote y autor para poder revertir',e.archMotivo==='Histórico anterior al 1-nov-2026: turno abierto que nunca se cerró (archivo silencioso)'&&e.archPrevio==='interrupted'&&!!e.archAt&&/^historico-20261106-/.test(e.archLote)&&e.archPor==='PiGOps_CierreTurnos.gs'&&w.estado('UNI').archPrevio==='active',e);
 t('K16 cada PATCH usa la precondición de updateTime (si el turno cambió mientras tanto, no se archiva)',w.patches.every(x=>!!x.pre));
 // los módulos ignoran lo archivado
 w.patches.length=0;w.sent.length=0;w.setNow(BOG('2026-11-06',13,0));const n0=w.logs.length;w.pendientes();const L=w.logs.slice(n0).join('\n');
 t('K17 cierreTurnosPendientes() ignora los archivados: ya no hay históricos (solo el turno del 2-nov) y no los lista',!/H?\| turno (DUP|UNI|SIN|INT|V1|V2|NOC)\b/.test(L)&&w.logs.some(l=>/anteriores al corte, ignorados: 0/.test(l)),L);
 w.run();
 t('K18 el cierre automático tampoco los toca (solo cierra el del 2-nov)',w.patches.length===1&&w.patches[0].id==='NOV2'&&['DUP','UNI','SIN','INT','V1','V2','NOC'].every(i=>w.estado(i).status==='archivado'));
 // reversible
 const antes=JSON.stringify(w.docs.filter(d=>w.estado(d.document.name.split('/').pop()).status==='archivado').map(d=>d.document.name));
 const rv=vm.runInContext('revertirArchivoTurnos()',w.ctx);
 t('K19 REVERSIBLE: revertirArchivoTurnos() restaura el status previo (active/interrupted) de los 7 y borra los campos de archivo',rv.revertidos.length===7&&w.estado('UNI').status==='active'&&w.estado('INT').status==='interrupted'&&w.estado('V2').status==='interrupted'&&w.estado('UNI').archMotivo===undefined&&w.estado('UNI').archLote===undefined&&w.estado('INT').archPrevio===undefined,rv);
 t('K20 …y el turno interrumpido vuelve EXACTAMENTE como estaba (misma hora de interrupción y acumulado)',w.estado('INT').endTime===antesEnd.INT&&w.estado('INT').acc===antesEnd.INTacc);
 t('K21 tras revertir vuelven a aparecer como históricos abiertos (idempotente: archivar otra vez funciona)',vm.runInContext('archivarTurnosHistoricosAprobado()',w.ctx).archivados.length===7);
 w.props.archivo_revertir_lote='otro-lote';const rv2=vm.runInContext('revertirArchivoTurnos()',w.ctx);delete w.props.archivo_revertir_lote;
 t('K22 con la propiedad archivo_revertir_lote solo se revierte ese lote (uno distinto no toca nada)',rv2.revertidos.length===0&&w.estado('UNI').status==='archivado');}
{// reversión: un turno archivado sin estado previo conocido no se adivina
 const w=mundo({docs:[doc('X','agente1@pibox.app','archivado',BOG('2026-10-10',8,0))]});const rv=vm.runInContext('revertirArchivoTurnos()',w.ctx);
 t('K23 un archivado sin estado previo conocido NO se revierte a ciegas (queda como error en el resultado)',rv.revertidos.length===0&&rv.errores.length===1&&w.estado('X').status==='archivado');}

// Los demás módulos ignoran los turnos archivados
{const arch=doc('AR','agente1@pibox.app','archivado',BOG('2026-11-05',8,0),{endTime:BOG('2026-11-05',9,0)});
 const w=mundo({now:BOG('2026-11-05',12,0),aud:[arch]});const r=vm.runInContext('leerTurnosHoyRest_(new Date())',w.ctx);
 t('K24 alertas de ausencia: un turno archivado NO cuenta como «conectado» (leerTurnosHoyRest_ solo acepta active/ended/interrupted)',r.ok===true&&r.emails.length===0,r);}
{const arch=doc('AR','agente1@pibox.app','archivado',BOG('2026-11-05',8,0)),ok=doc('OK','agente2@pibox.app','ended',BOG('2026-11-05',8,0),{endTime:BOG('2026-11-05',16,0)});
 const w=mundo({aud:[arch,ok]});const r=vm.runInContext('reg_leerTurnos("2026-11-05",new Date('+JSON.stringify(BOG('2026-11-06',0,0).toISOString())+'))',w.ctx);
 t('K25 Reglamento: reg_leerTurnos descarta los archivados (no cuentan para tardanzas ni faltas)',r.length===1&&r[0].userEmail==='agente2@pibox.app',r);
 const asis=vm.runInContext('(function(){return reg_detectarTardanzas([{fecha:"5/11/2026",usuario:"agente1@pibox.app",inicio:"6:00:00",fin:"14:00:00",novedad:""}],reg_leerTurnos("2026-11-05",new Date('+JSON.stringify(BOG('2026-11-06',0,0).toISOString())+')));})()',w.ctx);
 t('K26 Reglamento: con solo un turno archivado ese día no hay tardanza',asis.length===0,asis);}
{const f=(id,email,s,e,st)=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+id,fields:{userEmail:{stringValue:email},status:{stringValue:st},startTime:{timestampValue:s.toISOString()},endTime:{timestampValue:e.toISOString()}},createTime:s.toISOString()}});
 const w=mundo({aud:[f('A1','agente1@pibox.app',BOG('2026-06-02',8,0),BOG('2026-06-04',12,0),'archivado'),f('A2','agente1@pibox.app',BOG('2026-06-10',8,0),BOG('2026-06-12',12,0),'ended')],malla:[]});
 const r=vm.runInContext('auditoriaTurnosLargos()',w.ctx);
 t('K27 la auditoría de turnos largos ignora los archivados (solo el cerrado A2)',r.hallazgos.map(h=>h.turnoId).join()==='A2',r.hallazgos.map(h=>h.turnoId));}

const cola=[]; // pruebas asíncronas del cliente: se ejecutan en orden al final
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
 cola.push(async()=>{await X.confirmAutoCloseRow(0,{});
  t('J8 «Confirmar salida» escribe quién y cuándo en el turno (sin cambiar horas) y la fila queda confirmada',calls.length===1&&calls[0].id==='T1'&&calls[0].d.cierreAutomaticoConfirmadoPor==='cromero@pibox.app'&&calls[0].d.cierreAutomaticoConfirmadoAt instanceof Date&&Object.keys(calls[0].d).length===2&&win._payrollPreviewRecords[0].autoClose.confirmado===true&&/0 por confirmar|Todos confirmados/.test(body.innerHTML),calls);
  });
}
// ═══ L. Cliente v19.4: lectores, strikes, prenómina ═══
{const mod=slice("const turnosVisibles = ","window.updateOvertimeEvent");
 const win={};const ts=d=>({toDate:()=>d});
 const mk=(id,status,d,extra)=>Object.assign({id,userEmail:'agente1@pibox.app',userId:'u1',status,startTime:ts(d)},extra||{});
 const hoy=new Date();hoy.setHours(9,0,0,0);
 const docs=[mk('A','archivado',new Date(hoy.getTime()+1000)),mk('B','ended',hoy),mk('C','active',new Date(hoy.getTime()-1000))];
 const getDocs=async()=>({docs:docs.map(d=>({id:d.id,data:()=>{const{id,...r}=d;return r;}}))});
 const idem=x=>x;const F=new Function('auth','db','getDocs','query','collection','where','orderBy','limit','window','firestoreOpWithRetry','setDoc','doc','setTimeout',mod+'\nreturn window;');
 const W=F({currentUser:{uid:'u1'}},{},getDocs,idem,idem,idem,idem,idem,win,async f=>f(),()=>{},()=>{},setTimeout);
 cola.push(async()=>{
  const hoyT=await W.getTodayTurno(),u=await W.getUserTurnos('agente1@pibox.app'),r1=await W.getRecentTurnos(),r2=await W.getRecentTurnos(new Date(0),true,new Date(2e12));
  t('L1 los lectores de turnos del cliente (Mi turno, historial/strikes, Panel/prenómina por defecto y por rango) NO entregan turnos archivados',hoyT.id==='B'&&u.map(x=>x.id).join()==='B,C'&&r1.map(x=>x.id).join()==='B,C'&&r2.map(x=>x.id).join()==='B,C',[hoyT&&hoyT.id,u.map(x=>x.id),r1.map(x=>x.id),r2.map(x=>x.id)]);
 });
 const lectores=[...html.matchAll(/getDocs\(query\(collection\(db, 'turnos'\)[^\n]*\n[^\n]*\n?[^\n]*/g)];
 t('L2 guardia estática: toda lectura de la colección «turnos» pasa por turnosVisibles (4 lectores; si agregas uno nuevo, filtra los archivados)',lectores.length===4&&lectores.every(m=>/turnosVisibles/.test(html.slice(html.indexOf(m[0]),html.indexOf(m[0])+700))),lectores.length);}
{const ENGINE=slice("const STRIKE_CATS=","// Modelo completo de strikes de UN agente");const REGc=slice("const REGLAMENTO_DESDE=","const regIsoLocal");
 const E=new Function([REGc,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,'return{computeAgentStrikes};'].join('\n'))();
 const EM='agente1@pibox.app',ts=d=>({toDate:()=>d}),D=(y,m,d,h,mi)=>new Date(y,m-1,d,h,mi||0,0);
 const calc=turnos=>E.computeAgentStrikes({email:EM,malla:[{fecha:'3/9/2026',usuario:EM,inicio:'8:00:00',fin:'16:00:00',novedad:''}],turnos,waiverMap:new Map(),appealMap:new Map(),cfg:{tardanzaMins:5,nodescHrs:4},now:D(2026,9,10,12)});
 const arch={userEmail:EM,status:'archivado',startTime:ts(D(2026,9,3,9,30)),endTime:ts(D(2026,9,3,23,0))};
 t('L3 strikes: un turno archivado (tardío y con salida >4 h) no genera tardanza ni no desconexión',calc([arch]).length===0);
 const buena={userEmail:EM,status:'ended',startTime:ts(D(2026,9,3,8,0)),endTime:ts(D(2026,9,3,16,0))};
 t('L4 strikes: con un turno normal y uno archivado el mismo día manda el normal (sin strikes)',calc([arch,buena]).length===0);}
{// prenómina REAL (loadFreshPayrollData) con datos simulados
 const code=[fn('function parseDate(s){'),fn('function parseTime(dateStr,timeStr){'),fn('function strikeWaiverId(email,fecha,cat){'),html.split('\n').find(l=>l.startsWith('function parseCSVLine(')),fn('function pickTurnoDelDia(allTurnos,email,d){'),fn('async function loadFreshPayrollData(cyc){')].join('\n');
 const ts=d=>({toDate:()=>d});
 async function run(rows,turnos,opts={}){
  const monday=opts.monday,win={_payrollPreviewMeta:{lastMonday:monday,lastSunday:new Date(monday.getTime()+6*86400000+86399000)},ADMINS:[],getRecentTurnos:async()=>turnos,getApprovedOvertimeEvents:async()=>opts.eventos||[],getStrikeWaivers:async()=>[],_payrollDirty:false};
  const F=new Function('window','document','console','fetchMallaCSV','panelMalla','ADMINS','SUPER_ADMIN','TOLERANCE_MINS','esNovedadVotaciones','formatDuration','renderPayrollPreviewTable',code+'\nreturn loadFreshPayrollData;');
  const csv='h\n'+rows.map(r=>['',r.fecha,r.usuario,r.nombre||'X','',r.inicio,r.fin,'','',r.lider||'L',r.novedad||'','',r.almuerzo||''].join(',')).join('\n');
  await F(win,{querySelector:()=>null},{log(){},error(){}},async()=>csv,async()=>csv,[],'root@pibox.app',5,()=>false,s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00';},()=>{})();
  return win._payrollPreviewRecords;}
 const U='agente1@pibox.app';
 cola.push(async()=>{
  // Caso real del 05/08/2026: 9 h programadas, 33,4 h registradas, extras RECHAZADAS
  const a0=new Date(2026,7,5,8,0),a1=new Date(a0.getTime()+33.4*3600000);
  const base={id:'T',userEmail:U,status:'ended',startTime:ts(a0),endTime:ts(a1)};
  let r=await run([{fecha:'5/8/2026',usuario:U,inicio:'8:00:00',fin:'17:00:00'}],[Object.assign({overtimeStatus:'rejected'},base)],{monday:new Date(2026,7,3)});
  t('M1 05/08/2026 (33,4 h registradas, 9 programadas, extras RECHAZADAS): la prenómina paga las PROGRAMADAS (09:00:00, 8:00→5:00 p. m.)',r.length===1&&r[0].hours==='09:00:00'&&/05:00 p\. m\./.test(r[0].checkOut),r);
  r=await run([{fecha:'5/8/2026',usuario:U,inicio:'8:00:00',fin:'17:00:00',almuerzo:'1'}],[Object.assign({overtimeStatus:'rejected'},base)],{monday:new Date(2026,7,3)});
  t('M2 …y con 1 h de almuerzo, 08:00:00 (el almuerzo se descuenta de lo programado, no de lo registrado)',r[0].hours==='08:00:00',r);
  r=await run([{fecha:'5/8/2026',usuario:U,inicio:'8:00:00',fin:'17:00:00'}],[Object.assign({overtimeStatus:'approved'},base)],{monday:new Date(2026,7,3)});
  t('M3 solo con extras APROBADAS la prenómina usa la salida real (control: 33,4 h → 33:24:00)',r[0].hours==='33:24:00',r[0].hours);
  r=await run([{fecha:'5/8/2026',usuario:U,inicio:'8:00:00',fin:'17:00:00'}],[base],{monday:new Date(2026,7,3),eventos:[{agentEmail:U,mallaEntry:{fecha:'5/8/2026'}}]});
  t('M3b …o con un evento de extras aprobado para ese agente y fecha (control)',r[0].hours==='33:24:00',r[0].hours);
  // Caso 03/11/2026: dos turnos el mismo día (10:16 y 18:07→10:19 del día siguiente); malla supuesta 10:00–18:00
  const A={id:'A',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,10,16)),endTime:ts(new Date(2026,10,3,18,0))};
  const B={id:'B',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,18,7)),endTime:ts(new Date(2026,10,4,10,19))};
  const m3=[{fecha:'3/11/2026',usuario:U,inicio:'10:00:00',fin:'18:00:00'}];
  for(const [n,orden] of [['B primero (como llega de Firestore, del más reciente al más antiguo)',[B,A]],['A primero',[A,B]]]){
   r=await run(m3,orden,{monday:new Date(2026,10,2)});
   t('M4 03/11/2026 con dos turnos ('+n+'): el día se paga desde el primer inicio real (10:16 a. m.) hasta la salida programada: 07:44:00 (antes: 23:53:00)',r.length===1&&/10:16 a\. m\./.test(r[0].checkIn)&&r[0].hours==='07:44:00',r);}
  const huerfano={id:'O',userEmail:U,status:'active',startTime:ts(new Date(2026,10,3,10,1)),endTime:null};
  const bueno={id:'G',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,10,16)),endTime:ts(new Date(2026,10,3,18,0))};
  r=await run(m3,[huerfano,bueno],{monday:new Date(2026,10,2)});
  t('M5 un turno huérfano ACTIVO + uno cerrado el mismo día: manda el cerrado (10:16 a. m.), no el huérfano',/10:16 a\. m\./.test(r[0].checkIn)&&r[0].hours==='07:44:00',r[0]);
  r=await run(m3,[{id:'AR',userEmail:U,status:'archivado',startTime:ts(new Date(2026,10,3,10,40)),endTime:null}],{monday:new Date(2026,10,2)});
  t('M6 un turno ARCHIVADO se ignora: el día se paga por la malla completa (10:00 a. m.→6:00 p. m., 08:00:00), como si no hubiera turno',/10:00 a\. m\./.test(r[0].checkIn)&&r[0].hours==='08:00:00',r[0]);
  r=await run(m3,[huerfano,{id:'AR',userEmail:U,status:'archivado',startTime:ts(new Date(2026,10,3,10,5)),endTime:null},bueno],{monday:new Date(2026,10,2)});
  t('M7 archivado + huérfano + cerrado el mismo día: manda el cerrado',/10:16 a\. m\./.test(r[0].checkIn)&&r[0].hours==='07:44:00');
  r=await run([{fecha:'3/11/2026',usuario:U,inicio:'8:00:00',fin:'16:00:00'}],[{id:'L',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,17,0)),endTime:ts(new Date(2026,10,3,18,0))}],{monday:new Date(2026,10,2)});
  t('M8 un turno iniciado DESPUÉS de la salida programada (17:00 vs 16:00): 0 h dentro del horario (antes: 23:00:00)',r[0].hours==='00:00:00',r[0].hours);
  r=await run([{fecha:'3/11/2026',usuario:U,inicio:'22:00:00',fin:'6:00:00'}],[],{monday:new Date(2026,10,2)});
  t('M9 turno NOCTURNO 22:00→06:00 sin registro: sigue pagando 8 h (el +24 h aplica porque el horario cruza la medianoche)',r[0].hours==='08:00:00',r[0].hours);
  r=await run([{fecha:'3/11/2026',usuario:U,inicio:'22:00:00',fin:'6:00:00'}],[{id:'N',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,22,30)),endTime:ts(new Date(2026,10,4,6,0))}],{monday:new Date(2026,10,2)});
  t('M10 nocturno con llegada tardía (22:30): 7 h 30 min (22:30→06:00)',r[0].hours==='07:30:00',r[0].hours);
  r=await run(m3,[{id:'CA',userEmail:U,status:'ended',startTime:ts(new Date(2026,10,3,10,2)),endTime:ts(new Date(2026,10,3,18,0)),cierreAutomatico:true,cierreAutomaticoMotivo:'Salida programada + 4 h (malla)'}],{monday:new Date(2026,10,2)});
  t('M11 el turno con cierre automático sigue marcándose en la prenómina (v19.3) y paga lo programado',r[0].autoClose&&r[0].turnoId==='CA'&&r[0].hours==='08:00:00',r[0]);
 });
}

function fin(){
 // estáticos del cliente
 t('J9 versión 19.4 con el formato exacto que usa la detección de actualizaciones',/const APP_VERSION='19\.4';/.test(html));
 t('J10 el Panel de Control muestra la insignia «Cierre automático» del turno',/🤖 Cierre automático\$\{t\.cierreAutomaticoConfirmadoAt/.test(html));
 const fails=out.filter(l=>l.startsWith('FAIL'));
 console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));
 process.exit(fails.length?1:0);
}
(async()=>{for(const f of cola)await f();fin();})();
