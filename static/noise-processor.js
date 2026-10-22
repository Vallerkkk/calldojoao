let binary;

export function createNoiseProcessor(initialOptions={}){
  let generation=0,active;
  const options={mode:'enhanced',sensitivity:50};
  const cancelled=()=>Error('Processamento cancelado');
  const fields=['source','highpass','filter','gain','destination'];
  function normalize(next={}){
    if(Object.hasOwn(next,'mode'))options.mode=next.mode==='aggressive'?'aggressive':'enhanced';
    if(Object.hasOwn(next,'sensitivity')){
      const value=Number(next.sensitivity);
      options.sensitivity=Number.isFinite(value)?Math.max(10,Math.min(100,value)):50;
    }
  }
  function clear(processor){
    processor.context=null;processor.processedTrack=undefined;
    for(const field of fields)processor[field]=null;
  }
  function apply(session,smooth=false){
    if(!session||session.disposed)return;
    const now=session.context.currentTime;
    for(const [parameter,value] of [[session.highpass?.frequency,options.mode==='aggressive'?120:80],[session.gain?.gain,options.sensitivity/50]]){
      if(!parameter)continue;
      if(smooth)parameter.setTargetAtTime(value,now,0.015);else parameter.value=value;
    }
  }
  async function waitFor(session,task){
    let timer,cancel;
    const stopped=new Promise((_,reject)=>{
      cancel=()=>reject(cancelled());session.cancel=cancel;
      timer=setTimeout(()=>reject(Error('O filtro de áudio demorou demais.')),8000);
    });
    try{return await Promise.race([task,stopped]);}
    finally{clearTimeout(timer);if(session.cancel===cancel)session.cancel=undefined;}
  }
  async function dispose(session){
    if(!session||session.disposed)return;
    session.disposed=true;session.cancel?.();
    if(session.filter)session.filter.onprocessorerror=null;
    for(const field of fields){try{session[field]?.disconnect();}catch{}}
    try{session.filter?.destroy();}catch{}
    try{session.filter?.port?.close();}catch{}
    // Only the destination belongs to us; LiveKit retains the capture track.
    session.destination?.stream.getTracks().forEach(track=>track.stop());
    try{if(session.context&&session.context.state!=='closed')await session.context.close();}catch{}
  }
  normalize(initialOptions);
  return {
    name:'orbita-rnnoise',processedTrack:undefined,fallback:false,onFallback:undefined,
    getOptions(){return {...options};},
    setOptions(next={}){normalize(next);apply(active,true);},
    async init({track}){
      const id=++generation,previous=active;
      active=undefined;clear(this);this.cancelled=false;this.fallback=false;
      await dispose(previous);
      if(id!==generation)throw cancelled();
      const session={disposed:false};active=session;
      try{
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(!Audio)throw Error('Web Audio indisponível');
        session.context=new Audio({sampleRate:48000});this.context=session.context;
        if(!session.context.audioWorklet)throw Error('AudioWorklet indisponível');
        const [{RnnoiseWorkletNode},bytes]=await waitFor(session,Promise.all([
          import('/static/vendor/rnnoise-0.4.1/index.js'),
          binary||(binary=fetch('/static/vendor/rnnoise-0.4.1/rnnoise.wasm').then(r=>{if(!r.ok)throw Error('Filtro indisponível');return r.arrayBuffer();}).catch(e=>{binary=null;throw e;})),
          session.context.audioWorklet.addModule('/static/vendor/rnnoise-0.4.1/worklet.js'),
        ]));
        if(id!==generation||session.disposed)throw cancelled();
        session.source=session.context.createMediaStreamSource(new MediaStream([track]));
        session.highpass=session.context.createBiquadFilter();session.highpass.type='highpass';session.highpass.Q.value=0.7;
        session.filter=new RnnoiseWorkletNode(session.context,{maxChannels:1,wasmBinary:bytes});
        session.gain=session.context.createGain();
        session.destination=session.context.createMediaStreamDestination();
        for(const field of fields)this[field]=session[field];
        apply(session);
        session.source.connect(session.highpass);session.highpass.connect(session.filter);session.filter.connect(session.gain);session.gain.connect(session.destination);
        session.filter.onprocessorerror=()=>{
          if(id!==generation||session.disposed||this.fallback)return;
          // Keep the published output track alive if the RNNoise worklet fails.
          session.highpass.disconnect();session.filter.disconnect();session.highpass.connect(session.gain);
          this.fallback=true;
          try{session.filter.destroy();}catch{}
          try{session.filter.port?.close();}catch{}
          try{this.onFallback?.();}catch{}
        };
        await waitFor(session,session.context.resume());
        if(id!==generation||session.disposed)throw cancelled();
        if(session.context.state!=='running')throw Error('Áudio suspenso');
        this.processedTrack=session.destination.stream.getAudioTracks()[0];
      }catch(error){
        if(active===session){active=undefined;clear(this);this.cancelled=true;}
        await dispose(session);throw error;
      }
    },
    // init owns the generation change and prior cleanup, including during restart.
    async restart(options){await this.init(options);},
    async destroy(){
      ++generation;this.cancelled=true;const previous=active;active=undefined;clear(this);await dispose(previous);
    },
  };
}
