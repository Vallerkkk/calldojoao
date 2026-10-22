'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('orbitaScreenPicker',Object.freeze({list:()=>ipcRenderer.invoke('orbita:screen-list'),choose:choice=>ipcRenderer.send('orbita:screen-select',choice?{id:String(choice.id),audio:choice.audio===true}:null)}));
