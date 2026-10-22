import {CallAudioProcessor} from './call-audio-processor.js';

// LiveKit owns capture, device switching, mute/PTT and RTP senders.
export function createCallAudioProcessor(preset='padrao_call',onFallback=()=>{}){
  let engine, generation=0;
  return {
    name:'orbita-call-voice',processedTrack:undefined,preset,
    async init({track}){
      const id=++generation;
      const next=new CallAudioProcessor(preset);
      // Native constraints stay under the user's LiveKit settings. Avoid two AGCs.
      if(track.getSettings?.().autoGainControl!==false)
        await next.updateConfig({agc:{...next.getConfig().agc,digitalAgcEnabled:false}});
      next.onFallback=onFallback;engine=next;
      try{
        const stream=await next.initialize(new MediaStream([track]));
        if(id!==generation){await next.dispose();throw Error('Processamento cancelado');}
        if(stream.getAudioTracks()[0]===track)throw Error('Web Audio indisponível');
        this.processedTrack=stream.getAudioTracks()[0];
        if(this.processedTrack!==track)this.processedTrack.contentHint='speech';
        if(next.fallback)onFallback();
      }catch(error){await next.dispose();if(engine===next)engine=undefined;throw error;}
    },
    async restart(options){await this.destroy();await this.init(options);},
    async destroy(){++generation;const prior=engine;engine=undefined;this.processedTrack=undefined;await prior?.dispose();},
  };
}
