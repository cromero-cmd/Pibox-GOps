// Uso: node test/pigops_auditoria_test.js   (sin red, sin Google, sin Firestore: todo simulado)
// auditoriaRelojes() (PiGOps_Auditoria.gs): SOLO LECTURA. Compara startTime con el createTime que pone el servidor de Firestore.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const GS=fs.readFileSync(path.join(__dirname,'..','PiGOps_Auditoria.gs'),'utf8');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

function mundo(resp){
 const w={logs:[],fetches:[],resp,writes:0};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,FIREBASE_PROJECT:'proj',
  Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:(d,tz,pat)=>new Date(d.getTime()-5*3600000).toISOString().replace('T',' ').slice(0,19)},
  ScriptApp:{getOAuthToken:()=>'TOKEN'},
  // cualquier cosa que no sea runQuery (lectura) o que use otro método HTTP cuenta como escritura
  UrlFetchApp:{fetch:(url,opt)=>{w.fetches.push({url,opt});if(!/:runQuery$/.test(url)||String(opt.method).toLowerCase()!=='post')w.writes++;
   const r=typeof w.resp==='function'?w.resp(url,opt,w.fetches.length):w.resp;if(r instanceof Error)throw r;
   return{getResponseCode:()=>r.code,getContentText:()=>typeof r.body==='string'?r.body:JSON.stringify(r.body)};}},
  GmailApp:{sendEmail:()=>{w.writes++;}},SpreadsheetApp:{create:()=>{w.writes++;},openById:()=>{w.writes++;}},
  PropertiesService:{getScriptProperties:()=>({setProperty:()=>{w.writes++;},getProperty:()=>null})}};
 vm.createContext(ctx);vm.runInContext(GS,ctx);w.ctx=ctx;return w;}
const iso=(s)=>new Date(s).toISOString();
// start = hora de Bogotá del reloj del PC; create = createTime del servidor; dMin = startTime − createTime en minutos
const doc=(id,email,create,dMin,extra={})=>({document:{name:'projects/p/databases/(default)/documents/turnos/'+id,
 fields:Object.assign({userEmail:{stringValue:email},status:{stringValue:'ended'},startTime:{timestampValue:new Date(new Date(create).getTime()+dMin*60000).toISOString()}},extra),
 createTime:create,updateTime:create}});
const C='2026-11-04T13:00:00.123456Z';

// ═══ clasificación (función pura) ═══
{const c=m=>vm.runInContext('aud_clasificar('+m*60+',false)',mundo([]).ctx);
 t('C1 ventana OK: −2:00, 0 y +1:00',c(-2)==='OK'&&c(0)==='OK'&&c(1)==='OK',[c(-2),c(0),c(1)]);
 t('C2 −2:01 a −12:00 = REVISAR_REINTENTO',vm.runInContext('aud_clasificar(-121,false)',mundo([]).ctx)==='REVISAR_REINTENTO'&&c(-12)==='REVISAR_REINTENTO'&&c(-5)==='REVISAR_REINTENTO');
 t('C3 más atrás de −12:00 = ATRASADO',vm.runInContext('aud_clasificar(-721,false)',mundo([]).ctx)==='ATRASADO'&&c(-60)==='ATRASADO');
 t('C4 más de +1:00 = ADELANTADO',vm.runInContext('aud_clasificar(61,false)',mundo([]).ctx)==='ADELANTADO'&&c(30)==='ADELANTADO');
 t('C5 turno editado por un admin = EDITADO_POR_ADMIN sin importar la diferencia',vm.runInContext('aud_clasificar(-9999,true)',mundo([]).ctx)==='EDITADO_POR_ADMIN');}

// ═══ auditoría completa ═══
{const body=[doc('a1','ana@pibox.app',C,-0.5),doc('a2','luis@pibox.app',C,-6),doc('a3','eva@pibox.app',C,-45),doc('a4','ivo@pibox.app',C,20),
  doc('a5','sol@pibox.app',C,-30,{editedBy:{stringValue:'admin@pibox.app'}}),{readTime:'x'}];
 const w=mundo({code:200,body});const r=w.ctx.auditoriaRelojes();const L=w.logs.join('\n');
 t('A1 revisó 5 turnos y contó una categoría por turno',r.revisados===5&&r.cuenta.OK===1&&r.cuenta.REVISAR_REINTENTO===1&&r.cuenta.ATRASADO===1&&r.cuenta.ADELANTADO===1&&r.cuenta.EDITADO_POR_ADMIN===1,r.cuenta);
 t('A2 lista los hallazgos con correo, hora del PC, hora del servidor y diferencia',/ATRASADO \| eva@pibox.app \| startTime 2026-11-04 07:15:00 \| creado en servidor 2026-11-04 08:00:00 \| diferencia −45 min 00 s/.test(L),L);
 t('A3 el ATRASADO sale primero (es el que oculta tardanza)',L.indexOf('ATRASADO |')<L.indexOf('ADELANTADO |')&&L.indexOf('ADELANTADO |')<L.indexOf('REVISAR_REINTENTO |'));
 t('A4 el turno editado por admin muestra quién lo editó',/EDITADO_POR_ADMIN \| sol@pibox.app .*editado por admin@pibox.app/.test(L));
 t('A5 el turno OK no se lista',!/ana@pibox.app/.test(L));
 t('A6 SOLO LECTURA: una sola consulta POST a runQuery, sin correos, Sheets ni propiedades',w.writes===0&&w.fetches.length===1&&/runQuery$/.test(w.fetches[0].url),{w:w.writes,f:w.fetches.length});
 t('A7 la consulta usa el token OAuth, desde el 1-nov con 1 día de margen (Bogotá = −05:00) y orden estable',(()=>{const q=JSON.parse(w.fetches[0].opt.payload).structuredQuery;return /Bearer TOKEN/.test(w.fetches[0].opt.headers.Authorization)&&q.where.fieldFilter.value.timestampValue==='2026-10-31T05:00:00.000Z'&&q.orderBy.length===2&&q.orderBy[1].field.fieldPath==='__name__';})(),w.fetches[0].opt.payload);}

// ═══ ventana de fechas ═══
{// un turno con startTime del 31-oct (margen) y creado el 31-oct: se descarta; otro creado el 1-nov con startTime atrasado al 31-oct: se conserva
 const w=mundo({code:200,body:[doc('v1','a@pibox.app','2026-10-31T20:00:00Z',0),doc('v2','b@pibox.app','2026-11-01T14:00:00Z',-24*60+30)]});
 const r=w.ctx.auditoriaRelojes();
 t('W1 fuera de la fecha se descarta, pero un turno CREADO desde el 1-nov con startTime atrasado de la fecha sí cuenta (y sale ATRASADO)',r.revisados===1&&r.hallazgos[0].userEmail==='b@pibox.app'&&r.hallazgos[0].categoria==='ATRASADO',r);}
{const w=mundo({code:200,body:[doc('x','a@pibox.app',C,0)]});const r=w.ctx.auditoriaRelojesDesde('2026-11-04');
 t('W2 auditoriaRelojesDesde acepta otra fecha',r.revisados===1&&/desde 2026-11-04/.test(w.logs[0]));
 let m='';try{w.ctx.auditoriaRelojesDesde('mañana');}catch(e){m=e.message;}
 t('W3 fecha inválida lanza',/Fecha inválida/.test(m),m);}

// ═══ paginación ═══
{const pagina=n=>Array.from({length:n},(_,i)=>doc('p'+Math.random(),'u'+i+'@pibox.app',C,0));
 const w=mundo((u,o,n)=>({code:200,body:n<=2?pagina(300):pagina(7)}));const r=w.ctx.auditoriaRelojes();
 t('P1 pagina con offset 0, 300, 600 hasta una página incompleta',r.revisados===607&&w.fetches.length===3&&[0,300,600].every((off,i)=>JSON.parse(w.fetches[i].opt.payload).structuredQuery.offset===off),w.fetches.map(f=>JSON.parse(f.opt.payload).structuredQuery.offset));}

// ═══ falla segura: una lectura rota NUNCA es «sin hallazgos» ═══
const fallos={'HTTP 403':{code:403,body:[{error:{code:403,message:'denegado'}}]},'HTTP 500 HTML':{code:500,body:'<html>'},'200 no JSON':{code:200,body:'<html>'},
 '200 objeto':{code:200,body:{error:{message:'x'}}},'200 error en el arreglo':{code:200,body:[{error:{code:403,message:'d'}}]},'red':new Error('Address unavailable')};
for(const [n,resp] of Object.entries(fallos)){const w=mundo(resp);let msg=null;try{w.ctx.auditoriaRelojes();}catch(e){msg=e.message;}
 t('S '+n+': lanza error y NO imprime «Sin hallazgos»',msg!==null&&!w.logs.some(l=>/Sin hallazgos/.test(l)),{msg,l:w.logs});}
{const w=mundo((u,o,n)=>({code:200,body:Array.from({length:300},(_,i)=>doc('q'+n+'_'+i,'u@pibox.app',C,0))}));let m='';try{w.ctx.auditoriaRelojes();}catch(e){m=e.message;}
 t('S7 si se supera el tope de turnos falla en vez de entregar un resultado parcial',/tope/.test(m),m);}
{const w=mundo({code:200,body:[{readTime:'2026-11-04T15:00:00Z'}]});const r=w.ctx.auditoriaRelojes();
 t('S8 lectura válida vacía → «Sin hallazgos» (0 revisados)',r.revisados===0&&w.logs.some(l=>/Sin hallazgos/.test(l)),w.logs);}

console.log(out.join('\n'));
const f=out.filter(x=>x.startsWith('FAIL')).length;console.log(f?`\n${f} FALLAN`:`\nTodo OK (${out.length} comprobaciones)`);process.exit(f?1:0);
