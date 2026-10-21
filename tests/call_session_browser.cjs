const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,USER,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 const reports=[];
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
  let holdJoin=false,releaseJoin,joinStatus=200;
  const livekit=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8')
   .replace('async startAudio() {}','async startAudio() { if(window.__qaHoldAudio)await new Promise(resolve=>window.__qaReleaseAudio=resolve); }');
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});
   if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});
   if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:true,storageConfigured:true}});
   if(url.endsWith('/join')){if(holdJoin)await new Promise(resolve=>releaseJoin=resolve);return route.fulfill({status:joinStatus,json:joinStatus===200?{url:'wss://fake.invalid',token:'fake',canPublish:true}:{detail:'Indisponibilidade simulada'}}).catch(()=>{});}
   return route.continue();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/';
  async function ready(){await page.locator('#message-list .message').first().waitFor();await page.waitForTimeout(150);}
  async function voice(){if(mobile)await page.locator('#mobile-menu-btn').click();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();}
  async function swap(){await page.evaluate(OTHER=>{const next={user:{id:OTHER,user_metadata:{display_name:'Outra pessoa'}},access_token:'other'};window.__qaSession=next;window.__qaAuthCallback('SIGNED_IN',next);},OTHER);await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Outra pessoa');}
  // A late token for the previous account cannot construct a room or open its microphone.
  await page.goto(base,{waitUntil:'networkidle'});await ready();await voice();holdJoin=true;
  await page.locator('#join-call').click();while(!releaseJoin)await page.waitForTimeout(10);
  await swap();releaseJoin();holdJoin=false;await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>!!window.__qaRoom),false);assert.equal(await page.locator('#call-dock').isVisible(),false);
  // Cancellation also applies after connection while audio playback is awaiting permission.
  await page.reload({waitUntil:'networkidle'});await ready();await voice();await page.evaluate(()=>window.__qaHoldAudio=true);
  await page.locator('#join-call').click();await page.waitForFunction(()=>!!window.__qaReleaseAudio);await swap();
  await page.evaluate(()=>window.__qaReleaseAudio());await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.__qaRoom.state),'disconnected');
  assert.equal(await page.evaluate(()=>window.__qaMicrophoneStates.includes(true)),false);
  // A recoverable upstream error releases the join control; a second attempt succeeds.
  await page.reload({waitUntil:'networkidle'});await ready();await voice();joinStatus=503;
  await page.locator('#join-call').click();await page.locator('#toast').getByText('Indisponibilidade simulada',{exact:true}).waitFor();
  assert.equal(await page.locator('#join-call').isEnabled(),true);joinStatus=200;
  await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.localParticipant.isMicrophoneEnabled===true);
  // Restoring a page from the browser's history does not resurrect capture or stale call UI.
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.waitForFunction(()=>window.__qaRoom.state==='disconnected');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  assert.equal(await page.locator('#call-dock').isVisible(),false);assert.equal(await page.locator('#join-call').isEnabled(),true);
  await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.localParticipant.isMicrophoneEnabled===true);
  // Overlapping account initializations cannot overwrite the final account's subscriptions.
  await page.locator('#leave-call').click();
  await page.evaluate(async({USER,OTHER})=>{
    window.__qaReadDelay=180;
    const change=id=>{const next=id?{user:{id,user_metadata:{display_name:id===USER?'Pessoa de teste':'Outra pessoa'}},access_token:'qa-token'}:null;window.__qaSession=next;window.__qaAuthCallback(id?'SIGNED_IN':'SIGNED_OUT',next);};
    change(OTHER);await new Promise(resolve=>setTimeout(resolve,35));change(null);
    await new Promise(resolve=>setTimeout(resolve,35));change(USER);
  },{USER,OTHER});
  await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Pessoa de teste'&&document.querySelectorAll('#message-list .message').length===50);
  await page.waitForTimeout(450);
  assert.deepEqual(await page.evaluate(()=>window.__qaSubscriptions.filter(s=>!s.removed&&s.name.startsWith('social-')).map(s=>s.name)),['social-'+USER]);
  assert.deepEqual(await page.evaluate(()=>window.__qaSubscriptions.filter(s=>!s.removed&&s.name.startsWith('orbita-ui-')).map(s=>s.name)),['orbita-ui-'+USER]);
  assert.equal(await page.locator('#app-view').isVisible(),true);
  assert.deepEqual(errors,[]);reports.push({mobile,lateTokenCancelled:true,pendingAudioCancelled:true,joinRetry:true,historyRestore:true,bootstrapRace:true,errors:0});
  await context.close();
 }
 console.log(JSON.stringify(reports));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
