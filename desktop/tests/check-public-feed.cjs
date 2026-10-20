const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NsisUpdater}=require('electron-updater'),{ElectronHttpExecutor}=require('electron-updater/out/electronHttpExecutor');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'work/public-feed-qa-'+Date.now()),version=require('../package.json').version;fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 const adapter={version,name:'orbita-test',isPackaged:true,appUpdateConfigPath:path.join(root,'work/desktop-dist/win-unpacked/resources/app-update.yml'),userDataPath:path.join(out,'profile'),baseCachePath:out,whenReady:async()=>{},quit(){throw Error('No installation permitted')},relaunch(){throw Error('No relaunch permitted')},onQuit(){throw Error('No quit handler permitted')}};
 const u=new NsisUpdater(null,adapter);u.httpExecutor=new ElectronHttpExecutor(()=>{});u.autoDownload=false;u.autoInstallOnAppQuit=false;u.logger={info(){},warn(){},error(){},debug(){}};let current=false;u.on('update-not-available',()=>current=true);
 const result=await u.checkForUpdates();assert.equal(result.updateInfo.version,version);assert(current);assert.equal(result.updateInfo.files[0].url,`Orbita-Setup-${version}-x64.exe`);const report={version,github_feed:true,up_to_date:true,no_download:true,no_installation:true};fs.writeFileSync(path.join(root,'work/public-feed-verified.json'),JSON.stringify(report));console.log(JSON.stringify(report));app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
