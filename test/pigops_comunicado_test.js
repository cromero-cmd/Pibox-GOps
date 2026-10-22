// Uso: node test/pigops_comunicado_test.js   (sin red ni Firestore: todo simulado; no escribe nada en producción)
// Comunicado anclado (v18.7): modal hasta confirmar, banner después, vigencia hasta la fecha de fin, comunicado nuevo = confirmar
// de nuevo, la confirmación solo a nombre propio y el modal sin estorbar el inicio de turno. Ejecuta el código REAL de index.html
// (script clásico completo + los wrappers de Firestore del bloque module) en un contexto vm con DOM y Firestore falsos.
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const CLASSIC=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).sort((a,b)=>b.length-a.length)[0];
const mod=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const WRAP=mod.slice(mod.indexOf('// ── Comunicados anclados (v18.7) ──'),mod.indexOf('window.setReglamentoModoPrueba = async'));
const STATIC_IDS=new Set([...html.replace(/<script[\s\S]*?<\/script>/g,'').matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x===undefined?'':JSON.stringify(x))));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function build(o={}){
 const email=o.email||'ana@pibox.app';
 const store={},log={reads:[],writes:[]},toasts=[];
 if(o.confirmadoPrevio)store['comunicados_lectura/'+o.confirmadoPrevio]={email,comunicadoId:o.confirmadoPrevio.split('_')[0]};
 // ── Firestore falso (solo lo que usan los wrappers del comunicado) ──
 const doc=(db,c,i)=>({c,i,k:c+'/'+i});
 const getDoc=async ref=>{log.reads.push(ref.k);if(o.falla)throw Object.assign(new Error('Missing or insufficient permissions'),{code:'permission-denied'});const v=store[ref.k];return{exists:()=>!!v,data:()=>v};};
 const setDoc=async(ref,data,opts)=>{
  // Reglas simuladas: comunicados_lectura solo se CREA (nunca se actualiza) y con el email de la sesión
  if(ref.c==='comunicados_lectura'){if(store[ref.k])throw Object.assign(new Error('denied'),{code:'permission-denied'});if(data.email!==email)throw Object.assign(new Error('denied'),{code:'permission-denied'});}
  log.writes.push({k:ref.k,data,opts});
  store[ref.k]=opts&&opts.merge?Object.assign(store[ref.k]||{},data):data;};
 const getDocs=async()=>({docs:[]});
 const present=new Set(STATIC_IDS);const els={};
 const mkEl=id=>{const b={id,innerHTML:'',textContent:'',value:'',checked:false,disabled:false,style:{},dataset:{},_processing:false,classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  insertAdjacentHTML(p,h){this.innerHTML=h+this.innerHTML;},setAttribute(){},removeAttribute(){},remove(){}};
  return new Proxy(b,{get(tg,k){if(k in tg)return tg[k];if(k==='querySelector'||k==='closest')return()=>null;if(k==='querySelectorAll')return()=>[];if(typeof k==='symbol')return undefined;return()=>{};},set(tg,k,v){tg[k]=(k==='textContent'||k==='innerHTML'||k==='value')?String(v):v;return true;}});};
 const getEl=id=>present.has(id)?(els[id]||(els[id]=mkEl(id))):null;
 const document={getElementById:getEl,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>mkEl('__n'),body:mkEl('body'),addEventListener(){},documentElement:mkEl('html'),head:mkEl('head')};
 const ctx={document,navigator:{userAgent:'x',maxTouchPoints:0},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},console:{log(){},warn(){},info(){},error(){}},
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},fetch:async()=>({ok:false}),URL,Date,Math,JSON,Promise,Map,Set,AbortController,
  doc,getDoc,setDoc,getDocs,query:()=>({}),collection:()=>({}),where:()=>({}),limit:()=>({}),serverTimestamp:()=>({__serverTimestamp:true}),db:{},
  auth:{currentUser:email==='NINGUNO'?null:{email}}};
 ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};ctx.matchMedia=()=>({matches:false,addEventListener(){}});
 ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.SUPER_ADMIN='cromero@pibox.app';ctx.ADMINS=['cromero@pibox.app','coord@pibox.app'];
 vm.createContext(ctx);
 vm.runInContext(WRAP,ctx);vm.runInContext(CLASSIC,ctx,{timeout:8000});
 ctx.toast=m=>toasts.push(m);ctx.confirm=()=>true;
 getEl('user-email').textContent=email;getEl('user-name').textContent=o.nombre||'Ana Uno';
 ctx._globalCfg=o.global||{};
 return{ctx,store,log,toasts,getEl,present,run:s=>vm.runInContext(s,ctx),
  modal:()=>getEl('comunicado-modal').style.display==='block',banner:()=>getEl('comunicado-banner').style.display==='block',bannerHtml:()=>getEl('comunicado-banner').innerHTML};
}
const ID='reglamento-tardanzas-2026-11';
const entrar=async(A,email)=>{A.ctx.initComunicado({email:email||'ana@pibox.app'});await sleep(1500);};

(async()=>{
 // ═══ Contenido por defecto ═══
 {const A=build();const c=A.run('comunicadoActual()');
  t('K1 el comunicado por defecto tiene el título, resumen, id y fin (1-nov-2026 23:59 Bogotá) pedidos',c.titulo==='Desde el 1 de noviembre: aplicación del Reglamento Interno para llegadas tarde'&&c.resumen==='📢 Desde el 1 de noviembre aplica el Reglamento Interno para llegadas tarde.'&&c.id===ID&&c.fin==='2026-11-01T23:59:00-05:00'&&c.activo===true,c);
  t('K2 el cuerpo es el texto indicado (5 viñetas/párrafos, causales, plazo, no retroactivo)',c.cuerpo.startsWith('La puntualidad al iniciar turno es clave para que la operación funcione. A partir del 1 de noviembre de 2026 aplicaremos el Reglamento Interno de Trabajo:\n• Llegada tarde: iniciar turno en Pi GOps más de 5 minutos después de la hora programada en tu malla.\n• 1.ª y 2.ª llegada tarde injustificada en los últimos 3 meses: falta leve (art. 59, num. 1), con llamado de atención escrito.\n• 3.ª llegada tarde injustificada en los últimos 3 meses: falta grave (art. 60, num. 2), remitida a Talento Humano.\n• Acumular tres llamados de atención también es falta grave (art. 60, num. 13).\nTienes 3 días hábiles para justificar cada llegada tarde desde Mi turno → Reglamento. Si la justificación es aprobada, no cuenta.\nNo es retroactivo: todos empezamos en cero el 1 de noviembre. Recuerda iniciar turno en Pi GOps apenas empieces a trabajar.'),c.cuerpo);}
 // ═══ Un agente sin confirmar ve el modal; confirmar crea el registro y deja solo el banner ═══
 {const A=build();
  await entrar(A);
  t('M1 agente sin confirmar: al entrar aparece el modal con el título y el botón «Leí y entendí»',A.modal()&&/Desde el 1 de noviembre: aplicación del Reglamento/.test(A.getEl('comunicado-modal-titulo').textContent)&&/Leí y entendí/.test(A.getEl('comunicado-modal-acciones').innerHTML)&&!A.banner());
  t('M2 el cuerpo del modal es el texto del comunicado',A.getEl('comunicado-modal-cuerpo').textContent===A.run('comunicadoActual().cuerpo'));
  t('M3 cuotas: UNA sola lectura (su propia confirmación) al entrar',A.log.reads.length===1&&A.log.reads[0]==='comunicados_lectura/'+ID+'_ana@pibox.app',A.log.reads);
  await A.ctx.confirmarComunicado();
  const w=A.log.writes[0];
  t('M4 al confirmar se crea comunicados_lectura/{id}_{email} con email, nombre, comunicadoId y fecha y hora (del servidor)',A.log.writes.length===1&&w.k==='comunicados_lectura/'+ID+'_ana@pibox.app'&&w.data.email==='ana@pibox.app'&&w.data.nombre==='Ana Uno'&&w.data.comunicadoId===ID&&w.data.confirmadoAt&&w.data.confirmadoAt.__serverTimestamp&&!w.opts,w);
  t('M5 después de confirmar el modal desaparece y queda el banner con el resumen y «Ver comunicado»',!A.modal()&&A.banner()&&A.bannerHtml().includes('📢 Desde el 1 de noviembre aplica el Reglamento Interno para llegadas tarde.')&&/Ver comunicado/.test(A.bannerHtml()),A.bannerHtml());
  t('M6 «Ver comunicado» reabre el texto completo (solo botón Cerrar, sin pedir confirmar otra vez)',(()=>{A.ctx.verComunicado();return A.modal()&&/Cerrar/.test(A.getEl('comunicado-modal-acciones').innerHTML)&&!/Leí y entendí/.test(A.getEl('comunicado-modal-acciones').innerHTML);})());
  t('M7 el banner es fijo arriba de Mi turno (sticky, dentro de subview-miturno)',/id="comunicado-banner" style="display:none;position:sticky;top:0/.test(html)&&html.indexOf('id="subview-miturno"')<html.indexOf('id="comunicado-banner"')&&html.indexOf('id="comunicado-banner"')<html.indexOf('<div class="resume-banner"'));
  // Un nuevo ingreso con la confirmación ya guardada: solo banner, sin modal, 1 lectura
  const B=build({confirmadoPrevio:ID+'_ana@pibox.app'});await entrar(B);
  t('M8 ingreso posterior ya confirmado: solo banner (sin modal) y una sola lectura',!B.modal()&&B.banner()&&B.log.reads.length===1);}
 // ═══ Cerrar sin confirmar: vuelve a aparecer en el próximo ingreso ═══
 {const A=build();await entrar(A);
  A.ctx.cerrarComunicadoModal();
  t('X1 puede cerrarlo sin confirmar: no se registra nada y no hay banner',!A.modal()&&A.log.writes.length===0&&!A.banner());
  A.ctx.comunicadoIntentarMostrar(0);
  t('X2 en la misma sesión no se vuelve a abrir solo',!A.modal());
  const B=build();await entrar(B);
  t('X3 en el siguiente ingreso (página nueva) el modal vuelve a aparecer mientras no confirme',B.modal());}
 // ═══ Nadie confirma a nombre de otro ═══
 {const A=build({email:'ana@pibox.app'});
  const r=await A.ctx.confirmarComunicadoLectura(ID,'Ana Uno','beto@pibox.app'); // un tercer argumento de «otro email» se ignora
  t('S1 la confirmación SIEMPRE usa el email de la sesión: aunque se pase otro correo, el documento es del agente logueado',r.ok&&A.log.writes.length===1&&A.log.writes[0].k==='comunicados_lectura/'+ID+'_ana@pibox.app'&&A.log.writes[0].data.email==='ana@pibox.app'&&!Object.keys(A.store).some(k=>/beto/.test(k)),A.log.writes);
  const r2=await A.ctx.confirmarComunicadoLectura(ID,'Ana Uno');
  t('S2 intentar confirmar otra vez no sobrescribe (el documento no se puede modificar) y se trata como «ya confirmado»',r2.ok&&r2.yaExistia&&A.log.writes.length===1,r2);
  const C=build({email:'NINGUNO'});const r3=await C.ctx.confirmarComunicadoLectura(ID,'x');
  t('S3 sin sesión no se puede confirmar',!r3.ok&&C.log.writes.length===0);
  // las reglas publicadas impiden además crear con email ajeno o modificar (simuladas aquí en setDoc): un intento forzado es denegado
  const D=build({email:'ana@pibox.app'});let denegado=false;try{await D.ctx.setDoc(D.ctx.doc(null,'comunicados_lectura',ID+'_beto@pibox.app'),{email:'beto@pibox.app'});}catch(e){denegado=e.code==='permission-denied';}
  t('S4 (reglas simuladas) crear una confirmación con el email de otro es denegado',denegado);}
 // ═══ Vigencia ═══
 {const pasada={...{},comunicado:{fin:'2026-10-01T00:00:00-05:00'}};
  const A=build({global:pasada});await entrar(A);
  t('V1 después de la fecha de fin no aparece nada (ni modal ni banner) y ni siquiera se lee Firestore',!A.modal()&&!A.banner()&&A.log.reads.length===0);
  const B=build({global:pasada,confirmadoPrevio:ID+'_ana@pibox.app'});await entrar(B);
  t('V2 …tampoco el banner de quien ya había confirmado',!B.banner()&&B.log.reads.length===0);
  const C=build({global:{comunicado:{activo:false}}});await entrar(C);
  t('V3 con el interruptor inactivo no aparece nada',!C.modal()&&!C.banner()&&C.log.reads.length===0);
  const D=build({global:{comunicado:{publicadoAt:new Date(Date.now()+86400000).toISOString()}}});await entrar(D);
  t('V4 un comunicado con publicación futura todavía no se muestra',!D.modal()&&D.log.reads.length===0);
  t('V5 el límite exacto: 1-nov-2026 23:59 (Bogotá) todavía vigente; un minuto después, no',!!build().ctx.comunicadoVigente(new Date('2026-11-01T23:59:00-05:00'))&&!build().ctx.comunicadoVigente(new Date('2026-11-02T00:00:00-05:00')));}
 // ═══ Comunicado nuevo → todos vuelven a confirmar ═══
 {const A=build({confirmadoPrevio:ID+'_ana@pibox.app'});await entrar(A);
  t('N1 (previo) con el comunicado actual confirmado: solo banner',A.banner()&&!A.modal());
  const B=build({global:{comunicado:{id:'com_nuevo123',titulo:'Otro aviso',cuerpo:'Texto nuevo',resumen:'📢 Aviso nuevo',fin:'2099-01-01T00:00:00-05:00'}},confirmadoPrevio:ID+'_ana@pibox.app'});
  await entrar(B);
  t('N2 publicar un comunicado con OTRO id vuelve a pedir confirmación aunque haya confirmado el anterior: modal y sin banner',B.modal()&&!B.banner()&&/Otro aviso/.test(B.getEl('comunicado-modal-titulo').textContent)&&B.log.reads[0]==='comunicados_lectura/com_nuevo123_ana@pibox.app',B.log.reads);
  await B.ctx.confirmarComunicado();
  t('N3 la confirmación del nuevo se guarda con su propio id',B.log.writes[0].k==='comunicados_lectura/com_nuevo123_ana@pibox.app'&&B.banner()&&/Aviso nuevo/.test(B.bannerHtml()));}
 // ═══ No interrumpe el inicio de turno ═══
 {const A=build();A.ctx._startInFlight=true;await entrar(A);
  t('T1 si el agente ya está iniciando turno, el modal NO aparece (espera)',!A.modal());
  A.ctx._startInFlight=false;A.ctx.comunicadoIntentarMostrar(0);
  t('T2 …y aparece cuando el inicio terminó',A.modal());
  const B=build();B.ctx._startModalOpen=1;B.ctx.initComunicado({email:'ana@pibox.app'});await sleep(1500);
  t('T3 con un aviso del inicio de turno abierto (ubicación, etc.) tampoco aparece',!B.modal());
  const C=build();await entrar(C);C.getEl('btn-turno-start')._processing=true;
  t('T4 con el botón «Iniciar turno» procesando, el modal queda en pausa',C.run('comunicadoPausado()')===true);
  const body=html.slice(html.indexOf('async function startTurno(){'),html.indexOf('async function startTurno(){')+2600);
  const iHide=body.indexOf('ocultarComunicadoModal'),iAwait=body.indexOf('await ');
  t('T5 startTurno oculta el comunicado de forma síncrona, ANTES de cualquier espera (no retrasa el inicio)',iHide>0&&iHide<iAwait&&/try\{window\.ocultarComunicadoModal&&window\.ocultarComunicadoModal\(\);\}catch\(e\)\{\}/.test(body));
  t('T6 el modal es una tarjeta flotante SIN fondo que bloquee clics (no hay overlay a pantalla completa)',/id="comunicado-modal" style="display:none;position:fixed;top:72px;left:50%;transform:translateX\(-50%\);width:min\(580px,94vw\);max-height:78vh/.test(html)&&!/id="comunicado-modal"[^>]*inset:0/.test(html));
  t('T7 el arranque del comunicado no se espera en el login (initComunicado sin await)',/try \{ window\.initComunicado && window\.initComunicado\(user\); \}/.test(html)&&!/await window\.initComunicado/.test(html));
  const D=build();D.run('window._startInFlight=true;window._comunicado=null');
  A.ctx.ocultarComunicadoModal();t('T8 ocultarComunicadoModal cierra el modal abierto',!A.modal());}
 // ═══ Quién lo ve, y fallos ═══
 {const A=build({email:'coord@pibox.app'});await entrar(A,'coord@pibox.app');
  t('Q1 los admins/coordinadores no ven el modal (se miden solo los agentes) y no gastan lecturas',!A.modal()&&A.log.reads.length===0);
  const B=build({email:'cromero@pibox.app'});await entrar(B,'cromero@pibox.app');
  t('Q2 cromero tampoco',!B.modal()&&B.log.reads.length===0);
  const C=build({falla:true});await entrar(C);
  t('Q3 si la lectura de la confirmación falla (p. ej. reglas sin publicar) no rompe nada ni muestra un modal imposible de confirmar',!C.modal()&&C.log.reads.length===1);}
 // ═══ Edición (solo cromero) ═══
 {const A=build({email:'ana@pibox.app'});let guardado=null;A.ctx.guardarComunicado=async c=>{guardado=c;return{ok:true};};
  A.getEl('inp-com-titulo').value='T';A.getEl('inp-com-cuerpo').value='C';A.getEl('inp-com-resumen').value='R';A.getEl('inp-com-fin').value='2026-12-31T18:30';
  await A.ctx.guardarComunicadoConfig(false);
  t('E1 un usuario que no es cromero no puede guardar (no llega a escribir)',guardado===null&&A.toasts.some(m=>/Solo cromero/.test(m)));
  const B=build({email:'cromero@pibox.app'});B.ctx.guardarComunicado=async c=>{guardado=c;return{ok:true};};
  B.ctx.loadComunicadoConfig();
  t('E2 en ⚙ Configurar cromero ve la sección con el texto actual y la fecha de fin en hora de Bogotá',B.getEl('com-config-field').style.display===''&&B.getEl('inp-com-titulo').value===B.run('COMUNICADO_DEFAULT.titulo')&&B.getEl('inp-com-fin').value==='2026-11-01T23:59'&&B.getEl('com-id-actual').textContent===ID);
  B.getEl('inp-com-titulo').value='Nuevo título';B.getEl('inp-com-cuerpo').value='Nuevo cuerpo';B.getEl('inp-com-resumen').value='📢 Resumen nuevo';B.getEl('inp-com-fin').value='2026-12-31T18:30';B.getEl('chk-com-activo').checked=true;
  await B.ctx.guardarComunicadoConfig(false);
  t('E3 «Guardar cambios» conserva el id, convierte la fecha de fin a hora de Bogotá y guarda en configs/global.comunicado',guardado&&guardado.id===ID&&guardado.fin==='2026-12-31T18:30:00-05:00'&&guardado.titulo==='Nuevo título'&&guardado.activo===true&&guardado.publicadoPor==='cromero@pibox.app'&&B.run('window._globalCfg.comunicado.id')===ID,guardado);
  await B.ctx.guardarComunicadoConfig(true);
  t('E4 «Publicar como NUEVO» crea otro id (todos deben confirmar de nuevo) y renueva la fecha de publicación',guardado.id!==ID&&/^com_/.test(guardado.id)&&!!guardado.publicadoAt,guardado);
  B.getEl('chk-com-activo').checked=false;await B.ctx.guardarComunicadoConfig(false);
  t('E5 el interruptor activo/inactivo se guarda',guardado.activo===false);
  B.getEl('inp-com-resumen').value='';guardado=null;await B.ctx.guardarComunicadoConfig(false);
  t('E6 no deja guardar con campos vacíos',guardado===null&&B.toasts.some(m=>/Completa título/.test(m)));
  const sec=html.indexOf('id="com-config-sec"');
  t('E7 la sección «Comunicado anclado» está en ⚙ Configurar con título, cuerpo, resumen, fecha de fin y activo',sec>0&&['inp-com-titulo','inp-com-cuerpo','inp-com-resumen','inp-com-fin','chk-com-activo'].every(id=>html.includes('id="'+id+'"')));}
 // ═══ Artículos del Reglamento (modal de solo lectura, texto literal) ═══
 {const LIT=[
  ['1. Obligación y prohibición',[
   ['Artículo 53, numeral 20','Cumplir estrictamente el horario de trabajo.'],
   ['Artículo 55, numeral 18','Suspender sus labores antes de la hora indicada o iniciar sus labores después de la hora señalada para el inicio sin justa causa y sin previa autorización de la Empresa.']]],
  ['2. Clasificación de las faltas',[
   ['Artículo 58','Se establecen las siguientes clases de faltas disciplinarias de los trabajadores, así: 1. Leves. 2. Graves. Parágrafo Único: La levedad o gravedad de las faltas la determinará el Área de Talento Humano, atendiendo los siguientes criterios: a) El grado de culpabilidad. b) La afectación del servicio. c) El nivel jerárquico del infractor. d) La trascendencia de la falta. e) El perjuicio ocasionado a la Empresa. f) La reiteración de la conducta. g) Los motivos determinantes de la conducta. h) Las modalidades y circunstancias en que se cometió la falta.']]],
  ['3. Faltas por llegadas tarde',[
   ['Artículo 59, numeral 1','El retardo injustificado en la hora de entrada, hasta por segunda vez.'],
   ['Artículo 60, numeral 2','El retardo injustificado en la hora de entrada, por tercera vez.'],
   ['Artículo 60, numeral 13','Acumular tres (3) llamados de atención realizados por su jefe inmediato.']]],
  ['4. Sanciones',[
   ['Artículo 61','Clases de sanciones. El trabajador está sometido a las siguientes sanciones: 1. Para las faltas leves: a. Amonestación escrita. b. Multa, por retrasos al trabajo sin excusa suficiente, la cual no excederá de la quinta parte del salario de un día de trabajo, y su importe se consignará en cuenta especial para dedicarse exclusivamente a premios o regalos para los trabajadores de la Empresa. c. Suspensión, la cual no será inferior a un (1) día ni superior a ocho (8) días. 2. Para las faltas graves: a. Multa, por faltas al trabajo sin excusa suficiente, la cual no excederá de la quinta parte del salario de un día de trabajo, y su importe se consignará en cuenta especial para dedicarse exclusivamente a premios o regalos para los trabajadores de la Empresa. b. Suspensión, la cual no será inferior a ocho (8) días hábiles ni superior a dos (2) meses. c. Despido con justa causa.']]],
  ['5. Debido proceso',[
   ['Artículo 63, segundo párrafo','En todas las actuaciones para aplicar sanciones disciplinarias, la Empresa aplicará las garantías del debido proceso, esto es, como mínimo los siguientes principios: dignidad, presunción de inocencia, in dubio pro disciplinado, proporcionalidad, derecho a la defensa, contradicción y controversia de las pruebas, intimidad, lealtad y buena fe, imparcialidad, respeto al buen nombre y a la honra, y non bis in idem.'],
   ['Artículo 64, numerales 2 y 3','2. Si existen méritos, el Área de Talento Humano le comunicará formalmente y por escrito al trabajador de la apertura del proceso, dicho escrito contendrá: a. La indicación de los hechos, conductas u omisiones que motivan el proceso; b. El traslado al trabajador de todas y cada una de las pruebas que fundamentan los hechos, conductas u omisiones del proceso y; c. La indicación del término de cinco (5) días hábiles para que el trabajador asista, presencial o virtualmente, a diligencia de descargos y pueda manifestarse frente a los motivos del proceso, controvertir las pruebas y allegar las que considere necesarias para sustentar su defensa. 3. Finalizada la diligencia de descargos y dentro de los cinco (5) días hábiles siguientes, contados a partir del día siguiente, la Empresa le notificará al trabajador la decisión debidamente motivada identificando específicamente la(s) causa(s) o motivo(s) de esta, la cual podrá consistir en imponer una sanción proporcional a los hechos u omisiones o absolver de los cargos acusados al trabajador.']]]];
  const A=build();const C=A.run('REGLAMENTO_ARTICULOS');
  t('AR1 REGLAMENTO_ARTICULOS (una sola constante) trae los 5 grupos, los 9 artículos y el texto EXACTO, sin resumir',C.grupos.length===5&&C.grupos.every((g,i)=>g.titulo===LIT[i][0]&&g.items.length===LIT[i][1].length&&g.items.every((it,j)=>it.ref===LIT[i][1][j][0]&&it.texto===LIT[i][1][j][1]))&&C.grupos.reduce((n,g)=>n+g.items.length,0)===9,C.grupos.map(g=>g.items.length));
  t('AR2 título y fuente literales',C.titulo==='Reglamento Interno de Trabajo — Digital Platforms Colombia S.A.S.'&&C.fuente==='Fuente: Reglamento Interno de Trabajo 2026 de Digital Platforms Colombia S.A.S. Ante cualquier duda, consulta con tu líder inmediato o con Talento Humano.');
  const antes=A.log.reads.length+A.log.writes.length;
  A.ctx.verArticulosReglamento();
  const cuerpo=A.getEl('reg-articulos-body').innerHTML;const plano=cuerpo.replace(/<[^>]+>/g,'\n');
  t('AR3 el modal muestra cada texto literal tal cual (renderizado)',LIT.every(g=>g[1].every(it=>plano.includes(it[1])&&plano.includes(it[0]))),LIT.flatMap(g=>g[1]).filter(it=>!plano.includes(it[1])).map(x=>x[0]));
  t('AR4 el modal está abierto con el título y la fuente al final, y los grupos son plegables (<details>) con el número de artículo en negrilla',A.getEl('reg-articulos-modal').style.display==='flex'&&A.getEl('reg-articulos-titulo').textContent===C.titulo&&A.getEl('reg-articulos-fuente').textContent===C.fuente&&(cuerpo.match(/<details/g)||[]).length===5&&(cuerpo.match(/<strong>Artículo/g)||[]).length===9);
  t('AR5 el grupo de las llegadas tarde abre desplegado (con la etiqueta falta leve / falta grave); los demás, plegados',(cuerpo.match(/<details open/g)||[]).length===1&&/falta leve/.test(cuerpo)&&(cuerpo.match(/falta grave/g)||[]).length===2);
  t('AR6 es contenido estático: abrirlo no lee ni escribe Firestore',A.log.reads.length+A.log.writes.length===antes);
  A.ctx.cerrarArticulosReglamento();
  t('AR7 se cierra (botón ×, clic fuera del recuadro y tecla Esc)',A.getEl('reg-articulos-modal').style.display==='none'&&/onclick="if\(event\.target===this\)cerrarArticulosReglamento\(\)"/.test(html)&&/addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)cerrarArticulosReglamento\(\);\}\)/.test(html));
  t('AR8 se ve bien en móvil y en modo oscuro: ancho min(720px,100%), alto limitado a la pantalla (100dvh) con scroll interno, y colores solo con variables del tema',/id="reg-articulos-modal"[^>]*padding:12px/.test(html)&&/width:min\(720px,100%\);max-height:calc\(100vh - 24px\);max-height:calc\(100dvh - 24px\)/.test(html)&&/id="reg-articulos-body" style="overflow-y:auto;-webkit-overflow-scrolling:touch/.test(html)&&/overflow-wrap:anywhere/.test(html)&&!/id="reg-articulos-modal"[\s\S]{0,1800}background:#fff/.test(html));
  t('AR9 el modal de artículos queda por encima del comunicado (z-index 800 > 600) y se cierra si empieza el inicio de turno',/id="reg-articulos-modal" style="display:none;position:fixed;inset:0;z-index:800/.test(html)&&/window\.cerrarArticulosReglamento&&window\.cerrarArticulosReglamento\(\)/.test(html.slice(html.indexOf('async function startTurno(){'),html.indexOf('async function startTurno(){')+2600)));
  // enlace en el comunicado (modal y texto completo)
  const B=build();await entrar(B);
  t('AR10 el modal del comunicado trae el enlace «Ver artículos que rigen según el reglamento»',B.modal()&&B.getEl('comunicado-modal-enlace').style.display==='block'&&/Ver artículos que rigen según el reglamento/.test(B.getEl('comunicado-modal-enlace').innerHTML)&&/verArticulosReglamento\(\)/.test(B.getEl('comunicado-modal-enlace').innerHTML));
  await B.ctx.confirmarComunicado();B.ctx.verComunicado();
  t('AR11 …y también en «Ver comunicado» (texto completo) tras confirmar',B.modal()&&B.getEl('comunicado-modal-enlace').style.display==='block'&&/Ver artículos/.test(B.getEl('comunicado-modal-enlace').innerHTML));
  const D=build({global:{comunicado:{enlaceReglamento:false}}});await entrar(D);
  t('AR12 un comunicado de otro tema puede ocultar el enlace (enlaceReglamento:false)',D.modal()&&D.getEl('comunicado-modal-enlace').style.display==='none'&&D.getEl('comunicado-modal-enlace').innerHTML==='');
  const E=build({email:'cromero@pibox.app'});let g=null;E.ctx.guardarComunicado=async c=>{g=c;return{ok:true};};E.ctx.loadComunicadoConfig();
  const chkInicial=E.getEl('chk-com-enlace').checked;E.getEl('chk-com-enlace').checked=false;E.getEl('inp-com-fin').value='2026-12-31T18:30';await E.ctx.guardarComunicadoConfig(false);
  t('AR13 ⚙ Configurar: casilla «Incluir el enlace…» (marcada por defecto) y se guarda en el comunicado',chkInicial===true&&g&&g.enlaceReglamento===false&&html.includes('id="chk-com-enlace"'),g);}
 // ═══ Reutilizable ═══
 t('R1 el id del comunicado no está atado al contenido: cualquier comunicado nuevo usa el mismo mecanismo (config + comunicados_lectura/{id}_{email})',/comunicados_lectura', comunicadoId \+ '_' \+ email/.test(html));
 const fails=out.filter(l=>l.startsWith('FAIL'));
 console.log(out.join('\n'));
 console.log(`\n${out.length-fails.length}/${out.length} pruebas OK`);
 process.exit(fails.length?1:0);
})().catch(e=>{console.error('ERROR en la prueba:',e);process.exit(2);});
