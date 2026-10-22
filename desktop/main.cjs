'use strict';
const {app,BrowserWindow,Menu,Tray,dialog,shell,session,desktopCapturer,ipcMain,protocol,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {APP_URL,safeHttps,isAppURL,isLocalUI}=require('./policy.cjs');
const {createUpdateService,updateLabel}=require('./updater.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'orbita-desktop',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.enableSandbox();app.setAppUserModelId('com.orbita.desktop');
const qa=!app.isPackaged&&process.env.ORBITA_DESKTOP_QA==='true';
if(qa&&process.env.ORBITA_QA_DATA)app.setPath('userData',process.env.ORBITA_QA_DATA);
let mainWindow,tray,quitting=false,closeChoice=false,closeDialog=false,externalDialog=false,picker,updates;
const allowed=new Set();
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>showMain());
  app.whenReady().then(start).catch(()=>{dialog.showErrorBox('Órbita','Não foi possível iniciar o aplicativo. Feche e tente novamente.');app.quit();});
}
app.on('before-quit',()=>{quitting=true;updates?.stop();if(picker&&!picker.isDestroyed())picker.close();});
app.on('window-all-closed',()=>{if(!tray)app.quit();});
function showMain(){if(!mainWindow||mainWindow.isDestroyed())return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}
function currentFrame(frame){try{return frame&&!frame.detached&&frame===mainWindow.webContents.mainFrame&&isAppURL(frame.url);}catch{return false;}}
async function openExternal(value){
  const url=safeHttps(value);if(!url||externalDialog||!mainWindow||mainWindow.isDestroyed())return;
  if(isAppURL(url.href)){await shell.openExternal(url.href);return;}
  externalDialog=true;
  try{const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'Abrir link externo',message:'Abrir este endereço no navegador?',detail:url.href,buttons:['Cancelar','Abrir no navegador'],defaultId:0,cancelId:0,noLink:true});if(choice.response===1)await shell.openExternal(url.href);}catch{}finally{externalDialog=false;}
}
function protectNavigation(window,localOnly=false){
  window.webContents.setWindowOpenHandler(({url})=>{if(!localOnly)openExternal(url).catch(()=>{});return {action:'deny'};});
  for(const event of ['will-navigate','will-redirect'])window.webContents.on(event,(e,url)=>{if(localOnly?!isLocalUI(url):(!isAppURL(url)&&!isLocalUI(url))){e.preventDefault();if(event==='will-navigate'&&!localOnly)openExternal(url).catch(()=>{});}});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
}
async function start(){
  const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
  const files=new Set(['picker.html','picker.js','ui.css','loading.html','offline.html']);
  const localDocuments=new Map();
  const localHandler=async request=>{
    const url=new URL(request.url),name=url.pathname.slice(1);
    if(url.hostname!=='ui'||request.method!=='GET'||!files.has(name))return new Response('Not found',{status:404});
    if(!localDocuments.has(name))localDocuments.set(name,fs.promises.readFile(path.join(__dirname,'ui',name)).catch(error=>{localDocuments.delete(name);throw error;}));
    return new Response(await localDocuments.get(name),{headers:{'Content-Type':contentTypes[path.extname(name)],'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
  };
  protocol.handle('orbita-desktop',localHandler);
  const ses=session.fromPartition('persist:orbita');
  ses.protocol.handle('orbita-desktop',localHandler);
  mainWindow=new BrowserWindow({title:'Órbita',width:1360,height:900,minWidth:800,minHeight:600,show:false,backgroundColor:'#10101b',icon:path.join(__dirname,'assets/icon.png'),webPreferences:{session:ses,nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
  protectNavigation(mainWindow);
  ses.setPermissionCheckHandler((contents,permission,origin,details)=>{
    if(!isAppURL(origin)||details?.isMainFrame===false)return false;
    if(contents&&contents!==mainWindow.webContents)return false;
    if(['fullscreen','clipboard-sanitized-write','display-capture'].includes(permission))return true;
    if(permission==='media')return details?.mediaType?allowed.has(details.mediaType):false;
    return allowed.has(permission);
  });
  let permissionDialog=false;
  ses.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
    if(contents!==mainWindow.webContents||!isAppURL(contents.getURL())||!isAppURL(details.requestingUrl||contents.getURL())||details.isMainFrame===false)return callback(false);
    if(['fullscreen','clipboard-sanitized-write','display-capture'].includes(permission))return callback(true);
    if(!['media','notifications'].includes(permission)||permissionDialog)return callback(false);
    const media=(details.mediaTypes||[]).filter(type=>['audio','video'].includes(type));
    // Electron reports display capture as media with an empty mediaTypes list.
    // No camera/microphone permission is persisted here: the display handler
    // still validates the frame and requires an explicit source selection.
    if(permission==='media'&&!media.length)return callback(Array.isArray(details.mediaTypes)&&details.mediaTypes.length===0);
    if(permission==='notifications'&&allowed.has(permission))return callback(true);
    if(permission==='media'&&media.every(type=>allowed.has(type)))return callback(true);
    permissionDialog=true;
    try{const label=permission==='notifications'?'mostrar notificações':media.map(type=>type==='audio'?'usar o microfone':'usar a câmera').join(' e ');const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'Permissão do Órbita',message:'Permitir que a Órbita possa '+label+'?',detail:'Esta permissão vale nesta execução. Você pode encerrar o aplicativo pela bandeja do Windows.',buttons:['Não permitir','Permitir'],defaultId:0,cancelId:0,noLink:true});const accept=choice.response===1&&isAppURL(contents.getURL());if(accept){for(const key of permission==='media'?media:[permission])allowed.add(key);}callback(accept);}catch{callback(false);}finally{permissionDialog=false;}
  });
  ses.setDisplayMediaRequestHandler(async(request,callback)=>{
    if(!request.userGesture||!request.videoRequested||!isAppURL(request.securityOrigin)||!request.frame||request.frame!==mainWindow.webContents.mainFrame||picker)return callback(null);
    const frame=request.frame;let done=false;
    const finish=streams=>{if(done)return;done=true;callback(streams);if(picker&&!picker.isDestroyed())picker.close();picker=undefined;};
    try{
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:300,height:180},fetchWindowIcons:false});
      if(!currentFrame(frame)||!sources.length)return finish(null);
      picker=new BrowserWindow({title:'Compartilhar tela — Órbita',parent:mainWindow,modal:true,width:900,height:680,minWidth:600,minHeight:460,show:false,backgroundColor:'#10101b',icon:path.join(__dirname,'assets/icon.png'),webPreferences:{preload:path.join(__dirname,'picker-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false,devTools:false}});
      protectNavigation(picker,true);const pickerContents=picker.webContents;
      const validSender=event=>event.sender===pickerContents&&event.senderFrame===pickerContents.mainFrame&&event.senderFrame.url==='orbita-desktop://ui/picker.html';
      const list=event=>{if(validSender(event))return {sources:sources.map(source=>({id:source.id,name:source.name,thumbnail:source.thumbnail.toDataURL()})),audioAvailable:request.audioRequested&&process.platform==='win32'};throw Error('Invalid sender');};
      const select=(event,choice)=>{if(!validSender(event))return;if(!choice)return finish(null);const source=sources.find(s=>s.id===choice.id);if(!source||!currentFrame(frame))return finish(null);const streams={video:source};if(choice.audio===true&&request.audioRequested&&process.platform==='win32')streams.audio='loopback';finish(streams);};
      ipcMain.handle('orbita:screen-list',list);ipcMain.on('orbita:screen-select',select);
      picker.on('closed',()=>{ipcMain.removeHandler('orbita:screen-list');ipcMain.removeListener('orbita:screen-select',select);finish(null);});
      const timeout=setTimeout(()=>finish(null),90000);picker.on('closed',()=>clearTimeout(timeout));
      await picker.loadURL('orbita-desktop://ui/picker.html');if(!qa)picker.show();
    }catch{finish(null);}
  });
  mainWindow.webContents.on('did-fail-load',(_event,code,_description,url,isMainFrame)=>{if(isMainFrame&&code!==-3&&isAppURL(url))mainWindow.loadURL('orbita-desktop://ui/offline.html').catch(()=>{});});
  mainWindow.on('close',async event=>{
    if(quitting)return;event.preventDefault();if(closeDialog)return;
    if(closeChoice){mainWindow.hide();return;}
    closeDialog=true;
    try{const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'Fechar Órbita',message:'Continuar na bandeja do Windows?',detail:'As chamadas continuam na bandeja. Para sair e encerrar as chamadas, escolha Encerrar aplicativo.',buttons:['Continuar na bandeja','Encerrar aplicativo','Cancelar'],defaultId:0,cancelId:2,noLink:true});if(choice.response===0){closeChoice=true;mainWindow.hide();}else if(choice.response===1)app.quit();}finally{closeDialog=false;}
  });
  tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'assets/icon.png')).resize({width:16,height:16}));tray.setToolTip('Órbita');tray.on('double-click',showMain);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Abrir Órbita',click:showMain},{label:'Encerrar aplicativo',click:()=>app.quit()}]));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Órbita',submenu:[{label:'Reconectar',accelerator:'CmdOrCtrl+R',click:()=>mainWindow.loadURL(APP_URL).catch(()=>{})},{type:'separator'},{label:'Encerrar aplicativo',accelerator:'Alt+F4',click:()=>app.quit()}]},{label:'Exibir',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},{label:'Ajuda',submenu:[{id:'orbita-update-status',label:'Atualizações automáticas',click:()=>updates?.interact().catch(()=>{})},{type:'separator'},{label:'Site oficial',click:()=>openExternal(APP_URL)},{label:'Sobre a Órbita',click:()=>dialog.showMessageBox(mainWindow,{title:'Órbita Desktop',message:'Órbita '+app.getVersion(),detail:'Texto, voz e vídeo em uma janela própria. Requer conexão à internet. Não inicia automaticamente com o Windows.'})}]}]));
  updates=createUpdateService({
    enabled:app.isPackaged&&process.platform==='win32'&&!process.env.PORTABLE_EXECUTABLE_DIR&&fs.existsSync(path.join(path.dirname(app.getPath('exe')),'Uninstall Orbita.exe')),
    version:app.getVersion(),loadUpdater:()=>require('electron-updater').autoUpdater,
    isBusy:async()=>{
      if(!mainWindow||mainWindow.isDestroyed()||picker||permissionDialog||closeDialog)return true;
      if(!isAppURL(mainWindow.webContents.getURL()))return true;
      // Read only a boolean from our own main frame. No native capability is exposed to the page.
      try{return await mainWindow.webContents.executeJavaScript("!document.getElementById('call-dock') || !document.getElementById('call-dock').hidden");}catch{return true;}
    },
    onState:state=>{const item=Menu.getApplicationMenu()?.getMenuItemById('orbita-update-status');if(item)item.label=updateLabel(state);},
    inform:message=>dialog.showMessageBox(mainWindow,{type:'info',title:'Atualizações da Órbita',message}),
    confirmRestart:async version=>(await dialog.showMessageBox(mainWindow,{type:'question',title:'Atualização pronta',message:'Reiniciar para instalar a Órbita '+version+'?',detail:'Seus dados serão preservados. Você também pode continuar usando e encerrar pela bandeja para instalar depois.',buttons:['Continuar usando','Reiniciar e atualizar'],defaultId:0,cancelId:0,noLink:true})).response===1,
    beforeInstall:()=>{quitting=true;}
  });
  const updateItem=Menu.getApplicationMenu()?.getMenuItemById('orbita-update-status');if(updateItem)updateItem.label=updateLabel(updates.state);
  updates.start();
  await mainWindow.loadURL('orbita-desktop://ui/loading.html');if(!qa)mainWindow.show();
  mainWindow.loadURL(APP_URL).catch(()=>{});
}
