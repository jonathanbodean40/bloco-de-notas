(() => {
  'use strict';
  const GUEST_KEY = 'notas-exclusivas-pro-v2';
  const FAVORITES_KEY = `${GUEST_KEY}:favorite-colors`;
  const $ = selector => document.querySelector(selector);
  const workspace = $('#workspace'), menu = $('#custom-context-menu'), status = $('#save-status');
  const windows = new Map();
  const backgrounds = {Azul:'#eaf4fc',Amarelo:'#fff9dc',Laranja:'#fff0e2',Verde:'#edf7e9',Branco:'#ffffff',Rosa:'#fceef3',Lilás:'#f2ecfa'};
  const symbols = ['←','→','↑','↓','↔','↕','↗','↘','✓','✗','★','●','■','▲','◆','♥','+','−'];
  const config = window.NOTAS_CONFIG || {};
  const route = new URL(location.href);
  const detachedId = route.searchParams.get('note');
  const detachedScope = route.searchParams.get('scope') || 'guest';
  const popupHandles = new Map();
  const detached = !!detachedId;
  const mobileNotes = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints>1 && matchMedia('(max-width:1100px)').matches);
  document.body.classList.toggle('detached',detached);document.body.classList.toggle('mobile-notes',mobileNotes);
  if(config.preview){document.body.classList.add('preview');const badge=document.createElement('span');badge.className='preview-badge';badge.textContent='Pré-visualização local · notas de teste';$('#app-header .brand').append(badge);}
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');
  const cloud = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let user = null, active = null, savedRange = null, zIndex = 1, titleHtmlSupported = true, applyingEdit = false;
  let syncTimer, syncFlight = null, syncAgain = false, sessionEpoch = 0, pendingTitle = null, imageTarget = null, localSaveFailed = false;
  let notes = loadNotes(GUEST_KEY);
  let favorites = readJSON(FAVORITES_KEY, {text:[],highlight:[]});
  if (!favorites || !Array.isArray(favorites.text) || !Array.isArray(favorites.highlight)) favorites = {text:[],highlight:[]};
  function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function loadNotes(key) {
    const data=readJSON(key,[]), all=Array.isArray(data)?data.filter(n=>n&&typeof n.id==='string'):[];
    // Per-note entries keep concurrent edits in separate windows from overwriting each other.
    try{for(const k of Object.keys(localStorage)){if(k.startsWith(`${key}:entry:`)){const n=readJSON(k,null);if(n&&typeof n.id==='string')all.push(n);}}}catch{}
    return [...latestById(all).values()];
  }
  function storageKey() { return user ? `${GUEST_KEY}:${user.id}` : GUEST_KEY; }
  function persist() {
    try {
      notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];
      for(const n of notes){const key=`${storageKey()}:entry:${n.id}`,old=readJSON(key,null);if(!old||Date.parse(n.updatedAt)>Date.parse(old.updatedAt))localStorage.setItem(key,JSON.stringify(n));}
      notes.sort((a,b)=>a.id.localeCompare(b.id));localStorage.setItem(storageKey(), JSON.stringify(notes)); localSaveFailed=false;return true;
    }
    catch { localSaveFailed=true;status.textContent = 'Não foi possível guardar: armazenamento cheio ou indisponível. Mantenha a página aberta e reduza as imagens.'; return false; }
  }
  function makeId() { return self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
  function timestamp(previous) { return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString(); }
  function clamp(n, min, max) { return Math.min(Math.max(Number(n) || min, min), Math.max(min, max)); }
  function plainText(html) { const t = document.createElement('template'); t.innerHTML = html || ''; return (t.content.textContent || '').trim(); }
  function cleanHTML(html) {
    const template = document.createElement('template'); template.innerHTML = typeof html === 'string' ? html : '';
    removeClipboardEnvelopes(template.content);
    const allowed = new Set('DIV P BR SPAN B STRONG I EM U S STRIKE DEL FONT UL OL LI BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 A IMG TABLE THEAD TBODY TFOOT TR TD TH HR SUB SUP'.split(' '));
    template.content.querySelectorAll('*').forEach(el => {
      if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','LINK','META','SVG','MATH'].includes(el.tagName)) { el.remove(); return; }
      if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!['style','href','src','alt','title','color','face','size','width','height','colspan','rowspan'].includes(name)) el.removeAttribute(attr.name);
      });
      if (el.hasAttribute('href') && !safeLink(el.getAttribute('href'))) el.removeAttribute('href');
      if (el.tagName === 'A') {el.setAttribute('rel','noopener noreferrer');el.setAttribute('target','_blank');}
      if (el.tagName === 'IMG' && !safeImage(el.getAttribute('src'))) { el.remove(); return; }
      const css = el.style;
      [...css].forEach(prop => { if (!/^(color|background-color|font-size|font-family|font-weight|font-style|text-decoration(-line|-color|-style)?|text-align|vertical-align|white-space|line-height|list-style-type|width|height|max-width|border(-color|-width|-style)?|padding(-left|-right|-top|-bottom)?|margin(-left|-right|-top|-bottom)?)$/.test(prop) || /url\s*\(|expression|javascript|var\(/i.test(css.getPropertyValue(prop))) css.removeProperty(prop); });
    });
    return template.innerHTML;
  }
  function removeClipboardEnvelopes(root) {
    // Earlier pastes retained the clipboard's transport whitespace around its fragment.
    // Remove only whitespace outside a matching fragment, never inside selected text.
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_COMMENT),comments=[];
    while(walker.nextNode())comments.push(walker.currentNode);
    for(const start of comments){
      if(start.data.trim()!=='StartFragment'||!start.parentNode)continue;
      let end=start.nextSibling;
      while(end&&!(end.nodeType===Node.COMMENT_NODE&&end.data.trim()==='EndFragment'))end=end.nextSibling;
      if(!end)continue;
      const before=[],after=[];
      for(let n=start.previousSibling;n;n=n.previousSibling)before.push(n);
      for(let n=end.nextSibling;n;n=n.nextSibling)after.push(n);
      const whitespace=n=>n.nodeType===Node.TEXT_NODE&&/^\s*$/.test(n.textContent);
      if(before.every(whitespace))before.forEach(n=>n.remove());
      if(after.every(whitespace))after.forEach(n=>n.remove());
      start.remove();end.remove();
    }
  }
  function copyNoteFragment(editor,range){
    const map=new Map(),props=['font-family','font-size','font-weight','font-style','color','text-decoration','line-height','white-space'];
    function styleFor(el){const css=getComputedStyle(el),span=document.createElement('span');for(const prop of props)span.style.setProperty(prop,css.getPropertyValue(prop));const decorations=new Set();for(let parent=el;parent&&parent!==editor;parent=parent.parentElement){for(const d of getComputedStyle(parent).textDecorationLine.split(' '))if(d==='underline'||d==='line-through')decorations.add(d);}if(decorations.size)span.style.textDecoration=[...decorations].join(' ');let bg=el;while(bg&&bg!==editor){const color=getComputedStyle(bg).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){span.style.backgroundColor=color;break;}bg=bg.parentElement;}return span;}
    function clone(node){if(node.nodeType===3){const span=styleFor(node.parentElement),text=document.createTextNode(node.data);span.append(text);map.set(node,text);return span;}const out=node.cloneNode(false);map.set(node,out);if(node.nodeType===1){out.removeAttribute('id');out.removeAttribute('contenteditable');const css=styleFor(node);for(const prop of [...css.style])out.style.setProperty(prop,css.style.getPropertyValue(prop));}for(const child of node.childNodes)out.append(clone(child));return out;}
    clone(editor);const copied=document.createRange();copied.setStart(map.get(range.startContainer),range.startOffset);copied.setEnd(map.get(range.endContainer),range.endOffset);const fragment=styleFor(range.startContainer.nodeType===3?range.startContainer.parentElement:range.startContainer);fragment.setAttribute('data-notas-clipboard','1');fragment.append(copied.cloneContents());return fragment.outerHTML;
  }
  function cleanClipboardHTML(html) {
    const start=/<!--\s*StartFragment\s*-->/i.exec(html);
    if(start){const offset=start.index+start[0].length,end=/<!--\s*EndFragment\s*-->/i.exec(html.slice(offset));if(end)html=html.slice(offset,offset+end.index);}
    const t=document.createElement('template');t.innerHTML=html;
    if(t.content.querySelector('[data-notas-clipboard="1"]'))return cleanHTML(t.innerHTML);
    t.content.querySelectorAll('div,p,section,article,body,table,td').forEach(el=>{el.style.removeProperty('background');el.style.removeProperty('background-color');});
    const walker=document.createTreeWalker(t.content,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(!node.parentElement?.closest('a,code,pre'))node.textContent=capitalizeWords(node.textContent);}
    t.content.querySelectorAll('*').forEach(el=>{el.style.fontSize='13px';el.removeAttribute('size');});return '<span style="font-size:13px">'+cleanHTML(t.innerHTML)+'</span>';
  }
  function safeImage(src) { return typeof src === 'string' && /^(data:image\/(png|jpeg|webp|gif|avif);base64,|https?:\/\/)/i.test(src); }
  function decode(content) {
    const t = document.createElement('template'); t.innerHTML = content || '';
    const root = t.content.querySelector('[data-notas-pro="3"]');
    let meta = {};
    if (root) { try { meta = JSON.parse(root.getAttribute('data-layout') || '{}'); } catch {} }
    if(!meta || typeof meta!=='object' || Array.isArray(meta))meta={};
    const objects = Array.isArray(meta.objects) ? meta.objects.map(o=>decodeObject(o)).filter(Boolean) : [];
    return {html:cleanHTML(root ? root.querySelector('[data-note-body]')?.innerHTML || '' : content), bg:Object.values(backgrounds).includes(meta.bg) ? meta.bg : '#ffffff', textWidth:clamp(meta.textWidth || 100,25,100),objects,kind:meta.kind==='onyx'?'onyx':'normal',onyxRows:decodeOnyx(meta.onyxRows),shipments:decodeShipments(meta.shipments),folders:decodeFolders(meta.folders),location:validLocation(meta.location),rect:meta.rect || null,popupRect:meta.popupRect||null};
  }
  function decodeOnyx(rows){return Array.isArray(rows)?rows.slice(0,300).map(r=>({html:cleanHTML(r?.html||''),imageLayouts:Array.isArray(r?.imageLayouts)?r.imageLayouts.slice(0,50).map(v=>({x:Math.min(1,Math.max(0,Number(v?.x)||0)),y:Math.min(20000,Math.max(0,Number(v?.y)||0)),locked:v?.locked===true})):[],images:Array.isArray(r?.images)?r.images.filter(safeImage).slice(0,50):[]})):[];}
  async function compactOnyxImage(src){
    if(!src.startsWith('data:')||src.length<180000)return src;
    const img=new Image();img.src=src;await img.decode();const canvas=document.createElement('canvas');let scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));let result=src;
    for(let i=0;i<5;i++){canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const candidate=canvas.toDataURL('image/webp',.84-i*.05);if(candidate.length<result.length)result=candidate;if(result.length<180000)break;scale*=.8;}return result;
  }
  async function addOnyxImages(w,row,files){
    const images=[...files].filter(f=>/^image\/(png|jpeg|webp|gif|avif)$/.test(f.type));if(!images.length)return;
    captureTextBoxes(w);
    try{for(const file of images){if(file.size>8*1024*1024)throw new Error('Cada imagem pode ter até 8 MB.');const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});row.images.push(await compactOnyxImage(src));}renderOnyx(w);fitPaper(w);commit(w);}catch(e){status.textContent=e.message||'Não foi possível adicionar a imagem.';}
  }
  function renderOnyx(w){
    w.paper.querySelector('.onyx-board')?.remove();w.editor.hidden=w.kind==='onyx';w.el.classList.toggle('onyx-note',w.kind==='onyx');if(w.kind!=='onyx')return;
    const board=document.createElement('div');board.className='onyx-board';
    const heading=document.createElement('div');heading.className='onyx-heading';heading.append(textElement('strong','Planeamentos OnyxCeph'),button('Otimizar imagens',async()=>{captureTextBoxes(w);try{for(const row of w.onyxRows)row.images=await Promise.all(row.images.map((src,i)=>row.imageLayouts?.[i]?.locked?src:compactOnyxImage(src)));renderOnyx(w);commit(w);status.textContent='Imagens otimizadas. Clique em Guardar.';}catch{status.textContent='Não foi possível otimizar as imagens. O conteúdo foi mantido.';}}),button('＋ Adicionar linha',()=>{captureTextBoxes(w);w.onyxRows.push({html:'',images:[]});renderOnyx(w);fitPaper(w);commit(w);}));board.append(heading);
    w.onyxRows.forEach((row,index)=>{
      const pair=document.createElement('section');pair.className='onyx-row';
      const left=document.createElement('div');left.className='onyx-left';const caption=textElement('div','TEXTO E LINK');caption.className='onyx-caption';
      const editor=document.createElement('div');editor.className='onyx-text';editor.contentEditable='true';editor.dataset.row=String(index);editor.setAttribute('role','textbox');editor.setAttribute('aria-label',`Texto e link do planeamento ${index+1}`);editor.dataset.placeholder='Escreva a descrição e cole o link 3D do OnyxCeph…';editor.innerHTML=row.html;left.append(caption,editor);bindEditable(w,editor);linkify(w,false,editor);
      const right=document.createElement('div');right.className='onyx-images';const top=document.createElement('div');top.className='onyx-image-heading';top.append(textElement('span','IMAGENS'));
      const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif,image/avif';input.multiple=true;input.hidden=true;input.addEventListener('change',()=>addOnyxImages(w,row,input.files));top.append(button('＋ Imagens',()=>input.click()),input);right.append(top);
      const gallery=document.createElement('div');gallery.className='onyx-gallery';gallery.tabIndex=0;gallery.setAttribute('aria-label',`Imagens do planeamento ${index+1}. Pode colar ou arrastar imagens aqui.`);
      row.imageLayouts=row.imageLayouts||[];
      row.images.forEach((src,i)=>{
        const layout=row.imageLayouts[i]||(row.imageLayouts[i]={x:i%2,y:Math.floor(i/2)*120,locked:false});
        const figure=document.createElement('figure'),img=document.createElement('img');img.src=src;img.draggable=false;img.alt=`Imagem ${i+1} do planeamento ${index+1}`;
        const position=()=>{figure.style.left=`${layout.x*60}%`;figure.style.top=`${layout.y}px`;};position();figure.classList.toggle('image-locked',layout.locked);
        const lock=button(layout.locked?'🔒':'🔓',()=>{captureTextBoxes(w);layout.locked=!layout.locked;renderOnyx(w);fitPaper(w);commit(w);});lock.className='onyx-image-lock';lock.setAttribute('aria-label',`${layout.locked?'Desbloquear':'Bloquear'} imagem ${i+1}`);lock.setAttribute('aria-pressed',String(layout.locked));lock.title=layout.locked?'Desbloquear edição':'Bloquear edição';
        const remove=button('×',()=>{if(layout.locked)return;captureTextBoxes(w);row.images.splice(i,1);row.imageLayouts.splice(i,1);renderOnyx(w);fitPaper(w);commit(w);});remove.disabled=layout.locked;remove.setAttribute('aria-label',`Remover imagem ${i+1} do planeamento ${index+1}`);
        figure.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button')||layout.locked)return;e.stopPropagation();const initial={x:layout.x,y:layout.y};const travel=Math.max(1,gallery.clientWidth*.6),height=Math.max(0,gallery.clientHeight-105);w.cancelObjectGesture=gesture(e,(dx,dy)=>{layout.x=Math.min(1,Math.max(0,initial.x+dx/(w.zoom||1)/travel));layout.y=Math.min(height,Math.max(0,initial.y+dy/(w.zoom||1)));position();},()=>{w.cancelObjectGesture=null;commit(w);},()=>{w.cancelObjectGesture=null;Object.assign(layout,initial);position();});});
        figure.append(img,lock,remove);gallery.append(figure);
      });
      gallery.style.height=`${Math.max(240,...row.imageLayouts.map(v=>v.y+140))}px`;
      if(!row.images.length)gallery.append(textElement('span','Adicione, arraste ou cole imagens aqui'));
      right.addEventListener('dragover',e=>e.preventDefault());right.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();addOnyxImages(w,row,e.dataTransfer.files);});right.addEventListener('paste',e=>{if(e.clipboardData.files.length){e.preventDefault();e.stopPropagation();addOnyxImages(w,row,e.clipboardData.files);}});right.append(gallery);
      const removeRow=button('Eliminar linha',()=>{if((plainText(row.html)||row.images.length)&&!confirm('Eliminar esta linha e as suas imagens?'))return;captureTextBoxes(w);w.onyxRows.splice(index,1);renderOnyx(w);fitPaper(w);commit(w);});removeRow.className='onyx-remove-row';left.append(removeRow);pair.append(left,right);board.append(pair);
    });w.paper.append(board);
  }

  function decodeObject(source,allowBox=true){
    if(!source||!((source.type==='image'&&safeImage(source.src))||(source.type==='symbol'&&symbols.includes(source.symbol))||(allowBox&&source.type==='textbox')))return null;
    const o={id:typeof source.id==='string'?source.id:makeId(),type:source.type,src:source.src,symbol:source.symbol,color:/^#[0-9a-f]{6}$/i.test(source.color)?source.color:'#243039',x:clamp(source.x,0,20000),y:clamp(source.y,0,20000),w:clamp(source.w,.1,100000),h:clamp(source.h,.1,100000),rotation:angle(source.rotation),crop:validCrop(source.crop)};
    o.pinned=source.pinned===true;
    if(o.type==='textbox')o.bg=/^#[0-9a-f]{6}$/i.test(source.bg)?source.bg:'#ffffff';
    o.sourceRatio=Number(source.sourceRatio)>0?Number(source.sourceRatio):(o.w/o.h)*(o.crop.h/o.crop.w);
    if(o.type==='textbox'){o.w=Math.max(180,o.w);o.h=Math.max(120,o.h);o.html=cleanHTML(source.html||'');o.textWidth=clamp(source.textWidth||100,25,100);o.children=Array.isArray(source.children)?source.children.map(v=>decodeObject(v,false)).filter(Boolean):[];}
    return o;
  }
  function encode(w) {
    const root = document.createElement('div'); root.dataset.notasPro = '3';
    root.dataset.layout = JSON.stringify({bg:w.bg,textWidth:w.textWidth,objects:w.objects,kind:w.kind,onyxRows:w.onyxRows,shipments:w.shipments,folders:w.folders,location:w.location,rect:w.rect,popupRect:w.popupRect});
    const body = document.createElement('div'); body.dataset.noteBody = ''; body.innerHTML = w.editor.innerHTML;
    if(w.kind==='onyx'){body.replaceChildren();const table=document.createElement('table');for(const row of w.onyxRows){const tr=document.createElement('tr'),left=document.createElement('td'),right=document.createElement('td');left.innerHTML=cleanHTML(row.html);right.textContent=row.images.length?row.images.length+' imagem(ns) na nota OnyxCeph':'';tr.append(left,right);table.append(tr);}body.append(table);}root.append(body);
    // A standard HTML fallback lets previous versions still display text and objects.
    const fallback = document.createElement('div'); fallback.dataset.noteObjects = '';
    const fallbackObject=o=>{const el=document.createElement(o.type==='image'?'img':o.type==='textbox'?'div':'span');if(o.type==='image'){el.src=o.src;el.alt='Imagem da nota';el.style.maxWidth='100%';el.style.width=`${o.w}px`;}else if(o.type==='textbox'){el.innerHTML=o.html||'';o.children.forEach(c=>el.append(fallbackObject(c)));}else{el.textContent=o.symbol;el.style.fontSize=`${o.h}px`;el.style.color=o.color;}return el;};
    w.objects.forEach(o=>fallback.append(fallbackObject(o)));
    if (fallback.childNodes.length) root.append(fallback);
    return root.outerHTML;
  }
  function geometry(w) { w.el.classList.add('direct-editor'); }
  function snapshot(w) { return JSON.stringify({html:w.editor.innerHTML,bg:w.bg,textWidth:w.textWidth,objects:w.objects,kind:w.kind,onyxRows:w.onyxRows,shipments:w.shipments,folders:w.folders,location:w.location,title:w.title}); }
  function commit(w, history = true, save = false) {
    if (!windows.has(w.id)) return false;
    captureTextBoxes(w);
    notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];
    if (history) { const s = snapshot(w); if (w.history[w.historyIndex] !== s) { w.history.splice(w.historyIndex+1);w.history.push(s);if(w.history.length>60)w.history.shift();w.historyIndex=w.history.length-1; } }
    w.dirty=snapshot(w)!==w.savedSnapshot;
    if(!save){w.footer.textContent=w.dirty?'Alterações por guardar':'Sem alterações';return true;}
    const old = notes.find(n => n.id === w.id);
    if(old&&old.updatedAt!==w.savedAt&&!confirm('Esta nota foi alterada noutro dispositivo. Substituir a versão guardada pelas alterações desta janela?'))return false;
    if(old?.deletedAt){status.textContent='Restaure esta nota em Notas excluídas antes de guardar as alterações.';return false;}
    if(detached)w.popupRect={x:screenX,y:screenY,w:innerWidth,h:innerHeight};
    const content = encode(w);
    if (!old || content !== old.content || (old.title || '') !== w.title) {
      const note = {id:w.id,title:w.title || '',titleHtml:old?.title===w.title ? old.titleHtml || '' : '',content,updatedAt:timestamp(old?.updatedAt),deletedAt:null};
      if(old) notes[notes.indexOf(old)] = note; else notes.unshift(note);
    }
    const ok = persist();
    if(ok){w.savedSnapshot=snapshot(w);w.savedAt=notes.find(n=>n.id===w.id)?.updatedAt;w.dirty=false;}
    w.footer.textContent = ok ? 'Guardado neste dispositivo' : 'Não guardado — armazenamento cheio';
    if(ok) { status.textContent = user ? 'Guardado neste dispositivo; a aguardar sincronização' : 'Guardado neste dispositivo';scheduleSync(); }
    renderNotes(); return ok;
  }
  function activate(w) {
    if (!w) return;
    if (active !== w) savedRange = null;
    active = w; windows.forEach(v => v.el.classList.toggle('active',v === w));w.el.style.zIndex=++zIndex;
  }
  function display(w) {
    w.paper.style.setProperty('--paper',w.bg);w.el.style.background=w.bg;
    w.editor.style.width=`calc((100% - 40px) * ${w.textWidth / 100})`;
    w.el.setAttribute('aria-label',w.title || 'Nota sem título');
    renderOnyx(w);document.title=detached?`${w.title||'Sem título'} — Notas Exclusivas Pro`:'Notas Exclusivas Pro';renderObjects(w);fitPaper(w);
  }
  function fitPaper(w) {const scroll=w.el.querySelector('.note-scroll');w.paper.style.width=`${scroll.clientWidth}px`;fitTextBoxes(w);const bounds=w.objects.map(objectBounds);w.paper.style.minWidth=`${Math.max(0,...bounds.map(o=>o.right+25))}px`;w.paper.style.height=`${Math.max(scroll.clientHeight,w.editor.scrollHeight+44,(w.paper.querySelector('.onyx-board')?.scrollHeight||0)+35,...bounds.map(o=>o.bottom+35))}px`;}
  function noteActionIcon(action){
    const paths={save:'<path d="M5 3h13l3 3v15H3V3h2Z"/><path d="M7 3v7h10V3M7 21v-8h10v8"/>',share:'<path d="M12 16V2m-5 5 5-5 5 5M6 11H3v11h18V11h-3"/>',menu:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>'};
    const size=action==='save'||action==='share'?32:24;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="width:${size}px;height:${size}px" aria-hidden="true" focusable="false">${paths[action]}</svg>`;
  }
  function createWindow(note = null, focus = true) {
    if(note && windows.has(note.id)) { const w=windows.get(note.id);activate(w);w.el.scrollIntoView({block:'nearest',inline:'nearest'});closeSidebar();return w; }
    const data = decode(note?.content || '');
    const n=windows.size, width=Math.min(610,Math.max(280,workspace.clientWidth-28)), height=Math.min(690,Math.max(240,workspace.clientHeight-30));
    const initial = data.rect || {x:14+(n%3)*36,y:14+(n%3)*32,w:width,h:height};
    const rect={w:clamp(initial.w,280,Math.max(280,workspace.clientWidth-16)),h:clamp(initial.h,240,Math.max(240,workspace.clientHeight-16)),x:0,y:0};
    rect.x=clamp(initial.x,0,workspace.clientWidth-rect.w);rect.y=clamp(initial.y,0,workspace.clientHeight-40);
    const el=document.createElement('section');el.className='note-window';el.innerHTML=`<div class="window-bar"><button data-window="save" aria-label="Guardar nota" title="Guardar nota">${noteActionIcon('save')}</button><button data-window="share" aria-label="Compartilhar nota" title="Compartilhar nota">${noteActionIcon('share')}</button><button data-window="menu" aria-label="Opções de formatação" title="Opções de formatação" aria-expanded="false">${noteActionIcon('menu')}</button><button data-window="close" aria-label="Fechar nota" title="Fechar nota sem eliminar">${noteActionIcon('close')}</button></div><div class="note-scroll"><div class="note-paper"><div class="note-editor" contenteditable="true" role="textbox" aria-label="Texto da nota" aria-multiline="true" data-placeholder="Escreva a sua nota aqui…" spellcheck="true"></div></div></div><div class="window-footer"><span>${note?'Guardado neste dispositivo':'Pronto para escrever'}</span><span>Gravação manual</span></div>`;
    const w={id:note?.id||makeId(),title:note?.title === 'Sem título' ? '' : note?.title || '',el,editor:el.querySelector('.note-editor'),paper:el.querySelector('.note-paper'),footer:el.querySelector('.window-footer span'),...data,rect,selected:null,history:[],historyIndex:0};
    if(!note?.content&&route.searchParams.get('kind')==='onyx'){w.kind='onyx';w.onyxRows=decodeOnyx([{}, {}, {}, {}]);}w.editor.innerHTML=data.html;windows.set(w.id,w);workspace.append(el);geometry(w);linkify(w,false);display(w);w.history=[snapshot(w)];w.savedSnapshot=snapshot(w);w.savedAt=note?.updatedAt;w.dirty=false;
    const destination=validLocation({noteId:route.searchParams.get('parent'),folderId:route.searchParams.get('folder')});if(destination){w.location=destination;commit(w);}
    el.addEventListener('pointerdown',()=>activate(w));
    w.zoom=1;
    el.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{
      activate(w);const action=button.dataset.window;if(action==='share')openShare(w);
      if(action==='close')closeNote(w);if(action==='save')saveNote(w);
      if(action==='menu'){if(!menu.hidden){closeMenu();return;}const r=button.getBoundingClientRect();openMenu(w,r.left,r.bottom+3);}
    }));
    w.paper.addEventListener('contextmenu',e=>{if(mobileFormatMenu()){closeMenu();return;}e.preventDefault();openMenu(w,e.clientX,e.clientY);});
    bindEditable(w,w.editor);
    activate(w);$('#empty-workspace').hidden=true;saveWorkspace();renderNotes();if(focus)w.editor.focus();return w;
  }
  function saveWorkspace() { if(!detached&&active)try {localStorage.setItem(`${storageKey()}:primary`,active.id);}catch{} }
  function removeWindow(w) {w.el.remove();windows.delete(w.id);if(active===w){active=null;savedRange=null;closeMenu();}$('#empty-workspace').hidden=false;renderNotes();if(!detached&&!windows.size)openSidebar();}
  function restoreWorkspace() {
    if(detached){
      if(detachedScope!==(user?.id||'guest')){status.textContent='Entre na conta que abriu esta nota para continuar.';return;}
      const note=notes.find(n=>n.id===detachedId&&!n.deletedAt);if(note)createWindow(note,true);else if(route.searchParams.get('draft')==='1'&&!notes.some(n=>n.id===detachedId))createWindow({id:detachedId,content:'',title:''},true);else{status.textContent='Esta nota não está disponível neste dispositivo. Sincronize a conta para a procurar.';$('#empty-workspace').hidden=false;}return;
    }
    openSidebar();
  }
  function ensurePrimaryEditor(){
    if(detached||windows.size)return;
    let id=null;try{id=localStorage.getItem(`${storageKey()}:primary`);}catch{}
    createWindow(notes.find(n=>n.id===id&&!n.deletedAt)||null,false);
  }
  function openDetached(id,destination=null,isNew=false,kind='normal'){
    const existing=popupHandles.get(id);if(!destination&&existing&&!existing.closed){existing.focus();if(detached)closeSidebar();else openSidebar();return;}
    const note=notes.find(n=>n.id===id&&!n.deletedAt)||(isNew?{id,content:''}:null);if(!note)return;
    const rect=decode(note.content).popupRect||{};
    const url=new URL(location.href);url.search='';url.searchParams.set('note',id);url.searchParams.set('scope',user?.id||'guest');url.hash='';if(isNew){url.searchParams.set('draft','1');if(kind==='onyx')url.searchParams.set('kind','onyx');}if(destination){url.searchParams.set('parent',destination.noteId);url.searchParams.set('folder',destination.folderId);}
    // Mobile notes stay inside the installed app instead of opening a browser custom tab.
    if(mobileNotes){if(active&&!canDiscard(active))return;if(active)active.dirty=false;location.assign(url.href);return;}
    const width=clamp(rect.w||640,340,screen.availWidth||1600),height=clamp(rect.h||760,340,screen.availHeight||1000);
    const x=Number.isFinite(rect.x)?rect.x:screenX+80,y=Number.isFinite(rect.y)?rect.y:screenY+70;
    const handle=window.open(url.href,`notas-${user?.id||'guest'}-${id}`,`popup=yes,resizable=yes,scrollbars=yes,width=${width},height=${height},left=${x},top=${y}`);
    if(!handle){$('#popup-fallback').href=url.href;$('#popup-message').hidden=false;return;}
    popupHandles.set(id,handle);handle.focus();$('#popup-message').hidden=true;if(detached)closeSidebar();else openSidebar();
    if(!detached&&active?.id===id&&!active.dirty)removeWindow(active);
  }
  function newNote(destination=null){openDetached(makeId(),destination,true);}
  function canDiscard(w){return !w?.dirty||confirm('Existem alterações por guardar. Sair sem guardar essas alterações?');}
  function saveNote(w){if(!w)return false;closeMenu();const ok=commit(w,true,true);if(ok)display(w);return ok;}
  function closeNote(w){if(!canDiscard(w))return;w.dirty=false;if(detached&&mobileNotes){const url=new URL(location.href);url.search='';url.hash='';location.assign(url.href);}else if(detached)window.close();else{removeWindow(w);openSidebar();}}
  function deleteNoteById(id){
    const existing=notes.find(n=>n.id===id&&!n.deletedAt),w=windows.get(id);
    if(!confirm(`Eliminar a nota “${existing?.title || w?.title || 'Sem título'}”?`))return;
    if(existing){const now=timestamp(existing.updatedAt);notes[notes.indexOf(existing)]={...existing,deletedAt:now,updatedAt:now};if(!persist())return;scheduleSync();}
    if(w)removeWindow(w);renderNotes();
  }
  function renderNotes(){
    const list=$('#sidebar-notes-list');list.replaceChildren();
    const visible=notes.filter(n=>!n.deletedAt).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    if(!visible.length){const p=document.createElement('p');p.className='empty-list';p.textContent='Ainda não existem notas guardadas.';list.append(p);}
    visible.forEach(note=>{
      const item=document.createElement('div');item.className=`sidebar-note-item${windows.has(note.id)?' active':''}`;
      const open=document.createElement('button');open.className='sidebar-note-open';const heading=document.createElement('strong'),preview=document.createElement('small');
      heading.textContent=note.title||'Sem título';preview.textContent=plainText(note.content)||'Imagem ou nota vazia';open.append(heading,preview);open.addEventListener('click',()=>openDetached(note.id));
      const remove=document.createElement('button');remove.className='sidebar-delete-btn';remove.type='button';remove.setAttribute('aria-label',`Eliminar nota ${note.title||'Sem título'}`);remove.title='Mover para Notas excluídas';remove.textContent='×';remove.addEventListener('click',e=>{e.stopPropagation();deleteNoteById(note.id);});
      item.append(open,remove);list.append(item);
    });
  }
  function openSidebar(){closeMenu();document.body.classList.add('notes-home');$('#sidebar').classList.add('active');$('#sidebar').setAttribute('aria-hidden','false');$('#sidebar-backdrop').hidden=false;}
  function closeSidebar(restoreEditor=false){
    if(!detached&&!windows.size&&!restoreEditor)return;
    if(restoreEditor)ensurePrimaryEditor();
    document.body.classList.remove('notes-home');$('#sidebar').classList.remove('active');$('#sidebar').setAttribute('aria-hidden','true');$('#sidebar-backdrop').hidden=true;
    windows.forEach(fitPaper);
  }
  function gesture(event,onMove,onEnd,onCancel=()=>{}){
    event.preventDefault();const target=event.currentTarget;target.setPointerCapture(event.pointerId);
    const move=e=>{if(e.pointerId===event.pointerId)onMove(e.clientX-event.clientX,e.clientY-event.clientY);};
    let finished=false;
    const cleanup=()=>{if(finished)return false;finished=true;target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);return true;};
    const end=e=>{if(e.pointerId===event.pointerId&&cleanup())onEnd();};
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
    return ()=>{if(cleanup())onCancel();};
  }
  function angle(value){return ((Number(value)||0)%360+360)%360;}
  function validCrop(value){const c=value||{},x=clamp(c.x,0,.98),y=clamp(c.y,0,.98);return {x,y,w:clamp(c.w??1,.02,1-x),h:clamp(c.h??1,.02,1-y)};}
  function objectBounds(o){const a=angle(o.rotation)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),bw=c*o.w+s*o.h,bh=s*o.w+c*o.h;return {left:o.x+(o.w-bw)/2,top:o.y+(o.h-bh)/2,right:o.x+(o.w+bw)/2,bottom:o.y+(o.h+bh)/2};}
  function keepObjectVisible(o){const b=objectBounds(o);if(b.left<0)o.x-=b.left;if(b.top<0)o.y-=b.top;}
  function setObjectGeometry(el,o){Object.assign(el.style,{left:`${o.x}px`,top:`${o.y}px`,width:`${o.w}px`,height:`${o.h}px`,transform:`rotate(${angle(o.rotation)}deg)`});el.classList.toggle('rotation-at-edge',objectBounds(o).top<36);}
  function allObjects(w){return w.objects.flatMap(o=>o.type==='textbox'?[o,...o.children]:[o]);}
  function findObject(w,id){return allObjects(w).find(o=>o.id===id);}
  function ownerBox(w,id){return w.objects.find(o=>o.type==='textbox'&&o.children.some(c=>c.id===id))||null;}
  function insertionBox(w){const selected=findObject(w,w.selected);return selected?.type==='textbox'?selected:ownerBox(w,w.selected)||w.objects.find(o=>o.type==='textbox'&&o.id===w.editBoxId)||null;}
  function editingSurface(w){if(w.kind==='onyx')return w.onyxEditor?.isConnected?w.onyxEditor:w.paper.querySelector('.onyx-text')||w.editor;return [...w.paper.querySelectorAll('.textbox-editor')].find(e=>e.dataset.boxId===w.editBoxId)||w.editor;}
  function captureTextBoxes(w){for(const el of w.paper.querySelectorAll('.onyx-text')){const row=w.onyxRows[Number(el.dataset.row)];if(row)row.html=el.innerHTML;}for(const el of w.paper.querySelectorAll('.textbox-editor')){const box=findObject(w,el.dataset.boxId);if(box?.type==='textbox')box.html=el.innerHTML;}}
  function fitTextBoxes(w){
    for(const canvas of w.paper.querySelectorAll('.textbox-canvas')){const box=findObject(w,canvas.dataset.boxId);if(!box)continue;const bounds=box.children.map(objectBounds),editor=canvas.querySelector('.textbox-editor');canvas.style.minWidth=`${Math.max(0,...bounds.map(o=>o.right+24))}px`;canvas.style.height=`${Math.max(canvas.parentElement.clientHeight,editor.scrollHeight+24,...bounds.map(o=>o.bottom+24))}px`;editor.style.width=`calc((100% - 24px) * ${(box.textWidth||100)/100})`;}
  }
  function selectObject(w,o){
    w.selectedIds=new Set(o?[o.id]:[]);
    activate(w);w.selected=o?.id||null;w.editBoxId=o?.type==='textbox'?o.id:ownerBox(w,o?.id)?.id||null;
    w.paper.querySelectorAll('.note-object').forEach(el=>el.classList.toggle('selected',w.selectedIds.has(el.dataset.objectId)));
  }
  function bindEditable(w,editor,box=null){
    const target=()=>{activate(w);if(editor.classList.contains('onyx-text'))w.onyxEditor=editor;w.editBoxId=box?.id||null;if(box)selectObject(w,box);else{w.selected=null;w.selectedIds=new Set();w.paper.querySelectorAll('.selected').forEach(e=>e.classList.remove('selected'));}};
    editor.addEventListener('pointerdown',e=>{e.stopPropagation();target();});
    editor.addEventListener('focus',target);
    editor.addEventListener('pointerup',()=>queueSpellCorrection({data:' ',paragraph:true},w,editor));
    let spellingTimer;editor.addEventListener('input',e=>{clearTimeout(spellingTimer);if(!e.isComposing)spellingTimer=setTimeout(()=>queueSpellCorrection({data:' ',paragraph:true},w,editor),900);});
    editor.addEventListener('compositionend',()=>{clearTimeout(spellingTimer);spellingTimer=setTimeout(()=>queueSpellCorrection({data:' ',paragraph:true},w,editor),900);});
    editor.addEventListener('blur',()=>{clearTimeout(spellingTimer);queueSpellCorrection({data:' ',paragraph:true,leaving:true},w,editor);});
    editor.addEventListener('input',e=>{if(applyingEdit)return;capitalizeKnownName(e,w,editor);queueSpellCorrection(e,w,editor);if(/\s/.test(e.data||'')||['insertParagraph','insertLineBreak','insertFromPaste'].includes(e.inputType))linkify(w,true,editor);fitPaper(w);commit(w);rememberSelection(w);});
    editor.addEventListener('contextmenu',e=>{e.stopPropagation();if(mobileFormatMenu()){closeMenu();rememberSelection(w);return;}e.preventDefault();target();openMenu(w,e.clientX,e.clientY);});
    editor.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&safeLink(a.getAttribute('href'))){e.preventDefault();window.open(a.href,'_blank','noopener,noreferrer');}});
    editor.addEventListener('copy',e=>{const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;const range=selection.getRangeAt(0);if(!editor.contains(range.commonAncestorContainer))return;const fragment=document.createElement('div');fragment.append(range.cloneContents());e.clipboardData.setData('text/html',copyNoteFragment(editor,range));e.clipboardData.setData('text/plain',selection.toString());e.preventDefault();});
    editor.addEventListener('paste',e=>{e.preventDefault();e.stopPropagation();target();rememberSelection(w);const data=e.clipboardData,files=[...data.files].filter(f=>f.type.startsWith('image/'));if(files.length){files.forEach(f=>insertImageFile(w,f,box?.id||null));return;}const html=data.getData('text/html');const plain=document.createElement('div');plain.textContent=data.getData('text/plain');command('insertHTML',cleanClipboardHTML(html||plain.innerHTML),w);});
    editor.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();target();[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')).forEach(f=>insertImageFile(w,f,box?.id||null));});
    editor.addEventListener('dragover',e=>e.preventDefault());
    editor.lang=({pt:'pt-PT',en:'en',es:'es'})[localStorage.getItem(GUEST_KEY+':spelling-language')]||'pt-PT';editor.setAttribute('autocorrect','on');editor.autocapitalize='words';editor.addEventListener('beforeinput',e=>{autoCapitalLetter(e,w,editor);if(e.defaultPrevented)return;if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak')queueSpellCorrection({data:' ',paragraph:true},w,editor);if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();undo(w,e.inputType==='historyUndo'?-1:1);}});
  }
  function setSymbolColor(w,color){
    const o=findObject(w,w.selected);if(o?.type!=='symbol'||!/^#[0-9a-f]{6}$/i.test(color))return false;
    o.color=color;const el=[...w.paper.querySelectorAll('.note-object')].find(e=>e.dataset.objectId===o.id);el?.querySelector('svg text')?.setAttribute('fill',color);commit(w);return true;
  }
  function renderObjects(w){
    w.paper.querySelectorAll(':scope > .note-object').forEach(el=>el.remove());
    function renderObject(o,container,parent=null){
      o.rotation=angle(o.rotation);o.crop=validCrop(o.crop);
      const el=document.createElement('div');el.className=`note-object${o.type==='textbox'?' text-box':''}${(w.selectedIds?.has(o.id)||w.selected===o.id)?' selected':''}`;el.dataset.objectId=o.id;el.tabIndex=0;
      el.classList.toggle('pinned',!!o.pinned);
      el.setAttribute('aria-label',o.type==='textbox'?'Caixa de texto: arraste pela barra e redimensione pelos cantos':o.type==='image'?'Imagem: arraste ou redimensione pelos cantos':`Símbolo ${o.symbol}: selecione para alterar a cor ou redimensionar`);setObjectGeometry(el,o);
      if(o.type==='textbox'){
        el.style.backgroundColor=o.bg||'#ffffff';
        const bar=document.createElement('div');bar.className='textbox-drag';bar.textContent='⠿ Caixa de texto · arraste aqui';
        const body=document.createElement('div');body.className='textbox-body';const canvas=document.createElement('div');canvas.className='textbox-canvas';canvas.dataset.boxId=o.id;
        const editor=document.createElement('div');editor.className='textbox-editor';editor.contentEditable='true';editor.dataset.boxId=o.id;editor.setAttribute('role','textbox');editor.setAttribute('aria-label','Texto dentro da caixa');editor.setAttribute('aria-multiline','true');editor.dataset.placeholder='Escreva aqui…';editor.innerHTML=o.html||'';
        canvas.append(editor);body.append(canvas);el.append(bar,body);bindEditable(w,editor,o);linkify(w,false,editor);
        o.children.forEach(child=>renderObject(child,canvas,o));
      }else if(o.type==='image'){
        const viewport=document.createElement('div');viewport.className='image-viewport';const img=document.createElement('img');img.className='object-image';img.src=o.src;img.alt='Imagem da nota';img.draggable=false;
        const c=o.crop;Object.assign(img.style,{width:`${100/c.w}%`,height:`${100/c.h}%`,left:`${-100*c.x/c.w}%`,top:`${-100*c.y/c.h}%`});viewport.append(img);el.append(viewport);
      }else{
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.classList.add('object-symbol');
        const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x','50');text.setAttribute('y','78');text.setAttribute('text-anchor','middle');text.setAttribute('font-size','90');text.setAttribute('fill',o.color);text.textContent=o.symbol;svg.append(text);el.append(svg);
      }
      for(const c of ['nw','ne','sw','se']){const h=document.createElement('span');h.className='object-resize';h.dataset.corner=c;h.title=o.type==='image'&&c==='ne'?'Redimensionar mantendo a proporção original':'Redimensionar livremente a largura e a altura';el.append(h);}
      el.addEventListener('pointerdown',e=>{
        if(e.target.closest('.note-object')!==el)return;e.stopPropagation();
        if(!w.selectedIds?.has(o.id))selectObject(w,o);
        if(e.button!==0||e.target.closest('.textbox-editor'))return;
        if(o.pinned){el.focus({preventScroll:true});return;}
        const corner=e.target.dataset.corner;
        if(o.type==='textbox'&&!corner&&!e.target.closest('.textbox-drag')&&e.target!==el)return;
        el.focus({preventScroll:true});const initial={...o};
        const parentTheta=(parent?.rotation||0)*Math.PI/180,pc=Math.cos(parentTheta),ps=Math.sin(parentTheta),theta=o.rotation*Math.PI/180+parentTheta,cos=Math.cos(theta),sin=Math.sin(theta),lc=Math.cos(o.rotation*Math.PI/180),ls=Math.sin(o.rotation*Math.PI/180);
        w.cancelObjectGesture=gesture(e,(dx,dy)=>{
          dx/=w.zoom||1;dy/=w.zoom||1;
          if(corner){
            const sx=corner.includes('w')?-1:1,sy=corner.includes('n')?-1:1,lx=cos*dx+sin*dy,ly=-sin*dx+cos*dy;
            let nw=clamp(initial.w+sx*lx,o.type==='textbox'?180:o.type==='symbol'?8:20,6000),nh=clamp(initial.h+sy*ly,o.type==='textbox'?120:o.type==='symbol'?8:20,6000);
            if(o.type==='image'&&corner==='ne'){
              // Return to the source image's visible proportions even after a free resize.
              const crop=validCrop(o.crop),ratio=(o.sourceRatio||initial.w/initial.h)*crop.w/crop.h;
              nh=clamp(((initial.w+sx*lx)*ratio+(initial.h+sy*ly))/(ratio*ratio+1),Math.max(20,20/ratio),Math.min(6000,6000/ratio));nw=nh*ratio;
            }
            const shiftX=sx*(nw-initial.w)/2,shiftY=sy*(nh-initial.h)/2;o.x=initial.x+initial.w/2+lc*shiftX-ls*shiftY-nw/2;o.y=initial.y+initial.h/2+ls*shiftX+lc*shiftY-nh/2;o.w=nw;o.h=nh;
          }else{o.x=initial.x+pc*dx+ps*dy;o.y=initial.y-ps*dx+pc*dy;}
          keepObjectVisible(o);setObjectGeometry(el,o);fitPaper(w);
        },()=>{w.cancelObjectGesture=null;commit(w);},()=>{w.cancelObjectGesture=null;Object.assign(o,initial);setObjectGeometry(el,o);fitPaper(w);});
      });
      el.addEventListener('keydown',e=>{
        if(e.target.closest('.textbox-editor')||e.target.closest('.note-object')!==el)return;
        if(o.pinned&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();return;}
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const d=e.shiftKey?10:1;o.x+=(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0);o.y+=(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0);keepObjectVisible(o);setObjectGeometry(el,o);fitPaper(w);commit(w);}
        else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();w.selected=o.id;removeObject(w);}
      });container.append(el);
    }
    w.objects.forEach(o=>renderObject(o,w.paper));
  }

  let linkTarget=null;
  function setupLinks(){
    $('#cancel-link').addEventListener('click',()=>$('#link-dialog').close());
    $('#link-form').addEventListener('submit',e=>{
      e.preventDefault();const href=safeLink($('#link-url').value.trim());if(!href){$('#link-error').textContent='Introduza um endereço https://, http://, www., mailto: ou tel: válido.';return;}
      if(linkTarget&&windows.has(linkTarget.id)){const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=$('#link-label').value.trim()||$('#link-url').value.trim();$('#link-dialog').close();command('insertHTML',a.outerHTML,linkTarget);}else $('#link-dialog').close();
    });
    $('#dismiss-popup').addEventListener('click',()=>$('#popup-message').hidden=true);
  }
  function safeLink(value){
    if(typeof value!=='string'||/[\u0000-\u0020]/.test(value))return null;
    const candidate=/^www\./i.test(value)?'https://'+value:value;
    try{const url=new URL(candidate);if(['http:','https:'].includes(url.protocol)&&url.hostname)return candidate;if(['mailto:','tel:'].includes(url.protocol)&&url.pathname)return candidate;}catch{}return null;
  }
  function linkify(w,preserve=true,editor=editingSurface(w)){
    const selection=getSelection();let marker=null;
    if(preserve&&selection.rangeCount&&selection.isCollapsed&&editor.contains(selection.anchorNode)){marker=document.createElement('span');marker.dataset.caret='';selection.getRangeAt(0).insertNode(marker);}
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),texts=[];while(walker.nextNode())texts.push(walker.currentNode);
    for(const node of texts){
      if(node.parentElement.closest('a,code,pre'))continue;
      const value=node.nodeValue,regex=/(?:https?:\/\/|www\.|mailto:|tel:)[^\s<>"\u200b]+/gi;let match,last=0,changed=false;const fragment=document.createDocumentFragment();
      while((match=regex.exec(value))){
        let text=match[0].replace(/[.,;!]+$/,'');
        while(text.endsWith(')')&&(text.match(/\)/g)||[]).length>(text.match(/\(/g)||[]).length)text=text.slice(0,-1);
        const href=safeLink(text);if(!href)continue;fragment.append(document.createTextNode(value.slice(last,match.index)));const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=text;fragment.append(a);last=match.index+text.length;changed=true;
      }
      if(changed){fragment.append(document.createTextNode(value.slice(last)));node.replaceWith(fragment);}
    }
    if(marker){const r=document.createRange();r.setStartBefore(marker);r.collapse(true);selection.removeAllRanges();selection.addRange(r);marker.remove();rememberSelection(w);}
  }

  function removeObject(w){if(!w?.selected)return;const box=ownerBox(w,w.selected);if(box){box.children=box.children.filter(o=>o.id!==w.selected);w.selected=box.id;w.editBoxId=box.id;}else{w.objects=w.objects.filter(o=>o.id!==w.selected);w.selected=null;w.editBoxId=null;}savedRange=null;display(w);commit(w);}
  function addObject(w,object,boxId=insertionBox(w)?.id||null){
    if(!windows.has(w.id))return;
    const box=object.type==='textbox'?null:w.objects.find(o=>o.id===boxId&&o.type==='textbox');
    if(boxId&&object.type!=='textbox'&&!box){status.textContent='A caixa de destino já não existe. Insira novamente o objeto.';return;}
    const id=makeId(),o={id,x:box?Math.max(20,box.w*.56):object.type==='textbox'?40:Math.max(30,w.paper.clientWidth*.59),y:box?Math.max(42,...box.children.map(c=>objectBounds(c).bottom+24)):65+w.el.querySelector('.note-scroll').scrollTop/(w.zoom||1),rotation:0,crop:{x:0,y:0,w:1,h:1},sourceRatio:object.w/object.h,...object};
    if(box){box.children.push(o);if(box.textWidth===100)box.textWidth=50;}else{w.objects.push(o);if(object.type!=='textbox'&&w.textWidth===100)w.textWidth=55;}
    w.selected=id;w.selectedIds=new Set([id]);w.editBoxId=object.type==='textbox'?id:box?.id||null;savedRange=null;display(w);commit(w);closeMenu();
    if(object.type==='textbox')editingSurface(w).focus();
  }
  async function insertImageFile(w,file,boxId=insertionBox(w)?.id||null){
    if(w.kind==='onyx'){const row=w.onyxRows[Number(w.onyxEditor?.dataset.row)||0];if(row)await addOnyxImages(w,row,[file]);return;}
    if(!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)){status.textContent='Escolha uma imagem PNG, JPEG, WebP, GIF ou AVIF.';return;}
    if(file.size>12*1024*1024){status.textContent='A imagem é demasiado grande. Escolha uma imagem com menos de 12 MB.';return;}
    try{
      const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const img=new Image();img.src=src;await img.decode();
      let stored=src;
      if(file.size>450000 && file.type!=='image/gif'){
        const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);stored=canvas.toDataURL('image/webp',.86);
      }
      const box=w.objects.find(o=>o.id===boxId&&o.type==='textbox'),width=Math.min(220,Math.max(70,(box?.w||w.paper.clientWidth)*.34));addObject(w,{type:'image',src:stored,w:width,h:width*img.naturalHeight/img.naturalWidth},boxId);
    }catch{status.textContent='Não foi possível abrir esta imagem.';}
  }
  function rememberSelection(w=active){
    const selection=getSelection();if(!w||!selection?.rangeCount)return;
    const range=selection.getRangeAt(0),node=range.commonAncestorContainer,editor=(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('.note-editor,.textbox-editor,.onyx-text');
    if(editor&&w.el.contains(editor)){updateFontSizeLabel(range,editor);savedRange=range.cloneRange();if(document.activeElement===editor)w.editBoxId=editor.dataset.boxId||null;}
  }
  function restoreSelection(w){
    const editor=editingSurface(w);editor.focus();const selection=getSelection();selection.removeAllRanges();
    if(savedRange && editor.contains(savedRange.commonAncestorContainer))selection.addRange(savedRange);
    else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.addRange(range);}
  }
  function command(name,value=null,w=active){if(!w)return;if(name==='foreColor'&&setSymbolColor(w,value)){closeMenu();return;}restoreSelection(w);applyingEdit=true;try{document.execCommand(name,false,value);}finally{applyingEdit=false;}if(name==='insertText'||name==='insertHTML')linkify(w);rememberSelection(w);fitPaper(w);commit(w);closeMenu();}
  function fontSize(value){
    if(!active)return;value=clamp(value,10,16);const w=active;restoreSelection(w);const editor=editingSurface(w);
    if(getSelection().isCollapsed){
      const marker=`size-${makeId()}`;applyingEdit=true;try{document.execCommand('insertHTML',false,`<span id="${marker}" style="font-size:${value}px">&#8203;</span>`);}finally{applyingEdit=false;}
      const span=editor.querySelector(`[id="${marker}"]`);if(span){span.removeAttribute('id');const r=document.createRange();r.selectNodeContents(span);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}
    }else{applyingEdit=true;try{document.execCommand('fontSize',false,'7');}finally{applyingEdit=false;}}
    editor.querySelectorAll('font[size="7"]').forEach(el=>{el.removeAttribute('size');el.style.fontSize=`${value}px`;});
    $('#size-label').textContent=value;rememberSelection(w);commit(w);closeMenu();
  }
  function changeCase(mode){if(!active)return;restoreSelection(active);const text=getSelection().toString();if(text)command('insertText',mode==='upper'?text.toLocaleUpperCase('pt-PT'):mode==='title'?text.replace(/\p{L}+/gu,word=>word[0].toLocaleUpperCase('pt-PT')+word.slice(1)):text.toLocaleLowerCase('pt-PT'));}
  function undo(w,direction){
    if(!w)return;const index=w.historyIndex+direction;if(index<0||index>=w.history.length)return;
    const previousBox=w.editBoxId;w.historyIndex=index;const s=JSON.parse(w.history[index]);w.editor.innerHTML=s.html;w.bg=s.bg;w.textWidth=s.textWidth;w.objects=s.objects;w.kind=s.kind||'normal';w.onyxRows=decodeOnyx(s.onyxRows);w.shipments=decodeShipments(s.shipments);w.folders=decodeFolders(s.folders);w.location=validLocation(s.location);w.title=s.title??w.title;w.selected=null;w.editBoxId=w.objects.some(o=>o.id===previousBox)?previousBox:null;savedRange=null;display(w);commit(w,false);editingSurface(w).focus();closeMenu();
  }
  async function clipboard(paste){
    const w=active;if(!w)return;
    try{
      restoreSelection(w);
      if(!paste){
        const text=getSelection().toString();if(!text){status.textContent='Selecione o texto que pretende copiar.';return;}
        if(!document.execCommand('copy'))await navigator.clipboard.writeText(text);
      }else{
        const range=getSelection().getRangeAt(0).cloneRange();
        const text=await navigator.clipboard.readText();if(!windows.has(w.id))return;activate(w);savedRange=range;command('insertText',text,w);
      }
      closeMenu();
    }catch{status.textContent=paste?'O navegador bloqueou Colar. Use Ctrl+V (ou ⌘V) no texto.':'O navegador bloqueou Copiar. Use Ctrl+C (ou ⌘C).';closeMenu();}
  }
  function mobileFormatMenu(){return matchMedia('(max-width:650px), (pointer:coarse)').matches;}
  function positionOptions(){
    if(menu.hidden||!active||!windows.has(active.id))return;
    const viewport=window.visualViewport,visibleTop=viewport?.offsetTop||0;
    const footer=document.getElementById('app-footer'),footerTop=footer?.getBoundingClientRect().top;
    let bottom=Math.min(innerHeight,visibleTop+(viewport?.height||innerHeight));
    if(Number.isFinite(footerTop)&&footerTop>visibleTop)bottom=Math.min(bottom,footerTop);
    const top=Math.max(visibleTop+8,active.el.querySelector('.window-bar').getBoundingClientRect().bottom+8);
    const height=Math.max(24,Math.min(280,Math.floor(Math.max(0,bottom-top-16)*.55)));
    document.documentElement.style.setProperty('--note-options-top',`${top}px`);
    document.documentElement.style.setProperty('--note-options-height',`${height}px`);
    document.documentElement.style.setProperty('--note-visible-bottom',`${bottom}px`);
    windows.forEach(fitPaper);
  }
  function openMenu(w,x,y){
    activate(w);rememberSelection(w);const box=insertionBox(w);menu.hidden=false;
    menu.classList.remove('mobile-format-menu');menu.style.left='';menu.style.top='';menu.style.maxHeight='';
    document.body.classList.add('note-options-open');
    windows.forEach(other=>{other.el.classList.toggle('options-active',other===w);other.el.querySelector('[data-window="menu"]').setAttribute('aria-expanded',String(other===w));});
    $('#text-width').value=box?.textWidth||w.textWidth;$('#width-label').value=`${box?.textWidth||w.textWidth}%`;
    menu.querySelector('[data-action="image"]').textContent=box?'Inserir imagem na caixa…':'Inserir imagem…';
    positionOptions();
  }
  function closeMenu(){
    menu.hidden=true;menu.classList.remove('mobile-format-menu');document.body.classList.remove('mobile-format-open','note-options-open');
    windows.forEach(w=>{w.el.classList.remove('options-active');w.el.querySelector('[data-window="menu"]').setAttribute('aria-expanded','false');w.paper.style.marginBottom='';fitPaper(w);});
  }
  function colorButton(container,color,label,action){const button=document.createElement('button');button.className='color-dot';button.style.setProperty('--color',color);button.title=label;button.setAttribute('aria-label',label);if(color==='transparent')button.textContent='×';button.addEventListener('click',action);container.append(button);}
  function renderFavorites(){['text','highlight'].forEach(kind=>{const area=$(`#${kind}-favorites`);area.replaceChildren();favorites[kind].filter(c=>/^#[0-9a-f]{6}$/i.test(c)).forEach(c=>colorButton(area,c,`Favorita ${c}`,()=>command(kind==='text'?'foreColor':'hiliteColor',c)));});}
  function setupMenu(){
    [['ARIAL','Arial'],['CALIBRI','Calibri']].forEach(([label,font])=>{const b=document.createElement('button');b.textContent=label;b.style.fontFamily=`"${font}", Arial, sans-serif`;b.addEventListener('click',()=>command('fontName',font));$('#font-options').append(b);});
    for(let i=10;i<=16;i++){const b=document.createElement('button');b.textContent=i;b.addEventListener('click',()=>fontSize(i));$('#size-options').append(b);}
    const textColors=['#171717','#e5251f','#1565c0','#188038','#ef6c00','#7b1fa2'];
    const highlightColors=['transparent','#ffff00','#39ff14','#00ffff','#ff69b4','#ff9900','#c77dff','#ff5050'];
    textColors.forEach(c=>colorButton($('#text-palette'),c,c,()=>command('foreColor',c)));
    highlightColors.forEach(c=>colorButton($('#highlight-palette'),c,c==='transparent'?'Retirar marcação':c,()=>command('hiliteColor',c)));
    Object.entries(backgrounds).forEach(([name,c])=>colorButton($('#background-palette'),c,name,()=>{if(active){active.bg=c;display(active);commit(active);closeMenu();}}));
    symbols.forEach(symbol=>{const b=document.createElement('button');b.textContent=symbol;b.setAttribute('aria-label',`Inserir ${symbol}`);b.addEventListener('click',()=>{if(active)addObject(active,{type:'symbol',symbol,color:$('#text-color-input').value,w:80,h:80});});$('#symbol-options').append(b);});
    renderFavorites();
    menu.addEventListener('pointerdown',e=>{if(e.target.closest('button,summary'))e.preventDefault();});
    menu.querySelectorAll('details').forEach(details=>details.addEventListener('toggle',()=>{if(details.open)menu.querySelectorAll('details').forEach(other=>{if(other!==details)other.open=false;});positionOptions();}));
    menu.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.command)command(b.dataset.command);if(b.dataset.case)changeCase(b.dataset.case);
      if(b.dataset.favorite){const kind=b.dataset.favorite,c=$(`#${kind}-color-input`).value;if(!favorites[kind].includes(c))favorites[kind].push(c);try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(favorites));renderFavorites();}catch{status.textContent='Não foi possível guardar a cor favorita.';}}
      if(b.dataset.action==='copy')clipboard(false);if(b.dataset.action==='paste')clipboard(true);
      if(b.dataset.action==='undo')undo(active,-1);if(b.dataset.action==='redo')undo(active,1);
      if(b.dataset.action==='remove-object')removeObject(active);
      if(b.dataset.action==='image'){imageTarget={w:active,boxId:insertionBox(active)?.id||null};$('#image-input').click();}
      if(b.dataset.action==='textbox'&&active)addObject(active,{type:'textbox',html:'',children:[],textWidth:100,w:Math.min(480,Math.max(280,active.paper.clientWidth-80)),h:290},null);
      if(b.dataset.action==='link'){linkTarget=active;$('#link-form').reset();$('#link-error').textContent='';$('#link-dialog').showModal();$('#link-url').focus();closeMenu();}
    });
    $('#text-color-input').addEventListener('change',e=>command('foreColor',e.target.value));
    $('#highlight-color-input').addEventListener('change',e=>command('hiliteColor',e.target.value));
    $('#text-width').addEventListener('input',e=>{if(active){const target=insertionBox(active)||active;target.textWidth=Number(e.target.value);$('#width-label').value=`${target.textWidth}%`;display(active);commit(active);}});
  }

  // Existing table and optional title_html column are retained. No schema migration is needed.
  function noteRow(note,account){const row={id:note.id,user_id:account.id,title:note.title||'Sem título',content:note.content,updated_at:note.updatedAt,deleted_at:note.deletedAt||null};if(titleHtmlSupported)row.title_html=note.titleHtml||'';return row;}
  function missingTitle(error){return /title_html/i.test(error?.message||'');}
  async function fetchRemote(account){
    let result=await cloud.from('notes').select('id,title,title_html,content,updated_at,deleted_at').eq('user_id',account.id).order('updated_at',{ascending:false});
    if(result.error&&missingTitle(result.error)){titleHtmlSupported=false;result=await cloud.from('notes').select('id,title,content,updated_at,deleted_at').eq('user_id',account.id).order('updated_at',{ascending:false});}return result;
  }
  function latestById(items){return items.reduce((map,n)=>{if(!map.has(n.id)||(!isPurged(map.get(n.id))&&(isPurged(n)||Date.parse(n.updatedAt)>Date.parse(map.get(n.id).updatedAt))))map.set(n.id,n);return map;},new Map());}
  function scheduleSync(){if(!cloud||!user)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncNotes,1200);}
  async function syncNotes(){
    if(!cloud||!user)return;
    if(syncFlight){syncAgain=true;return syncFlight;}
    const epoch=sessionEpoch,account=user;
    syncFlight=(async()=>{
      try{
        status.textContent='A sincronizar…';
        const result=await fetchRemote(account);if(epoch!==sessionEpoch)return;if(result.error)throw result.error;
        const remote=(result.data||[]).map(n=>({id:n.id,title:n.title==='Sem título'?'':n.title,titleHtml:n.title_html||'',content:n.content,updatedAt:n.updated_at,deletedAt:n.deleted_at||null}));
        const remoteMap=latestById(remote),localMap=latestById([...loadNotes(storageKey()),...loadNotes(GUEST_KEY),...notes]);
        for(const n of localMap.values()){const other=remoteMap.get(n.id);if(isPurged(n)&&other&&!isPurged(other))n.updatedAt=timestamp(other.updatedAt);}
        const pending=[...localMap.values()].filter(n=>!remoteMap.has(n.id)||(isPurged(n)&&!isPurged(remoteMap.get(n.id)))||Date.parse(n.updatedAt)>Date.parse(remoteMap.get(n.id).updatedAt));
        if(pending.length){
          let {error}=await cloud.from('notes').upsert(pending.map(n=>noteRow(n,account)));if(epoch!==sessionEpoch)return;
          if(error&&titleHtmlSupported&&missingTitle(error)){titleHtmlSupported=false;({error}=await cloud.from('notes').upsert(pending.map(n=>noteRow(n,account))));if(epoch!==sessionEpoch)return;}
          if(error)throw error;
        }
        const previous=new Map(notes.map(n=>[n.id,n.updatedAt]));
        notes=[...latestById([...remote,...localMap.values(),...notes,...loadNotes(storageKey())]).values()];
        if(!persist())return;
        // Guest notes now exist in this account locally and remotely; finish the import.
        try{localStorage.removeItem(GUEST_KEY);for(const key of Object.keys(localStorage)){if(key.startsWith(`${GUEST_KEY}:entry:`)){const n=readJSON(key,null),saved=notes.find(v=>v.id===n?.id);if(saved&&Date.parse(saved.updatedAt)>=Date.parse(n.updatedAt))localStorage.removeItem(key);}}}catch{}
        windows.forEach(w=>{
          const n=notes.find(item=>item.id===w.id);if(!n)return;
          if(w.dirty)return;
          if(n.deletedAt){removeWindow(w);return;}
          if(n.updatedAt!==previous.get(w.id)){
            const data=decode(n.content);w.editor.innerHTML=data.html;w.title=n.title||'';w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.kind=data.kind;w.onyxRows=data.onyxRows;w.shipments=data.shipments;w.folders=data.folders;w.location=data.location;w.history=[snapshot(w)];w.historyIndex=0;w.savedSnapshot=snapshot(w);w.savedAt=n.updatedAt;w.selected=null;if(active===w)savedRange=null;display(w);
          }
        });
        if(detached&&!active&&notes.some(n=>n.id===detachedId&&!n.deletedAt))restoreWorkspace();renderNotes();status.textContent=[...windows.values()].some(w=>w.dirty)?'Notas guardadas sincronizadas · existem alterações por guardar':'Sincronizado';
      }catch{if(epoch===sessionEpoch)status.textContent='Guardado neste dispositivo; sincronização pendente. Verifique a ligação ou a conta.';}
    })();
    try{await syncFlight;}finally{syncFlight=null;if(syncAgain){syncAgain=false;scheduleSync();}}
  }
  function setAuthView(){
    if(config.preview){$('#signed-out-actions').hidden=true;$('#signed-in-actions').hidden=true;$('#auth-email').closest('label').hidden=true;$('#auth-password').closest('label').hidden=true;$('#auth-description').textContent='Esta pré-visualização guarda apenas notas de teste neste navegador.';$('#auth-message').textContent='A ligação à sua conta fica reservada à versão publicada.';return;}
    $('#signed-out-actions').hidden=!!user;$('#signed-in-actions').hidden=!user;$('#auth-email').closest('label').hidden=!!user;$('#auth-password').closest('label').hidden=!!user;
    $('#account-btn').classList.toggle('synced',!!user);$('#auth-message').textContent=user?`Sessão iniciada como ${user.email}`:cloud?'':'Configure o ficheiro config.js e verifique a ligação para sincronizar.';
  }
  function setSession(session){
    trashSelection.clear();
    const next=session?.user||null;if(next?.id===user?.id){user=next;setAuthView();return;}
    saveWorkspace();sessionEpoch++;clearTimeout(syncTimer);windows.forEach(w=>w.el.remove());windows.clear();active=null;savedRange=null;closeMenu();
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());pendingTitle=null;user=next;notes=loadNotes(storageKey());$('#empty-workspace').hidden=false;setAuthView();restoreWorkspace();renderNotes();if(user)syncNotes();
  }
  $('#auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!cloud)return setAuthView();try{const {error}=await cloud.auth.signInWithPassword({email:$('#auth-email').value.trim(),password:$('#auth-password').value});$('#auth-message').textContent=error?error.message:'Sessão iniciada.';$('#auth-password').value='';}catch{$('#auth-message').textContent='Não foi possível entrar. Verifique a ligação.';}});
  $('#signup-btn').addEventListener('click',async()=>{if(!cloud||!$('#auth-form').reportValidity())return;try{const {error}=await cloud.auth.signUp({email:$('#auth-email').value.trim(),password:$('#auth-password').value,options:{emailRedirectTo:location.origin+location.pathname}});$('#auth-message').textContent=error?error.message:'Conta criada. Confirme o e-mail recebido e depois entre.';}catch{$('#auth-message').textContent='Não foi possível criar a conta. Verifique a ligação.';}});
  $('#logout-btn').addEventListener('click',async()=>{if(!cloud)return;if([...windows.values()].some(w=>w.dirty)&&!confirm('Terminar sessão e descartar as alterações por guardar?'))return;try{const {error}=await cloud.auth.signOut();if(error){$('#auth-message').textContent=error.message;return;}setSession(null);$('#auth-dialog').close();}catch{$('#auth-message').textContent='Não foi possível terminar a sessão.';}});
  $('#account-btn').addEventListener('click',()=>{setAuthView();$('#auth-dialog').showModal();});$('#close-auth-btn').addEventListener('click',()=>$('#auth-dialog').close());$('#sync-btn').addEventListener('click',syncNotes);$('#sync-icon-btn').addEventListener('click',syncNotes);
  $('#close-sidebar-btn').addEventListener('click',()=>closeSidebar(true));$('#sidebar-backdrop').addEventListener('click',()=>closeSidebar());
  $('#new-onyx-btn')?.addEventListener('click',()=>openDetached(makeId(),null,true,'onyx'));
  $('#new-note-btn').addEventListener('click',()=>newNote());

  $('#image-input').addEventListener('change',e=>{const file=e.target.files[0],target=imageTarget;e.target.value='';if(file&&target?.w)insertImageFile(target.w,file,target.boxId);});
  document.addEventListener('selectionchange',()=>rememberSelection());
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'&&!e.isPrimary)return;
    if(!menu.contains(e.target)&&!e.target.closest('[data-window="menu"]'))closeMenu();
    if(!e.target.closest('.note-object,.context-menu,button,input,select,textarea,dialog,summary')){
      windows.forEach(w=>{if(w.selected)selectObject(w,null);});
    }
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeMenu();closeSidebar(true);}
    if(e.target.closest('dialog,input,textarea'))return;
    const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();saveNote(active);}
    if((e.ctrlKey||e.metaKey)&&(key==='z'||key==='y')){e.preventDefault();undo(active,key==='y'||e.shiftKey?1:-1);}
  });
  addEventListener('pagehide',saveWorkspace);
  addEventListener('beforeunload',e=>{if(localSaveFailed||[...windows.values()].some(w=>w.dirty)){e.preventDefault();e.returnValue='';}});
  let storageTimer;
  addEventListener('storage',e=>{
    if(e.key!==storageKey()&&!e.key?.startsWith(`${storageKey()}:entry:`))return;
    clearTimeout(storageTimer);storageTimer=setTimeout(()=>{
    const previous=new Map(notes.map(n=>[n.id,n.updatedAt]));notes=[...latestById([...notes,...loadNotes(storageKey())]).values()];
    windows.forEach(w=>{const n=notes.find(n=>n.id===w.id);if(!n||n.updatedAt===previous.get(w.id)||w.dirty)return;if(n.deletedAt){removeWindow(w);return;}const data=decode(n.content);w.editor.innerHTML=data.html;w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.kind=data.kind;w.onyxRows=data.onyxRows;w.shipments=data.shipments;w.folders=data.folders;w.location=data.location;w.title=n.title||'';w.history=[snapshot(w)];w.historyIndex=0;w.savedSnapshot=snapshot(w);w.savedAt=n.updatedAt;savedRange=null;display(w);});renderNotes();scheduleSync();},35);
  });
  addEventListener('online',()=>{if(user)syncNotes();});addEventListener('focus',()=>{if(user)syncNotes();});
  addEventListener('resize',()=>{windows.forEach(fitPaper);positionOptions();});
  window.visualViewport?.addEventListener('resize',positionOptions);
  window.visualViewport?.addEventListener('scroll',positionOptions);
  function decodeShipments(value){
    if(!Array.isArray(value))return [];
    return value.filter(s=>s&&typeof s.id==='string').map(s=>({id:s.id,clinic:String(s.clinic||'').slice(0,200),doctor:String(s.doctor||'').slice(0,200),patient:String(s.patient||'').slice(0,200),total:Math.round(clamp(s.total,1,9999)),sent:Math.round(clamp(s.sent,0,9999)),sentDate:/^\d{4}-\d{2}-\d{2}$/.test(s.sentDate)?s.sentDate:'',nextDate:/^\d{4}-\d{2}-\d{2}$/.test(s.nextDate)?s.nextDate:'',observations:String(s.observations||'').slice(0,5000)}));
  }
  let shipmentTarget=null;
  function button(text,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;}
  function textElement(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
  function localDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function localDateTime(date){return `${localDate(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}
  function dateLabel(value){return value?new Date(`${value}T12:00:00`).toLocaleDateString('pt-PT'):'Por definir';}
  function shipmentRecords(){return notes.filter(n=>!n.deletedAt).flatMap(n=>decode(n.content).shipments.map(s=>({note:n,s})));}
  function openShipments(){closeMenu();if(active)commit(active);$('#shipment-search').value='';renderShipments();$('#shipments-dialog').showModal();}
  function renderShipments(){
    const list=$('#shipment-list');list.replaceChildren();const query=$('#shipment-search').value.toLocaleLowerCase();
    const records=shipmentRecords().filter(({s})=>[s.patient,s.clinic,s.doctor].some(t=>t.toLocaleLowerCase().includes(query))).sort((a,b)=>Number(a.s.sent>=a.s.total)-Number(b.s.sent>=b.s.total)||(a.s.nextDate||'9999').localeCompare(b.s.nextDate||'9999'));
    for(const {note,s} of records){
      const card=document.createElement('article');card.className='record-card';const remaining=Math.max(0,s.total-s.sent);
      card.append(textElement('h3',s.patient||'Paciente sem nome'),textElement('p',[s.clinic,s.doctor].filter(Boolean).join(' · ')),textElement('strong',`${s.sent} de ${s.total} enviados · ${remaining?`Faltam ${remaining}`:'Envio completo'}`),textElement('p',`Último envio: ${dateLabel(s.sentDate)} · Próximo: ${dateLabel(s.nextDate)}`));
      if(remaining&&s.nextDate&&s.nextDate<localDate())card.append(textElement('p','Envio previsto em atraso'));
      if(s.observations)card.append(textElement('p',s.observations));
      const actions=document.createElement('div');actions.className='record-actions';actions.append(button('Editar caso',()=>editShipment(note.id,s)));card.append(actions);list.append(card);
    }
    if(!records.length)list.append(textElement('p','Nenhum caso encontrado. Adicione um caso para começar.'));
  }
  function editShipment(noteId,s=null){
    shipmentTarget={noteId,id:s?.id||makeId(),epoch:sessionEpoch};const form=$('#shipment-form');form.reset();$('#shipment-error').textContent='';
    for(const name of ['clinic','doctor','patient','total','sent','sentDate','nextDate','observations'])form.elements[name].value=s?.[name]??(name==='sent'?0:'');
    updateRemaining();$('#shipment-dialog').showModal();
  }
  function updateRemaining(){const f=$('#shipment-form'),total=Number(f.elements.total.value),sent=Number(f.elements.sent.value);f.elements.sent.setCustomValidity(sent>total&&total>0?'O número enviado não pode exceder o total.':'');$('#shipment-remaining').textContent=total>0?`Faltam enviar: ${Math.max(0,total-sent)} alinhadores`:'';}
  $('#shipments-btn')?.addEventListener('click',openShipments);
  $('#shipment-search').addEventListener('input',renderShipments);
  $('#new-shipment').addEventListener('click',()=>{if(active&&commit(active))editShipment(active.id);});
  $('#shipment-form').addEventListener('input',updateRemaining);
  $('#shipment-form').addEventListener('submit',e=>{
    e.preventDefault();if(!shipmentTarget||shipmentTarget.epoch!==sessionEpoch)return;const {noteId,id}=shipmentTarget;
    const old=notes.find(n=>n.id===noteId&&!n.deletedAt);if(!old){$('#shipment-error').textContent='A nota deste caso já não está disponível.';return;}
    const s={id,...Object.fromEntries(new FormData(e.target))};s.total=Number(s.total);s.sent=Number(s.sent);
    const w=windows.get(noteId);let ok;
    if(w){captureTextBoxes(w);w.shipments=w.shipments.filter(v=>v.id!==id).concat(s);ok=saveNote(w);}
    else{const data=decode(old.content),editor=document.createElement('div');editor.innerHTML=data.html;const content=encode({...data,editor,shipments:data.shipments.filter(v=>v.id!==id).concat(s)});notes[notes.indexOf(old)]={...old,content,updatedAt:timestamp(old.updatedAt)};ok=persist();if(ok)scheduleSync();}
    if(!ok){$('#shipment-error').textContent='Não foi possível guardar. Mantenha este formulário aberto e tente novamente.';return;}
    $('#shipment-dialog').close();renderShipments();
  });
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
  function decodeFolders(value){return Array.isArray(value)?value.filter(f=>f&&typeof f.id==='string'&&typeof f.name==='string').map(f=>({id:f.id,name:f.name.slice(0,120)})):[];}
  function validLocation(value){return value&&typeof value.noteId==='string'&&typeof value.folderId==='string'&&value.noteId&&value.folderId?{noteId:value.noteId,folderId:value.folderId}:null;}
  const trashSelection=new Set();
  function renderTrash(){
    const list=$('#trash-list');list.replaceChildren();const deleted=notes.filter(n=>n.deletedAt&&!isPurged(n)).sort((a,b)=>Date.parse(b.deletedAt)-Date.parse(a.deletedAt));
    for(const id of trashSelection)if(!deleted.some(n=>n.id===id))trashSelection.delete(id);
    const all=document.createElement('input');all.type='checkbox';all.checked=!!deleted.length&&trashSelection.size===deleted.length;all.indeterminate=trashSelection.size>0&&trashSelection.size<deleted.length;all.disabled=!deleted.length;
    const label=document.createElement('label');label.className='trash-select-all';label.append(all,document.createTextNode('Selecionar todas'));all.onchange=()=>{trashSelection.clear();if(all.checked)deleted.forEach(n=>trashSelection.add(n.id));renderTrash();};
    const bulk=button('Eliminar selecionadas ('+trashSelection.size+')',()=>purgeNotes([...trashSelection]));bulk.disabled=!trashSelection.size;bulk.className='trash-delete-selected';list.append(label,bulk);
    for(const n of deleted){const card=document.createElement('article');card.className='record-card deleted-note-card';const purge=button('×',()=>purgeNote(n.id));purge.className='purge-note';purge.setAttribute('aria-label','Eliminar definitivamente: '+(n.title||'Nota sem título'));card.append(purge);
      const choice=document.createElement('label');choice.className='trash-choice';const check=document.createElement('input');check.type='checkbox';check.checked=trashSelection.has(n.id);check.onchange=()=>{if(check.checked)trashSelection.add(n.id);else trashSelection.delete(n.id);renderTrash();};choice.append(check,document.createTextNode('Selecionar '+(n.title||'Nota sem título')));card.append(choice,textElement('h3',n.title||'Nota sem título'),textElement('p',plainText(decode(n.content).html).slice(0,160)),button('Restaurar nota',()=>restoreNote(n.id)));list.append(card);
    }if(!deleted.length)list.append(textElement('p','Não existem notas excluídas nesta conta.'));
  }
  function restoreNote(id){notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];const n=notes.find(n=>n.id===id&&n.deletedAt&&!isPurged(n));if(!n)return;notes[notes.indexOf(n)]={...n,deletedAt:null,updatedAt:timestamp(n.updatedAt)};if(!persist())return;scheduleSync();renderTrash();renderNotes();status.textContent='Nota restaurada. Abra-a em Notas.';}
  $('#trash-btn').addEventListener('click',()=>{trashSelection.clear();renderTrash();$('#trash-dialog').showModal();});

  let sharePayload=null,shareURL='';
  async function shareService(action,values={}){
    if(config.preview){
      if(action==='share-create'){const token=makeId()+makeId();localStorage.setItem('preview-share:'+token,JSON.stringify(values.note));return {token};}
      if(action==='share-open'){const note=readJSON('preview-share:'+values.token,null);if(!note)throw new Error('Esta partilha de teste só abre neste navegador.');return {note};}
    }
    if(!cloud)throw new Error('Serviço de partilha indisponível.');
    const {data,error}=await cloud.functions.invoke('notes-reminders',{body:{action,...values}});
    if(error||data?.error)throw new Error(data?.error||'Não foi possível abrir ou criar a partilha. Verifique a ligação e a publicação do serviço.');return data;
  }
  function openShare(w){
    captureTextBoxes(w);sharePayload={title:w.title||'Sem título',content:encode({...w,folders:[],location:null})};shareURL='';
    $('#share-link').value='';$('#share-result').hidden=true;$('#share-message').textContent=config.preview?'Pré-visualização: o link de teste funciona apenas neste navegador.':'Cria uma cópia do conteúdo atual, incluindo imagens. Quem receber o link poderá abrir e guardar uma cópia. O link expira após 30 dias. Subnotas não são incluídas.';
    $('#share-dialog').showModal();
  }
  $('#create-share').addEventListener('click',async()=>{
    const control=$('#create-share');control.disabled=true;
    try{if(!config.preview&&!user)throw new Error('Entre em Conta antes de criar uma partilha.');const result=await shareService('share-create',{note:sharePayload});const u=new URL(location.pathname,location.origin);u.hash='share='+result.token;shareURL=u.href;$('#share-link').value=shareURL;$('#share-result').hidden=false;$('#share-message').textContent='Cópia pronta. Envie o link ao colega; ele poderá escolher Guardar no meu bloco.';}catch(e){$('#share-message').textContent=e.message;}finally{control.disabled=false;}
  });
  $('#copy-share').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(shareURL);$('#share-message').textContent='Link copiado.';}catch{$('#share-link').select();$('#share-message').textContent='Selecione e copie o link apresentado.';}});
  $('#whatsapp-share').addEventListener('click',()=>window.open('https://wa.me/?text='+encodeURIComponent(shareURL),'_blank','noopener,noreferrer'));
  $('#email-share').addEventListener('click',()=>{location.href='mailto:?subject='+encodeURIComponent(sharePayload.title)+'&body='+encodeURIComponent('Abra a nota e escolha Guardar no meu bloco:\n'+shareURL);});
  $('#system-share').addEventListener('click',async()=>{try{if(navigator.share)await navigator.share({title:sharePayload.title,url:shareURL});else $('#share-message').textContent='Use WhatsApp, E-mail ou Copiar link.';}catch(e){if(e.name!=='AbortError')$('#share-message').textContent='Não foi possível abrir a partilha do dispositivo.';}});
  let incomingShare=null;
  async function readSharedNote(){
    const token=new URLSearchParams(location.hash.slice(1)).get('share');if(!token)return;
    $('#receive-dialog').showModal();$('#receive-message').textContent='A abrir a nota…';$('#import-share').disabled=true;
    try{const result=await shareService('share-open',{token});if(!result.note||typeof result.note.content!=='string')throw new Error('Nota inválida.');incomingShare=result.note;$('#receive-title').textContent=incomingShare.title;$('#receive-preview').textContent=plainText(decode(incomingShare.content).html).slice(0,1500);$('#receive-message').textContent='Guarde uma cópia independente. Entre primeiro em Conta se quiser sincronizá-la com os seus dispositivos.';$('#import-share').disabled=false;}catch(e){$('#receive-message').textContent=e.message;}
  }
  $('#import-share').addEventListener('click',()=>{
    if(!incomingShare)return;const data=decode(incomingShare.content);data.folders=[];data.location=null;
    const note={id:makeId(),title:String(incomingShare.title||'').slice(0,250),content:incomingShare.content};const w=createWindow(note,false);w.folders=[];w.location=null;w.savedAt=null;
    if(saveNote(w)){$('#receive-dialog').close();history.replaceState(null,'',location.pathname+location.search);incomingShare=null;status.textContent='Cópia guardada no seu bloco.';}
  });
  addEventListener('hashchange',readSharedNote);
  setTimeout(readSharedNote,500);

  function updateFontSizeLabel(range,editor){
    const sizes=new Set();const add=node=>{const el=node.nodeType===3?node.parentElement:node;if(el)sizes.add(Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10);};
    if(range.collapsed)add(range.startContainer);else{const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&range.intersectsNode(node)){const r=document.createRange();r.selectNodeContents(node);if(range.compareBoundaryPoints(Range.START_TO_END,r)>0&&range.compareBoundaryPoints(Range.END_TO_START,r)<0)add(node);}}}
    $('#size-label').textContent=sizes.size>1?'Misto':String([...sizes][0]||13);
  }
  function capitalizeWords(text){return text.replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\w.+-]+@[\w.-]+|[\p{L}\p{M}]+/giu,token=>/^(https?:\/\/|www\.)/i.test(token)||token.includes('@')?token:token[0].toLocaleUpperCase('pt-PT')+token.slice(1));}
  function autoCapitalLetter(e,w,editor){
    if(e.isComposing||e.inputType!=='insertText'||!e.data||!/^\p{Ll}/u.test(e.data))return;const sel=getSelection();if(!sel?.isCollapsed||!sel.rangeCount)return;
    const range=sel.getRangeAt(0),block=(range.startContainer.nodeType===3?range.startContainer.parentElement:range.startContainer).closest('p,div,li');const prefix=range.cloneRange();prefix.selectNodeContents(block&&editor.contains(block)?block:editor);prefix.setEnd(range.startContainer,range.startOffset);const before=prefix.toString().replace(/\u200b/g,'');
    if(/(?:https?:\/\/|www\.|@)[^\s]*$/i.test(before))return;
    if(!before.trim()||/[\s([{"“«—-]$/.test(before)){const changed=capitalizeWords(e.data);if(changed!==e.data){e.preventDefault();document.execCommand('insertText',false,changed);}}
  }
  function capitalizeKnownName(e,w,editor){
    if(e.isComposing||!e.data||!/[\s,;.!?]/.test(e.data))return;const sel=getSelection();if(!sel?.isCollapsed||sel.anchorNode?.nodeType!==3)return;const node=sel.anchorNode,pos=sel.anchorOffset,text=node.textContent.slice(0,pos),match=/(\p{L}[\p{L}'’-]*)[\s,;.!?]+$/u.exec(text);if(!match)return;
    const list=readJSON(GUEST_KEY+':names',[]);const name=Array.isArray(list)&&list.find(n=>typeof n==='string'&&n.toLocaleLowerCase()===match[1].toLocaleLowerCase());if(!name||name===match[1])return;const r=document.createRange();r.setStart(node,match.index);r.setEnd(node,match.index+match[1].length);sel.removeAllRanges();sel.addRange(r);applyingEdit=true;try{document.execCommand('insertText',false,name);}finally{applyingEdit=false;}const end=document.createRange();end.setStart(node,Math.min(pos,node.length));end.collapse(true);sel.removeAllRanges();sel.addRange(end);
  }
  function isPurged(n){return n?.deletedAt&&n.content==='<div data-notas-purged="1"></div>';}
  function purgeNote(id){purgeNotes([id]);}
  function purgeNotes(ids){
    notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];const chosen=notes.filter(n=>ids.includes(n.id)&&n.deletedAt&&!isPurged(n));if(!chosen.length)return;
    if(!confirm('Eliminar definitivamente '+chosen.length+' nota(s), incluindo texto e imagens? Não será possível recuperá-las.'))return;
    for(const n of chosen){notes[notes.indexOf(n)]={id:n.id,title:'',titleHtml:'',content:'<div data-notas-purged="1"></div>',deletedAt:n.deletedAt,updatedAt:timestamp(n.updatedAt)};const w=windows.get(n.id);if(w){w.history=[];w.editor.innerHTML='';w.objects=[];w.onyxRows=[];w.dirty=false;removeWindow(w);}}
    if(!persist())return;trashSelection.clear();renderTrash();renderNotes();scheduleSync();status.textContent=user?'Conteúdo eliminado neste dispositivo; a sincronizar a eliminação.':'Conteúdo eliminado definitivamente neste dispositivo.';
  }
  $('#names-config').addEventListener('click',()=>{const names=readJSON(GUEST_KEY+':names',[]);$('#names-list').value=Array.isArray(names)?names.join('\n'):'';closeMenu();$('#names-dialog').showModal();});
  $('#names-save').addEventListener('click',()=>{const names=$('#names-list').value.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean).map(s=>s[0].toLocaleUpperCase()+s.slice(1));try{localStorage.setItem(GUEST_KEY+':names',JSON.stringify([...new Set(names)]));$('#names-dialog').close();}catch{$('#names-message').textContent='Não foi possível guardar a lista.';}});
  let colorTarget='text',colorRange=null,colorWindow=null,colorHue=0,colorSat=1,colorVal=1;
  function hsvHex(h,s,v){const f=n=>{const k=(n+h/60)%6;return Math.round(255*(v-v*s*Math.max(0,Math.min(k,4-k,1))));};return '#'+[f(5),f(3),f(1)].map(c=>c.toString(16).padStart(2,'0')).join('');}
  function setCustomColor(hex,updateHSV=true){
    if(!/^#[0-9a-f]{6}$/i.test(hex))return;const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));$('#color-hex').value=hex.toUpperCase();['r','g','b'].forEach((c,i)=>$('#color-'+c).value=rgb[i]);$('#color-new').style.background=hex;
    if(updateHSV){const [r,g,b]=rgb.map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;colorVal=max;colorSat=max?d/max:0;colorHue=!d?0:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);if(colorHue<0)colorHue+=360;}
    $('#color-hue').value=colorHue;$('#color-spectrum').style.backgroundColor=hsvHex(colorHue,1,1);$('#color-point').style.left=colorSat*100+'%';$('#color-point').style.top=(1-colorVal)*100+'%';
  }
  document.querySelectorAll('[data-custom-color]').forEach(b=>b.addEventListener('click',()=>{colorTarget=b.dataset.customColor;colorWindow=active;colorRange=savedRange?.cloneRange();const current=$('#'+colorTarget+'-color-input').value;$('#color-current').style.background=current;setCustomColor(current);closeMenu();$('#colors-dialog').showModal();}));
  $('#color-hue').addEventListener('input',e=>{colorHue=Number(e.target.value);setCustomColor(hsvHex(colorHue,colorSat,colorVal),false);});
  const pickColor=e=>{const r=$('#color-spectrum').getBoundingClientRect();colorSat=clamp((e.clientX-r.left)/r.width,0,1);colorVal=1-clamp((e.clientY-r.top)/r.height,0,1);setCustomColor(hsvHex(colorHue,colorSat,colorVal),false);};
  $('#color-spectrum').addEventListener('pointerdown',e=>{e.preventDefault();e.target.setPointerCapture(e.pointerId);pickColor(e);});$('#color-spectrum').addEventListener('pointermove',e=>{if(e.buttons)pickColor(e);});
  ['r','g','b'].forEach(c=>$('#color-'+c).addEventListener('input',()=>{const hex='#'+['r','g','b'].map(k=>Math.round(clamp($('#color-'+k).value,0,255)).toString(16).padStart(2,'0')).join('');setCustomColor(hex);}));
  $('#color-hex').addEventListener('input',e=>{const hex=e.target.value.startsWith('#')?e.target.value:'#'+e.target.value;if(/^#[0-9a-f]{6}$/i.test(hex))setCustomColor(hex);});
  $('#color-apply').addEventListener('click',()=>{const hex=$('#color-hex').value;if(!/^#[0-9a-f]{6}$/i.test(hex))return;$('#colors-dialog').close();if(!colorWindow||!windows.has(colorWindow.id))return;activate(colorWindow);savedRange=colorRange;$('#'+colorTarget+'-color-input').value=hex;command(colorTarget==='text'?'foreColor':'hiliteColor',hex,colorWindow);});

  let spellingLanguage=localStorage.getItem(GUEST_KEY+':spelling-language')||'auto';
  if(!['auto','pt','en','es','off'].includes(spellingLanguage))spellingLanguage='auto';
  let spellingWorker=null,spellingId=0;const spellingJobs=new Map();
  function applySpellingLanguage(){document.querySelectorAll('.note-editor,.textbox-editor,.onyx-text').forEach(el=>{el.lang=({pt:'pt-PT',en:'en',es:'es'})[spellingLanguage]||'pt-PT';el.setAttribute('autocorrect',spellingLanguage==='off'?'off':'on');});}
  function queueSpellCorrection(e,w,editor){
    if(!spellingWorker||spellingLanguage==='off'||e.isComposing||!e.data||!/[\s,;.!?:]/.test(e.data))return;
    const sel=getSelection();if(!sel?.isCollapsed||sel.anchorNode?.nodeType!==3)return;const node=sel.anchorNode,pos=sel.anchorOffset;if(!editor.contains(node)||node.parentElement?.closest('a,code,pre')||(e.paragraph&&/[\p{L}]/u.test(node.textContent[pos]||'')))return;
    const before=node.textContent.slice(0,pos)+(e.paragraph?' ':''),match=/(^|[\s([{“«])([\p{L}]{2,60})([\s,;.!?:]+)$/u.exec(before);if(!match)return;
    const word=match[2],names=readJSON(GUEST_KEY+':names',[]);if(Array.isArray(names)&&names.some(n=>typeof n==='string'&&n.toLocaleLowerCase()===word.toLocaleLowerCase()))return;
    const id=++spellingId,start=match.index+match[1].length;spellingJobs.set(id,{node,start,word,w,editor,leaving:!!e.leaving,epoch:sessionEpoch});if(spellingJobs.size>60)spellingJobs.delete(spellingJobs.keys().next().value);spellingWorker.postMessage({id,word,language:spellingLanguage});
  }
  const spellingSuggestions=document.createElement('div');spellingSuggestions.id='spelling-suggestions';spellingSuggestions.hidden=true;spellingSuggestions.setAttribute('aria-label','Sugestões ortográficas');document.body.append(spellingSuggestions);
  function showSpellingSuggestions(job,choices){
    const {node,start,word,editor}=job,sel=getSelection();
    if(!sel?.isCollapsed||sel.anchorNode!==node||sel.anchorOffset<start+word.length||sel.anchorOffset>start+word.length+2)return;
    spellingSuggestions.replaceChildren();const label=document.createElement('span');label.textContent=word+':';spellingSuggestions.append(label);
    for(const value of choices.slice(0,6)){const button=document.createElement('button');button.type='button';button.textContent=word===word.toLocaleUpperCase()?value.toLocaleUpperCase():word[0]===word[0].toLocaleUpperCase()?capitalizeWords(value):value;button.addEventListener('pointerdown',e=>e.preventDefault());button.onclick=()=>{spellingSuggestions.hidden=true;const id=++spellingId;spellingJobs.set(id,job);spellingWorker.onmessage({data:{id,replacement:value}});};spellingSuggestions.append(button);}
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Fechar sugestões');close.onpointerdown=e=>e.preventDefault();close.onclick=()=>spellingSuggestions.hidden=true;spellingSuggestions.append(close);
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+word.length);const rect=range.getBoundingClientRect();spellingSuggestions.style.left=Math.max(8,Math.min(rect.left,innerWidth-350))+'px';spellingSuggestions.style.top=Math.min(rect.bottom+6,innerHeight-100)+'px';spellingSuggestions.hidden=false;
  }
  document.addEventListener('input',()=>spellingSuggestions.hidden=true,true);
  document.addEventListener('pointerdown',e=>{if(!spellingSuggestions.contains(e.target))spellingSuggestions.hidden=true;},true);
  try{spellingWorker=new Worker('spell-worker.js');spellingWorker.onmessage=e=>{
    if(e.data.ready){$('#spelling-status').textContent='Dicionários completos prontos (Hunspell).';return;}if(e.data.error){$('#spelling-status').textContent='Não foi possível carregar o corretor completo. Atualize a página para tentar novamente.';return;}
    const job=spellingJobs.get(e.data.id);spellingJobs.delete(e.data.id);if(!job||spellingLanguage==='off')return;
    const {node,start,word,w,editor,epoch}=job;if(epoch!==sessionEpoch||!windows.has(w.id)||!node.isConnected||!editor.contains(node)||node.textContent.slice(start,start+word.length)!==word)return;
    if(!e.data.replacement){if(e.data.suggestions?.length)showSpellingSuggestions(job,e.data.suggestions);return;}
    const sel=getSelection();if(!sel?.isCollapsed||!sel.rangeCount||!editor.contains(sel.anchorNode)){if(job.leaving){let fixed=e.data.replacement;if(word===word.toLocaleUpperCase())fixed=fixed.toLocaleUpperCase();else if(word[0]===word[0].toLocaleUpperCase())fixed=capitalizeWords(fixed);node.replaceData(start,word.length,fixed);fitPaper(w);commit(w);}return;}
    const current=sel.getRangeAt(0).cloneRange(),same=node===sel.anchorNode,offset=sel.anchorOffset;if(same&&offset<start+word.length)return;
    let replacement=e.data.replacement;if(word===word.toLocaleUpperCase())replacement=replacement.toLocaleUpperCase();else if(word[0]===word[0].toLocaleUpperCase())replacement=capitalizeWords(replacement);
    const r=document.createRange();r.setStart(node,start);r.setEnd(node,start+word.length);sel.removeAllRanges();sel.addRange(r);applyingEdit=true;try{document.execCommand('insertText',false,replacement);}finally{applyingEdit=false;}
    if(same&&node.isConnected){current.setStart(node,Math.min(node.length,offset+replacement.length-word.length));current.collapse(true);}sel.removeAllRanges();sel.addRange(current);fitPaper(w);commit(w);rememberSelection(w);status.textContent='Corrigido: '+word+' → '+replacement+'. Pode usar Desfazer.';
  };spellingWorker.onerror=()=>{spellingWorker=null;spellingJobs.clear();$('#spelling-status').textContent='Dicionários indisponíveis. A verificação do navegador continua ativa.';};}catch{$('#spelling-status').textContent='Correção local indisponível neste navegador.';}
  $('#spelling-language').value=spellingLanguage;$('#spelling-language').addEventListener('change',e=>{spellingLanguage=e.target.value;spellingJobs.clear();try{localStorage.setItem(GUEST_KEY+':spelling-language',spellingLanguage);}catch{}applySpellingLanguage();});
  applySpellingLanguage();

  setupMenu();setupLinks();setAuthView();restoreWorkspace();renderNotes();
  if(cloud){cloud.auth.getSession().then(({data})=>setSession(data.session)).catch(()=>{status.textContent='Sem ligação à conta; notas disponíveis neste dispositivo.';});cloud.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>setSession(session),0);});}
  if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update()).catch(()=>{}));
})();

