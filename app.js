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
  document.body.classList.toggle('detached',detached);
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
  function cleanClipboardHTML(html) {
    const start=/<!--\s*StartFragment\s*-->/i.exec(html);
    if(start){const offset=start.index+start[0].length,end=/<!--\s*EndFragment\s*-->/i.exec(html.slice(offset));if(end)html=html.slice(offset,offset+end.index);}
    return cleanHTML(html);
  }
  function safeImage(src) { return typeof src === 'string' && /^(data:image\/(png|jpeg|webp|gif|avif);base64,|https?:\/\/)/i.test(src); }
  function decode(content) {
    const t = document.createElement('template'); t.innerHTML = content || '';
    const root = t.content.querySelector('[data-notas-pro="3"]');
    let meta = {};
    if (root) { try { meta = JSON.parse(root.getAttribute('data-layout') || '{}'); } catch {} }
    if(!meta || typeof meta!=='object' || Array.isArray(meta))meta={};
    const objects = Array.isArray(meta.objects) ? meta.objects.map(o=>decodeObject(o)).filter(Boolean) : [];
    return {html:cleanHTML(root ? root.querySelector('[data-note-body]')?.innerHTML || '' : content), bg:Object.values(backgrounds).includes(meta.bg) ? meta.bg : '#ffffff', textWidth:clamp(meta.textWidth || 100,25,100),objects,shipments:decodeShipments(meta.shipments),rect:meta.rect || null,popupRect:meta.popupRect||null};
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
    root.dataset.layout = JSON.stringify({bg:w.bg,textWidth:w.textWidth,objects:w.objects,shipments:w.shipments,rect:w.rect,popupRect:w.popupRect});
    const body = document.createElement('div'); body.dataset.noteBody = ''; body.innerHTML = w.editor.innerHTML; root.append(body);
    // A standard HTML fallback lets previous versions still display text and objects.
    const fallback = document.createElement('div'); fallback.dataset.noteObjects = '';
    const fallbackObject=o=>{const el=document.createElement(o.type==='image'?'img':o.type==='textbox'?'div':'span');if(o.type==='image'){el.src=o.src;el.alt='Imagem da nota';el.style.maxWidth='100%';el.style.width=`${o.w}px`;}else if(o.type==='textbox'){el.innerHTML=o.html||'';o.children.forEach(c=>el.append(fallbackObject(c)));}else{el.textContent=o.symbol;el.style.fontSize=`${o.h}px`;el.style.color=o.color;}return el;};
    w.objects.forEach(o=>fallback.append(fallbackObject(o)));
    if (fallback.childNodes.length) root.append(fallback);
    return root.outerHTML;
  }
  function geometry(w) { w.el.classList.add('direct-editor'); }
  function snapshot(w) { return JSON.stringify({html:w.editor.innerHTML,bg:w.bg,textWidth:w.textWidth,objects:w.objects,shipments:w.shipments}); }
  function commit(w, history = true) {
    if (!windows.has(w.id)) return false;
    captureTextBoxes(w);
    notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];
    if (history) { const s = snapshot(w); if (w.history[w.historyIndex] !== s) { w.history.splice(w.historyIndex+1);w.history.push(s);if(w.history.length>60)w.history.shift();w.historyIndex=w.history.length-1; } }
    const old = notes.find(n => n.id === w.id);
    if(old?.deletedAt){removeWindow(w);status.textContent='Esta nota foi eliminada noutra janela.';return false;}
    if(detached)w.popupRect={x:screenX,y:screenY,w:innerWidth,h:innerHeight};
    const content = encode(w);
    if (!old || content !== old.content || (old.title || '') !== w.title) {
      const note = {id:w.id,title:w.title || '',titleHtml:old?.title===w.title ? old.titleHtml || '' : '',content,updatedAt:timestamp(old?.updatedAt),deletedAt:null};
      if(old) notes[notes.indexOf(old)] = note; else notes.unshift(note);
    }
    const ok = persist();
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
    document.title=detached?`${w.title||'Sem título'} — Notas Exclusivas Pro`:'Notas Exclusivas Pro';renderObjects(w);fitPaper(w);
  }
  function fitPaper(w) {const scroll=w.el.querySelector('.note-scroll');w.paper.style.width=`${scroll.clientWidth}px`;fitTextBoxes(w);const bounds=w.objects.map(objectBounds);w.paper.style.minWidth=`${Math.max(0,...bounds.map(o=>o.right+25))}px`;w.paper.style.height=`${Math.max(scroll.clientHeight,w.editor.scrollHeight+44,...bounds.map(o=>o.bottom+35))}px`;}
  function setupNoteZoom(w){
    const scroll=w.el.querySelector('.note-scroll'),key=`${storageKey()}:zoom:${w.id}`;
    w.zoom=clamp(readJSON(key,1)||1,.25,3);w.paper.style.zoom=w.zoom;
    const reset=document.createElement('button');reset.className='note-zoom';reset.title='Zoom da nota. Toque para voltar a 100%';w.el.querySelector('.window-footer').append(reset);
    const label=()=>{reset.textContent=`${Math.round(w.zoom*100)}%`;reset.setAttribute('aria-label',`Zoom ${Math.round(w.zoom*100)}%. Repor a 100%`);};
    const save=()=>{try{localStorage.setItem(key,JSON.stringify(w.zoom));}catch{}};
    const apply=(zoom,x,y,anchor)=>{w.zoom=clamp(zoom,.25,3);w.paper.style.zoom=w.zoom;fitPaper(w);scroll.scrollLeft=anchor.x*w.zoom-x;scroll.scrollTop=anchor.y*w.zoom-y;label();};
    reset.addEventListener('click',()=>{const x=scroll.clientWidth/2,y=scroll.clientHeight/2;apply(1,x,y,{x:(scroll.scrollLeft+x)/w.zoom,y:(scroll.scrollTop+y)/w.zoom});save();});
    let pinch=null,blockClickUntil=0;
    const touches=e=>Array.from(e.touches).filter(t=>scroll.contains(t.target));
    const points=list=>{const a=list[0],b=list[1],r=scroll.getBoundingClientRect();return {distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),x:(a.clientX+b.clientX)/2-r.left-scroll.clientLeft,y:(a.clientY+b.clientY)/2-r.top-scroll.clientTop};};
    const begin=list=>{w.cancelObjectGesture?.();closeMenu();const p=points(list);pinch={distance:Math.max(1,p.distance),zoom:w.zoom,anchor:{x:(scroll.scrollLeft+p.x)/w.zoom,y:(scroll.scrollTop+p.y)/w.zoom}};w.pinching=true;scroll.classList.add('pinching');};
    scroll.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&(!e.isPrimary||w.pinching))e.stopPropagation();},true);
    scroll.addEventListener('touchstart',e=>{const list=touches(e);if(list.length<2)return;e.preventDefault();e.stopPropagation();begin(list);},{capture:true,passive:false});
    scroll.addEventListener('touchmove',e=>{const list=touches(e);if(list.length>=2){e.preventDefault();e.stopPropagation();if(!pinch)begin(list);const p=points(list);apply(pinch.zoom*p.distance/pinch.distance,p.x,p.y,pinch.anchor);}else if(w.pinching){e.preventDefault();e.stopPropagation();}},{capture:true,passive:false});
    const finish=e=>{if(!w.pinching)return;e.preventDefault();e.stopPropagation();pinch=null;save();if(!e.touches.length){w.pinching=false;scroll.classList.remove('pinching');blockClickUntil=Date.now()+400;}};
    scroll.addEventListener('touchend',finish,{capture:true,passive:false});scroll.addEventListener('touchcancel',finish,{capture:true,passive:false});
    scroll.addEventListener('click',e=>{if(w.pinching||Date.now()<blockClickUntil){e.preventDefault();e.stopPropagation();}},true);
    label();fitPaper(w);
  }
  function createWindow(note = null, focus = true) {
    if(note && windows.has(note.id)) { const w=windows.get(note.id);activate(w);w.el.scrollIntoView({block:'nearest',inline:'nearest'});closeSidebar();return w; }
    const data = decode(note?.content || '');
    const n=windows.size, width=Math.min(610,Math.max(280,workspace.clientWidth-28)), height=Math.min(690,Math.max(240,workspace.clientHeight-30));
    const initial = data.rect || {x:14+(n%3)*36,y:14+(n%3)*32,w:width,h:height};
    const rect={w:clamp(initial.w,280,Math.max(280,workspace.clientWidth-16)),h:clamp(initial.h,240,Math.max(240,workspace.clientHeight-16)),x:0,y:0};
    rect.x=clamp(initial.x,0,workspace.clientWidth-rect.w);rect.y=clamp(initial.y,0,workspace.clientHeight-40);
    const el=document.createElement('section');el.className='note-window';el.innerHTML=`<div class="window-bar"><button data-window="menu">Opções ▾</button><span class="bar-space"></span><button data-window="save">Guardar</button><button data-window="delete" class="delete-note-btn">Eliminar nota</button>${detached?'<button data-window="close" title="Guardar e fechar esta janela">Fechar ✕</button>':''}</div><div class="object-tools" hidden><span data-object-label>Objeto selecionado</span><label class="symbol-color-label" hidden>Cor do símbolo <input data-symbol-color type="color" value="#243039" aria-label="Cor do símbolo selecionado"></label><button data-object="edit-box" hidden>Escrever na caixa</button><button data-object="box-image" hidden>Imagem na caixa…</button><button data-object="box-symbol" hidden>Símbolo na caixa…</button><button data-object="select-box" hidden>Selecionar caixa</button><label>Rotação <input data-rotation type="number" min="0" max="359" step="1" value="0">°</label><button data-object="rotate-left" title="Girar 90 graus à esquerda">↶ 90°</button><button data-object="rotate-right" title="Girar 90 graus à direita">↷ 90°</button><button data-object="crop">Recortar imagem</button><button data-object="uncrop">Repor imagem inteira</button><button data-object="remove">Eliminar objeto</button></div><div class="note-scroll"><div class="note-paper"><div class="note-editor" contenteditable="true" role="textbox" aria-label="Texto da nota" aria-multiline="true" data-placeholder="Escreva a sua nota aqui…" spellcheck="true"></div></div></div><div class="window-footer"><span>${note?'Guardado neste dispositivo':'Pronto para escrever'}</span><span>Gravação automática</span></div>`;
    const w={id:note?.id||makeId(),title:note?.title === 'Sem título' ? '' : note?.title || '',el,editor:el.querySelector('.note-editor'),paper:el.querySelector('.note-paper'),footer:el.querySelector('.window-footer span'),...data,rect,selected:null,history:[],historyIndex:0};
    w.editor.innerHTML=data.html;windows.set(w.id,w);workspace.append(el);geometry(w);linkify(w,false);display(w);w.history=[snapshot(w)];
    el.addEventListener('pointerdown',()=>activate(w));
    setupObjectTools(w);
    setupNoteZoom(w);
    el.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{
      activate(w);const action=button.dataset.window;
      if(action==='close')askTitle(w,true);if(action==='save')askTitle(w,false);if(action==='delete')deleteNoteById(w.id);
      if(action==='menu'){if(!menu.hidden){closeMenu();return;}const r=button.getBoundingClientRect();openMenu(w,r.left,r.bottom+3);}
    }));
    w.paper.addEventListener('contextmenu',e=>{e.preventDefault();openMenu(w,e.clientX,e.clientY);});
    bindEditable(w,w.editor);
    activate(w);$('#empty-workspace').hidden=true;saveWorkspace();renderNotes();if(focus)w.editor.focus();return w;
  }
  function saveWorkspace() { if(!detached&&active)try {localStorage.setItem(`${storageKey()}:primary`,active.id);}catch{} }
  function removeWindow(w) {w.el.remove();windows.delete(w.id);if(active===w){active=null;savedRange=null;}$('#empty-workspace').hidden=false;if(!detached)createWindow(null,true);renderNotes();}
  function restoreWorkspace() {
    if(detached){
      if(detachedScope!==(user?.id||'guest')){status.textContent='Entre na conta que abriu esta nota para continuar.';return;}
      const note=notes.find(n=>n.id===detachedId&&!n.deletedAt);if(note)createWindow(note,true);else{status.textContent='Esta nota não está disponível neste dispositivo. Sincronize a conta para a procurar.';$('#empty-workspace').hidden=false;}return;
    }
    let id=null;try{id=localStorage.getItem(`${storageKey()}:primary`);}catch{}
    createWindow(notes.find(n=>n.id===id&&!n.deletedAt)||null,true);
  }
  function openDetached(id){
    const existing=popupHandles.get(id);if(existing&&!existing.closed){existing.focus();closeSidebar();return;}
    const note=notes.find(n=>n.id===id&&!n.deletedAt);if(!note)return;
    const rect=decode(note.content).popupRect||{};
    const url=new URL(location.href);url.search='';url.searchParams.set('note',id);url.searchParams.set('scope',user?.id||'guest');url.hash='';
    // Mobile notes stay inside the installed app instead of opening a browser custom tab.
    if(mobileNotes){if(active&&!commit(active,false))return;saveWorkspace();location.assign(url.href);return;}
    const width=clamp(rect.w||640,340,screen.availWidth||1600),height=clamp(rect.h||760,340,screen.availHeight||1000);
    const x=Number.isFinite(rect.x)?rect.x:screenX+80,y=Number.isFinite(rect.y)?rect.y:screenY+70;
    const handle=window.open(url.href,`notas-${user?.id||'guest'}-${id}`,`popup=yes,resizable=yes,scrollbars=yes,width=${width},height=${height},left=${x},top=${y}`);
    if(!handle){$('#popup-fallback').href=url.href;$('#popup-message').hidden=false;return;}
    popupHandles.set(id,handle);handle.focus();$('#popup-message').hidden=true;closeSidebar();
    if(!detached&&active?.id===id)removeWindow(active);
  }
  function newNote(){
    const id=makeId();notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];notes.push({id,title:'',titleHtml:'',content:'',updatedAt:new Date().toISOString(),deletedAt:null});
    if(persist()){openDetached(id);scheduleSync();renderNotes();}
  }
  function askTitle(w,closeAfter){
    if(!w)return;closeMenu();pendingTitle={w,closeAfter};$('#optional-title').value=w.title;$('#title-dialog').showModal();$('#optional-title').focus();
  }
  function finishTitle(keep){
    if(!pendingTitle)return;const {w,closeAfter}=pendingTitle;if(!windows.has(w.id)){$('#title-dialog').close();pendingTitle=null;return;}
    if(!keep)w.title=$('#optional-title').value.trim();display(w);
    if(!commit(w))return;
    $('#title-dialog').close();pendingTitle=null;if(closeAfter){if(detached&&mobileNotes){const url=new URL(location.href);url.search='';url.hash='';location.assign(url.href);}else if(detached)window.close();else removeWindow(w);}
  }
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
      item.append(open);list.append(item);
    });
  }
  function openSidebar(){$('#sidebar').classList.add('active');$('#sidebar').setAttribute('aria-hidden','false');$('#sidebar-backdrop').hidden=false;}
  function closeSidebar(){$('#sidebar').classList.remove('active');$('#sidebar').setAttribute('aria-hidden','true');$('#sidebar-backdrop').hidden=true;}
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
  function updateObjectTools(w){
    const tools=w.el.querySelector('.object-tools'),o=findObject(w,w.selected);tools.hidden=!o;if(!o)return;
    tools.querySelector('[data-object-label]').textContent=o.type==='textbox'?'Caixa de texto':o.type==='symbol'?'Símbolo selecionado':'Imagem selecionada';
    tools.querySelector('.symbol-color-label').hidden=o.type!=='symbol';if(o.type==='symbol')tools.querySelector('[data-symbol-color]').value=o.color;
    for(const action of ['edit-box','box-image','box-symbol'])tools.querySelector(`[data-object="${action}"]`).hidden=o.type!=='textbox';
    tools.querySelector('[data-object="select-box"]').hidden=!ownerBox(w,o.id);
    tools.querySelector('[data-rotation]').value=Math.round(angle(o.rotation));
    const pin=tools.querySelector('[data-object="pin"]');pin.hidden=o.type==='symbol';pin.textContent=o.pinned?'Desafixar':'Fixar';pin.setAttribute('aria-pressed',String(!!o.pinned));
    const bg=tools.querySelector('.box-background');bg.hidden=o.type!=='textbox';if(o.type==='textbox')bg.querySelector('input').value=o.bg||'#ffffff';
    tools.querySelectorAll('[data-rotation],[data-object="rotate-left"],[data-object="rotate-right"],[data-object="crop"],[data-object="uncrop"]').forEach(control=>control.disabled=!!o.pinned);
    tools.querySelector('[data-object="crop"]').hidden=o.type!=='image';tools.querySelector('[data-object="uncrop"]').hidden=o.type!=='image'||(validCrop(o.crop).w===1&&validCrop(o.crop).h===1);
  }
  function setupObjectTools(w){
    const tools=w.el.querySelector('.object-tools');
    const pin=document.createElement('button');pin.dataset.object='pin';pin.textContent='Fixar';pin.title='Fixar ou libertar a posição e o tamanho do objeto';tools.insertBefore(pin,tools.querySelector('[data-object="remove"]'));
    const bg=document.createElement('div');bg.className='box-background';bg.hidden=true;bg.innerHTML='<span>Fundo da caixa</span><div class="box-background-palette" role="group" aria-label="Cores de fundo da caixa"></div><input type="color" value="#ffffff" aria-label="Cor personalizada do fundo da caixa">';tools.append(bg);
    const paintBox=color=>{const o=findObject(w,w.selected);if(o?.type!=='textbox'||!/^#[0-9a-f]{6}$/i.test(color))return;captureTextBoxes(w);o.bg=color;const el=[...w.paper.querySelectorAll('.text-box')].find(el=>el.dataset.objectId===o.id);if(el)el.style.backgroundColor=color;bg.querySelector('input').value=color;commit(w);};
    Object.entries(backgrounds).forEach(([name,color])=>{const b=document.createElement('button');b.type='button';b.title=name;b.setAttribute('aria-label',`Fundo da caixa: ${name}`);b.style.backgroundColor=color;b.addEventListener('click',()=>paintBox(color));bg.querySelector('.box-background-palette').append(b);});
    bg.querySelector('input').addEventListener('input',e=>paintBox(e.target.value));
    tools.querySelector('[data-symbol-color]').addEventListener('input',e=>setSymbolColor(w,e.target.value));
    tools.querySelector('[data-symbol-color]').addEventListener('change',e=>setSymbolColor(w,e.target.value));
    tools.querySelector('[data-rotation]').addEventListener('change',e=>{const o=findObject(w,w.selected);if(!o)return;o.rotation=angle(e.target.value);keepObjectVisible(o);display(w);commit(w);});
    tools.addEventListener('click',e=>{const action=e.target.closest('[data-object]')?.dataset.object,o=findObject(w,w.selected);if(!o)return;
      if(action==='pin'){o.pinned=!o.pinned;display(w);commit(w);return;}
      if(action==='edit-box'){w.editBoxId=o.id;restoreSelection(w);return;}
      if(action==='box-image'){imageTarget={w,boxId:o.id};$('#image-input').click();return;}
      if(action==='box-symbol'){const rect=e.target.getBoundingClientRect();openMenu(w,rect.left,rect.bottom);$('#symbol-options').closest('details').open=true;return;}
      if(action==='select-box'){selectObject(w,ownerBox(w,o.id));return;}
      if(action==='crop'){openCrop(w,o);return;}if(action==='remove'){removeObject(w);return;}
      if(action==='rotate-left'||action==='rotate-right')o.rotation=angle(o.rotation+(action==='rotate-left'?-90:90));
      else if(action==='uncrop'){o.crop={x:0,y:0,w:1,h:1};o.h=o.w/(o.sourceRatio||o.w/o.h);}else return;
      keepObjectVisible(o);display(w);commit(w);
    });
  }
  function allObjects(w){return w.objects.flatMap(o=>o.type==='textbox'?[o,...o.children]:[o]);}
  function findObject(w,id){return allObjects(w).find(o=>o.id===id);}
  function ownerBox(w,id){return w.objects.find(o=>o.type==='textbox'&&o.children.some(c=>c.id===id))||null;}
  function insertionBox(w){const selected=findObject(w,w.selected);return selected?.type==='textbox'?selected:ownerBox(w,w.selected)||w.objects.find(o=>o.type==='textbox'&&o.id===w.editBoxId)||null;}
  function editingSurface(w){return [...w.paper.querySelectorAll('.textbox-editor')].find(e=>e.dataset.boxId===w.editBoxId)||w.editor;}
  function captureTextBoxes(w){for(const el of w.paper.querySelectorAll('.textbox-editor')){const box=findObject(w,el.dataset.boxId);if(box?.type==='textbox')box.html=el.innerHTML;}}
  function fitTextBoxes(w){
    for(const canvas of w.paper.querySelectorAll('.textbox-canvas')){const box=findObject(w,canvas.dataset.boxId);if(!box)continue;const bounds=box.children.map(objectBounds),editor=canvas.querySelector('.textbox-editor');canvas.style.minWidth=`${Math.max(0,...bounds.map(o=>o.right+24))}px`;canvas.style.height=`${Math.max(canvas.parentElement.clientHeight,editor.scrollHeight+24,...bounds.map(o=>o.bottom+24))}px`;editor.style.width=`calc((100% - 24px) * ${(box.textWidth||100)/100})`;}
  }
  function selectObject(w,o){
    activate(w);w.selected=o?.id||null;w.editBoxId=o?.type==='textbox'?o.id:ownerBox(w,o?.id)?.id||null;
    w.paper.querySelectorAll('.note-object').forEach(el=>el.classList.toggle('selected',el.dataset.objectId===w.selected));updateObjectTools(w);
  }
  function bindEditable(w,editor,box=null){
    const target=()=>{activate(w);w.editBoxId=box?.id||null;if(box)selectObject(w,box);else{w.selected=null;w.paper.querySelectorAll('.selected').forEach(e=>e.classList.remove('selected'));updateObjectTools(w);}};
    editor.addEventListener('pointerdown',e=>{e.stopPropagation();target();});
    editor.addEventListener('focus',target);
    editor.addEventListener('input',e=>{if(applyingEdit)return;if(/\s/.test(e.data||'')||['insertParagraph','insertLineBreak','insertFromPaste'].includes(e.inputType))linkify(w,true,editor);fitPaper(w);commit(w);rememberSelection(w);});
    editor.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();target();openMenu(w,e.clientX,e.clientY);});
    editor.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a&&safeLink(a.getAttribute('href'))){e.preventDefault();window.open(a.href,'_blank','noopener,noreferrer');}});
    editor.addEventListener('paste',e=>{e.preventDefault();e.stopPropagation();target();rememberSelection(w);const data=e.clipboardData,files=[...data.files].filter(f=>f.type.startsWith('image/'));if(files.length){files.forEach(f=>insertImageFile(w,f,box?.id||null));return;}const html=data.getData('text/html');command(html?'insertHTML':'insertText',html?cleanClipboardHTML(html):data.getData('text/plain'),w);});
    editor.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();target();[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')).forEach(f=>insertImageFile(w,f,box?.id||null));});
    editor.addEventListener('dragover',e=>e.preventDefault());
    editor.addEventListener('beforeinput',e=>{if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();undo(w,e.inputType==='historyUndo'?-1:1);}});
  }
  function setSymbolColor(w,color){
    const o=findObject(w,w.selected);if(o?.type!=='symbol'||!/^#[0-9a-f]{6}$/i.test(color))return false;
    o.color=color;const el=[...w.paper.querySelectorAll('.note-object')].find(e=>e.dataset.objectId===o.id);el?.querySelector('svg text')?.setAttribute('fill',color);updateObjectTools(w);commit(w);return true;
  }
  function renderObjects(w){
    w.paper.querySelectorAll(':scope > .note-object').forEach(el=>el.remove());
    function renderObject(o,container,parent=null){
      o.rotation=angle(o.rotation);o.crop=validCrop(o.crop);
      const el=document.createElement('div');el.className=`note-object${o.type==='textbox'?' text-box':''}${w.selected===o.id?' selected':''}`;el.dataset.objectId=o.id;el.tabIndex=0;
      el.classList.toggle('pinned',!!o.pinned);
      el.setAttribute('aria-label',o.type==='textbox'?'Caixa de texto: arraste pela barra e redimensione pelos cantos':o.type==='image'?'Imagem: selecione para girar, recortar ou redimensionar':`Símbolo ${o.symbol}: selecione para alterar a cor, girar ou redimensionar`);setObjectGeometry(el,o);
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
      const rotate=document.createElement('button');rotate.className='object-rotate';rotate.textContent='↻';rotate.title='Arraste para girar livremente';rotate.setAttribute('aria-label','Girar objeto livremente');el.append(rotate);
      el.addEventListener('pointerdown',e=>{
        if(e.target.closest('.note-object')!==el)return;e.stopPropagation();selectObject(w,o);
        if(e.button!==0||e.target.closest('.textbox-editor'))return;
        if(o.pinned){el.focus({preventScroll:true});return;}
        const corner=e.target.dataset.corner,rotating=e.target===rotate;
        if(o.type==='textbox'&&!corner&&!rotating&&!e.target.closest('.textbox-drag')&&e.target!==el)return;
        el.focus({preventScroll:true});const initial={...o},box=el.getBoundingClientRect(),cx=box.x+box.width/2,cy=box.y+box.height/2,startAngle=Math.atan2(e.clientY-cy,e.clientX-cx);
        const parentTheta=(parent?.rotation||0)*Math.PI/180,pc=Math.cos(parentTheta),ps=Math.sin(parentTheta),theta=o.rotation*Math.PI/180+parentTheta,cos=Math.cos(theta),sin=Math.sin(theta),lc=Math.cos(o.rotation*Math.PI/180),ls=Math.sin(o.rotation*Math.PI/180);
        w.cancelObjectGesture=gesture(e,(dx,dy)=>{
          if(!rotating){dx/=w.zoom||1;dy/=w.zoom||1;}
          if(rotating)o.rotation=angle(initial.rotation+(Math.atan2(e.clientY+dy-cy,e.clientX+dx-cx)-startAngle)*180/Math.PI);
          else if(corner){
            const sx=corner.includes('w')?-1:1,sy=corner.includes('n')?-1:1,lx=cos*dx+sin*dy,ly=-sin*dx+cos*dy;
            let nw=clamp(initial.w+sx*lx,o.type==='textbox'?180:o.type==='symbol'?8:20,6000),nh=clamp(initial.h+sy*ly,o.type==='textbox'?120:o.type==='symbol'?8:20,6000);
            if(o.type==='image'&&corner==='ne'){
              // Return to the source image's visible proportions even after a free resize.
              const crop=validCrop(o.crop),ratio=(o.sourceRatio||initial.w/initial.h)*crop.w/crop.h;
              nh=clamp(((initial.w+sx*lx)*ratio+(initial.h+sy*ly))/(ratio*ratio+1),Math.max(20,20/ratio),Math.min(6000,6000/ratio));nw=nh*ratio;
            }
            const shiftX=sx*(nw-initial.w)/2,shiftY=sy*(nh-initial.h)/2;o.x=initial.x+initial.w/2+lc*shiftX-ls*shiftY-nw/2;o.y=initial.y+initial.h/2+ls*shiftX+lc*shiftY-nh/2;o.w=nw;o.h=nh;
          }else{o.x=initial.x+pc*dx+ps*dy;o.y=initial.y-ps*dx+pc*dy;}
          keepObjectVisible(o);setObjectGeometry(el,o);updateObjectTools(w);fitPaper(w);
        },()=>{w.cancelObjectGesture=null;commit(w);},()=>{w.cancelObjectGesture=null;Object.assign(o,initial);setObjectGeometry(el,o);fitPaper(w);});
      });
      el.addEventListener('keydown',e=>{
        if(e.target.closest('.textbox-editor')||e.target.closest('.note-object')!==el)return;
        if(o.pinned&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();return;}
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const d=e.shiftKey?10:1;o.x+=(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0);o.y+=(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0);keepObjectVisible(o);setObjectGeometry(el,o);fitPaper(w);commit(w);}
        else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();w.selected=o.id;removeObject(w);}
      });container.append(el);
    }
    w.objects.forEach(o=>renderObject(o,w.paper));updateObjectTools(w);
  }

  let cropState=null,linkTarget=null;
  function showCrop(){
    if(!cropState)return;const c=cropState.crop;Object.assign($('#crop-selection').style,{left:`${c.x*100}%`,top:`${c.y*100}%`,width:`${c.w*100}%`,height:`${c.h*100}%`});
    for(const k of ['x','y','w','h'])$('#crop-'+k).value=Math.round(c[k]*100);
  }
  async function openCrop(w,o){
    closeMenu();cropState={w,id:o.id,crop:{...validCrop(o.crop)}};
    const img=$('#crop-source');img.src=o.src;
    try{await img.decode();if(!cropState||cropState.id!==o.id)return;const width=Math.min(600,innerWidth-80,Math.max(150,innerHeight-330)*img.naturalWidth/img.naturalHeight);$('#crop-stage').style.width=`${width}px`;$('#crop-dialog').showModal();showCrop();}
    catch{cropState=null;status.textContent='Não foi possível abrir a imagem para recorte.';}
  }
  function setupCropAndLinks(){
    $('#crop-selection').addEventListener('pointerdown',e=>{
      if(!cropState||e.button!==0)return;const initial={...cropState.crop},corner=e.target.dataset.cropCorner,rect=$('#crop-stage').getBoundingClientRect();
      gesture(e,(dx,dy)=>{let {x,y,w,h}=initial;dx/=rect.width;dy/=rect.height;if(!corner){x=clamp(x+dx,0,1-w);y=clamp(y+dy,0,1-h);}else{
        if(corner.includes('w')){x=clamp(initial.x+dx,0,initial.x+initial.w-.02);w=initial.x+initial.w-x;}else w=clamp(initial.w+dx,.02,1-x);
        if(corner.includes('n')){y=clamp(initial.y+dy,0,initial.y+initial.h-.02);h=initial.y+initial.h-y;}else h=clamp(initial.h+dy,.02,1-y);
      }cropState.crop={x,y,w,h};showCrop();},()=>{});
    });
    for(const k of ['x','y','w','h'])$('#crop-'+k).addEventListener('change',e=>{if(cropState){cropState.crop=validCrop({...cropState.crop,[k]:Number(e.target.value)/100});showCrop();}});
    $('#reset-crop').addEventListener('click',()=>{if(cropState){cropState.crop={x:0,y:0,w:1,h:1};showCrop();}});
    $('#cancel-crop').addEventListener('click',()=>$('#crop-dialog').close());$('#crop-dialog').addEventListener('close',()=>{cropState=null;});
    $('#apply-crop').addEventListener('click',()=>{
      if(!cropState)return;const {w,id,crop}=cropState,o=findObject(w,id);if(o&&windows.has(w.id)){o.sourceRatio=o.sourceRatio||o.w/o.h;o.crop={...crop};o.h=o.w*crop.h/crop.w/o.sourceRatio;keepObjectVisible(o);display(w);commit(w);}$('#crop-dialog').close();
    });
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
    w.selected=id;w.editBoxId=object.type==='textbox'?id:box?.id||null;savedRange=null;display(w);commit(w);closeMenu();
    if(object.type==='textbox')editingSurface(w).focus();
  }
  async function insertImageFile(w,file,boxId=insertionBox(w)?.id||null){
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
    const range=selection.getRangeAt(0),node=range.commonAncestorContainer,editor=(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('.note-editor,.textbox-editor');
    if(editor&&w.el.contains(editor)){savedRange=range.cloneRange();if(document.activeElement===editor)w.editBoxId=editor.dataset.boxId||null;}
  }
  function restoreSelection(w){
    const editor=editingSurface(w);editor.focus();const selection=getSelection();selection.removeAllRanges();
    if(savedRange && editor.contains(savedRange.commonAncestorContainer))selection.addRange(savedRange);
    else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.addRange(range);}
  }
  function command(name,value=null,w=active){if(!w)return;if(name==='foreColor'&&setSymbolColor(w,value)){closeMenu();return;}restoreSelection(w);applyingEdit=true;try{document.execCommand(name,false,value);}finally{applyingEdit=false;}if(name==='insertText'||name==='insertHTML')linkify(w);rememberSelection(w);fitPaper(w);commit(w);closeMenu();}
  function fontSize(value){
    if(!active)return;const w=active;restoreSelection(w);const editor=editingSurface(w);
    if(getSelection().isCollapsed){
      const marker=`size-${makeId()}`;applyingEdit=true;try{document.execCommand('insertHTML',false,`<span id="${marker}" style="font-size:${value}px">&#8203;</span>`);}finally{applyingEdit=false;}
      const span=editor.querySelector(`[id="${marker}"]`);if(span){span.removeAttribute('id');const r=document.createRange();r.selectNodeContents(span);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}
    }else{applyingEdit=true;try{document.execCommand('fontSize',false,'7');}finally{applyingEdit=false;}}
    editor.querySelectorAll('font[size="7"]').forEach(el=>{el.removeAttribute('size');el.style.fontSize=`${value}px`;});
    $('#size-label').textContent=value;rememberSelection(w);commit(w);closeMenu();
  }
  function changeCase(mode){if(!active)return;restoreSelection(active);const text=getSelection().toString();if(text)command('insertText',mode==='upper'?text.toLocaleUpperCase('pt-PT'):text.toLocaleLowerCase('pt-PT'));}
  function undo(w,direction){
    if(!w)return;const index=w.historyIndex+direction;if(index<0||index>=w.history.length)return;
    const previousBox=w.editBoxId;w.historyIndex=index;const s=JSON.parse(w.history[index]);w.editor.innerHTML=s.html;w.bg=s.bg;w.textWidth=s.textWidth;w.objects=s.objects;w.shipments=decodeShipments(s.shipments);w.selected=null;w.editBoxId=w.objects.some(o=>o.id===previousBox)?previousBox:null;savedRange=null;display(w);commit(w,false);editingSurface(w).focus();closeMenu();
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
  function openMenu(w,x,y){
    activate(w);rememberSelection(w);const box=insertionBox(w);menu.hidden=false;menu.style.maxHeight='';menu.style.left='8px';menu.style.top='8px';$('#text-width').value=box?.textWidth||w.textWidth;$('#width-label').value=`${box?.textWidth||w.textWidth}%`;
    menu.querySelector('[data-action="image"]').textContent=box?'Inserir imagem na caixa…':'Inserir imagem…';
    const top=clamp(y,8,innerHeight-180);menu.style.maxHeight=`${innerHeight-top-8}px`;const r=menu.getBoundingClientRect();menu.style.left=`${clamp(x,8,innerWidth-r.width-8)}px`;menu.style.top=`${top}px`;
  }
  function closeMenu(){menu.hidden=true;}
  function colorButton(container,color,label,action){const button=document.createElement('button');button.className='color-dot';button.style.setProperty('--color',color);button.title=label;button.setAttribute('aria-label',label);if(color==='transparent')button.textContent='×';button.addEventListener('click',action);container.append(button);}
  function renderFavorites(){['text','highlight'].forEach(kind=>{const area=$(`#${kind}-favorites`);area.replaceChildren();favorites[kind].filter(c=>/^#[0-9a-f]{6}$/i.test(c)).forEach(c=>colorButton(area,c,`Favorita ${c}`,()=>command(kind==='text'?'foreColor':'hiliteColor',c)));});}
  function setupMenu(){
    [['ARIAL','Arial'],['CALIBRI','Calibri'],['APTOS TÍTULOS','Aptos Display']].forEach(([label,font])=>{const b=document.createElement('button');b.textContent=label;b.style.fontFamily=`"${font}", Arial, sans-serif`;b.addEventListener('click',()=>command('fontName',font));$('#font-options').append(b);});
    for(let i=6;i<=24;i++){const b=document.createElement('button');b.textContent=i;b.addEventListener('click',()=>fontSize(i));$('#size-options').append(b);}
    const textColors=['#171717','#e5251f','#1565c0','#188038','#ef6c00','#7b1fa2'];
    const highlightColors=['transparent','#fff176','#80deea','#a5d6a7','#f8bbd0','#ffcc80'];
    textColors.forEach(c=>colorButton($('#text-palette'),c,c,()=>command('foreColor',c)));
    highlightColors.forEach(c=>colorButton($('#highlight-palette'),c,c==='transparent'?'Retirar marcação':c,()=>command('hiliteColor',c)));
    Object.entries(backgrounds).forEach(([name,c])=>colorButton($('#background-palette'),c,name,()=>{if(active){active.bg=c;display(active);commit(active);closeMenu();}}));
    symbols.forEach(symbol=>{const b=document.createElement('button');b.textContent=symbol;b.setAttribute('aria-label',`Inserir ${symbol}`);b.addEventListener('click',()=>{if(active)addObject(active,{type:'symbol',symbol,color:$('#text-color-input').value,w:80,h:80});});$('#symbol-options').append(b);});
    renderFavorites();
    menu.addEventListener('pointerdown',e=>{if(e.target.closest('button,summary'))e.preventDefault();});
    menu.querySelectorAll('details').forEach(details=>details.addEventListener('toggle',()=>{if(details.open){menu.querySelectorAll('details').forEach(other=>{if(other!==details)other.open=false;});menu.style.top=`${clamp(parseFloat(menu.style.top),8,innerHeight-menu.getBoundingClientRect().height-8)}px`;}}));
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
  function latestById(items){return items.reduce((map,n)=>{if(!map.has(n.id)||Date.parse(n.updatedAt)>Date.parse(map.get(n.id).updatedAt))map.set(n.id,n);return map;},new Map());}
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
        const pending=[...localMap.values()].filter(n=>!remoteMap.has(n.id)||Date.parse(n.updatedAt)>Date.parse(remoteMap.get(n.id).updatedAt));
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
          if(n.deletedAt){removeWindow(w);return;}
          if(n.updatedAt!==previous.get(w.id)){
            const data=decode(n.content);w.editor.innerHTML=data.html;w.title=n.title||'';w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.shipments=data.shipments;w.history=[snapshot(w)];w.historyIndex=0;w.selected=null;if(active===w)savedRange=null;display(w);
          }
        });
        if(detached&&!active&&notes.some(n=>n.id===detachedId&&!n.deletedAt))restoreWorkspace();renderNotes();status.textContent='Sincronizado';
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
    const next=session?.user||null;reconcilePushAccount(next?.id||null);if(next?.id===user?.id){user=next;setAuthView();return;}
    saveWorkspace();sessionEpoch++;clearTimeout(syncTimer);windows.forEach(w=>w.el.remove());windows.clear();active=null;savedRange=null;closeMenu();
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());pendingTitle=null;user=next;notes=loadNotes(storageKey());$('#empty-workspace').hidden=false;setAuthView();restoreWorkspace();renderNotes();if(user){syncNotes();if(route.searchParams.has('reminder')){$('#reminders-dialog').showModal();renderReminders();}}
  }
  $('#auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!cloud)return setAuthView();try{const {error}=await cloud.auth.signInWithPassword({email:$('#auth-email').value.trim(),password:$('#auth-password').value});$('#auth-message').textContent=error?error.message:'Sessão iniciada.';$('#auth-password').value='';}catch{$('#auth-message').textContent='Não foi possível entrar. Verifique a ligação.';}});
  $('#signup-btn').addEventListener('click',async()=>{if(!cloud||!$('#auth-form').reportValidity())return;try{const {error}=await cloud.auth.signUp({email:$('#auth-email').value.trim(),password:$('#auth-password').value,options:{emailRedirectTo:location.origin+location.pathname}});$('#auth-message').textContent=error?error.message:'Conta criada. Confirme o e-mail recebido e depois entre.';}catch{$('#auth-message').textContent='Não foi possível criar a conta. Verifique a ligação.';}});
  $('#logout-btn').addEventListener('click',async()=>{if(!cloud)return;try{const {error}=await cloud.auth.signOut();if(error){$('#auth-message').textContent=error.message;return;}setSession(null);$('#auth-dialog').close();}catch{$('#auth-message').textContent='Não foi possível terminar a sessão.';}});
  $('#account-btn').addEventListener('click',()=>{setAuthView();$('#auth-dialog').showModal();});$('#close-auth-btn').addEventListener('click',()=>$('#auth-dialog').close());$('#sync-btn').addEventListener('click',syncNotes);
  $('#toggle-sidebar-btn').addEventListener('click',openSidebar);$('#close-sidebar-btn').addEventListener('click',closeSidebar);$('#sidebar-backdrop').addEventListener('click',closeSidebar);
  $('#new-note-btn').addEventListener('click',newNote);$('#empty-new-btn').addEventListener('click',newNote);
  $('#title-form').addEventListener('submit',e=>{e.preventDefault();finishTitle(false);});$('#keep-title').addEventListener('click',()=>finishTitle(true));$('#cancel-title').addEventListener('click',()=>{$('#title-dialog').close();pendingTitle=null;});
  $('#image-input').addEventListener('change',e=>{const file=e.target.files[0],target=imageTarget;e.target.value='';if(file&&target?.w)insertImageFile(target.w,file,target.boxId);});
  document.addEventListener('selectionchange',()=>rememberSelection());
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'&&!e.isPrimary)return;
    if(!menu.contains(e.target)&&!e.target.closest('[data-window="menu"]'))closeMenu();
    if(!e.target.closest('.note-object,.object-tools,.context-menu,button,input,select,textarea,dialog,summary')){
      windows.forEach(w=>{if(w.selected)selectObject(w,null);});
    }
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeMenu();closeSidebar();}
    if(e.target.closest('dialog,input,textarea'))return;
    const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();askTitle(active,false);}
    if((e.ctrlKey||e.metaKey)&&(key==='z'||key==='y')){e.preventDefault();undo(active,key==='y'||e.shiftKey?1:-1);}
  });
  addEventListener('pagehide',()=>{if(detached&&active&&!notes.find(n=>n.id===active.id)?.deletedAt)commit(active,false);saveWorkspace();});
  addEventListener('beforeunload',e=>{if(localSaveFailed&&!persist()){e.preventDefault();e.returnValue='';}});
  let storageTimer;
  addEventListener('storage',e=>{
    if(e.key!==storageKey()&&!e.key?.startsWith(`${storageKey()}:entry:`))return;
    clearTimeout(storageTimer);storageTimer=setTimeout(()=>{
    const previous=new Map(notes.map(n=>[n.id,n.updatedAt]));notes=[...latestById([...notes,...loadNotes(storageKey())]).values()];
    windows.forEach(w=>{const n=notes.find(n=>n.id===w.id);if(!n||n.updatedAt===previous.get(w.id))return;if(n.deletedAt){removeWindow(w);return;}const data=decode(n.content);w.editor.innerHTML=data.html;w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.shipments=data.shipments;w.title=n.title||'';w.history=[snapshot(w)];w.historyIndex=0;savedRange=null;display(w);});renderNotes();scheduleSync();},35);
  });
  addEventListener('online',()=>{if(user)syncNotes();});addEventListener('focus',()=>{if(user)syncNotes();});
  addEventListener('resize',()=>windows.forEach(fitPaper));
  function decodeShipments(value){
    if(!Array.isArray(value))return [];
    return value.filter(s=>s&&typeof s.id==='string').map(s=>({id:s.id,clinic:String(s.clinic||'').slice(0,200),doctor:String(s.doctor||'').slice(0,200),patient:String(s.patient||'').slice(0,200),total:Math.round(clamp(s.total,1,9999)),sent:Math.round(clamp(s.sent,0,9999)),sentDate:/^\d{4}-\d{2}-\d{2}$/.test(s.sentDate)?s.sentDate:'',nextDate:/^\d{4}-\d{2}-\d{2}$/.test(s.nextDate)?s.nextDate:'',observations:String(s.observations||'').slice(0,5000)}));
  }
  let shipmentTarget=null, reminderTarget=null, reminderAccount=null;
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
      const actions=document.createElement('div');actions.className='record-actions';actions.append(button('Editar caso',()=>editShipment(note.id,s)),button('Lembrar próximo envio',()=>openReminder({noteId:note.id,shipmentId:s.id,label:`Enviar alinhadores — ${s.patient}`,due:s.nextDate?`${s.nextDate}T09:00`:''})));card.append(actions);list.append(card);
    }
    if(!records.length)list.append(textElement('p','Nenhum caso encontrado. Adicione um caso para começar.'));
  }
  function editShipment(noteId,s=null){
    shipmentTarget={noteId,id:s?.id||makeId(),epoch:sessionEpoch};const form=$('#shipment-form');form.reset();$('#shipment-error').textContent='';
    for(const name of ['clinic','doctor','patient','total','sent','sentDate','nextDate','observations'])form.elements[name].value=s?.[name]??(name==='sent'?0:'');
    updateRemaining();$('#shipment-dialog').showModal();
  }
  function updateRemaining(){const f=$('#shipment-form'),total=Number(f.elements.total.value),sent=Number(f.elements.sent.value);f.elements.sent.setCustomValidity(sent>total&&total>0?'O número enviado não pode exceder o total.':'');$('#shipment-remaining').textContent=total>0?`Faltam enviar: ${Math.max(0,total-sent)} alinhadores`:'';}
  $('#shipments-btn').addEventListener('click',openShipments);
  $('#shipment-search').addEventListener('input',renderShipments);
  $('#new-shipment').addEventListener('click',()=>{if(active&&commit(active))editShipment(active.id);});
  $('#shipment-form').addEventListener('input',updateRemaining);
  $('#shipment-form').addEventListener('submit',e=>{
    e.preventDefault();if(!shipmentTarget||shipmentTarget.epoch!==sessionEpoch)return;const {noteId,id}=shipmentTarget;
    const old=notes.find(n=>n.id===noteId&&!n.deletedAt);if(!old){$('#shipment-error').textContent='A nota deste caso já não está disponível.';return;}
    const s={id,...Object.fromEntries(new FormData(e.target))};s.total=Number(s.total);s.sent=Number(s.sent);
    const w=windows.get(noteId);let ok;
    if(w){captureTextBoxes(w);w.shipments=w.shipments.filter(v=>v.id!==id).concat(s);ok=commit(w);}
    else{const data=decode(old.content),editor=document.createElement('div');editor.innerHTML=data.html;const content=encode({...data,editor,shipments:data.shipments.filter(v=>v.id!==id).concat(s)});notes[notes.indexOf(old)]={...old,content,updatedAt:timestamp(old.updatedAt)};ok=persist();if(ok)scheduleSync();}
    if(!ok){$('#shipment-error').textContent='Não foi possível guardar. Mantenha este formulário aberto e tente novamente.';return;}
    $('#shipment-dialog').close();renderShipments();
  });
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
  async function reminderAPI(action,values={}){
    if(!user||!cloud)throw new Error('Entre na sua conta em Sincronizar / Conta para usar os lembretes.');
    const epoch=sessionEpoch;let result;
    try{result=await cloud.functions.invoke('notes-reminders',{body:{action,...values}});}catch{throw new Error('Sem ligação ao serviço de lembretes. Tente novamente quando estiver online.');}
    if(epoch!==sessionEpoch)throw new Error('A conta foi alterada. Abra os lembretes novamente.');
    if(result.error||result.data?.error)throw new Error(result.data?.error||'O serviço de lembretes ainda não está disponível. É necessário concluir a configuração do servidor.');
    return result.data;
  }
  function reconcilePushAccount(nextId){
    const key=GUEST_KEY+':push-owner';let owner;try{owner=localStorage.getItem(key);}catch{return;}
    if(owner&&owner!==nextId&&'serviceWorker' in navigator){localStorage.removeItem(key);navigator.serviceWorker.getRegistration().then(r=>r?.pushManager.getSubscription()).then(s=>s?.unsubscribe()).catch(()=>{});}
  }
  async function pushRegistration(){
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Este navegador não suporta estes avisos. Use a aplicação instalada a partir do Chrome ou Safari.');
    const reg=await navigator.serviceWorker.getRegistration();if(!reg?.active)throw new Error('Reabra a aplicação online para concluir a instalação das notificações.');return reg;
  }
  async function renderReminders(){
    const epoch=sessionEpoch;$('#push-status').textContent='A consultar lembretes…';$('#reminder-list').replaceChildren();$('#disable-push').hidden=true;
    try{
      const data=await reminderAPI('list');if(epoch!==sessionEpoch)return;
      let subscribed=false;try{const sub=await (await pushRegistration()).pushManager.getSubscription();subscribed=!!sub&&(data.endpoints||[]).includes(sub.endpoint);}catch{}
      $('#push-status').textContent=subscribed?'Notificações ativadas neste dispositivo.':(data.devices?'Ative as notificações neste dispositivo. Já existem outros dispositivos ativados na sua conta.':'Ainda não existem dispositivos ativados. Ative as notificações para receber os avisos.');
      $('#disable-push').hidden=!subscribed;
      const list=$('#reminder-list');for(const r of data.reminders||[]){
        const card=document.createElement('article');card.className='record-card';card.append(textElement('h3',r.label),textElement('p',new Date(r.due_at).toLocaleString('pt-PT')));
        const labels={scheduled:'Agendado',sent:'Aviso enviado',completed:'Concluído',cancelled:'Cancelado'};card.append(textElement('strong',labels[r.status]||r.status));
        if(r.status==='scheduled'&&Date.parse(r.due_at)<Date.now())card.append(textElement('p','Hora atingida. A entrega depende da ligação e das permissões dos dispositivos.'));
        if(['scheduled','sent'].includes(r.status)){
          const actions=document.createElement('div');actions.className='record-actions';
          actions.append(button('Concluir',()=>changeReminder(r.id,'complete')),button('Reagendar',()=>openReminder({id:r.id,label:r.label,noteId:r.note_id,shipmentId:r.shipment_id,due:localDateTime(new Date(Math.max(Date.now()+3600000,Date.parse(r.due_at))))})),button('Cancelar lembrete',()=>changeReminder(r.id,'cancel')));card.append(actions);
        }list.append(card);
      }if(!list.children.length)list.append(textElement('p','Ainda não existem lembretes.'));
    }catch(error){if(epoch===sessionEpoch)$('#push-status').textContent=error.message;}
  }
  async function changeReminder(id,action){try{await reminderAPI(action,{id});await renderReminders();}catch(e){$('#push-status').textContent=e.message;}}
  function openReminder(target={}){
    reminderTarget={...target};reminderAccount=sessionEpoch;$('#reminder-label').value=target.label||'';$('#reminder-due').value=target.due||localDateTime(new Date(Date.now()+3600000));
    $('#reminder-zone').textContent=`Hora deste dispositivo: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. O aviso chegará aos dispositivos ativados na sua conta.`;
    $('#reminder-error').textContent='';$('#reminder-dialog').showModal();
  }
  $('#reminders-btn').addEventListener('click',()=>{closeMenu();$('#reminders-dialog').showModal();renderReminders();});
  $('#new-reminder').addEventListener('click',()=>openReminder({noteId:active?.id||null}));
  $('#enable-push').addEventListener('click',async()=>{
    const b=$('#enable-push'),epoch=sessionEpoch;b.disabled=true;
    try{
      if(!user)throw new Error('Entre na sua conta em Sincronizar / Conta.');
      if(!('Notification' in window))throw new Error('Este navegador não suporta notificações.');
      const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('As notificações não foram permitidas. Pode autorizá-las nas definições do navegador.');
      const {publicKey}=await reminderAPI('settings'),reg=await pushRegistration();
      const raw=atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),key=Uint8Array.from(raw,c=>c.charCodeAt(0));
      let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      if(epoch!==sessionEpoch){await sub.unsubscribe();return;}
      await reminderAPI('subscribe',{subscription:sub.toJSON()});localStorage.setItem(`${GUEST_KEY}:push-owner`,user.id);await renderReminders();
    }catch(e){$('#push-status').textContent=e.message;}finally{b.disabled=false;}
  });
  $('#disable-push').addEventListener('click',async()=>{try{const sub=await (await pushRegistration()).pushManager.getSubscription();if(sub){await reminderAPI('unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}await renderReminders();}catch(e){$('#push-status').textContent=e.message;}});
  $('#reminder-form').addEventListener('submit',async e=>{
    e.preventDefault();const due=new Date($('#reminder-due').value),label=$('#reminder-label').value.trim(),submit=e.target.querySelector('[type=submit]');
    if(!label||!Number.isFinite(due.getTime())||due.getTime()<=Date.now()){$('#reminder-error').textContent='Indique uma descrição e uma data/hora futura.';return;}
    if(reminderAccount!==sessionEpoch)return;submit.disabled=true;const epoch=sessionEpoch;
    try{await reminderAPI('save',{id:reminderTarget.id||makeId(),label,dueAt:due.toISOString(),noteId:reminderTarget.noteId||null,shipmentId:reminderTarget.shipmentId||null});if(epoch!==sessionEpoch)return;$('#reminder-dialog').close();if(!$('#reminders-dialog').open)$('#reminders-dialog').showModal();await renderReminders();}catch(error){$('#reminder-error').textContent=error.message;}finally{submit.disabled=false;}
  });

  setupMenu();setupCropAndLinks();setAuthView();restoreWorkspace();renderNotes();
  if(cloud){cloud.auth.getSession().then(({data})=>setSession(data.session)).catch(()=>{status.textContent='Sem ligação à conta; notas disponíveis neste dispositivo.';});cloud.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>setSession(session),0);});}
  if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update()).catch(()=>{}));
})();

