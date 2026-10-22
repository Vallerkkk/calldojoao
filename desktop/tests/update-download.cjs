// Isolated updater integration: local feed, generated artifacts, no installation and no personal profile.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NsisUpdater}=require('electron-updater'),{ElectronHttpExecutor}=require('electron-updater/out/electronHttpExecutor');
const {CURRENT_APP_INSTALLER_FILE_NAME}=require('builder-util-runtime');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'work/desktop-dist'),out=path.join(root,'work/update-integration-'+Date.now());fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 const oldName='Orbita-Setup-1.0.1-x64.exe',name='Orbita-Setup-1.0.2-x64.exe',file=path.join(dist,name),expected=crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'),size=fs.statSync(file).size;
 const counters={diff:{bytes:0,ranges:0},bad:{bytes:0,ranges:0}};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean),mode=parts[0],asset=parts[1];if(!counters[mode]){res.writeHead(404).end();return;}
  if(asset==='latest.yml'){
   const sha=mode==='bad'?Buffer.alloc(64).toString('base64'):expected;
   res.writeHead(200,{'Content-Type':'text/yaml'}).end(`version: 1.0.2\nfiles:\n  - url: ${name}\n    sha512: ${sha}\n    size: ${size}\npath: ${name}\nsha512: ${sha}\n`);return;
  }
  if(![name,name+'.blockmap',oldName+'.blockmap'].includes(asset)){res.writeHead(404).end();return;}
  const target=path.join(dist,asset),length=fs.statSync(target).size;let start=0,end=length-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416).end();return;}start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),length-1):length-1;status=206;counters[mode].ranges++;}
  const headers={'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Type':'application/octet-stream'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${length}`;
  res.writeHead(status,headers);if(asset===name)counters[mode].bytes+=end-start+1;fs.createReadStream(target,{start,end}).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{
  function updater(mode){
   const cache=path.join(out,mode);fs.mkdirSync(cache,{recursive:true});const config=path.join(cache,'app-update.yml');fs.writeFileSync(config,'updaterCacheDirName: cache\n');
   const adapter={version:'1.0.1',name:'orbita-test',isPackaged:true,appUpdateConfigPath:config,userDataPath:path.join(cache,'profile'),baseCachePath:cache,whenReady:async()=>{},quit:()=>{throw Error('Test must never install')},relaunch:()=>{throw Error('Test must never relaunch')},onQuit:()=>{throw Error('Test must not register installation')}};
   const u=new NsisUpdater(null,adapter);u.httpExecutor=new ElectronHttpExecutor(()=>{});u.setFeedURL({provider:'generic',url:`http://127.0.0.1:${port}/${mode}/`,useMultipleRangeRequest:false});u.autoDownload=false;u.autoInstallOnAppQuit=false;u.logger={info(){},warn(){},error(){},debug(){}};
   if(mode==='diff'){fs.mkdirSync(path.join(cache,'cache'),{recursive:true});fs.copyFileSync(path.join(dist,oldName),path.join(cache,'cache',CURRENT_APP_INSTALLER_FILE_NAME));}
   else u.disableDifferentialDownload=true;
   return u;
  }
  const good=updater('diff');await good.checkForUpdates();const downloaded=await good.downloadUpdate();assert.equal(crypto.createHash('sha512').update(fs.readFileSync(downloaded[0])).digest('base64'),expected);assert(counters.diff.ranges>0);assert(counters.diff.bytes<size,'Differential test unexpectedly downloaded the full installer');
  const bad=updater('bad');await bad.checkForUpdates();await assert.rejects(bad.downloadUpdate(),/sha512|checksum/i);
  const report={differential_bytes:counters.diff.bytes,full_installer_bytes:size,range_requests:counters.diff.ranges,checksum_verified:true,corrupted_manifest_rejected:true,no_installation:true};fs.writeFileSync(path.join(root,'work/update-integration-report.json'),JSON.stringify(report));console.log(JSON.stringify(report));
 }finally{await new Promise(r=>server.close(r));app.quit();}
}).catch(e=>{console.error(e);app.exit(1)});
