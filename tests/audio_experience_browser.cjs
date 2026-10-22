const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const {stub,OTHER,VOICE}=require('./fixtures/supabase_fixture.cjs');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const tmp=path.resolve(__dirname,'../work/browser-temp');fs.mkdirSync(tmp,{recursive:true});process.env.TEMP=tmp;process.env.TMP=tmp;
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const base=process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/',report=[];
 // Real RNNoise/WASM execution on generated noise, with no physical microphone.
 const dsp=await browser.newPage();await dsp.route('**/api/config',r=>r.fulfill({json:{configured:false}}));await dsp.goto(base,{waitUntil:'networkidle'});await dsp.mouse.click(30,30);
 const metrics=await dsp.evaluate(async()=>{
  const {createNoiseProcessor}=await import('/static/noise-processor.js?v=audio-20261021-1');
  const context=new AudioContext({sampleRate:48000}),source=context.createBufferSource(),buffer=context.createBuffer(1,48000,48000),samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*0.08;
  source.buffer=buffer;source.loop=true;const destination=context.createMediaStreamDestination();source.connect(destination);source.start();await context.resume();
  const processor=createNoiseProcessor(),track=destination.stream.getAudioTracks()[0];await processor.init({track});
  const analyser=context.createAnalyser();analyser.fftSize=2048;const processed=context.createMediaStreamSource(new MediaStream([processor.processedTrack])),silent=context.createGain();silent.gain.value=0;processed.connect(analyser);analyser.connect(silent);silent.connect(context.destination);
  await new Promise(resolve=>setTimeout(resolve,1400));const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);const output=Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length),input=Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length),prior=processor.processedTrack;
  await processor.restart({track});const restarted=prior.readyState==='ended'&&processor.processedTrack.readyState==='live';const ownContext=processor.context;await processor.destroy();const cleaned=ownContext.state==='closed'&&track.readyState==='live';source.stop();track.stop();await context.close();return {input,output,restarted,cleaned};
 });assert(metrics.input>0.02);assert(metrics.output<metrics.input*0.8,JSON.stringify(metrics));assert(metrics.restarted&&metrics.cleaned);report.push({rnnoise:metrics});await dsp.close();
 const original=fs.readFileSync(path.join(__dirname,'fixtures/livekit_stub.mjs'),'utf8');
 const livekit=original.replace('constructor() {','constructor(options) { window.__qaRoomOptions=options;')
  .replace('async connect() {',"async switchActiveDevice(kind,id){(window.__qaDeviceSwitches||=[]).push({kind,id});if(id==='broken')throw Error('device missing');return true;} async connect() {")
  .replace('this.isMicrophoneEnabled = enabled;',`this.isMicrophoneEnabled = enabled;if(enabled&&!this.audioTrackPublications.size){const track={kind:'audio',source:'microphone',async setProcessor(p){if(window.__qaFilterFailure)throw Error('filter unavailable');this.processor=p;window.__qaProcessorStarts=(window.__qaProcessorStarts||0)+1;},async stopProcessor(){await this.processor?.destroy();this.processor=null;window.__qaProcessorStops=(window.__qaProcessorStops||0)+1;},async restartTrack(){}};this.audioTrackPublications.set('mic',{track,source:'microphone'});}`);
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
  await context.addInitScript(()=>{
   localStorage.setItem('orbita-members-hidden','false');window.__qaSinks=[];
   AudioContext.prototype.setSinkId=async function(id){window.__qaSinks.push(id);if(id==='reject-mix')throw Error('Mixer refused output');};
   navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'mic-one',label:'Microfone USB'},{kind:'audioinput',deviceId:'mic-two',label:'Headset'},{kind:'audiooutput',deviceId:'speaker-two',label:'Fone USB'},{kind:'audiooutput',deviceId:'broken',label:'Saída indisponível'},{kind:'audiooutput',deviceId:'reject-mix',label:'Falha do mixer'}];
   navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){window.__qaPermissionTrackStopped=true;}}]});
  });
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});if(url.includes('livekit-client'))return route.fulfill({contentType:'application/javascript',body:livekit});if(url.endsWith('/api/config'))return route.fulfill({json:{configured:true,supabaseUrl:'https://qa.supabase.co',supabaseKey:'public',callsConfigured:true,storageConfigured:true}});if(url.endsWith('/join'))return route.fulfill({json:{url:'wss://fake.invalid',token:'fake',canPublish:true}});return route.continue();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base,{waitUntil:'networkidle'});await page.locator('#message-list .message').first().waitFor();
  assert.equal(await page.locator('#members-sidebar').isVisible(),false);assert.equal(await page.locator('#btn-members-toggle').isVisible(),false);assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth+1),false);
  async function menu(){if(mobile&&!await page.locator('body').evaluate(n=>n.classList.contains('mobile-menu-open')))await page.locator('.main>div:not([hidden]) .mobile-nav-btn').first().click();}
  await menu();await page.locator('#settings').click();const input=page.getByLabel('Dispositivo de entrada (microfone)',{exact:true}),output=page.getByLabel('Dispositivo de saída (fone ou alto-falante)',{exact:true});
  await input.selectOption('mic-two');await output.selectOption('speaker-two');await page.getByLabel('Volume dos efeitos recebidos',{exact:true}).fill('0.2');assert.equal(await page.evaluate(()=>localStorage.getItem('orbita-soundboard-volume')),'0.2');
  await page.getByRole('button',{name:'Atualizar dispositivos',exact:true}).click();assert.equal(await page.evaluate(()=>window.__qaPermissionTrackStopped),true);await page.locator('#dialog-close').click();
  await menu();await page.locator(`[data-channel-id="${VOICE}"]`).first().click();await page.locator('#join-call').click();await page.waitForFunction(()=>window.__qaRoom?.localParticipant.isMicrophoneEnabled&&window.__qaProcessorStarts===1);
  assert.equal(await page.evaluate(()=>window.__qaRoomOptions.audioCaptureDefaults.deviceId.exact),'mic-two');assert(await page.evaluate(()=>window.__qaDeviceSwitches.some(d=>d.kind==='audiooutput'&&d.id==='speaker-two')));
  await page.locator('#mic-options').click();await page.getByRole('button',{name:'Entrada, saída e redução de ruído',exact:true}).click();
  await input.selectOption('mic-one');await output.selectOption('broken');await page.getByText('Não foi possível usar esse dispositivo.',{exact:false}).waitFor();assert.equal(await output.inputValue(),'speaker-two');
  await output.selectOption('reject-mix');await page.getByText('Não foi possível usar esse dispositivo.',{exact:false}).waitFor();assert.equal(await output.inputValue(),'speaker-two');assert.equal(await page.evaluate(()=>window.__qaDeviceSwitches.some(d=>d.id==='reject-mix')),false);
  const mode=page.getByLabel('Redução de ruído adicional',{exact:true});await mode.selectOption('browser');await page.waitForFunction(()=>window.__qaProcessorStops===1);await mode.selectOption('enhanced');await page.waitForFunction(()=>window.__qaProcessorStarts===2);await page.locator('#dialog-close').click();
  await page.evaluate(OTHER=>{const r=window.__qaRoom,p=r.remoteParticipants.get(OTHER);for(let i=0;i<2;i++)r.emit('DataReceived',new TextEncoder().encode(JSON.stringify({type:'reaction',emoji:'👋'})),p,0,'orbita-reaction');},OTHER);assert.equal(await page.locator('.call-reaction-bubble').count(),1);
  await page.locator('#vc-react-call').click();assert.equal(await page.locator('.call-reaction-choice').count(),12);await page.getByRole('button',{name:'Reagir com ❤️',exact:true}).click();await page.locator('.call-reaction-bubble').getByText('❤️',{exact:true}).waitFor();
  await page.evaluate(OTHER=>{const r=window.__qaRoom,p=r.remoteParticipants.get(OTHER),send=emoji=>r.emit('DataReceived',new TextEncoder().encode(JSON.stringify({type:'reaction',emoji})),p,0,'orbita-reaction');send('🔥');send('🔥');send('not-allowed');},OTHER);
  assert.equal(await page.locator('.call-reaction-bubble').count(),2);
  await page.locator('#call-soundboard').click();await page.getByRole('button',{name:'👏 Aplausos',exact:true}).click();await page.waitForFunction(()=>window.__qaPublished.some(p=>p.topic==='orbita-sound'&&p.value.effect==='applause'));
  await page.locator('#mic-options').click();await page.getByRole('button',{name:'Entrada, saída e redução de ruído',exact:true}).click();await mode.selectOption('browser');await page.evaluate(()=>window.__qaFilterFailure=true);await mode.selectOption('enhanced');await page.getByText('O filtro adicional não está disponível agora.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.__qaRoom.localParticipant.isMicrophoneEnabled&&window.__qaRoomOptions.audioCaptureDefaults.noiseSuppression),true);await page.locator('#dialog-close').click();
  await page.locator('#leave-call').click();assert.equal(await page.locator('.call-reaction-bubble').count(),0);
  await page.evaluate(()=>AudioContext.prototype.setSinkId=undefined);await menu();await page.locator('#settings').click();assert.equal(await output.isDisabled(),true);assert.equal(await input.isEnabled(),true);await page.locator('#dialog-close').click();
  assert.deepEqual(errors,[]);report.push({mobile,noMemberColumn:true,devices:true,rollback:true,noiseModes:true,noiseFallback:true,unsupportedOutput:true,reactionPicker:true,remoteReactionThrottle:true,soundVolume:true,applause:true,cleanup:true,errors:0});await context.close();
 }
 console.log(JSON.stringify(report));await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
