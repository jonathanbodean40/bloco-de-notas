'use strict';
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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
      webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}
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
