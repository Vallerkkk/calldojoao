const {_electron}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'work/desktop-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env,TEMP:out,TMP:out,ORBITA_DESKTOP_QA:'true',ORBITA_QA_DATA:path.join(out,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await _electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],cwd:path.join(root,'desktop'),env,timeout:45000});
 try{
  const page=await instance.firstWindow();await page.waitForURL('https://orbita-8nwu.onrender.com/',{timeout:60000});await page.locator('#auth-submit').waitFor({timeout:45000});
  assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
  const prefs=await instance.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],p=win.webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity,visible:win.isVisible()};});
  assert.deepEqual(prefs,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,visible:false});
  // Windows can suspend compositing in hidden windows; DOM and security checks don't depend on screenshots.
  // The selector is tested with fake sources; this test never enumerates real screens.
  await instance.evaluate(async({BrowserWindow,ipcMain},preload)=>{
   const picker=new BrowserWindow({show:false,width:900,height:680,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
   ipcMain.handle('orbita:screen-list',()=>({sources:[{id:'test-screen',name:'Tela de teste <script>',thumbnail:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII='}],audioAvailable:true}));
   ipcMain.on('orbita:screen-select',(_event,choice)=>{globalThis.__qaScreenChoice=choice;});
   await picker.loadURL('orbita-desktop://ui/picker.html');
  },path.join(root,'desktop/picker-preload.cjs'));
  const windows=await instance.windows();const picker=windows.find(p=>p!==page);await picker.getByRole('button',{name:'Tela de teste <script>',exact:true}).click();await picker.locator('#audio').check();await picker.getByRole('button',{name:'Compartilhar',exact:true}).click();
  const choice=await instance.evaluate(()=>globalThis.__qaScreenChoice);assert.deepEqual(choice,{id:'test-screen',audio:true});
  assert.equal(await picker.locator('script:not([src])').count(),0);
  console.log(JSON.stringify({native_runtime:true,production_login:true,sandbox:true,no_renderer_node:true,picker_fake_source:true,system_audio_opt_in:true}));
 }finally{await instance.evaluate(({app})=>app.quit()).catch(()=>{});await instance.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1)});
