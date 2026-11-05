// Uso: node test/pigops_notif_seguridad_test.js   (sin red, sin Google: todo simulado; no envía correos ni escribe nada)
// Fase 1 de seguridad de PiGOps_Notificaciones_v5.gs. El despliegue es público (acceso anónimo): ningún correo puede salir hacia fuera
// de @pibox.app, el aviso de extras rechazadas ya no manda un Excel de nómina vacío, y save_config no guarda destinatarios externos.
const fs=require('fs'),path=require('path'),vm=require('vm');
const GS=fs.readFileSync(path.join(__dirname,'..','PiGOps_Notificaciones_v5.gs'),'utf8');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

function mundo(props={}){
 const w={sent:[],logs:[],props:Object.assign({},props),sheetsCreados:0};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:()=>'x',sleep(){}},ScriptApp:{getOAuthToken:()=>'T'},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({s,setMimeType(){return this;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in w.props?w.props[k]:null,setProperty:(k,v)=>{w.props[k]=String(v);}})},
  GmailApp:{sendEmail:(to,subject,body,opt)=>w.sent.push({to,subject,cc:(opt||{}).cc,attachments:(opt||{}).attachments})},
  // sendPayrollReport llega hasta aquí SOLO si pasó la validación de destinatarios: se corta con un centinela
  SpreadsheetApp:{create(){w.sheetsCreados++;throw new Error('CENTINELA_SHEET_CREADO');},openById(){return{getSheetByName:()=>null};}}};
 vm.createContext(ctx);vm.runInContext(GS,ctx);w.ctx=ctx;
 w.get=(type,data)=>JSON.parse(ctx.doGet({parameter:{type,data:encodeURIComponent(JSON.stringify(data))}}).s);
 w.post=(type,data)=>JSON.parse(ctx.doPost({parameter:{type},postData:{contents:JSON.stringify(data)}}).s);
 return w;}
const dest=w=>w.sent.map(m=>m.to);

// ═══ A. overtime_request (relé de correo) ═══
{const w=mundo();w.get('overtime_request',{agentName:'A',agentEmail:'a@pibox.app',recipients:['atacante@gmail.com']});
 t('A1 solo destinatarios externos → no sale ningún correo',w.sent.length===0,dest(w));
 t('A2 …y queda «RECHAZADO» en el log',w.logs.some(l=>/RECHAZADO/.test(l)&&/atacante@gmail.com/.test(l)));}
{const w=mundo();const r=w.get('overtime_request',{agentName:'A',recipients:['lider@pibox.app','atacante@gmail.com']});
 t('A3 mezcla: solo sale al @pibox.app',JSON.stringify(dest(w))==='["lider@pibox.app"]',dest(w));}
{const w=mundo();w.get('overtime_request',{recipients:['lider@pibox.app,atacante@gmail.com']});
 t('A4 una cadena con VARIOS correos (Gmail entrega a todos) se rechaza completa',w.sent.length===0,dest(w));}
{const w=mundo();w.get('overtime_request',{recipients:['Jefe <atacante@gmail.com>','jefe@pibox.app.evil.com','jefe@evil-pibox.app','jefe@mail.pibox.app','x@pibox.app\nbcc:z@gmail.com']});
 t('A5 formas engañosas (nombre<…>, sufijo, prefijo, subdominio, salto de línea) → ninguna pasa',w.sent.length===0,dest(w));}
{const w=mundo();w.get('overtime_request',{recipients:['  Lider@PIBOX.app ','lider@pibox.app']});
 t('A6 se normaliza (mayúsculas/espacios) y no se duplica',JSON.stringify(dest(w))==='["lider@pibox.app"]',dest(w));}
{const w=mundo();const r=w.get('overtime_request',{recipients:[]});
 t('A7 sin destinatarios válidos la respuesta es ok:false',r.ok===false&&w.sent.length===0,r);}

// ═══ B. strike_warning / disciplinary_warning: modelo antiguo de strikes DESACTIVADO desde el 1-nov-2026 ═══
for(const tipo of ['strike_warning','disciplinary_warning']){
 for(const [etq,lider] of [['líder normal','jefe@pibox.app'],['líder externo','atacante@gmail.com'],['sin líder','']]){
  const w=mundo();const r=w.get(tipo,{agentName:'A',agentEmail:'a@pibox.app',liderEmail:lider,llamadoNumero:2,historial:[],detalle:[]});
  t('B '+tipo+' ('+etq+'): no sale NINGÚN correo, responde ok:false y queda el aviso en el log',w.sent.length===0&&r.ok===false&&w.logs.some(l=>/MODELO ANTIGUO DE STRIKES DESACTIVADO/.test(l)),{sent:w.sent,r});}}
{const w=mundo();
 t('B5 las funciones del modelo antiguo ya no envían (sendStrikeWarning, sendDisciplinaryWarning, sendPendingStrikeAlerts, runStrikeAlerts)',(()=>{w.ctx.sendStrikeWarning({});w.ctx.sendDisciplinaryWarning({});w.ctx.sendPendingStrikeAlerts();w.ctx.runStrikeAlerts();return w.sent.length===0&&w.logs.filter(l=>/DESACTIVADO/.test(l)).length===4;})(),w.logs);}

// ═══ C. overtime_rejected: el bug del Excel vacío ═══
{const w=mundo({payroll_recipients:'nomina@pibox.app'});
 const r=w.get('overtime_rejected',{agentName:'A',agentEmail:'a@pibox.app',date:'1 nov',extraMins:60,coordinatorEmail:'coord@pibox.app',reason:'no',recipients:['coord@pibox.app']});
 t('C1 envía UN correo, al coordinador, con copia al Super Admin',w.sent.length===1&&w.sent[0].to==='coord@pibox.app'&&w.sent[0].cc==='cromero@pibox.app'&&/rechazadas/.test(w.sent[0].subject),w.sent);
 t('C2 NO crea ningún Sheet ni manda ningún Excel de nómina',w.sheetsCreados===0&&!w.sent.some(m=>m.attachments),w.sheetsCreados);
 t('C3 NO pisa payroll_recipients con el correo del coordinador',w.props.payroll_recipients==='nomina@pibox.app',w.props);
 t('C4 responde ok:true',r.ok===true,r);}
{const w=mundo();w.get('overtime_rejected',{coordinatorEmail:'atacante@gmail.com',agentName:'A',recipients:['atacante@gmail.com']});
 t('C5 coordinador externo: no sale ningún correo',w.sent.length===0,dest(w));}

// ═══ D. payroll_report (POST) y exfiltración de cédulas ═══
{const w=mundo();const r=w.post('payroll_report',{weekStart:'a',weekEnd:'b',records:[{email:'victima@pibox.app',name:'V'}],recipients:['atacante@gmail.com']});
 t('D1 destinatario externo: ok:false, NO se crea el Sheet (no se leen las cédulas de BASE 3.0) y no sale correo',r.ok===false&&w.sheetsCreados===0&&w.sent.length===0,{r,s:w.sheetsCreados});
 t('D2 …y no se guarda en payroll_recipients',!('payroll_recipients' in w.props),w.props);}
{const w=mundo();const r=w.post('payroll_report',{weekStart:'a',weekEnd:'b',records:[],recipients:['nomina@pibox.app','atacante@gmail.com']});
 t('D3 destinatario interno: pasa la validación (llega a crear el Sheet) y solo se guarda el interno',w.sheetsCreados===1&&w.props.payroll_recipients==='nomina@pibox.app',{s:w.sheetsCreados,p:w.props});}
{const w=mundo({payroll_allowed_recipients:'nomina@pibox.app,th@pibox.app'});
 const r1=w.post('payroll_report',{weekStart:'a',weekEnd:'b',records:[],recipients:['empleado@pibox.app']});
 t('D4 con payroll_allowed_recipients definida, un correo interno que NO está en la lista se rechaza (sin Sheet)',r1.ok===false&&w.sheetsCreados===0&&w.logs.some(l=>/no están en payroll_allowed_recipients/.test(l)),{r1,l:w.logs});
 const r2=w.post('payroll_report',{weekStart:'a',weekEnd:'b',records:[],recipients:['TH@pibox.app']});
 t('D5 …y uno de la lista sí avanza',w.sheetsCreados===1,w.sheetsCreados);}
{const w=mundo();w.post('payroll_report',{recipients:['nomina@pibox.app']});
 t('D6 sin la propiedad de lista blanca deja un AVISO en el log',w.logs.some(l=>/payroll_allowed_recipients no está definida/.test(l)));}
{const w=mundo();const r=w.get('overtime_rejected',{coordinatorEmail:'c@pibox.app'});
 const r2=(()=>{try{return w.ctx.sendPayrollReport({recipients:['atacante@gmail.com']}),'no lanzó';}catch(e){return e.message;}})();
 t('D7 llamar sendPayrollReport directo con externos lanza antes de crear nada',/sin destinatarios válidos/.test(r2)&&w.sheetsCreados===0,r2);}

// ═══ E. save_config ═══
{const w=mundo({payroll_recipients:'nomina@pibox.app',reminder_recipients:'cromero@pibox.app',admin_emails:'cromero@pibox.app'});
 w.get('save_config',{payrollRecipients:'atacante@gmail.com',reminderRecipients:'a@gmail.com,b@gmail.com',adminEmails:'atacante@gmail.com',cutDay:1,cutHour:8,mallaNotifDelay:30});
 t('E1 listas solo con externos: se conservan los valores anteriores',w.props.payroll_recipients==='nomina@pibox.app'&&w.props.reminder_recipients==='cromero@pibox.app'&&w.props.admin_emails==='cromero@pibox.app',w.props);
 t('E2 los números válidos sí se guardan',w.props.payroll_cut_day==='1'&&w.props.payroll_cut_hour==='8'&&w.props.malla_notif_delay==='30',w.props);}
{const w=mundo();
 w.get('save_config',{payrollRecipients:'a@pibox.app, x@gmail.com , b@pibox.app',reminderRecipients:'r@pibox.app',adminEmails:'cromero@pibox.app,z@otro.com'});
 t('E3 listas mixtas: se guardan solo los @pibox.app',w.props.payroll_recipients==='a@pibox.app,b@pibox.app'&&w.props.reminder_recipients==='r@pibox.app'&&w.props.admin_emails==='cromero@pibox.app',w.props);}
{const w=mundo();
 w.get('save_config',{cutDay:99,cutHour:-3,mallaNotifDelay:1});
 t('E4 números fuera de rango (día 99, hora −3, retardo 1 min < 10) se ignoran',!('payroll_cut_day' in w.props)&&!('payroll_cut_hour' in w.props)&&!('malla_notif_delay' in w.props),w.props);}

// ═══ F. Propiedades ya envenenadas antes del parche ═══
{const w=mundo({reminder_recipients:'atacante@gmail.com'});
 try{w.ctx.sendWeeklyPayrollAuto();}catch(e){}
 t('F1 recordatorio semanal con reminder_recipients externo: cae a cromero, no al externo',JSON.stringify(dest(w))==='["cromero@pibox.app"]',dest(w));}

// ═══ G. diagnosticoSeguridadNotif ═══
{const w=mundo({payroll_recipients:'nomina@pibox.app,contador@externo.com',admin_emails:'cromero@pibox.app'});
 w.ctx.diagnosticoSeguridadNotif();const L=w.logs.join('\n');
 t('G1 marca el destinatario externo y no modifica propiedades ni envía nada',/contador@externo.com/.test(L)&&/FUERA DE @pibox.app/.test(L)&&w.sent.length===0&&w.props.payroll_recipients==='nomina@pibox.app,contador@externo.com',L);
 t('G2 recomienda definir payroll_allowed_recipients',/payroll_allowed_recipients no está definida/.test(L));}

console.log(out.join('\n'));
const f=out.filter(x=>x.startsWith('FAIL')).length;console.log(f?`\n${f} FALLAN`:`\nTodo OK (${out.length} comprobaciones)`);process.exit(f?1:0);
