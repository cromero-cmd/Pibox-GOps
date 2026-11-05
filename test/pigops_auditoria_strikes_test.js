// Uso: node test/pigops_auditoria_strikes_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Impacto del modelo antiguo de strikes (PiGOps_Auditoria.gs, SOLO LECTURA, 5-nov-2026):
//  · auditoriaLlamadosViejos(): lista los correos «Acción requerida — Llamado de atención #N» / «Proceso disciplinario requerido» enviados
//    desde el 1-nov-2026 (agente, fecha, número, destinatarios) leyendo ENVIADOS con GmailApp.search.
//  · auditoriaNoDesconexion(): días con cierre más de 4 h después de la salida programada, MISMO_DIA vs CIERRE_DIA_POSTERIOR.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const SRC=['PiGOps_Notificaciones_v5.gs','PiGOps_Reglamento.gs','PiGOps_Auditoria.gs'].map(f=>fs.readFileSync(path.join(root,f),'utf8'));
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const BOG=(iso,h,mi)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));};

function mundo(o={}){
 const w={logs:[],fetches:[],writes:0,threads:o.threads||[],malla:o.malla||[],turnosDocs:o.turnosDocs||[],searches:[]};
 const fmtBog=d=>new Date(d.getTime()-5*3600000).toISOString().replace('T',' ').slice(0,19);
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,FIREBASE_PROJECT:'proj',
  Logger:{log:m=>w.logs.push(String(m))},Utilities:{formatDate:(d,tz,pat)=>fmtBog(d),sleep(){}},
  ScriptApp:{getOAuthToken:()=>'T'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='malla_sheet_id'?'SHEET':null,setProperty:()=>{w.writes++;},deleteProperty:()=>{w.writes++;}})},
  GmailApp:{sendEmail:()=>{w.writes++;},search:(q,start,max)=>{w.searches.push(q);return w.threads.slice(start,start+max);}},
  SpreadsheetApp:{create:()=>{w.writes++;},openById:()=>({getSheetByName:n=>n==='Malla'?{getDataRange:()=>({getDisplayValues:()=>[['h']].concat(w.malla)})}:null})},
  UrlFetchApp:{fetch:(url,opt)=>{w.fetches.push({url,opt});if(!/:runQuery$/.test(url)||String(opt.method).toLowerCase()!=='post')w.writes++;
   const q=JSON.parse(opt.payload).structuredQuery,off=q.offset||0;
   return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(w.turnosDocs.slice(off,off+q.limit))};}}};
 vm.createContext(ctx);SRC.forEach(s=>vm.runInContext(s,ctx));w.ctx=ctx;return w;}

// ═══ A. Correos del modelo antiguo ═══
const cuerpoLlamado=(n,agente,mail,periodo,strikes)=>'<div><h2>⚡ Acción requerida — Llamado de atención #'+n+'</h2><p>Estimado(a) coordinador(a),</p><p>El sistema Pi GOps ha detectado que el colaborador <strong>'+agente+'</strong> ('+mail+') ha acumulado suficientes strikes en el período <strong>'+periodo+'</strong> ('+strikes+' strikes en total en ese período) para generar el <strong>llamado de atención #'+n+'</strong>.</p></div>';
const cuerpoDisc=(agente,mail)=>'<div><p>El colaborador <strong>'+agente+'</strong> ('+mail+') ha acumulado <strong>3 llamados de atención</strong> en el período <strong>1/9/2026 al 2/11/2026</strong>, por lo que corresponde iniciar un proceso disciplinario formal.</p></div>';
const msg=(fecha,asunto,cuerpo,para,cc)=>({getDate:()=>fecha,getSubject:()=>asunto,getBody:()=>cuerpo,getTo:()=>para,getCc:()=>cc||''});
const hilo=(...ms)=>({getMessages:()=>ms});
{const w=mundo();const P=w.ctx.aud_parsearCorreoViejo;
 const a=P('⚡ Acción requerida — Llamado de atención #2 para AGENTE UNO',cuerpoLlamado(2,'AGENTE UNO','agente.uno@example.com','13/06/2026 al 02/11/2026',8));
 t('A1 parsea el llamado #2: número, agente, correo, período y strikes',a&&a.numero===2&&a.agente==='AGENTE UNO'&&a.agenteEmail==='agente.uno@example.com'&&a.periodo==='13/06/2026 al 02/11/2026'&&a.strikes===8,a);
 const d=P('⚖️ Proceso disciplinario requerido — AGENTE DOS',cuerpoDisc('AGENTE DOS','agente.dos@example.com'));
 t('A2 parsea el aviso de proceso disciplinario',d&&d.tipo.indexOf('Proceso disciplinario')===0&&d.agente==='AGENTE DOS'&&d.agenteEmail==='agente.dos@example.com',d);
 t('A3 los llamados del Reglamento («Llamado de atención — NOMBRE — fecha») NO se confunden con los del modelo antiguo',P('Llamado de atención — AGENTE UNO — 05/11/2026','<p>x</p>')===null&&P('Falta grave — Notificación para descargos — AGENTE UNO','<p>x</p>')===null);}
{const hilos=[
  hilo(msg(BOG('2026-10-30',9,0),'⚡ Acción requerida — Llamado de atención #1 para AGENTE ANTERIOR',cuerpoLlamado(1,'AGENTE ANTERIOR','anterior@example.com','octubre de 2026',3),'lider.a@pibox.app','cromero@pibox.app')),
  hilo(msg(BOG('2026-11-02',10,5),'⚡ Acción requerida — Llamado de atención #1 para AGENTE TRES',cuerpoLlamado(1,'AGENTE TRES','agente.tres@example.com','noviembre de 2026',3),'lider.b@pibox.app','cromero@pibox.app')),
  hilo(msg(BOG('2026-11-05',10,32),'⚡ Acción requerida — Llamado de atención #2 para AGENTE UNO',cuerpoLlamado(2,'AGENTE UNO','agente.uno@example.com','13/06/2026 al 02/11/2026',8),'lider.a@pibox.app','cromero@pibox.app'),
       msg(BOG('2026-11-05',10,33),'⚖️ Proceso disciplinario requerido — AGENTE UNO',cuerpoDisc('AGENTE UNO','agente.uno@example.com'),'lider.a@pibox.app','cromero@pibox.app')),
  hilo(msg(BOG('2026-11-05',11,0),'Llamado de atención — AGENTE CUATRO — 05/11/2026','<p>del Reglamento</p>','agente.cuatro@example.com','lider.c@pibox.app'))];
 const w=mundo({threads:hilos});const r=w.ctx.auditoriaLlamadosViejos();const L=w.logs.join('\n');
 t('B1 solo lista los correos del modelo antiguo desde el 1-nov (3): el del 30-oct y el del Reglamento quedan fuera',r.length===3,r.map(e=>e.asunto));
 t('B2 cada línea trae fecha, número de llamado, agente y destinatarios',/2026-11-02 10:05:00 \| Llamado de atención #1 \| agente: AGENTE TRES <agente\.tres@example\.com> .* para: lider\.b@pibox\.app \| cc: cromero@pibox\.app/.test(L)&&/2026-11-05 10:32:00 \| Llamado de atención #2 \| agente: AGENTE UNO .* \(8 strikes\) \| para: lider\.a@pibox\.app/.test(L),L);
 t('B3 incluye el aviso de proceso disciplinario y el período de casi 5 meses del caso reportado',/Proceso disciplinario \(3 llamados\) \| agente: AGENTE UNO/.test(L)&&/período: 13\/06\/2026 al 02\/11\/2026 \(8 strikes\)/.test(L),L);
 t('B4 resume a QUIÉN avisar: cada destinatario con los agentes de sus correos',/lider\.a@pibox\.app → AGENTE UNO/.test(L)&&/lider\.b@pibox\.app → AGENTE TRES/.test(L)&&!/lider\.c@pibox\.app/.test(L)&&/cromero@pibox\.app → AGENTE TRES, AGENTE UNO|cromero@pibox\.app → AGENTE UNO, AGENTE TRES/.test(L),L);
 t('B5 solo lectura: ningún correo enviado, ninguna escritura (propiedades, Sheets, Firestore)',w.writes===0&&w.fetches.length===0,w.writes);
 t('B6 la búsqueda es en ENVIADOS y por los dos asuntos antiguos',w.searches.length===1&&/^in:sent after:2026\/10\/31 .*Acción requerida.*Proceso disciplinario requerido/.test(w.searches[0]),w.searches);}
{const w=mundo({threads:[]});const r=w.ctx.auditoriaLlamadosViejos();
 t('B7 sin correos: lo dice y devuelve lista vacía',r.length===0&&w.logs.some(l=>/Ningún correo del modelo antiguo/.test(l)));}

// ═══ C. No desconexión: clasificación ═══
const fila=(fecha,usuario,ini,fin,novedad)=>({fecha,usuario,inicio:ini,fin,novedad:novedad||'',nombre:'X',lider:''});
const turno=(id,email,s,e,status='ended',extra={})=>Object.assign({id,userEmail:email,status,startTime:s,endTime:e,editadoPor:''},extra);
{const w=mundo();const calc=(m,ts)=>w.ctx.aud_nodescCalcular(m,ts);
 const m=[fila('3/11/2026','a@pibox.app','7:00:00','15:30:00')];
 let r=calc(m,[turno('t1','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-04',9,30))]);
 t('C1 turno 7:00–15:30 cerrado a las 09:30 del DÍA SIGUIENTE: CIERRE_DIA_POSTERIOR (18 h)',r.length===1&&r[0].categoria==='CIERRE_DIA_POSTERIOR'&&r[0].horasExtra===18,r);
 r=calc(m,[turno('t2','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-03',21,30))]);
 t('C2 cerrado el mismo día a las 21:30: MISMO_DIA (6 h)',r.length===1&&r[0].categoria==='MISMO_DIA'&&r[0].horasExtra===6,r);
 r=calc(m,[turno('t3','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-03',9,30))]);
 t('C3 salida real 09:30 a. m. ANTES de las 15:30 (mismo día): no aparece',r.length===0);
 r=calc(m,[turno('t4','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-03',19,30))]);
 t('C4 exactamente 4 h: no aparece (se exige más)',r.length===0);
 r=calc(m,[turno('t5','a@pibox.app',BOG('2026-11-03',7,0),null,'active')]);
 t('C5 turno sin cierre: no aparece',r.length===0);
 r=calc([fila('3/11/2026','a@pibox.app','7:00:00','15:30:00','VOTACIONES')],[turno('t6','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-04',9,30))]);
 t('C6 día con novedad en la malla: no aparece',r.length===0);
 r=calc([fila('3/11/2026','n@pibox.app','22:00:00','06:00:00')],[turno('t7','n@pibox.app',BOG('2026-11-03',22,0),BOG('2026-11-04',11,0))]);
 t('C7 turno nocturno 22:00→06:00 con salida 11:00 del día de su fin: MISMO_DIA (5 h)',r.length===1&&r[0].categoria==='MISMO_DIA'&&r[0].horasExtra===5,r);
 r=calc([fila('3/11/2026','n@pibox.app','22:00:00','06:00:00')],[turno('t8','n@pibox.app',BOG('2026-11-03',22,0),BOG('2026-11-05',9,30))]);
 t('C8 el mismo turno nocturno cerrado dos días después: CIERRE_DIA_POSTERIOR',r.length===1&&r[0].categoria==='CIERRE_DIA_POSTERIOR',r);
 // cuatro días seguidos con el mismo patrón (caso reportado: «salida 15:30:00, salida real 09:30 a. m.» en cuatro fechas)
 const dias=['3/11/2026','4/11/2026','5/11/2026','6/11/2026'];
 r=calc(dias.map(f=>fila(f,'a@pibox.app','7:00:00','15:30:00')),dias.map((f,i)=>turno('d'+i,'a@pibox.app',BOG('2026-11-0'+(3+i),7,0),BOG('2026-11-0'+(4+i),9,30))));
 t('C9 cuatro días con el mismo patrón (cierre a las 09:30 del día siguiente): las 4 salen como CIERRE_DIA_POSTERIOR',r.length===4&&r.every(x=>x.categoria==='CIERRE_DIA_POSTERIOR'));}

// ═══ D. auditoriaNoDesconexion() de punta a punta (Firestore y malla simulados) ═══
{const docT=(id,email,s,e,extra={})=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+id,fields:Object.assign({userEmail:{stringValue:email},status:{stringValue:'ended'},
   startTime:{timestampValue:s.toISOString()},endTime:{timestampValue:e.toISOString()}},extra),createTime:s.toISOString(),updateTime:s.toISOString()}});
 const malla=[['','3/11/2026','a@pibox.app','A','','7:00:00','15:30:00','','','jefe@pibox.app',''],['','4/11/2026','b@pibox.app','B','','7:00:00','15:30:00','','','jefe@pibox.app','']];
 const turnosDocs=[docT('x1','a@pibox.app',BOG('2026-11-03',7,0),BOG('2026-11-04',9,30)),docT('x2','b@pibox.app',BOG('2026-11-04',7,0),BOG('2026-11-04',21,30),{editedBy:{stringValue:'admin@pibox.app'}})];
 const w=mundo({malla,turnosDocs});const r=w.ctx.auditoriaNoDesconexion();const L=w.logs.join('\n');
 t('D1 cuenta 1 MISMO_DIA y 1 CIERRE_DIA_POSTERIOR',r.cuenta.MISMO_DIA===1&&r.cuenta.CIERRE_DIA_POSTERIOR===1,r.cuenta);
 t('D2 imprime la hora de cierre con su FECHA COMPLETA (lo que omitía el texto antiguo)',/CIERRE_DIA_POSTERIOR \| a@pibox\.app \| día 3\/11\/2026 \| salida programada 15:30:00 \| turno 2026-11-03 07:00:00 → CERRADO 2026-11-04 09:30:00 \(18 h/.test(L),L);
 t('D3 marca quién editó un turno',/MISMO_DIA \| b@pibox\.app .* editado por admin@pibox\.app/.test(L),L);
 t('D4 solo lectura: únicamente consultas runQuery, ninguna escritura',w.writes===0&&w.fetches.length>=1&&w.fetches.every(f=>/:runQuery$/.test(f.url)),w.writes);}

out.forEach(l=>console.log(l));
const fail=out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length-fail}/${out.length} OK`);process.exit(fail?1:0);
