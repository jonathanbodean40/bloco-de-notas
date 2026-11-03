'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('NOTAS_DESKTOP',Object.freeze({
  saveFile:async ({filename,content})=>ipcRenderer.invoke('notas:export-file',{filename,content}),
  queueKeepJob:async fields=>ipcRenderer.invoke('notas:keep-queue',fields),
  keepJobStatus:async id=>ipcRenderer.invoke('notas:keep-status',id),
  keepJobPreview:async id=>ipcRenderer.invoke('notas:keep-preview',id)
}));
