'use strict';
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const keepAgentRoot=path.join(process.env.LOCALAPPDATA || app.getPath('home'), 'KeepAligner', 'LocalAgent');
function authorisedWindow(event){
  return Boolean(BrowserWindow.fromWebContents(event.sender) && event.sender.getURL().startsWith('notas://app/'));
}


protocol.registerSchemesAsPrivileged([{scheme:'notas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);

const webRoot = path.resolve(__dirname, '..', 'www');
function resolveAsset(url) {
  const request = new URL(url);
  if (request.hostname !== 'app') return null;
  const rel = decodeURIComponent(request.pathname).replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(webRoot, rel);
  if (target !== webRoot && !target.startsWith(webRoot + path.sep)) return null;
  return target;
}
let mainWindow;
let pendingAuthUrl = null;
function authCallback(url){
  if(typeof url!=='string'||!url.startsWith('notaspro://auth/callback?'))return;
  pendingAuthUrl = url;
  deliverAuthUrl();
}
function deliverAuthUrl(){
  if(!pendingAuthUrl||!mainWindow||mainWindow.isDestroyed()||mainWindow.webContents.isLoading())return;
  const url=pendingAuthUrl;
  const js='window.dispatchEvent(new CustomEvent("notas:auth-url",{detail:{url:'+JSON.stringify(url)+'}}));';
  mainWindow.webContents.executeJavaScript(js).then(()=>{if(pendingAuthUrl===url)pendingAuthUrl=null;}).catch(()=>{});
  mainWindow.focus();
}
if(process.defaultApp){/* Development mode needs its executable registered separately. */}
else app.setAsDefaultProtocolClient('notaspro');
const locked=app.requestSingleInstanceLock();
if(!locked){app.quit();}
else{
  app.on('second-instance',(_event,argv)=>{const url=argv.find(v=>v.startsWith('notaspro://auth/callback?'));if(url)authCallback(url);});
  app.on('open-url',(event,url)=>{event.preventDefault();authCallback(url);});
}
app.whenReady().then(() => {
  // Local queue only. Electron never receives a shell command or free-form
  // executable path from the note application. The worker validates again.
  ipcMain.handle('notas:keep-queue', async (event, input) => {
    if(!authorisedWindow(event) || !input || typeof input!=='object')
      throw new Error('Pedido não autorizado');
    const fields=['reference','planning','version','notes','status','kind'];
    const values=Object.fromEntries(fields.map(key=>[key,typeof input[key]==='string'?input[key].trim():'']));
    if(!['guide','presentation'].includes(input.mode)
      || !values.reference || values.reference.length>2000 || [...values.reference].some(ch=>ch.charCodeAt(0)<32)
      || values.planning.length>6000 || (values.planning && !values.planning.startsWith('https://'))
      || values.version.length>160 || values.notes.length>2000
      || !['unknown','review','approved'].includes(values.status)
      || !['unknown','new','modified','refinement'].includes(values.kind))
      throw new Error('Dados do pedido inválidos');
    const id=randomUUID().replace(/-/g,'');
    const queue=path.join(keepAgentRoot,'inbox');
    await fs.mkdir(queue,{recursive:true});
    const request={id,state:'queued',createdAt:new Date().toISOString(),
      request:{mode:input.mode,...values}};
    const tmp=path.join(queue,id+'.tmp');
    const dest=path.join(queue,id+'.json');
    await fs.writeFile(tmp,JSON.stringify(request,null,2),{encoding:'utf8',flag:'wx'});
    await fs.rename(tmp,dest);
    return {id,state:'queued'};
  });
  ipcMain.handle('notas:keep-status', async (event, id) => {
    if(!authorisedWindow(event) || typeof id!=='string' || !/^[a-f0-9]{32}$/.test(id))
      throw new Error('Pedido não autorizado');
    const target=path.join(keepAgentRoot,'results',id+'.json');
    try {
      const payload=JSON.parse(await fs.readFile(target,'utf8'));
      return {id,state:payload.state||'blocked',message:String(payload.message||'').slice(0,300)};
    } catch(error){
      if(error?.code==='ENOENT')return {id,state:'queued'};
      throw new Error('Não foi possível consultar o executor');
    }
  });
  ipcMain.handle('notas:export-file', async (event, payload) => {
    if(!payload || typeof payload.filename!=='string' || typeof payload.content!=='string')
      throw new Error('Exportação inválida');
    if(Buffer.byteLength(payload.content,'utf8') > 30*1024*1024)
      throw new Error('Nota demasiado grande para esta exportação');
    let name=path.basename(payload.filename).replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,120);
    if(!name.endsWith('.html')&&!name.endsWith('.txt'))name='Nota.html';
    const owner=BrowserWindow.fromWebContents(event.sender);
    if(!owner || !event.sender.getURL().startsWith('notas://app/'))
      throw new Error('Janela não autorizada');
    const response=await dialog.showSaveDialog(owner,{
      title:'Guardar cópia da nota',defaultPath:name,
      filters:[{name:'Nota HTML',extensions:['html']},{name:'Texto',extensions:['txt']}]
    });
    if(response.canceled || !response.filePath)return {saved:false};
    await fs.writeFile(response.filePath,payload.content,{encoding:'utf8',flag:'w'});
    return {saved:true};
  });
  protocol.handle('notas', request => {
    try {
      const target = resolveAsset(request.url);
      return target ? net.fetch(pathToFileURL(target).toString()) : new Response('Not found', {status:404});
    } catch { return new Response('Bad request', {status:400}); }
  });
  const open = () => {
    const win = new BrowserWindow({
      width:1200,height:820,minWidth:780,minHeight:520,
      autoHideMenuBar:true,
      webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}
    });
    mainWindow=win;
    win.webContents.setWindowOpenHandler(({url}) => {
      if (url.startsWith('notas://app/')) return {action:'allow'};
      if (url.startsWith('https://')) shell.openExternal(url);
      return {action:'deny'};
    });
    win.webContents.on('will-navigate', (event,url) => {
      if (!url.startsWith('notas://app/')) {event.preventDefault();if(url.startsWith('https://')) shell.openExternal(url);}
    });
    win.webContents.once('did-finish-load',()=>deliverAuthUrl());
    win.loadURL('notas://app/index.html');
  };
  open();
  const initialUrl=process.argv.find(arg=>arg.startsWith('notaspro://auth/callback?'));
  if(initialUrl)authCallback(initialUrl);
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)open();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
