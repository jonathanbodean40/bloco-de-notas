/* Read-only format helpers for synthetic export tests; not loaded by the application. */
(function(root){
'use strict';
const tick=String.fromCharCode(96);
function validate(note){if(!note||typeof note.id!=='string'||!note.id||typeof note.content!=='string'||note.deletedAt)throw new TypeError('Nota indisponível para exportação');return note;}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function safeUrl(s){
 if(typeof s!=='string'||/[\u0000-\u0020\u007f<>]/.test(s))return null;
 try{const u=new URL(/^www\./i.test(s)?'https://'+s:s);
  if(['https:','http:'].includes(u.protocol)&&u.hostname)return u.href;
  if(['mailto:','tel:'].includes(u.protocol)&&u.pathname)return u.href;
 }catch(_){}return null;
}
function safeImage(src){return typeof src==='string'&&(/^(data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+)$/i.test(src)||(/^https?:/i.test(src)&&!!safeUrl(src)));}
function filename(note,format){
 validate(note);if(!['md','html','txt'].includes(format))throw new TypeError('Formato inválido');
 const title=String(note.title||'Sem título').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 _-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,75)||'Nota';
 const id=note.id.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,90);
 return title+'--'+id+'.'+format;
}
function parse(note){
 const t=root.document.createElement('template');t.innerHTML=validate(note).content;
 const wrapper=t.content.querySelector('[data-notas-pro="3"]');
 let layout={};try{layout=JSON.parse(wrapper?.getAttribute('data-layout')||'{}');}catch(_){}
 if(!layout||typeof layout!=='object'||Array.isArray(layout))layout={};
 return {body:wrapper?.querySelector('[data-note-body]')||wrapper||t.content,layout};
}
function sections(note){
 const {body,layout}=parse(note),output=[];
 if(layout.kind==='onyx'&&Array.isArray(layout.onyxRows)&&layout.onyxRows.length){
  layout.onyxRows.forEach((row,i)=>{const t=root.document.createElement('template');t.innerHTML=String(row?.html||'');
   output.push({label:'Planeamento OnyxCeph '+(i+1),node:t.content,images:Array.isArray(row?.images)?row.images.filter(safeImage):[]});});
 }else{
  output.push({label:null,node:body,images:[]});
  for(const obj of Array.isArray(layout.objects)?layout.objects:[]){
   if(obj?.type==='textbox'&&typeof obj.html==='string'){
    const t=root.document.createElement('template');t.innerHTML=obj.html;output.push({label:'Caixa de texto',node:t.content,images:[]});
   }
   if(obj?.type==='image'&&safeImage(obj.src))output.push({label:'Imagem da nota',node:null,images:[obj.src]});
   if(obj?.type==='symbol'&&obj.symbol)output.push({label:'Símbolo',node:null,images:[],text:String(obj.symbol)});
  }
 }
 return output;
}
function link(base,scope,note){
 const u=new URL(String(base));if(!['http:','https:'].includes(u.protocol))throw new TypeError('Endereço inválido');
 u.search='';u.hash='';u.searchParams.set('note',note.id);u.searchParams.set('scope',String(scope));return u.href;
}
function mdEscape(s){return String(s).replace(/([\\*_{}\[\]#|])/g,'\\$1').replaceAll(tick,'\\'+tick);}
function asText(s){return String(s).split(/((?:https?:\/\/|www\.)[^\s<>"\u200b]+)/gi).map(v=>{
 if(!/^(?:https?:\/\/|www\.)/i.test(v))return mdEscape(v);
 let value=v;while(/[.,;!?]$/.test(value))value=value.slice(0,-1);
 while(value.endsWith(')')&&(value.match(/\)/g)||[]).length>(value.match(/\(/g)||[]).length)value=value.slice(0,-1);
 const href=safeUrl(value);return href?'<'+href.replace(/>/g,'%3E')+'>'+mdEscape(v.slice(value.length)):mdEscape(v);
}).join('');}
function childMD(parent){return [...(parent.childNodes||[])].map(mdNode).join('');}
function mdNode(node){
 if(node.nodeType===3)return asText(node.textContent||'');
 if(node.nodeType!==1)return '';
 const tag=node.tagName.toLowerCase(),children=()=>childMD(node);
 if(['script','style','iframe','object','embed','svg','math','form','input','button','link','meta'].includes(tag))return '';
 if(tag==='br')return '\n';
 if(tag==='img')return '[Imagem disponível na nota original]';
 if(tag==='a'){const href=safeUrl(node.getAttribute('href'));const label=(node.textContent||'').trim()||href||'ligação';return href?'['+mdEscape(label)+'](<'+href.replace(/>/g,'%3E')+'>)':asText(label);}
 if(['b','strong'].includes(tag))return '**'+children()+'**';
 if(['i','em'].includes(tag))return '*'+children()+'*';
 if(tag==='code')return tick+String(node.textContent||'').replaceAll(tick,'\\'+tick)+tick;
 if(tag==='li')return '- '+children().trim()+'\n';
 if(/^h[1-6]$/.test(tag))return '\n'+('#'.repeat(Number(tag[1])))+' '+children().trim()+'\n\n';
 if(tag==='tr')return '\n'+[...node.children].map(e=>childMD(e).trim()).join(' | ')+'\n';
 if(['p','div','section','article','ul','ol','blockquote','table','pre'].includes(tag))return '\n'+children()+'\n';
 return children();
}
function markdown(note,base,scope){
 validate(note);const out=['# '+mdEscape(note.title||'Sem título'),'',
 'Cópia legível · última alteração: '+String(note.updatedAt||''),'',
 '✏ [EDITAR ESTA NOTA NO BLOCO DE NOTAS PRO](<'+link(base,scope,note)+'>)',''];
 for(const section of sections(note)){
  if(section.label)out.push('## '+mdEscape(section.label),'');
  if(section.node){const body=childMD(section.node).replace(/\n{3,}/g,'\n\n').trim();if(body)out.push(body,'');}
  if(section.text)out.push(mdEscape(section.text),'');
  if(section.images.length)out.push('_'+section.images.length+' imagem(ns): consultar a nota original ou exportar em HTML._','');
 }
 return out.join('\n').trim()+'\n';
}
const ALLOWED=new Set('DIV P BR SPAN B STRONG I EM U S STRIKE DEL FONT UL OL LI BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 A IMG TABLE THEAD TBODY TFOOT TR TD TH HR SUB SUP'.split(' '));
function safeHTML(source){
 const result=root.document.createElement('div');
 function add(n,p){
  if(n.nodeType===3){p.append(root.document.createTextNode(n.textContent||''));return;}
  if(n.nodeType!==1)return;
  const tag=n.tagName;
  if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','LINK','META','SVG','MATH'].includes(tag))return;
  if(!ALLOWED.has(tag)){for(const c of n.childNodes)add(c,p);return;}
  const el=root.document.createElement(tag.toLowerCase());
  if(tag==='A'){const href=safeUrl(n.getAttribute('href'));if(href){el.href=href;el.rel='noopener noreferrer';el.target='_blank';}}
  if(tag==='IMG'){const src=n.getAttribute('src');if(!safeImage(src))return;el.src=src;el.alt=n.getAttribute('alt')||'Imagem';el.style.maxWidth='100%';}
  if(n.hasAttribute('style')){
   const props=new Set(['color','background-color','font-weight','font-style','font-size','font-family','text-decoration','text-align','line-height','white-space']);
   for(const prop of n.style){const val=n.style.getPropertyValue(prop);if(props.has(prop)&&val&&!/url\s*\(|expression|var\s*\(|@import|[<>]/i.test(val))el.style.setProperty(prop,val);}
  }
  for(const c of n.childNodes)add(c,el);
  p.append(el);
 }
 for(const n of source.childNodes||[])add(n,result);
 return result.innerHTML;
}
function html(note,base,scope){
 validate(note);const title=note.title||'Sem título';
 const parts=sections(note).map(s=>'<section>'+(s.label?'<h2>'+escapeHTML(s.label)+'</h2>':'')+
  (s.node?safeHTML(s.node):'')+(s.text?'<p>'+escapeHTML(s.text)+'</p>':'')+
  s.images.map(url=>'<figure><img alt="Imagem da nota" src="'+escapeHTML(url)+'"></figure>').join('')+'</section>').join('');
 return '<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: https: http:; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">'+
  '<title>'+escapeHTML(title)+'</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 18px;color:#243442}a{color:#126085;overflow-wrap:anywhere}header{border-bottom:1px solid #dce4eb;padding-bottom:18px;margin-bottom:20px}h1{font-size:27px;line-height:1.25}h2{font-size:20px}section{margin:16px 0 28px;overflow-wrap:anywhere}img{max-width:100%;height:auto;border-radius:5px}figure{margin:14px 0}pre{white-space:pre-wrap}table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}small{color:#5e7180}</style></head><body><header><h1>'+
  escapeHTML(title)+'</h1><p><small>Última alteração: '+escapeHTML(note.updatedAt||'')+
  '</small></p><p><a href="'+escapeHTML(link(base,scope,note))+'" rel="noopener noreferrer" target="_blank">Abrir a nota original para editar</a></p></header><main>'+parts+'</main></body></html>';
}
function plainText(note,base,scope){
  const body=markdown(note,base,scope)
    .replace(/\[(.+?)\]\(<([^>]+)>\)/g,'$1: $2')
    .replace(/^#{1,6} +/gm,'')
    .replace(/\*\*/g,'')
    .replace(/\\([\\`*_{}\[\]#|])/g,'$1');
  return body;
}
function make(note,format,base,scope){
  validate(note);
  if(!['md','html','txt'].includes(format))throw new TypeError('Formato inválido');
  const data=format==='html'?html(note,base,scope):format==='txt'?plainText(note,base,scope):markdown(note,base,scope);
  const mime=format==='html'?'text/html;charset=utf-8':format==='txt'?'text/plain;charset=utf-8':'text/markdown;charset=utf-8';
  return{name:filename(note,format),data,mime};
}
const api=Object.freeze({filename,safeUrl,make,markdown,html});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.NotasReadableExport=api;
})(globalThis);
