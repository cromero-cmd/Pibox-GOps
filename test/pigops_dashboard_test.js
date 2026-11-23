// Uso: node test/pigops_dashboard_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Conteos por fecha × hora × línea para el dashboard (PiGOps_Dashboard.gs, v19.13: + agentes_almuerzo). La prueba central compara el cálculo del servidor con el
// agentesPorHora REAL del cliente (index.html, el mapa de Insights) sobre los mismos datos: si los dos no coinciden, el dashboard y el mapa mostrarían
// números distintos. Las demás cubren: líneas y TODAS, un agente una sola vez, madrugada (turnos nocturnos y día previo), Storage, entrada = salida,
// horas que aún no ocurren (vacías, no cero), estado provisional/cerrado, zona horaria fija, solo conteos (sin nombres ni correos), lecturas de Firestore y de la
// malla con falla segura, escritura que sobrescribe solo la ventana y carga inicial con cobertura de la malla; v19.13: almuerzo (turno normal,
// nocturno, franja vacía, mal escrita, fuera del turno, un agente una vez) y encabezado de 9 columnas.
process.env.TZ='America/Bogota';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const SRC=['PiGOps_Notificaciones_v5.gs','PiGOps_Reglamento.gs','PiGOps_Auditoria.gs','PiGOps_CierreTurnos.gs','PiGOps_Dashboard.gs'].map(f=>fs.readFileSync(path.join(root,f),'utf8'));
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const BOG=(iso,h,mi=0)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));};
const mas=(iso,n)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10);};

// ── Cliente real: agentesPorHora y lo que necesita ──
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);return html.slice(i,html.indexOf('\n}\n',i)+3);};
const line=(pref)=>{const i=html.indexOf(pref);return html.slice(i,html.indexOf('\n',i));};
const CL=new Function([fn('function esNovedadVotaciones(novedad){'),fn('function simulEsStorage(r){'),fn('function agentesPorHora(rows,opts){'),'return{agentesPorHora,simulEsStorage};'].join('\n'))();

// ── Mundo simulado ──
function mundo(o={}){
 const w={turnosFalla:o.turnosFalla,adminsFalla:o.adminsFalla,turnosArregloError:o.turnosArregloError,mallaFalla:o.mallaFalla,libroFalla:o.libroFalla,now:o.now||BOG('2026-11-21',15,30),logs:[],sent:[],props:Object.assign({malla_sheet_id:'SHEET'},o.props||{}),fetches:[],mallaFilas:o.mallaFilas||[],admins:o.admins||[],turnosDocs:o.turnosDocs||[],hojas:{}};
 const ctx={console,Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set,Uint8Array,
  Logger:{log:m=>w.logs.push(String(m))},
  Utilities:{formatDate:(d,tz,pat)=>new Date(d.getTime()-5*3600000).toISOString().slice(0,10),sleep(){}},
  ScriptApp:{getOAuthToken:()=>'TOKEN',getProjectTriggers:()=>w.triggers||[],deleteTrigger:()=>{},newTrigger:fn=>({timeBased:()=>({everyHours:n=>({create:()=>{w.trigCreado={fn,n};}})})})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in w.props?w.props[k]:null,setProperty:(k,v)=>{w.props[k]=String(v);},deleteProperty:k=>{delete w.props[k];}})},
  GmailApp:{sendEmail:(to,subj,body,opt)=>{w.sent.push({to,subject:subj,html:(opt||{}).htmlBody||''});}},
  DriveApp:{getFileById:id=>({addViewer:e=>{w.compartido={id,email:e};}})},
  SpreadsheetApp:{openById:id=>{
    if(w.libroFalla)throw new Error('No se puede abrir el libro');
    return{getSheetByName:n=>{
      if(n==='Malla')return w.mallaFalla?null:{getDataRange:()=>({getDisplayValues:()=>[['h','fecha','usuario','nombre','rol','inicio','fin','alm','linea','lider','novedad']].concat(w.mallaFilas)})};
      return w.hojas[id+'|'+n]||null;}};},
    create:nombre=>{const h=hojaFalsa();w.hojas['NUEVA|conteos']=h;return{getSheets:()=>[h],getId:()=>'NUEVA',getUrl:()=>'https://docs.google.com/spreadsheets/d/NUEVA'};}},
  UrlFetchApp:{fetch:(url,opt)=>{
    w.fetches.push({url,opt});
    if(/\/admins\?/.test(url)){if(w.adminsFalla)return{getResponseCode:()=>403,getContentText:()=>'{"error":{"message":"denegado"}}'};
      return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({documents:w.admins.map(e=>({name:'projects/p/databases/(default)/documents/admins/'+e}))})};}
    if(/:runQuery$/.test(url)){
      if(w.turnosFalla)return{getResponseCode:()=>500,getContentText:()=>'boom'};
      const q=JSON.parse(opt.payload).structuredQuery,fl=q.where.compositeFilter.filters.map(x=>x.fieldFilter);
      const a=new Date(fl[0].value.timestampValue),b=new Date(fl[1].value.timestampValue);
      w.consultas=(w.consultas||[]).concat([{a,b,limit:q.limit,orden:q.orderBy[0].direction}]);
      if(w.turnosArregloError)return{getResponseCode:()=>200,getContentText:()=>JSON.stringify([{error:{message:'cuota'}}])};
      const res=w.turnosDocs.filter(d=>{const s=new Date(d.document.fields.startTime.timestampValue);return s>=a&&s<b;}).sort((x,y)=>new Date(y.document.fields.startTime.timestampValue)-new Date(x.document.fields.startTime.timestampValue));
      return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(res.length?res:[{readTime:'x'}])};}
    throw new Error('fetch inesperado '+url);}}};
 vm.createContext(ctx);
 SRC.forEach((s,i)=>vm.runInContext(s,ctx,{filename:i+'.gs'}));
 w.ctx=ctx;w.call=(f,...a)=>ctx[f](...a);
 return w;
}
const ENC=['fecha','hora','pais','linea','agentes_programados','agentes_reales','actualizado_at','estado','agentes_almuerzo'];
function hojaFalsa(){
 const st={filas:[ENC.slice()],maxRows:50,formatos:[]};
 const ultima=()=>{for(let i=st.filas.length;i>0;i--){const r=st.filas[i-1];if(r&&r.some(x=>x!==''&&x!==undefined))return i;}return 0;};
 return{st,getLastRow:ultima,getMaxRows:()=>st.maxRows,insertRowsAfter:(n,k)=>{st.maxRows+=k;},setName(){},setFrozenRows(){},
  getRange:(r,c,nr=1,nc=1)=>{const r0=r;return{
   getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>{const v=(st.filas[r0-1+i]||[])[c-1+j];return v===undefined?'':v;})),
   setValues:v=>{v.forEach((fila,i)=>{const dst=st.filas[r0-1+i]||(st.filas[r0-1+i]=[]);fila.forEach((x,j)=>{dst[c-1+j]=x;});});if(r0===1&&v.length===1&&nc===8&&st.noEnc!==true){}return{setFontWeight(){}};},
   clearContent:()=>{for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){if(st.filas[r0-1+i])st.filas[r0-1+i][c-1+j]='';}},
   setNumberFormat:function(f){st.formatos.push({r:r0,c,nr,nc,f});return this;},setFontWeight(){return this;}};}};
}
const datosHoja=h=>h.st.filas.slice(1).filter(r=>r&&r[0]!==''&&r[0]!==undefined);

// ── Malla y turnos de prueba ──
const SEMANA=Array.from({length:7},(_,i)=>mas('2026-11-16',i)); // lun 16 … dom 22
const PREVIO='2026-11-15';
const DEF=[ // [usuario, línea, rol, inicio, fin, novedad]
 ['u1@x.co','Asignación','Operador','6:00:00','14:00:00',''],
 ['u2@x.co','Asignación','Operador','8:00:00','16:00:00',''],
 ['u3@x.co','Asignación','Operador','8:30:00','12:45:00',''],
 ['u4@x.co','Soporte','Soporte','14:00:00','22:00:00',''],
 ['u5@x.co','Soporte','Soporte','22:00:00','6:00:00',''],
 ['u6@x.co','','Operador','9:00:00','17:00:00',''],
 ['u7@x.co','Asignación','Operador','10:00 a. m.','6:00 p. m.',''],
 ['u8@x.co','Soporte','Soporte','0:00:00','0:00:00',''],
 ['u9@x.co','Soporte','Soporte','8:00:00','16:00:00','Vacaciones'],
 ['u10@x.co','Asignación','Operador','8:00:00','12:00:00','1/2 Día de Votaciones'],
 ['adm@x.co','Asignación','Operador','8:00:00','16:00:00',''],
 ['s1@x.co','Storage','Operador','7:00:00','15:00:00',''],
 ['s2@x.co','Asignación','Auxiliar Storage','7:00:00','15:00:00',''],
 ['u11@x.co','Asignación','Operador','','','']];
const fmtDDMM=iso=>iso.slice(8)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4);
const mallaDe=(fechas,def=DEF)=>{const r=[];fechas.forEach(iso=>def.forEach(d=>r.push(['',fmtDDMM(iso),d[0],'Nombre '+d[0],d[2],d[3],d[4],d[6]||'',d[1],'LIDER',d[5]])));return r;};
const mallaObj=(fechas,def=DEF)=>{const r=[];fechas.forEach(iso=>def.forEach(d=>r.push({iso,usuario:d[0],rol:d[2],inicio:d[3],fin:d[4],linea:d[1],novedad:d[5]})));return r;};
const hm=s=>{const m=String(s).toLowerCase().replace(/\./g,'').match(/(\d{1,2}):(\d{2})/);if(!m)return null;let h=+m[1];const mi=+m[2];if(/p ?m/.test(String(s).toLowerCase().replace(/\./g,''))&&h!==12)h+=12;if(/a ?m/.test(String(s).toLowerCase().replace(/\./g,''))&&h===12)h=0;return{h,mi};};
const T=(u,status,ini,fin)=>({userEmail:u,status,startTime:ini,endTime:fin||null});
// turnos reales de la semana (del más reciente al más antiguo se ordena al final)
function turnosSemana(){
 const ts=[];
 SEMANA.forEach((iso,i)=>{
  if(iso>'2026-11-21')return; // el domingo 22 es futuro: nadie ha trabajado
  const hoy=iso==='2026-11-21';
  ts.push(T('u1@x.co','ended',BOG(iso,6,3),BOG(iso,14,0)));
  ts.push(T('u2@x.co','ended',BOG(iso,7,55),BOG(iso,16,40)));
  if(i===3)ts.push(T('u2@x.co','interrupted',BOG(iso,7,50),BOG(iso,11,0))); // dos turnos el jueves: manda el ended
  if(i!==1)ts.push(T('u3@x.co','ended',BOG(iso,8,40),BOG(iso,12,45))); // el martes u3 no trabajó
  ts.push(hoy?T('u4@x.co','active',BOG(iso,14,0),null):T('u4@x.co','interrupted',BOG(iso,14,0),BOG(iso,17,0)));
  ts.push(T('u5@x.co','ended',BOG(iso,22,2),new Date(BOG(iso,6,5).getTime()+86400000)));
  ts.push(i===2?T('u6@x.co','ended',BOG(iso,9,0),BOG(iso,9,0).getTime()+15*3600000&&new Date(BOG(iso,9,0).getTime()+15*3600000)):T('u6@x.co','ended',BOG(iso,9,2),BOG(iso,17,0)));
  ts.push(hoy?T('u7@x.co','active',BOG(iso,10,5),null):T('u7@x.co','active',BOG(iso,10,5),null)); // activo sin cierre: solo cuenta hoy
  ts.push(T('u10@x.co','ended',BOG(iso,8,0),BOG(iso,12,0)));
  ts.push(T('adm@x.co','ended',BOG(iso,8,0),BOG(iso,16,0)));
  ts.push(T('s1@x.co','ended',BOG(iso,7,0),BOG(iso,15,0)));
  ts.push(T('s2@x.co','ended',BOG(iso,7,0),BOG(iso,15,0)));
  ts.push(T('u8@x.co','ended',BOG(iso,9,0),BOG(iso,13,0))); // fila de la malla ignorada (entrada = salida): su turno no cuenta
 });
 return ts.sort((a,b)=>b.startTime-a.startTime);
}
const ADMINS={'adm@x.co':true};
const NOW=BOG('2026-11-21',15,30);

// ── Mismo cálculo en el cliente (mapa de Insights) ──
function clienteDeMalla(malla,turnos,now,soloLinea){
 const dk=d=>new Date(d.getTime()-5*3600000).toISOString().slice(0,10);
 const dd=new Map();turnos.forEach(x=>{const k=x.userEmail+'|'+dk(x.startTime);(dd.get(k)||dd.set(k,[]).get(k)).push(x);});
 const pick=l=>l?(l.find(x=>x.status==='ended')||l.find(x=>x.status==='interrupted')||l[0]):null;
 return malla.filter(m=>!soloLinea||(m.linea||'(sin línea)')===soloLinea).map(m=>{
  const a=hm(m.inicio),b=hm(m.fin),p=m.iso.split('-').map(Number);
  const ss=a?new Date(p[0],p[1]-1,p[2],a.h,a.mi):null,se=b?new Date(p[0],p[1]-1,p[2],b.h,b.mi):null;
  const mt=pick(dd.get(m.usuario+'|'+m.iso));
  return{usuario:m.usuario,rol:m.rol,linea:m.linea,novedad:m.novedad,scheduledStart:ss,scheduledEnd:se,realStart:mt?mt.startTime:null,realEnd:mt&&mt.endTime?mt.endTime:null,turno:mt?{status:mt.status}:null};});
}
const r2=x=>Math.round(x*100)/100;

// ═══ A. Equivalencia con el mapa de Insights ═══
const w=mundo();
const malla=mallaObj(SEMANA),turnos=turnosSemana();
const calc=w.call('dash_calcular',{now:NOW,desdeISO:SEMANA[0],hastaISO:SEMANA[6],malla,turnos,admins:ADMINS,sinDiaPrevio:true});
const dow=iso=>{const g=new Date(iso+'T12:00:00Z').getUTCDay();return g===0?6:g-1;};
const cliente=(soloLinea)=>CL.agentesPorHora(clienteDeMalla(malla,turnos,NOW,soloLinea),{now:NOW,excluir:new Set(Object.keys(ADMINS)),sinStorage:true});
{
 const cli=cliente(),filas=calc.filas.filter(f=>f[3]==='TODAS');
 let difs=[],n=0;
 filas.forEach(f=>{
  const d=cli.dias[dow(f[0])],h=f[1];n++;
  const esperadoP=r2(d.prog[h]),esperadoR=d.realObs[h]>0?r2(d.real[h]):'';
  if(f[4]!==esperadoP||f[5]!==esperadoR)difs.push({f:f[0],h,serv:[f[4],f[5]],cli:[esperadoP,esperadoR]});
 });
 t('A1 línea TODAS: las 7 fechas × 24 horas coinciden CELDA POR CELDA con el mapa de Insights (programados y reales, sin Storage, con hoy parcial y el domingo futuro)',n===168&&difs.length===0,{n,difs:difs.slice(0,5)});
 t('A2 hoy (sábado 15:30): reales de las horas que no han llegado quedan VACÍOS (no 0); programados sí van; el domingo futuro: todo real vacío',filas.filter(f=>f[0]==='2026-11-21'&&f[1]>=16).every(f=>f[5]===''&&f[4]!==undefined)&&filas.filter(f=>f[0]==='2026-11-21'&&f[1]===15)[0][5]!==''&&filas.filter(f=>f[0]==='2026-11-22').every(f=>f[5]==='')&&filas.filter(f=>f[0]==='2026-11-22').some(f=>f[4]>0));
 const lineas=[...new Set(calc.filas.map(f=>f[3]))].filter(x=>x!=='TODAS');
 let difL=[];
 lineas.forEach(L=>{
  const cl=cliente(L);
  calc.filas.filter(f=>f[3]===L).forEach(f=>{const d=cl.dias[dow(f[0])],h=f[1];const eP=r2(d.prog[h]),eR=d.realObs[h]>0?r2(d.real[h]):'';if(f[4]!==eP||f[5]!==eR)difL.push({L,f:f[0],h,s:[f[4],f[5]],c:[eP,eR]});});
 });
 t('A3 cada línea también coincide con el mapa filtrado a esa línea ('+lineas.join(', ')+')',difL.length===0&&lineas.length===3,{difL:difL.slice(0,4),lineas});
 t('A4 la línea sin etiqueta se publica como «(sin línea)» y la de Storage NO existe (su gente se excluye por completo)',lineas.indexOf('(sin línea)')!==-1&&lineas.indexOf('Storage')===-1&&lineas.indexOf('')===-1);
 t('A5 el resumen cuenta SIN nombres: 2 agentes de Storage excluidos (uno por línea y otro por rol), las filas con entrada = salida ignoradas (7) y los turnos de más de 14 h descartados (1, el miércoles de u6)',calc.resumen.storageExcluidos===2&&calc.resumen.ignoradasEntradaIgualSalida===7&&calc.resumen.turnosLargosDescartados===1&&calc.resumen.agentesConFilaDuplicada===0,calc.resumen);
 // Los sumarios por día coinciden con el cliente también en total de agentes-hora
 const sum=(a)=>a.reduce((x,y)=>x+y,0);
 const tp=sum(filas.map(f=>f[4])),cp=sum(cli.dias.flatMap(d=>d.prog));
 t('A6 total de agentes-hora programados de la semana = el del mapa ('+r2(cp)+')',Math.abs(tp-cp)<0.5,{tp,cp});
}

// ═══ B. Forma de la hoja ═══
{
 const f=calc.filas;
 t('B1 columnas en orden: fecha AAAA-MM-DD, hora 0–23, pais «Colombia», linea, programados, reales, actualizado_at con -05:00, estado y almuerzo (número ≥ 0)',f.every(x=>x.length===9&&typeof x[8]==='number'&&x[8]>=0&&/^\d{4}-\d{2}-\d{2}$/.test(x[0])&&Number.isInteger(x[1])&&x[1]>=0&&x[1]<=23&&x[2]==='Colombia'&&/^2026-11-21T15:30:00-05:00$/.test(x[6])&&(x[7]==='provisional'||x[7]==='cerrado')));
 const claves={};f.forEach(x=>{const k=x[0]+'|'+x[3];(claves[k]=claves[k]||new Set()).add(x[1]);});
 t('B2 por cada fecha × línea hay exactamente 24 horas (las horas sin agentes van con 0, no faltan)',Object.values(claves).every(s=>s.size===24)&&f.length===Object.values(claves).length*24&&f.some(x=>x[4]===0));
 t('B3 TODAS aparece SIEMPRE para cada fecha con malla y primero entre las líneas; la tabla sale ordenada por fecha, línea y hora',SEMANA.every(d=>claves[d+'|TODAS'])&&f.every((x,i)=>i===0||(()=>{const p=f[i-1];return p[0]<x[0]||(p[0]===x[0]&&(p[3]===x[3]?p[1]<x[1]:(p[3]==='TODAS'||(x[3]!=='TODAS'&&p[3]<x[3]))));})()));
 const linaTexto=JSON.stringify(f);
 t('B4 SOLO conteos: ni nombres, ni correos, ni IDs en la hoja (se revisa todo el contenido generado)',!/@|Nombre |LIDER|u\d+|adm|s[12]\b/i.test(linaTexto.replace(/Soporte|Asignación/g,'')),linaTexto.slice(0,120));
 t('B5 valores con 2 decimales como máximo y nunca negativos ni NaN',f.every(x=>[x[4],x[5]].every(v=>v===''||(typeof v==='number'&&v>=0&&Math.abs(v*100-Math.round(v*100))<1e-9))));
}

// ═══ C. Un agente cuenta una sola vez ═══
{
 const base=[{iso:'2026-11-17',usuario:'a@x.co',rol:'Op',inicio:'8:00:00',fin:'12:00:00',linea:'L1',novedad:''},
  {iso:'2026-11-17',usuario:'a@x.co',rol:'Op',inicio:'10:00:00',fin:'14:00:00',linea:'L1',novedad:''}, // solapa en la MISMA línea
  {iso:'2026-11-17',usuario:'b@x.co',rol:'Op',inicio:'8:00:00',fin:'10:00:00',linea:'L1',novedad:''},
  {iso:'2026-11-17',usuario:'b@x.co',rol:'Op',inicio:'9:00:00',fin:'11:00:00',linea:'L2',novedad:''}]; // b en dos líneas distintas
 const c=w.call('dash_calcular',{now:NOW,desdeISO:'2026-11-17',hastaISO:'2026-11-17',malla:base,turnos:[],admins:{}});
 const g=(L,h)=>c.filas.filter(f=>f[3]===L&&f[1]===h)[0][4];
 t('C1 un agente con dos filas solapadas en la MISMA línea cuenta UNA vez: L1 a las 9 = a + b = 2; a las 10 = a (solapadas, una vez) = 1 ; a las 11 = a = 1',g('L1',9)===2&&g('L1',10)===1&&g('L1',11)===1,[g('L1',9),g('L1',10),g('L1',11)]);
 t('C2 un agente con dos LÍNEAS distintas cuenta una vez en cada línea y UNA sola vez en TODAS: b a las 9 → L1 1, L2 1, TODAS = a(1) + b(1) = 2 (no 3)',g('L1',9)-1===1&&g('L2',9)===1&&g('TODAS',9)===2&&g('TODAS',10)===2,[g('TODAS',9),g('TODAS',10)]);
 t('C3 se informa cuántos agentes tienen dos filas el mismo día (para entender por qué el mapa de Insights, que cuenta filas, puede dar más)',c.resumen.agentesConFilaDuplicada===2);
}

// ═══ D. Madrugada: turnos nocturnos y día previo ═══
{
 const noct=[{iso:'2026-11-16',usuario:'n@x.co',rol:'Op',inicio:'22:00:00',fin:'6:00:00',linea:'L1',novedad:''},{iso:'2026-11-15',usuario:'m@x.co',rol:'Op',inicio:'23:00:00',fin:'5:00:00',linea:'L1',novedad:''},{iso:'2026-11-17',usuario:'z@x.co',rol:'Op',inicio:'',fin:'',linea:'L1',novedad:'Vacaciones'}];
 const con=w.call('dash_calcular',{now:NOW,desdeISO:'2026-11-16',hastaISO:'2026-11-17',malla:noct,turnos:[],admins:{}});
 const sin=w.call('dash_calcular',{now:NOW,desdeISO:'2026-11-16',hastaISO:'2026-11-17',malla:noct,turnos:[],admins:{},sinDiaPrevio:true});
 const v=(c,d,h)=>c.filas.filter(f=>f[0]===d&&f[3]==='TODAS'&&f[1]===h)[0][4];
 t('D1 turno 22:00–06:00 del lunes 16: horas 22 y 23 el 16 y horas 0 a 5 el 17 (cada minuto en su fecha y hora)',v(con,'2026-11-16',22)===1&&v(con,'2026-11-16',23)===1&&v(con,'2026-11-17',0)===1&&v(con,'2026-11-17',5)===1&&v(con,'2026-11-17',6)===0&&v(con,'2026-11-16',5)===0);
 t('D2 la madrugada del PRIMER día no queda vacía: el turno 23:00–05:00 del domingo 15 (un día antes del rango) aparece en las horas 0–4 del lunes 16',v(con,'2026-11-16',0)===1&&v(con,'2026-11-16',4)===1&&v(con,'2026-11-16',5)===0,[v(con,'2026-11-16',0),v(con,'2026-11-16',4),v(con,'2026-11-16',5)]);
 t('D3 sin el día previo (como Insights) esa madrugada del lunes queda en 0',v(sin,'2026-11-16',0)===0&&v(sin,'2026-11-16',3)===0);
 t('D4 solo se publican las fechas pedidas: el día previo (15) no genera filas',con.filas.every(f=>f[0]>='2026-11-16'&&f[0]<='2026-11-17'));
 t('D5 hora de entrada con «a. m./p. m.» y con «0:00 → 0:00» sin novedad se interpretan igual que en el cliente (A1 ya lo verifica); media hora: entrar 8:30 aporta 0,5 a las 8',(()=>{const c=w.call('dash_calcular',{now:NOW,desdeISO:'2026-11-17',hastaISO:'2026-11-17',malla:[{iso:'2026-11-17',usuario:'a@x.co',rol:'',inicio:'8:30:00',fin:'9:15:00',linea:'L',novedad:''}],turnos:[],admins:{}});const g=h=>c.filas.filter(f=>f[3]==='TODAS'&&f[1]===h)[0][4];return g(8)===0.5&&g(9)===0.25&&g(7)===0;})());
}

// ═══ E. Estado, zona horaria y futuro ═══
{
 const ahora=BOG('2026-11-30',9,0);
 const mm=mallaObj(['2026-11-20','2026-11-23','2026-11-24','2026-11-30'],[DEF[1]]);
 const c=w.call('dash_calcular',{now:ahora,desdeISO:'2026-11-20',hastaISO:'2026-11-30',malla:mm,turnos:[],admins:{}});
 const est=d=>[...new Set(c.filas.filter(f=>f[0]===d).map(f=>f[7]))].join();
 t('E1 estado: menos de 7 días = provisional (el 24 está a 6 días y el 30 es hoy); 7 o más = cerrado (el 23 está a 7, el 20 a 10)',est('2026-11-30')==='provisional'&&est('2026-11-24')==='provisional'&&est('2026-11-23')==='cerrado'&&est('2026-11-20')==='cerrado',[est('2026-11-24'),est('2026-11-23')]);
 t('E2 las fechas sin ninguna fila en la malla NO se escriben y se informan (21, 22, 25–29)',c.escritas.join()==='2026-11-20,2026-11-23,2026-11-24,2026-11-30'&&c.resumen.fechasSinMalla.join()==='2026-11-21,2026-11-22,2026-11-25,2026-11-26,2026-11-27,2026-11-28,2026-11-29');
 // zona horaria: el mismo resultado con otra zona en el proceso
 const antes=JSON.stringify(calc.filas);
 const tzOriginal=process.env.TZ;process.env.TZ='Pacific/Auckland';
 const cambio=new Date(2026,10,1).getTimezoneOffset()!==300;
 const w2=mundo(),c2=w2.call('dash_calcular',{now:NOW,desdeISO:SEMANA[0],hastaISO:SEMANA[6],malla,turnos,admins:ADMINS,sinDiaPrevio:true});
 process.env.TZ=tzOriginal;
 t('E3 la zona horaria es SIEMPRE America/Bogota: el resultado es idéntico aunque el proceso corra en otra zona (Auckland)'+(cambio?'':' [la zona del proceso no cambió: prueba no concluyente]'),cambio&&JSON.stringify(c2.filas)===antes);
}

// ═══ F. Carga de datos (Firestore REST, malla, admins) y falla segura ═══
{
 const iso='2026-11-18';
 const docT=(u,st,a,b,extra)=>({document:{name:'projects/p/databases/(default)/documents/turnos/x',fields:Object.assign({userEmail:{stringValue:u},status:{stringValue:st},startTime:{timestampValue:a.toISOString()}},b?{endTime:{timestampValue:b.toISOString()}}:{},extra||{})}});
 const w3=mundo({turnosDocs:[docT('a@x.co','ended',BOG(iso,8),BOG(iso,16)),docT('b@x.co','archivado',BOG(iso,8),BOG(iso,16)),docT('c@x.co','ended',BOG('2026-11-24',8),BOG('2026-11-24',16))],admins:['Adm@X.co']});
 const ts=w3.call('dash_leerTurnos','2026-11-17','2026-11-30');
 const q=w3.consultas;
 t('F1 los turnos se leen en tramos de 7 días SIN offset, de más reciente a más antiguo, con límite; los archivados se omiten; cada consulta cubre [00:00 Bogotá, 00:00 del día siguiente)',q.length===2&&q.every(x=>x.orden==='DESCENDING'&&x.limit===2000)&&q[0].a.getTime()===BOG('2026-11-17',0).getTime()&&q[0].b.getTime()===BOG('2026-11-24',0).getTime()&&q[1].b.getTime()===BOG('2026-12-01',0).getTime()&&ts.length===2&&ts[0].userEmail==='c@x.co',{q:q.length,ts:ts.map(x=>x.userEmail)});
 const ad=w3.call('dash_leerAdmins');
 t('F2 admins: salen de la colección admins en minúsculas, más el Super Admin; sin nombres en el log',ad['adm@x.co']===true&&Object.keys(ad).length>=2&&!w3.logs.some(l=>/adm@x/i.test(l)));
 const wf=mundo({turnosFalla:true});let e1='';try{wf.call('dash_leerTurnos','2026-11-17','2026-11-20');}catch(e){e1=e.message;}
 const wf2=mundo({turnosArregloError:true});let e2='';try{wf2.call('dash_leerTurnos','2026-11-17','2026-11-20');}catch(e){e2=e.message;}
 const wf3=mundo({adminsFalla:true});let e3='';try{wf3.call('dash_leerAdmins');}catch(e){e3=e.message;}
 t('F3 una lectura fallida LANZA (HTTP 500, error dentro del arreglo con HTTP 200, admins denegado): nunca se interpreta como «no hay turnos» ni «no hay admins»',/HTTP 500/.test(e1)&&/error dentro del arreglo/.test(e2)&&/HTTP 403/.test(e3),[e1,e2,e3]);
 // límite: un tramo con 2000 documentos
 const muchos=Array.from({length:2000},(_,i)=>docT('u'+i+'@x.co','ended',BOG(iso,8,i%50),BOG(iso,16)));
 const wl=mundo({turnosDocs:muchos});let e4='';try{wl.call('dash_leerTurnos',iso,iso);}catch(e){e4=e.message;}
 t('F4 si un tramo alcanza el límite de 2000 turnos falla (podría estar incompleto) en vez de calcular con datos cortados',/límite de 2000/.test(e4),e4);
 // malla
 const wm=mundo({mallaFilas:mallaDe(['2026-11-10','2026-11-17'],[DEF[1]])});
 const ml=wm.call('dash_leerMalla','2026-11-12');
 t('F5 la malla se lee con rol, línea y novedad (sin nombres) y dice hasta dónde llega (min/max); solo devuelve filas desde la fecha pedida',ml.rows.length===1&&ml.rows[0].linea==='Asignación'&&ml.rows[0].rol==='Operador'&&!('nombre' in ml.rows[0])&&ml.minIso==='2026-11-10'&&ml.maxIso==='2026-11-17');
 const wn=mundo({mallaFalla:true});let e5='';try{wn.call('dash_leerMalla','2026-11-12');}catch(e){e5=e.message;}
 t('F6 sin la hoja Malla lanza',/Malla/.test(e5));
}

// ═══ G. Orquestación (dash_correr), escritura y carga inicial ═══
function depsDe(w,hoja,opts={}){
 const calls={escribir:0,aviso:[]};
 return{calls,now:()=>w.now,leerMalla:d=>{if(opts.mallaFalla)throw new Error('la hoja Malla está vacía');return w.call('dash_leerMalla',d);},
  admins:()=>{if(opts.adminsFalla)throw new Error('Firestore respondió HTTP 403 (admins)');return Object.assign({},ADMINS);},
  leerTurnos:(a,b)=>{if(opts.turnosFalla)throw new Error('Firestore respondió HTTP 500 (turnos)');return opts.turnos||[];},
  escribir:(f,e)=>{calls.escribir++;return w.call('dash_escribir',hoja,f,e);},avisoTecnico:(m,n)=>{calls.aviso.push(m);return true;}};
}
{
 const fechas=Array.from({length:30},(_,i)=>mas('2026-10-27',i)); // 27-oct … 25-nov
 const wm=mundo({mallaFilas:mallaDe(fechas.filter(f=>f>='2026-11-05'),DEF.slice(0,3)),now:BOG('2026-11-21',15,30)});
 const hoja=hojaFalsa(),d=depsDe(wm,hoja);
 const r=wm.call('dash_correr',d,{desdeISO:mas('2026-11-21',-84),hastaISO:'2026-11-21'});
 t('G1 carga inicial: 12 semanas; solo escribe las fechas CON malla (del 5 al 21 de noviembre = 17), informa las que no tienen y hasta dónde llega la malla',r.escritas.length===17&&r.escritas[0]==='2026-11-05'&&r.resumen.fechasSinMalla.length===85-17&&r.malla.minIso==='2026-11-05'&&r.malla.maxIso==='2026-11-25',{n:r.escritas.length,min:r.malla.minIso});
 const datos=datosHoja(hoja);
 t('G2 la hoja queda con 17 fechas × 24 horas × (TODAS + líneas) filas y el encabezado intacto',datos.length===r.filas.length&&datos.length%24===0&&hoja.st.filas[0][0]==='fecha');
 t('G3 las columnas de texto (fecha, línea, actualizado_at, estado) se fijan como texto para que Sheets no las convierta en fechas ni fórmulas',[1,4,7,8].every(c=>hoja.st.formatos.some(f=>f.c===c&&f.f==='@')));
 // segunda ejecución horaria: 14 días, ahora un poco más tarde, con un turno nuevo
 wm.now=BOG('2026-11-21',16,30);
 const turnos2=[T('u1@x.co','ended',BOG('2026-11-20',6,0),BOG('2026-11-20',14,0))];
 const d2=depsDe(wm,hoja,{turnos:turnos2});
 const antesFilas=datos.length,antiguas=datos.filter(f=>f[0]<'2026-11-08').map(f=>JSON.stringify(f));
 const r2b=wm.call('dash_correr',d2,{});
 const datos2=datosHoja(hoja);
 t('G4 la actualización horaria recalcula SOLO los últimos 14 días (8–21 nov): no cambia el tamaño de la hoja, no duplica filas y las fechas más viejas quedan intactas',r2b.desde==='2026-11-08'&&datos2.length===antesFilas&&new Set(datos2.map(f=>f[0]+'|'+f[3]+'|'+f[1])).size===datos2.length&&JSON.stringify(datos2.filter(f=>f[0]<'2026-11-08').map(f=>JSON.stringify(f)))===JSON.stringify(antiguas));
 t('G5 …y sobrescribe: la fila de hoy a las 15 ahora trae el actualizado_at nuevo y el turno recién leído aparece en sus reales (20-nov, u1: 06–14 → 1 agente a las 8)',datos2.filter(f=>f[0]==='2026-11-21'&&f[3]==='TODAS').every(f=>/T16:30:00-05:00$/.test(f[6]))&&datos2.filter(f=>f[0]==='2026-11-20'&&f[3]==='TODAS'&&f[1]===8)[0][5]===1);
 t('G6 el orden de la hoja se conserva (fecha, línea, hora) tras reescribir y el estado de las fechas pasa a cerrado a los 7 días',datos2.every((f,i)=>i===0||datos2[i-1][0]<=f[0])&&datos2.filter(f=>f[0]==='2026-11-13')[0][7]==='cerrado'&&datos2.filter(f=>f[0]==='2026-11-15')[0][7]==='provisional');
 // idempotente: misma hora, mismos datos → mismo contenido
 const foto=JSON.stringify(datosHoja(hoja));wm.call('dash_correr',depsDe(wm,hoja,{turnos:turnos2}),{});
 t('G7 es idempotente: repetir con los mismos datos deja la hoja idéntica',JSON.stringify(datosHoja(hoja))===foto);
 // una línea desaparece de la ventana → su cola se limpia (no quedan filas huérfanas debajo)
 const wm2=mundo({mallaFilas:mallaDe(['2026-11-20','2026-11-21'],[DEF[0],DEF[3]]),now:BOG('2026-11-21',15,30)}),h2=hojaFalsa();
 wm2.call('dash_correr',depsDe(wm2,h2),{desdeISO:'2026-11-20',hastaISO:'2026-11-21'});
 const antes2=datosHoja(h2).length;
 wm2.mallaFilas=mallaDe(['2026-11-20','2026-11-21'],[DEF[0]]); // ahora solo u1: desaparece la línea Soporte de ambos días
 wm2.call('dash_correr',depsDe(wm2,h2),{desdeISO:'2026-11-20',hastaISO:'2026-11-21'});
 t('G8 si la ventana ahora tiene MENOS filas, las sobrantes de abajo se borran (sin huérfanas)',datosHoja(h2).length===2*2*24&&antes2===3*2*24&&h2.getLastRow()===1+datosHoja(h2).length,{antes2,ahora:datosHoja(h2).length});
 // falla segura: ninguna escritura, la hoja no cambia
 const hs=hojaFalsa();wm.call('dash_correr',depsDe(wm,hs),{});const fotoS=JSON.stringify(hs.st.filas);
 const resultados=[];
 [['malla',{mallaFalla:true}],['admins',{adminsFalla:true}],['turnos',{turnosFalla:true}]].forEach(([k,o])=>{const dd=depsDe(wm,hs,o);let err='';try{wm.call('dash_correr',dd,{});}catch(e){err=e.message;}resultados.push([k,err!=='',dd.calls.escribir]);});
 t('G9 FALLA SEGURA: si falla la malla, los admins o los turnos, dash_correr lanza y NO escribe nada en la hoja',resultados.every(x=>x[1]&&x[2]===0)&&JSON.stringify(hs.st.filas)===fotoS,resultados);
 const wv=mundo({mallaFilas:mallaDe(['2026-09-01'],DEF.slice(0,1)),now:BOG('2026-11-21',15,30)});let e6='';try{wv.call('dash_correr',depsDe(wv,hojaFalsa()),{});}catch(e){e6=e.message;}
 t('G10 una malla sin NINGUNA fila en los últimos 14 días se trata como lectura incompleta (lanza, no escribe ceros)',/ninguna fila/.test(e6),e6);
}

// ═══ H. Disparador, aviso técnico, hoja destino y puesta en marcha ═══
{
 const wh=mundo({mallaFilas:[],now:BOG('2026-11-21',15,30)});
 // dashboardActualizar con la hoja sin configurar: no escribe, avisa al Super Admin UNA vez por hora
 wh.call('dashboardActualizar');wh.call('dashboardActualizar');
 t('H1 el disparador, si algo falla, NO lanza ni escribe y manda UN solo correo técnico por hora (el segundo intento se omite)',wh.sent.length===1&&/no se escribió nada/.test(wh.sent[0].html)&&wh.logs.some(l=>/ya se envió uno/.test(l)));
 wh.now=BOG('2026-11-21',17,0);
 const wc=mundo({props:{malla_sheet_id:'SHEET',dash_lector_email:'cuenta@servicio.example'}});
 const id=wc.call('dashboardCrearHoja');
 const nueva=wc.hojas['NUEVA|conteos'];
 t('H2 dashboardCrearHoja crea la hoja con el encabezado exacto, guarda su ID en dash_sheet_id y la comparte SOLO como lector con dash_lector_email',id==='NUEVA'&&wc.props.dash_sheet_id==='NUEVA'&&JSON.stringify(nueva.st.filas[0])===JSON.stringify(ENC)&&wc.compartido&&wc.compartido.email==='cuenta@servicio.example'&&wc.logs.some(l=>/ID: NUEVA/.test(l)));
 const wd=mundo({props:{malla_sheet_id:'SHEET',dash_sheet_id:'X'}});wd.hojas['X|conteos']=Object.assign(hojaFalsa(),{});wd.hojas['X|conteos'].st.filas[0][2]='otra';
 let e7='';try{wd.call('dash_hoja');}catch(e){e7=e.message;}
 t('H3 si la hoja destino NO tiene el encabezado esperado, no se escribe en ella',/encabezado/.test(e7),e7);
 const wsin=mundo({props:{malla_sheet_id:'SHEET',dash_sheet_id:'X'}});wsin.call('dashboardCompartir');
 t('H4 sin dash_lector_email no se comparte con nadie y lo dice',wsin.compartido===undefined&&wsin.logs.some(l=>/dash_lector_email/.test(l)));
 const wt=mundo();wt.call('instalarDisparadorDashboard');
 t('H5 el disparador se instala cada hora sobre dashboardActualizar',wt.trigCreado&&wt.trigCreado.fn==='dashboardActualizar'&&wt.trigCreado.n===1);
}

// ═══ I. Estáticas ═══
{
 const gs=SRC[4];
 t('I1 la hoja no recibe nada que identifique personas: la malla se lee SIN la columna de nombres y los turnos sin nombre ni correo en la salida',!/r\[3\]/.test(gs.slice(gs.indexOf('function dash_leerMalla'),gs.indexOf('function dash_validarRespuesta_')))&&!/userName/.test(gs));
 t('I2 el código no contiene correos ni nombres reales (repositorio público) y la zona es fija (sin Utilities.formatDate con la zona del script para decidir fechas)',!/[A-Za-z0-9._-]+@(?!x\.co|pibox)[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(gs.replace(/cuenta@servicio\.example/g,''))&&!/Session\.getScriptTimeZone/.test(gs));
 t('I3 el cliente aplica la misma regla de «entrada = salida sin novedad» que el servidor',/if\(!r\.novedad&&r\.scheduledStart\.getTime\(\)===r\.scheduledEnd\.getTime\(\)\)return;/.test(html)&&/s === f\) \{ res\.ignoradasEntradaIgualSalida/.test(gs));
 t('I4 versión 19.13 en index.html',/const APP_VERSION='19\.13';/.test(html));
}

// ═══ J. Almuerzo (v19.13): agentes_almuerzo = agentes programados en su franja de almuerzo, aparte ═══
{
 const F=(u,ini,fin,alm,linea='L1',iso='2026-11-17',novedad='')=>({iso,usuario:u,rol:'Op',inicio:ini,fin,linea,novedad,almuerzo:alm});
 const C=(malla,desde='2026-11-17',hasta='2026-11-17')=>w.call('dash_calcular',{now:NOW,desdeISO:desde,hastaISO:hasta,malla,turnos:[],admins:{}});
 const v=(c,L,h,col=8,d='2026-11-17')=>{const f=c.filas.filter(x=>x[0]===d&&x[3]===L&&x[1]===h)[0];return f?f[col]:undefined;};
 // J1 turno normal
 const n=C([F('a@x.co','8:00:00','16:00:00','12:00 - 13:00'),F('b@x.co','8:00:00','16:00:00','11:30 - 12:30')]);
 t('J1 turno normal 8–16 con almuerzo 12:00 - 13:00 (a) y 11:30 - 12:30 (b): a las 11 → 0,5; a las 12 → 1,5; a las 13 → 0; en la línea igual que en TODAS',
  v(n,'TODAS',11)===0.5&&v(n,'TODAS',12)===1.5&&v(n,'TODAS',13)===0&&v(n,'TODAS',10)===0&&v(n,'L1',12)===1.5&&n.resumen.filasConAlmuerzo===2,[v(n,'TODAS',11),v(n,'TODAS',12),v(n,'TODAS',13)]);
 const sinAlm=C([F('a@x.co','8:00:00','16:00:00',''),F('b@x.co','8:00:00','16:00:00','')]);
 t('J2 agentes_programados y agentes_reales NO cambian con el almuerzo (a las 12 siguen 2 programados): la hoja sin franjas y con franjas solo difiere en la columna de almuerzo',
  v(n,'TODAS',12,4)===2&&JSON.stringify(n.filas.map(x=>x.slice(0,8)))===JSON.stringify(sinAlm.filas.map(x=>x.slice(0,8)))&&sinAlm.filas.every(x=>x[8]===0));
 // J3 turno nocturno
 const nn=C([F('n@x.co','22:00:00','6:00:00','2:00 - 3:00','L1','2026-11-16'),F('m@x.co','20:00:00','4:00:00','23:30 - 0:30','L1','2026-11-16'),F('z@x.co','','','','L1','2026-11-17','Vacaciones')],'2026-11-16','2026-11-17'); // el 17 necesita una fila en la malla para escribirse (como D1)
 t('J3 turno nocturno 22–06 del lunes 16 con almuerzo 2:00 - 3:00: la franja cae antes de la entrada → es del martes 17 a las 2 (no del lunes)',v(nn,'TODAS',2,8,'2026-11-17')===1&&v(nn,'TODAS',2,8,'2026-11-16')===0&&v(nn,'TODAS',3,8,'2026-11-17')===0);
 t('J4 franja que cruza la medianoche (23:30 - 0:30) en un turno 20–04: 0,5 a las 23 del lunes y 0,5 a las 0 del martes',v(nn,'TODAS',23,8,'2026-11-16')===0.5&&v(nn,'TODAS',0,8,'2026-11-17')===0.5);
 // J5 franja vacía / 0:00:00
 const vac=C([F('a@x.co','8:00:00','16:00:00',''),F('b@x.co','8:00:00','16:00:00','0:00:00'),F('c@x.co','8:00:00','16:00:00','  ')]);
 t('J5 franja vacía, «0:00:00» o solo espacios = sin almuerzo: 0 en todas las horas, contadas como «sin almuerzo» y no como mal escritas',vac.filas.every(x=>x[8]===0)&&vac.resumen.filasSinAlmuerzo===3&&vac.resumen.almuerzoMalEscrito===0);
 // J6 mal escrita
 const mal=C([F('a@x.co','8:00:00','16:00:00','12-13'),F('b@x.co','8:00:00','16:00:00','12:00 a 13:00'),F('c@x.co','8:00:00','16:00:00','25:00 - 26:00'),F('d@x.co','8:00:00','16:00:00','12:00 - 12:00'),F('e@x.co','8:00:00','16:00:00','12:00:00 – 13:00:00')]);
 t('J6 mal escritas («12-13», «12:00 a 13:00», «25:00 - 26:00», «12:00 - 12:00») se ignoran y se cuentan; con segundos y guion largo sí vale',mal.resumen.almuerzoMalEscrito===4&&mal.resumen.filasConAlmuerzo===1&&v(mal,'TODAS',12)===1&&mal.resumen.almuerzoMalEscritoEjemplos.length===4,mal.resumen);
 const wl=mundo();wl.call('dash_logResumen_',{desde:'2026-11-17',hasta:'2026-11-17',malla:{minIso:'x',maxIso:'y'},turnosLeidos:0,resumen:mal.resumen,escrito:null});
 t('J7 el log dice cuántas franjas están mal escritas (y ejemplos del texto, sin nombres)',wl.logs.some(l=>/4 MAL ESCRITAS \(ignoradas\): «12-13»/.test(l))&&!wl.logs.some(l=>/@/.test(l)),wl.logs.filter(l=>/Almuerzo/.test(l)));
 // J8 dentro del turno
 const fu=C([F('a@x.co','8:00:00','12:00:00','14:00 - 15:00'),F('b@x.co','8:00:00','12:00:00','11:30 - 12:30'),F('c@x.co','8:00:00','16:00:00','7:00 - 7:30')]);
 t('J8 solo cuenta lo que queda dentro del turno: 14–15 en un turno 8–12 no cuenta (fuera); 11:30–12:30 se recorta a 11:30–12:00; 7:00 antes de la entrada pasa al día siguiente y queda fuera',
  v(fu,'TODAS',14)===0&&v(fu,'TODAS',11)===0.5&&v(fu,'TODAS',12)===0&&v(fu,'TODAS',7)===0&&fu.resumen.almuerzoFueraDelTurno===2&&fu.resumen.almuerzoRecortado===1,fu.resumen);
 // J9 una sola vez por agente, en la línea y en TODAS
 const un=C([F('a@x.co','8:00:00','16:00:00','12:00 - 13:00','L1'),F('a@x.co','10:00:00','14:00:00','12:00 - 13:00','L1'),F('b@x.co','8:00:00','16:00:00','12:00 - 13:00','L1'),F('b@x.co','9:00:00','15:00:00','12:00 - 13:00','L2')]);
 t('J9 cada agente cuenta UNA vez: a con dos filas solapadas en L1 → 1; b en L1 y L2 → 1 en cada línea; TODAS = 2 (no 4)',v(un,'L1',12)===2&&v(un,'L2',12)===1&&v(un,'TODAS',12)===2);
 // J10 filas que no cuentan como programadas no aportan almuerzo; las futuras sí (es programado)
 const nv=w.call('dash_calcular',{now:NOW,desdeISO:'2026-11-21',hastaISO:'2026-11-22',admins:{'adm@x.co':true},turnos:[],malla:[
  F('v@x.co','8:00:00','16:00:00','12:00 - 13:00','L1','2026-11-21','Vacaciones'),F('adm@x.co','8:00:00','16:00:00','12:00 - 13:00','L1','2026-11-21'),
  F('s@x.co','8:00:00','16:00:00','12:00 - 13:00','Storage','2026-11-21'),F('f@x.co','8:00:00','16:00:00','17:00 - 18:00','L1','2026-11-22'),F('h@x.co','8:00:00','16:00:00','12:00 - 13:00','L1','2026-11-21')]});
 t('J10 novedad, admins y Storage no aportan almuerzo (solo h a las 12 del sábado = 1); el domingo futuro sí lleva el almuerzo programado (como los programados), aunque reales quede vacío',
  v(nv,'TODAS',12,8,'2026-11-21')===1&&v(nv,'TODAS',15,8,'2026-11-22')===0&&nv.filas.filter(x=>x[0]==='2026-11-22'&&x[3]==='TODAS').every(x=>x[5]==='')&&v(nv,'TODAS',12,8,'2026-11-22')===0&&(()=>{const c=C([F('f@x.co','8:00:00','16:00:00','12:00 - 13:00','L1','2026-11-22')],'2026-11-22','2026-11-22');return c.filas.filter(x=>x[0]==='2026-11-22'&&x[3]==='TODAS'&&x[1]===12)[0][8]===1;})());
 // J11 lectura de la malla: columna H
 const wm=mundo({mallaFilas:mallaDe(['2026-11-17'],[['a@x.co','L1','Op','8:00:00','16:00:00','','12:00 - 13:00']])});
 const ml=wm.call('dash_leerMalla','2026-11-17');
 t('J11 dash_leerMalla lee la franja de la columna H (sin nombres)',ml.rows[0].almuerzo==='12:00 - 13:00'&&!('nombre' in ml.rows[0]));
 // J12 encabezado
 t('J12 agentes_almuerzo va al FINAL, después de estado (las 8 columnas de antes no se mueven)',JSON.stringify(w.ctx.DASH.ENCABEZADOS)===JSON.stringify(ENC));
 const wv=mundo({props:{malla_sheet_id:'SHEET',dash_sheet_id:'X'}});const hv=hojaFalsa();hv.st.filas[0]=ENC.slice(0,8);wv.hojas['X|conteos']=hv;
 let e8='';try{wv.call('dash_hoja');}catch(e){e8=e.message;}
 const wv2=mundo({props:{malla_sheet_id:'SHEET',dash_sheet_id:'X'},mallaFilas:mallaDe(SEMANA.slice(0,6),DEF.slice(0,2)),now:BOG('2026-11-21',15,30)});wv2.hojas['X|conteos']=hv;
 const fotoV=JSON.stringify(hv.st.filas);wv2.call('dashboardActualizar');
 t('J13 con la hoja vieja (sin «agentes_almuerzo» en I1) la v19.13 NO escribe nada y avisa: dice qué columna falta',/columna 9: «» en vez de «agentes_almuerzo»/.test(e8)&&JSON.stringify(hv.st.filas)===fotoV&&wv2.sent.length===1,e8);
 const hn=hojaFalsa();wv2.hojas['X|conteos']=hn;wv2.props.dash_fail_notified_at='0';wv2.call('dashboardActualizar');
 const dn=datosHoja(hn);
 t('J14 con I1 = «agentes_almuerzo» escribe las 9 columnas',dn.length>0&&dn.every(x=>x.length===9&&typeof x[8]==='number'));
}

const fails=out.filter(l=>l.startsWith('FAIL'));console.log(out.join('\n'));console.log('\n'+(out.length-fails.length)+'/'+out.length+' pruebas OK'+(fails.length?'  —  '+fails.length+' FALLAN':''));process.exit(fails.length?1:0);
