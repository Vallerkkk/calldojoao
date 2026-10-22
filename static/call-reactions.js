export function initCallReactions(ctx){
  const emojis=['🎉','❤️','👍','😂','🔥','👏','😮','👋','💯','✨','😢','🙌'],last=new Map();let lastSent=0,joined;
  const layer=ctx.el('div','call-reaction-layer');layer.setAttribute('aria-hidden','true');document.querySelector('#voice-stage').append(layer);
  const announcement=ctx.el('span','sr-only');announcement.setAttribute('aria-live','polite');document.querySelector('#voice-stage').append(announcement);
  function show(emoji,participant){
    const room=ctx.room();if(!room)return;if(joined!==room){layer.replaceChildren();last.clear();joined=room;}
    while(layer.children.length>=10)layer.firstChild.remove();
    const reaction=ctx.el('div','call-reaction-bubble'),symbol=ctx.el('span','',emoji),name=ctx.el('small','',participant?.name||'Participante');reaction.append(symbol,name);layer.append(reaction);announcement.textContent=(participant?.name||'Participante')+' reagiu com '+emoji;
    for(const tile of document.querySelectorAll('#voice-stage [data-participant-id]'))if(tile.dataset.participantId===participant?.identity){tile.classList.remove('call-reacted');void tile.offsetWidth;tile.classList.add('call-reacted');setTimeout(()=>tile.classList.remove('call-reacted'),900);}
    setTimeout(()=>reaction.remove(),3000);
  }
  async function send(emoji){
    const room=ctx.room();if(!room||room.state!=='connected')throw Error('Entre na chamada para reagir.');if(Date.now()-lastSent<1200)return ctx.toast('Aguarde um instante para reagir novamente.');lastSent=Date.now();
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({type:'reaction',emoji})),{reliable:true,topic:'orbita-reaction'});if(ctx.room()===room)show(emoji,room.localParticipant);
  }
  function receive(payload,participant,_kind,topic){
    if(topic!=='orbita-reaction'||!participant||payload.length>200||!ctx.room()?.remoteParticipants.has(participant.identity))return;
    if(joined!==ctx.room()){layer.replaceChildren();last.clear();joined=ctx.room();}
    try{const data=JSON.parse(new TextDecoder().decode(payload));if(data?.type!=='reaction'||!emojis.includes(data.emoji))return;const time=last.get(participant.identity)||0;if(Date.now()-time<1200)return;last.set(participant.identity,Date.now());show(data.emoji,participant);}catch{}
  }
  document.querySelector('#vc-react-call').onclick=()=>ctx.dialog('Reações da chamada',box=>{const grid=ctx.el('div','call-reaction-picker');for(const emoji of emojis){const button=ctx.button(emoji,async()=>{await send(emoji);document.querySelector('#app-dialog').close();},'call-reaction-choice');button.setAttribute('aria-label','Reagir com '+emoji);grid.append(button);}box.append(grid,ctx.el('p','muted','A reação aparece para todas as pessoas na chamada.'));});
  return {receive,clear(){layer.replaceChildren();last.clear();joined=null;lastSent=0;announcement.textContent='';}};
}
