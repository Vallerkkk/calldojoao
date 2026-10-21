const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';let browser;
function fakeYouTube(){
 window.__qaYTPlayers=[];
 window.YT={Player:class{
  constructor(id,options){this.options=options;this.position=options.playerVars?.start||0;this.status=5;this.video=options.videoId||'';const placeholder=document.getElementById(id),frame=document.createElement('iframe');frame.id=id;frame.width='100%';frame.height='210';placeholder.replaceWith(frame);this.frame=frame;window.__qaYT=this;window.__qaYTPlayers.push(this);setTimeout(()=>{this.ready=true;options.events.onReady({target:this});},800);}
  cueVideoById(value,start=0){this.video=typeof value==='string'?value:value.videoId;this.position=typeof value==='string'?start:value.startSeconds||0;this.status=5;this.options.events.onStateChange({target:this,data:5});}
  getCurrentTime(){return this.position;}getPlayerState(){return this.status;}getIframe(){return this.frame;}
  seekTo(value){this.position=value;}playVideo(){this.status=1;this.options.events.onStateChange({target:this,data:1});}pauseVideo(){this.status=2;this.options.events.onStateChange({target:this,data:2});}
  unMute(){this.unmuted=true;}mute(){this.unmuted=false;}setVolume(value){this.volume=value;}destroy(){this.destroyed=true;this.frame.remove();}
 }};
}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const contexts=[],pages=[],errors=[];
  for(const identity of [USER,OTHER]){
   const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});contexts.push(context);await context.addInitScript(fakeYouTube);
   const session=identity===OTHER?`window.__qaSession={user:{id:'${OTHER}',user_metadata:{display_name:'Outra pessoa'}},access_token:'other'};`:'';
   const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
   await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub+session});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
   const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.headers()['referrer-policy'],'strict-origin-when-cross-origin');await page.locator('#message-list .message').first().waitFor();
   if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected');await page.waitForTimeout(100);
   await page.evaluate(({identity,USER,OTHER})=>{const r=window.__qaRoom,remote=[...r.remoteParticipants.values()][0];r.localParticipant.identity=identity;remote.identity=identity===USER?OTHER:USER;r.remoteParticipants=new Map([[remote.identity,remote]]);},{identity,USER,OTHER});
  }
  const [host,follower]=pages;
  for(let index=0;index<2;index++){
   const from=pages[index],to=pages[1-index],sender=index?OTHER:USER;
   await from.exposeFunction('__qaBridge',async(bytes,topic)=>to.evaluate(({bytes,topic,sender})=>{const r=window.__qaRoom,p=r?.remoteParticipants.get(sender);if(p)r.emit('DataReceived',new Uint8Array(bytes),p,undefined,topic);},{bytes,topic,sender}));
   await from.evaluate(()=>{const participant=window.__qaRoom.localParticipant,original=participant.publishData.bind(participant);participant.publishData=async(bytes,options)=>{await original(bytes,options);await window.__qaBridge([...bytes],options.topic);};});
  }
  async function panel(page){await page.locator('#voice-view').getByRole('button',{name:'Ouvir juntos',exact:true}).click();await page.locator('#watch-panel').waitFor();}
  async function choose(url){await host.getByLabel('Link do vídeo no YouTube').fill(url);await host.getByRole('button',{name:'Colocar vídeo',exact:true}).click();}
  await panel(host);await choose('https://youtu.be/M7lc1UVf-VE?t=30');await host.waitForFunction(()=>window.__qaYT.ready&&window.__qaYT.video==='M7lc1UVf-VE');assert.ok(Math.abs(await host.evaluate(()=>window.__qaYT.position)-30)<2);assert.equal(await host.locator('#youtube-player').evaluate(n=>n.tagName),'IFRAME');assert.equal(await host.locator('#youtube-player').getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  await host.locator('#watch-play').click();await host.waitForFunction(()=>window.__qaYT.status===1);
  await follower.locator('.call-grid #watch-panel').waitFor();await panel(follower);await follower.waitForFunction(()=>window.__qaYT.ready&&window.__qaYT.video==='M7lc1UVf-VE'&&window.__qaYT.status===1);assert.equal(await follower.locator('#watch-play').isDisabled(),false);assert.equal(await follower.getByRole('button',{name:'Colocar vídeo',exact:true}).isDisabled(),false);assert.equal(await follower.locator('#watch-panel').evaluate(n=>n.parentElement.classList.contains('call-grid')),true);
  await follower.locator('#watch-panel summary').click();await follower.getByRole('button',{name:'Reproduzir áudio aqui',exact:true}).click();assert.equal(await follower.evaluate(()=>window.__qaYT.unmuted),true);
  await follower.locator('#watch-global-mute').click();await host.waitForFunction(()=>window.__qaYT.unmuted===false&&document.getElementById('watch-global-mute').getAttribute('aria-pressed')==='true');await host.locator('#watch-global-mute').click();await follower.waitForFunction(()=>window.__qaYT.unmuted===true);await host.waitForTimeout(700);await follower.locator('#watch-pause').click();await host.waitForFunction(()=>window.__qaYT.status===2);await host.locator('#watch-play').click();await follower.waitForFunction(()=>window.__qaYT.status===1);
  await follower.getByLabel('Link do vídeo no YouTube').fill('https://www.youtube.com/shorts/dQw4w9WgXcQ?t=42');await follower.getByRole('button',{name:'Colocar vídeo',exact:true}).click();await host.waitForFunction(()=>window.__qaYT.video==='dQw4w9WgXcQ'&&window.__qaYT.position>=42&&window.__qaYT.status===1);await follower.locator('#watch-mute').click();assert.equal(await host.locator('#watch-mute').getAttribute('aria-pressed'),'true');
  await follower.evaluate(()=>window.__qaYT.options.events.onAutoplayBlocked({target:window.__qaYT}));await follower.locator('#watch-status').getByText(/liberar a reprodução/).waitFor();
  await follower.evaluate(()=>window.__qaYT.options.events.onError({target:window.__qaYT,data:150}));await follower.locator('#watch-status').getByText(/autor bloqueou/).waitFor();assert.equal(await follower.locator('#watch-external').getAttribute('href'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  // Malformed packets and peers outside this room cannot replace the video.
  await follower.evaluate(USER=>{const r=window.__qaRoom,p=r.remoteParticipants.get(USER);r.emit('DataReceived',new TextEncoder().encode('null'),p,undefined,'orbita-watch');r.emit('DataReceived',new TextEncoder().encode(JSON.stringify({type:'state',video:'invalid',position:0,playing:true})),p,undefined,'orbita-watch');},USER);await follower.evaluate(()=>{const r=window.__qaRoom;r.emit('DataReceived',new TextEncoder().encode(JSON.stringify({type:'command',n:999,actor:'outsider',video:'M7lc1UVf-VE',position:0,playing:true})),{identity:'outsider'},undefined,'orbita-watch');});assert.equal(await follower.evaluate(()=>window.__qaYT.video),'dQw4w9WgXcQ');
  await follower.getByRole('button',{name:'Tentar novamente',exact:true}).click();await follower.waitForFunction(()=>window.__qaYTPlayers.length===2&&window.__qaYT.ready&&window.__qaYT.video==='dQw4w9WgXcQ');assert.equal(await follower.evaluate(()=>window.__qaYTPlayers[0].destroyed),true);
  await follower.evaluate(USER=>{const r=window.__qaRoom,p=r.remoteParticipants.get(USER);r.remoteParticipants.delete(USER);r.emit('ParticipantDisconnected',p);},USER);await follower.locator('#watch-status').getByText(/Todos na chamada/).waitFor();assert.equal(await follower.locator('#watch-play').isDisabled(),false);
  await follower.evaluate(()=>{const r=window.__qaRoom,p=r.localParticipant;p.permissions.canPublish=false;r.emit('ParticipantPermissionsChanged',{canPublish:true},p);});assert.equal(await follower.locator('#watch-play').isDisabled(),false);
  await follower.evaluate(()=>{const r=window.__qaRoom,p=r.localParticipant;p.permissions.canPublish=true;r.emit('ParticipantPermissionsChanged',{canPublish:false},p);});await follower.locator('#watch-status').getByText(/Todos na chamada/).waitFor();assert.equal(await follower.locator('#watch-play').isDisabled(),false);
  await host.getByRole('button',{name:'Ocultar',exact:true}).click();await panel(host);assert.equal(await host.evaluate(()=>window.__qaYTPlayers.length),1);
  await host.evaluate(()=>window.__qaRoom.emit('Disconnected'));await host.locator('#watch-panel').waitFor({state:'detached'});assert.equal(await host.evaluate(()=>window.__qaYT.destroyed),true);
  await follower.screenshot({path:path.join(tmp,mobile?'youtube-celular.png':'youtube-computador.png')});assert.deepEqual(errors,[]);report.push({mobile,iframeReplacement:true,lateJoin:true,playPause:true,timestamp:true,changeVideo:true,autoplayPrompt:true,errorsHandled:true,retry:true,hostHandover:true,cleanup:true});
  await Promise.all(contexts.map(c=>c.close()));
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
