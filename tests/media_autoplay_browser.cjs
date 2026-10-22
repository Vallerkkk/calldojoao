const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,POST}=require('./fixtures/feed_fixture.cjs');
const {TEXT,TEXT2}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const generator=await browser.newPage();
 const encoded=await generator.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
  const stream=canvas.captureStream(12),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];
  recorder.ondataavailable=event=>parts.push(event.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start(100);
  let frame=0;const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#754bdf':'#18a58c';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fff';ctx.font='48px sans-serif';ctx.fillText('Órbita '+frame,50,190);},80);
  await new Promise(resolve=>setTimeout(resolve,1600));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
  const file=new Blob(parts,{type:'video/webm'}),reader=new FileReader();return await new Promise(resolve=>{reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file);});
 });
 await generator.close();const movie=Buffer.from(encoded,'base64'),report=[];
 const setup=`
data.profiles[0].avatar_url='profiles/${USER}/avatar.png';
data.social_posts[0].media=['${OTHER}/clip.webm'];
const last=data.messages.at(-1);last.attachments={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner_id:'${USER}',storage_path:'channels/${TEXT}/${USER}/clip',name:'video.webm',mime_type:'video/webm',size:4096};
last.author_id='${USER}';last.content='Vídeo de teste';
data.messages.push({...last,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',thread_root:last.id,content:'Vídeo na thread',created_at:new Date().toISOString()});
`;
 const fixture=(stub+setup).replace("createSignedUrl:async()=>({data:{signedUrl:'/static/icons/icon-192.png'},error:null})","createSignedUrl:async path=>({data:{signedUrl:path.endsWith('avatar.png')?'/static/icons/icon-192.png':'/qa-video.webm'},error:null})");
 assert.notEqual(fixture,stub+setup);
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
  await context.route('**/*',route=>{const url=route.request().url();
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:fixture});
   if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:false,storageConfigured:true}});
   if(url.endsWith('/qa-video.webm'))return route.fulfill({contentType:'video/webm',body:movie});
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',{waitUntil:'networkidle'});
  await page.locator('#message-list video').waitFor();await page.locator('#message-list video').evaluate(v=>v.loop=true);
  await page.waitForFunction(()=>{const v=document.querySelector('#message-list video');return v.readyState>=2&&!v.paused&&v.currentTime>0;});
  assert.equal(await page.locator('#message-list video').evaluate(v=>v.muted&&v.defaultMuted&&v.controls&&v.playsInline),true);
  const avatar=await page.locator('#user-avatar').evaluate(node=>{const parent=node.parentElement.getBoundingClientRect(),rect=node.getBoundingClientRect(),css=getComputedStyle(node);return {width:rect.width,height:rect.height,parentWidth:parent.width,parentHeight:parent.height,cover:css.backgroundSize,position:css.backgroundPosition,photo:node.classList.contains('has-photo'),color:css.color};});
  assert.equal(avatar.width,avatar.parentWidth);assert.equal(avatar.height,avatar.parentHeight);assert(avatar.width>=32);assert.equal(avatar.cover,'cover');assert.equal(avatar.photo,true);assert.equal(avatar.color,'rgba(0, 0, 0, 0)');
  if(!mobile)await page.locator('.user-panel').screenshot({path:path.join(tmp,'avatar-panel-corrected.png')});
  // User pauses and unmutes are preserved; background navigation stops playback.
  await page.locator('#message-list video').evaluate(v=>{v.muted=false;v.pause();});await page.waitForTimeout(120);
  await page.locator('#message-list video').evaluate(v=>v.dispatchEvent(new Event('loadeddata')));await page.waitForTimeout(150);
  assert.equal(await page.locator('#message-list video').evaluate(v=>v.paused&&!v.muted),true);
  await page.locator('#message-list video').evaluate(v=>v.play());await page.waitForFunction(()=>!document.querySelector('#message-list video').paused);
  if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator('#feed-nav').click();
  await page.locator('#feed-view video').waitFor();await page.locator('#feed-view video').evaluate(v=>v.loop=true);
  await page.waitForFunction(()=>{const v=document.querySelector('#feed-view video');return v.readyState>=2&&!v.paused&&v.currentTime>0;});
  assert.equal(await page.locator('#feed-view video').evaluate(v=>v.muted),true);
  assert.equal(await page.locator('#message-list video').evaluate(v=>v.paused),true);
  await page.locator('#feed-view video').evaluate(v=>{window.__qaClip=v;v.muted=false;});
  if(mobile)await page.locator('#feed-view .mobile-nav-btn').click();await page.locator(`[data-channel-id="${TEXT}"]`).first().click();
  await page.waitForFunction(()=>window.__qaClip.paused);
  // Threads render the same inline player, and closing removes its decoded media.
  const row=page.locator('#message-list .message').last();await row.locator('summary').click();await row.getByRole('button',{name:'Thread',exact:true}).click();
  await page.locator('.thread-replies video').waitFor();await page.locator('.thread-replies video').evaluate(v=>{v.loop=true;window.__qaThreadClip=v;v.scrollIntoView({block:'center'});});
  await page.waitForFunction(()=>!window.__qaThreadClip.paused&&window.__qaThreadClip.readyState>=2);
  assert.equal(await page.evaluate(()=>window.__qaThreadClip.muted),true);
  await page.getByRole('button',{name:'Fechar Thread',exact:true}).click();
  await page.waitForFunction(()=>!window.__qaThreadClip.isConnected&&!window.__qaThreadClip.hasAttribute('src')&&window.__qaThreadClip.paused);
  // Account changes do not flash the previous account's profile photo while loading.
  await page.evaluate(OTHER=>{window.__qaReadDelay=200;const next={user:{id:OTHER,user_metadata:{display_name:'Outra pessoa'}},access_token:'other'};window.__qaSession=next;window.__qaAuthCallback('SIGNED_IN',next);},OTHER);
  await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Outra pessoa');
  assert.equal(await page.locator('#user-avatar').evaluate(n=>n.classList.contains('has-photo')),false);
  await page.screenshot({path:path.join(tmp,`media-avatar-${mobile?'mobile':'desktop'}.png`)});
  assert.deepEqual(errors,[]);report.push({mobile,avatarCircle:true,chatAutoplay:true,feedAutoplay:true,threadAutoplay:true,mutedInitially:true,manualPause:true,unmutePreserved:true,hiddenPause:true,cleanup:true,errors:0});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
