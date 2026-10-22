// Uso: node test/pigops_reglamento_test.js   (sin red, sin Google, sin Firestore: todo simulado; no escribe nada en producción)
// Reglamento Interno (v18.5): plazo de justificación de 3 días hábiles, llamados de atención (falta leve), notificación de
// falta grave a Talento Humano, modo prueba e idempotencia. Carga el código REAL de PiGOps_Reglamento.gs (y de
// PiGOps_Notificaciones_v5.gs, del que depende) en un contexto vm; las dependencias de IO entran por `deps` falsos.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const GS=fs.readFileSync(path.join(root,'PiGOps_Reglamento.gs'),'utf8');
const GS0=fs.readFileSync(path.join(root,'PiGOps_Notificaciones_v5.gs'),'utf8');
const HTML=fs.readFileSync(path.join(root,'index.html'),'utf8');
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));

// ── contexto con las funciones de Apps Script ──
const ctx={console,Logger:{log(){}},Date,Math,JSON,Object,Array,String,Number,RegExp,Error,parseInt,Map,Set};
vm.createContext(ctx);
vm.runInContext(GS0,ctx);vm.runInContext(GS,ctx);
const R=n=>ctx[n];
const REG=vm.runInContext('REG',ctx),FEST=vm.runInContext('FESTIVOS_CO',ctx);

// ═══ Calendario: días hábiles y festivos ═══
t('C1 tardanza el viernes 6-nov-2026: el plazo vence el miércoles 11-nov',R('reg_fechaLimite')('2026-11-06')==='2026-11-11');
t('C2 el plazo que cruza un festivo no lo cuenta (viernes 13-nov, festivo lun 16-nov → jueves 19-nov)',R('reg_fechaLimite')('2026-11-13')==='2026-11-19');
t('C3 tardanza un sábado (7-nov): lun, mar, mié → 11-nov',R('reg_fechaLimite')('2026-11-07')==='2026-11-11');
t('C4 festivo cruzando fin de año (29-dic-2026 mar → 1-ene-2027 festivo): vence el lunes 4-ene-2027',R('reg_fechaLimite')('2026-12-29')==='2027-01-04');
t('C5 sábados, domingos y festivos no son hábiles; lunes normal sí',!R('reg_esHabil')('2026-11-07')&&!R('reg_esHabil')('2026-11-08')&&!R('reg_esHabil')('2026-11-16')&&R('reg_esHabil')('2026-11-09'));
// Festivos: calculados con Pascua + Ley Emiliani y comparados con la lista
function pascua(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mes=Math.floor((h+l-7*m+114)/31),dia=((h+l-7*m+114)%31)+1;return new Date(Date.UTC(y,mes-1,dia));}
const iso=d=>d.toISOString().slice(0,10),add=(d,n)=>new Date(d.getTime()+n*86400000);
const aLunes=d=>{const w=d.getUTCDay();return w===1?d:add(d,(8-w)%7||7);};
function festivos(y){const U=(m,d)=>new Date(Date.UTC(y,m-1,d)),P=pascua(y);
 return [U(1,1),aLunes(U(1,6)),aLunes(U(3,19)),add(P,-3),add(P,-2),U(5,1),aLunes(add(P,39)),aLunes(add(P,60)),aLunes(add(P,68)),aLunes(U(6,29)),U(7,20),U(8,7),aLunes(U(8,15)),aLunes(U(10,12)),aLunes(U(11,1)),aLunes(U(11,11)),U(12,8),U(12,25)].map(iso).sort();}
t('C6 FESTIVOS_CO del .gs coincide con el cálculo (Pascua + Ley Emiliani) para 2026 y 2027',JSON.stringify(FEST.slice().sort())===JSON.stringify([...festivos(2026),...festivos(2027)].sort()),{falta:[...festivos(2026),...festivos(2027)].filter(x=>!FEST.includes(x)),sobra:FEST.filter(x=>![...festivos(2026),...festivos(2027)].includes(x))});
const htmlFest=(HTML.match(/const FESTIVOS_CO=\[([\s\S]*?)\];/)||[])[1];
t('C7 la lista de festivos de index.html es idéntica a la del .gs',htmlFest&&JSON.stringify((htmlFest.match(/\d{4}-\d{2}-\d{2}/g)||[]).sort())===JSON.stringify(FEST.slice().sort()));
t('C8 ventana de 3 meses: tardanza del 10-feb-2027 mira desde el 1-dic-2026; en nov-2026 nunca antes del 1-nov',R('reg_inicioVentana')('2027-02-10')==='2026-12-01'&&R('reg_inicioVentana')('2026-11-20')==='2026-11-01');

// ═══ Mundo simulado ═══
const BOG=(iso,h,mi)=>{const p=iso.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2],h+5,mi,0));}; // hora local de Bogotá → Date
const D=iso=>{const p=iso.split('-');return `${+p[2]}/${+p[1]}/${p[0]}`;}; // DD/MM/YYYY para la malla
function world(o={}){
 const w={sent:[],pdfs:[],soportes:[],db:{reglamento_casos:{},strike_waivers:{},strike_appeals:{}},creates:0,updates:0,
  now:o.now||BOG('2026-11-12',7,0),modoPrueba:o.modoPrueba!==undefined?o.modoPrueba:false,malla:[],turnos:[],
  agentes:{'ana@pibox.app':{nombre:'Ana Uno',cargo:'Agente de Operaciones',cedula:'123',liderEmail:'jefe@pibox.app'}}};
 w.tardanza=(iso,progH,progM,min,email='ana@pibox.app')=>{ // programado progH:progM, inicia min minutos tarde
  w.malla.push({fecha:D(iso),usuario:email,inicio:`${progH}:${String(progM).padStart(2,'0')}:00`,fin:'16:00:00',novedad:'',lider:'jefe@pibox.app'});
  w.turnos.push({userEmail:email,status:'ended',startTime:new Date(BOG(iso,progH,progM).getTime()+min*60000),endTime:BOG(iso,17,0)});};
 w.deps=()=>({
  now:()=>w.now,
  config:()=>({modoPrueba:w.modoPrueba,thEmail:'th@pibox.app',firmanteNombre:'Camilo Romero',firmanteCargo:'Gerente de Operaciones',testEmail:'cromero@pibox.app',templateId:'TPL'}),
  leerMalla:()=>w.malla,leerTurnos:()=>w.turnos,agentes:()=>w.agentes,
  listar:c=>JSON.parse(JSON.stringify(w.db[c]||{})),
  crear:(c,id,obj)=>{w.db[c]=w.db[c]||{};if(w.db[c][id])return false;w.db[c][id]=JSON.parse(JSON.stringify(obj));w.creates++;return true;},
  actualizar:(c,id,obj)=>{w.db[c][id]=Object.assign(w.db[c][id]||{},JSON.parse(JSON.stringify(obj)));w.updates++;},
  enviarCorreo:m=>w.sent.push(m),
  generarPdfLlamado:d=>{w.pdfs.push(d);return{blob:{name:'llamado.pdf'},url:'https://drive/pdf/'+w.pdfs.length};},
  generarSoporte:d=>{w.soportes.push(d);return{blob:{name:'soporte.xlsx'},url:'https://drive/xlsx/'+w.soportes.length};}});
 w.correr=(opts,now)=>{if(now)w.now=now;return R('reg_correr')(w.deps(),opts);};
 w.diario=now=>w.correr({avisos:true,plazos:true},now);
 w.avisos=now=>w.correr({avisos:true,plazos:false},now);
 w.casos=()=>Object.values(w.db.reglamento_casos);
 w.waive=(iso,email='ana@pibox.app')=>{w.db.strike_waivers[`${email}_${iso.replace(/-/g,'')}_tardanza`]={cat:'tardanza',userEmail:email};};
 w.appeal=(iso,status,createdAt,email='ana@pibox.app')=>{w.db.strike_appeals[`${email}_${iso.replace(/-/g,'')}_tardanza`]={status,createdAt,userEmail:email};};
 return w;}
const para=w=>w.sent.map(m=>m.to);
const to=m=>String(m.to);

// ═══ Detección ═══
{const w=world();w.tardanza('2026-10-30',8,0,20);w.tardanza('2026-11-02',8,0,5);w.tardanza('2026-11-03',8,0,6);
 const tds=R('reg_detectarTardanzas')(w.malla,w.turnos);
 t('D1 antes del 1-nov-2026 no hay tardanza del Reglamento; 5 min exactos tampoco; 6 min sí',tds.length===1&&tds[0].iso==='2026-11-03'&&tds[0].minutos===6,tds);
 const w2=world();w2.tardanza('2026-11-04',8,0,14);w2.malla[0].novedad='INCAPACIDAD';
 t('D2 un día con novedad en la malla no genera tardanza',R('reg_detectarTardanzas')(w2.malla,w2.turnos).length===0);
 const w3=world();w3.tardanza('2026-11-04',8,0,14);const t3=R('reg_detectarTardanzas')(w3.malla,w3.turnos)[0];
 t('D3 hora programada 8:00 a. m., inicio 8:14 a. m., 14 minutos (hora de Bogotá)',t3.progTexto==='8:00 a. m.'&&t3.inicioTexto==='8:14 a. m.'&&t3.minutos===14,t3);
 const w4=world();w4.tardanza('2026-11-04',14,0,30);const t4=R('reg_detectarTardanzas')(w4.malla,w4.turnos)[0];
 t('D4 turno de la tarde: 2:00 p. m. → 2:30 p. m.',t4.progTexto==='2:00 p. m.'&&t4.inicioTexto==='2:30 p. m.');}

// ═══ Escenarios pedidos ═══
{ // 1.ª tardanza sin justificar → llamado al agente con las copias correctas
 const w=world();w.tardanza('2026-11-04',8,0,14);
 w.avisos(BOG('2026-11-04',8,20));
 t('E1a al detectar la tardanza se crea el registro «En plazo de justificación» con fecha límite y UN aviso al agente',w.casos().length===1&&w.casos()[0].estado==='En plazo de justificación'&&w.casos()[0].limiteISO==='2026-11-09'&&w.sent.length===1&&to(w.sent[0])==='ana@pibox.app',[w.casos(),w.sent.length]);
 t('E1b el aviso trae la fecha límite (9 de noviembre) y el enlace a Pi GOps',/9 de noviembre de 2026/.test(w.sent[0].html)&&/cromero-cmd\.github\.io\/Pibox-GOps/.test(w.sent[0].html));
 w.avisos(BOG('2026-11-04',8,35));w.avisos(BOG('2026-11-04',8,50));
 t('E1c el disparador de 15 min no repite el aviso (idempotente)',w.sent.length===1);
 w.diario(BOG('2026-11-09',7,0));
 t('E1d el último día del plazo (lunes 9-nov, 7:00) todavía NO se envía el llamado',w.sent.length===1&&w.pdfs.length===0);
 w.diario(BOG('2026-11-10',7,0));
 const m=w.sent[1];
 t('E1e vencido el plazo (martes 10-nov 7:00) sale el llamado: para el agente, copia al líder, a TH y a cromero, con el PDF adjunto',w.sent.length===2&&to(m)==='ana@pibox.app'&&m.cc==='jefe@pibox.app,th@pibox.app,cromero@pibox.app'&&m.attachments.length===1&&m.attachments[0].name==='llamado.pdf',m&&{to:m.to,cc:m.cc});
 t('E1f el párrafo de la falta trae fecha, programada, registrada y minutos (texto del ejemplo)',w.pdfs[0].faltas.length===1&&w.pdfs[0].faltas[0]==='El día 4 de noviembre de 2026, su turno estaba programado para iniciar a las 8:00 a. m. y el inicio se registró en Pi GOps a las 8:14 a. m., con 14 minutos de retardo, sin justificación aprobada dentro del plazo de 3 días hábiles.',w.pdfs[0].faltas);
 t('E1g el PDF lleva nombre, cargo, firmante y cargo del firmante de la configuración',w.pdfs[0].nombre==='Ana Uno'&&w.pdfs[0].cargo==='Agente de Operaciones'&&w.pdfs[0].firmante==='Camilo Romero'&&w.pdfs[0].cargoFirmante==='Gerente de Operaciones'&&w.pdfs[0].fecha==='10 de noviembre de 2026',w.pdfs[0]);
 const c=w.casos()[0];
 t('E1h el registro queda «Enviado» con fecha de envío y enlace al PDF, tipo llamado n.º 1',c.estado==='Enviado'&&c.tipo==='llamado'&&c.numeroEnVentana===1&&c.pdfUrl==='https://drive/pdf/1'&&!!c.enviadoAt,c);
 // el disparador diario corre otra vez el mismo día (y otro día): UN solo envío
 const antes=w.sent.length;w.diario(BOG('2026-11-10',7,0));w.diario(BOG('2026-11-10',19,0));w.diario(BOG('2026-11-11',7,0));
 t('E1i el disparador corre varias veces: no se vuelve a enviar el llamado ni el aviso',w.sent.length===antes&&w.pdfs.length===1,w.sent.length);}
{ // 2.ª tardanza = también llamado (n.º 2)
 const w=world();w.tardanza('2026-11-04',8,0,14);w.tardanza('2026-11-05',8,0,20);
 w.diario(BOG('2026-11-12',7,0));
 const ll=w.casos().filter(c=>c.tipo==='llamado');
 t('E2 la 1.ª y la 2.ª tardanza de la ventana son faltas leves (n.º 1 y 2 en la ventana)',ll.length===2&&ll.map(c=>c.numeroEnVentana).sort().join()==='1,2',ll.map(c=>c.numeroEnVentana));
 t('E2b dos tardanzas que vencen el mismo día generan UN solo llamado (un PDF, un correo) con DOS párrafos',w.pdfs.length===1&&w.pdfs[0].faltas.length===2&&/día 4 de noviembre/.test(w.pdfs[0].faltas[0])&&/día 5 de noviembre/.test(w.pdfs[0].faltas[1])&&w.sent.filter(m=>/^Llamado de atención/.test(m.subject)).length===1,[w.pdfs.length,w.pdfs[0]&&w.pdfs[0].faltas]);
 t('E2c …los dos registros comparten llamadoId y enlace, y cuentan como UN llamado (n.º 1)',ll.every(c=>c.llamadoId===ll[0].llamadoId&&c.pdfUrl===ll[0].pdfUrl&&c.llamadoNumero===1)&&R('reg_llamadosVigentes')(Object.fromEntries(ll.map(c=>[c.fechaISO,c])),'ana@pibox.app','2026-11-12',false).length===1);
 t('E2d el correo del llamado cita la causal literal del art. 59 num. 1 y el PDF recibe la causal',/Artículo 59, numeral 1: El retardo injustificado en la hora de entrada, hasta por segunda vez\./.test(w.sent.find(m=>/^Llamado/.test(m.subject)).html)&&w.pdfs[0].causal===REG.CAUSAL_LEVE);
 // dos llamados en días distintos (vencen en días distintos) siguen siendo dos llamados
 const w2=world();w2.tardanza('2026-11-04',8,0,14);w2.tardanza('2026-11-06',8,0,20);
 w2.diario(BOG('2026-11-10',7,0));w2.diario(BOG('2026-11-12',7,0));
 t('E2e tardanzas que vencen en días distintos: dos llamados separados (n.º 1 y n.º 2)',w2.pdfs.length===2&&w2.pdfs[0].faltas.length===1&&w2.casos().map(c=>c.llamadoNumero).sort().join()==='1,2',w2.casos().map(c=>c.llamadoNumero));}
{ // justificación aprobada dentro del plazo: no se envía nada
 const w=world();w.tardanza('2026-11-04',8,0,14);w.waive('2026-11-04');
 w.avisos(BOG('2026-11-04',8,20));w.diario(BOG('2026-11-10',7,0));w.diario(BOG('2026-11-12',7,0));
 t('J1 justificación aprobada: no se envía aviso, ni llamado, ni nada; el registro queda «Justificado»',w.sent.length===0&&w.casos()[0].estado==='Justificado',[w.sent.length,w.casos()]);
 const w2=world();w2.tardanza('2026-11-04',8,0,14);w2.avisos(BOG('2026-11-04',8,20));
 w2.appeal('2026-11-04','approved','2026-11-05T15:00:00.000Z');w2.waive('2026-11-04');w2.diario(BOG('2026-11-10',7,0));
 t('J2 se avisó al detectar y luego se aprobó la justificación: al vencer el plazo no se envía nada más',w2.sent.length===1&&w2.pdfs.length===0&&w2.casos()[0].estado==='Justificado');}
{ // apelación pendiente al vencer el plazo: espera; luego rechazada → se confirma
 const w=world();w.tardanza('2026-11-04',8,0,14);
 w.appeal('2026-11-04','pending','2026-11-06T15:00:00.000Z'); // presentada a tiempo (límite 9-nov)
 w.diario(BOG('2026-11-10',7,0));w.diario(BOG('2026-11-12',7,0));
 t('A1 apelación presentada a tiempo y sin resolver: el envío espera (ningún llamado) y el registro sigue en plazo',w.pdfs.length===0&&w.casos()[0].estado==='En plazo de justificación'&&/Apelación pendiente/.test(w.casos()[0].espera),w.casos()[0]);
 w.db.strike_appeals['ana@pibox.app_20261104_tardanza'].status='rejected';
 w.diario(BOG('2026-11-13',7,0));
 t('A2 apelación rechazada: la falta se confirma y sale el llamado (texto indica que la justificación no fue aprobada)',w.pdfs.length===1&&/sin que la justificación presentada fuera aprobada/.test(w.pdfs[0].faltas[0]),w.pdfs[0]&&w.pdfs[0].faltas);
 const w3=world();w3.tardanza('2026-11-04',8,0,14);w3.appeal('2026-11-04','pending','2026-11-11T15:00:00.000Z'); // presentada FUERA de plazo
 w3.diario(BOG('2026-11-12',7,0));
 t('A3 una apelación presentada después del plazo no detiene la confirmación',w3.pdfs.length===1);}
{ // 3.ª tardanza justificada dentro del plazo: no se envía nada (las 2 primeras sí son llamados)
 const w=world();w.tardanza('2026-11-03',8,0,10);w.tardanza('2026-11-04',8,0,12);w.tardanza('2026-11-05',8,0,15);w.waive('2026-11-05');
 w.diario(BOG('2026-11-13',7,0));
 t('G1 3.ª tardanza justificada en plazo: no sale notificación a TH y no cuenta (solo el llamado de las dos primeras)',w.soportes.length===0&&w.pdfs.length===1&&w.pdfs[0].faltas.length===2&&!w.sent.some(m=>/Falta grave/.test(m.subject)),w.sent.map(m=>m.subject));}
{ // 3.ª tardanza sin justificar: notificación a TH con soporte; NO al agente; sin llamado
 const w=world();w.tardanza('2026-11-03',8,0,10);w.tardanza('2026-11-04',8,0,12);w.tardanza('2026-11-05',8,0,15);
 w.diario(BOG('2026-11-13',7,0));
 const fg=w.sent.filter(m=>/^Falta grave para descargos/.test(m.subject));
 t('G2a 3.ª tardanza sin justificar: UNA notificación «Falta grave para descargos — Ana Uno»',fg.length===1&&fg[0].subject==='Falta grave para descargos — Ana Uno',w.sent.map(m=>m.subject));
 const m=fg[0];
 t('G2b va a Talento Humano con copia al líder y a cromero; nada al agente',to(m)==='th@pibox.app'&&m.cc==='jefe@pibox.app,cromero@pibox.app'&&!w.sent.some(x=>/ana@pibox\.app/.test(to(x)+(x.cc||''))&&/Falta grave/.test(x.subject)),{to:m.to,cc:m.cc});
 t('G2c adjunta el Excel de soporte',m.attachments.length===1&&m.attachments[0].name==='soporte.xlsx');
 t('G2d trae nombre, cargo, líder, causal (art. 60 num. 2), detalle de las 3 tardanzas, llamados previos con enlace y la línea de cierre del art. 64',
  /Ana Uno/.test(m.html)&&/Agente de Operaciones/.test(m.html)&&/jefe@pibox\.app/.test(m.html)&&/Artículo 60, numeral 2/.test(m.html)&&/03\/11\/2026/.test(m.html)&&/04\/11\/2026/.test(m.html)&&/05\/11\/2026/.test(m.html)&&/https:\/\/drive\/pdf\/1/.test(m.html)&&
  /Solicitamos agendar la diligencia de descargos según el procedimiento del art\. 64 del Reglamento Interno de Trabajo\./.test(m.html));
 t('G2e las dos primeras generan UN llamado al agente (2 párrafos) y la 3.ª NO genera llamado de atención',w.pdfs.length===1&&w.pdfs[0].faltas.length===2&&w.casos().filter(c=>c.tipo==='llamado'&&c.estado==='Enviado').length===2);
 const c3=w.db.reglamento_casos['ana@pibox.app_20261105_reg'];
 t('G2f el caso pasa a «Enviado» (a Talento Humano) con enlace al soporte y tipo falta_grave',c3.estado==='Enviado'&&c3.tipo==='falta_grave'&&c3.causal==='art60_2'&&c3.soporteUrl==='https://drive/xlsx/1',c3);
 const antes=w.sent.length;w.diario(BOG('2026-11-13',7,0));w.diario(BOG('2026-11-16',7,0));w.diario(BOG('2026-11-17',7,0));
 t('G2g el disparador vuelve a correr: no se repite la notificación a Talento Humano',w.sent.length===antes&&w.soportes.length===1);
 const sop=w.soportes[0];
 t('G2h el soporte lleva las 3 tardanzas y el llamado previo (con las fechas de sus 2 faltas)',sop.tardanzas.length===3&&sop.llamados.length===1&&sop.llamados[0].fechas.length===2,[sop.tardanzas.length,sop.llamados.length]);
 t('G2i la notificación cita el texto literal del art. 60 num. 2 y la causal viaja en el soporte',/Artículo 60, numeral 2: El retardo injustificado en la hora de entrada, por tercera vez\./.test(m.html)&&sop.causal===REG.CAUSAL_602);}
{ // la 3.ª espera a que se resuelva una anterior pendiente
 const w=world();w.tardanza('2026-11-03',8,0,10);w.tardanza('2026-11-04',8,0,12);w.tardanza('2026-11-05',8,0,15);
 w.appeal('2026-11-03','pending','2026-11-04T15:00:00.000Z');
 w.diario(BOG('2026-11-13',7,0));
 t('G3 con una tardanza anterior en apelación pendiente, las siguientes esperan (su número de orden aún puede cambiar)',w.sent.filter(m=>/^Falta grave/.test(m.subject)).length===0&&w.pdfs.length===0,[w.sent.length,w.pdfs.length]);
 w.waive('2026-11-03');w.db.strike_appeals['ana@pibox.app_20261103_tardanza'].status='approved';
 w.diario(BOG('2026-11-16',7,0)); // lunes 16 festivo: no es día hábil
 t('G3b en festivo el proceso diario no envía nada',w.pdfs.length===0&&w.soportes.length===0);
 w.diario(BOG('2026-11-17',7,0));
 t('G3c resuelta la anterior (justificada): la 2.ª y la 3.ª ahora son 1.ª y 2.ª → un llamado con dos párrafos, sin falta grave',w.pdfs.length===1&&w.pdfs[0].faltas.length===2&&w.soportes.length===0,[w.pdfs.length,w.soportes.length]);}
{ // 4.ª tardanza en adelante: también falta grave (art. 60.2)
 const w=world();['2026-11-03','2026-11-04','2026-11-05','2026-11-06'].forEach((d,i)=>w.tardanza(d,8,0,10+i));
 w.diario(BOG('2026-11-17',7,0));
 const gr=w.sent.filter(m=>/Falta grave para descargos/.test(m.subject));
 t('G4 la 3.ª tardanza notifica «Falta grave para descargos» y la 4.ª «Reincidencia — Falta grave para descargos — Ana Uno»; un solo llamado',gr.length===2&&gr.some(m=>m.subject==='Falta grave para descargos — Ana Uno')&&gr.some(m=>m.subject==='Reincidencia — Falta grave para descargos — Ana Uno')&&w.pdfs.length===1,gr.map(m=>m.subject));
 const rei=gr.find(m=>/^Reincidencia/.test(m.subject));
 t('G4b la reincidencia referencia el caso abierto por la 3.ª tardanza (fecha, envío y soporte), va a TH con el Excel y no al agente',/Reincidencia\./.test(rei.html)&&/3\.ª tardanza \(05\/11\/2026\)/.test(rei.html)&&/https:\/\/drive\/xlsx\/1/.test(rei.html)&&to(rei)==='th@pibox.app'&&rei.attachments.length===1&&!/ana@pibox\.app/.test(rei.cc||''),rei&&rei.html.slice(0,0));
 const c4=w.db.reglamento_casos['ana@pibox.app_20261106_reg'];
 t('G4c el registro de la 4.ª queda como reincidencia con referencia al caso abierto',c4.reincidencia===true&&c4.casoAbiertoId==='ana@pibox.app_20261105_reg'&&c4.estado==='Enviado',c4);
 // 4.ª tardanza en otro día: también referencia el caso ya abierto
 const w5=world();['2026-11-03','2026-11-04','2026-11-05'].forEach((d,i)=>w5.tardanza(d,8,0,10+i));w5.diario(BOG('2026-11-13',7,0));
 w5.tardanza('2026-11-17',8,0,30);w5.diario(BOG('2026-11-23',7,0));
 const rei5=w5.sent.filter(m=>/^Reincidencia/.test(m.subject));
 t('G4d una 4.ª tardanza posterior (17-nov) envía la reincidencia referenciando el caso abierto del 5-nov',rei5.length===1&&/05\/11\/2026/.test(rei5[0].html),w5.sent.map(m=>m.subject));
 // caso cerrado por un admin: no se pisa ni se reenvía
 w5.db.reglamento_casos['ana@pibox.app_20261105_reg'].estado='Cerrado';w5.db.reglamento_casos['ana@pibox.app_20261105_reg'].cerradoPor='cromero@pibox.app';
 const n5=w5.sent.length;w5.diario(BOG('2026-11-24',7,0));
 t('G4e un caso «Cerrado» por un admin es definitivo: no se reenvía ni se sobrescribe, y sigue contando para el orden',w5.sent.length===n5&&w5.db.reglamento_casos['ana@pibox.app_20261105_reg'].estado==='Cerrado'&&w5.db.reglamento_casos['ana@pibox.app_20261105_reg'].cerradoPor==='cromero@pibox.app');}
{ // turnos sin cierre no son falta bajo ninguna regla
 const w=world();
 w.malla.push({fecha:D('2026-11-04'),usuario:'ana@pibox.app',inicio:'8:00:00',fin:'16:00:00',novedad:'',lider:'jefe@pibox.app'});
 w.turnos.push({userEmail:'ana@pibox.app',status:'active',startTime:BOG('2026-11-04',8,0),endTime:null}); // puntual y nunca cerrado
 w.malla.push({fecha:D('2026-11-05'),usuario:'ana@pibox.app',inicio:'8:00:00',fin:'16:00:00',novedad:'',lider:'jefe@pibox.app'});
 w.turnos.push({userEmail:'ana@pibox.app',status:'interrupted',startTime:BOG('2026-11-05',8,3),endTime:null}); // 3 min (dentro de tolerancia), sin cierre
 w.avisos(BOG('2026-11-05',9,0));w.diario(BOG('2026-11-13',7,0));w.diario(BOG('2026-11-17',7,0));
 t('NC1 un turno que quedó sin cerrar (puntual o dentro de la tolerancia) no genera tardanza, falta, registro ni correo',w.sent.length===0&&w.casos().length===0&&w.pdfs.length===0&&w.soportes.length===0,[w.sent.length,w.casos().length]);}
{ // ventana móvil: nov y feb ya no comparten ventana
 const w=world({now:BOG('2027-02-19',7,0)});w.tardanza('2026-11-04',8,0,14);w.tardanza('2027-02-10',8,0,14);
 const f=R('reg_clasificar')(R('reg_detectarTardanzas')(w.malla,w.turnos),{waivers:{},appeals:{},docs:{},now:w.now});
 t('V1 fuera de la ventana de 3 meses la tardanza anterior no cuenta: la de febrero es la 1.ª (llamado)',f[1].n===1&&f[1].tipo==='llamado'&&f[0].n===1,f.map(x=>x.n));}

// ═══ Art. 60 num. 13: 3 llamados vigentes ═══
{const w=world({now:BOG('2026-12-10',7,0)});
 ['2026-11-04','2026-11-20','2026-12-02'].forEach((d,i)=>{w.db.reglamento_casos[`ana@pibox.app_${d.replace(/-/g,'')}_reg`]={tipoRegistro:'tardanza',userEmail:'ana@pibox.app',tipo:'llamado',estado:'Enviado',prueba:false,fechaISO:d,enviadoISO:d,pdfUrl:'https://drive/pdf/x'+i,programada:'8:00 a. m.',inicioReal:'8:10 a. m.',minutos:10,numeroEnVentana:i+1};});
 w.diario(BOG('2026-12-10',7,0));
 const m=w.sent.filter(x=>/^Falta grave/.test(x.subject));
 t('T1 tres llamados vigentes → notificación a TH por el art. 60 num. 13 (con soporte, copia a líder y cromero, nada al agente)',m.length===1&&/numeral 13/.test(m[0].html)&&to(m[0])==='th@pibox.app'&&m[0].attachments.length===1&&!/ana@pibox\.app/.test(m[0].cc||''),m.map(x=>x.subject));
 w.diario(BOG('2026-12-11',7,0));w.diario(BOG('2026-12-14',7,0));
 t('T2 y no se repite en las siguientes ejecuciones',w.sent.filter(x=>/^Falta grave/.test(x.subject)).length===1);
 const w2=world({now:BOG('2026-12-10',7,0)});
 ['2026-11-04','2026-11-20'].forEach((d,i)=>{w2.db.reglamento_casos[`ana@pibox.app_${d.replace(/-/g,'')}_reg`]={tipoRegistro:'tardanza',userEmail:'ana@pibox.app',tipo:'llamado',estado:'Enviado',prueba:false,fechaISO:d,enviadoISO:d};});
 w2.diario(BOG('2026-12-10',7,0));
 t('T3 con 2 llamados vigentes no hay notificación por el 60.13',w2.sent.length===0);
 const w2b=world({now:BOG('2026-12-10',7,0)});
 [['2026-11-04','L1'],['2026-11-05','L1'],['2026-12-02','L2']].forEach(([d,g])=>{w2b.db.reglamento_casos[`ana@pibox.app_${d.replace(/-/g,'')}_reg`]={tipoRegistro:'tardanza',userEmail:'ana@pibox.app',tipo:'llamado',estado:'Enviado',prueba:false,fechaISO:d,enviadoISO:d<'2026-12'?'2026-11-12':d,llamadoId:g};});
 w2b.diario(BOG('2026-12-10',7,0));
 t('T3b un llamado que cubre 2 faltas cuenta como UN solo llamado para el art. 60.13 (3 faltas en 2 llamados → sin notificación)',w2b.sent.length===0,w2b.sent.map(m=>m.subject));
 const w3=world({now:BOG('2027-02-10',7,0)});
 ['2026-11-04','2026-11-20','2026-12-02'].forEach(d=>{w3.db.reglamento_casos[`ana@pibox.app_${d.replace(/-/g,'')}_reg`]={tipoRegistro:'tardanza',userEmail:'ana@pibox.app',tipo:'llamado',estado:'Enviado',prueba:false,fechaISO:d,enviadoISO:d};});
 w3.diario(BOG('2027-02-10',7,0));
 t('T4 llamados fuera de los 3 meses (nov-dic vistos en febrero) ya no son vigentes: no hay notificación',w3.sent.length===0);}

// ═══ Modo prueba ═══
{const w=world({modoPrueba:true});w.tardanza('2026-11-03',8,0,10);w.tardanza('2026-11-04',8,0,12);w.tardanza('2026-11-05',8,0,15);
 w.avisos(BOG('2026-11-03',8,30));w.diario(BOG('2026-11-13',7,0));
 t('P1 modo prueba: TODOS los correos (aviso, llamados y falta grave) van solo a cromero, sin copias',w.sent.length>=4&&w.sent.every(m=>m.to==='cromero@pibox.app'&&!m.cc),w.sent.map(m=>[m.to,m.cc]));
 t('P2 …con «PRUEBA» en el asunto y un banner que dice a quién habría ido',w.sent.every(m=>/^PRUEBA — /.test(m.subject)&&/MODO PRUEBA/.test(m.html))&&/ana@pibox\.app/.test(w.sent.find(m=>/Llamado/.test(m.subject)).html)&&/th@pibox\.app/.test(w.sent.find(m=>/Falta grave/.test(m.subject)).html));
 t('P3 los registros quedan marcados prueba:true',w.casos().filter(c=>c.estado==='Enviado').every(c=>c.prueba===true));
 const n=w.sent.length;w.diario(BOG('2026-11-13',7,0));w.diario(BOG('2026-11-17',7,0));
 t('P4 en modo prueba tampoco se repiten los envíos',w.sent.length===n);
 w.modoPrueba=false;w.diario(BOG('2026-11-18',7,0));
 const reales=w.sent.slice(n);
 t('P5 al pasar a producción los registros de prueba no cuentan: se envían los reales a sus destinatarios',reales.some(m=>m.to==='ana@pibox.app')&&reales.some(m=>m.to==='th@pibox.app')&&reales.every(m=>!/^PRUEBA/.test(m.subject)),reales.map(m=>m.to));
 const n2=w.sent.length;w.diario(BOG('2026-11-19',7,0));
 t('P6 y ya en producción tampoco se repiten',w.sent.length===n2);}

// ═══ Cancelación por un admin ═══
{const w=world();w.tardanza('2026-11-04',8,0,14);w.avisos(BOG('2026-11-04',8,20));
 Object.assign(w.db.reglamento_casos['ana@pibox.app_20261104_reg'],{estado:'Cancelado',motivoCancelacion:'error de malla'});
 w.diario(BOG('2026-11-12',7,0));
 t('X1 un registro cancelado por un admin no se envía nunca',w.pdfs.length===0&&w.sent.length===1&&w.casos()[0].estado==='Cancelado');}

// ═══ Capa Firestore REST y configuración (con UrlFetchApp falso) ═══
{const calls=[];let respuestas=[];
 const c2={...ctx,UrlFetchApp:{fetch:(u,o)=>{calls.push({u,o});const r=respuestas.shift()||{code:200,body:'{}'};return{getResponseCode:()=>r.code,getContentText:()=>r.body};}},ScriptApp:{getOAuthToken:()=>'TOK'}};
 vm.createContext(c2);vm.runInContext(GS0,c2);vm.runInContext(GS,c2);
 respuestas=[{code:200,body:'{}'}];
 t('F1 crear usa la precondición exists=false y devuelve true',c2.reg_crearDoc('reglamento_casos','a b',{x:1,s:'t',b:true})===true&&/currentDocument\.exists=false/.test(calls[0].u)&&/a%20b/.test(calls[0].u));
 respuestas=[{code:409,body:'{"error":{"status":"ALREADY_EXISTS"}}'}];
 t('F2 si el documento ya existía (409) devuelve false: no se pisa ni se reenvía',c2.reg_crearDoc('reglamento_casos','x',{a:1})===false);
 respuestas=[{code:400,body:'{"error":{"status":"FAILED_PRECONDITION"}}'}];
 t('F2b FAILED_PRECONDITION también cuenta como «ya existía»',c2.reg_crearDoc('reglamento_casos','x',{a:1})===false);
 respuestas=[{code:500,body:'boom'}];let err='';try{c2.reg_crearDoc('c','x',{a:1});}catch(e){err=e.message;}
 t('F3 un error real de Firestore lanza (no se da por enviado)',/HTTP 500/.test(err));
 respuestas=[{code:200,body:JSON.stringify({documents:[{name:'p/d/reglamento_casos/id1',fields:{estado:{stringValue:'Enviado'},minutos:{integerValue:'14'},prueba:{booleanValue:true}}}],nextPageToken:'T2'})},{code:200,body:JSON.stringify({documents:[{name:'p/d/reglamento_casos/id2',fields:{estado:{stringValue:'Cancelado'}}}]})}];
 const lst=c2.reg_listarColeccion('reglamento_casos');
 t('F4 listar pagina y decodifica los valores tipados',Object.keys(lst).join()==='id1,id2'&&lst.id1.minutos===14&&lst.id1.prueba===true&&calls[calls.length-1].u.indexOf('pageToken=T2')>0);
 c2.firestoreGetDocRaw=()=>null;c2.PropertiesService={getScriptProperties:()=>({getProperty:k=>({reg_th_email:'th@pibox.app',reg_template_id:'TPL',reg_firmante_cargo:'Gerente'}[k]||null)})};
 t('M1 modo prueba por defecto (sin configuración en Firestore)',c2.reg_config().modoPrueba===true);
 c2.firestoreGetDocRaw=()=>{throw new Error('sin red');};
 t('M2 si Firestore falla al leer el interruptor: modo prueba (lado seguro)',c2.reg_config().modoPrueba===true);
 c2.firestoreGetDocRaw=()=>({fields:{reglamentoModoPrueba:{booleanValue:true}}});
 t('M3 reglamentoModoPrueba=true → prueba',c2.reg_config().modoPrueba===true);
 c2.firestoreGetDocRaw=()=>({fields:{reglamentoModoPrueba:{stringValue:'false'}}});
 t('M4 un valor que no es booleano false no apaga el modo prueba',c2.reg_config().modoPrueba===true);
 c2.firestoreGetDocRaw=()=>({fields:{reglamentoModoPrueba:{booleanValue:false}}});
 t('M5 solo reglamentoModoPrueba=false (booleano) pasa a producción',c2.reg_config().modoPrueba===false);
 c2.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};let e2='';try{c2.reg_config();}catch(e){e2=e.message;}
 t('M6 sin propiedades del script (correo de TH, plantilla, cargo) falla con mensaje claro y no envía',/Faltan propiedades/.test(e2));}

// ═══ Diagnóstico de permisos (solo lectura) ═══
{const props={reg_th_email:'th@pibox.app',reg_template_id:'TPL',reg_firmante_cargo:'Gerente'};
 const mk=(fallaDrive)=>{const c={...ctx,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})},Session:{getEffectiveUser:()=>({getEmail:()=>'cromero@pibox.app'})},
  DriveApp:{getFileById:()=>{if(fallaDrive)throw new Error('Authorization is required to perform that action: drive');return{getName:()=>'Plantilla'};}},DocumentApp:{openById:()=>({getName:()=>'Plantilla'})},
  SpreadsheetApp:{openById:()=>({getName:()=>'Malla'})},GmailApp:{getInboxUnreadCount:()=>0},ScriptApp:{getOAuthToken:()=>'T',getProjectTriggers:()=>[{getHandlerFunction:()=>'reglamentoAvisos'}]},UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>'{}'})}};
  vm.createContext(c);vm.runInContext(GS0,c);vm.runInContext(GS,c);c.getMallaSheetId=()=>'SHEET';c.firestoreGetDocRaw=()=>null;return c;};
 const ok=mk(false).diagnosticoReglamento(),mal=mk(true).diagnosticoReglamento();
 t('DG1 el diagnóstico corre sin enviar nada y reporta cada servicio (OK)',/OK     Drive: leer la plantilla → Plantilla/.test(ok)&&/OK     Gmail/.test(ok)&&/OK     Firestore: colección reglamento_casos/.test(ok),ok);
 t('DG2 un permiso faltante aparece como FALLA con el servicio, sin romper el resto; detecta disparadores sin instalar',/FALLA  Drive: leer la plantilla → .*drive/.test(mal)&&/OK     Hojas de cálculo/.test(mal)&&/FALLA  Disparadores instalados → faltan/.test(mal),mal);}

// ═══ Plantilla de Google Doc: marcadores, un párrafo por falta, nota eliminada (Docs simulado) ═══
{class P{constructor(b,t){this.b=b;this.t=t;}getParent(){return this.b;}asParagraph(){return this;}setText(x){this.t=x;return this;}clear(){this.t='';}setAttributes(){return this;}getAttributes(){return{};}}
 class Body{constructor(l){this.ch=l.map(x=>new P(this,x));}getType(){return'BODY_SECTION';}asBody(){return this;}getChildIndex(p){return this.ch.indexOf(p);}getChild(i){return this.ch[i];}getNumChildren(){return this.ch.length;}
  removeChild(p){const i=this.ch.indexOf(p);if(this.ch.length===1)throw new Error('último');this.ch.splice(i,1);}insertParagraph(i,x){const p=new P(this,x);this.ch.splice(i,0,p);return p;}
  replaceText(re,rep){const r=new RegExp(re,'g');this.ch.forEach(p=>{p.t=p.t.replace(r,()=>rep.replace(/\\\$/g,'$'));});}
  findText(re){const r=new RegExp(re);const p=this.ch.find(x=>r.test(x.t));return p?{getElement:()=>({getParent:()=>p})}:null;}}
 const body=new Body(['{{FECHA}}','Señor(a) {{NOMBRE}} — {{CARGO}} — CC {{CEDULA}}','Causal: {{CAUSAL}}','{{DESCRIPCION_FALTAS}}','{{INICIO_NOTA}}','NOTA: para quien diligencia el documento…','{{FIN_NOTA}}','Atentamente,','{{FIRMANTE}}','{{CARGO_FIRMANTE}}']);
 const files=[];
 const c3={...ctx,ScriptApp:{getOAuthToken:()=>'T'},DocumentApp:{ElementType:{BODY_SECTION:'BODY_SECTION'},openById:()=>({getBody:()=>body,saveAndClose(){}})},
  DriveApp:{getFileById:()=>({makeCopy:n=>({getId:()=>'COPY',setTrashed:v=>files.push('copia trashed='+v),getAs:()=>({setName(n2){this.n=n2;return this;}})})}),getRootFolder:()=>({createFile:b=>({getBlob:()=>b,getUrl:()=>'https://drive/f/'+b.n,addViewers:e=>files.push('viewers:'+e.join())})}),getFolderById:()=>null}};
 vm.createContext(c3);vm.runInContext(GS0,c3);vm.runInContext(GS,c3);
 const r=c3.reg_pdfLlamado({folderId:'',templateId:'T'},{fecha:'10 de noviembre de 2026',nombre:'Ana Uno',cargo:'Agente',cedula:'123',causal:'Artículo 59, numeral 1: X',faltas:['F1 texto.','F2 texto.'],firmante:'Camilo Romero',cargoFirmante:'Gerente',emails:['ana@pibox.app','th@pibox.app']});
 const txt=body.ch.map(p=>p.t);
 t('PL1 reemplaza fecha, nombre, cargo, cédula y firmante',txt[0]==='10 de noviembre de 2026'&&/Ana Uno — Agente — CC 123/.test(txt[1])&&txt.includes('Camilo Romero')&&txt.includes('Gerente'),txt);
 t('PL1b el marcador opcional {{CAUSAL}} se reemplaza por la causal literal',txt.includes('Causal: Artículo 59, numeral 1: X'),txt);
 t('PL2 cada falta va en su propio párrafo',txt.includes('F1 texto.')&&txt.includes('F2 texto.')&&txt.indexOf('F2 texto.')===txt.indexOf('F1 texto.')+1,txt);
 t('PL3 elimina el bloque de nota para quien diligencia (con sus marcadores)',!txt.some(x=>/NOTA|INICIO_NOTA|FIN_NOTA/.test(x))&&txt.includes('Atentamente,'),txt);
 t('PL4 genera el PDF, lo comparte con los destinatarios y manda la copia de la plantilla a la papelera',/Llamado de atención — Ana Uno — 10 de noviembre de 2026\.pdf/.test(r.url)&&files.some(f=>f==='copia trashed=true')&&files.some(f=>/viewers:ana@pibox\.app,th@pibox\.app/.test(f)),[r.url,files]);}

(async()=>{
// ═══ Cliente (index.html): plazo, cut-over del modelo de strikes y sección del agente ═══
{const slice=(a,b)=>{const i=HTML.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=HTML.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return HTML.slice(i,j);};
 const fn=sig=>{const i=HTML.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=HTML.indexOf('\n}\n',i);return HTML.slice(i,j+3);};
 const CODE=[slice("const FESTIVOS_CO=[","// Detecta la novedad de"),
  fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),slice("const STRIKE_CATS=","// Registro de «ya se notificó este llamado»."),
  fn("async function loadReglamentoAgente(model,userEmail){")].join('\n');
 const FIXED=new Date(2026,10,10,9,0,0).getTime(); // martes 10-nov-2026
 class FD extends Date{static now(){return FIXED;}}
 const PRE=new Date(2026,9,22,9,0,0).getTime(); // jueves 22-oct-2026 (antes de la vigencia)
 class FDpre extends Date{static now(){return PRE;}}
 const els={'reg-wrap':{style:{},innerHTML:''}};
 let casos=[];
 const env={window:{getReglamentoCasos:async()=>casos},document:{getElementById:id=>els[id]||null,addEventListener(){}},esc:x=>String(x==null?'':x).replace(/</g,'&lt;'),REG_FIX:null};
 const mkC=D=>new Function('window','document','esc','Date',CODE+'\nreturn{regFechaLimite,regEsHabil,computeAgentStrikes,applyStrikePolicy,loadReglamentoAgente,REGLAMENTO_DESDE,REG_POLITICA_TEXTO,regColorContador};')(env.window,env.document,env.esc,D);
 const FEB=new Date(2027,1,19,9,0,0).getTime();class FDfeb extends Date{static now(){return FEB;}}
 const C=mkC(FD),Cpre=mkC(FDpre),Cfeb=mkC(FDfeb);
 // CL1: el plazo del cliente coincide con el del .gs para todos los días de nov-2026 a dic-2027
 let difs=[];for(let ms=Date.UTC(2026,10,1);ms<Date.UTC(2027,11,31);ms+=86400000){const iso=new Date(ms).toISOString().slice(0,10);if(C.regFechaLimite(iso)!==R('reg_fechaLimite')(iso))difs.push(iso);}
 t('CL1 el plazo de 3 días hábiles del cliente es idéntico al del script para cada día de nov-2026 a dic-2027',difs.length===0,difs.slice(0,5));
 t('CL2 viernes 6-nov → miércoles 11-nov; viernes 13-nov (festivo lunes 16) → jueves 19-nov (cliente)',C.regFechaLimite('2026-11-06')==='2026-11-11'&&C.regFechaLimite('2026-11-13')==='2026-11-19');
 // Cut-over del modelo de strikes
 const EM='ana@pibox.app',ts=d=>({toDate:()=>d});
 const dia=(fecha,min)=>{const [d,m,y]=fecha.split('/').map(Number);return{row:{fecha,usuario:EM,inicio:'8:00:00',fin:'16:00:00',novedad:''},turno:{userEmail:EM,status:'ended',startTime:ts(new Date(y,m-1,d,8,min,0)),endTime:ts(new Date(y,m-1,d,16,0,0))}};};
 const calc=(dias,cfgMin,now)=>{const st=C.computeAgentStrikes({email:EM,malla:dias.map(x=>x.row),turnos:dias.map(x=>x.turno),waiverMap:new Map(),appealMap:new Map(),cfg:{tardanzaMins:cfgMin,nodescHrs:4},now});return{st,pol:C.applyStrikePolicy(st,now)};};
 let r=calc([dia('4/11/2026',14),dia('30/10/2026',14)],5,new Date(2026,10,10));
 t('CL3 una tardanza desde el 1-nov-2026 sale del modelo de strikes (va a «reglamento»); la del 30-oct sigue siendo strike',r.pol.reglamento.length===1&&r.pol.reglamento[0].min===14&&r.pol.active.length===1&&r.pol.active[0].fecha==='30/10/2026'&&r.pol.totalActive===1,{reg:r.pol.reglamento.length,act:r.pol.active.length});
 r=calc([dia('4/11/2026',5),dia('5/11/2026',8)],10,new Date(2026,10,10));
 t('CL4 el Reglamento usa tolerancia fija de 5 min (aunque la configuración local diga 10): 5 min no es tardanza, 8 min sí',r.pol.reglamento.length===1&&r.pol.reglamento[0].fecha==='5/11/2026');
 // Sección del agente
 const reg=(fecha,min,extra)=>Object.assign({date:new Date(+fecha.split('/')[2],+fecha.split('/')[1]-1,+fecha.split('/')[0]),fecha,min,prog:'8:00:00',real:'08:14',detalle:'Llegó tarde',wid:EM+'_'+fecha.split('/').reverse().map(x=>x.padStart(2,'0')).join('')+'_tardanza',waived:null,appeal:null,reg:true},extra||{});
 const run=async(regs,cs)=>{casos=cs||[];els['reg-wrap'].innerHTML='';els['reg-wrap'].style.display='';await C.loadReglamentoAgente({reglamento:regs},EM);return els['reg-wrap'].innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');};
 let h=await run([reg('9/11/2026',14)]);
 t('CL5 tardanza en plazo (9-nov, hoy 10-nov): aviso con la fecha límite (12-nov) y botón para justificar/apelar',/En plazo/.test(h)&&/12\/11\/2026/.test(h)&&/Justificar \/ apelar/.test(els['reg-wrap'].innerHTML)&&/Tienes 1 tardanza en plazo/.test(h),h.slice(0,400));
 h=await run([reg('4/11/2026',14)]);
 t('CL6 vencido el plazo sin justificar: «Falta confirmada» y sin botón',/Falta confirmada \(venció el plazo\)/.test(h)&&!/Justificar \/ apelar/.test(els['reg-wrap'].innerHTML));
 h=await run([reg('9/11/2026',14,{appeal:{status:'pending',createdAt:new Date(2026,10,10,8,0,0).toISOString()}})]);
 t('CL7 apelación presentada y pendiente: «Apelación en revisión» (la falta espera)',/Apelación en revisión/.test(h)&&!/Justificar \/ apelar/.test(els['reg-wrap'].innerHTML));
 h=await run([reg('4/11/2026',14,{appeal:{status:'rejected',createdAt:new Date(2026,10,5).toISOString(),respuesta:'sin soporte'}})]);
 t('CL8 apelación rechazada: falta confirmada con la respuesta del admin',/apelación rechazada\) — sin soporte/.test(h));
 h=await run([reg('4/11/2026',14,{waived:{motivo:'cita'}})]);
 t('CL9 justificada: «no cuenta»',/Justificada — no cuenta/.test(h));
 h=await run([],[{userEmail:EM,tipo:'llamado',estado:'Enviado',prueba:false,numeroEnVentana:1,llamadoNumero:1,llamadoId:'G1',fecha:'04/11/2026',minutos:14,enviadoISO:'2026-11-10',pdfUrl:'https://drive/pdf/1'},{userEmail:EM,tipo:'llamado',estado:'Enviado',prueba:false,numeroEnVentana:2,llamadoNumero:1,llamadoId:'G1',fecha:'05/11/2026',minutos:9,enviadoISO:'2026-11-10',pdfUrl:'https://drive/pdf/1'},{userEmail:EM,tipo:'llamado',estado:'Enviado',prueba:true,numeroEnVentana:2,llamadoNumero:2,fecha:'05/11/2026',minutos:9,enviadoISO:'2026-11-11',pdfUrl:'https://drive/pdf/prueba'},{userEmail:EM,tipo:'falta_grave',estado:'Enviado',prueba:false,fecha:'06/11/2026',enviadoISO:'2026-11-12',soporteUrl:'https://drive/x'}]);
 t('CL10 el Historial del agente agrupa por llamado (2 faltas en un solo llamado, con el PDF); no muestra los de prueba ni las notificaciones de falta grave a TH',(()=>{const hist=els['reg-wrap'].innerHTML.split('Historial de llamados de atención')[1]||'';return !/prueba/.test(hist)&&!/drive\/x|soporte/i.test(hist)&&(hist.match(/Llamado n/g)||[]).length===1&&/04\/11\/2026 y 05\/11\/2026/.test(hist)&&/https:\/\/drive\/pdf\/1/.test(hist);})(),h.slice(0,300));
 // Indicador «Tardanzas desde el 1 de noviembre: X de 3» con color verde → amarillo → rojo
 const ind=async(n)=>{const regs=[];for(let i=0;i<n;i++)regs.push(reg(`${4+i}/11/2026`,10+i,{appeal:null}));const hh=await run(regs);return{h:hh,html:els['reg-wrap'].innerHTML};};
 let r0=await ind(0),r1=await ind(1),r2=await ind(2),r3=await ind(3);
 t('IN1 el indicador dice «Tardanzas desde el 1 de noviembre: X de 3» (0, 1, 2 y 3)',/Tardanzas desde el 1 de noviembre: 0 de 3/.test(r0.h)&&/: 1 de 3/.test(r1.h)&&/: 2 de 3/.test(r2.h)&&/: 3 de 3/.test(r3.h));
 const colorDe=html=>(html.match(/id="reg-indicador" style="margin:12px 16px 0;border:2px solid (#[0-9a-f]{6})/)||[])[1];
 t('IN2 color: verde (0), verde-amarillo (1), amarillo (2), rojo (3)',colorDe(r0.html)==='#4ade80'&&colorDe(r1.html)==='#a3e635'&&colorDe(r2.html)==='#fbbf24'&&colorDe(r3.html)==='#f87171',[colorDe(r0.html),colorDe(r1.html),colorDe(r2.html),colorDe(r3.html)]);
 t('IN3 con 2 avisa que está a una tardanza de la falta grave; con 3, que se remite a Talento Humano',/a una tardanza de la falta grave/.test(r2.h)&&/se remite a Talento Humano/.test(r3.h)&&!/a una tardanza/.test(r1.h));
 h=await run([reg('4/11/2026',10,{waived:{motivo:'x'}}),reg('5/11/2026',12),reg('6/11/2026',15)],[{userEmail:EM,estado:'Cancelado',fechaISO:'2026-11-06'}]);
 t('IN4 las justificadas y las canceladas no cuentan en el indicador (3 tardanzas: 1 justificada, 1 cancelada → 1 de 3)',/: 1 de 3/.test(h),h.slice(0,260));
 casos=[];els['reg-wrap'].innerHTML='';
 await Cfeb.loadReglamentoAgente({reglamento:[reg('4/11/2026',14),reg('10/2/2027',14)]},EM);
 const hf=els['reg-wrap'].innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 t('IN5 ventana móvil de 3 meses: en febrero-2027 la tardanza del 4-nov-2026 ya no cuenta (solo la de febrero → 1 de 3)',/: 1 de 3/.test(hf)&&/ventana desde 01\/12\/2026/.test(hf),hf.slice(0,260));
 t('LK1 debajo del texto de la política hay un enlace «Ver artículos que rigen según el reglamento» que abre el modal',(()=>{const h=els['reg-wrap'].innerHTML;const i=h.indexOf(C.REG_POLITICA_TEXTO),j=h.indexOf('Ver artículos que rigen según el reglamento');return i>0&&j>i&&/onclick="verArticulosReglamento\(\);return false;"/.test(h);})());
 t('IN6 la política literal es visible para el agente',els['reg-wrap'].innerHTML.includes(C.REG_POLITICA_TEXTO)&&C.REG_POLITICA_TEXTO==='Desde el 1 de noviembre de 2026, las llegadas tarde se rigen por el Reglamento Interno de Trabajo: la primera y segunda en los últimos 3 meses son falta leve con llamado de atención escrito; la tercera es falta grave y se remite a Talento Humano. Tienes 3 días hábiles para justificar cada tardanza. Las tardanzas justificadas o con apelación aprobada no cuentan.');
 await run([],[]);
 t('CL11 sin tardanzas ni llamados la sección sigue visible con el indicador en 0 de 3',els['reg-wrap'].style.display==='block'&&/: 0 de 3/.test(els['reg-wrap'].innerHTML.replace(/<[^>]+>/g,' ')));
 // Antes del 1 de noviembre: aviso de la fecha de inicio, sin indicador
 casos=[];els['reg-wrap'].innerHTML='';await Cpre.loadReglamentoAgente({reglamento:[]},EM);
 const pre=els['reg-wrap'].innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 t('PRE1 antes del 1 de noviembre el indicador muestra el aviso de la fecha de inicio (y no «X de 3»)',/rige para las llegadas tarde desde el 1 de noviembre de 2026/.test(pre)&&!/de 3/.test(pre)&&!/reg-indicador/.test(els['reg-wrap'].innerHTML),pre.slice(0,300));
 t('PRE2 …y también muestra la política',pre.includes('las llegadas tarde se rigen por el Reglamento Interno de Trabajo'));
 t('LK2 antes del 1-nov el enlace a los artículos también está debajo de la política',(()=>{const h=els['reg-wrap'].innerHTML;return h.indexOf('Ver artículos que rigen según el reglamento')>h.indexOf('las llegadas tarde se rigen por el Reglamento');})());}

// ═══ pruebaEnvioReglamento(): envío de prueba con Google simulado ═══
{class P{constructor(b,t){this.b=b;this.t=t;}getParent(){return this.b;}asParagraph(){return this;}setText(x){this.t=x;return this;}clear(){this.t='';}setAttributes(){return this;}getAttributes(){return{};}getText(){return this.t;}}
 class Body{constructor(l){this.ch=l.map(x=>new P(this,x));}getType(){return'BODY_SECTION';}asBody(){return this;}getChildIndex(p){return this.ch.indexOf(p);}getChild(i){return this.ch[i];}getNumChildren(){return this.ch.length;}
  removeChild(p){const i=this.ch.indexOf(p);if(this.ch.length===1)throw new Error('último');this.ch.splice(i,1);}insertParagraph(i,x){const p=new P(this,x);this.ch.splice(i,0,p);return p;}
  replaceText(re,rep){const r=new RegExp(re,'g');this.ch.forEach(p=>{p.t=p.t.replace(r,()=>rep.replace(/\\\$/g,'$'));});}
  findText(re){const r=new RegExp(re);const p=this.ch.find(x=>r.test(x.t));return p?{getElement:()=>({getParent:()=>p})}:null;}
  getText(){return this.ch.map(p=>p.t).join('\n');}getParagraphs(){return this.ch;}}
 const PLANTILLA_COMPLETA=['Bogotá, {{FECHA}}','Señor(a) {{NOMBRE}} — {{CARGO}} — CC {{CEDULA}}','Asunto: llamado de atención','Causal: {{CAUSAL}}','{{DESCRIPCION_FALTAS}}','{{INICIO_NOTA}}','NOTA AMARILLA: para quien diligencia el documento…','{{FIN_NOTA}}','Atentamente,','{{FIRMANTE}}','{{CARGO_FIRMANTE}}'];
 function google(o={}){
  const G={mails:[],files:[],viewers:[],fetches:[],logs:[],body:new Body(o.plantilla||PLANTILLA_COMPLETA),creados:0,trashed:[]};
  const props={reg_template_id:'TPL',reg_firmante_cargo:'Gerente de Operaciones',reg_th_email:'th-real@pibox.app',reg_drive_folder_id:o.carpeta||'',...(o.props||{})};
  const folder={createFile:b=>{const f={getBlob:()=>b,getUrl:()=>'https://drive.google.com/file/d/'+(b.n||'x').replace(/\W+/g,'_')+'/view',addViewers:e=>G.viewers.push(e)};G.files.push(f.getUrl());return f;}};
  const c={...ctx,Logger:{log:m=>G.logs.push(m)},
   PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty(){throw new Error('NO debe escribir propiedades');}})},
   Session:{getEffectiveUser:()=>({getEmail:()=>o.cuenta||'cromero@pibox.app'})},
   ScriptApp:{getOAuthToken:()=>'T',newTrigger(){throw new Error('NO debe tocar disparadores');},deleteTrigger(){throw new Error('NO debe tocar disparadores');},getProjectTriggers(){throw new Error('NO debe tocar disparadores');}},
   UrlFetchApp:{fetch:(u)=>{G.fetches.push(u);if(/firestore/.test(u))throw new Error('NO debe tocar Firestore');return{getBlob:()=>({setName(n){this.n=n;return this;}})};}},
   SpreadsheetApp:{openById(){throw new Error('NO debe leer la malla ni agentes');},create:()=>{G.creados++;const sh=()=>({setName(){},getRange:()=>({setValues(){}})});return{getActiveSheet:sh,insertSheet:sh,getId:()=>'SS'+G.creados};},flush(){}},
   DocumentApp:{ElementType:{BODY_SECTION:'BODY_SECTION'},openById:()=>({getBody:()=>G.body,saveAndClose(){}})},
   DriveApp:{getFileById:id=>{if(o.sinPlantilla&&id==='TPL')throw new Error('Authorization is required: drive');return{makeCopy:n=>({getId:()=>'COPY',setTrashed:v=>G.trashed.push('copia '+v),getAs:()=>({setName(n2){this.n=n2;return this;}})}),setTrashed:v=>G.trashed.push(id+' '+v)};},getRootFolder:()=>folder,getFolderById:()=>folder},
   GmailApp:{sendEmail:(to,subject,plain,opts)=>G.mails.push({to,subject,cc:opts.cc,html:opts.htmlBody,attachments:opts.attachments||[]})}};
  vm.createContext(c);vm.runInContext(GS0,c);vm.runInContext(GS,c);
  return{G,c,correr:()=>c.pruebaEnvioReglamento()};}
 // 1) camino feliz
 {const g=google();const log=g.correr();
  const ms=g.G.mails;
  t('PR1 envía EXACTAMENTE 3 correos (llamado, falta grave, reincidencia), todos solo a cromero@pibox.app y sin copias',ms.length===3&&ms.every(m=>m.to==='cromero@pibox.app'&&!m.cc),ms.map(m=>[m.to,m.cc]));
  t('PR2 todos con «PRUEBA DE ENVÍO» en el asunto y los asuntos esperados',ms.every(m=>/^PRUEBA DE ENVÍO — /.test(m.subject))&&ms[0].subject==='PRUEBA DE ENVÍO — Llamado de atención — Agente de Prueba — 17/11/2026'&&ms[1].subject==='PRUEBA DE ENVÍO — Falta grave para descargos — Agente de Prueba'&&ms[2].subject==='PRUEBA DE ENVÍO — Reincidencia — Falta grave para descargos — Agente de Prueba',ms.map(m=>m.subject));
  t('PR3 adjuntos: PDF en el llamado y el Excel de soporte en las dos notificaciones',ms[0].attachments.length===1&&/\.pdf$/.test(ms[0].attachments[0].n||'')&&ms[1].attachments.length===1&&/\.xlsx$/.test(ms[1].attachments[0].n||'')&&ms[2].attachments.length===1&&/\.xlsx$/.test(ms[2].attachments[0].n||''),ms.map(m=>m.attachments.map(a=>a.n)));
  t('PR4 el banner dice que es modo prueba y a quién habría ido (agente ficticio, líder, TH ficticio); nada llega a esas direcciones',ms.every(m=>/MODO PRUEBA/.test(m.html))&&/agente\.prueba@example\.com/.test(ms[0].html)&&/talento\.humano\.prueba@example\.com/.test(ms[1].html)&&!ms.some(m=>/th-real@pibox\.app/.test(m.to+(m.cc||''))));
  t('PR5 datos ficticios: Agente de Prueba, Agente de Operaciones, Líder de Prueba, tardanzas de noviembre de 2026',ms.every(m=>/Agente de Prueba/.test(m.html))&&/Agente de Operaciones/.test(ms[1].html)&&/Líder de Prueba/.test(ms[1].html)&&/03\/11\/2026/.test(ms[1].html)&&/05\/11\/2026/.test(ms[1].html)&&/09\/11\/2026/.test(ms[2].html));
  t('PR6 el llamado trae las dos faltas y la causal literal del art. 59 num. 1; la falta grave la del art. 60 num. 2; la reincidencia referencia el caso abierto',/3 de noviembre de 2026/.test(ms[0].html)&&/4 de noviembre de 2026/.test(ms[0].html)&&/Artículo 59, numeral 1: El retardo injustificado en la hora de entrada, hasta por segunda vez\./.test(ms[0].html)&&/Artículo 60, numeral 2: El retardo injustificado en la hora de entrada, por tercera vez\./.test(ms[1].html)&&/Reincidencia\./.test(ms[2].html)&&/3\.ª tardanza \(05\/11\/2026\)/.test(ms[2].html));
  t('PR7 NO toca Firestore ni la malla/agentes ni los disparadores ni las propiedades (cualquier intento lanzaría), y no comparte los archivos con nadie',!g.G.fetches.some(u=>/firestore/.test(u))&&g.G.viewers.length===0&&!/FALLA/.test(log),[g.G.fetches,g.G.viewers]);
  t('PR8 el log marca cada paso con OK, y lista los enlaces de los PDF/Excel dejados en Drive para revisarlos y borrarlos',/OK     1\/3 llamado de atención con DOS faltas/.test(log)&&/OK     2\/3 notificación de falta grave/.test(log)&&/OK     3\/3 notificación de reincidencia/.test(log)&&/ARCHIVOS GENERADOS EN DRIVE/.test(log)&&/PDF del llamado: https:\/\/drive\.google\.com/.test(log)&&(log.match(/Excel de soporte(?: \(reincidencia\))?: https:\/\/drive\.google\.com/g)||[]).length===2&&/Firestore: no se leyó ni escribió nada/.test(log),log);
  t('PR9 revisión del PDF: marcadores reemplazados, un párrafo por falta, nota amarilla eliminada, causal literal y firma con nombre y cargo',/OK     PDF: marcadores reemplazados/.test(log)&&/OK     PDF: un párrafo por falta \(2 faltas/.test(log)&&/OK     PDF: nota para quien diligencia eliminada/.test(log)&&/OK     PDF: causal literal \(art\. 59 num\. 1\)/.test(log)&&/OK     PDF: firma: Camilo Romero — Gerente de Operaciones/.test(log),log);
  const cuerpo=g.G.body.getText();
  t('PR10 el documento final: faltas en párrafos separados con fecha, hora programada, hora de inicio y minutos; sin nota; con firma',/El día 3 de noviembre de 2026, su turno estaba programado para iniciar a las 8:00 a\. m\. y el inicio se registró en Pi GOps a las 8:14 a\. m\., con 14 minutos de retardo/.test(cuerpo)&&/El día 4 de noviembre de 2026.*8:22 a\. m\., con 22 minutos de retardo/.test(cuerpo)&&!/NOTA AMARILLA|\{\{/.test(cuerpo)&&/Camilo Romero\nGerente de Operaciones/.test(cuerpo),cuerpo);
  t('PR11 la copia temporal de la plantilla y la hoja temporal del Excel se mandan a la papelera (quedan solo el PDF y los Excel)',g.G.trashed.filter(x=>x==='copia true').length===1&&g.G.creados===2&&g.G.trashed.filter(x=>/^SS\d true$/.test(x)).length===2,g.G.trashed);}
 // 2) plantilla sin los marcadores opcionales → avisos claros, pero sigue
 {const g=google({plantilla:['{{FECHA}}','{{NOMBRE}} — {{CARGO}}','{{DESCRIPCION_FALTAS}}','NOTA AMARILLA','{{FIRMANTE}}','{{CARGO_FIRMANTE}}']});const log=g.correr();
  t('PR12 si la plantilla no tiene {{INICIO_NOTA}}/{{FIN_NOTA}} ni {{CAUSAL}}, avisa qué agregar (la nota amarilla no se elimina sola) y aun así envía los 3 correos',/AVISO  PDF: la plantilla NO tiene \{\{INICIO_NOTA\}\} \/ \{\{FIN_NOTA\}\}/.test(log)&&/AVISO  PDF: la plantilla no tiene \{\{CAUSAL\}\}/.test(log)&&g.G.mails.length===3,log);
  const h=google({plantilla:['{{FECHA}} {{NOMBRE}} {{CARGO}} {{MARCADOR_DESCONOCIDO}}','{{DESCRIPCION_FALTAS}}','{{FIRMANTE}} {{CARGO_FIRMANTE}}']});const log2=h.correr();
  t('PR13 un marcador que el código no conoce queda sin reemplazar → FALLA explícita en el log',/FALLA  PDF: marcadores reemplazados.*MARCADOR_DESCONOCIDO/.test(log2),log2);}
 // 3) fallos
 {const g=google({props:{reg_firmante_cargo:''}});const log=g.correr();
  t('PR14 sin reg_firmante_cargo: FALLA clara y no se envía nada',/FALLA  propiedades reg_template_id y reg_firmante_cargo/.test(log)&&g.G.mails.length===0&&g.G.files.length===0,log);
  const h=google({sinPlantilla:true});const log2=h.correr();
  t('PR15 si falla el PDF (p. ej. falta el permiso de Drive) el paso 1 queda en FALLA con el motivo y los pasos 2 y 3 siguen (2 correos)',/FALLA  1\/3 llamado de atención.*drive/.test(log2)&&/OK     2\/3/.test(log2)&&/OK     3\/3/.test(log2)&&h.G.mails.length===2,log2);
  const k=google({carpeta:'FOLDER'});k.correr();
  t('PR16 con reg_drive_folder_id los archivos se guardan en esa carpeta (si no, en la raíz)',k.G.files.length===3);
  const m=google({cuenta:'otra@pibox.app'});const log3=m.correr();
  t('PR17 si la ejecuta otra cuenta lo avisa, pero el destino sigue fijo: solo cromero',/FALLA  cuenta que ejecuta/.test(log3)&&m.G.mails.every(x=>x.to==='cromero@pibox.app'),log3);
  t('PR18 pruebaEnvioReglamento no la invoca ningún disparador ni otra función',!/pruebaEnvioReglamento\(\)/.test(GS.replace(/function pruebaEnvioReglamento\(\)/,'').replace(/\/\/.*pruebaEnvioReglamento.*/g,''))&&!/newTrigger\('pruebaEnvioReglamento'/.test(GS));}
}

const fails=out.filter(l=>l.startsWith('FAIL'));
console.log(out.join('\n'));
console.log(`\n${out.length-fails.length}/${out.length} pruebas OK`);
process.exit(fails.length?1:0);
})().catch(e=>{console.error('ERROR en la prueba:',e);process.exit(2);});
