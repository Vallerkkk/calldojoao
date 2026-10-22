import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../static/call-voice-worklet.js',import.meta.url),'utf8');
for(const rate of [16000,44100,48000])test('voice DSP finite output and bypass at '+rate,()=>{
 let Processor;const sandbox={sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor(name,value){Processor=value;}};
 vm.runInNewContext(source,sandbox);const p=new Processor();
 for(let frame=0;frame<300;frame++){
  const input=Float32Array.from({length:128},(_,i)=>.1*Math.sin(2*Math.PI*220*(frame*128+i)/rate));
  const output=new Float32Array(128);assert.equal(p.process([[input]],[[output]]),true);assert(output.every(Number.isFinite));assert(output.every(x=>Math.abs(x)<=1));
 }
 p.config.bypass=true;const input=new Float32Array(128).fill(.2),output=new Float32Array(128);p.process([[input]],[[output]]);assert.deepEqual(output,input);
 assert.equal(p.process([],[[new Float32Array(128)]]),true);
});
