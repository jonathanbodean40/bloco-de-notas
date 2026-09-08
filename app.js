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
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');
  const cloud = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let user = null, active = null, savedRange = null, zIndex = 1, titleHtmlSupported = true, applyingEdit = false;
  let syncTimer, syncFlight = null, syncAgain = false, sessionEpoch = 0, pendingTitle = null, imageTarget = null, localSaveFailed = false;
  let notes = loadNotes(GUEST_KEY);
  let favorites = readJSON(FAVORITES_KEY, {text:[],highlight:[]});
  if (!favorites || !Array.isArray(favorites.text) || !Array.isArray(favorites.highlight)) favorites = {text:[],highlight:[]};
  function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function loadNotes(key) { const data = readJSON(key, []); return Array.isArray(data) ? data.filter(n => n && typeof n.id === 'string') : []; }
  function storageKey() { return user ? `${GUEST_KEY}:${user.id}` : GUEST_KEY; }
  function persist() {
    try { localStorage.setItem(storageKey(), JSON.stringify(notes)); localSaveFailed=false;return true; }
    catch { localSaveFailed=true;status.textContent = 'Não foi possível guardar: armazenamento cheio ou indisponível. Mantenha a página aberta e reduza as imagens.'; return false; }
  }
  function makeId() { return self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
  function timestamp(previous) { return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString(); }
  function clamp(n, min, max) { return Math.min(Math.max(Number(n) || min, min), Math.max(min, max)); }
  function plainText(html) { const t = document.createElement('template'); t.innerHTML = html || ''; return (t.content.textContent || '').trim(); }
  function cleanHTML(html) {
    const template = document.createElement('template'); template.innerHTML = typeof html === 'string' ? html : '';
    const allowed = new Set('DIV P BR SPAN B STRONG I EM U S STRIKE DEL FONT UL OL LI BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 A IMG TABLE THEAD TBODY TFOOT TR TD TH HR SUB SUP'.split(' '));
    template.content.querySelectorAll('*').forEach(el => {
      if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','LINK','META','SVG','MATH'].includes(el.tagName)) { el.remove(); return; }
      if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (!['style','href','src','alt','title','color','face','size','width','height','colspan','rowspan'].includes(name)) el.removeAttribute(attr.name);
      });
      if (el.hasAttribute('href') && !/^(https?:|mailto:|#)/i.test(el.getAttribute('href'))) el.removeAttribute('href');
      if (el.tagName === 'A') el.setAttribute('rel','noopener noreferrer');
      if (el.tagName === 'IMG' && !safeImage(el.getAttribute('src'))) { el.remove(); return; }
      const css = el.style;
      [...css].forEach(prop => { if (!/^(color|background-color|font-size|font-family|font-weight|font-style|text-decoration(-line|-color|-style)?|text-align|vertical-align|white-space|line-height|list-style-type|width|height|max-width|border(-color|-width|-style)?|padding(-left|-right|-top|-bottom)?|margin(-left|-right|-top|-bottom)?)$/.test(prop) || /url\s*\(|expression|javascript|var\(/i.test(css.getPropertyValue(prop))) css.removeProperty(prop); });
    });
    return template.innerHTML;
  }
  function safeImage(src) { return typeof src === 'string' && /^(data:image\/(png|jpeg|webp|gif|avif);base64,|https?:\/\/)/i.test(src); }
  function decode(content) {
    const t = document.createElement('template'); t.innerHTML = content || '';
    const root = t.content.querySelector('[data-notas-pro="3"]');
    let meta = {};
    if (root) { try { meta = JSON.parse(root.getAttribute('data-layout') || '{}'); } catch {} }
    if(!meta || typeof meta!=='object' || Array.isArray(meta))meta={};
    const objects = Array.isArray(meta.objects) ? meta.objects.filter(o => o && ((o.type === 'image' && safeImage(o.src)) || (o.type === 'symbol' && symbols.includes(o.symbol)))).map(o => ({id: typeof o.id === 'string' ? o.id : makeId(),type:o.type,src:o.src,symbol:o.symbol,color:/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#243039',x:clamp(o.x,0,20000),y:clamp(o.y,0,20000),w:clamp(o.w,.1,100000),h:clamp(o.h,.1,100000)})) : [];
    return {html:cleanHTML(root ? root.querySelector('[data-note-body]')?.innerHTML || '' : content), bg:Object.values(backgrounds).includes(meta.bg) ? meta.bg : '#ffffff', textWidth:clamp(meta.textWidth || 100,25,100),objects,rect:meta.rect || null};
  }
  function encode(w) {
    const root = document.createElement('div'); root.dataset.notasPro = '3';
    root.dataset.layout = JSON.stringify({bg:w.bg,textWidth:w.textWidth,objects:w.objects,rect:w.rect});
    const body = document.createElement('div'); body.dataset.noteBody = ''; body.innerHTML = w.editor.innerHTML; root.append(body);
    // A standard HTML fallback lets previous versions still display text and objects.
    const fallback = document.createElement('div'); fallback.dataset.noteObjects = '';
    w.objects.forEach(o => { const el = document.createElement(o.type === 'image' ? 'img' : 'span'); if(o.type === 'image'){el.src=o.src;el.alt='Imagem da nota';el.style.maxWidth='100%';el.style.width=`${o.w}px`;}else{el.textContent=o.symbol;el.style.fontSize=`${o.h}px`;} fallback.append(el); });
    if (fallback.childNodes.length) root.append(fallback);
    return root.outerHTML;
  }
  function geometry(w) { Object.assign(w.el.style,{left:`${w.rect.x}px`,top:`${w.rect.y}px`,width:`${w.rect.w}px`,height:`${w.rect.h}px`}); }
  function snapshot(w) { return JSON.stringify({html:w.editor.innerHTML,bg:w.bg,textWidth:w.textWidth,objects:w.objects}); }
  function commit(w, history = true) {
    if (!windows.has(w.id)) return false;
    notes=[...latestById([...loadNotes(storageKey()),...notes]).values()];
    if (history) { const s = snapshot(w); if (w.history[w.historyIndex] !== s) { w.history.splice(w.historyIndex+1);w.history.push(s);if(w.history.length>60)w.history.shift();w.historyIndex=w.history.length-1; } }
    const old = notes.find(n => n.id === w.id);
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
    renderObjects(w);fitPaper(w);
  }
  function fitPaper(w) { w.paper.style.minWidth=`${Math.max(0,...w.objects.map(o=>o.x+o.w+20))}px`;w.paper.style.height=`${Math.max(900,w.editor.scrollHeight+40,...w.objects.map(o=>o.y+o.h+30))}px`; }
  function createWindow(note = null, focus = true) {
    if(note && windows.has(note.id)) { const w=windows.get(note.id);activate(w);w.el.scrollIntoView({block:'nearest',inline:'nearest'});closeSidebar();return w; }
    const data = decode(note?.content || '');
    const n=windows.size, width=Math.min(610,Math.max(280,workspace.clientWidth-28)), height=Math.min(690,Math.max(240,workspace.clientHeight-30));
    const initial = data.rect || {x:14+(n%3)*36,y:14+(n%3)*32,w:width,h:height};
    const rect={w:clamp(initial.w,280,Math.max(280,workspace.clientWidth-16)),h:clamp(initial.h,240,Math.max(240,workspace.clientHeight-16)),x:0,y:0};
    rect.x=clamp(initial.x,0,workspace.clientWidth-rect.w);rect.y=clamp(initial.y,0,workspace.clientHeight-40);
    const el=document.createElement('section');el.className='note-window';el.innerHTML=`<div class="window-bar"><button data-window="close" title="Guardar e fechar" aria-label="Guardar e fechar esta nota">✕</button><button data-window="menu">Opções ▾</button><span class="drag-label" title="Arrastar a nota">⠿</span><button data-window="save">Guardar</button><button data-window="delete" title="Eliminar nota" aria-label="Eliminar esta nota">⌫</button></div><div class="note-scroll"><div class="note-paper"><div class="note-editor" contenteditable="true" role="textbox" aria-label="Texto da nota" aria-multiline="true" data-placeholder="Escreva a sua nota aqui…" spellcheck="true"></div></div></div><div class="window-footer"><span>Guardado neste dispositivo</span><span>Arraste o canto para redimensionar</span></div><div class="window-resize" title="Redimensionar nota"></div>`;
    const w={id:note?.id||makeId(),title:note?.title === 'Sem título' ? '' : note?.title || '',el,editor:el.querySelector('.note-editor'),paper:el.querySelector('.note-paper'),footer:el.querySelector('.window-footer span'),...data,rect,selected:null,history:[],historyIndex:0};
    w.editor.innerHTML=data.html;windows.set(w.id,w);workspace.append(el);geometry(w);display(w);w.history=[snapshot(w)];
    el.addEventListener('pointerdown',()=>activate(w));
    el.querySelector('.window-bar').addEventListener('pointerdown',e=>{if(!e.target.closest('button'))startWindowGesture(e,w,false);});
    el.querySelector('.window-resize').addEventListener('pointerdown',e=>startWindowGesture(e,w,true));
    el.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{
      activate(w);const action=button.dataset.window;
      if(action==='close')askTitle(w,true);if(action==='save')askTitle(w,false);if(action==='delete')deleteNoteById(w.id);
      if(action==='menu'){const r=button.getBoundingClientRect();openMenu(w,r.left,r.bottom+3);}
    }));
    w.paper.addEventListener('contextmenu',e=>{e.preventDefault();openMenu(w,e.clientX,e.clientY);});
    w.editor.addEventListener('input',()=>{if(applyingEdit)return;fitPaper(w);commit(w);rememberSelection(w);});
    w.editor.addEventListener('focus',()=>activate(w));
    w.editor.addEventListener('pointerdown',()=>{w.selected=null;renderObjects(w);});
    w.editor.addEventListener('paste',e=>{
      e.preventDefault();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');
      rememberSelection(w);
      const files=[...e.clipboardData.files].filter(f=>f.type.startsWith('image/'));
      if(files.length){files.forEach(file=>insertImageFile(w,file));return;}
      command(html?'insertHTML':'insertText',html?cleanHTML(html):text,w);
    });
    w.editor.addEventListener('drop',e=>{e.preventDefault();[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')).forEach(file=>insertImageFile(w,file));});
    w.editor.addEventListener('dragover',e=>e.preventDefault());
    w.editor.addEventListener('beforeinput',e=>{if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();undo(w,e.inputType==='historyUndo'?-1:1);}});
    activate(w);$('#empty-workspace').hidden=true;saveWorkspace();renderNotes();if(focus)w.editor.focus();return w;
  }
  function saveWorkspace() { try {localStorage.setItem(`${storageKey()}:windows`,JSON.stringify([...windows.keys()]));}catch{} }
  function removeWindow(w) {w.el.remove();windows.delete(w.id);if(active===w){active=null;savedRange=null;activate([...windows.values()].at(-1));}$('#empty-workspace').hidden=windows.size>0;saveWorkspace();renderNotes();}
  function restoreWorkspace() {
    const ids=readJSON(`${storageKey()}:windows`,[]);
    if(Array.isArray(ids))ids.forEach(id=>{const note=notes.find(n=>n.id===id&&!n.deletedAt);if(note)createWindow(note,false);});
    if(!windows.size && !notes.some(n=>!n.deletedAt))createWindow(null,false);
  }
  function newNote(){createWindow();closeSidebar();}
  function askTitle(w,closeAfter){
    if(!w)return;closeMenu();pendingTitle={w,closeAfter};$('#optional-title').value=w.title;$('#title-dialog').showModal();$('#optional-title').focus();
  }
  function finishTitle(keep){
    if(!pendingTitle)return;const {w,closeAfter}=pendingTitle;if(!windows.has(w.id)){$('#title-dialog').close();pendingTitle=null;return;}
    if(!keep)w.title=$('#optional-title').value.trim();display(w);
    if(!commit(w))return;
    $('#title-dialog').close();pendingTitle=null;if(closeAfter)removeWindow(w);
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
      heading.textContent=note.title||'Sem título';preview.textContent=plainText(note.content)||'Imagem ou nota vazia';open.append(heading,preview);open.addEventListener('click',()=>{createWindow(note);closeSidebar();});
      const remove=document.createElement('button');remove.className='sidebar-delete-btn';remove.textContent='✕';remove.title='Eliminar nota';remove.setAttribute('aria-label',`Eliminar ${note.title||'nota sem título'}`);remove.addEventListener('click',()=>deleteNoteById(note.id));item.append(open,remove);list.append(item);
    });
  }
  function openSidebar(){$('#sidebar').classList.add('active');$('#sidebar').setAttribute('aria-hidden','false');$('#sidebar-backdrop').hidden=false;}
  function closeSidebar(){$('#sidebar').classList.remove('active');$('#sidebar').setAttribute('aria-hidden','true');$('#sidebar-backdrop').hidden=true;}
  function gesture(event,onMove,onEnd){
    event.preventDefault();const target=event.currentTarget;target.setPointerCapture(event.pointerId);
    const move=e=>{if(e.pointerId===event.pointerId)onMove(e.clientX-event.clientX,e.clientY-event.clientY);};
    const end=e=>{if(e.pointerId!==event.pointerId)return;target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId);onEnd();};
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  }
  function startWindowGesture(e,w,resize){
    if(e.button!==0)return;activate(w);const initial={...w.rect};
    gesture(e,(dx,dy)=>{if(resize){w.rect.w=clamp(initial.w+dx,280,4000);w.rect.h=clamp(initial.h+dy,240,3000);}else{w.rect.x=Math.max(0,initial.x+dx);w.rect.y=Math.max(0,initial.y+dy);}geometry(w);},()=>commit(w,false));
  }
  function renderObjects(w){
    w.paper.querySelectorAll('.note-object').forEach(el=>el.remove());
    w.objects.forEach(o=>{
      const el=document.createElement('div');el.className=`note-object${w.selected===o.id?' selected':''}`;el.dataset.objectId=o.id;el.tabIndex=0;el.setAttribute('aria-label',o.type==='image'?'Imagem: arraste para mover ou use as setas do teclado':`Símbolo ${o.symbol}: arraste para mover ou use as setas do teclado`);
      setObjectGeometry(el,o);
      if(o.type==='image'){const img=document.createElement('img');img.className='object-image';img.src=o.src;img.alt='Imagem da nota';img.draggable=false;el.append(img);}
      else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.classList.add('object-symbol');const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x','50');text.setAttribute('y','78');text.setAttribute('text-anchor','middle');text.setAttribute('font-size','90');text.setAttribute('fill',o.color);text.textContent=o.symbol;svg.append(text);el.append(svg);}
      ['nw','ne','sw','se'].forEach(c=>{const handle=document.createElement('span');handle.className='object-resize';handle.dataset.corner=c;el.append(handle);});
      el.addEventListener('pointerdown',e=>{
        activate(w);w.selected=o.id;w.paper.querySelectorAll('.note-object').forEach(v=>v.classList.toggle('selected',v===el));
        if(e.button!==0)return;e.stopPropagation();el.focus({preventScroll:true});const initial={...o},corner=e.target.dataset.corner;
        gesture(e,(dx,dy)=>{
          if(corner){
            const sx=corner.includes('w')?-1:1,sy=corner.includes('n')?-1:1;
            let width=Math.max(20,initial.w+dx*sx),height=Math.max(20,initial.h+dy*sy);
            if(o.type==='image'){const factor=Math.max(20/initial.w,20/initial.h,1+(dx*sx*initial.w+dy*sy*initial.h)/(initial.w**2+initial.h**2));width=initial.w*factor;height=initial.h*factor;}
            let factor=1;if(sx<0&&width>initial.x+initial.w)factor=Math.min(factor,(initial.x+initial.w)/width);if(sy<0&&height>initial.y+initial.h)factor=Math.min(factor,(initial.y+initial.h)/height);
            if(o.type==='image'){width*=factor;height*=factor;}else{width=Math.min(width,sx<0?initial.x+initial.w:4000);height=Math.min(height,sy<0?initial.y+initial.h:4000);}
            o.w=width;o.h=height;o.x=sx<0?initial.x+initial.w-width:initial.x;o.y=sy<0?initial.y+initial.h-height:initial.y;
          }else{o.x=Math.max(0,initial.x+dx);o.y=Math.max(0,initial.y+dy);}
          setObjectGeometry(el,o);fitPaper(w);
        },()=>commit(w));
      });
      el.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const d=e.shiftKey?10:1;o.x=Math.max(0,o.x+(e.key==='ArrowRight'?d:e.key==='ArrowLeft'?-d:0));o.y=Math.max(0,o.y+(e.key==='ArrowDown'?d:e.key==='ArrowUp'?-d:0));setObjectGeometry(el,o);fitPaper(w);commit(w);}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();w.selected=o.id;removeObject(w);}});
      w.paper.append(el);
    });
  }
  function setObjectGeometry(el,o){Object.assign(el.style,{left:`${o.x}px`,top:`${o.y}px`,width:`${o.w}px`,height:`${o.h}px`});}
  function removeObject(w){if(!w?.selected)return;w.objects=w.objects.filter(o=>o.id!==w.selected);w.selected=null;display(w);commit(w);}
  function addObject(w,object){
    if(!windows.has(w.id))return;
    const id=makeId();w.objects.push({id,x:Math.max(30,w.paper.clientWidth*.59),y:30+w.el.querySelector('.note-scroll').scrollTop,...object});w.selected=id;
    if(w.textWidth===100)w.textWidth=55;display(w);commit(w);closeMenu();
  }
  async function insertImageFile(w,file){
    if(!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)){status.textContent='Escolha uma imagem PNG, JPEG, WebP, GIF ou AVIF.';return;}
    if(file.size>12*1024*1024){status.textContent='A imagem é demasiado grande. Escolha uma imagem com menos de 12 MB.';return;}
    try{
      const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const img=new Image();img.src=src;await img.decode();
      let stored=src;
      if(file.size>450000 && file.type!=='image/gif'){
        const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);stored=canvas.toDataURL('image/webp',.86);
      }
      const width=Math.min(220,Math.max(70,w.paper.clientWidth*.34));addObject(w,{type:'image',src:stored,w:width,h:width*img.naturalHeight/img.naturalWidth});
    }catch{status.textContent='Não foi possível abrir esta imagem.';}
  }
  function rememberSelection(w=active){
    const selection=getSelection();if(!w||!selection?.rangeCount)return;
    const range=selection.getRangeAt(0);if(w.editor.contains(range.commonAncestorContainer)){savedRange=range.cloneRange();}
  }
  function restoreSelection(w){
    w.editor.focus();const selection=getSelection();selection.removeAllRanges();
    if(savedRange && w.editor.contains(savedRange.commonAncestorContainer))selection.addRange(savedRange);
    else{const range=document.createRange();range.selectNodeContents(w.editor);range.collapse(false);selection.addRange(range);}
  }
  function command(name,value=null,w=active){if(!w)return;restoreSelection(w);applyingEdit=true;try{document.execCommand(name,false,value);}finally{applyingEdit=false;}rememberSelection(w);fitPaper(w);commit(w);closeMenu();}
  function fontSize(value){
    if(!active)return;const w=active;restoreSelection(w);
    if(getSelection().isCollapsed){
      const marker=`size-${makeId()}`;applyingEdit=true;try{document.execCommand('insertHTML',false,`<span id="${marker}" style="font-size:${value}px">&#8203;</span>`);}finally{applyingEdit=false;}
      const span=w.editor.querySelector(`[id="${marker}"]`);if(span){span.removeAttribute('id');const r=document.createRange();r.selectNodeContents(span);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}
    }else{applyingEdit=true;try{document.execCommand('fontSize',false,'7');}finally{applyingEdit=false;}}
    w.editor.querySelectorAll('font[size="7"]').forEach(el=>{el.removeAttribute('size');el.style.fontSize=`${value}px`;});
    $('#size-label').textContent=value;rememberSelection(w);commit(w);closeMenu();
  }
  function changeCase(mode){if(!active)return;restoreSelection(active);const text=getSelection().toString();if(text)command('insertText',mode==='upper'?text.toLocaleUpperCase('pt-PT'):text.toLocaleLowerCase('pt-PT'));}
  function undo(w,direction){
    if(!w)return;const index=w.historyIndex+direction;if(index<0||index>=w.history.length)return;
    w.historyIndex=index;const s=JSON.parse(w.history[index]);w.editor.innerHTML=s.html;w.bg=s.bg;w.textWidth=s.textWidth;w.objects=s.objects;w.selected=null;savedRange=null;display(w);commit(w,false);w.editor.focus();closeMenu();
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
    activate(w);rememberSelection(w);menu.hidden=false;menu.style.left='8px';menu.style.top='8px';$('#text-width').value=w.textWidth;$('#width-label').value=`${w.textWidth}%`;
    const r=menu.getBoundingClientRect();menu.style.left=`${clamp(x,8,innerWidth-r.width-8)}px`;menu.style.top=`${clamp(y,8,innerHeight-r.height-8)}px`;
  }
  function closeMenu(){menu.hidden=true;}
  function colorButton(container,color,label,action){const button=document.createElement('button');button.className='color-dot';button.style.setProperty('--color',color);button.title=label;button.setAttribute('aria-label',label);if(color==='transparent')button.textContent='×';button.addEventListener('click',action);container.append(button);}
  function renderFavorites(){['text','highlight'].forEach(kind=>{const area=$(`#${kind}-favorites`);area.replaceChildren();favorites[kind].filter(c=>/^#[0-9a-f]{6}$/i.test(c)).forEach(c=>colorButton(area,c,`Favorita ${c}`,()=>command(kind==='text'?'foreColor':'hiliteColor',c)));});}
  function setupMenu(){
    ['Arial','Calibri','Aptos','Verdana','Times New Roman'].forEach(font=>{const b=document.createElement('button');b.textContent=font;b.style.fontFamily=font;b.addEventListener('click',()=>command('fontName',font));$('#font-options').append(b);});
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
      if(b.dataset.action==='image'){imageTarget=active;$('#image-input').click();}
    });
    $('#text-color-input').addEventListener('change',e=>command('foreColor',e.target.value));
    $('#highlight-color-input').addEventListener('change',e=>command('hiliteColor',e.target.value));
    $('#text-width').addEventListener('input',e=>{if(active){active.textWidth=Number(e.target.value);$('#width-label').value=`${active.textWidth}%`;display(active);commit(active);}});
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
        notes=[...latestById([...remote,...localMap.values(),...notes]).values()];
        if(!persist())return;
        // Guest notes now exist in this account locally and remotely; finish the import.
        try{localStorage.removeItem(GUEST_KEY);}catch{}
        windows.forEach(w=>{
          const n=notes.find(item=>item.id===w.id);if(!n)return;
          if(n.deletedAt){removeWindow(w);return;}
          if(n.updatedAt!==previous.get(w.id)){
            const data=decode(n.content);w.editor.innerHTML=data.html;w.title=n.title||'';w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.history=[snapshot(w)];w.historyIndex=0;w.selected=null;if(active===w)savedRange=null;display(w);
          }
        });
        renderNotes();status.textContent='Sincronizado';
      }catch{if(epoch===sessionEpoch)status.textContent='Guardado neste dispositivo; sincronização pendente. Verifique a ligação ou a conta.';}
    })();
    try{await syncFlight;}finally{syncFlight=null;if(syncAgain){syncAgain=false;scheduleSync();}}
  }
  function setAuthView(){
    $('#signed-out-actions').hidden=!!user;$('#signed-in-actions').hidden=!user;$('#auth-email').closest('label').hidden=!!user;$('#auth-password').closest('label').hidden=!!user;
    $('#account-btn').classList.toggle('synced',!!user);$('#auth-message').textContent=user?`Sessão iniciada como ${user.email}`:cloud?'':'Configure o ficheiro config.js e verifique a ligação para sincronizar.';
  }
  function setSession(session){
    const next=session?.user||null;if(next?.id===user?.id){user=next;setAuthView();return;}
    saveWorkspace();sessionEpoch++;clearTimeout(syncTimer);windows.forEach(w=>w.el.remove());windows.clear();active=null;savedRange=null;closeMenu();
    if($('#title-dialog').open)$('#title-dialog').close();pendingTitle=null;user=next;notes=loadNotes(storageKey());$('#empty-workspace').hidden=false;setAuthView();restoreWorkspace();renderNotes();if(user)syncNotes();
  }
  $('#auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!cloud)return setAuthView();try{const {error}=await cloud.auth.signInWithPassword({email:$('#auth-email').value.trim(),password:$('#auth-password').value});$('#auth-message').textContent=error?error.message:'Sessão iniciada.';$('#auth-password').value='';}catch{$('#auth-message').textContent='Não foi possível entrar. Verifique a ligação.';}});
  $('#signup-btn').addEventListener('click',async()=>{if(!cloud||!$('#auth-form').reportValidity())return;try{const {error}=await cloud.auth.signUp({email:$('#auth-email').value.trim(),password:$('#auth-password').value,options:{emailRedirectTo:location.origin+location.pathname}});$('#auth-message').textContent=error?error.message:'Conta criada. Confirme o e-mail recebido e depois entre.';}catch{$('#auth-message').textContent='Não foi possível criar a conta. Verifique a ligação.';}});
  $('#logout-btn').addEventListener('click',async()=>{if(!cloud)return;try{const {error}=await cloud.auth.signOut();if(error){$('#auth-message').textContent=error.message;return;}setSession(null);$('#auth-dialog').close();}catch{$('#auth-message').textContent='Não foi possível terminar a sessão.';}});
  $('#account-btn').addEventListener('click',()=>{setAuthView();$('#auth-dialog').showModal();});$('#close-auth-btn').addEventListener('click',()=>$('#auth-dialog').close());$('#sync-btn').addEventListener('click',syncNotes);
  $('#toggle-sidebar-btn').addEventListener('click',openSidebar);$('#close-sidebar-btn').addEventListener('click',closeSidebar);$('#sidebar-backdrop').addEventListener('click',closeSidebar);
  $('#new-note-btn').addEventListener('click',newNote);$('#empty-new-btn').addEventListener('click',newNote);$('#close-note-btn').addEventListener('click',()=>askTitle(active,true));
  $('#title-form').addEventListener('submit',e=>{e.preventDefault();finishTitle(false);});$('#keep-title').addEventListener('click',()=>finishTitle(true));$('#cancel-title').addEventListener('click',()=>{$('#title-dialog').close();pendingTitle=null;});
  $('#image-input').addEventListener('change',e=>{const file=e.target.files[0],w=imageTarget;e.target.value='';if(file&&w)insertImageFile(w,file);});
  document.addEventListener('selectionchange',()=>rememberSelection());
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))closeMenu();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeMenu();closeSidebar();}
    if(e.target.closest('dialog,input,textarea'))return;
    const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();askTitle(active,false);}
    if((e.ctrlKey||e.metaKey)&&(key==='z'||key==='y')){e.preventDefault();undo(active,key==='y'||e.shiftKey?1:-1);}
  });
  addEventListener('pagehide',saveWorkspace);
  addEventListener('beforeunload',e=>{if(localSaveFailed&&!persist()){e.preventDefault();e.returnValue='';}});
  addEventListener('storage',e=>{
    if(e.key!==storageKey())return;
    const previous=new Map(notes.map(n=>[n.id,n.updatedAt]));notes=[...latestById([...notes,...loadNotes(storageKey())]).values()];
    windows.forEach(w=>{const n=notes.find(n=>n.id===w.id);if(!n||n.updatedAt===previous.get(w.id))return;if(n.deletedAt){removeWindow(w);return;}const data=decode(n.content);w.editor.innerHTML=data.html;w.bg=data.bg;w.textWidth=data.textWidth;w.objects=data.objects;w.title=n.title||'';w.history=[snapshot(w)];w.historyIndex=0;savedRange=null;display(w);});renderNotes();
  });
  addEventListener('online',()=>{if(user)syncNotes();});addEventListener('focus',()=>{if(user)syncNotes();});
  setupMenu();setAuthView();restoreWorkspace();renderNotes();
  if(cloud){cloud.auth.getSession().then(({data})=>setSession(data.session)).catch(()=>{status.textContent='Sem ligação à conta; notas disponíveis neste dispositivo.';});cloud.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>setSession(session),0);});}
  if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update()).catch(()=>{}));
})();
