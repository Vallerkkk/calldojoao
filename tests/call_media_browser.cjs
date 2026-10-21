const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
  const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public-qa',callsConfigured:true,storageConfigured:true}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelectorAll('#message-list .message').length===50);
  if(mobile)await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();
  await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected');
  await page.evaluate(()=>{
   window.qaTracks={};window.qaRemote=[...window.__qaRoom.remoteParticipants.values()][0];
   window.qaTrack=(key,source='camera',sid=key)=>{
    const listeners=new Map(),canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;let color=0;
    const paint=()=>{const c=canvas.getContext('2d');c.fillStyle='#42347c';c.fillRect(0,0,320,180);c.fillStyle='#e0dbff';c.font='22px sans-serif';c.fillText('Vídeo de teste '+(++color),25,90)};paint();
    const stream=canvas.captureStream(10),timer=setInterval(paint,100);
    const t={sid,source,kind:'video',isMuted:false,attached:[],on(e,fn){const a=listeners.get(e)||[];a.push(fn);listeners.set(e,a)},off(e,fn){listeners.set(e,(listeners.get(e)||[]).filter(f=>f!==fn))},emit(e){for(const fn of listeners.get(e)||[])fn()},attach(){const v=document.createElement('video');v.autoplay=true;v.srcObject=stream;this.attached.push(v);return v},detach(v){this.detachCalls=(this.detachCalls||0)+1;v.srcObject=null;this.attached=this.attached.filter(n=>n!==v);clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return []}};
    const publication={track:t,trackSid:key,source,isMuted:false};window.qaTracks[key]={t,publication};return window.qaTracks[key];
   };
   const {t,publication}=window.qaTrack('old-camera');window.__qaRoom.emit('TrackSubscribed',t,publication,window.qaRemote);
  });
  await page.waitForFunction(()=>document.querySelector('.media-tile video')?.readyState>=2);assert.equal(await page.locator('.media-tile').count(),1);
  await page.evaluate(()=>{const {t,publication}=window.qaTrack('new-camera');window.__qaRoom.emit('TrackSubscribed',t,publication,window.qaRemote);window.__qaRoom.emit('TrackSubscribed',t,publication,window.qaRemote)});
  assert.equal(await page.locator('.media-tile').count(),1);assert.equal(await page.evaluate(()=>window.qaTracks['old-camera'].t.detachCalls),1);
  await page.evaluate(()=>{const {t,publication}=window.qaTracks['old-camera'];window.__qaRoom.emit('TrackUnsubscribed',t,publication,window.qaRemote)});assert.equal(await page.locator('.media-tile').count(),1);
  await page.evaluate(()=>{const {t,publication}=window.qaTrack('screen','screen_share');window.__qaRoom.emit('TrackSubscribed',t,publication,window.qaRemote)});assert.equal(await page.locator('.media-tile').count(),2);
  await page.waitForFunction(()=>[...document.querySelectorAll('.media-tile video')].every(video=>video.readyState>=2));
  await page.screenshot({path:path.join(tmp,mobile?'call-active-mobile.png':'call-active-desktop.png')});
  await page.evaluate(()=>{const p=window.qaTracks['new-camera'].publication;p.isMuted=true;window.__qaRoom.emit('TrackMuted',p,window.qaRemote)});assert.equal(await page.locator('.media-tile:visible').count(),1);
  await page.evaluate(()=>{const p=window.qaTracks['new-camera'].publication;p.isMuted=false;window.__qaRoom.emit('TrackUnmuted',p,window.qaRemote)});assert.equal(await page.locator('.media-tile:visible').count(),2);
  // Unpublication can arrive after the SDK removed publication.track and detached DOM references.
  await page.evaluate(()=>{const {publication}=window.qaTracks['new-camera'];window.__qaRoom.emit('TrackUnpublished',{...publication,track:undefined},window.qaRemote)});assert.equal(await page.locator('.media-tile').count(),1);
  await page.evaluate(()=>{window.qaTracks.screen.t.emit('ended')});assert.equal(await page.locator('.media-tile').count(),0);
  await page.evaluate(()=>{const {t,publication}=window.qaTrack('local-without-sid','camera',undefined);t.sid=undefined;window.__qaRoom.emit('LocalTrackPublished',publication)});assert.equal(await page.locator('.media-tile').count(),1);
  await page.evaluate(()=>window.__qaRoom.emit('LocalTrackUnpublished',{trackSid:'local-without-sid'}));assert.equal(await page.locator('.media-tile').count(),0);
  await page.evaluate(()=>{const {t,publication}=window.qaTrack('departing-camera');window.__qaRoom.emit('TrackSubscribed',t,publication,window.qaRemote);window.__qaRoom.remoteParticipants.delete(window.qaRemote.identity);window.__qaRoom.emit('ParticipantDisconnected',window.qaRemote)});assert.equal(await page.locator('.media-tile').count(),0);
  // A silent track displays a readable loading state instead of an empty black rectangle.
  await page.evaluate(()=>{const t={kind:'video',source:'camera',sid:'silent',attach:()=>document.createElement('video'),detach:v=>{v.remove();return []}};window.__qaRoom.emit('LocalTrackPublished',{track:t,trackSid:'silent',source:'camera'})});
  assert.equal(await page.locator('.video-status:visible').innerText(),'Conectando vídeo…');
  assert.equal(await page.locator('.media-loading video').evaluate(v=>getComputedStyle(v).visibility),'hidden');
  await page.screenshot({path:path.join(tmp,mobile?'call-media-mobile.png':'call-media-desktop.png')});
  await page.locator('#leave-call').click();assert.equal(await page.locator('.media-tile').count(),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mobile,replacement:true,late_unsubscribe:true,camera_and_screen:true,muting:true,unpublished_without_track:true,ended:true,participant_left:true,missing_sid:true,loading_state:true,cleanup:true}));await context.close();
 }
 await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1});
