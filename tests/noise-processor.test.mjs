import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../static/noise-processor.js',import.meta.url),'utf8');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function track(){return {readyState:'live',stops:0,stop(){this.readyState='ended';this.stops++;}};}
function harness({addModule=async()=>{},resume=async()=>{},schedule=setTimeout,unschedule=clearTimeout}={}){
  const contexts=[],nodes=[],outputs=[];
  const parameter=()=>({value:0,setTargetAtTime(value,time,constant){this.value=value;this.target={value,time,constant};}});
  class Node {
    constructor(context,kind){this.context=context;this.kind=kind;this.connections=new Set();nodes.push(this);}
    connect(next){this.connections.add(next);return next;}
    disconnect(){this.connections.clear();}
  }
  class Worklet extends Node {
    constructor(context){super(context,'worklet');this.port={close:()=>this.closed=true};}
    destroy(){this.destroyed=true;}
  }
  class AudioContext {
    constructor(){this.state='suspended';this.currentTime=2;this.audioWorklet={addModule:()=>addModule(this)};contexts.push(this);}
    createMediaStreamSource(){return new Node(this,'source');}
    createBiquadFilter(){const node=new Node(this,'highpass');node.frequency=parameter();node.Q=parameter();return node;}
    createGain(){const node=new Node(this,'gain');node.gain=parameter();return node;}
    createMediaStreamDestination(){const node=new Node(this,'destination'),output=track();node.stream={getTracks:()=>[output],getAudioTracks:()=>[output]};outputs.push(output);return node;}
    async resume(){this.state='running';await resume(this);}
    async close(){this.state='closed';}
  }
  // Replace only the external module boundary; exercise the production lifecycle.
  const executable=source.replace('export function createNoiseProcessor','function createNoiseProcessor')
    .replace("import('/static/vendor/rnnoise-0.4.1/index.js')",'Promise.resolve({RnnoiseWorkletNode:MockRnnoiseWorkletNode})');
  const create=vm.runInNewContext(executable+'\ncreateNoiseProcessor;',{
    window:{AudioContext},MediaStream:class{constructor(tracks){this.tracks=tracks;}},MockRnnoiseWorkletNode:Worklet,
    fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}),
    setTimeout:schedule,clearTimeout:unschedule,
  });
  return {create,contexts,nodes,outputs};
}
async function until(check){for(let i=0;i<20&&!check();i++)await Promise.resolve();assert(check());}

test('RNNoise options sanitize invalid data, update the same output and survive device restart',async()=>{
  const h=harness(),input=track(),p=h.create({mode:'aggressive',sensitivity:'bad'});
  await p.init({track:input});assert.equal(p.highpass.frequency.value,120);assert.equal(p.gain.gain.value,1);
  const output=p.processedTrack,copy=p.getOptions();copy.sensitivity=3;
  assert.equal(p.getOptions().sensitivity,50);
  p.setOptions({mode:'enhanced',sensitivity:1000});assert.equal(p.highpass.frequency.target.value,80);assert.equal(p.gain.gain.target.value,2);
  assert.equal(p.processedTrack,output);assert.equal(h.contexts.length,1);
  p.setOptions({sensitivity:-100});assert.equal(p.gain.gain.target.value,.2);
  p.setOptions({mode:'aggressive',sensitivity:75});await p.restart({track:input});
  assert.equal(output.readyState,'ended');assert.equal(p.highpass.frequency.value,120);assert.equal(p.gain.gain.value,1.5);
  assert.equal(p.getOptions().mode,'aggressive');assert.equal(p.getOptions().sensitivity,75);
  const last=p.processedTrack;p.setOptions({mode:'unknown',sensitivity:Infinity});
  assert.equal(p.highpass.frequency.target.value,80);assert.equal(p.gain.gain.target.value,1);
  await p.destroy();await p.destroy();assert.equal(last.stops,1);assert.equal(input.stops,0);assert(h.contexts.every(context=>context.state==='closed'));
});

test('destroy during worklet loading prevents late nodes and does not stop capture',async()=>{
  const gate=deferred(),h=harness({addModule:()=>gate.promise}),input=track(),p=h.create();
  const pending=p.init({track:input});await until(()=>h.contexts.length===1);await p.destroy();gate.resolve();
  await assert.rejects(pending,/cancelado/);assert.equal(h.nodes.length,0);assert.equal(p.processedTrack,undefined);assert.equal(h.contexts[0].state,'closed');assert.equal(input.stops,0);
});

test('destroy during resume stops the owned unpublished destination and cannot resurrect output',async()=>{
  const gate=deferred(),h=harness({resume:()=>gate.promise}),input=track(),p=h.create();
  const pending=p.init({track:input});await until(()=>h.outputs.length===1);await p.destroy();gate.resolve();
  await assert.rejects(pending,/cancelado/);assert.equal(h.outputs[0].stops,1);assert.equal(p.processedTrack,undefined);assert.equal(h.contexts[0].state,'closed');assert.equal(input.stops,0);
});

test('a stale initialization cannot clear or close a newer initialized graph',async()=>{
  const gate=deferred();let loads=0;
  const h=harness({addModule:()=>++loads===1?gate.promise:Promise.resolve()}),input=track(),p=h.create();
  const pending=p.init({track:input});await until(()=>loads===1);await p.init({track:input});
  const context=p.context,output=p.processedTrack;gate.resolve();await assert.rejects(pending,/cancelado/);
  assert.equal(p.context,context);assert.equal(p.processedTrack,output);assert.equal(output.readyState,'live');assert.equal(context.state,'running');
  await p.destroy();assert.equal(input.stops,0);assert(h.contexts.every(context=>context.state==='closed'));
});

test('a worklet runtime error bypasses RNNoise while retaining the published output',async()=>{
  const h=harness(),input=track(),p=h.create({sensitivity:65});await p.init({track:input});
  let notices=0;p.onFallback=()=>{notices++;throw Error('UI callback failure');};
  const output=p.processedTrack,filter=p.filter,error=filter.onprocessorerror;error();
  assert.equal(p.fallback,true);assert.equal(p.processedTrack,output);assert.equal(output.readyState,'live');assert.equal(p.highpass.connections.has(p.gain),true);assert.equal(filter.connections.size,0);assert.equal(filter.closed,true);
  error();assert.equal(notices,1);p.setOptions({sensitivity:80});assert.equal(p.gain.gain.target.value,1.6);
  await p.destroy();error();assert.equal(output.stops,1);assert.equal(input.stops,0);
});

test('a worklet load deadline closes its context and ignores a late successful load',async()=>{
  const gate=deferred(),timers=new Set();let elapsed;
  const h=harness({addModule:()=>gate.promise,schedule:(callback,delay)=>{assert.equal(delay,8000);elapsed=callback;timers.add(callback);return callback;},unschedule:callback=>timers.delete(callback)});
  const input=track(),p=h.create(),pending=p.init({track:input});await until(()=>!!elapsed);elapsed();
  await assert.rejects(pending,/demorou demais/);gate.resolve();await Promise.resolve();
  assert.equal(timers.size,0);assert.equal(h.contexts[0].state,'closed');assert.equal(h.nodes.length,0);assert.equal(p.processedTrack,undefined);assert.equal(input.stops,0);
});
