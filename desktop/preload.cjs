'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('NOTAS_DESKTOP',Object.freeze({
  saveFile:async ({filename,content})=>ipcRenderer.invoke('notas:export-file',{filename,content})
}));
