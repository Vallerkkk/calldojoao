const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,VOICE,OTHER}=require('./fixtures/supabase_fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const report=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1536,height:mobile?844:892},isMobile:mobile,hasTouch:mobile});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8')});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'qa',callsConfigured:true,storageConfigured:true,pushConfigured:false}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.state==='connected'&&window.__qaRoom.localParticipant.isMicrophoneEnabled);
  await page.evaluate(()=>{
   const room=window.__qaRoom,peer=[...room.remoteParticipants.values()][0],third=Object.assign(Object.create(Object.getPrototypeOf(peer)),peer,{identity:'third',name:'Alex',isSpeaking:true});room.remoteParticipants.set(third.identity,third);room.emit('ParticipantConnected',third);
   window.qaSynthetic=[];
   function video(participant,source,label){const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');let count=0;const paint=()=>{ctx.fillStyle=source==='camera'?'#346159':'#243454';ctx.fillRect(0,0,960,540);ctx.fillStyle='#eee';ctx.font='36px sans-serif';ctx.fillText(label,50,260);ctx.font='16px sans-serif';ctx.fillText('Mídia sintética · '+(++count),50,300);};paint();const stream=canvas.captureStream(5),timer=setInterval(paint,200),track={sid:source,source,kind:'video',isMuted:false,attach(){const video=document.createElement('video');video.autoplay=true;video.muted=true;video.srcObject=stream;return video;},detach(video){clearInterval(timer);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;video.remove();return [];}};window.qaSynthetic.push(track);room.emit('TrackSubscribed',track,{track,source,trackSid:source},participant);}
   video(peer,'camera','Câmera de Outra pessoa');video(peer,'screen_share','Transmissão de tela');room.emit('ConnectionQualityChanged');room.emit('ActiveSpeakersChanged');
  });
  await page.waitForFunction(()=>[...document.querySelectorAll('.media-tile video')].every(v=>v.readyState>=2));
  assert.equal(await page.locator('.call-grid .participant:visible,.call-grid .media-tile:visible').count(),4);
  const boxes=await page.locator('.call-grid .participant:visible,.call-grid .media-tile:visible').evaluateAll(nodes=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop,width:n.offsetWidth,height:n.offsetHeight})));
  if(!mobile){assert.equal(new Set(boxes.map(n=>n.y)).size,2);assert.equal(new Set(boxes.map(n=>n.x)).size,2);assert.ok(boxes.every(n=>n.width/n.height>1.7&&n.width/n.height<1.85));assert.equal(await page.locator('.voice-stage').evaluate(n=>n.scrollHeight>n.clientHeight+1),false);}
  assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:path.join(tmp,mobile?'call-layout-mobile.png':'call-layout-desktop.png')});
  for(const id of ['mic','camera','screen','call-navigation','call-invite','call-fullscreen','call-popout','call-soundboard','call-more','vc-react-call','leave-call','back-to-call','mic-options','camera-options','screen-options'])assert.ok(await page.locator('#'+id).getAttribute('aria-label'),id+' needs a name');
  const close=()=>page.locator('#dialog-close').click();
  await page.locator('#mic').click();await page.waitForFunction(()=>!window.__qaRoom.localParticipant.isMicrophoneEnabled);await page.locator('#mic').click();await page.waitForFunction(()=>window.__qaRoom.localParticipant.isMicrophoneEnabled);
  await page.locator('#camera').click();assert.equal(await page.evaluate(()=>window.__qaRoom.localParticipant.isCameraEnabled),true);await page.locator('#camera').click();
  if(await page.locator('#screen').isEnabled()){await page.locator('#screen').click();assert.equal(await page.evaluate(()=>window.__qaRoom.localParticipant.isScreenShareEnabled),true);await page.locator('#screen').click();}
  await page.locator('#mic-options').click();await page.getByRole('button',{name:'Ensurdecer: silenciar todo o áudio',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#deafen').getAttribute('aria-pressed')==='true');
  await page.locator('#call-more').click();await page.getByRole('button',{name:'Voltar a ouvir',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#deafen').getAttribute('aria-pressed')==='false');
  await page.locator('#mic-options').click();await page.getByRole('button',{name:'Configurar microfone, ruído e pressionar para falar',exact:true}).click();assert.equal(await page.locator('#app-dialog').evaluate(n=>n.open),true);await close();
  await page.locator('#camera-options').click();await page.locator('#camera-facing-menu').selectOption('environment');await close();assert.equal(await page.locator('#camera-facing').inputValue(),'environment');
  await page.locator('#screen-options').click();const check=page.locator('#app-dialog input[type=checkbox]');await check.uncheck();assert.equal(await page.locator('#share-screen-audio').isChecked(),false);await check.check();await close();
  await page.locator('#vc-react-call').click();await page.getByRole('button',{name:'Reagir com 🎉',exact:true}).click();await page.waitForFunction(()=>window.__qaPublished?.some(p=>p.topic==='orbita-reaction'));
  await page.locator('#call-soundboard').click();await page.getByRole('button',{name:/Fanfarra/}).click();await page.waitForFunction(()=>window.__qaPublished?.some(p=>p.topic==='orbita-sound'));
  await page.locator('#call-more').click();await page.getByRole('button',{name:'Qualidade da conexão',exact:true}).click();await page.getByRole('heading',{name:'Conexão da chamada',exact:true}).waitFor();await close();
  await page.locator('#call-invite').click();await page.getByRole('heading',{name:'Convidar pessoas',exact:true}).waitFor();await close();
  await page.locator(`.media-tile:not(.media-screen) .call-tile-menu`).click();assert.equal(await page.locator('#app-dialog input[type=range]').count(),2);await close();
  await page.route('**/voice-action',route=>{const data=route.request().postDataJSON();assert.equal(data.member,OTHER);assert.equal(data.action,'mute');return route.fulfill({json:{ok:true}});});
  await page.evaluate(()=>{window.__qaRoom.orbitaModerator=true;window.__qaRoom.orbitaStage=true;window.__qaRoom.emit('ConnectionQualityChanged');});await page.locator('.media-tile:not(.media-screen) .call-tile-menu').click();
  for(const name of ['Silenciar','Desconectar','Orador','Plateia'])assert.equal(await page.locator('#app-dialog').getByRole('button',{name,exact:true}).isVisible(),true);
  await page.locator('#app-dialog').getByRole('button',{name:'Silenciar',exact:true}).click();await page.getByRole('heading',{name:'Confirmar controle de voz',exact:true}).waitFor();const moderationRequest=page.waitForRequest('**/voice-action');await page.locator('#app-dialog').getByRole('button',{name:'Confirmar',exact:true}).click();await moderationRequest;await page.waitForFunction(()=>!document.querySelector('#app-dialog').open);
  if(!mobile){await page.locator('#call-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.locator('#call-fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);
   await page.locator('.media-tile:not(.media-screen)').hover();await page.locator('.media-tile:not(.media-screen) .expand-video').first().click();await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('media-tile'));await page.evaluate(()=>document.exitFullscreen());}
  // Instrument only the browser window API; verify the actual button dispatches the selected live video.
  await page.evaluate(()=>{Object.defineProperty(document,'pictureInPictureEnabled',{configurable:true,value:true});HTMLVideoElement.prototype.requestPictureInPicture=async function(){window.qaPipVideo=this;};});await page.locator('#call-popout').click();assert.equal(await page.evaluate(()=>window.qaPipVideo?.tagName),'VIDEO');
  await page.locator('#call-navigation').click();assert.equal(await page.locator('.sidebar').isVisible(),true);await page.locator(`[data-channel-id="${VOICE}"]`).first().click();
  await page.locator('#back-to-call').click();await page.locator('#text-view').waitFor();assert.equal(await page.evaluate(()=>window.__qaRoom.state),'connected');assert.equal(await page.evaluate(()=>document.body.classList.contains('call-focus')),false);await page.locator('#back-to-call-dock').click();await page.locator('#voice-view').waitFor();
  await page.locator('#leave-call').click();assert.equal(await page.locator('.media-tile').count(),0);assert.equal(await page.locator('.call-footer').isVisible(),false);assert.deepEqual(errors,[]);
  report.push({mobile,unifiedFourTiles:true,controls:true,volumeMenu:true,moderationWithCamera:true,screenAudio:true,reaction:true,soundboard:true,invite:true,fullscreen:!mobile,pipDispatch:true,chatKeepsCall:true,cleanup:true});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
