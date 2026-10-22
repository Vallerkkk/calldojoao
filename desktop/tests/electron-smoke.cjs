const {_electron}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'work/desktop-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env,TEMP:out,TMP:out,ORBITA_DESKTOP_QA:'true',ORBITA_QA_DATA:path.join(out,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await _electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],cwd:path.join(root,'desktop'),env,timeout:45000});
 try{
  const page=await instance.firstWindow();await page.waitForURL('https://orbita-8nwu.onrender.com/',{timeout:60000});await page.locator('#auth-submit').waitFor({timeout:45000});
  assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
  const prefs=await instance.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity};});
  assert.deepEqual(prefs,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
  // Exercise the real permission and display handlers. Never enumerate or capture personal screens.
  await instance.evaluate(({desktopCapturer,nativeImage})=>{
   globalThis.__qaSourceCalls=0;globalThis.__qaNoSources=false;
   desktopCapturer.getSources=async()=>{globalThis.__qaSourceCalls++;return globalThis.__qaNoSources?[]:[{id:'screen:fake:0',name:'Tela de teste <script>',thumbnail:nativeImage.createEmpty()}]};
  });
  await page.evaluate(()=>{
   const button=document.createElement('button');button.id='qa-capture';button.textContent='Testar captura';button.style='position:fixed;z-index:2147483647;top:0;left:0';
   button.onclick=()=>{window.__qaCapture='pending';navigator.mediaDevices.getDisplayMedia({video:true,audio:window.__qaCaptureAudio}).then(stream=>{stream.getTracks().forEach(track=>track.stop());window.__qaCapture='granted'}).catch(error=>window.__qaCapture=error.name)};
   document.body.prepend(button);
  });
  for(const audio of [true,false]){
   await page.evaluate(value=>window.__qaCaptureAudio=value,audio);
   const opened=instance.waitForEvent('window');await page.locator('#qa-capture').click();const picker=await opened;
   await picker.waitForURL('orbita-desktop://ui/picker.html');
   await picker.getByRole('button',{name:'Tela de teste <script>',exact:true}).click();
   assert.equal(await picker.locator('script:not([src])').count(),0);
   assert.equal(await picker.locator('#audio-row').isVisible(),audio);
   assert.equal(await picker.locator('#audio').isChecked(),false);
   if(audio)await picker.locator('#audio').check();
   await picker.getByRole('button',{name:'Cancelar',exact:true}).click();
   await page.waitForFunction(()=>window.__qaCapture!=='pending');
   assert.equal(await page.evaluate(()=>window.__qaCapture),'AbortError');
  }
  // Empty source lists terminate cleanly; previous IPC listeners/pickers must be removed.
  await instance.evaluate(()=>globalThis.__qaNoSources=true);
  await page.locator('#qa-capture').click();await page.waitForFunction(()=>window.__qaCapture!=='pending');
  assert.equal(await page.evaluate(()=>window.__qaCapture),'AbortError');
  assert.equal(await instance.evaluate(()=>globalThis.__qaSourceCalls),3);
  assert.equal((await instance.windows()).length,1);
  console.log(JSON.stringify({native_runtime:true,production_login:true,sandbox:true,no_renderer_node:true,real_display_request:true,screen_with_audio:true,screen_without_audio:true,explicit_picker:true,cancel_and_retry:true,empty_sources:true,no_personal_capture:true}));
 }finally{await instance.evaluate(({app})=>app.quit()).catch(()=>{});await instance.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1)});
