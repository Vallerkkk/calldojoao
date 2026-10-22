const {chromium}=require(process.env.ORBITA_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{
 const page=await browser.newPage();await page.goto((process.env.ORBITA_TEST_URL||'http://127.0.0.1:8766/')+'static/manifest.webmanifest');
 const result=await page.evaluate(async()=>{
  const {CallAudioProcessor,AUDIO_PRESETS}=await import('/static/call-audio-processor.js');
  const {createCallAudioProcessor}=await import('/static/call-audio-adapter.js');
  const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();
  osc.frequency.value=220;gain.gain.value=.08;osc.connect(gain).connect(dest);osc.start();await ctx.resume();
  const track=dest.stream.getAudioTracks()[0],checks=[];
  for(const preset of Object.keys(AUDIO_PRESETS)){
   const p=createCallAudioProcessor(preset);await p.init({track});
   const output=p.processedTrack; if(output===track)throw Error('DSP did not start');
   const analyser=ctx.createAnalyser();ctx.createMediaStreamSource(new MediaStream([output])).connect(analyser);
   await new Promise(r=>setTimeout(r,350));const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
   if(!data.every(Number.isFinite)||!data.some(v=>Math.abs(v)>.001))throw Error('Silent/invalid DSP output '+preset);
   await p.restart({track});if(output.readyState!=='ended'||p.processedTrack.readyState!=='live')throw Error('Restart lifecycle');
   const last=p.processedTrack;await p.destroy();await p.destroy();
   if(last.readyState!=='ended'||track.readyState!=='live')throw Error('Borrowed track ownership');checks.push(preset);
  }
  const native=AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule=async()=>{throw Error('CSP/unsupported')};
  let notices=0;const fallback=createCallAudioProcessor('padrao_call',()=>notices++);await fallback.init({track});
  if(!fallback.processedTrack||!notices)throw Error('Missing fallback');await fallback.destroy();
  // Cancel while addModule is outstanding. Late completion must not resurrect output.
  let release;AudioWorklet.prototype.addModule=()=>new Promise(r=>release=r);
  const pending=createCallAudioProcessor(),init=pending.init({track}).then(()=>false,()=>true);
  while(!release)await new Promise(r=>setTimeout(r,0));await pending.destroy();release();
  if(!await init||pending.processedTrack||track.readyState!=='live')throw Error('Late initialization leak');
  AudioWorklet.prototype.addModule=native;
  const api=new CallAudioProcessor();await api.initialize(new MediaStream([track]));
  const stable=api.getProcessedStream().getAudioTracks()[0];await api.applyPreset('voz_estudio');
  if(api.getProcessedStream().getAudioTracks()[0]!==stable)throw Error('Preset replaced output');
  let rejected=false;try{await api.applyPreset('invalid')}catch{rejected=true}if(!rejected)throw Error('Unknown preset');
  api.workletNode.onprocessorerror();if(!api.fallback||api.getProcessedStream().getAudioTracks()[0]!==stable)throw Error('Runtime fallback');
  await api.dispose();track.stop();osc.stop();await ctx.close();return {presets:checks,nonSilent:true,restart:true,borrowedInputSurvives:true,fallback:true,cancelLateInit:true,stablePresetOutput:true};
 });console.log(JSON.stringify(result));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
