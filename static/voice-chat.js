import {DraftStore}from './runtime-utils.js';
export function voiceChatScope(target){return target?.kind==='voice'?{field:target.private?'conversation_id':'channel_id',id:target.id}:null;}
export function initVoiceChat(ctx){
 const {el,button,checked,toast}=ctx,$=id=>document.getElementById(id),view=$('voice-view');
 const toggle=button('Chat da sala',()=>setOpen(panel.hidden),'soft-button');toggle.id='voice-chat-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','voice-room-chat');view.querySelector('.chat-actions').append(toggle);
 const panel=el('aside','voice-room-chat');panel.id='voice-room-chat';panel.hidden=true;panel.setAttribute('aria-label','Chat de texto da sala de voz');
 const header=el('header','voice-chat-header'),title=el('h3','','Chat da sala'),dismiss=button('Fechar',()=>setOpen(false),'text-button');header.append(title,dismiss);
 const earlier=button('Carregar anteriores',()=>load(true),'text-button'),list=el('div','voice-chat-messages'),status=el('p','muted');list.setAttribute('role','log');list.setAttribute('aria-label','Mensagens da sala');list.setAttribute('aria-live','polite');status.setAttribute('role','status');
 const form=el('form','voice-chat-form'),input=el('textarea'),send=el('button','primary','Enviar');input.rows=2;input.maxLength=4000;input.setAttribute('aria-label','Mensagem no chat da sala de voz');send.type='submit';form.append(input,send);panel.append(header,earlier,list,status,form);view.append(panel);
 const drafts=new DraftStore();let scope,user,key,version=0,subscription,rows=new Map(),loading=false,refreshAgain=false,pending=null,retry=null,poll;
 const current=(ticket,account)=>ticket===version&&ctx.state().session?.user.id===account;
 function save(){if(key)drafts.set(key,input.value);}
 input.oninput=save;input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
 panel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);toggle.focus();}};
 function setOpen(open){panel.hidden=!open;view.classList.toggle('voice-room-chat-open',open);toggle.setAttribute('aria-expanded',String(open));if(open){load().catch(()=>{});requestAnimationFrame(()=>{if(!panel.hidden)input.focus();});}else save();}
 function render(){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<70,fragment=document.createDocumentFragment();for(const row of [...rows.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))){const card=el('article','voice-chat-message');card.dataset.voiceMessageId=row.id;card.append(el('strong','',ctx.person(row.author_id).display_name));if(row.kind==='transcript')card.append(el('span','voice-transcript-tag','Transcrição automática'));const time=el('time','muted',new Date(row.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));time.dateTime=row.created_at;card.append(time,el('p','',row.content));if(row.author_id===user)card.append(button('Apagar',async()=>{if(!confirm('Apagar este trecho do chat da sala?'))return;await checked(ctx.state().db.from('voice_chat_messages').delete().eq('id',row.id));rows.delete(row.id);render();},'text-button'));fragment.append(card);}list.replaceChildren(fragment);if(bottom)list.scrollTop=list.scrollHeight;}
 async function load(older=false){if(!scope)return;if(loading){refreshAgain=true;return;}loading=true;refreshAgain=false;const ticket=version,account=user,target={...scope};status.textContent='Carregando…';
  try{let query=ctx.state().db.from('voice_chat_messages').select('*').eq(target.field,target.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(older?50:Math.max(50,Math.min(300,rows.size)));
   if(older&&rows.size){const first=[...rows.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))[0];query=query.or(`created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`);}
   const result=await checked(query);if(!current(ticket,account))return;if(!older)rows.clear();for(const row of result)rows.set(row.id,row);while(rows.size>500)rows.delete(rows.keys().next().value);earlier.hidden=result.length<50;render();status.textContent=rows.size?'':'Este chat pertence somente a esta sala. Envie a primeira mensagem.';
  }catch{if(current(ticket,account))status.textContent='Não foi possível carregar. Feche e abra o chat para tentar novamente.';}finally{if(current(ticket,account)){loading=false;if(refreshAgain){refreshAgain=false;queueMicrotask(()=>load());}}}
 }
 form.onsubmit=async event=>{event.preventDefault();if(!scope||pending||!input.value.trim())return;const ticket=version,account=user,text=input.value.trim(),id=retry?.key===key&&retry?.text===text?retry.id:crypto.randomUUID(),target={...scope};retry={id,text,key};pending=id;input.disabled=send.disabled=true;
  try{const result=await ctx.state().db.from('voice_chat_messages').insert({id,[target.field]:target.id,author_id:account,content:text});if(result.error){if(result.error.code!=='23505')throw result.error;const stored=await checked(ctx.state().db.from('voice_chat_messages').select('id,content').eq('id',id).eq('author_id',account).eq(target.field,target.id).maybeSingle());if(stored?.content!==text)throw result.error;}if(!current(ticket,account))return;retry=null;input.value='';save();await load();}
  catch{if(current(ticket,account)){status.textContent='Não foi possível confirmar o envio. O rascunho foi mantido.';toast('Confira o chat antes de reenviar para evitar mensagens duplicadas.');}}
  finally{if(current(ticket,account)){pending=null;input.disabled=send.disabled=false;}}
 };
 async function update(){const state=ctx.state(),target=state.home?null:voiceChatScope(state.selected),account=state.session?.user.id,next=target&&account?account+':voice:'+target.field+':'+target.id:null;
  if(next===key)return;save();version++;const ticket=version;loading=false;pending=null;retry=null;input.disabled=send.disabled=false;clearInterval(poll);const old=subscription;subscription=null;if(old)state.db.removeChannel(old).catch(()=>{});rows.clear();list.replaceChildren();scope=target;key=next;
  if(account!==user){drafts.useAccount(account,localStorage);user=account;}input.value=key?drafts.get(key):'';status.textContent='';earlier.hidden=true;if(!key){setOpen(false);return;}title.textContent='Chat · '+state.selected.name;input.placeholder='Conversar nesta sala';
  subscription=state.db.channel('voice-chat:'+account+':'+target.id).on('postgres_changes',{event:'*',schema:'public',table:'voice_chat_messages',filter:target.field+'=eq.'+target.id},()=>{if(current(ticket,account))load();}).subscribe();
  poll=setInterval(()=>{if(!document.hidden&&!panel.hidden&&current(ticket,account))load();},8000);if(!panel.hidden)load();
 }
 window.addEventListener('pagehide',()=>{save();drafts.flush();});window.addEventListener('focus',()=>{if(!panel.hidden)load();});
 return {update,refresh:()=>load(),open(){update();setOpen(true);}};
}
