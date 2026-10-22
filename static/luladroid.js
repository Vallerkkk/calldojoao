// Consent applies only to this person's microphone in the current call.
export function initLuladroid(ctx,target,scope){
 const {el,button,checked,showDialog}=ctx,user=ctx.state().session.user.id,db=ctx.state().db;
 let consent=false,recognizer=null,closed=false,restart=null,sid='',blocked=false,sequence=Promise.resolve();
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 const panel=el('section','call-transcription-controls'),status=el('span','','Sua fala não está sendo transcrita.');status.setAttribute('role','status');
 const start=button('Transcrever minha fala',()=>options()),stop=button('Parar minha transcrição',()=>disable());stop.hidden=true;panel.append(status,start,stop);ctx.mount().append(panel);
 const current=()=>!closed&&ctx.state().room===target&&ctx.state().session?.user.id===user;
 function showStatus(text){status.textContent=text;document.body.dataset.callTranscribing=String(consent);}
 function halt(){clearTimeout(restart);if(recognizer){const prior=recognizer;recognizer=null;prior.onend=null;prior.abort();}}
 async function prepare(){if(sid)return;const response=await ctx.apiFetch('/api/transcription/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room_name:scope})});sid=(await response.json()).room_sid;}
 async function disable(){consent=false;start.hidden=false;stop.hidden=true;halt();showStatus('Sua fala não está sendo transcrita.');if(sid)await checked(db.from('voice_consents').update({accepted:false,share_to_chat:false}).eq('user_id',user).eq('room_sid',sid));}
 function options(){showDialog('Transcrição no chat desta sala',box=>{
  box.append(el('p','','Ao aceitar, a sua fala será publicada como texto no chat desta sala, identificada com seu nome, para quem tiver acesso a ela. Cada participante autoriza a própria fala separadamente. Os trechos automáticos ficam disponíveis por até 7 dias, inclusive no histórico de administração. Não gravamos áudio no servidor da Órbita.'),el('p','','O reconhecimento do navegador pode enviar áudio ao fornecedor do navegador e pode não funcionar no Windows, Brave ou em alguns celulares. Pode haver erros e falas ausentes. Nenhuma frase ativa um assistente ou é enviada ao Gemini.'));
  const accept=button('Concordo: publicar minha fala no chat desta sala',async()=>{
   if(!current())return;if(!Recognition)throw Error('Reconhecimento indisponível neste aparelho. Use um navegador compatível.');
   await prepare();if(!current())return;await checked(db.from('voice_consents').upsert({user_id:user,room_sid:sid,room_name:scope,accepted:true,share_to_chat:true}));
   if(!current()){await db.from('voice_consents').update({accepted:false,share_to_chat:false}).eq('user_id',user).eq('room_sid',sid);return;}consent=true;blocked=false;start.hidden=true;stop.hidden=false;document.getElementById('app-dialog').close();ctx.openChat();tick();
  });accept.disabled=!Recognition;box.append(accept,button('Continuar sem transcrever',()=>document.getElementById('app-dialog').close()));
 });}
 async function sentence(text){if(!current()||!consent||blocked||!target.localParticipant.isMicrophoneEnabled)return;const content=text.trim().slice(0,2000);if(!content)return;
  try{await checked(db.from('call_transcripts').insert({id:crypto.randomUUID(),room_sid:sid,room_name:scope,speaker_id:user,content,share_to_chat:true}));if(current())ctx.refreshChat();}
  catch{if(!current())return;consent=false;halt();start.hidden=false;stop.hidden=true;showStatus('Não foi possível salvar. Transcrição interrompida; ative novamente para tentar.');}
 }
 function listen(){if(recognizer||!current()||!consent||blocked||!target.localParticipant.isMicrophoneEnabled)return;const r=new Recognition();recognizer=r;r.lang='pt-BR';r.continuous=true;r.interimResults=false;
  r.onresult=event=>{for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal){const text=event.results[i][0].transcript;sequence=sequence.then(()=>sentence(text)).catch(()=>{});}};
  r.onerror=event=>{if(['not-allowed','service-not-allowed','audio-capture','network','language-not-supported'].includes(event.error)){blocked=true;halt();showStatus('Reconhecimento indisponível ou sem permissão. Pare e ative novamente para tentar.');}};
  r.onend=()=>{if(recognizer===r)recognizer=null;if(current()&&consent&&!blocked)restart=setTimeout(listen,1200);};
  try{r.start();showStatus('Sua fala está sendo publicada no chat desta sala.');}catch{recognizer=null;blocked=true;showStatus('Não foi possível iniciar o reconhecimento neste aparelho.');}
 }
 function tick(){if(!current())return;if(!consent||!target.localParticipant.isMicrophoneEnabled)halt();else listen();}
 const timer=setInterval(tick,600);
 return {receive(){},stop(){closed=true;consent=false;clearInterval(timer);halt();document.body.dataset.callTranscribing='false';panel.remove();if(sid)db.from('voice_consents').update({accepted:false,share_to_chat:false}).eq('user_id',user).eq('room_sid',sid).then(()=>{}).catch(()=>{});}};
}

export function transcriptHistory(ctx){const {el,button,showDialog,checked}=ctx,user=ctx.state().session?.user.id;showDialog('Transcrições de chamadas · ADM',box=>{box.append(el('p','','Somente falas de participantes que consentiram, reconhecidas pelo navegador. Podem conter erros e lacunas; não são prova fiel de áudio. Retenção: 7 dias.'));const load=async()=>{const rows=await checked(ctx.state().db.from('call_transcripts').select('*').order('created_at',{ascending:false}).limit(200));if(!box.isConnected||ctx.state().session?.user.id!==user)return;for(const row of rows){const card=el('article','social-tool-card');card.append(el('strong','',ctx.person(row.speaker_id).display_name),el('small','muted',' · '+new Date(row.created_at).toLocaleString('pt-BR')+' · '+row.room_name),el('p','',row.content),button('Apagar trecho',()=>showDialog('Apagar transcrição',confirm=>confirm.append(button('Confirmar exclusão',async()=>{await checked(ctx.state().db.from('call_transcripts').delete().eq('id',row.id));document.getElementById('app-dialog').close();}),'danger'))));box.append(card);}if(!rows.length)box.append(el('p','','Nenhuma transcrição disponível.'));};load().catch(error=>{if(box.isConnected)box.append(el('p','',error.message));});});}
