'use strict';
// No renderer IPC and no updater loaded on startup. Feed comes from packaged app-update.yml.
function createUpdateService({enabled,loadUpdater,isBusy=async()=>false,onState=()=>{},beforeInstall=()=>{},confirmRestart=async()=>false,inform=async()=>{},version,now=Date.now,timers={setTimeout,clearTimeout,setInterval,clearInterval}}){
 let updater,flight,stopped=false,available=false,lastCheck=-Infinity,state={phase:enabled?'idle':'disabled'},startTimer,pollTimer;
 const listeners=[];
 function publish(phase,extra={}){state={phase,...extra};onState(state);}
 function getUpdater(){
  if(updater)return updater;
  updater=loadUpdater();updater.autoDownload=false;updater.autoInstallOnAppQuit=true;
  updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableDifferentialDownload=false;updater.disableWebInstaller=true;
  updater.previousBlockmapBaseUrlOverride='https://github.com/Vallerkkk/calldojoao/releases/download/v'+version;
  const listen=(name,fn)=>{updater.on(name,fn);listeners.push([name,fn]);};
  listen('update-available',info=>{available=true;publish('available',{version:info.version});});
  listen('update-not-available',()=>{available=false;publish('current');});
  listen('download-progress',info=>{const percent=Math.min(100,Math.max(0,Math.floor(info.percent/5)*5));if(state.phase!=='downloading'||state.percent!==percent)publish('downloading',{percent});});
  listen('update-downloaded',info=>publish('ready',{version:info.version}));
  listen('error',()=>{if(state.phase!=='ready')publish('error');});
  return updater;
 }
 function check(manual=false){
  if(!enabled||stopped||state.phase==='ready')return Promise.resolve(state);
  if(flight)return flight;
  if(!manual&&now()-lastCheck<60*60*1000)return Promise.resolve(state);
  flight=(async()=>{
   try{
    if(await isBusy()){publish('deferred');return state;}
    if(stopped)return state;
    const u=getUpdater();available=false;lastCheck=now();publish('checking');await u.checkForUpdates();
    if(stopped||!available)return state;
    if(await isBusy()){publish('deferred');lastCheck=-Infinity;return state;}
    publish('downloading',{percent:0});await u.downloadUpdate();
   }catch{if(!stopped)publish('error');}
   return state;
  })().finally(()=>{flight=undefined});
  return flight;
 }
 async function interact(){
  if(!enabled)return inform('As atualizações automáticas funcionam na versão instalada para Windows. Baixe o instalador oficial para ativá-las.');
  if(state.phase==='ready'){
   if(await isBusy())return inform('Saia da chamada antes de reiniciar. A atualização está pronta e também será instalada ao encerrar o aplicativo pela bandeja.');
   if(!await confirmRestart(state.version))return;
   if(stopped||await isBusy())return;
   beforeInstall();updater.quitAndInstall(true,true);return;
  }
  await check(true);
  const message={current:'Você está usando a versão mais recente.',ready:'Atualização baixada. Ela será instalada ao encerrar o aplicativo pela bandeja. Para reiniciar agora, abra novamente este menu.',deferred:'A verificação foi adiada para preservar sua chamada. Tentaremos novamente quando ela terminar.',error:'Não foi possível buscar a atualização. O aplicativo continua funcionando e tentará novamente mais tarde.',downloading:'A atualização está sendo baixada em segundo plano.'};
  return inform(message[state.phase]||'Verificando atualizações…');
 }
 function start(){if(!enabled||startTimer||pollTimer||stopped)return;startTimer=timers.setTimeout(()=>{startTimer=undefined;check();},30000);startTimer?.unref?.();pollTimer=timers.setInterval(()=>check(),5*60*1000);pollTimer?.unref?.();}
 function stop(){stopped=true;timers.clearTimeout(startTimer);timers.clearInterval(pollTimer);for(const [event,fn] of listeners)updater?.removeListener(event,fn);}
 return {start,stop,check,interact,get state(){return state;}};
}
function updateLabel(state){return ({idle:'Atualizações automáticas',disabled:'Sobre as atualizações',checking:'Verificando atualização…',available:'Atualização encontrada',downloading:'Baixando atualização · '+(state.percent||0)+'%',ready:'Atualização pronta · reiniciar',current:'Aplicativo atualizado',deferred:'Atualização adiada durante a chamada',error:'Atualizações · tentar novamente'})[state.phase]||'Atualizações automáticas';}
module.exports={createUpdateService,updateLabel};
