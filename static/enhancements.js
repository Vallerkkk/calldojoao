import {isQuiet,channelNotifies,syncNotificationPreferences} from './notification-preferences.js';
import {createAppSounds,SOUND_EFFECTS} from './app-sounds.js';
import { relativeTime, safeLink, stickerNames, youtubeId } from './media-utils.js';
import { reserveImage, focusElement } from './dom-utils.js';
import { requestWithDeadline } from './chat-state.js';
import { requestAppInstall } from './app-install.js';
import { watchUploadedVideo } from './uploaded-video.js';

export function initEnhancements(context) {
  const { el, button, toast, checked, showDialog, inputField } = context;
  const $ = id => document.getElementById(id), state = context.state;
  const jsonPost = async (path, body = {}) => (await context.apiFetch(path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })).json();
  let sessionVersion=0,channelVersion=0,threadReadVersion=0,installTask;
  let inbox, typing, subscribedUser, typingTimer, idle = false, idleTimer, lastTyped = 0, registration;
  let unread = {}, panel, panelKind, threadRoot, threadTarget, threadVersion = 0, threadCursor, threadMore;
  let wakeLock, wakeRequest = false, focusedLink;
  let watch,watchTask,watchJoined;
  function loadWatch(){if(!watchTask)watchTask=import('./watch-party.js').then(module=>watch=module.initWatchParty({...context,report:error=>toast(context.errorText(error))})).catch(error=>{watchTask=null;throw error;});return watchTask;}
  let lastSound = new Map(), searchTimer, searchVersion = 0, historyObserver, remoteSearch = false;
  const seenActivity = new Set(), typingUsers = new Map();
  const readSetting = (key, fallback) => localStorage.getItem('orbita-' + key) ?? fallback;
  const saveUnread = () => { if (state().session) localStorage.setItem('orbita-unread-' + state().session.user.id, JSON.stringify(unread)); };
  const report = error => toast(context.errorText(error));

  function applyAppearance() {
    document.body.dataset.colorMode = readSetting('color-mode', 'dark');
    document.documentElement.style.setProperty('--message-font-size', Math.min(20, Math.max(14, Number(readSetting('font-size', '15')) || 15)) + 'px');
  }
  applyAppearance();
  function checkbox(parent, label, key, defaultValue = true) {
    const field = el('label', 'check-field'), input = el('input'); input.type = 'checkbox';
    input.checked = readSetting(key, String(defaultValue)) !== 'false';
    input.onchange = () => { localStorage.setItem('orbita-' + key, String(input.checked)); if (key === 'wake-lock') syncWakeLock(); };
    field.append(input, document.createTextNode(label)); parent.append(field); return input;
  }
  function preferenceFields(parent) {
    const title = el('h3', '', 'Conforto e acessibilidade'); parent.append(title);
    const mode = el('select'); mode.setAttribute('aria-label', 'Tema claro ou escuro');
    for (const [value, label] of [['dark', 'Escuro'], ['light', 'Claro']]) { const option = el('option', '', label); option.value = value; mode.append(option); }
    mode.value = readSetting('color-mode', 'dark'); mode.onchange = () => { localStorage.setItem('orbita-color-mode', mode.value); applyAppearance(); };
    const label = el('label', 'field', 'Aparência'); label.append(mode); parent.append(label);
    const fontLabel = el('label', 'field', 'Tamanho das mensagens'), font = el('input'); font.type = 'range'; font.min = '14'; font.max = '20'; font.step = '1'; font.value = readSetting('font-size', '15');
    font.setAttribute('aria-label', 'Tamanho da fonte das mensagens'); const value = el('output', '', font.value + ' px');
    font.oninput = () => { localStorage.setItem('orbita-font-size', font.value); value.value = font.value + ' px'; applyAppearance(); };
    fontLabel.append(font, value); parent.append(fontLabel);
    const motion=checkbox(parent,'Reduzir animações','reduce-motion',false);motion.onchange=()=>{localStorage.setItem('orbita-reduce-motion',String(motion.checked));window.dispatchEvent(new Event('orbita:motion-changed'));};
    parent.append(button('Apagar rascunhos deste aparelho',()=>{if(confirm('Apagar os rascunhos salvos desta conta neste aparelho?')){context.clearDrafts();toast('Rascunhos apagados.');}}));
    parent.append(button('Central de ajuda e sugestões',()=>showDialog('Ajuda e sugestões',box=>{box.append(el('p','','Use Ctrl+K para encontrar canais e conversas. Durante uma chamada, abra a seta ao lado do microfone para trocar a entrada ou a saída de áudio.'),button('Reportar problema',()=>{const url=new URL('https://github.com/Vallerkkk/calldojoao/issues/new');url.searchParams.set('title','Problema no Órbita');window.open(url.href,'_blank','noopener,noreferrer');}));const suggestions=state().channels.find(c=>c.kind==='text'&&['sugestoes','sugestões'].includes(c.name.toLowerCase().replace(/^#/,'')));box.append(button('Abrir #sugestões',async()=>{const server=state().communities.find(c=>c.is_default),channel=suggestions||await checked(state().db.from('channels').select('*').eq('community_id',server?.id||state().activeCommunity).eq('name','sugestões').maybeSingle());if(!channel)throw Error('O canal de sugestões ainda não está disponível.');document.getElementById('app-dialog').close();await context.selectChannel(channel);}));})));
    appSounds.fields(parent,el,button);
    checkbox(parent, 'Sons de avisos e chamadas', 'sounds'); checkbox(parent, 'Manter a tela acesa durante chamadas', 'wake-lock');
    parent.append(button('Instalar Órbita', installApp), button('Ativar notificações e push', enableNotifications), button('Desativar push neste dispositivo', disablePush),button('Sair da conta',()=>{$('app-dialog').close();$('logout').click();},'danger'));
  }

  const appSounds=createAppSounds(()=>state().deafened||state().profile?.presence_status==='dnd'||isQuiet(state().session?.user.id));
  const audio=effect=>appSounds.play(effect);

  async function installPWA() {
    if(!('serviceWorker' in navigator))return;
    if(installTask)return installTask;
    installTask=(async()=>{let timer;try{
      await navigator.serviceWorker.register('/sw.js',{scope:'/'});
      registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Instalação indisponível.')),10000);})]);
    }catch{registration=undefined;}finally{clearTimeout(timer);installTask=undefined;}})();
    return installTask;
  }
  installPWA();
  async function installApp() {
    const result = await requestAppInstall();
    if(result==='installed')return toast('A Órbita já está aberta como aplicativo.');
    if(result==='accepted')return toast('Solicitação aceita. Aguarde a confirmação do navegador.');
    if(result==='dismissed')return toast('Você pode instalar depois pelo menu do navegador.');
    if(result==='busy')return;
    showDialog('Instalar Órbita',box=>{
      box.append(el('p','','Instale pelo Edge, Chrome ou outro navegador compatível para abrir a Órbita pelo ícone do aplicativo. No iPhone, use Compartilhar → Adicionar à Tela de Início.'));
      const link=el('a','primary','Abrir página de instalação ↗');link.href='/instalar';link.target='_blank';link.rel='noopener noreferrer';box.append(link);
    });
  }
  async function enableNotifications() {
    if (!state().session) return toast('Entre na sua conta primeiro.');
    if (!('Notification' in window)) return toast('Este navegador não oferece notificações. No iPhone, instale o app na tela inicial.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('Você pode liberar notificações nas permissões deste site.');
    if (!state().config.pushConfigured || !('PushManager' in window)) return toast('Notificações ativadas enquanto a Órbita estiver aberta. Push não disponível neste navegador.');
    await installPWA(); if (!registration) return toast('Não foi possível registrar as notificações neste navegador.');
    const padded = state().config.pushPublicKey.replace(/-/g, '+').replace(/_/g, '/');
    const key = Uint8Array.from(atob(padded + '='.repeat((4 - padded.length % 4) % 4)), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
    await jsonPost('/api/push/subscribe', subscription.toJSON()); toast('Push ativado: menções e DMs podem chegar com o app fechado.');
  }
  async function disablePush(quiet=false) {
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) { try { await context.apiFetch('/api/push/subscribe', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(subscription.toJSON())}); } finally { await subscription.unsubscribe(); } }
    if(!quiet)toast('Push desativado neste dispositivo.');
  }
  let dispatchTask,retryPush;
  async function dispatchPush() {
    const uid=state().session?.user.id;if(!state().config?.pushConfigured||!uid||dispatchTask)return;
    clearTimeout(retryPush);dispatchTask=true;
    try{const result=await(await context.apiFetch('/api/notifications/dispatch',{method:'POST',keepalive:true})).json();
      if(result.retry&&state().session?.user.id===uid)retryPush=setTimeout(()=>{if(state().session?.user.id===uid)dispatchPush();},21000);
    }catch{/* Message storage succeeds independently of notification providers. */}finally{dispatchTask=false;}
  }
  async function notifyActivity(data) {
    const s = state(); if (!s.session || data.author_id === s.session.user.id) return;
    if (seenActivity.has(data.id)) return; seenActivity.add(data.id); if (seenActivity.size > 1000) seenActivity.delete(seenActivity.values().next().value);
    if (!document.hidden && s.selected?.id === data.scope && !s.home) { markRead(); return; }
    const prior = unread[data.scope] || {count:0, seen:new Date().toISOString()};
    unread[data.scope] = {...prior, count:Math.min(999, prior.count + 1)}; saveUnread(); decorateNavigation();
    if ((data.mentioned || data.private) && s.profile?.presence_status !== 'dnd'&&!isQuiet(s.session.user.id)&&channelNotifies(s.session.user.id,data)) { audio(); if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !s.config.pushConfigured) {
      const title = data.private ? 'Nova mensagem privada · Órbita' : 'Você foi mencionado · Órbita';
      if (registration) await registration.showNotification(title, {body:'Abra a Órbita para ler.', icon:'/static/icons/icon-192.png', tag:'orbita-' + data.id});
      else if ('Notification' in window) new Notification(title, {tag:'orbita-' + data.id});
    } }
  }
  function markRead() {
    const s = state(); if (!s.session || !s.selected || s.selected.kind!=='text' || s.home || document.hidden) return;
    unread[s.selected.id] = {count:0, seen:new Date().toISOString()}; saveUnread(); decorateNavigation();
  }
  function decorateNavigation() {
    for (const node of document.querySelectorAll('[data-channel-id]')) {
      const count = unread[node.dataset.channelId]?.count || 0;
      node.classList.toggle('unread', count > 0);let badge=node.querySelector('.unread-indicator');
      if(!count){badge?.remove();continue;}
      if(!badge){badge=el('span','unread-indicator');node.append(badge);}const label=count>99?'99+':String(count);if(badge.textContent!==label)badge.textContent=label;badge.setAttribute('aria-label',count+' mensagens não lidas');
    }
  }
  async function refreshUnread() {
    const s=state(),uid=s.session?.user.id;if(!uid)return;
    const targets=[...s.channels.filter(c=>c.kind==='text'),...s.conversations.map(c=>({...c,private:true}))].slice(0,60);
    for(let index=0;index<targets.length;index+=4){await Promise.all(targets.slice(index,index+4).map(async target=>{
      const since=unread[target.id]?.seen,priorCount=unread[target.id]?.count;if(!since)return;
      const result=await s.db.from(target.private?'direct_messages':'messages').select('id',{head:true,count:'exact'}).eq(target.private?'conversation_id':'channel_id',target.id).neq('author_id',uid).gt('created_at',since);
      if(state().session?.user.id!==uid||unread[target.id]?.seen!==since||result.error)return;
      const count=unread[target.id]?.count!==priorCount?Math.max(result.count||0,unread[target.id]?.count||0):result.count||0;
      unread[target.id]={...unread[target.id],count};
    }));if(state().session?.user.id!==uid)return;}
    saveUnread();markRead();decorateNavigation();
  }

  async function sessionChanged() {
    const s = state(), uid = s.session?.user.id;
    runTimers();if (uid === subscribedUser) return;
    const version=++sessionVersion,oldInbox=inbox,oldTyping=typing;inbox=typing=null;subscribedUser=uid;closePanel();clearTimeout(retryPush);seenActivity.clear();typingUsers.clear();unread={};
    await Promise.all([oldInbox,oldTyping].filter(Boolean).map(channel=>s.db.removeChannel(channel)));
    if(version!==sessionVersion)return;
    if(uid)syncNotificationPreferences(s.db,uid).catch(()=>{});
    if (!uid) { const push = await registration?.pushManager?.getSubscription(); await push?.unsubscribe(); return; }
    try { unread = JSON.parse(localStorage.getItem('orbita-unread-' + uid) || '{}'); } catch { unread = {}; }
    for (const target of [...s.channels, ...s.conversations]) unread[target.id] ||= {count:0, seen:new Date().toISOString()};
    inbox = s.db.channel('user:' + uid, {config:{private:true}}).on('broadcast', {event:'activity'}, ({payload}) => notifyActivity(payload).catch(() => {}))
      .on('postgres_changes',{event:'*',schema:'public',table:'community_moderation',filter:'user_id=eq.'+uid},payload=>context.moderationChanged(payload.new).catch(report));
    inbox.subscribe(status => { if (status === 'SUBSCRIBED') refreshUnread().catch(() => {}); });
    await channelChanged();
    const params = new URLSearchParams(location.search), channel = params.get('channel'), dm = params.get('dm');
    if (channel) { const found = state().channels.find(c => c.id === channel); if (found) await context.selectChannel(found); }
    else if (dm) { const found = state().conversations.find(c => c.id === dm); if (found) await context.openConversation(found); }
    dispatchPush();
  }
  async function channelChanged() {
    const version=++channelVersion;closePanel();typingUsers.clear();renderTyping();
    const s=state(),previous=typing;typing=null;if(previous)await s.db.removeChannel(previous);
    if(version!==channelVersion||!s.session||!s.selected||s.selected.kind!=='text'||s.home)return;
    const scope=s.selected.id,uid=s.session.user.id;
    typing=s.db.channel('orbita:'+(s.selected.private?'direct:':'channel:')+scope,{config:{private:true,broadcast:{self:false}}});
    typing.on('broadcast',{event:'typing'},({payload})=>{
      if(version!==channelVersion||state().selected?.id!==scope||state().session?.user.id!==uid||payload?.user===uid||typeof payload?.user!=='string')return;
      const p=state().people.find(p=>p.id===payload.user);if(!p)return;
      typingUsers.set(p.id,{name:p.display_name,until:Date.now()+5000});renderTyping();
    }).subscribe();markRead();
  }
  function renderTyping() {
    for (const [id,p] of typingUsers) if (p.until < Date.now()) typingUsers.delete(id);
    const names = [...typingUsers.values()].slice(0,3).map(p=>p.name), bar = $('typing-bar');
    bar.hidden=names.length===0;const text=names.length?names.join(', ')+(names.length===1?' está digitando…':' estão digitando…'):'';if($('typing-text').textContent!==text)$('typing-text').textContent=text;
  }
  let typingInterval,datesInterval;
  function runTimers(){clearInterval(typingInterval);clearInterval(datesInterval);if(document.hidden||!state().session)return;typingInterval=setInterval(()=>{if(typingUsers.size)renderTyping();},1500);datesInterval=setInterval(()=>{for(const time of document.querySelectorAll('time[datetime]')){const text=relativeTime(time.dateTime);if(time.textContent!==text)time.textContent=text;}},60000);}
  $('message-input').addEventListener('input', () => {
    if (typing && $('message-input').value.trim() && Date.now()-lastTyped>2000) { lastTyped=Date.now(); typing.send({type:'broadcast',event:'typing',payload:{user:state().session.user.id}}).catch(()=>{}); }
    showMentions();
  });
  function activeAgain() { if(!state().session)return;if (idle) { idle=false; context.publishPresence().catch(()=>{}); } clearTimeout(idleTimer); idleTimer=setTimeout(()=>{idle=true;context.publishPresence().catch(()=>{});},300000); }
  for (const event of ['pointerdown','keydown','touchstart']) document.addEventListener(event,activeAgain,{passive:true}); activeAgain();
  function presenceStatus() { const status=state().profile?.presence_status||'online';if(status!=='invisible'&&isQuiet(state().session?.user.id))return 'dnd';return status==='online'&&idle?'idle':status; }

  let panelReturnFocus;
  function openPanel(title, kind) {
    const invoker=document.activeElement;closePanel(false);panelReturnFocus=invoker; panelKind=kind;panel=el('aside','feature-panel');panel.setAttribute('aria-label',title);panel.setAttribute('role','region');
    const header=el('header','feature-panel-header'),heading=el('h2','',title),close=button('×',closePanel,'feature-close');close.setAttribute('aria-label','Fechar '+title);header.append(heading,close);
    const content=el('div','feature-panel-content');panel.append(header,content);$('app-view').append(panel);close.focus();return content;
  }
  function closePanel(restore=true) {const wasOpen=!!panel;panel?.remove();panel=null;panelKind=null;threadRoot=null;threadTarget=null;threadVersion++;searchVersion++;remoteSearch=false;if(wasOpen&&restore)focusElement(panelReturnFocus,$('message-input'));}
  function compactMessage(message) {
    const article=el('article','thread-message'),p=state().people.find(p=>p.id===message.author_id)||message.profiles||{};
    article.dataset.messageId=message.id;article.append(el('strong','',p.display_name||'Participante'),el('time','muted',relativeTime(message.created_at)),context.richText(message.content));
    article.orbitaMessage=message;
    if(message.attachments){const a=message.attachments;if(a.mime_type?.startsWith('image/')){const image=el('img','attachment-preview');image.alt=a.name;image.loading='lazy';reserveImage(image);context.resolveAttachmentUrl(a).then(url=>image.src=url).catch(()=>image.remove());article.append(image);}else if(a.mime_type?.startsWith('video/')){const video=watchUploadedVideo(el('video'));video.setAttribute('aria-label','Vídeo: '+a.name);article.append(video);context.resolveAttachmentUrl(a).then(url=>{if(video.isConnected)video.src=url;}).catch(()=>video.remove());}article.append(button('↓ '+a.name,()=>context.downloadAttachment(a),'file-card'));}
    const actions=el('div','message-actions');actions.append(button('Responder',()=>{closePanel();context.replyToMessage(message);},'tiny-button'));
    if(message.author_id===state().session.user.id)actions.append(button('Editar',()=>context.messageAction(message,'edit'),'tiny-button'));
    if(message.author_id===state().session.user.id||(!state().selected?.private&&context.hasPermission('manage_messages')))actions.append(button('Excluir',()=>context.messageAction(message,'delete'),'tiny-button'));
    article.append(actions);return article;
  }
  async function openThread(message) {
    const s=state(),target={...s.selected},rootId=message.thread_root||message.id,root=message.thread_root?await checked(s.db.from(target.private?'direct_messages':'messages').select(context.messageFields).eq('id',rootId).single()):message;
    const content=openPanel('Thread', 'thread');threadRoot=rootId;threadTarget=target;const version=threadVersion;
    content.append(compactMessage(root),el('hr'));
    const list=el('div','thread-replies');content.append(list);
    const more=button('Carregar mais respostas',()=>loadThread(false));more.hidden=true;threadMore=more;content.append(more);
    const form=el('form','thread-form'),input=el('textarea');input.maxLength=4000;input.rows=2;input.placeholder='Responder nesta thread';input.setAttribute('aria-label','Resposta na thread');
    const send=el('button','primary','Responder');send.type='submit';form.append(input,send);panel.append(form);
    form.onsubmit=async event=>{event.preventDefault();if(!input.value.trim()||version!==threadVersion)return;send.disabled=true;try{await checked(s.db.from(target.private?'direct_messages':'messages').insert({[target.private?'conversation_id':'channel_id']:target.id,author_id:s.session.user.id,content:input.value.trim(),thread_root:rootId}));input.value='';dispatchPush();await loadThread(true);}catch(error){report(error);}finally{send.disabled=false;}};
    threadCursor=null;await loadThread(true);
  }
  async function loadThread(reset) {
    if(panelKind!=='thread'||!threadTarget)return;
    const version=threadVersion,request=++threadReadVersion,target=threadTarget,root=threadRoot,list=panel.querySelector('.thread-replies');
    let query=state().db.from(target.private?'direct_messages':'messages').select(context.messageFields).eq('thread_root',root).order('created_at').order('id').limit(80);
    if(!reset&&threadCursor)query=query.or(`created_at.gt.${threadCursor.created_at},and(created_at.eq.${threadCursor.created_at},id.gt.${threadCursor.id})`);
    const result=await checked(requestWithDeadline(query));if(version!==threadVersion||request!==threadReadVersion)return;
    if(reset)list.replaceChildren();const batch=document.createDocumentFragment();for(const m of result)batch.append(compactMessage(m));list.append(batch);threadCursor=result.at(-1)||threadCursor;threadMore.hidden=result.length<80;
  }

  let searchModule,searchTask;
  async function showSearch(initial=''){const uid=state().session?.user.id,target=state().selected?.id;try{if(!searchTask)searchTask=import('./message-search.js').then(module=>searchModule=module.initMessageSearch({...context,openPanel,closePanel,report,openThread,panelKind:()=>panelKind})).catch(error=>{searchTask=null;throw error;});await searchTask;if(state().session?.user.id===uid&&state().selected?.id===target)searchModule.showSearch(initial);}catch(error){report(error);}}
  $('search-messages').oninput=()=>{}; // Searching no longer filters only the last loaded page.
  $('search-messages').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();showSearch(event.currentTarget.value);}};
  $('btn-search-toggle').onclick=()=>showSearch($('search-messages').value);

  function showMentions() {
    const input=$('message-input'),prefix=input.value.slice(0,input.selectionStart),match=prefix.match(/(?:^|\s)@([a-z0-9_]*)$/i),popup=$('autocomplete-popover');
    popup.replaceChildren();if(!match){popup.classList.add('hidden');return;}
    const users=state().people.filter(p=>p.username?.startsWith(match[1].toLowerCase())).slice(0,6);
    for(const p of users){const b=button(p.display_name+' · @'+p.username,()=>{const start=input.selectionStart-match[1].length-1;input.setRangeText('@'+p.username+' ',start,input.selectionStart,'end');popup.classList.add('hidden');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});b.onmousedown=event=>event.preventDefault();popup.append(b);}
    popup.classList.toggle('hidden',!users.length);
  }
  $('message-input').addEventListener('keydown',event=>{const popup=$('autocomplete-popover');if(!popup.classList.contains('hidden')&&event.key==='Tab'){event.preventDefault();popup.querySelector('button')?.click();}if(event.key==='Escape')popup.classList.add('hidden');});

  let uploading=false;
  async function sendFiles(files) {
    const target={...state().selected},root=panelKind==='thread'&&threadTarget?.id===state().selected?.id?threadRoot:null;if(!state().session||target.kind!=='text')return toast('Abra um canal de texto ou uma DM para anexar arquivos.');
    if(!files.length)return;if(uploading)return toast('Aguarde o envio atual terminar.');
    if(files.length>5)return toast('Envie até cinco arquivos por vez.');
    const sender=state().session.user.id;uploading=true;$('attach-file').disabled=true;
    try{for(const file of files){toast('Preparando '+file.name+'…');if(state().session?.user.id!==sender)throw Error('Sua conta mudou; envio cancelado.');const a=await context.uploadFile(file,target);try{if(state().session?.user.id!==sender)throw Error('Sua conta mudou; envio cancelado.');await checked(state().db.from(target.private?'direct_messages':'messages').insert({[target.private?'conversation_id':'channel_id']:target.id,author_id:sender,content:'📎 '+a.name,attachment_id:a.id,thread_root:root}));}catch(error){await state().db.from('attachments').delete().eq('id',a.id);await state().db.storage.from('orbita-files').remove([a.storage_path]);throw error;}}
      if(state().selected?.id===target.id)await context.refreshMessages();if(root&&threadRoot===root)await loadThread(true);dispatchPush();toast('Arquivo enviado.');
    }catch(error){report(error);}finally{uploading=false;$('attach-file').disabled=false;}
  }
  document.addEventListener('paste',event=>{if(!state().session||!event.target.closest('#text-view,.thread-form'))return;const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();sendFiles(files);}});
  let dragCount=0;const drop=el('div','file-drop-zone','Solte seus arquivos para enviar');drop.hidden=true;document.body.append(drop);
  document.addEventListener('dragenter',event=>{if(state().session&&!document.querySelector('#feed-view:not([hidden])')&&[...(event.dataTransfer?.types||[])].includes('Files')){dragCount++;drop.hidden=false;}});
  document.addEventListener('dragover',event=>{if([...(event.dataTransfer?.types||[])].includes('Files'))event.preventDefault();});
  document.addEventListener('dragleave',()=>{if(--dragCount<=0)drop.hidden=true;});
  document.addEventListener('drop',event=>{if(document.querySelector('#feed-view:not([hidden])')){event.preventDefault();dragCount=0;drop.hidden=true;return;}if(!state().session||!event.dataTransfer?.files.length)return;event.preventDefault();dragCount=0;drop.hidden=true;sendFiles([...event.dataTransfer.files]);});
  function showMediaPicker() {showDialog('GIFs e stickers',container=>{
    container.append(el('p','muted','Envie uma animação do dispositivo, um link direto HTTPS de GIF ou uma figurinha da Órbita.'));
    container.append(button('Enviar GIF ou imagem',()=>{$('app-dialog').close();$('file-input').accept='image/*';$('file-input').click();}));
    const grid=el('div','sticker-picker');for(const name of stickerNames){const b=button('',()=>{context.insertText(' [[sticker:'+name+']] ');$('app-dialog').close();$('message-input').focus();});const image=el('img');image.src='/static/stickers/'+name+'.svg';image.alt='Sticker '+name;b.setAttribute('aria-label','Inserir sticker '+name);b.append(image);grid.append(b);}container.append(grid);
    const form=el('form'),input=inputField(form,'Link HTTPS direto para GIF ou WebP','',1200),save=el('button','primary','Inserir GIF');save.type='submit';form.append(save);container.append(form);
    form.onsubmit=event=>{event.preventDefault();const url=safeLink(input.value.trim());if(!url||!/^\/(?:.*)\.(gif|webp|png)$/i.test(url.pathname))return toast('Use um link HTTPS direto que termine em GIF, WebP ou PNG.');context.insertText(' '+url.href);$('app-dialog').close();$('message-input').focus();};
  });}

  function enhanceMessage(article,message) {
    article.dataset.messageId=message.id;const actions=article.querySelector('.message-actions');
    actions?.append(button('Thread',()=>openThread(message),'tiny-button'),button('Copiar link',async()=>{const url=new URL(location.origin);url.searchParams.set(state().selected.private?'dm':'channel',state().selected.id);url.searchParams.set('message',message.id);await navigator.clipboard.writeText(url.href);toast('Link da mensagem copiado.');},'tiny-button'));
    if(message.author_id!==state().session.user.id)actions?.append(button('Denunciar',()=>reportMessage(message,{...state().selected}),'tiny-button'));
    if(message.edited_at)article.querySelector('.message-meta')?.append(el('small','muted','(editada)'));
    const body=article.querySelector('.message-content');
    const urlText=message.content.match(/https:\/\/[^\s<>]+/)?.[0],url=safeLink(urlText);
    if(url&&body&&!article.querySelector('.link-preview')){const link=el('a','link-preview');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';const id=youtubeId(url.href);if(id){const image=el('img');image.src='https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';image.alt='Miniatura do vídeo no YouTube';image.loading='lazy';reserveImage(image,320,180);image.referrerPolicy='no-referrer';link.append(image);}link.append(el('strong','',id?'Vídeo no YouTube':url.hostname),el('span','muted',url.pathname.slice(0,100)||'Abrir link'));body.append(link);import('./link-preview.js').then(module=>module.enhanceLinkPreview(link,url,state().db)).catch(()=>{});}
  }
  async function messageReceived(message,target) {if(panelKind==='thread'&&threadTarget?.id===target.id&&(message.thread_root===threadRoot||message.id===threadRoot))await loadThread(true);}
  async function messageDeleted(id,target){if(panelKind!=='thread'||threadTarget?.id!==target.id)return;if(threadRoot===id){closePanel();toast('Esta thread foi removida.');}else if(panel.querySelector('[data-message-id="'+CSS.escape(id)+'"]'))await loadThread(true);}
  async function historyLoaded(){
    const params=new URLSearchParams(location.search),id=params.get('message'),s=state(),target=s.selected;
    if(!id||!/^[0-9a-f-]{36}$/i.test(id)||!target||target.kind!=='text'||focusedLink===target.id+id)return;
    const scope=params.get(target.private?'dm':'channel');if(scope!==target.id)return;
    focusedLink=target.id+id;
    const result=await s.db.from(target.private?'direct_messages':'messages').select(context.messageFields).eq('id',id).eq(target.private?'conversation_id':'channel_id',target.id).maybeSingle();
    if(result.error||!result.data||state().selected?.id!==target.id)return;
    if(result.data.thread_root)await openThread(result.data);else context.revealMessage(result.data);
  }

  function reportMessage(message,target){const uid=state().session.user.id;showDialog('Denunciar mensagem',box=>{box.append(el('p','muted','Uma cópia desta mensagem e seus anexos será enviada à moderação. O restante da conversa continua privado.'));const reason=inputField(box,'Motivo da denúncia','',500);reason.minLength=5;box.append(button('Enviar denúncia',async()=>{if(state().session?.user.id!==uid)throw Error('Sua conta mudou.');if(reason.value.trim().length<5)throw Error('Descreva o motivo com pelo menos 5 caracteres.');try{await checked(state().db.from('safety_reports').insert({reporter_id:uid,target_kind:target.private?'dm':'message',target_id:message.id,reason:reason.value.trim()}));}catch(error){if(error.code==='23505')throw Error('Você já denunciou esta mensagem.');throw error;}$('app-dialog').close();toast('Denúncia enviada à administração.');},'primary'));});}
  function showReports(){const uid=state().session?.user.id;showDialog('Denúncias de mensagens',box=>{checked(state().db.from('message_reports').select('*').eq('resolved',false).order('created_at',{ascending:false}).limit(50)).then(rows=>{if(!box.isConnected||state().session?.user.id!==uid)return;if(!rows.length)box.append(el('p','muted','Nenhuma denúncia pendente.'));for(const row of rows){const item=el('article','audit-entry');item.append(el('p','',row.reason),el('small','muted',row.direct_message_id?'Mensagem privada: conteúdo protegido pelas permissões da conversa.':'Mensagem de canal'),button('Resolver denúncia',async()=>{await checked(state().db.from('message_reports').update({resolved:true}).eq('id',row.id));item.remove();}));box.append(item);}}).catch(report);});}
  function showModeration() {
    if(!context.hasPermission('manage_members'))return toast('Seu cargo não permite moderar membros.');
    showDialog('Moderação do servidor',container=>{
      const form=el('form'),select=el('select');select.setAttribute('aria-label','Membro a moderar');
      for(const p of state().people){const option=el('option','',p.display_name+' · @'+p.username);option.value=p.id;select.append(option);}form.append(select);
      const action=el('select');action.setAttribute('aria-label','Ação de moderação');for(const [key,label]of[['timeout','Silenciar por tempo'],['untimeout','Remover silêncio'],['ban','Banir do servidor'],['unban','Remover banimento']]){const option=el('option','',label);option.value=key;action.append(option);}form.append(action);
      const minutes=inputField(form,'Duração do silêncio em minutos','10',5);minutes.type='number';minutes.min='1';minutes.max='40320';
      const reason=inputField(form,'Motivo (visível no registro de auditoria)','',500),save=el('button','danger','Revisar ação');save.type='submit';form.append(save);container.append(form);
      form.onsubmit=event=>{event.preventDefault();const member=select.value,name=select.selectedOptions[0]?.textContent,body={member,action:action.value,minutes:Number(minutes.value)||10,reason:reason.value};showDialog('Confirmar moderação',box=>{box.append(el('p','','Aplicar “'+action.selectedOptions[0].textContent+'” a '+name+'?'),el('p','muted',body.reason||'Sem motivo informado.'),button('Confirmar',async()=>{const result=await jsonPost('/api/communities/'+state().activeCommunity+'/moderate',body);$('app-dialog').close();toast(result.warning||'Ação aplicada e registrada.');},'danger'));});};
      container.append(button('Registro de auditoria',showAudit));
      checked(state().db.from('community_moderation').select('*').eq('community_id',state().activeCommunity).order('updated_at',{ascending:false}).limit(50)).then(rows=>{if(!rows.length)return;container.append(el('h3','','Restrições recentes'));for(const row of rows){const p=state().people.find(p=>p.id===row.user_id);container.append(el('p','',`${p?.display_name||row.user_id} · ${row.banned?'Banido':row.timeout_until&&new Date(row.timeout_until)>new Date()?'Silenciado até '+new Date(row.timeout_until).toLocaleString('pt-BR'):'Sem restrição ativa'}`));}}).catch(report);
    });
  }
  function showAudit(){showDialog('Registro de auditoria',container=>{container.append(el('p','muted','Carregando…'));checked(state().db.from('audit_log').select('*').eq('community_id',state().activeCommunity).order('created_at',{ascending:false}).limit(100)).then(rows=>{container.replaceChildren();if(!rows.length)container.append(el('p','muted','Nenhuma ação registrada.'));for(const row of rows){const actor=state().people.find(p=>p.id===row.actor_id),target=state().people.find(p=>p.id===row.target_id),item=el('article','audit-entry');item.append(el('strong','',row.action),el('p','',`${actor?.display_name||'Conta removida'} → ${target?.display_name||'mensagem'} · ${relativeTime(row.created_at)}`),el('p','muted',row.reason));container.append(item);}}).catch(report);});}

  async function syncWakeLock() {
    const wants=state().room?.state==='connected'&&!document.hidden&&readSetting('wake-lock','true')!=='false';
    if(!wants){await wakeLock?.release().catch(()=>{});wakeLock=null;return;}
    if(wakeRequest||(wakeLock&&!wakeLock.released))return;
    if('wakeLock'in navigator){wakeRequest=true;try{const lock=await navigator.wakeLock.request('screen');if(state().room?.state!=='connected'||document.hidden||readSetting('wake-lock','true')==='false'){await lock.release();return;}wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}catch{}finally{wakeRequest=false;}}
  }
  function decorateVideo(video,caption) {
    if(!document.pictureInPictureEnabled||typeof video.requestPictureInPicture!=='function')return;
    caption.append(button('Vídeo flutuante',async()=>{try{if(document.pictureInPictureElement===video)await document.exitPictureInPicture();else await video.requestPictureInPicture();}catch{toast('Inicie a reprodução do vídeo antes de abrir a janela flutuante.');}},'expand-video'));
  }
  function voiceAction(participant,action){const target=state().callChannel;if(!target||target.private)return;showDialog('Confirmar controle de voz',container=>{container.append(el('p','','Aplicar “'+({mute:'silenciar microfone',speaker:'promover a orador',audience:'mover para plateia',kick:'desconectar'}[action])+'” a '+(participant.name||'participante')+'?'),button('Confirmar',async()=>{await jsonPost('/api/channels/'+target.id+'/voice-action',{member:participant.identity,action});$('app-dialog').close();toast('Controle de voz aplicado.');},'primary'));});}
  function callUpdated() {
    document.body.classList.toggle('call-connected',!!state().room);
    syncWakeLock();const s=state();
    if(s.room?.state!=='connected')return;
    const cards=$('participants').querySelectorAll('.participant');
    const peers=[s.room.localParticipant,...s.room.remoteParticipants.values()];
    if(!s.callChannel.private&&s.room.orbitaModerator)for(let i=0;i<peers.length;i++){const p=peers[i];if(p.isLocal||cards[i]?.querySelector('.voice-moderation'))continue;const controls=el('div','voice-moderation');controls.append(button('Silenciar',()=>voiceAction(p,'mute'),'tiny-button'),button('Desconectar',()=>voiceAction(p,'kick'),'tiny-button'));if(s.room.orbitaStage)controls.append(button('Orador',()=>voiceAction(p,'speaker'),'tiny-button'),button('Plateia',()=>voiceAction(p,'audience'),'tiny-button'));cards[i]?.append(controls);}
  }
  function connected(connected,events,rights){
    connected.orbitaModerator=!!rights.moderator;connected.orbitaStage=!!rights.stage;watchJoined=connected;loadWatch().then(instance=>{if(watchJoined===connected&&state().room===connected)instance.connected(connected,events);}).catch(report);
    connected.on(events.DataReceived,(bytes,participant,_kind,topic)=>{if(topic!=='orbita-sound'||!participant||connected.remoteParticipants.get(participant.identity)!==participant||participant.permissions?.canPublish===false||bytes.length>2048)return;let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return;}if(!data||!SOUND_EFFECTS.includes(data.effect))return;const last=lastSound.get(participant.identity)||0;if(Date.now()-last<2500)return;lastSound.set(participant.identity,Date.now());audio(data.effect);});
    connected.on(events.ParticipantConnected,()=>audio('join'));connected.on(events.ParticipantDisconnected,()=>audio('leave'));
    audio('join');syncWakeLock();
  }
  function callEnded(previous){if(!previous)return;audio('leave');wakeLock?.release().catch(()=>{});wakeLock=null;watchJoined=null;watch?.ended();lastSound.clear();}
  async function publish(topic,value){const r=state().room;if(r?.state!=='connected')throw Error('Entre em uma chamada primeiro.');if(topic==='orbita-sound'&&r.localParticipant.permissions?.canPublish===false)throw Error('Peça a um moderador para falar antes de usar os efeitos.');await r.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(value)),{reliable:true,topic});}
  const showWatch=async()=>{const instance=await loadWatch();return instance.show();};

  document.querySelectorAll('[data-sfx]').forEach(b=>b.onclick=async()=>{const effect=b.dataset.sfx,last=lastSound.get('self')||0;if(Date.now()-last<2500)return;lastSound.set('self',Date.now());audio(effect);try{await publish('orbita-sound',{effect});}catch(error){report(error);}});

  // Touch gestures only activate on clear horizontal intent, preserving vertical scroll.
  let gesture;
  document.addEventListener('touchstart',event=>{if(event.touches.length!==1||event.target.closest('input,textarea,button,a,video,select'))return;const t=event.touches[0];gesture={x:t.clientX,y:t.clientY,item:event.target.closest('article[data-message-id]'),sidebar:!!event.target.closest('.sidebar,.rail')};},{passive:true});
  document.addEventListener('touchmove',event=>{if(!gesture||event.touches.length!==1)return;const t=event.touches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;if(Math.abs(dy)>35&&Math.abs(dy)>Math.abs(dx)){gesture=null;return;}if(gesture.item&&dx>25&&Math.abs(dx)>Math.abs(dy)*1.5){event.preventDefault();gesture.item.style.transform=`translateX(${Math.min(dx,85)}px)`;}},{passive:false});
  function finishGesture(event){if(!gesture)return;const g=gesture;gesture=null;g.item?.style.removeProperty('transform');const t=event.changedTouches?.[0];if(!t)return;const dx=t.clientX-g.x,dy=t.clientY-g.y;if(Math.abs(dy)>55)return;if(g.item&&dx>75){const message=state().messages.get(g.item.dataset.messageId)||g.item.orbitaMessage;if(message)context.replyToMessage(message);}else if(g.x<28&&dx>65){document.body.classList.add('mobile-menu-open');document.querySelectorAll('.mobile-nav-btn').forEach(b=>b.setAttribute('aria-expanded','true'));}else if(g.sidebar&&dx<-65)context.closeMobileMenu();}
  document.addEventListener('touchend',finishGesture,{passive:true});document.addEventListener('touchcancel',()=>{gesture?.item?.style.removeProperty('transform');gesture=null;},{passive:true});
  let viewportFrame;function viewport(){if(viewportFrame)return;viewportFrame=requestAnimationFrame(()=>{viewportFrame=null;document.documentElement.style.setProperty('--app-viewport',(window.visualViewport?.height||window.innerHeight)+'px');});}
  let channelStatus='idle';const offline=el('div','network-notice');offline.setAttribute('role','status');document.querySelector('#text-view .chat-header').after(offline);
  function realtimeChanged(value){channelStatus=value;connectionState();}
  function connectionState(){const offlineNow=!navigator.onLine,retrying=['connecting','reconnecting'].includes(channelStatus);offline.hidden=!offlineNow&&!retrying;offline.textContent=offlineNow?'Você está sem conexão. Seus rascunhos permanecem nesta aba.':channelStatus==='connecting'?'Conectando às mensagens em tempo real…':'Reconectando… Você pode continuar lendo as mensagens carregadas.';$('conn-label').textContent=offlineNow?'Sem conexão':channelStatus==='connected'?'Tempo real ativo':retrying?'Reconectando…':'Conexão disponível';document.body.classList.toggle('network-offline',offlineNow);}
  window.addEventListener('online',connectionState);window.addEventListener('offline',connectionState);connectionState();
  window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
  document.addEventListener('visibilitychange',()=>{runTimers();syncWakeLock();if(!document.hidden){markRead();activeAgain();const s=state();if(s.session)syncNotificationPreferences(s.db,s.session.user.id).catch(()=>{});}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel)closePanel();});
  let drawerInvoker;
  const drawerFocusables=()=>[...document.querySelectorAll('.rail button,.sidebar button,.sidebar input,.sidebar a')].filter(node=>!node.disabled&&node.getClientRects().length);
  function drawerChanged(){const open=document.body.classList.contains('mobile-menu-open')&&matchMedia('(max-width:780px)').matches;document.querySelector('.main').inert=open;document.querySelectorAll('.mobile-nav-btn,#mobile-menu-btn').forEach(node=>node.setAttribute('aria-expanded',String(open)));}
  new MutationObserver(drawerChanged).observe(document.body,{attributes:true,attributeFilter:['class']});
  document.addEventListener('click',event=>{const invoker=event.target.closest('.mobile-nav-btn,#mobile-menu-btn');if(invoker&&document.body.classList.contains('mobile-menu-open')){drawerInvoker=invoker;requestAnimationFrame(()=>drawerFocusables()[0]?.focus());}});
  document.addEventListener('keydown',event=>{
    if($('app-dialog').open)return;
    if(document.body.classList.contains('mobile-menu-open')&&matchMedia('(max-width:780px)').matches){
      if(event.key==='Escape'){event.preventDefault();context.closeMobileMenu();drawerChanged();focusElement(drawerInvoker,document.querySelector('.main>div:not([hidden]) .mobile-nav-btn'));return;}
      if(event.key==='Tab'){const nodes=drawerFocusables(),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||!nodes.includes(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}return;
    }
    if(event.key!=='Escape')return;
    for(const [popover,invoker]of [['attach-popover','btn-attach'],['emoji-popover','btn-emoji'],['autocomplete-popover','message-input'],['server-dropdown','server-header-btn'],['status-popover','up-profile-btn']]){
      const node=$(popover);if(node&&!node.classList.contains('hidden')){node.classList.add('hidden');$(invoker)?.setAttribute('aria-expanded','false');focusElement($(invoker),$('message-input'));}
    }
  });
  window.addEventListener('resize',()=>{if(!matchMedia('(max-width:780px)').matches)context.closeMobileMenu();drawerChanged();});
  function accessibility(root=document){
    const buttons=[...(root.matches?.('button')?[root]:[]),...root.querySelectorAll('button:not([aria-label])')];for(const b of buttons)if(b.title&&(!b.textContent.trim()||/^[×☰⋯＋▱]+$/.test(b.textContent.trim())))b.setAttribute('aria-label',b.title);
    for(const input of root.querySelectorAll('input:not([aria-label])'))if(!input.closest('label')&&input.placeholder)input.setAttribute('aria-label',input.placeholder);
  }
  let accessibilityFrame,historyDirty=false,observedSentinel;const addedRoots=new Set();
  const uiObserver=new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node instanceof Element)addedRoots.add(node);if(record.target===$('message-list')||$('message-list').contains(record.target))historyDirty=true;}
    if(!accessibilityFrame)accessibilityFrame=requestAnimationFrame(()=>{accessibilityFrame=null;for(const root of addedRoots)if(root.isConnected&&![...addedRoots].some(parent=>parent!==root&&parent.contains(root)))accessibility(root);addedRoots.clear();if(historyDirty){historyDirty=false;observeHistory();updateLatest();}});
  });uiObserver.observe($('app-view'),{childList:true,subtree:true});accessibility();
  if('IntersectionObserver'in window)historyObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!remoteSearch)context.loadMessages();},{root:$('message-list'),rootMargin:'160px 0px 0px 0px'});
  function observeHistory(){const more=$('message-list').querySelector('.load-more');if(more!==observedSentinel){historyObserver?.disconnect();observedSentinel=more;if(more)historyObserver?.observe(more);}}
  const options=button('Mais opções',()=>showDialog('Sua Órbita',container=>{container.append(button('Mensagens fixadas',()=>{$('app-dialog').close();$('pins-toggle').click();}),button('Buscar mensagens',()=>{$('app-dialog').close();showSearch($('search-messages').value);}),button('GIFs e stickers',showMediaPicker),button('Ouvir juntos',()=>{$('app-dialog').close();return showWatch();}),button('Moderação',showModeration),button('Auditoria',showAudit));preferenceFields(container);}), 'feature-options');
  options.title='Recursos, aparência e moderação';options.setAttribute('aria-label',options.title);document.querySelector('#text-view .chat-actions').append(options);
  document.querySelector('#voice-view .chat-actions').append(button('Ouvir juntos',showWatch,'feature-options'));
  const oldSettings=$('settings').onclick;$('settings').onclick=()=>{oldSettings();preferenceFields($('dialog-content'));};
  $('btn-notif-toggle').onclick=()=>enableNotifications().catch(report);
  const latest=button('↓ Mensagens recentes',()=>{$('message-list').scrollTo({top:$('message-list').scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.dataset.reduceMotion==='true'?'auto':'smooth'});},'jump-latest');latest.hidden=true;document.querySelector('.message-form-wrap').append(latest);
  function updateLatest(){const list=$('message-list');latest.hidden=list.scrollHeight-list.scrollTop-list.clientHeight<180;}
  $('message-list').addEventListener('scroll',updateLatest,{passive:true});new ResizeObserver(updateLatest).observe($('message-list'));
  document.addEventListener('click',event=>{for(const menu of document.querySelectorAll('.message-menu[open]'))if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){for(const menu of document.querySelectorAll('.message-menu[open]'))menu.open=false;}});
  const brand=$('friends-nav');brand.replaceChildren();const brandImage=el('img');brandImage.src='/static/icons/icon.svg';brandImage.alt='Órbita';reserveImage(brandImage,32,32);brand.append(brandImage);
  $('toast').setAttribute('role','status');$('toast').setAttribute('aria-live','polite');
  runTimers();
  return { setAudioOutput:id=>appSounds.setOutput(id),soundFields:box=>appSounds.fields(box,el,button),realtimeChanged, sessionChanged, channelChanged, enhanceMessage, decorateVideo, callUpdated, connected, callEnded, dispatchPush, messageReceived, messageDeleted, disablePush, decorateNavigation, presenceStatus, showMediaPicker, sendFiles, showReports, showModeration, showAudit, historyLoaded };
}
