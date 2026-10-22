import {createNoiseProcessor} from './noise-processor.js';
import {createCallAudioProcessor} from './call-audio-adapter.js';

export function initAudioControls(ctx){
  const {el,button}=ctx,read=kind=>localStorage.getItem('orbita-audio-'+kind)||'',tracks=new WeakMap();
  const supportsOutput=()=>typeof (window.AudioContext||window.webkitAudioContext)?.prototype?.setSinkId==='function';
  let warned=false,mixContext;const mixes=new WeakMap();
  function mixOptions(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;mixContext=new Audio();return {audioContext:mixContext};}
  function bind(room){if(mixContext){mixes.set(room,mixContext);mixContext=null;}}
  async function ended(room){const audio=mixes.get(room);mixes.delete(room);if(audio&&audio.state!=='closed')await audio.close().catch(()=>{});}
  async function switchDevice(room,kind,value){
    // LiveKit 2.15's mixer switch does not await setSinkId. Confirm it ourselves.
    if(kind==='audiooutput'){const audio=mixes.get(room);if(audio?.setSinkId)await audio.setSinkId(value||'');}
    const ok=await room.switchActiveDevice(kind,value||'default');if(ok===false)throw Error('Dispositivo indisponível');
  }
  const selection=()=>localStorage.getItem('orbita-noise-mode')||'enhanced';
  const notifyFallback=()=>{if(!warned){warned=true;ctx.toast('O filtro adicional não está disponível agora. A supressão de ruído do navegador continua ativa.');}};
  const enhanced=()=>ctx.noise()&&localStorage.getItem('orbita-noise-mode')!=='browser';
  async function process(track,room){
    if(!track||track.source!=='microphone'||typeof track.setProcessor!=='function')return;
    const prior=tracks.get(track);if(prior?.pending){prior.again=true;return prior.pending;}
    const record=prior||{};tracks.set(track,record);
    record.pending=(async()=>{do{record.again=false;
      if(!enhanced()){if(record.processor){await track.stopProcessor();record.processor=null;}continue;}
      const mode=selection();
      if(record.processor&&record.mode===mode)continue;
      if(record.processor){await track.stopProcessor();record.processor=null;}
      if(ctx.room()!==room)return;
      const processor=mode.startsWith('voice:')?createCallAudioProcessor(mode.slice(6),notifyFallback):createNoiseProcessor();
      try{
        // Await the actual operation: a timeout cannot cancel LiveKit setProcessor.
        await track.setProcessor(processor);
        if(ctx.room()!==room){await track.stopProcessor();return;}
        record.processor=processor;record.mode=mode;
      }catch{if(track.getProcessor?.()===processor)await track.stopProcessor().catch(()=>{});await processor.destroy();if(!warned&&ctx.room()===room){warned=true;ctx.toast('O filtro adicional não está disponível agora. A supressão de ruído do navegador continua ativa.');}}
      }while(record.again&&ctx.room()===room);
    })().finally(()=>{record.pending=null;});return record.pending;
  }
  async function sync(room=ctx.room()){
    if(!room||room!==ctx.room())return;
    for(const pub of room.localParticipant.audioTrackPublications.values())if(pub.track)await process(pub.track,room);
  }
  async function connected(room){
    const output=read('output');if(output&&supportsOutput())try{await switchDevice(room,'audiooutput',output);}catch{ctx.toast('Não foi possível usar a saída salva. Escolha outra em Entrada e saída de áudio.');}
    await sync(room);
  }
  function fields(container){
    const box=el('section','audio-settings');box.append(el('h3','','Entrada e saída de áudio'),el('p','muted','As alterações abaixo são aplicadas imediatamente neste aparelho.'));
    const input=el('select'),output=el('select'),mode=el('select'),status=el('p','muted');
    for(const [node,label] of [[input,'Dispositivo de entrada (microfone)'],[output,'Dispositivo de saída (fone ou alto-falante)'],[mode,'Redução de ruído adicional']]){const field=el('label','field',label);node.setAttribute('aria-label',label);field.append(node);box.append(field);}
    mode.append(new Option('Aprimorada · RNNoise (gratuita e local)','enhanced'),new Option('Somente a supressão do navegador','browser'));
    for(const [key,label] of [['padrao_call','Voz · padrão de chamada'],['ambiente_ruidoso','Voz · ambiente ruidoso'],['anti_teclado_gamer','Voz · teclado'],['voz_estudio','Voz · estúdio']])mode.append(new Option(label,'voice:'+key));mode.value=localStorage.getItem('orbita-noise-mode')||'enhanced';
    const setStatus=()=>status.textContent=!ctx.noise()?'Ative Supressão de ruído e salve o perfil para filtrar o microfone.':mode.value!=='browser'?'Filtro de voz local com redução de ruídos contínuos e graves. Os perfis de voz podem atenuar falas baixas; escolha outro se necessário. Em caso de incompatibilidade, usa o filtro do navegador.':'Usando a redução de ruído do navegador.';
    mode.onchange=async()=>{mode.disabled=true;localStorage.setItem('orbita-noise-mode',mode.value);try{await sync();setStatus();}catch{ctx.toast('Não foi possível atualizar o filtro. Tente novamente.');}finally{mode.disabled=false;}};
    async function refresh(){
      try{const devices=await navigator.mediaDevices?.enumerateDevices()||[];if(!box.isConnected)return;
        for(const [node,kind,key] of [[input,'audioinput','input'],[output,'audiooutput','output']]){node.replaceChildren(new Option('Padrão do sistema',''));const saved=read(key),choices=devices.filter(d=>d.kind===kind&&d.deviceId&&d.deviceId!=='default'&&d.deviceId!=='communications');for(const [index,d] of choices.entries())node.append(new Option(d.label||(key==='input'?'Microfone ':'Saída ')+(index+1),d.deviceId));if(saved&&!choices.some(d=>d.deviceId===saved))node.append(new Option('Dispositivo salvo · reconecte ou escolha outro',saved));node.value=saved;}
        input.disabled=!navigator.mediaDevices;output.disabled=!supportsOutput();if(output.disabled)output.title='Neste navegador, escolha a saída nas configurações do sistema.';
      }catch{status.textContent='Não foi possível listar os dispositivos. Verifique as permissões do microfone.';}
    }
    for(const [node,key,kind] of [[input,'input','audioinput'],[output,'output','audiooutput']])node.onchange=async()=>{
      const value=node.value,previous=read(key),room=ctx.room();node.disabled=true;
      try{if(room){await switchDevice(room,kind,value);if(ctx.room()!==room)throw Error('A chamada mudou. Escolha o dispositivo novamente.');}if(key==='output')await ctx.output(value);localStorage.setItem('orbita-audio-'+key,value);if(room)await sync(room);ctx.toast('Dispositivo de áudio atualizado.');}
      catch{if(room&&ctx.room()===room)await switchDevice(room,kind,previous).catch(()=>{});if(key==='output')await ctx.output(previous).catch(()=>{});node.value=previous;ctx.toast('Não foi possível usar esse dispositivo. Verifique a conexão e a permissão do navegador.');}
      finally{node.disabled=false;}
    };
    box.append(status);setStatus();if(!supportsOutput())box.append(el('p','muted','Este navegador usa a saída de áudio definida no sistema.'));
    box.append(button('Atualizar dispositivos',async()=>{let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}finally{stream?.getTracks().forEach(t=>t.stop());}await refresh();}));
    container.append(box);refresh();const devicesAbort=new AbortController();navigator.mediaDevices?.addEventListener?.('devicechange',refresh,{signal:devicesAbort.signal});document.getElementById('app-dialog')?.addEventListener('close',()=>devicesAbort.abort(),{once:true});
  }
  return {fields,sync,connected,mixOptions,bind,ended,capture:()=>read('input')?{deviceId:{exact:read('input')}}:{},open:()=>ctx.dialog('Entrada e saída de áudio',fields)};
}
