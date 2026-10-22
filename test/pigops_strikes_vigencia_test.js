// Uso: node test/pigops_strikes_vigencia_test.js   (sin red ni Firestore; extrae el código real de index.html)
// Política de vigencia de strikes (v18.1): 3 meses calendario (mes actual + 2 anteriores completos), archivo por fecha
// al leer, apelaciones aprobadas fuera de todo conteo, llamados vigentes según el mes en que se emitieron.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a);if(i<0)throw new Error('no encontrado: '+a);const j=html.indexOf(b,i);if(j<0)throw new Error('no encontrado: '+b);return html.slice(i,j);};
const fn=(sig)=>{const i=html.indexOf(sig);if(i<0)throw new Error('no encontrado: '+sig);const j=html.indexOf('\n}\n',i);return html.slice(i,j+3);};
const ENGINE=slice("const STRIKE_CATS=","// Registro de «ya se notificó este llamado».");
const REG=slice("const REGLAMENTO_DESDE=","const regIsoLocal"); // el motor de strikes separa las tardanzas del Reglamento (desde 1-nov-2026)
const code=[REG,fn("function parseDate(s){"),fn("function parseTime(dateStr,timeStr){"),fn("function strikeWaiverId(email,fecha,cat){"),ENGINE,
 'return{STRIKE_CATS,strikeVigencia,strikeExpiryDate,computeAgentStrikes,applyStrikePolicy,buildLlamadoHistorialVigente};'].join('\n');
const E=new Function(code)();
const out=[];const t=(n,c,x)=>out.push((c?'PASS ':'FAIL ')+n+(c?'':'  '+(x||'')));
const D=(y,m,d,hh=12,mm=0)=>new Date(y,m-1,d,hh,mm,0);
const cfg={tardanzaMins:5,nodescHrs:4};
const EM='ana@pibox.app';
const ts=d=>({toDate:()=>d});
// Un día de malla 8:00–16:00 con llegada tardía de `late` min (y salida `extraH` h después del fin programado)
function dia(fecha,late,extraH){
 const [d,m,y]=fecha.split('/').map(Number);
 const row={fecha,usuario:EM,inicio:'8:00:00',fin:'16:00:00',novedad:''};
 const start=new Date(y,m-1,d,8,late,0),end=new Date(y,m-1,d,16+(extraH||0),0,0);
 return{row,turno:{userEmail:EM,status:'ended',startTime:ts(start),endTime:ts(end)}};
}
function calc(dias,now,w,a){const wm=new Map();(w||[]).forEach(x=>wm.set(typeof x==='string'?x:x.id,typeof x==='string'?{motivo:'cita médica',waivedBy:'cromero@pibox.app',waivedByName:'Camilo',waivedAt:'2026-10-10T10:00:00.000Z'}:x));
 const st=E.computeAgentStrikes({email:EM,malla:dias.map(x=>x.row),turnos:dias.map(x=>x.turno),waiverMap:wm,appealMap:new Map((a||[]).map(x=>[x.id,x])),cfg,now});
 return E.applyStrikePolicy(st,now);}

// ── etiquetas / ventana ──
{let v=E.strikeVigencia(D(2026,10,17));
 t('V1 octubre: ventana Agosto–Octubre 2026 (nombres dinámicos)',v.label==='Agosto – Octubre 2026'&&v.nombres==='agosto, septiembre y octubre'&&v.start.getTime()===D(2026,8,1,0).getTime(),JSON.stringify(v.label));
 v=E.strikeVigencia(D(2026,11,1,0,0));t('V1b 1 de noviembre: Septiembre–Noviembre 2026',v.label==='Septiembre – Noviembre 2026'&&v.nombres==='septiembre, octubre y noviembre');
 v=E.strikeVigencia(D(2027,1,15));t('V1c enero: cruza el año («Noviembre 2026 – Enero 2027»)',v.label==='Noviembre 2026 – Enero 2027'&&v.nombres==='noviembre, diciembre y enero');}
// ── casos pedidos ──
{const p=calc([dia('31/7/2026',10)],D(2026,10,17));
 t('T1 un strike del 31 de julio NO cuenta en octubre (queda como Vencido)',p.totalActive===0&&p.vencidos.length===1&&p.counts.leve===0);}
{const dias=[dia('1/8/2026',10)];
 let p=calc(dias,D(2026,10,17));t('T2a un strike del 1 de agosto SÍ cuenta el 17 de octubre',p.totalActive===1&&p.vencidos.length===0);
 p=calc(dias,D(2026,10,31,23,59));t('T2b …y todavía cuenta el 31 de octubre 23:59',p.totalActive===1);
 p=calc(dias,D(2026,11,1,0,0));t('T2c …y el 1 de noviembre deja de contar (Vencido)',p.totalActive===0&&p.vencidos.length===1);
 t('T2d …fecha en que deja de contar = 1/11/2026',E.strikeExpiryDate(D(2026,8,1)).getTime()===D(2026,11,1,0).getTime());}
{const dias=[dia('3/9/2026',10),dia('10/9/2026',10),dia('17/9/2026',10)];
 let p=calc(dias,D(2026,10,17));t('T3a base: 3 leves vigentes = 1 llamado',p.totalActive===3&&p.totalLlamados===1);
 p=calc(dias,D(2026,10,17),[EM+'_20260910_tardanza']);
 t('T3b un strike con apelación aprobada NO cuenta: 2 vigentes, 0 llamados, 1 en «retirados»',p.totalActive===2&&p.totalLlamados===0&&p.waived.length===1&&p.counts.leve===2);
 t('T3c …y no suma al avance hacia el próximo llamado (pending=2, faltan 1)',p.pending.leve===2);
 const w=[{id:EM+'_20260910_tardanza',motivo:'cita',appealId:EM+'_20260910_tardanza',waivedByName:'Coord',waivedAt:'2026-10-12T00:00:00.000Z',appeal:null}];
 const apr={id:EM+'_20260910_tardanza',status:'approved',decidedByName:'Marta Coordinadora',decidedAt:'2026-10-12T15:00:00.000Z'};
 p=calc(dias,D(2026,10,17),w,[apr]);
 t('T3d la apelación aprobada queda en el Historial con quién y cuándo',p.waived.length===1&&p.waived[0].waived.appeal&&p.waived[0].waived.appeal.decidedByName==='Marta Coordinadora');}
{const dias=[dia('6/7/2026',10),dia('13/7/2026',10),dia('20/7/2026',10)];
 let p=calc(dias,D(2026,10,17));
 t('T4a un llamado originado por strikes archivados NO cuenta (julio, visto en octubre)',p.totalLlamados===0&&p.llamadosArchived.length===1&&p.totalActive===0);
 p=calc(dias,D(2026,8,25));t('T4b …pero en agosto sí contaba (control)',p.totalLlamados===1&&p.llamadosActive.length===1);}
// ── casos adicionales de la regla ──
{const dias=[dia('30/6/2026',10),dia('15/7/2026',10),dia('5/8/2026',10)];
 let p=calc(dias,D(2026,10,17));
 t('E1 llamado emitido en agosto con strikes de junio/julio: SIGUE vigente en octubre (cuenta el mes de emisión)',p.totalLlamados===1&&p.totalActive===1&&p.llamadosActive[0].issued.getMonth()===7,JSON.stringify([p.totalLlamados,p.totalActive]));
 p=calc(dias,D(2026,11,1,0,0));t('E1b …y el 1 de noviembre se archiva',p.totalLlamados===0&&p.llamadosArchived.length===1);}
{const dias=[dia('6/7/2026',10),dia('13/7/2026',10),dia('10/10/2026',10)];
 const p=calc(dias,D(2026,10,17));
 t('E2 los strikes archivados NO se acumulan hacia llamados nuevos (2 de julio + 1 de octubre = 0 llamados)',p.totalLlamados===0&&p.totalActive===1&&p.pending.leve===1);}
{const p=calc([dia('3/9/2026',70)],D(2026,10,17));t('E3 una tardanza grave (≥60 min) = 1 llamado',p.totalLlamados===1&&p.counts.grave===1);
 const q=calc([dia('3/9/2026',25),dia('4/9/2026',30)],D(2026,10,17));t('E4 2 moderadas (20–59 min) = 1 llamado',q.totalLlamados===1&&q.counts.moderada===2);
 const r=calc([dia('1/9/2026',0,5),dia('2/9/2026',0,5),dia('3/9/2026',0,5)],D(2026,10,17));t('E5 3 no desconexión (>4 h tras la salida) = 1 llamado',r.totalLlamados===1&&r.counts.nodesc===3);
 const s=calc([dia('1/9/2026',70),dia('2/9/2026',70),dia('3/9/2026',70)],D(2026,10,17));t('E6 3 llamados vigentes (cualquier combinación) = proceso disciplinario',s.totalLlamados===3);}
{const a=calc([dia('3/9/2026',5)],D(2026,10,17));const b=calc([dia('3/9/2026',6)],D(2026,10,17));
 t('E7 tolerancia: 5 min no es strike, 6 min es leve',a.totalActive===0&&b.counts.leve===1);
 const d1=dia('3/9/2026',30);d1.row.novedad='INCAPACIDAD';
 t('E8 un día con novedad en la malla no genera strike',calc([d1],D(2026,10,17)).totalActive===0);}
{const dias=[dia('3/9/2026',10),dia('4/9/2026',10),dia('5/9/2026',10)];
 const p=calc(dias,D(2026,10,17));const h=E.buildLlamadoHistorialVigente(p);
 t('E9 el historial del correo disciplinario usa solo llamados vigentes (máx. 3) con tipos legibles',h.length===1&&h[0].strikes.length===3&&h[0].strikes[0].tipo==='Leve');
 const k=calc([dia('3/9/2026',10),dia('4/9/2026',10),dia('5/9/2026',10)],D(2026,10,17),[{id:EM+'_20260903_tardanza',motivo:'x',waivedBy:'admin@pibox.app'}]);
 t('E10 un retiro directo (sin apelación) también sale de todos los contadores',k.totalActive===2&&k.totalLlamados===0&&k.waived.length===1&&!k.waived[0].waived.appealId);}
{// turnos duplicados el mismo día (caso real Lilleyra 16-oct): manda el inicio más temprano, no el orden de lectura
 const d=dia('16/10/2026',0);const dup={userEmail:EM,status:'active',startTime:ts(new Date(2026,9,16,8,56,0)),endTime:null};
 d.turno.status='active';d.turno.endTime=null;
 const a=E.computeAgentStrikes({email:EM,malla:[d.row],turnos:[dup,d.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,16,23,0)});
 const b=E.computeAgentStrikes({email:EM,malla:[d.row],turnos:[d.turno,dup],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,16,23,0)});
 t('E11 turnos activos duplicados el mismo día: mismo resultado sin importar el orden de lectura (usa el más temprano)',a.length===b.length&&a.every((x,i)=>x.cat===b[i].cat),JSON.stringify([a.map(x=>x.cat),b.map(x=>x.cat)]));}
{// turno activo huérfano (nunca se cerró) vs turno activo de hoy
 const orf=dia('1/10/2026',0);orf.turno.status='active';orf.turno.endTime=null;
 const a=E.computeAgentStrikes({email:EM,malla:[orf.row],turnos:[orf.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,17,22,0)});
 t('E12 turno «active» huérfano de hace días NO inventa un strike de no desconexión',a.length===0,JSON.stringify(a.map(x=>x.cat)));
 const hoy=dia('17/10/2026',0);hoy.turno.status='active';hoy.turno.endTime=null;
 const b=E.computeAgentStrikes({email:EM,malla:[hoy.row],turnos:[hoy.turno],waiverMap:new Map(),appealMap:new Map(),cfg,now:D(2026,10,17,21,30)});
 t('E13 …pero un turno activo de HOY sí se evalúa en vivo (5 h 30 min tras la salida programada → no desconexión)',b.length===1&&b[0].cat==='nodesc',JSON.stringify(b.map(x=>x.cat)));}
out.forEach(l=>console.log(l));
const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log(`\n${out.length-fails}/${out.length} pasan`);process.exit(fails?1:0);
