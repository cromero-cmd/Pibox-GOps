// ═══════════════════════════════════════════
// CONFIG — constantes compartidas y utilidades puras (sin DOM)
// ═══════════════════════════════════════════

export const DAYS_ES = new Set(['LUNES','MARTES','MIÉRCOLES','MIERCOLES','JUEVES','VIERNES','SÁBADO','SABADO','DOMINGO']);

export const LS_TAR  = 'pibox:tariff_v6';
export const LS_RUNS = 'pibox:runs_v6';
export const LS_DICT = 'pibox:diccionario_v1'; // equivalencias aprendidas
export const LS_SESSION = 'pibox:session_v1';
export const LS_EMAIL = 'pibox:email_config';
export const LS_BACKEND_URL = 'pibox:backend_url';

export const PAGE_SIZE = 50;

export const DEFAULT_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwmbBFIA_VbmC8P_W0igDb2tBP0Y9m73h00WGM9DbI-jd9Fd6toHcmRF0YyOOEAioTKYQ/exec';

export function getBackendUrl(){
  return localStorage.getItem(LS_BACKEND_URL) ||
    document.getElementById('envio-url')?.value?.trim() ||
    DEFAULT_BACKEND_URL;
}

export const normStr = s => String(s||'').trim().replace(/\s+/g,' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
export const cop = n => { const r=Math.round(n); return (r<0?'-$':'$')+Math.abs(r).toLocaleString('es-CO'); };
export const fmtDT = iso => { try{ return new Date(iso).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'}); }catch{ return iso; }};

export function parseDate(raw){
  if(raw===null||raw===undefined||raw==='') return null;
  // Serial numérico de Excel → más confiable que cualquier string
  if(typeof raw==='number'){ try{ const d=XLSX.SSF.parse_date_code(raw); if(d&&d.y>1900) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }catch{} }
  const s=String(raw).trim();
  if(!s||s==='—') return null;
  // Ya YYYY-MM-DD correcto
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // DD/MM/YYYY o MM/DD/YYYY — detectar por heurística:
  // si el primer número > 12 → es DD/MM/YYYY (día no puede ser mes)
  // si el segundo número > 12 → es MM/DD/YYYY (mes no puede ser día)
  // si ambos ≤ 12 → asumir DD/MM/YYYY (convención Colombia)
  const m1=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if(m1){
    let y=parseInt(m1[3]); if(y<100)y+=2000;
    const a=parseInt(m1[1]), b=parseInt(m1[2]);
    let day, mon;
    if(a>12){ day=a; mon=b; }       // a>12 → definitivamente día
    else if(b>12){ day=b; mon=a; }  // b>12 → definitivamente mes → a es día? No: a=mes, b=día
    else { day=a; mon=b; }           // ambos ≤12 → asumir DD/MM (Colombia)
    // Corrección: si b>12, significa que b es el día y a es el mes (MM/DD/YYYY)
    if(b>12){ mon=a; day=b; }
    return `${y}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  // DD/MM sin año
  const m2=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if(m2){ const y=new Date().getFullYear(); const a=parseInt(m2[1]),b=parseInt(m2[2]); const day=a>12?a:a, mon=a>12?b:b; return `${y}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
  return s;
}
