// Simulación mínima de Google Docs para probar la plantilla del llamado (reg_pdfLlamado) SIN Google.
// Reproduce lo que importa del comportamiento real de Docs:
//  · un párrafo NUEVO creado con insertParagraph(i, "texto") sale con el formato por defecto (Arial 11, sin sangrías…), NO hereda el de su vecino;
//  · insertParagraph(i, parrafoCopiado) inserta una copia con TODO su formato;
//  · setText conserva el formato del párrafo;
//  · el último párrafo del documento no se puede borrar;
//  · el PDF tiene una página extra si al final queda un párrafo vacío «grande» o un salto de página.
// Google real lanza este error al insertar/asignar texto VACÍO (setText(''), insertText(i,''), appendText('')); replaceText con '' SÍ funciona.
const ERR_VACIO='No es posible insertar un elemento de texto vacío';
const A={FONT_FAMILY:'FONT_FAMILY',FONT_SIZE:'FONT_SIZE',SPACING_BEFORE:'SPACING_BEFORE',SPACING_AFTER:'SPACING_AFTER',LINE_SPACING:'LINE_SPACING'};
const ET={BODY_SECTION:'BODY_SECTION',PARAGRAPH:'PARAGRAPH',PAGE_BREAK:'PAGE_BREAK',INLINE_IMAGE:'INLINE_IMAGE',INLINE_DRAWING:'INLINE_DRAWING',HORIZONTAL_RULE:'HORIZONTAL_RULE'};
const DEFECTO={fuente:'Arial',tam:11,alin:'LEFT',inter:1,sang1:0,sangI:0,antes:0,despues:0};
class P{
 constructor(b,t,a,hijos){this.b=b;this.t=t;this.a=Object.assign({},DEFECTO,a||{});
  this.hijos=(hijos||[]).map(tp=>{const h={getType:()=>tp,removeFromParent:()=>{this.hijos=this.hijos.filter(x=>x!==h);}};return h;});}
 getType(){return ET.PARAGRAPH;}asParagraph(){return this;}getParent(){return this.b;}
 getText(){return this.t;}
 setText(x){if(x===''||x==null)throw new Error(ERR_VACIO);this.t=x;return this;}
 insertText(i,x){if(x==='')throw new Error(ERR_VACIO);this.t=this.t.slice(0,i)+x+this.t.slice(i);return this;}
 appendText(x){if(x==='')throw new Error(ERR_VACIO);this.t+=x;return this;}
 // clear() deja el párrafo sin texto; de forma conservadora se pierde la fuente/tamaño del texto (el párrafo vacío vuelve a los de por defecto)
 clear(){this.t='';this.a.fuente=DEFECTO.fuente;this.a.tam=DEFECTO.tam;return this;}
 copy(){return new P(null,this.t,this.a,this.hijos.map(h=>h.getType()));}
 getNumChildren(){return this.hijos.length;}getChild(i){return this.hijos[i];}
 setAttributes(o){if(o[A.FONT_FAMILY]!==undefined)this.a.fuente=o[A.FONT_FAMILY];if(o[A.FONT_SIZE]!==undefined)this.a.tam=o[A.FONT_SIZE];if(o[A.SPACING_BEFORE]!==undefined)this.a.antes=o[A.SPACING_BEFORE];if(o[A.SPACING_AFTER]!==undefined)this.a.despues=o[A.SPACING_AFTER];if(o[A.LINE_SPACING]!==undefined)this.a.inter=o[A.LINE_SPACING];return this;}
 getAlignment(){return this.a.alin;}getLineSpacing(){return this.a.inter;}getIndentFirstLine(){return this.a.sang1;}getIndentStart(){return this.a.sangI;}getSpacingBefore(){return this.a.antes;}getSpacingAfter(){return this.a.despues;}
 editAsText(){const s=this;return{getText:()=>s.t,getFontFamily:()=>s.a.fuente,getFontSize:()=>s.a.tam,
  setFontSize(n){if(s.t==='')throw new Error('Offset fuera de rango en un texto vacío');s.a.tam=n;return this;},
  deleteText(a,b){if(s.t==='')throw new Error('Offset fuera de rango en un texto vacío');s.t=s.t.slice(0,a)+s.t.slice(b+1);return this;},
  insertText(i,x){return s.insertText(i,x);},appendText(x){return s.appendText(x);}};}
}
class Body{
 constructor(spec){this.ch=[];(spec||[]).forEach(x=>{const o=typeof x==='string'?{t:x}:x;const p=new P(this,o.t,o.a,o.hijos);this.ch.push(p);});}
 getType(){return ET.BODY_SECTION;}asBody(){return this;}
 getChildIndex(p){return this.ch.indexOf(p);}getChild(i){return this.ch[i];}getNumChildren(){return this.ch.length;}
 removeChild(p){if(this.ch[this.ch.length-1]===p)throw new Error("Can't remove the last paragraph in a document section");this.ch.splice(this.ch.indexOf(p),1);}
 insertParagraph(i,x){const p=typeof x==='string'?new P(this,x):x;p.b=this;this.ch.splice(i,0,p);return p;}
 replaceText(re,rep){if(rep===''&&this.replaceVacioFalla)throw new Error('replaceText con cadena vacía no disponible (simulado)');const r=new RegExp(re,'g');this.ch.forEach(p=>{p.t=p.t.replace(r,()=>rep.replace(/\\\$/g,'$'));});}
 findText(re){const r=new RegExp(re);const p=this.ch.find(x=>r.test(x.t));if(!p)return null;const m=p.t.match(r);const ini=m.index,fin=m.index+m[0].length-1;
  return{getElement:()=>({getParent:()=>p,asText:()=>p.editAsText()}),getStartOffset:()=>ini,getEndOffsetInclusive:()=>fin};}
 getText(){return this.ch.map(p=>p.t).join('\n');}getParagraphs(){return this.ch;}
 // páginas del PDF resultante (modelo simple del problema de la hoja en blanco)
 paginas(){const u=this.ch[this.ch.length-1];const saltos=this.ch.some(p=>p.hijos.some(h=>h.getType()===ET.PAGE_BREAK));
  const vacioGrande=u&&u.t.trim()===''&&u.a.tam>1&&this.ch.length>1&&this.ch[this.ch.length-2].t.trim()==='';
  const ultimoVacioGrande=u&&u.t.trim()===''&&u.a.tam>1;
  return 1+((saltos||ultimoVacioGrande||vacioGrande)?1:0);}
 pdfTexto(){const n=this.paginas();let s='%PDF-1.4\n1 0 obj << /Type /Pages /Count '+n+' >>\n';for(let i=0;i<n;i++)s+=(i+2)+' 0 obj << /Type /Page /Parent 1 0 R >>\n';return s;}
}
const CG={fuente:'Century Gothic',tam:12,alin:'JUSTIFY',inter:1.15,sang1:0,sangI:0,antes:0,despues:0};
// Plantilla típica del llamado: texto en Century Gothic 12 justificado; nota amarilla entre marcadores; y el FINAL problemático
// (párrafos vacíos y un salto de página después de la firma) que producía la segunda hoja con solo el membrete.
const plantilla=(o={})=>[
 {t:'Bogotá, {{FECHA}}',a:CG},{t:'Señor(a) {{NOMBRE}} — {{CARGO}} — CC {{CEDULA}}',a:CG},{t:'Causal: {{CAUSAL}}',a:CG},
 {t:o.previo||'Por medio de la presente se le llama la atención por las siguientes faltas:',a:o.aPrevio||CG},
 {t:'{{DESCRIPCION_FALTAS}}',a:o.aMarcador||CG},
 {t:'',a:CG},{t:'{{INICIO_NOTA}}',a:CG},{t:'NOTA PARA QUIEN DILIGENCIA EL DOCUMENTO (amarilla)…',a:CG},{t:'{{FIN_NOTA}}',a:CG},
 {t:'Atentamente,',a:CG},{t:'{{FIRMANTE}}',a:CG},{t:'{{CARGO_FIRMANTE}}',a:CG}
 ].concat(o.final===false?[]:[{t:'',a:CG},{t:'',a:CG},{t:'',a:CG,hijos:[ET.PAGE_BREAK]}]);
module.exports={A,ET,P,Body,CG,plantilla,ERR_VACIO};
