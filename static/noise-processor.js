let binary;
export function createNoiseProcessor(){
  return {
    name:'orbita-rnnoise',processedTrack:undefined,
    async init({track, sensitivity=50, mode='enhanced'}){
      try{
        const Audio=window.AudioContext||window.webkitAudioContext;
        this.context=new Audio({sampleRate:48000});
        if(!this.context.audioWorklet)throw Error('AudioWorklet indisponível');
        const [{RnnoiseWorkletNode},bytes]=await Promise.all([
          import('/static/vendor/rnnoise-0.4.1/index.js'),
          binary||(binary=fetch('/static/vendor/rnnoise-0.4.1/rnnoise.wasm').then(r=>{if(!r.ok)throw Error('Filtro indisponível');return r.arrayBuffer();}).catch(e=>{binary=null;throw e;})),
          this.context.audioWorklet.addModule('/static/vendor/rnnoise-0.4.1/worklet.js'),
        ]);
        if(this.cancelled)throw Error('Processamento cancelado');
        this.source=this.context.createMediaStreamSource(new MediaStream([track]));
        this.highpass=this.context.createBiquadFilter();
        this.highpass.type='highpass';
        this.highpass.frequency.value=mode==='aggressive'?120:80;
        this.highpass.Q.value=0.7;
        this.filter=new RnnoiseWorkletNode(this.context,{maxChannels:1,wasmBinary:bytes});
        // Controle de sensibilidade via ganho
        this.gain=this.context.createGain();
        this.gain.gain.value=Math.max(0.3, Math.min(2.5, sensitivity/50));
        this.destination=this.context.createMediaStreamDestination();
        this.source.connect(this.highpass);
        this.highpass.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.destination);
        await this.context.resume();
        if(this.cancelled)throw Error('Processamento cancelado');
        this.processedTrack=this.destination.stream.getAudioTracks()[0];
      }catch(error){await this.destroy();throw error;}
    },
    async restart(options){await this.destroy();this.cancelled=false;await this.init(options);},
    async destroy(){
      this.cancelled=true;
      for(const node of [this.source,this.highpass,this.filter,this.gain,this.destination]){try{node?.disconnect();}catch{}}
      try{this.filter?.destroy();this.filter?.port?.close();}catch{}
      this.processedTrack?.stop();this.processedTrack=undefined;
      const context=this.context;this.context=null;if(context&&context.state!=='closed')await context.close().catch(()=>{});
      this.source=this.highpass=this.filter=this.gain=this.destination=null;
    },
  };
}
