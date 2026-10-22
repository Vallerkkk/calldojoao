export const SOUND_EFFECTS=['fanfare','coin','laser','powerup','applause','pop'];
export function createAppSounds(muted){
  let context,master,compressor,voices=0;const last=new Map();
  const value=(key,fallback)=>{const n=Number(localStorage.getItem('orbita-'+key)??fallback);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;};
  function init(){if(context)return context;context=new (window.AudioContext||window.webkitAudioContext)();master=context.createGain();master.gain.value=0.7;compressor=context.createDynamicsCompressor();compressor.threshold.value=-14;compressor.ratio.value=8;master.connect(compressor);compressor.connect(context.destination);const output=localStorage.getItem('orbita-audio-output');if(output&&context.setSinkId)context.setSinkId(output).catch(()=>{});return context;}
  async function play(effect='notification',preview=false){
    if(!preview&&(muted()||localStorage.getItem('orbita-sounds')==='false'))return;
    const board=SOUND_EFFECTS.includes(effect),volume=value(board?'soundboard-volume':'notification-volume',board?0.45:0.35);
    if(volume===0||voices>=4||Date.now()-(last.get(effect)||0)<180)return;
    last.set(effect,Date.now());
    try{
      const audio=init();await audio.resume();if(audio.state!=='running'||voices>=4||!preview&&muted())return;
      voices++;const now=audio.currentTime;
      const notes={notification:[784,1046],join:[392,523,659],leave:[523,392,294],fanfare:[523,659,784,1046],coin:[988,1318],laser:[1400,240],powerup:[330,440,660,880],pop:[420,840],applause:[180,240,320]}[effect]||[784,1046];
      notes.forEach((frequency,index)=>{
        const source=audio.createOscillator(),gain=audio.createGain(),start=now+index*0.075,duration=board?0.2:0.14;
        source.type=effect==='coin'?'triangle':'sine';source.frequency.setValueAtTime(frequency,start);if(effect==='laser'||effect==='pop')source.frequency.exponentialRampToValueAtTime(Math.max(60,frequency*0.35),start+duration);
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume*(board?0.16:0.10),start+0.009);gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
        source.connect(gain);gain.connect(master);source.start(start);source.stop(start+duration+0.02);source.onended=()=>{source.disconnect();gain.disconnect();};
      });
      if(effect==='applause'){
        const buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*0.55),audio.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);
        const source=audio.createBufferSource(),gain=audio.createGain(),filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1800;filter.Q.value=0.4;source.buffer=buffer;gain.gain.value=volume*0.18;source.connect(filter);filter.connect(gain);gain.connect(master);source.start(now);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
      }
      setTimeout(()=>voices=Math.max(0,voices-1),900);
    }catch{}
  }
  function fields(parent,el,button){
    const box=el('section','audio-settings');box.append(el('h3','','Sons do aplicativo'));
    for(const [key,label,fallback] of [['notification-volume','Volume dos avisos e chamadas',0.35],['soundboard-volume','Volume dos efeitos recebidos',0.45]]){const field=el('label','field',label),input=el('input'),output=el('output');input.type='range';input.min='0';input.max='1';input.step='0.05';input.value=value(key,fallback);input.setAttribute('aria-label',label);const update=()=>{localStorage.setItem('orbita-'+key,input.value);output.value=Math.round(input.value*100)+'%';};input.oninput=update;output.value=Math.round(input.value*100)+'%';field.append(input,output);box.append(field);}
    box.append(button('Testar som de aviso',()=>play('notification',true)));parent.append(box);
  }
  const unlock=()=>{try{init().resume().catch(()=>{});}catch{}};document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});
  return {play,fields,async setOutput(id){if(context?.setSinkId)await context.setSinkId(id||'');}};
}
