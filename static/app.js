import {createAuthRecovery,isInvalidSessionError} from './auth-recovery.js';
import './ui-polish.js';
import {initSocialLogin} from './social-login.js';
import {initNavigationMotion} from './navigation-motion.js';
import {DECORATIONS} from './profile-decoration-catalog.js';
import {initShareReceiver} from './share-target.js';
import {initThemeAccessibility,foreground} from './theme-accessibility.js';
import {initAppUpdates} from './app-updates.js';
import {loadStyle} from './lazy-assets.js';
import {initAudioControls} from './audio-controls.js';
import {initCallReactions} from './call-reactions.js';
import { initCommunityUX } from './community-ux.js';
import { initCallLayout } from './call-layout.js';
import { watchUploadedVideo,setUploadedVideoOutput } from './uploaded-video.js';
import { compressImage, relativeTime, safeLink, stickerNames } from './media-utils.js';
import { initEnhancements } from './enhancements.js';
import { DraftStore, serialToggle } from './runtime-utils.js';
import { ConversationCache, MessageOutbox, conversationKey, requestWithDeadline } from './chat-state.js';
import { reconcileNodes, reserveImage, focusElement } from './dom-utils.js';
import { choosePrivateCall } from './private-call-menu.js';
let shareReceiver, enhancements, feed, callLayout, communityUX, audioTools, callReactions;
const drafts = new DraftStore(), pendingSends = new Set();
const draftKey = target => session && target ? session.user.id + ':' + (target.private ? 'dm:' : 'channel:') + target.id : '';
function saveComposerDraft() { if (!home && selected?.kind === 'text') drafts.set(draftKey(selected), $('message-input').value); }
let composerFrame;
function resizeComposer() {if(composerFrame)return;composerFrame=requestAnimationFrame(()=>{composerFrame=null;const input=$('message-input');input.style.height='auto';input.style.height=Math.max(26,Math.min(160,input.scrollHeight))+'px';});}
function insertComposer(text) { const input=$('message-input');input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus(); }
function updateComposer() { $('send').disabled=!navigator.onLine||pendingSends.has(draftKey(selected));resizeComposer(); }

const $ = id => document.getElementById(id);
let db, config, session, channels = [], selected, signup = false;
let subscription, generation = 0, messages = new Map(), oldest, hasMore = false, loading = false;
let voiceChat,voiceChatTask,diagnostics;
let room, callChannel, joining = false, shuttingDown = false, callJoin;
function cancelCallJoin() { callJoin?.abort(); callJoin=null; joining=false; }
let cameraFacing=localStorage.getItem('orbita-camera-facing')==='environment'?'environment':'user',cameraTask;
const cameraTrackFacing=new WeakMap();
const mobileCamera=()=>matchMedia('(max-width:780px), (pointer:coarse)').matches;
let pushToTalk=localStorage.getItem('orbita-push-to-talk')==='true',talkHeld=false,pttButton;
// Metas de qualidade: o navegador e o LiveKit podem reduzir conforme o dispositivo e a rede.
const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
function mediaMode(){
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  const slow=/^(slow-2g|2g|3g)$/.test(connection?.effectiveType||'');
  const lowPower=(navigator.deviceMemory||4)<=2;
  if(connection?.saveData||slow||lowPower)return 'economia';
  if(matchMedia('(max-width:780px), (pointer:coarse)').matches)return 'equilibrada';
  return 'alta';
}
function mediaSettings(){
  const mode=mediaMode(),screenAudio=localStorage.getItem('orbita-screen-audio')!=='false';
  const profile=mode==='economia'
    ? {camera:[640,360,20,650_000],screen:[1280,720,15,1_400_000]}
    : mode==='equilibrada'
      ? {camera:[1280,720,24,1_600_000],screen:[1600,900,24,2_500_000]}
      : {camera:[1280,720,30,2_500_000],screen:[1920,1080,30,4_000_000]};
  const [cw,ch,cf,cb]=profile.camera,[sw,sh,sf,sb]=profile.screen;
  return {
    cameraCapture:{resolution:{width:cw,height:ch,frameRate:cf},facingMode:mobileCamera()?{exact:cameraFacing}:{ideal:cameraFacing}},
    cameraPublish:{videoEncoding:{maxBitrate:cb,maxFramerate:cf},degradationPreference:'balanced'},
    screenCapture:{resolution:{width:sw,height:sh,frameRate:sf},contentHint:'detail',audio:screenAudio,systemAudio:screenAudio?'include':'exclude',surfaceSwitching:'include'},
    screenPublish:{screenShareEncoding:{maxBitrate:sb,maxFramerate:sf},degradationPreference:'maintain-resolution'},
    mode,
  };
}
function closeMobileMenu(){
  document.body.classList.remove('mobile-menu-open');
  $('mobile-menu-btn')?.setAttribute('aria-expanded','false');
  document.querySelectorAll('.mobile-nav-btn').forEach(menu=>menu.setAttribute('aria-expanded','false'));
}
let toastTimer;
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500);
}
function el(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}
function initials(name) { return [...(name || '?').trim()].slice(0, 2).join('').toUpperCase(); }
function errorText(error) {
  if(error?.name==='TimeoutError')return 'A conexão demorou demais. Tente novamente.';
  if (error?.name === 'NotAllowedError') return 'Permissão recusada. Autorize o dispositivo no navegador.';
  if (error?.name === 'NotFoundError') return 'Nenhum dispositivo compatível foi encontrado.';
  if (error?.message === 'Invalid login credentials') return 'E-mail ou senha incorretos.';
  if(error?.message==='Database error saving new user')return 'Não foi possível criar a conta. Tente outro nickname; ele pode já estar em uso.';
  if (error?.message === 'Email not confirmed') return 'Confirme seu e-mail antes de entrar.';
  return error?.message || 'Não foi possível concluir. Tente novamente.';
}

$('toggle-auth').onclick = () => {
  signup = !signup; $('name-label').hidden = !signup; $('display-name').required = signup;$('display-name').disabled=!signup;
  $('auth-title').textContent = signup ? 'Sua galera espera você.' : 'Bom ter você aqui.';
  $('auth-description').textContent = signup ? 'Crie uma conta e entre na conversa.' : 'Entre para encontrar a sua galera.';
  $('auth-submit').textContent = signup ? 'Criar minha conta ↗' : 'Entrar na Órbita ↗';
  $('toggle-auth').textContent = signup ? 'Já tem conta? Entre aqui' : 'Ainda não tem conta? Cadastre-se';
  $('password').autocomplete = signup ? 'new-password' : 'current-password'; $('auth-status').textContent = '';
};
$('auth-form').onsubmit = async event => {
  event.preventDefault(); if (!db) return;
  $('auth-submit').disabled = true; $('auth-status').textContent = '';
  try {
    if(signup&&!/^[A-Za-z0-9_]{3,24}$/.test($('display-name').value.trim()))throw Error('Escolha um nickname de 3 a 24 letras, números ou _.');
    const credentials = {email: $('email').value.trim(), password: $('password').value};
    const {data, error} = signup
      ? await db.auth.signUp({...credentials, options: {data: {display_name: $('display-name').value.trim()}}})
      : await db.auth.signInWithPassword(credentials);
    if (error) throw error;
    $('password').value = '';
    if (!data.session) $('auth-status').textContent = 'Confira seu e-mail para confirmar o cadastro. Depois, entre na sua conta.';
  } catch (error) { $('auth-status').textContent = errorText(error); }
  finally { $('auth-submit').disabled = false; }
};

let sessionTransition=0,sessionReady=false,sessionInitializing=false;
async function showSession(next) {
  diagnostics?.sync();
  if(!next){
    $('auth-view').hidden=false;$('app-view').hidden=true;$('app-dialog').close();closeMobileMenu();
    document.body.classList.remove('big-picture','call-focus','call-navigation-open');document.querySelector('.bp-bar')?.remove();
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    setEntryBusy(false);
  }
  if(session?.user.id===next?.user.id&&next&&(sessionReady||sessionInitializing)){session=next;return;}
  cancelCallJoin();
  feed?.sessionChanged();
  sessionInitializing=!!next;sessionReady=false;sessionRecovery.hidden=true;setEntryBusy(!!next);
  const previousUser=session?.user.id,transition=++sessionTransition;
  stopConversation();generation++;
  if(previousUser&&previousUser!==next?.user.id){
    // Close old-account dialogs before any asynchronous cleanup or profile loading.
    $('app-dialog').close();closeMobileMenu();
    session=null;$('app-view').hidden=true;$('message-list').replaceChildren();
    const old=[socialSubscription,presenceChannel,extraSubscription];socialSubscription=presenceChannel=extraSubscription=null;
    await leaveCall();await Promise.all(old.filter(Boolean).map(channel=>db.removeChannel(channel).catch(()=>{})));await enhancements?.sessionChanged();
    if(transition!==sessionTransition)return;
  }
  session = next;
  if(next){const pending=sessionStorage.getItem('orbita-oauth-return');if(pending){const target=new URL(location.href);for(const [key,value]of new URLSearchParams(pending))if(['invite','post','profile','channel','dm','message','story'].includes(key))target.searchParams.set(key,value);history.replaceState(null,'',target);sessionStorage.removeItem('orbita-oauth-return');}}
  conversationCache.clear();outbox.clear();communityViews.clear();channelNodes.clear();voiceTrees.clear();memberNodes.clear();communityNodes.clear();lastViewport=null;
  welcomeAccess.clear();drafts.useAccount(next?.user.id,localStorage);pendingSends.clear();$('message-input').value='';
  people=[];peopleById.clear();peopleByUsername.clear();profileMediaUrls.clear();friendships=[];conversations=[];profile=null;selected=null;channels=[];messages.clear();communities=[];siteRoles=[];communityRoleList=[];memberRoles=[];communityMemberList=[];communityEmojiList=[];communityEmojiUrls.clear();online.clear();publicVoicePresence=[];lastPresenceSignature='';home=false;voiceChat?.update();
  for(const id of ['message-list','text-channels','voice-channels','member-list','dm-channels','rail-servers-list'])$(id).replaceChildren();
  attachmentUrls.clear();messageRows.clear();renderedScope='';
  $('auth-view').hidden = !!next; $('app-view').hidden = !next;
  if (!next) {
    $('app-dialog').close();closeMobileMenu();$('incoming-call').hidden=true;
    generation++; if (subscription) { db.removeChannel(subscription); subscription = null; }
    await leaveCall();
    for(const channel of [socialSubscription,presenceChannel,extraSubscription])if(channel)db.removeChannel(channel);
    people=[];peopleById.clear();peopleByUsername.clear();profileMediaUrls.clear();friendships=[];conversations=[];profile=null;selected=null;channels=[];messages.clear();$('message-list').replaceChildren();sessionInitializing=false;await enhancements?.sessionChanged();return;
  }
  const name = next.user.user_metadata?.display_name || 'Participante';
  $('user-name').textContent = name;setAvatar($('user-avatar'),{id:next.user.id,display_name:name,avatar_color:'#8b80ff'});
  try {
    // Cria o vínculo padrão antes da primeira consulta de canais protegida por RLS.
    await initSocial();
    if (!session || session.user.id !== next.user.id||transition!==sessionTransition) return;
    await chooseOAuthNickname(next);if(transition!==sessionTransition)return;
    if(!await ensureCommunityWelcome(activeCommunity)){showFriends();sessionReady=true;return;}
    const loadedChannels = await checked(db.from('channels').select('*').order('position'));
    if(transition!==sessionTransition||session?.user.id!==next.user.id)return;channels=loadedChannels;
    if (!channels.length) {renderCommunityRail();showFriends();sessionReady=true;await enhancements.sessionChanged();return;}
    renderChannels();await loadCommunityAccess();
    if(transition!==sessionTransition||session?.user.id!==next.user.id)return;
    await selectChannel(channels.find(c => c.community_id===activeCommunity&&c.default_for_new_members&&c.kind==='text')||channels.find(c => c.community_id===activeCommunity&&c.kind === 'text') || channels.find(c=>c.community_id===activeCommunity) || channels[0]);
    if(transition===sessionTransition){sessionReady=true;trackVisibleActivity().catch(()=>{});}
  }catch(error){if(transition===sessionTransition){toast('Não foi possível carregar a comunidade: '+errorText(error));sessionRecovery.hidden=false;}}
  finally{if(transition===sessionTransition){sessionInitializing=false;setEntryBusy(false);}}
  if(transition===sessionTransition){await enhancements.sessionChanged();feed?.deepLink();const publicProfile=new URL(location.href).searchParams.get('profile');if(/^[0-9a-f-]{36}$/i.test(publicProfile||''))feed.open('profile',{author:publicProfile});shareReceiver?.resume();const story=new URL(location.href).searchParams.get('story');if(/^[0-9a-f-]{36}$/i.test(story||'')){const tools=await loadSocialTools();if(transition===sessionTransition)tools.stories(story);}}
}
$('logout').onclick = async () => {
  try { await enhancements?.disablePush(true); } catch {}
  const {error} = await db.auth.signOut(); if (error) toast(errorText(error));
};
const channelNodes = new Map(), voiceTrees = new Map();
function renderChannels() {
  const text = [], voice = [], keep = new Set();
  for (const channel of channels.filter(c => c.community_id === activeCommunity)) {
    keep.add(channel.id); let node = channelNodes.get(channel.id);
    if (!node) {
      node = el('button', 'channel'); node.dataset.channelId = channel.id;
      node.append(el('span', 'channel-icon'), el('span', 'channel-name'));
      node.onclick = () => selectChannel(node.orbitaChannel).catch(error => toast(errorText(error))); channelNodes.set(channel.id, node);
    }
    node.orbitaChannel = channel;
    const name = node.querySelector('.channel-name'); if (name.textContent !== channel.name) name.textContent = channel.name;
    const icon=node.querySelector('.channel-icon'),symbol=channel.kind==='text'?'#':'◖';if(icon.textContent!==symbol)icon.textContent=symbol;
    node.classList.toggle('active', selected?.id === channel.id && !home); node.classList.toggle('connected', callChannel?.id === channel.id);
    node.setAttribute('aria-label', channel.name + ' · ' + (channel.kind === 'voice' ? 'Sala de voz' : 'Canal de texto'));
    node.setAttribute('aria-pressed', String(selected?.id === channel.id && !home));
    (channel.kind === 'text' ? text : voice).push(node);
    if (channel.kind === 'voice') {
      const peers = publicVoicePresence.filter(p => p.channel_id === channel.id), signature = JSON.stringify(peers.map(info => [info, person(info.id).display_name, person(info.id).avatar_src]));
      let tree = voiceTrees.get(channel.id);
      if (!tree || tree.dataset.signature !== signature) {
        tree = el('div', 'voice-tree-live'); tree.dataset.signature = signature;
        for (const info of peers) { const p = person(info.id), row = el('div', 'voice-tree-person'), avatar = el('span', 'avatar'); setAvatar(avatar, p); row.append(avatar, el('span', '', p.display_name), el('small', '', info.screen ? 'AO VIVO' : info.microphone ? '◖' : '🔇')); tree.append(row); }
        voiceTrees.set(channel.id, tree);
      }
      if (tree.children.length) voice.push(tree);
    }
  }
  for (const key of channelNodes.keys()) if (!keep.has(key)) { channelNodes.delete(key); voiceTrees.delete(key); }
  reconcileNodes($('text-channels'), text); reconcileNodes($('voice-channels'), voice);
}

const conversationCache = new ConversationCache(), outbox = new MessageOutbox();
let channelAbort, reconnectTimer, reconnectAttempt = 0, realtimeState = 'idle', latestQueued = false, historyError = '', initialHistory = false;
let restoring,restoreFrame,lastViewport, scrollFrame, renderFrame, dialogReturnFocus, cacheValidationIds, cacheValidating=false;
const PAGE_SIZE = 50;

function capturePosition() {
  if(restoring?.version===generation)return restoring.position;
  const list = $('message-list'), rect = list.getBoundingClientRect();
  if (!rect.height) return lastViewport || {top: list.scrollTop, atBottom: true};
  const hit = document.elementFromPoint(rect.left + Math.min(75, rect.width / 2), rect.top + Math.min(24, rect.height / 2));
  const row = hit?.closest('#message-list .message');
  return {top: list.scrollTop, atBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 100,
    anchor: row?.dataset.messageId, offset: row ? row.getBoundingClientRect().top - rect.top : 0};
}
function restorePosition(position) {
  const list=$('message-list'),desired=position||{atBottom:true},job={position:desired,version:generation};
  cancelAnimationFrame(restoreFrame);restoring=job;lastViewport=desired;
  const apply=()=>{if(desired.atBottom)list.scrollTop=list.scrollHeight;else{const row=desired.anchor&&list.querySelector('[data-message-id="'+CSS.escape(desired.anchor)+'"]');list.scrollTop=row?list.scrollTop+row.getBoundingClientRect().top-list.getBoundingClientRect().top-desired.offset:desired.top;}};
  apply();
  // content-visibility recalcula os itens ao voltar à área visível.
  restoreFrame=requestAnimationFrame(()=>{if(restoring!==job||generation!==job.version)return;apply();restoreFrame=requestAnimationFrame(()=>{if(restoring!==job||generation!==job.version)return;apply();restoring=null;lastViewport=capturePosition();});});
}
function cancelRestoration(){cancelAnimationFrame(restoreFrame);restoring=null;}
for(const event of ['wheel','pointerdown','touchstart'])$('message-list').addEventListener(event,cancelRestoration,{passive:true});
document.addEventListener('keydown',event=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)&&document.activeElement?.closest('#message-list'))cancelRestoration();});
function saveConversation() {
  if (!session || home || selected?.kind !== 'text') return;
  conversationCache.save(conversationKey(session.user.id, selected), {messages, oldest, hasMore, scroll: capturePosition(), target: {...selected}});
}
function stopConversation() {
  clearTimeout(reconnectTimer);cancelRestoration(); channelAbort?.abort(); latestQueued = false;
  if (subscription) { const previous = subscription; subscription = null; db.removeChannel(previous).catch(() => {}); }
  setRealtimeState('idle');
}
function setRealtimeState(value) { realtimeState = value; enhancements?.realtimeChanged(value); }
function announceMessage(text) { const node = $('message-announcement'); if (node) node.textContent = text; }
function scheduleMessageRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; if (!home && selected?.kind === 'text') renderMessages(lastViewport?.atBottom); });
}
$('message-list').addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = null; if (!home && selected?.kind === 'text') lastViewport = capturePosition(); });
}, {passive: true});
$('message-list').addEventListener('load', event => { if (event.target instanceof HTMLImageElement && !home && selected?.kind === 'text') restorePosition(lastViewport); }, true);

async function selectChannel(channel) {
  feed?.hide();
  saveComposerDraft(); saveConversation(); stopConversation(); home = false; pinsOnly = false;
  $('friends-view').hidden = true; $('search-messages').value = ''; $('pins-toggle').setAttribute('aria-pressed', 'false');
  selected = channel; const version = ++generation; channelAbort = new AbortController();
  $('message-input').value = drafts.get(draftKey(channel)); updateComposer(); closeMobileMenu();
  renderChannels(); renderSocial(); renderMembers(); $('channel-title').textContent = channel.name;
  $('text-view').hidden = channel.kind !== 'text'; $('voice-view').hidden = channel.kind !== 'voice'; requestAnimationFrame(resizeComposer);
  $('channel-description').textContent = channel.private ? 'Conversa privada · só vocês dois' : channel.kind === 'text' ? 'O começo de boas conversas.' : 'Voz, vídeo e boas companhias.';
  $('private-call').hidden = !channel.private || channel.kind !== 'text';
  if (channel.kind === 'voice') { $('voice-title').textContent = channel.name; updateCallUI(); return; }
  const cached = conversationCache.get(conversationKey(session.user.id, channel));
  messages = cached?.messages || new Map(); oldest = cached?.oldest || null; hasMore = cached?.hasMore || false;
  loading = false; historyError = ''; initialHistory = !cached;cacheValidationIds=cached?new Set(cached.messages.keys()):null;cacheValidating=false; lastViewport = cached?.scroll || {top: 0, atBottom: true};
  renderMessages(false, lastViewport); subscribeMessages(channel, version); loadMessages(version, true);
}

function subscribeMessages(channel, version) {
  if (version !== generation || home || !session || channel.kind !== 'text') return;
  clearTimeout(reconnectTimer);
  if (!navigator.onLine) { setRealtimeState('offline'); return; }
  if (subscription) { const previous = subscription; subscription = null; db.removeChannel(previous).catch(() => {}); }
  const user = session.user.id, table = channel.private ? 'direct_messages' : 'messages';
  const live = db.channel((channel.private ? 'direct-' : 'messages-') + channel.id + '-' + version + '-' + Date.now());
  subscription = live; setRealtimeState(reconnectAttempt ? 'reconnecting' : 'connecting');
  const current = () => version === generation && subscription === live && session?.user.id === user && !home;
  live.on('postgres_changes', {event: '*', schema: 'public', table, filter: `${scopeKey(channel)}=eq.${channel.id}`}, async payload => {
    if (payload.eventType === 'DELETE' || !current()) return;
    try {
      const {data, error} = await requestWithDeadline(db.from(table).select(messageFields).eq('id', payload.new.id).maybeSingle(), {signal: channelAbort.signal});
      if (!current()) return;
      if (error) throw error;
      if (!data) return;
      const own = outbox.observe(user, channel, data);
      if (own && own.status !== 'sending') outbox.remove(own.id);
      if (!data.thread_root) { messages.set(data.id, data); conversationCache.patch(conversationKey(user, channel), data); scheduleMessageRender(); }
      if (payload.eventType === 'INSERT' && data.author_id !== user) announceMessage((data.profiles?.display_name || 'Participante') + ': ' + data.content.slice(0, 180));
      enhancements.messageReceived(data, channel).catch(() => {});
    } catch (error) { if (current() && error.name !== 'AbortError') { historyError = 'Uma mensagem não pôde ser atualizada.'; renderMessages(); } }
  }).on('postgres_changes', {event: 'DELETE', schema: 'public', table}, payload => {
    if (!current() || !payload.old?.id) return;
    conversationCache.remove(conversationKey(user, channel), payload.old.id);
    if (messages.delete(payload.old.id)) scheduleMessageRender();
    enhancements.messageDeleted(payload.old.id, channel).catch(() => {});
  }).subscribe(status => {
    if (!current()) return;
    if (status === 'SUBSCRIBED') { clearTimeout(reconnectTimer); reconnectAttempt = 0; setRealtimeState('connected'); loadMessages(version, true); }
    else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
      setRealtimeState('reconnecting');
      // O SDK tenta reconectar; só substituímos uma assinatura que permaneça parada.
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { if (current()) { reconnectAttempt++; subscribeMessages(channel, version); } }, Math.min(60000, 30000 + reconnectAttempt * 10000));
    }
  });
}
window.addEventListener('offline', () => { clearTimeout(reconnectTimer); if (!home && selected?.kind === 'text') setRealtimeState('offline'); });
window.addEventListener('online', () => { if (session && !home && selected?.kind === 'text') { reconnectAttempt = 0; subscribeMessages(selected, generation); loadMessages(generation, true); } });

async function loadMessages(version, first = false) {
  if (version !== generation || home || selected?.kind !== 'text' || !session) return;
  if (loading) { if (first) latestQueued = true; return; }
  if (!first && !hasMore) return;
  const target = {...selected}, signal = channelAbort?.signal, position = capturePosition(), before = oldest;
  loading = true; historyError = ''; renderMessages(false, position);
  try {
    let query = db.from(target.private ? 'direct_messages' : 'messages').select(messageFields).eq(scopeKey(target), target.id).is('thread_root', null)
      .order('created_at', {ascending: false}).order('id', {ascending: false}).limit(PAGE_SIZE);
    if (!first && before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
    const {data, error} = await requestWithDeadline(query, {signal});
    if (version !== generation) return;
    if (error) throw error;
    const hadOlder = first && data.length && [...messages.values()].some(m => m.created_at < data.at(-1).created_at);
    if (first) {
      const ids = new Set(data.map(m => m.id)), cutoff = data.at(-1)?.created_at;
      for (const [id, message] of messages) if (!ids.has(id) && (!cutoff || data.length < PAGE_SIZE || message.created_at >= cutoff)) messages.delete(id);
    }
    for (const message of data) { const pending = outbox.observe(session.user.id, target, message); if (pending && pending.status !== 'sending') outbox.remove(pending.id); messages.set(message.id, message); }
    oldest = [...messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0] || null;
    if (!first || !hadOlder) hasMore = data.length === PAGE_SIZE;
    initialHistory = false; renderMessages(false, position); saveConversation();
    if (first){enhancements.historyLoaded().catch(() => {});if(cacheValidationIds?.size&&!cacheValidating){const cutoff=data.at(-1)?.created_at;const older=[...cacheValidationIds].filter(id=>messages.has(id)&&cutoff&&messages.get(id).created_at<cutoff);cacheValidationIds=new Set(older);if(older.length)validateCachedMessages(version,target);}}
  } catch (error) {
    if (version === generation && error.name !== 'AbortError') { initialHistory = false; historyError = 'Não foi possível carregar as mensagens. ' + errorText(error); renderMessages(false, position); }
  } finally {
    if (version === generation) { loading = false; $('message-list').setAttribute('aria-busy', 'false'); renderMessages(false, capturePosition()); if (latestQueued) { latestQueued = false; loadMessages(version, true); } }
  }
}

async function validateCachedMessages(version,target){
  cacheValidating=true;try{
    while(cacheValidationIds?.size&&version===generation){
      const ids=[...cacheValidationIds].slice(0,100),before=new Map(ids.map(id=>[id,messages.get(id)]));
      const result=await requestWithDeadline(db.from(target.private?'direct_messages':'messages').select(messageFields).in('id',ids),{signal:channelAbort.signal});
      if(version!==generation)return;if(result.error)throw result.error;const found=new Map(result.data.map(message=>[message.id,message]));
      for(const id of ids){if(messages.get(id)===before.get(id)){if(found.has(id))messages.set(id,found.get(id));else messages.delete(id);}cacheValidationIds.delete(id);}
      renderMessages();saveConversation();
    }
  }catch(error){if(version===generation&&error.name!=='AbortError'){historyError='Parte do histórico não pôde ser conferida. Tente novamente.';renderMessages();}}finally{if(version===generation)cacheValidating=false;}
}
// Reuse unchanged rows so live updates preserve images, focus and open controls.
const messageRows=new Map(),dayDividers=new Map();
let renderedScope='',rowStyleKey='',rowStyleRevision=0;
function createMessageRow(message,grouped=false) {
    const messageProfile=peopleById.get(message.author_id)||message.profiles||{},name = messageProfile.display_name || 'Participante';
    const item = el('article', 'message'), content = el('div', 'message-content'), meta = el('div', 'message-meta');
    item.dataset.shortTime=new Date(message.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const time = el('time', '', relativeTime(message.created_at));
    time.dateTime = message.created_at;time.title=new Date(message.created_at).toLocaleString('pt-BR');const messageName=el('strong','',name),messageRoles=memberRoles.filter(r=>r.user_id===message.author_id).map(r=>communityRoleList.find(role=>role.id===r.role_id)).filter(Boolean).sort((a,b)=>b.position-a.position);if(messageRoles[0]){messageName.style.color=messageRoles[0].color;messageName.append(el('span','role-badge',messageRoles[0].name));}meta.append(messageName,time);messageName.tabIndex=0;messageName.setAttribute('role','button');messageName.setAttribute('aria-label','Abrir perfil de '+name);messageName.onclick=()=>showProfile(person(message.author_id));messageName.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();messageName.click();}};
    if(message.pinned)meta.append(el('small','pin-label','◆ Fixada'));
    content.append(meta);
    if(message.reply_to){const original=messages.get(message.reply_to);const quote=button(original?(original.profiles?.display_name||'Participante')+': '+original.content.slice(0,150):'↪ Resposta a uma mensagem anterior',()=>jumpToReply(message.reply_to),'reply-card');quote.setAttribute('aria-label','Ir para a mensagem respondida');content.append(quote);}
    content.append(safeRichText(message.content));if(message.poll)content.append(renderPoll(message));
    if(message.attachments){const a=message.attachments;if(a.mime_type?.startsWith('image/')){const preview=el('img','attachment-preview');preview.alt=a.name;preview.loading='lazy';reserveImage(preview);content.append(preview);resolveAttachmentUrl(a).then(url=>preview.src=url).catch(()=>preview.remove());}else if(a.mime_type?.startsWith('video/')){const preview=watchUploadedVideo(el('video'));preview.setAttribute('aria-label','Vídeo: '+a.name);content.append(preview);resolveAttachmentUrl(a).then(url=>{if(preview.isConnected)preview.src=url;}).catch(()=>preview.remove());}content.append(button('↓ '+a.name+' · '+(a.size/1024/1024).toFixed(1)+' MB',()=>downloadAttachment(a),'file-card'));}
    if(message.local_state){item.classList.add('message-local');item.dataset.delivery=message.local_state;const delivery=el('div','message-delivery');delivery.append(el('span','',message.local_state==='sending'?'Enviando…':message.local_state==='checking'?'Verificando envio…':message.local_state==='uncertain'?'Envio não confirmado.':('Falha no envio: '+(message.local_error||'tente novamente.'))));if(!['sending','checking'].includes(message.local_state)){delivery.append(button(message.local_state==='uncertain'?'Verificar envio':'Tentar novamente',()=>retryMessage(message.id),'text-button'),button('Descartar',()=>{outbox.remove(message.id);renderMessages();},'text-button'));}content.append(delivery);const avatar=el('div','avatar');setAvatar(avatar,messageProfile);item.append(avatar,content);item.dataset.messageId=message.id;return item;}
    const actions=el('div','message-actions');actions.append(button('Responder',()=>replyToMessage(message),'tiny-button'));
    for(const emoji of ['👍','❤️','😂','🎉','🔥','👀']){const count=(message.reactions||[]).filter(r=>r.emoji===emoji).length;actions.append(button(emoji+(count?' '+count:''),()=>react(message,emoji),'reaction'));}
    if(!selected.private)for(const custom of communityEmojiList){const token=':'+custom.name+':',count=(message.reactions||[]).filter(r=>r.emoji===token).length,reactButton=button('',()=>react(message,token),'reaction custom-reaction');const icon=el('img');icon.src=communityEmojiUrls.get(token)||'';icon.alt=token;reactButton.append(icon,document.createTextNode(count?' '+count:''));actions.append(reactButton);}
    if(message.author_id===session.user.id)actions.append(button('Editar',()=>messageAction(message,'edit'),'tiny-button'));
    if(message.author_id===session.user.id||(!selected.private&&hasCommunityPermission('manage_messages')))actions.append(button(message.pinned?'Desafixar':'Fixar',()=>messageAction(message,'pin'),'tiny-button'),button('Excluir',()=>messageAction(message,'delete'),'tiny-button'));
    const menu=el('details','message-menu'),trigger=el('summary','','⋯');
    trigger.setAttribute('aria-label','Ações da mensagem de '+name);trigger.title='Ações da mensagem';
    menu.append(trigger,actions);content.append(menu);
    const used=[...new Set((message.reactions||[]).map(r=>r.emoji))];
    if(used.length){const reactions=el('div','message-reactions');for(const emoji of used){const count=message.reactions.filter(r=>r.emoji===emoji).length,reactButton=button(emoji+' '+count,()=>react(message,emoji),'reaction');reactButton.classList.toggle('mine',message.reactions.some(r=>r.emoji===emoji&&r.user_id===session.user.id));if(communityEmojiUrls.has(emoji)){const icon=el('img','inline-custom-emoji');icon.src=communityEmojiUrls.get(emoji);icon.alt=emoji;reactButton.replaceChildren(icon,document.createTextNode(' '+count));}reactions.append(reactButton);}content.append(reactions);}
    const avatar=el('div','avatar');setAvatar(avatar,messageProfile);avatar.tabIndex=0;avatar.setAttribute('role','button');avatar.setAttribute('aria-label','Abrir perfil de '+name);avatar.onclick=()=>showProfile(person(message.author_id));avatar.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();avatar.click();}};
    item.append(avatar,content);enhancements?.enhanceMessage(item,message);item.classList.toggle('message-grouped',grouped);return item;
}
function renderMessages(scroll = false, position) {
  const list=$('message-list'),saved=position||lastViewport||capturePosition(),scope=(selected?.private?'dm:':'channel:')+selected?.id;
  if(renderedScope!==scope){messageRows.clear();dayDividers.clear();list.replaceChildren();renderedScope=scope;}
  const nodes=[];list.classList.toggle('history-long',messages.size>200);list.setAttribute('aria-busy',String(loading||initialHistory));
  const welcome=list.querySelector('.welcome')||el('div','welcome');
  if(!welcome.childNodes.length){welcome.append(el('div','welcome-icon','#'),el('h1','',(selected.private?'Sua conversa com ':'Bem-vindo a #')+selected.name),el('p','',selected.private?'Mensagens e chamadas visíveis apenas para vocês dois.':'Um espaço para conversar, compartilhar e estar junto.'));}
  if(initialHistory&&!messages.size){const skeleton=el('div','history-skeleton');skeleton.setAttribute('aria-label','Carregando mensagens');skeleton.setAttribute('role','status');for(let i=0;i<6;i++)skeleton.append(el('div','skeleton-message'));nodes.push(skeleton);}else{nodes.push(welcome);if(!messages.size){let action=welcome.querySelector('button');if(!action){action=button('Escrever a primeira mensagem',()=>$('message-input').focus());welcome.append(action);}}}
  if(historyError){const warning=el('div','history-error');warning.append(el('span','',historyError),button('Tentar novamente',()=>loadMessages(generation,true)));nodes.push(warning);}
  if(hasMore){const more=list.querySelector('.load-more')||button('Carregar mensagens anteriores',()=>loadMessages(generation),'load-more');more.disabled=loading;nodes.push(more);}
  const sorted=[...messages.values(),...outbox.rows(session.user.id,selected)].filter(m=>!m.thread_root&&(!pinsOnly||m.pinned||m.local_state)).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
  const shared=JSON.stringify([memberRoles,communityRoleList,communityEmojiList,[...communityEmojiUrls],session.user.id,hasCommunityPermission('manage_messages')]),keep=new Set();
  if(shared!==rowStyleKey){rowStyleKey=shared;rowStyleRevision++;}
  let previous;
  const usedDays=new Set(),now=new Date(),yesterday=new Date();yesterday.setDate(now.getDate()-1);let lastDay;
  for(const message of sorted){
    const day=new Date(message.created_at).toDateString();if(day!==lastDay){let divider=dayDividers.get(day);if(!divider){divider=el('div','ux-day-divider');divider.setAttribute('role','separator');dayDividers.set(day,divider);}const label=day===now.toDateString()?'Hoje':day===yesterday.toDateString()?'Ontem':new Date(message.created_at).toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'});if(divider.textContent!==label)divider.textContent=label;divider.setAttribute('aria-label',label);nodes.push(divider);usedDays.add(day);lastDay=day;}
    const grouped=!!previous&&previous.author_id===message.author_id&&!message.reply_to&&!message.pinned&&new Date(message.created_at)-new Date(previous.created_at)<300000&&new Date(message.created_at).toDateString()===new Date(previous.created_at).toDateString();
    const quoted=message.reply_to?messages.get(message.reply_to):null;
    const author=peopleById.get(message.author_id)||message.profiles||{};const mentions=[...message.content.matchAll(/@([A-Za-z0-9_]{3,24})/g)].map(match=>peopleByUsername.get(match[1].toLowerCase())?.id||'');
    const signature=JSON.stringify([message,author.display_name,author.avatar_color,author.avatar_src,mentions,quoted?.content,quoted?.profiles?.display_name,rowStyleRevision,grouped]);
    let cached=messageRows.get(message.id);
    if(!cached||cached.signature!==signature){cached={signature,node:createMessageRow(message,grouped)};messageRows.set(message.id,cached);}
    nodes.push(cached.node);keep.add(message.id);previous=message;
  }
  for(const id of messageRows.keys())if(!keep.has(id))messageRows.delete(id);
  for(const key of dayDividers.keys())if(!usedDays.has(key))dayDividers.delete(key);
  reconcileNodes(list,nodes);restorePosition(scroll?{atBottom:true}:saved);
}
$('message-input').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('message-form').requestSubmit(); }
};
$('message-input').addEventListener('input',()=>{saveComposerDraft();resizeComposer();});
window.addEventListener('online',updateComposer);window.addEventListener('offline',updateComposer);
function completeMessage(record, data) {
  outbox.remove(record.id);
  if (session?.user.id !== record.user) return;
  if (data) conversationCache.patch(record.key, data);
  if (!home && conversationKey(session.user.id, selected) === record.key) {
    if (data) messages.set(data.id, data);
    renderMessages(lastViewport?.atBottom); saveConversation();
  }
  announceMessage('Mensagem enviada.'); enhancements.dispatchPush();
}
async function sendMessage(record) {
  if (session?.user.id !== record.user || !outbox.items.has(record.id)) return;
  if (pendingSends.has(record.key)) return toast('Aguarde o envio atual terminar.');
  if (!navigator.onLine) return toast('Você está sem conexão. O texto permanece nesta aba.');
  record.status = 'sending'; record.error = ''; record.observedId = null;
  pendingSends.add(record.key); updateComposer(); if (draftKey(selected) === record.key && !home) renderMessages(lastViewport?.atBottom);
  try {
    // Renova a sessão antes de escrever: tokens expirados são a causa mais comum
    // de leitura funcionar (cache) e o envio falhar.
    await authRecovery.get(record.user);
    const table = record.target.private ? 'direct_messages' : 'messages';
    const scope = scopeKey(record.target);
    // Só envia reply_to quando há resposta. Colunas opcionais com grant ausente
    // não podem bloquear uma mensagem normal.
    const payload = {[scope]: record.target.id, author_id: record.user, content: record.content};
    if (record.reply) payload.reply_to = record.reply;
    const query = () => db.from(table).insert(payload).select(messageFields).single();
    let {data, error} = await requestWithDeadline(query(), {timeout: 30000});
    // Banco antigo sem a migração de reply_to: reenvia sem a coluna opcional.
    if (error && record.reply && (error.code === 'PGRST204' || error.code === '42703' || error.code === '42501')) {
      delete payload.reply_to;
      ({data, error} = await requestWithDeadline(query(), {timeout: 30000}));
      if (!error) toast('Mensagem enviada sem a citação: o banco ainda não tem a coluna de resposta.');
    }
    if (error) throw error;
    completeMessage(record, data);
  } catch (error) {
    if (session?.user.id !== record.user || !outbox.items.has(record.id)) return;
    if (record.observedId) { completeMessage(record); return; }
    record.status = error.code ? 'error' : 'uncertain'; record.error = errorText(error);
    if (draftKey(selected) === record.key && !home) renderMessages();
    announceMessage(record.status === 'uncertain' ? 'O envio não foi confirmado. Verifique a mensagem antes de reenviar.' : 'A mensagem não foi enviada. Há uma opção para tentar novamente.');
  } finally { pendingSends.delete(record.key); updateComposer(); }
}
async function retryMessage(id) {
  const record = outbox.items.get(id);
  if (!record || record.user !== session?.user.id || record.status === 'sending' || record.status === 'checking') return;
  if (record.status === 'error') return sendMessage(record);
  if (!navigator.onLine) return toast('Reconecte para verificar o envio.');
  record.status = 'checking'; renderMessages();
  try {
    const {data, error} = await requestWithDeadline(db.from(record.target.private ? 'direct_messages' : 'messages').select(messageFields)
      .eq(scopeKey(record.target), record.target.id).eq('author_id', record.user).eq('content', record.content).is('thread_root', null)
      .order('created_at', {ascending: false}).limit(20));
    if (session?.user.id !== record.user || !outbox.items.has(id)) return;
    if (error) throw error;
    const found = data.filter(message => !record.knownIds.has(message.id) && (message.reply_to || null) === (record.reply || null) && Math.abs(Date.parse(message.created_at) - Date.parse(record.created_at)) < 300000);
    if (found.length === 1) { completeMessage(record, found[0]); return; }
    record.status = 'uncertain'; renderMessages();
    showDialog('Verificar antes de reenviar', container => {
      container.append(el('p', '', 'A resposta do servidor se perdeu. A mensagem pode ter sido salva. Confira o histórico antes de criar outro envio.'), el('p', 'reply-card', record.content),
        button('Conferir mensagens recentes', () => { $('app-dialog').close(); if (draftKey(selected) === record.key) loadMessages(generation, true); }),
        button('Enviar novamente mesmo assim', () => { $('app-dialog').close(); return sendMessage(record); }, 'primary'));
    });
  } catch (error) { if (outbox.items.has(id)) record.status = 'uncertain'; toast(errorText(error)); renderMessages(); }
}
$('message-form').onsubmit = event => {
  event.preventDefault(); const input = $('message-input'), content = input.value.trim(), target = {...selected}, user = session?.user.id, key = draftKey(target);
  if (!content || !user || target.kind !== 'text' || pendingSends.has(key)) return;
  if (!navigator.onLine) return toast('Você está sem conexão. Seu rascunho foi preservado.');
  try {
    const reply = replyTarget?.scope === target.id ? replyTarget.id : null, record = outbox.add(user, target, content, reply);
    record.knownIds = new Set(messages.keys());
    input.value = ''; drafts.set(key, ''); resizeComposer(); replyTarget = null; $('reply-banner').classList.add('hidden');
    pinsOnly = false; $('pins-toggle').setAttribute('aria-pressed', 'false'); renderMessages(true); announceMessage('Enviando mensagem.');
    sendMessage(record);
  } catch (error) { toast(errorText(error)); }
};


function audioSource(source){return source==='screen_share_audio'?'screen_share_audio':'microphone';}
function sourceVolume(identity,source){
  const key='orbita-volume-'+identity+(source==='screen_share_audio'?'-screen':''),stored=localStorage.getItem(key);
  if(stored===null)return 1;const value=Number(stored);return Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;
}
function applyRemoteVolume(entry){
  const volume=deafened?0:sourceVolume(entry.participantId,entry.source);
  // The SDK controls its gain node when Web Audio mixing is enabled (including iOS).
  // Do not unmute or raise the SDK's silent HTML element and create a second audio path.
  if(typeof entry.track.setVolume==='function')entry.track.setVolume(volume);
  else{entry.media.volume=volume;entry.media.muted=deafened;}
}
function syncRemoteVolumes(){for(const entry of callMedia.values())if(entry.track.kind==='audio')applyRemoteVolume(entry);}
function syncLocalCameraPreview(){
  for(const entry of callMedia.values())if(entry.track.kind==='video'&&entry.source==='camera'&&entry.participantId===room?.localParticipant.identity){
    const facing=entry.track.mediaStreamTrack?.getSettings?.().facingMode||cameraFacing;
    entry.media.classList.toggle('camera-mirrored',facing==='user');
  }
}
function volumeControl(participant,source,label){
  const field=el('label','participant-volume'),caption=el('span','',label),slider=el('input'),value=el('output');
  field.dataset.audioSource=source;slider.type='range';slider.min='0';slider.max='1';slider.step='0.01';slider.dataset.audioSource=source;slider.id='volume-'+source+'-'+participant.identity+'-'+crypto.randomUUID();value.htmlFor=slider.id;
  slider.oninput=()=>{localStorage.setItem('orbita-volume-'+participant.identity+(source==='screen_share_audio'?'-screen':''),slider.value);value.value=Math.round(Number(slider.value)*100)+'%';for(const entry of callMedia.values())if(entry.participantId===participant.identity&&entry.source===source&&entry.track.kind==='audio')applyRemoteVolume(entry);};
  field.append(caption,slider,value);return field;
}
const callMedia = new Map();

function disposeMedia(entry) {
  if (callMedia.get(entry.key) !== entry) return;
  callMedia.delete(entry.key);
  for (const cleanup of entry.cleanups) cleanup();
  // detach() may already have lost its elements. Remove our saved tile regardless.
  try { entry.track.detach(entry.media); } catch {}
  entry.tile?.remove(); entry.media.remove();
}
function syncCallMedia() {
  const participants = room ? new Set([room.localParticipant.identity, ...room.remoteParticipants.keys()]) : new Set();
  for (const entry of [...callMedia.values()]) {
    if (!participants.has(entry.participantId)) { disposeMedia(entry); continue; }
    if (entry.tile){entry.tile.hidden=!!(entry.track.isMuted||entry.publication?.isMuted);const label=entry.tile.querySelector('figcaption>span'),nickname=peopleById.get(entry.participantId)?.display_name;if(label&&nickname){const value=nickname+(entry.source==='screen_share'?' · Tela':' · Câmera');if(label.textContent!==value)label.textContent=value;}}
  }
}
function onTrack(track, participant, publication) {
  const source = publication?.source || track.source || (track.kind === 'video' ? 'camera' : 'microphone');
  const key = JSON.stringify([participant.identity, track.kind==='audio'?audioSource(source):source]);
  const previous = callMedia.get(key);
  if (previous?.track === track) { previous.publication = publication || previous.publication;if(track.kind==='audio')applyRemoteVolume(previous);syncCallMedia();return; }
  if (previous) disposeMedia(previous);
  const media = track.attach(), sid = publication?.trackSid || track.sid;
  if (sid) media.dataset.track = sid;
  const entry = {key, track, media, publication, participantId:participant.identity,source:track.kind==='audio'?audioSource(source):source, cleanups:[]};
  callMedia.set(key, entry);
  const ended = () => {disposeMedia(entry);updateCallUI();};
  if (track.on) { track.on('ended', ended); entry.cleanups.push(() => track.off?.('ended', ended)); }

  if (track.kind === 'video') {
    const isScreen = source === 'screen_share';
    if(participant.isLocal&&!isScreen&&!cameraTrackFacing.has(track))cameraTrackFacing.set(track,track.mediaStreamTrack?.getSettings?.().facingMode||cameraFacing);
    const figure = el('figure', 'media-tile' + (isScreen ? ' media-screen' : '')); if(sid)figure.dataset.track=sid;figure.dataset.participantId=participant.identity;entry.tile=figure;
    media.muted = true; media.playsInline = true;
    const caption = el('figcaption');
    caption.append(el('span', '', (peopleById.get(participant.identity)?.display_name || participant.name || 'Participante') + (isScreen ? ' · Tela' : ' · Câmera')));
    const expand = el('button', 'expand-video', 'Tela cheia');
    expand.type = 'button'; expand.setAttribute('aria-label', `Ver ${isScreen ? 'tela' : 'câmera'} de ${peopleById.get(participant.identity)?.display_name || participant.name || 'Participante'} em tela cheia`);
    expand.onclick = async () => {
      try {
        if (document.fullscreenElement === figure) await document.exitFullscreen();
        else if (figure.requestFullscreen) await figure.requestFullscreen();
        else if (media.webkitEnterFullscreen) media.webkitEnterFullscreen();
        else toast('Este navegador não oferece tela cheia para este vídeo.');
      } catch (error) { toast(errorText(error)); }
    };
    caption.append(expand);enhancements.decorateVideo(media,caption);
    const frame=el('div','media-frame'),status=el('span','video-status','Conectando vídeo…');status.setAttribute('role','status');
    const ready=()=>{status.hidden=true;figure.classList.remove('media-loading');};
    const waiting=()=>{if(media.readyState<2){status.hidden=false;status.textContent='Aguardando vídeo…';figure.classList.add('media-loading');}};
    const failed=()=>{status.hidden=false;status.textContent='Não foi possível reproduzir este vídeo. Tente desligar e ligar a câmera.';figure.classList.add('media-loading');};
    for(const [event,handler] of [['loadeddata',ready],['playing',ready],['waiting',waiting],['emptied',waiting],['error',failed]]) {media.addEventListener(event,handler);entry.cleanups.push(()=>media.removeEventListener(event,handler));}
    figure.classList.add('media-loading');frame.append(media,status);figure.append(frame,caption);
    figure.ondblclick=event=>{if(event.target.closest('button,a,input,select'))return;event.preventDefault();expand.click();};
    media.title='Clique duas vezes para tela cheia';
    $('media-grid').append(figure);if(media.readyState>=2)ready();
  } else { media.dataset.remoteAudio = 'true';media.dataset.participantId=participant.identity;media.dataset.audioSource=entry.source;document.body.append(media);applyRemoteVolume(entry); }
  syncCallMedia();syncLocalCameraPreview();callLayout?.update();
}
function removeTrack(track, publication, participant) {
  const sid=publication?.trackSid || track?.sid;
  for(const entry of [...callMedia.values()]) {
    if(participant && entry.participantId!==participant.identity)continue;
    // An old unsubscribe must not delete a replacement from the same participant.
    if((track && entry.track===track) || (!track && sid && (entry.publication?.trackSid || entry.track.sid)===sid))disposeMedia(entry);
  }
}

function qualityText(quality){return ({excellent:'Ótima conexão',good:'Boa conexão',poor:'Conexão instável',unknown:'Conectando'})[String(quality||'unknown').toLowerCase()]||'Conectando';}
const participantCards=new Map();let participantRoom;
function updateCallUI() {
  syncCallMedia();syncRemoteVolumes();
  const here = !!room && callChannel?.id === selected?.id && selected?.kind === 'voice';
  $('call-dock').hidden=!room;$('dock-name').textContent=callChannel?.name||'';$('call-dock').querySelector('.vb-ping').textContent=here?qualityText(room.localParticipant.connectionQuality):'Conectado';
  $('join-call').hidden = here; $('join-call').disabled = joining || !config?.callsConfigured;
  $('join-call').textContent = joining ? 'Conectando…' : (room ? 'Trocar para esta sala ↗' : 'Entrar na sala ↗');
  $('active-controls').hidden = !here; $('empty-call').hidden = here;
  $('call-status').textContent = !config?.callsConfigured ? 'As chamadas não estão configuradas neste momento.'
    : here ? `${room.remoteParticipants.size+1} participante${room.remoteParticipants.size===0?'':'s'} · ${qualityText(room.localParticipant.connectionQuality)}`
    : room ? `Conectado a ${callChannel.name}. Você pode continuar ouvindo enquanto navega.` : 'Entre na sala para conversar por voz, vídeo ou tela.';
  $('participants').hidden = !here; $('media-grid').hidden = !here;
  if(participantRoom!==room){participantCards.clear();participantRoom=room;}const participantNodes=[];
  $('voice-stage').setAttribute('aria-label',here?'Chamada conectada':'Sala de voz');
  publishVoicePresence().catch(()=>{});
  if (room) {
    const participants = [room.localParticipant, ...room.remoteParticipants.values()];
    for (const participant of participants) {
      let card=participantCards.get(participant.identity);
      if(!card){card=el('div','participant');card.dataset.participantId=participant.identity;card.append(el('span','avatar'),el('strong','participant-name'),el('small','participant-status'));
        participantCards.set(participant.identity,card);}
      card.classList.toggle('speaking',!!participant.isSpeaking);const name=peopleById.get(participant.identity)?.display_name||participant.name||'Participante';card.querySelector('.avatar').textContent=initials(name);card.querySelector('.participant-name').textContent=name;
      card.querySelector('.participant-status').textContent=`${participant.isMicrophoneEnabled?'Microfone ligado':'Microfone desligado'} · ${qualityText(participant.connectionQuality)}`;
      for(const slider of card.querySelectorAll('input[data-audio-source]')){
        const source=slider.dataset.audioSource;slider.setAttribute('aria-label',(source==='microphone'?'Volume do microfone de ':'Volume da transmissão de ')+name);
        if(document.activeElement!==slider)slider.value=sourceVolume(participant.identity,source);
        slider.closest('label').querySelector('output').value=Math.round(Number(slider.value)*100)+'%';
      }
      participantNodes.push(card);
    }
    for (const [id, enabled] of [['mic',room.localParticipant.isMicrophoneEnabled],['camera',room.localParticipant.isCameraEnabled],['screen',room.localParticipant.isScreenShareEnabled]]) {
      $(id).setAttribute('aria-pressed', String(enabled));
    }
  }
  const activeIds=new Set(participantNodes.map(node=>node.dataset.participantId));for(const id of participantCards.keys())if(!activeIds.has(id))participantCards.delete(id);reconcileNodes($('participants'),participantNodes);
  renderChannels();
}
function updateSpeakingUI() {
  if(!room)return;
  const speaking=new Set([room.localParticipant,...room.remoteParticipants.values()].filter(p=>p.isSpeaking).map(p=>p.identity));
  for(const card of participantCards.values())card.classList.toggle('speaking',speaking.has(card.dataset.participantId));
  for(const entry of callMedia.values())if(entry.tile)entry.tile.classList.toggle('speaking',speaking.has(entry.participantId));
}
async function leaveCall({preserveJoin=false}={}) {
  if(!preserveJoin)cancelCallJoin();
  cameraTask=null;const previous = room;if(previous)microphoneSwitch.set(previous.localParticipant,false);room = null;callChannel = null;talkHeld=false;
  enhancements?.callEnded(previous);callReactions?.clear();
  if (previous) previous.removeAllListeners();
  for(const entry of [...callMedia.values()])disposeMedia(entry);
  document.querySelectorAll('[data-remote-audio]').forEach(node => node.remove());
  $('media-grid').replaceChildren(); updateCallUI();
  if (previous) {try{await previous.disconnect();}finally{await audioTools?.ended(previous);}}
}
$('join-call').onclick = async () => {
  if (joining || !session || selected?.kind !== 'voice') return;
  const operation=new AbortController(),account=session.user.id,target={...selected};callJoin=operation;
  const current=()=>callJoin===operation&&!operation.signal.aborted&&session?.user.id===account&&!shuttingDown;
  joining = true; updateCallUI(); let connected;
  try {
    await authRecovery.get(account);
    if(!current())return;
    const result=await requestWithDeadline(async signal=>{
      const response=await apiFetch(`/api/${target.private?'conversations':'channels'}/${target.id}/join`,{method:'POST',signal});
      const data=await response.json().catch(()=>{throw Error('O servidor não respondeu corretamente. Tente novamente.');});
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Não foi possível entrar.');return data;
    },{signal:operation.signal,timeout:30000});
    if(!current())return;
    const {Room, RoomEvent, VideoPresets, ScreenSharePresets} = await requestWithDeadline(()=>import('https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/+esm'),{signal:operation.signal,timeout:30000});
    if (!current()) return;
    await leaveCall({preserveJoin:true});
    if(!current())return;
    const media=mediaSettings();
    connected = new Room({
      adaptiveStream: {pixelDensity:'screen'},
      dynacast:true,
      webAudioMix:audioTools.mixOptions(),
      audioCaptureDefaults:audioCapture(),
      videoCaptureDefaults:media.cameraCapture,
      publishDefaults: {
        simulcast:true,
        videoCodec:'vp8',
        videoEncoding:media.cameraPublish.videoEncoding,
        screenShareEncoding:media.screenPublish.screenShareEncoding,
        videoSimulcastLayers:media.mode==='economia'?[VideoPresets.h180,VideoPresets.h360]:[VideoPresets.h360,VideoPresets.h720],
        screenShareSimulcastLayers:media.mode==='economia'
          ?[ScreenSharePresets.h360fps15,ScreenSharePresets.h720fps15]
          :media.mode==='equilibrada'
            ?[ScreenSharePresets.h720fps15,ScreenSharePresets.h1080fps15]
            :[ScreenSharePresets.h720fps30,ScreenSharePresets.h1080fps30],
      },
    }); audioTools.bind(connected);room = connected; callChannel = target;
    connected.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {if(room!==connected)return;onTrack(track, participant, publication);updateCallUI();})
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {if(room!==connected)return;removeTrack(track, publication, participant);updateCallUI();})
      .on(RoomEvent.TrackUnpublished, (publication, participant) => {if(room!==connected)return;removeTrack(publication.track,publication,participant);updateCallUI();})
      .on(RoomEvent.LocalTrackPublished, publication => { if(room!==connected)return;if(publication.track?.kind==='audio')audioTools?.sync(connected).catch(()=>{});if(publication.track?.kind==='video')onTrack(publication.track,connected.localParticipant,publication);updateCallUI(); })
      .on(RoomEvent.LocalTrackUnpublished, publication => {if(room!==connected)return;removeTrack(publication.track,publication,connected.localParticipant);updateCallUI();});
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted]) connected.on(event, updateCallUI);
    connected.on(RoomEvent.ActiveSpeakersChanged,updateSpeakingUI);
    connected.on(RoomEvent.DataReceived,receiveCallData);
    connected.on(RoomEvent.ConnectionQualityChanged,updateCallUI);
    connected.on(RoomEvent.Reconnecting, () => { $('call-status').textContent = 'Reconectando à sala…'; });
    connected.on(RoomEvent.Reconnected, updateCallUI);
    connected.on(RoomEvent.Disconnected, () => { if (room === connected) { leaveCall(); toast('Você saiu da chamada.'); } });
    await connected.connect(result.url, result.token);
    if (!current() || room !== connected) { await connected.disconnect(); return; }
    try { await connected.startAudio(); } catch { toast('A chamada entrou. Toque na tela para liberar o áudio neste navegador.'); }
    if(!current()||room!==connected){await connected.disconnect();return;}
    enhancements.connected(connected,RoomEvent,result);
    syncVoiceChat(true).catch(()=>{});
    try { if(result.canPublish!==false)await connected.localParticipant.setMicrophoneEnabled(!pushToTalk&&!deafened, audioCapture()); }
    catch (error) { toast('Você entrou sem microfone. ' + errorText(error)); }
    if(current()&&room===connected)await audioTools?.connected(connected);
    if(!current()||room!==connected)await connected.disconnect();
  } catch (error) { if(current()){if(room===connected)await leaveCall({preserveJoin:true});toast(errorText(error));} }
  finally { if(callJoin===operation){callJoin=null;joining=false;updateCallUI();} }
};
$('leave-call').onclick = () => leaveCall();
if(!canShareScreen){$('screen').disabled=true;$('screen').title='Este navegador não suporta compartilhar a tela';}
for (const [id, property, method] of [['mic','isMicrophoneEnabled','setMicrophoneEnabled'],['camera','isCameraEnabled','setCameraEnabled'],['screen','isScreenShareEnabled','setScreenShareEnabled']]) {
  $(id).onclick = async () => {
    if (!room||id==='camera'&&cameraTask) return;const target=room,cameraWasEnabled=target.localParticipant.isCameraEnabled,operation=id==='camera'?{room:target}:null;if(operation)cameraTask=operation;$(id).disabled = true;
    try {
      const enabled = !room.localParticipant[property];
      if (id === 'camera') {const media=mediaSettings();await target.localParticipant.setCameraEnabled(enabled,media.cameraCapture,media.cameraPublish);if(enabled&&room===target){const track=[...target.localParticipant.videoTrackPublications.values()].find(p=>(p.source||p.track?.source)==='camera')?.track;if(track){const facing=track.mediaStreamTrack?.getSettings?.().facingMode||cameraTrackFacing.get(track);if(facing&&facing!==cameraFacing)await track.restartTrack({...media.cameraCapture,deviceId:undefined,facingMode:{exact:cameraFacing}});cameraTrackFacing.set(track,cameraFacing);}}}
      else if (id === 'screen') {
        if(!canShareScreen)throw Error('Este navegador não oferece compartilhamento de tela. Em alguns celulares, use a opção de compartilhar tela do navegador ou do sistema.');
        const media=mediaSettings();await room.localParticipant.setScreenShareEnabled(enabled,media.screenCapture,media.screenPublish);
        if(enabled&&media.screenCapture.audio&&![...room.localParticipant.audioTrackPublications.values()].some(p=>p.source==='screen_share_audio'))toast('A tela foi compartilhada sem áudio. Escolha uma aba e marque Compartilhar áudio na janela do navegador.');
      }
      else if(id==='mic'&&pushToTalk){toast('Segure o botão “Falar” ou a tecla Espaço para abrir o microfone.');}
      else if(deafened&&enabled)toast('Ative o áudio antes de abrir o microfone.');else await microphoneSwitch.set(room.localParticipant,enabled);
    }
    catch (error) { if(id==='camera'&&!cameraWasEnabled&&room===target){await target.localParticipant.setCameraEnabled(false).catch(()=>{});toast(['OverconstrainedError','ConstraintNotSatisfiedError'].includes(error?.name)?'Não foi possível ativar a câmera escolhida. Selecione outra câmera e tente novamente.':errorText(error));}else toast(errorText(error)); }
    finally { if(operation&&cameraTask===operation)cameraTask=null;$(id).disabled = id==='screen'&&!canShareScreen;updateCallUI();syncLocalCameraPreview(); }
  };
}
const facingField=el('label','camera-facing-control'),facingSelect=el('select');facingSelect.id='camera-facing';facingSelect.setAttribute('aria-label','Câmera do celular');
for(const [value,name]of [['user','Frontal'],['environment','Traseira']]){const option=el('option','',name);option.value=value;facingSelect.append(option);}
facingField.append(el('span','','Câmera'),facingSelect);$('camera').after(facingField);
function updateCameraControl(){
  const mobile = mobileCamera();
  facingField.hidden = !mobile;
  const camOn = room?.localParticipant?.isCameraEnabled;
  const switchBtn = $('camera-switch');
  if (switchBtn) {
    switchBtn.hidden = !mobile || !camOn;
    switchBtn.disabled = !room || room.localParticipant.permissions?.canPublish===false || !!cameraTask;
    switchBtn.setAttribute('aria-label',cameraFacing === 'user' ? 'Trocar para câmera traseira' : 'Trocar para câmera frontal');
    switchBtn.title = cameraFacing === 'user' ? 'Trocar para câmera traseira' : 'Trocar para câmera frontal';
    switchBtn.textContent = cameraFacing === 'user' ? '🔄 Traseira' : '🔄 Frontal';
  }
  facingSelect.disabled=!room||room.localParticipant.permissions?.canPublish===false||!!cameraTask;facingSelect.value=cameraFacing;
  if(cameraTask)$('camera').disabled=true;syncLocalCameraPreview();
  // Larger controls when camera is on
  document.body.classList.toggle('camera-active', !!camOn);
}
$('camera-switch')?.addEventListener('click', () => {
  const next = cameraFacing === 'user' ? 'environment' : 'user';
  facingSelect.value = next;
  facingSelect.dispatchEvent(new Event('change'));
});
facingSelect.onchange=async()=>{
  const next=facingSelect.value,previous=cameraFacing,target=room;if(!target||cameraTask||target.localParticipant.permissions?.canPublish===false){updateCameraControl();return;}
  const publication=[...target.localParticipant.videoTrackPublications.values()].find(p=>(p.source||p.track?.source)==='camera'),track=publication?.track;
  if(!target.localParticipant.isCameraEnabled||!track){cameraFacing=next;localStorage.setItem('orbita-camera-facing',next);updateCameraControl();return;}
  const operation={room:target};cameraTask=operation;updateCameraControl();
  try{
    await track.restartTrack({...mediaSettings().cameraCapture,deviceId:undefined,facingMode:{exact:next}});
    if(room!==target){track.stop?.();return;}
    cameraFacing=next;cameraTrackFacing.set(track,next);localStorage.setItem('orbita-camera-facing',next);
  }catch(error){
    if(room!==target)return;
    let restored=false;try{await track.restartTrack({...mediaSettings().cameraCapture,deviceId:undefined,facingMode:{exact:previous}});restored=true;}catch{await target.localParticipant.setCameraEnabled(false).catch(()=>{});}
    toast(restored?'Não foi possível usar essa câmera. A câmera anterior foi restaurada.':'Não foi possível trocar de câmera. Ative o vídeo novamente e escolha outra câmera.');
  }finally{if(cameraTask===operation)cameraTask=null;if(room===target){updateCallUI();updateCameraControl();}}
};
window.addEventListener('resize',updateCameraControl);
document.addEventListener('pointerdown',()=>{const current=room;if(current?.state==='connected'&&current.canPlaybackAudio===false)current.startAudio().then(()=>{if(room===current)syncRemoteVolumes();}).catch(()=>{});},{passive:true});
window.addEventListener('pagehide', () => { shuttingDown = true;cancelCallJoin();if(presenceChannel)presenceChannel.untrack();leaveCall().catch(()=>{}); });
window.addEventListener('pageshow', event => { shuttingDown = false;if(event.persisted&&session){publishVoicePresence(true).catch(()=>{});if(!home&&selected?.kind==='text'){subscribeMessages(selected,generation);loadMessages(generation,true);}} });

function setEntryBusy(busy){const entry=$('entry-animation');if(entry)entry.hidden=!busy;$('app-view').inert=busy;$('auth-view').inert=busy;}
const startupRetry=el('button','soft-button','Tentar novamente');startupRetry.type='button';startupRetry.hidden=true;startupRetry.onclick=()=>boot();$('auth-status').after(startupRetry);
const sessionRecovery=el('div','session-recovery');sessionRecovery.hidden=true;sessionRecovery.setAttribute('role','status');sessionRecovery.append(el('p','','Não foi possível carregar sua comunidade.'),button('Tentar carregar novamente',()=>showSession(session)));document.body.append(sessionRecovery);
let booting=false;
window.addEventListener('online',()=>{if(!startupRetry.hidden)boot();});
async function boot() {
  if(booting)return;booting=true;setEntryBusy(true);startupRetry.hidden=true;$('auth-status').textContent='';
  try {
    config=await requestWithDeadline(async signal=>{const response=await fetch('/api/config',{signal});if(!response.ok)throw Error('O servidor está indisponível. Aguarde e tente novamente.');return response.json();},{timeout:30000});
    if(config.diagnosticsEnabled)import('./app-diagnostics.js').then(module=>{diagnostics=module.initAppDiagnostics({account:()=>session?.user.id,send:async(events,user)=>{if(session?.user.id!==user)return;await apiFetch('/api/diagnostics/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});}});}).catch(()=>{});
    if(config.sentryDsn||config.umamiScript)import('./telemetry.js').then(module=>module.configureTelemetry(config)).catch(()=>{});
    if (!config.configured) { $('setup').hidden = false; $('auth-submit').disabled = true; return; }
    const {createClient} = await requestWithDeadline(()=>import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'),{timeout:30000});
    if(!db){db=createClient(config.supabaseUrl,config.supabaseKey);
    // Supabase calls run outside the Auth callback to avoid locking the session.
    db.auth.onAuthStateChange((_event,next)=>{setTimeout(()=>showSession(next).catch(error=>toast(errorText(error))),0);});}
    await socialLogin.ready(db,config);
    const {data, error} = await requestWithDeadline(()=>db.auth.getSession(),{timeout:30000}); if(error){if(isInvalidSessionError(error)){await showSession(null);$('auth-status').textContent='Sua sessão expirou. Entre novamente para continuar.';$('auth-submit').disabled=false;return;}throw error;}
    await showSession(data.session);$('auth-submit').disabled=false;
  }catch(error){$('auth-status').textContent='Não foi possível conectar. '+errorText(error);$('auth-submit').disabled=true;startupRetry.hidden=false;}finally{booting=false;if(!sessionInitializing)setEntryBusy(false);}
}
// Social features share the authenticated Supabase client and its row policies.
let peopleById=new Map(),peopleByUsername=new Map();const profileMediaUrls=new Map();
let profile, people = [], friendships = [], conversations = [], socialSubscription, presenceChannel;
let publicVoicePresence=[],lastPresenceSignature='',online = new Set(), home = false, pinsOnly = false;
let communityRoleList=[],memberRoles=[],communityMemberList=[],communityEmojiList=[];
let communityEmojiUrls=new Map();
let noise = localStorage.getItem('orbita-noise') !== 'false';
let echoCancellation = localStorage.getItem('orbita-echo') !== 'false';
let autoGainControl = localStorage.getItem('orbita-agc') !== 'false';
let deafened = false;
const audioCapture = () => ({
  noiseSuppression: noise,
  echoCancellation: echoCancellation,
  autoGainControl: autoGainControl,
  channelCount: 1,
  ...audioTools?.capture()
});
const scopeKey = target => target?.private ? 'conversation_id' : 'channel_id';
const messageTable = () => selected?.private ? 'direct_messages' : 'messages';
const messageFields = '*,profiles!author_id(display_name,username,avatar_color,avatar_url),attachments(id,owner_id,storage_path,file_id,name,mime_type,size),reactions(id,emoji,user_id),poll_votes(id,user_id,option_index)';
const otherUser = c => c.user_a === session.user.id ? c.user_b : c.user_a;
const person = id => peopleById.get(id) || {id,display_name:'Participante',username:'',avatar_color:'#8b80ff'};
function button(label, action, css = 'soft-button') { const b=el('button',css,label);b.type='button';if(css.split(' ').includes('feature-options')&&label)b.setAttribute('aria-label',label);b.onclick=()=>{if(b.disabled)return;b.disabled=true;return Promise.resolve().then(()=>typeof action==='function'?action():undefined).catch(e=>toast(errorText(e))).finally(()=>{b.disabled=false;});};return b; }
async function checked(query) { const result=await query; if(result.error) throw result.error; return result.data; }
async function apiFetch(path, options={}) {
  const account=session?.user.id;if(!account)throw Error('Entre novamente na sua conta.');
  let fresh=await authRecovery.get(account);
  const send=()=>requestWithDeadline(signal=>fetch(path,{...options,signal,headers:{...options.headers,Authorization:`Bearer ${fresh.access_token}`}}),{signal:options.signal,timeout:30000});
  let response=await send();
  if(response.status===401){fresh=await authRecovery.refresh(account);if(session?.user.id!==account)throw new DOMException('A conta mudou.','AbortError');response=await send();if(response.status===401)await authRecovery.expire(account);}
  if(!response.ok) {if(!path.startsWith('/api/diagnostics')&&!path.startsWith('/api/admin/diagnostics'))window.dispatchEvent(new CustomEvent('orbita:technical-signal',{detail:'api_error'}));const error=await response.json().catch(()=>({}));throw Error(error.detail||'Não foi possível concluir.');}
  return response;
}
async function insertChannel(values){
  // RLS helpers read existing rows; query the generated ID in a separate statement.
  await checked(db.from('channels').insert(values));
  return checked(db.from('channels').select('*').eq('community_id',values.community_id).eq('name',values.name).single());
}
async function syncChannelVoice(channel){
  if(channel.kind==='voice'&&config.callsConfigured)await apiFetch(`/api/channels/${channel.id}/sync-voice`,{method:'POST'});
}
async function syncCommunityVoice(){
  let failed=false;for(const channel of channels.filter(c=>c.community_id===activeCommunity&&c.kind==='voice')){
    try{await syncChannelVoice(channel);}catch{failed=true;}
  }
  if(failed)toast('Os cargos foram salvos. Reabra e salve o canal para tentar sincronizar o acesso à chamada.');
}
let accessRefreshTimer;
function scheduleAccessRefresh(){
  clearTimeout(accessRefreshTimer);const account=session?.user.id;
  accessRefreshTimer=setTimeout(async()=>{try{
    if(!account||account!==session?.user.id)return;
    const updated=await checked(db.from('channels').select('*').order('position'));
    if(account!==session?.user.id)return;channels=updated;communityViews.clear();conversationCache.retain(key=>!key.includes(':channel:')||updated.some(c=>key.endsWith(':'+c.id)));
    if(callChannel&&!callChannel.private&&!channels.some(c=>c.id===callChannel.id))await leaveCall();
    if(selected&&!selected.private&&!channels.some(c=>c.id===selected.id))showFriends();
    await loadCommunityAccess();renderChannels();renderMembers();
  }catch(error){toast(errorText(error));}},750);
}
const dialogDisposers=new Set();
function disposeDialog(){for(const dispose of dialogDisposers)dispose();dialogDisposers.clear();}
$('app-dialog').addEventListener('close',()=>{if($('app-dialog').open)return;disposeDialog();focusElement(dialogReturnFocus,$('text-view').hidden?$('friends-view').hidden?$('join-call'):$('friend-username'):$('message-input'));});
function showDialog(title, build) {
  if(!$('app-dialog').open)dialogReturnFocus=document.activeElement;disposeDialog();$('dialog-title').textContent=title;const body=el('div','dialog-body');$('dialog-content').replaceChildren(body);build(body);if(!$('app-dialog').open)$('app-dialog').showModal();
}
function inputField(parent,label,value,max=160) {
  const l=el('label','field',label), input=el('input'); input.value=value||'';input.maxLength=max;l.append(input);parent.append(l);return input;
}
let socialRevision=0;
async function loadSocial() {
  const revision=++socialRevision;
  const userId=session?.user.id;if(!userId)return;
  const results=await Promise.all([
    checked(db.from('profiles').select('*').order('display_name')),
    checked(db.from('friendships').select('*')),
    checked(db.from('conversations').select('*').order('created_at',{ascending:false}))]);
  if(session?.user.id!==userId||revision!==socialRevision)return;[people,friendships,conversations]=results;peopleById=new Map(people.map(p=>[p.id,p]));peopleByUsername=new Map(people.map(p=>[p.username?.toLowerCase(),p]));
  profile=person(session.user.id);await hydrateProfileMedia();if(session?.user.id!==userId||revision!==socialRevision)return;$('user-name').textContent=profile.display_name;
  setAvatar($('user-avatar'),profile);
  renderSocial();renderMembers();if(home)renderFriends();if(room)updateCallUI();
}
async function hydrateProfileMedia(){
  const profiles=people,uid=session?.user.id,paths=[...new Set(profiles.flatMap(p=>[p.avatar_url,p.banner_url].filter(Boolean)))];
  const missing=paths.filter(path=>!profileMediaUrls.has(path)||profileMediaUrls.get(path).expires<Date.now());
  if(missing.length){try{const {data,error}=await db.storage.from('orbita-files').createSignedUrls(missing,3600);if(session?.user.id!==uid)return;if(!error)for(const item of data||[])if(item.signedUrl)profileMediaUrls.set(item.path,{url:item.signedUrl,expires:Date.now()+3000000});}catch{}}
  while(profileMediaUrls.size>256)profileMediaUrls.delete(profileMediaUrls.keys().next().value);
  for(const p of profiles){p.avatar_src=profileMediaUrls.get(p.avatar_url)?.url||'';p.banner_src=profileMediaUrls.get(p.banner_url)?.url||'';}
}
function setAvatar(node,p){node.dataset.userId=p?.id||'';node.textContent=initials(p?.display_name);node.style.backgroundColor=p?.avatar_color||'#8b80ff';node.style.color=p?.avatar_src?'transparent':foreground(p?.avatar_color||'#8b80ff');node.style.backgroundImage=p?.avatar_src?`url("${p.avatar_src.replaceAll('"','%22')}")`:'';node.classList.toggle('has-photo',!!p?.avatar_src);}
async function initSocial() {
  const transition=sessionTransition,uid=session?.user.id,current=()=>sessionTransition===transition&&session?.user.id===uid;
  await loadSocial();
  if(!current())return;
  if(socialSubscription) await db.removeChannel(socialSubscription);
  if(!current())return;
  socialSubscription=db.channel('social-'+uid)
    .on('postgres_changes',{event:'*',schema:'public',table:'friendships'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversations'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'*',schema:'public',table:'channels'},scheduleAccessRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'channel_members'},scheduleAccessRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'community_members'},scheduleAccessRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'community_member_roles'},scheduleAccessRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'community_roles'},scheduleAccessRefresh)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_events'},payload=>incomingCall(payload.new))
    .on('postgres_changes',{event:'*',schema:'public',table:'reactions'},()=>{if(!home&&selected?.kind==='text')refreshMessages();})
    .subscribe();
  if(presenceChannel) await db.removeChannel(presenceChannel);
  if(!current())return;
  presenceChannel=db.channel('community:main',{config:{private:true,presence:{key:uid}}});
  presenceChannel.on('presence',{event:'sync'},()=>{publicVoicePresence=Object.entries(presenceChannel.presenceState()).flatMap(([id,metas])=>metas.map(meta=>({...meta,id})));online=new Set(Object.keys(presenceChannel.presenceState()));renderMembers();renderChannels();if(home)renderFriends();});
  presenceChannel.subscribe(async status=>{if(status==='SUBSCRIBED')await publishVoicePresence(true);});
}
const memberNodes=new Map();
function renderMembers() {
  if($('members-sidebar').hidden){memberNodes.clear();if($('member-list').childElementCount)$('member-list').replaceChildren();return;}
  const memberIds=new Set(communityMemberList.map(member=>member.user_id));
  if(selected?.private){memberIds.clear();memberIds.add(session.user.id);memberIds.add(selected.friend?.id);}
  const visible=people.filter(p=>memberIds.has(p.id));
  $('member-count').textContent=String(visible.length);const nodes=[],keep=new Set();
  const ordered=[...visible].sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id)));
  for(const p of ordered){
    keep.add(p.id);const signature=JSON.stringify([p,online.has(p.id),memberRoles.filter(r=>r.user_id===p.id),communityRoleList,roleFor(p.id)]);let cached=memberNodes.get(p.id);if(cached?.signature===signature){nodes.push(cached.node);continue;}
    const row=el('div','member');row.dataset.userId=p.id;const a=el('span','avatar');setAvatar(a,p);
    const content=el('div'),name=el('strong','',p.display_name),assigned=memberRoles.filter(r=>r.user_id===p.id).map(m=>communityRoleList.find(r=>r.id===m.role_id)).filter(Boolean).sort((x,y)=>y.position-x.position);
    if(assigned[0]){name.style.color=assigned[0].color;name.append(el('span','role-badge',assigned[0].name));}
    content.append(name,el('small','',p.custom_status||p.presence_activity|| (online.has(p.id)?'● Disponível':'Offline')));
    row.append(a,content);row.onclick=()=>showProfile(p);row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','Abrir perfil de '+p.display_name);row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showProfile(p);}};nodes.push(row);memberNodes.set(p.id,{signature,node:row});
  }
  for(const id of memberNodes.keys())if(!keep.has(id))memberNodes.delete(id);reconcileNodes($('member-list'),nodes);
  $('online-count').textContent=visible.filter(p=>online.has(p.id)).length+' online';
}
function readPinnedDMs(){try{const list=JSON.parse(localStorage.getItem('orbita-pinned-dms:'+session?.user.id)||'[]');return Array.isArray(list)?list:[];}catch{return [];}}
function renderSocial() {
  $('dm-channels').replaceChildren();
  const pending=friendships.filter(f=>f.status==='pending'&&f.recipient_id===session.user.id).length;
  $('friends-badge').textContent=pending||'';
  const pinned=readPinnedDMs();
  for(const c of [...conversations].sort((a,b)=>Number(pinned.includes(b.id))-Number(pinned.includes(a.id)))){const p=person(otherUser(c));const b=button('',()=>openConversation(c),'channel'+(selected?.private&&selected.id===c.id?' active':''));const name=el('span','channel-name','@ '+p.display_name);name.dir='auto';b.append(name);b.title='@'+p.username;b.dataset.channelId=c.id;const wrap=el('div','dm-pinned-row'),pin=button(pinned.includes(c.id)?'★':'☆',()=>{const next=readPinnedDMs().filter(id=>id!==c.id);if(!pinned.includes(c.id))next.unshift(c.id);localStorage.setItem('orbita-pinned-dms:'+session.user.id,JSON.stringify(next.slice(0,30)));renderSocial();},'dm-pin');pin.setAttribute('aria-label',(pinned.includes(c.id)?'Desafixar':'Fixar')+' conversa com '+p.display_name);pin.setAttribute('aria-pressed',String(pinned.includes(c.id)));wrap.append(b,pin);$('dm-channels').append(wrap);}
  enhancements?.decorateNavigation();
}
function showFriends() {
  feed?.hide();
  navigationEpoch++;saveComposerDraft();saveConversation();stopConversation();home=true;generation++;
  $('friends-view').hidden=false;$('text-view').hidden=true;$('voice-view').hidden=true;
  $('channel-title').textContent='Amigos';$('channel-description').textContent='Sua galera, sempre por perto.';
  $('private-call').hidden=true;renderFriends();
}
function renderFriends() {
  $('friends-list').replaceChildren();
  const accepted=friendships.filter(f=>f.status==='accepted'), pending=friendships.filter(f=>f.status==='pending');
  $('friend-total').textContent=accepted.length+(accepted.length===1?' amigo':' amigos');
  for(const f of [...pending,...accepted].filter(f=>f.status==='pending'||friendsFilter!=='online'||online.has(f.requester_id===session.user.id?f.recipient_id:f.requester_id))) {
    const p=person(f.requester_id===session.user.id?f.recipient_id:f.requester_id), row=el('article','friend-card');
    const avatar=el('span','avatar');setAvatar(avatar,p);
    const info=el('div','friend-info');info.append(el('strong','',p.display_name),el('small','', '@'+p.username+' · '+(f.status==='accepted'?(online.has(p.id)?'Online':'Offline'):(f.recipient_id===session.user.id?'Quer ser seu amigo':'Pedido enviado'))));
    const actions=el('div','friend-actions');row.append(avatar,info,actions);
    if(f.status==='accepted'){
      actions.append(button('Mensagem',()=>startConversation(p)),button('Ligar',()=>startConversation(p,true)),button('Remover',()=>removeFriend(f),'text-button'));
    }else{
      if(f.recipient_id===session.user.id)actions.append(button('Aceitar',async()=>{await checked(db.from('friendships').update({status:'accepted'}).eq('id',f.id));await loadSocial();},'primary'));
      actions.append(button(f.recipient_id===session.user.id?'Recusar':'Cancelar',()=>removeFriend(f),'text-button'));
    }
    $('friends-list').append(row);
  }
  if(!$('friends-list').children.length){const empty=el('div','empty-state');empty.append(el('p','',friendsFilter==='online'?'Nenhum amigo está online agora.':'As boas conversas começam com um oi.'));empty.append(button(friendsFilter==='online'?'Ver todos os amigos':'Adicionar alguém',()=>{if(friendsFilter==='online'){friendsFilter='all';renderFriends();}else $('friend-username').focus();}));$('friends-list').append(empty);}
}
async function removeFriend(f){
  showDialog('Remover conexão',container=>{container.append(el('p','','A amizade será removida. O histórico continua disponível, mas novas mensagens e chamadas exigirão uma nova amizade.'));
    container.append(button('Confirmar',async()=>{await checked(db.from('friendships').delete().eq('id',f.id));$('app-dialog').close();await loadSocial();},'danger'));});
}
function showProfile(p) {
  showDialog(p.display_name, container => {
    const panel = el('div', 'rich-profile');panel.dataset.userId=p.id;
    // Banner (taller, Discord-like)
    const banner = el('div', 'rp-banner');
    banner.style.height = '160px';
    if (p.banner_src) banner.style.backgroundImage = `url("${p.banner_src.replaceAll('"','%22')}")`;
    else if(p.id===session?.user.id&&/^#[0-9a-f]{6}$/i.test(loadProfilePrefs().bannerColor||''))banner.style.background=loadProfilePrefs().bannerColor;
    else if (p.avatar_color) banner.style.background=`linear-gradient(135deg, ${p.avatar_color}, #2a1f3d)`;
    panel.append(banner);
    // Avatar + status
    const wrap = el('div', 'rp-avatar-wrap');
    const av = el('div', 'rp-avatar');
    setAvatar(av, p);
    const st = el('span', 'rp-status');
    st.style.background = ({online:'var(--online)',idle:'var(--idle)',dnd:'var(--dnd)',invisible:'var(--offline)'}[p.presence_status] || 'var(--offline)');
    wrap.append(av, st);
    panel.append(wrap);
    // Body
    const body = el('div', 'rp-body');
    const nameEl = el('h3', 'rp-name', p.display_name || 'Participante');
    body.append(nameEl);
    const userLine = el('div', 'rp-username', '@' + (p.username || 'user') + (p.pronouns ? ' · ' + p.pronouns : ''));
    body.append(userLine);
    if (p.custom_status) body.append(el('div', 'rp-bio', '✦ ' + p.custom_status));
    if (p.bio) body.append(el('div', 'rp-bio', p.bio));
    if (p.presence_activity) body.append(el('div', 'rp-username', p.presence_activity));
    // Member since
    if (p.created_at) {
      const since = el('div', 'rp-section');
      since.append(el('div', 'rp-section-title', 'Membro desde'));
      since.append(el('div', '', new Date(p.created_at).toLocaleDateString('pt-BR', {day:'numeric', month:'short', year:'numeric'})));
      body.append(since);
    }
    // Voice
    const voiceSec = el('div', 'rp-section');
    voiceSec.append(el('div', 'rp-section-title', 'Em voz'));
    voiceSec.append(el('div', '', room&&(p.id===room.localParticipant.identity||room.remoteParticipants.has(p.id))?'Conectado a '+(callChannel?.name||'chamada'):'Sem chamada visível neste servidor'));
    body.append(voiceSec);
    body.append(button('Perguntas deste perfil',async()=>{const tools=await loadSocialTools();if(session)tools.questions(p.id);}));if(p.id!==session.user.id)body.append(button('Denunciar perfil',async()=>{const tools=await loadSocialTools();if(session)tools.report('profile',p.id);}));
    const badgeLine=el('p','profile-badges');body.append(badgeLine);const lastSeen=el('small','muted');body.append(lastSeen);if(p.presence_status!=='invisible')checked(db.from('profile_activity').select('last_seen').eq('user_id',p.id).maybeSingle()).then(activity=>{if(activity&&lastSeen.isConnected&&!online.has(p.id))lastSeen.textContent='Visto '+relativeTime(activity.last_seen);}).catch(()=>{});const viewing=session.user.id;checked(db.rpc('profile_badges',{target:p.id})).then(badges=>{if(session?.user.id===viewing&&badgeLine.isConnected&&Array.isArray(badges))badgeLine.textContent=badges.join(' · ');}).catch(()=>{});
    // Feed posts link
    const feedBtn = button('Ver publicações no Feed', () => {
      $('app-dialog').close();
      if (feed && typeof feed.open === 'function') feed.open('profile', { author: p.id });
      else toast('Feed não disponível');
    }, 'rp-action');
    body.append(feedBtn);
    // Actions
    const actions = el('div', 'rp-section');
    if (p.id === session?.user.id) {
      actions.append(button('Editar perfil', () => { $('app-dialog').close(); $('settings').click(); }, 'rp-action'));
      actions.append(button('Decorações e efeitos', () => { $('app-dialog').close(); openDecorationGallery(); }, 'rp-action'));
      actions.append(button('Definir status', () => { $('app-dialog').close();closeMobileMenu();$('status-popover').classList.remove('hidden');requestAnimationFrame(()=>$('status-popover').querySelector('button')?.focus()); }, 'rp-action'));
    } else {
      const f = friendships.find(f => [f.requester_id, f.recipient_id].includes(p.id));
      if (f?.status === 'accepted') actions.append(button('Enviar mensagem', async () => { $('app-dialog').close(); await startConversation(p); }, 'rp-action'));
      else if (!f) actions.append(button('Adicionar amigo', async () => { await sendFriend(p); $('app-dialog').close(); }, 'rp-action'));
      else actions.append(el('p', 'muted', 'Pedido de amizade pendente.'));
    }
    body.append(actions);
    panel.append(body);
    container.append(panel);
    setTimeout(applyDecorations, 30);
  });
}
async function sendFriend(p){
  if(p.id===session.user.id)throw Error('Esse é o seu próprio perfil.');
  await checked(db.from('friendships').insert({requester_id:session.user.id,recipient_id:p.id}));toast('Pedido de amizade enviado.');await loadSocial();
}
$('add-friend-form').onsubmit=async event=>{
  event.preventDefault();try{const username=$('friend-username').value.trim().replace(/^@/,'').toLowerCase();
    const p=people.find(p=>p.username===username);if(!p)throw Error('Usuário não encontrado. Peça o @ do perfil da pessoa.');await sendFriend(p);$('friend-username').value='';
  }catch(e){toast(errorText(e));}
};
async function startConversation(p,call=false){
  let c=conversations.find(c=>otherUser(c)===p.id);
  if(!c){const [user_a,user_b]=[session.user.id,p.id].sort();const result=await db.from('conversations').insert({user_a,user_b}).select().single();
    if(result.error&&result.error.code==='23505')c=await checked(db.from('conversations').select('*').eq('user_a',user_a).eq('user_b',user_b).single());
    else {if(result.error)throw result.error;c=result.data;}await loadSocial();}
  await openConversation(c,call);
  if(call){await checked(db.from('call_events').insert({conversation_id:c.id,caller_id:session.user.id}));$('join-call').click();}
}
async function openConversation(c,voice=false){const p=person(otherUser(c));await selectChannel({id:c.id,name:p.display_name,kind:voice?'voice':'text',private:true,friend:p});renderSocial();}
$('private-call').onclick=()=>{
  const c=conversations.find(c=>c.id===selected?.id);if(!c)return;
  const integrated=()=>{$('app-dialog').close();return startConversation(person(otherUser(c)),true).catch(e=>toast(errorText(e)));};
  if(!config?.videochamadaConfigured)return integrated();
  choosePrivateCall({el,button,showDialog,apiFetch,state:()=>({session,selected,room}),insertInvitation:text=>{
    const input=$('message-input');input.value+=(input.value?'\n':'')+text;drafts.set(draftKey(selected),input.value);input.dispatchEvent(new Event('input'));$('app-dialog').close();input.focus();
  }},c,integrated);
};
function incomingCall(event){
  if(event.caller_id===session?.user.id||Date.now()-Date.parse(event.created_at)>60000)return;
  const p=person(event.caller_id);$('incoming-name').textContent=p.display_name+' está chamando…';$('incoming-call').hidden=false;
  $('answer-call').onclick=async()=>{try{const c=await checked(db.from('conversations').select('*').eq('id',event.conversation_id).single());$('incoming-call').hidden=true;await openConversation(c,true);$('join-call').click();}catch(e){toast(errorText(e));}};
  setTimeout(()=>{$('incoming-call').hidden=true;},30000);
}
$('decline-call').onclick=()=>{$('incoming-call').hidden=true;};
$('friends-nav').onclick=showFriends;
$('settings').onclick=()=>showDialog('Seu perfil e áudio',container=>{
  const card = el('div', 'profile-edit-card');
  const bannerPrev = el('div', 'rp-banner-preview');
  if (profile.banner_src) bannerPrev.style.backgroundImage = `url("${profile.banner_src.replaceAll('"','%22')}")`;
  else if (/^#[0-9a-f]{6}$/i.test(loadProfilePrefs().bannerColor||'')) bannerPrev.style.background = loadProfilePrefs().bannerColor;
  else if (profile.avatar_color) bannerPrev.style.background = `linear-gradient(135deg, ${profile.avatar_color}, #2a1f3d)`;
  card.append(bannerPrev);
  const wrap = el('div', 'rp-avatar-wrap');
  const av = el('div', 'rp-avatar');
  setAvatar(av, profile);
  wrap.append(av);
  card.append(wrap);
  const form=el('form');
  const name=inputField(form,'Nickname (também será seu @)',/^[A-Za-z0-9_]{3,24}$/.test(profile.display_name)?profile.display_name:profile.username,24),bio=inputField(form,'Sobre você',profile.bio,160),pronouns=inputField(form,'Pronomes',profile.pronouns,32),activity=inputField(form,'Atividade (ex.: Jogando Minecraft / Ouvindo música)',profile.presence_activity,80),color=inputField(form,'Cor do perfil',profile.avatar_color,7);color.type='color';
  name.pattern='[A-Za-z0-9_]{3,24}';name.minLength=3;name.required=true;const nicknameHint=el('p','muted');name.closest('label').after(nicknameHint);const hint=()=>nicknameHint.textContent='Para adicionar você: @'+name.value.trim().toLowerCase()+' · 3–24 letras, números ou _';name.addEventListener('input',hint);hint();
  const avatarFile=profileFileField(form,'Foto do perfil',profile.avatar_src),bannerFile=profileFileField(form,'Banner (pode ser GIF animado)',profile.banner_src);
  form.append(el('h3','','Áudio'));
  form.append(el('p','muted','Ajustes aplicados ao microfone. O navegador e o dispositivo podem limitar o efeito real.'));

  const noiseLabel=el('label','check-field');const noiseCheck=el('input');noiseCheck.type='checkbox';noiseCheck.checked=noise;noiseLabel.append(noiseCheck,document.createTextNode('Supressão de ruído'));form.append(noiseLabel,el('p','muted','Reduz ruídos de fundo. Use o modo Agressivo (estilo Krisp) para ambientes barulhentos.'));
  const echoLabel=el('label','check-field');const echoCheck=el('input');echoCheck.type='checkbox';echoCheck.checked=echoCancellation;echoLabel.append(echoCheck,document.createTextNode('Cancelamento de eco'));form.append(echoLabel,el('p','muted','Evita que o áudio dos alto-falantes volte pelo microfone.'));
  const agcLabel=el('label','check-field');const agcCheck=el('input');agcCheck.type='checkbox';agcCheck.checked=autoGainControl;agcLabel.append(agcCheck,document.createTextNode('Controle automático de ganho'));form.append(agcLabel,el('p','muted','Mantém o volume da sua voz mais estável.'));

  const pttLabel=el('label','check-field'),ptt=el('input');ptt.type='checkbox';ptt.checked=pushToTalk;pttLabel.append(ptt,document.createTextNode('Pressionar Espaço ou Segurar para falar'));form.append(pttLabel,el('p','muted','Com esta opção ativa, o microfone fica fechado até você segurar o botão Falar ou a tecla Espaço na chamada.'));
  const save=el('button','primary','Salvar alterações');save.type='submit';form.append(save);card.append(form); container.append(card);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;const uid=session.user.id,prior={...profile},created=[];let saved=false;try{
    const avatarUrl=avatarFile.files[0]?await uploadProfileAsset(avatarFile.files[0],'avatar'):prior.avatar_url||'';if(avatarUrl!==prior.avatar_url)created.push(avatarUrl);
    const bannerUrl=bannerFile.files[0]?await uploadProfileAsset(bannerFile.files[0],'banner'):prior.banner_url||'';if(bannerUrl!==prior.banner_url)created.push(bannerUrl);
    if(session?.user.id!==uid)throw Error('Sua conta mudou; salve o perfil novamente.');
    const updated=await checked(db.from('profiles').update({display_name:name.value.trim(),username:name.value.trim().toLowerCase(),bio:bio.value.trim(),pronouns:pronouns.value.trim(),presence_activity:activity.value.trim(),avatar_color:color.value,avatar_url:avatarUrl,banner_url:bannerUrl}).eq('id',uid).select('id'));
    if(!updated.length)throw Error('O perfil não pôde ser atualizado. Entre novamente.');saved=true;
    const retired=[prior.avatar_url,prior.banner_url].filter(path=>path?.startsWith('profiles/'+uid+'/')&&!new Set([avatarUrl,bannerUrl]).has(path));if(retired.length){const removed=await db.storage.from('orbita-files').remove([...new Set(retired)]);if(removed.error)toast('Perfil salvo. Não foi possível liberar o espaço das imagens antigas agora.');}
    noise=noiseCheck.checked;localStorage.setItem('orbita-noise',String(noise));
    echoCancellation=echoCheck.checked;localStorage.setItem('orbita-echo',String(echoCancellation));
    autoGainControl=agcCheck.checked;localStorage.setItem('orbita-agc',String(autoGainControl));
    pushToTalk=ptt.checked;localStorage.setItem('orbita-push-to-talk',String(pushToTalk));
    if(room){for(const pub of room.localParticipant.audioTrackPublications.values())if(pub.track?.source==='microphone')await pub.track.restartTrack(audioCapture());await audioTools?.sync(room);talkHeld=false;if(pushToTalk||deafened)await microphoneSwitch.set(room.localParticipant,false);}
    await loadSocial();if(form.isConnected)$('app-dialog').close();toast('Perfil e áudio atualizados.');
  }catch(e){if(!saved&&created.length)await db.storage.from('orbita-files').remove(created.filter(Boolean));toast(e.code==='23505'?'Esse nome de usuário já está em uso.':errorText(e));}finally{save.disabled=false;}};
});
function channelEditFields(form,channel){
  const visibility=el('label','check-field'),privateBox=el('input');privateBox.type='checkbox';privateBox.checked=!!channel?.is_private;visibility.append(privateBox,document.createTextNode('Canal privado (só pessoas autorizadas)'));form.append(visibility);
  const announce=el('label','check-field'),announceBox=el('input');announceBox.type='checkbox';announceBox.checked=!!channel?.is_announcement;announce.append(announceBox,document.createTextNode('Canal de anúncios (só cargos autorizados podem publicar)'));form.append(announce);
  const def=el('label','check-field'),defaultBox=el('input');defaultBox.type='checkbox';defaultBox.checked=!!channel?.default_for_new_members;def.append(defaultBox,document.createTextNode('Canal padrão para novos membros'));form.append(def);
  const memberLabel=el('label','field','Membros autorizados'),memberSelect=el('select');memberSelect.multiple=true;memberSelect.size=Math.min(6,Math.max(3,communityMemberList.length));memberSelect.setAttribute('aria-label','Membros autorizados no canal privado');
  for(const item of communityMemberList){const p=person(item.user_id),option=el('option','',p.display_name+' · @'+p.username);option.value=item.user_id;memberSelect.append(option);}
  if(channel?.id)checked(db.from('channel_members').select('user_id').eq('channel_id',channel.id)).then(rows=>{for(const option of memberSelect.options)option.selected=rows.some(row=>row.user_id===option.value);}).catch(error=>toast(errorText(error)));
  memberLabel.append(memberSelect);form.append(memberLabel,el('small','muted','Use Ctrl ou ⌘ para selecionar várias pessoas.'));const stageLabel=el('label','check-field'),stageBox=el('input');stageBox.type='checkbox';stageBox.checked=!!channel?.is_stage;stageLabel.append(stageBox,document.createTextNode('Sala de palco: novos participantes entram na plateia'));form.append(stageLabel);return {privateBox,announceBox,defaultBox,memberSelect,stageBox};
}
$('create-channel').onclick=()=>showDialog('Novo canal',container=>{
  const form=el('form'),name=inputField(form,'Nome do canal','',40),type=el('select');
  for(const [value,text]of[['text','Canal de texto'],['voice','Sala de voz e vídeo']]){const opt=el('option','',text);opt.value=value;type.append(opt);}form.append(type);
  const options=channelEditFields(form,null),save=el('button','primary','Criar canal');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{if(type.value==='text'&&options.defaultBox.checked)await checked(db.from('channels').update({default_for_new_members:false}).eq('community_id',activeCommunity).eq('kind','text').eq('default_for_new_members',true));const c=await insertChannel({name:name.value.trim(),kind:type.value,position:channels.length+1,community_id:activeCommunity,is_stage:type.value==='voice'&&options.stageBox.checked,is_private:options.privateBox.checked,is_announcement:type.value==='text'&&options.announceBox.checked,default_for_new_members:type.value==='text'&&options.defaultBox.checked});
    if(c.is_private){const ids=[...new Set([session.user.id,...[...options.memberSelect.selectedOptions].map(o=>o.value)])];await checked(db.from('channel_members').insert(ids.map(user_id=>({channel_id:c.id,user_id,added_by:session.user.id}))).select());}
    if(c.default_for_new_members)channels=channels.map(old=>old.community_id===c.community_id&&old.kind==='text'?{...old,default_for_new_members:false}:old);
    channels.push(c);$('app-dialog').close();await selectChannel(c);
  }catch(e){toast(errorText(e));}finally{save.disabled=false;}};
});
$('dialog-close').onclick=()=>$('app-dialog').close();
$('search-messages').oninput=()=>renderMessages();
$('pins-toggle').onclick=()=>{pinsOnly=!pinsOnly;$('pins-toggle').setAttribute('aria-pressed',String(pinsOnly));renderMessages();};
$('back-to-call').onclick=()=>{if(callChannel)selectChannel(callChannel);};
$('dock-leave').onclick=()=>leaveCall();
let microphoneBeforeDeafen=false;
$('deafen').onclick=()=>{if(!deafened)microphoneBeforeDeafen=!!room?.localParticipant.isMicrophoneEnabled;deafened=!deafened;syncRemoteVolumes();$('deafen').setAttribute('aria-pressed',String(deafened));if(room){talkHeld=false;microphoneSwitch.set(room.localParticipant,!deafened&&microphoneBeforeDeafen&&!pushToTalk&&room.localParticipant.permissions?.canPublish!==false);}updateCallUI();};
async function refreshMessages(){return loadMessages(generation,true);}
async function refreshMessage(id,target={...selected}){
  const user=session?.user.id,key=conversationKey(user,target),version=generation;
  const result=await requestWithDeadline(db.from(target.private?'direct_messages':'messages').select(messageFields).eq('id',id).eq(scopeKey(target),target.id).maybeSingle());
  if(session?.user.id!==user)return;if(result.error)throw result.error;
  if(result.data)conversationCache.patch(key,result.data);else conversationCache.remove(key,id);
  if(version===generation&&!home&&draftKey(selected)===key){if(result.data)messages.set(id,result.data);else messages.delete(id);renderMessages();}
}
async function messageAction(message,action){
  const actionTable=messageTable(),actionTarget={...selected},actionUser=session.user.id,actionKey=conversationKey(session.user.id,selected);
  if(action==='delete'){showDialog('Excluir mensagem',container=>{container.append(el('p','','Deseja excluir esta mensagem?'),button('Excluir',async()=>{
    const deleted=await checked(db.from(actionTable).delete().eq('id',message.id).select('id'));if(!deleted.length)throw Error('A mensagem não existe mais ou suas permissões mudaram.');
    if(message.attachments?.owner_id===session.user.id){
      const path=message.attachments.storage_path||message.attachments.file_id;
      if(path){
        const references=await Promise.all(['messages','direct_messages','music_state'].map(table=>checked(db.from(table).select('id').eq('attachment_id',message.attachments.id).limit(1))));
        if(references.some(rows=>rows.length)){toast('O anexo foi preservado por uma referência antiga do banco.');}
        else{const {error}=await db.storage.from('orbita-files').remove([path]);if(error){toast('Mensagem removida; o anexo ficou guardado.');}else await checked(db.from('attachments').delete().eq('id',message.attachments.id).eq('owner_id',session.user.id));}
      }
    }
    conversationCache.remove(actionKey,message.id);if(session?.user.id!==actionUser)return;if(draftKey(selected)===actionKey){messages.delete(message.id);renderMessages();}$('app-dialog').close();await enhancements.messageDeleted(message.id,actionTarget);
  },'danger'));});return;}
  if(action==='pin'){const changed=await checked(db.from(actionTable).update({pinned:!message.pinned}).eq('id',message.id).select('id'));if(!changed.length)throw Error('Não foi possível alterar esta mensagem.');message.pinned=!message.pinned;await refreshMessage(message.id,actionTarget);return;}
  showDialog('Editar mensagem',container=>{const form=el('form'),input=el('textarea'),save=el('button','primary','Salvar');input.value=message.content;input.maxLength=4000;input.rows=4;input.setAttribute('aria-label','Mensagem');form.append(input);save.type='submit';form.append(save);container.append(form);form.onsubmit=async e=>{e.preventDefault();try{const value=input.value.trim();if(!value)throw Error('A mensagem não pode ficar vazia.');showDialog('Confirmar edição',box=>{box.append(el('p','','Salvar a nova versão desta mensagem?'),el('p','reply-card',value),button('Salvar alteração',async()=>{const changed=await checked(db.from(actionTable).update({content:value}).eq('id',message.id).select('id'));if(!changed.length)throw Error('Não foi possível editar esta mensagem.');message.content=value;message.edited_at=new Date().toISOString();$('app-dialog').close();await refreshMessage(message.id,actionTarget);await enhancements.messageReceived(message,actionTarget);},'primary'));});}catch(error){toast(errorText(error));}};});
}
async function react(message,emoji){
  const target={...selected},user=session.user.id;const mine=(message.reactions||[]).find(r=>r.user_id===session.user.id&&r.emoji===emoji);
  if(mine)await checked(db.from('reactions').delete().eq('id',mine.id));
  else await checked(db.from('reactions').insert({[target.private?'direct_message_id':'message_id']:message.id,user_id:user,emoji}));
  await refreshMessage(message.id,target);
}
async function downloadAttachment(a,play=false){
  const path=a.storage_path||a.file_id;
  if(!path)throw Error('Este arquivo não está disponível no armazenamento do Supabase.');
  const {data:blob,error}=await db.storage.from('orbita-files').download(path);
  if(error)throw error;
  const url=URL.createObjectURL(new Blob([blob],{type:a.mime_type||'application/octet-stream'}));
  if(play)return url;
  const link=el('a');link.href=url;link.download=a.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function uploadFile(file,target){
  const owner=session?.user.id;if(!owner)throw Error('Entre na sua conta para enviar arquivos.');
  file=await compressImage(file,'attachment');if(session?.user.id!==owner)throw Error('Sua conta mudou; envio cancelado.');
  if(!config.storageConfigured)throw Error('O armazenamento de arquivos ainda não está pronto.');
  if(file.size>config.uploadLimit)throw Error('O limite é 25 MB por arquivo.');
  if(!target||!['text','voice'].includes(target.kind))throw Error('Escolha um canal ou conversa antes de enviar.');
  const kind=target.private?'conversations':'channels';
  const path=`${kind}/${target.id}/${owner}/${crypto.randomUUID()}`;
  const mime=file.type||'application/octet-stream';
  const {error:uploadError}=await db.storage.from('orbita-files').upload(path,file,{cacheControl:'3600',contentType:mime,upsert:false});
  if(uploadError)throw uploadError;
  try{
    if(session?.user.id!==owner)throw Error('Sua conta mudou; envio cancelado.');const row={owner_id:owner,channel_id:target.private?null:target.id,conversation_id:target.private?target.id:null,
      file_id:path,storage_path:path,storage_proof:'supabase-private-v1',name:file.name.slice(0,180),mime_type:mime.slice(0,120),size:file.size};
    return await checked(db.from('attachments').insert(row).select('id,owner_id,channel_id,conversation_id,file_id,storage_path,name,mime_type,size').single());
  }catch(error){await db.storage.from('orbita-files').remove([path]);throw error;}
}
$('attach-file').onclick=()=>{if(!config.storageConfigured)return toast('O Storage do Supabase ainda não está configurado.');$('file-input').click();};
$('file-input').onchange=async()=>{
  const file=$('file-input').files[0],target=selected,version=generation;if(!file)return;
  $('attach-file').disabled=true;try{toast('Enviando para o armazenamento privado…');const attachment=await uploadFile(file,target);
    try{await checked(db.from(target.private?'direct_messages':'messages').insert({[scopeKey(target)]:target.id,author_id:session.user.id,content:'📎 '+attachment.name,attachment_id:attachment.id}));}
    catch(error){await db.from('attachments').delete().eq('id',attachment.id).eq('owner_id',session.user.id);await db.storage.from('orbita-files').remove([attachment.storage_path]);throw error;}
    if(version===generation)await refreshMessages();toast('Arquivo enviado.');
  }catch(e){toast(errorText(e));}finally{$('attach-file').disabled=false;$('file-input').value='';$('file-input').accept='';}
};
let navigationEpoch=0;
const communityViews=new Map(),communityNodes=new Map();
function rememberCommunity(){if(!activeCommunity||!session)return;communityViews.delete(activeCommunity);communityViews.set(activeCommunity,{roles:communityRoleList,memberRoles,members:communityMemberList,emojis:communityEmojiList,emojiUrls:communityEmojiUrls,channels:channels.filter(c=>c.community_id===activeCommunity),lastChannel:selected?.community_id===activeCommunity?selected.id:null,expires:Date.now()+300000});while(communityViews.size>8)communityViews.delete(communityViews.keys().next().value);}
let communities=[],activeCommunity='00000000-0000-4000-8000-000000000001',siteRoles=[],replyTarget=null,friendsFilter='all',extraSubscription;
const isAdmin=()=>siteRoles.some(r=>r.user_id===session?.user.id);
const managesCommunity=()=>hasCommunityPermission('manage_channels');
const roleFor=id=>siteRoles.find(r=>r.user_id===id)?.role;
const hasCommunityPermission=permission=>isAdmin()||communities.find(c=>c.id===activeCommunity)?.created_by===session?.user.id||memberRoles.some(m=>m.user_id===session?.user.id&&communityRoleList.some(r=>r.id===m.role_id&&r.permissions?.includes(permission)));
let accessRevision=0;
async function loadCommunityAccess(){
  if(!activeCommunity||!session)return false;
  const target=activeCommunity,uid=session.user.id,revision=++accessRevision;
  const loaded=await Promise.all([
    checked(db.from('community_roles').select('*').eq('community_id',target).order('position',{ascending:false})),
    checked(db.from('community_member_roles').select('*').eq('community_id',target)),
    checked(db.from('community_members').select('user_id').eq('community_id',target)),
    checked(db.from('community_emojis').select('*').eq('community_id',target))
  ]);
  if(revision!==accessRevision||activeCommunity!==target||session?.user.id!==uid)return false;
  [communityRoleList,memberRoles,communityMemberList,communityEmojiList]=loaded;
  const urls=new Map();
  if(communityEmojiList.length){const result=await db.storage.from('orbita-files').createSignedUrls(communityEmojiList.map(emoji=>emoji.storage_path),3600);if(!result.error)for(const item of result.data||[]){const emoji=communityEmojiList.find(emoji=>emoji.storage_path===item.path);if(emoji&&item.signedUrl)urls.set(':'+emoji.name+':',item.signedUrl);}}
  if(revision!==accessRevision||activeCommunity!==target||session?.user.id!==uid)return false;
  communityEmojiUrls=urls;renderCustomEmojiPicker();rememberCommunity();return true;
}
function renderCustomEmojiPicker(){
  document.querySelectorAll('.community-emoji-option').forEach(node=>node.remove());
  for(const emoji of communityEmojiList){const token=':'+emoji.name+':',url=communityEmojiUrls.get(token);if(!url)continue;const b=button('',()=>{insertComposer(token);$('emoji-popover').classList.add('hidden');$('message-input').focus();},'emoji-button community-emoji-option'),img=el('img');img.src=url;img.alt=token;b.append(img);$('emoji-grid').append(b);}
}
function profileFileField(form,labelText,currentUrl){const label=el('label','field',labelText),input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';const preview=el('img','profile-upload-preview');let objectUrl;preview.alt=labelText;if(currentUrl)preview.src=currentUrl;else preview.hidden=true;const dispose=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}};dialogDisposers.add(dispose);input.onchange=()=>{dispose();const file=input.files[0];if(file){objectUrl=URL.createObjectURL(file);preview.src=objectUrl;preview.hidden=false;}else{preview.hidden=!currentUrl;if(currentUrl)preview.src=currentUrl;}};label.append(input,preview);form.append(label);return input;}
async function uploadProfileAsset(file,kind){file=await compressImage(file,kind);if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>5*1024*1024)throw Error('Use uma imagem PNG, JPG, WebP ou GIF de até 5 MB.');const ext=file.type==='image/jpeg'?'jpg':file.type.split('/')[1],path=`profiles/${session.user.id}/${kind}-${crypto.randomUUID()}.${ext}`;const {error}=await db.storage.from('orbita-files').upload(path,file,{cacheControl:'3600',contentType:file.type,upsert:false});if(error)throw error;return path;}
const attachmentUrls=new Map();
async function resolveAttachmentUrl(attachment){
  const path=attachment.storage_path||attachment.file_id;if(!path)throw Error('Imagem indisponível.');
  const key=session?.user.id+':'+path,cached=attachmentUrls.get(key);
  if(cached&&cached.expires>Date.now())return cached.promise;
  const entry={expires:Date.now()+3000000,promise:null};
  entry.promise=db.storage.from('orbita-files').createSignedUrl(path,3600).then(({data,error})=>{if(error)throw error;return data.signedUrl;}).catch(error=>{if(attachmentUrls.get(key)===entry)attachmentUrls.delete(key);throw error;});
  attachmentUrls.set(key,entry);if(attachmentUrls.size>200)attachmentUrls.delete(attachmentUrls.keys().next().value);
  return entry.promise;
}

const baseInitSocial=initSocial;
initSocial=async()=>{
  const transition=sessionTransition,uid=session?.user.id,current=()=>sessionTransition===transition&&session?.user.id===uid;
  await checked(db.rpc('ensure_default_community'));
  if(!current())return;
  const params=new URLSearchParams(location.search),invite=params.get('invite')||localStorage.getItem('orbita-pending-invite');
  if(invite){try{const {data,error}=await db.rpc('join_community_invite',{invitation:invite});if(!current())return;if(error)throw error;activeCommunity=data;localStorage.removeItem('orbita-pending-invite');params.delete('invite');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);toast('Você entrou na comunidade pelo convite.');}catch(error){localStorage.setItem('orbita-pending-invite',invite);toast(errorText(error));}}
  const loaded=await Promise.all([checked(db.from('communities').select('*').order('created_at')),checked(db.from('site_roles').select('*'))]);
  if(!current())return;[communities,siteRoles]=loaded;
  if(!communities.some(c=>c.id===activeCommunity)){const fallback=await checked(db.rpc('ensure_default_community'));if(!current())return;activeCommunity=fallback;}
  if(!current())return;await baseInitSocial();if(!current())return;renderCommunityRail();updateFounders();
  if(extraSubscription)await db.removeChannel(extraSubscription);
  if(!current())return;
  extraSubscription=db.channel('orbita-ui-'+session.user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'communities'},async()=>{try{const loaded=await checked(db.from('communities').select('*').order('created_at'));if(!current())return;communities=loaded;renderCommunityRail();}catch(error){if(current())toast(errorText(error));}})
    .on('postgres_changes',{event:'*',schema:'public',table:'community_welcome'},payload=>{const id=payload.new?.community_id||payload.old?.community_id;welcomeAccess.delete(id);communityViews.delete(id);if(current()&&id===activeCommunity)ensureCommunityWelcome(id).then(accepted=>{if(!current())return;if(!accepted){if(callChannel?.community_id===id)leaveCall();showFriends();}else scheduleAccessRefresh();}).catch(error=>toast(errorText(error)));})
    .on('postgres_changes',{event:'*',schema:'public',table:'site_roles'},async()=>{try{const loaded=await checked(db.from('site_roles').select('*'));if(!current())return;siteRoles=loaded;renderMembers();updateFounders();}catch(error){if(current())toast(errorText(error));}})
    .on('postgres_changes',{event:'*',schema:'public',table:'poll_votes'},()=>{if(!home&&selected?.kind==='text')refreshMessages();}).subscribe();
  if(new URLSearchParams(location.hash.slice(1)).has('convite'))toast('Entre na conta de Kalil e abra Configurações → Aceitar convite de criador.');
  $('banner-title').textContent='Sua comunidade';
};
function navigation(direct=false){
  $('sidebar-scroll-content').classList.toggle('hidden',direct);$('dm-scroll-content').classList.toggle('hidden',!direct);
  $('friends-nav').classList.toggle('active',direct);$('server-banner-box').classList.toggle('hidden',direct);
  $('sidebar-server-title').textContent=direct?'Mensagens Diretas':communities.find(c=>c.id===activeCommunity)?.name||'Órbita';
  $('create-channel').hidden=!managesCommunity();closeMobileMenu();
}
function renderCommunityRail(){
  const nodes=[],keep=new Set();
  for(const c of communities){keep.add(c.id);let b=communityNodes.get(c.id);if(!b){b=button(initials(c.name),()=>openCommunity(b.orbitaCommunity),'server-icon');b.dataset.communityId=c.id;communityNodes.set(c.id,b);}b.orbitaCommunity=c;b.title=c.name;b.setAttribute('aria-label',c.name);b.classList.toggle('active',c.id===activeCommunity&&!home&&!selected?.private);if(b.textContent!==initials(c.name))b.textContent=initials(c.name);nodes.push(b);}
  for(const id of communityNodes.keys())if(!keep.has(id))communityNodes.delete(id);reconcileNodes($('rail-servers-list'),nodes);navigation(home||selected?.private);
}
async function refreshCommunity(c,intent){
  const known=new Set(communityViews.get(c.id)?.channels.map(ch=>ch.id)||[]);
  const found=await checked(db.from('channels').select('*').eq('community_id',c.id).order('position'));
  if(intent!==navigationEpoch||activeCommunity!==c.id)return;
  channels=found;if(!await loadCommunityAccess()||intent!==navigationEpoch)return;
  const allowed=new Set(found.map(ch=>ch.id));conversationCache.retain(key=>!key.includes(':channel:')||![...known].some(id=>key.endsWith(':'+id)&&!allowed.has(id)));
  if(selected&&!selected.private&&!allowed.has(selected.id)){conversationCache.clear();const fallback=found.find(ch=>ch.kind==='text')||found[0];if(fallback)await selectChannel(fallback);else showFriends();}
  else{const updated=found.find(ch=>ch.id===selected?.id);if(updated)Object.assign(selected,updated);renderChannels();renderMembers();$('message-form').hidden=!!selected?.is_announcement&&!hasCommunityPermission('manage_messages');rememberCommunity();}
}
async function openCommunity(c){
  if(!await ensureCommunityWelcome(c.id))return;
  const intent=++navigationEpoch;saveComposerDraft();saveConversation();rememberCommunity();
  const cached=communityViews.get(c.id);
  if(cached&&cached.expires>Date.now()&&cached.channels.length){
    activeCommunity=c.id;[communityRoleList,memberRoles,communityMemberList,communityEmojiList,communityEmojiUrls]=[cached.roles,cached.memberRoles,cached.members,cached.emojis,cached.emojiUrls];channels=cached.channels;
    const target=channels.find(ch=>ch.id===cached.lastChannel)||channels.find(ch=>ch.default_for_new_members&&ch.kind==='text')||channels[0];
    const selection=selectChannel(target),ticket=navigationEpoch;refreshCommunity(c,ticket).catch(error=>{if(ticket===navigationEpoch)toast(errorText(error));});return selection;
  }
  announceMessage('Abrindo servidor '+c.name+'.');
  if(!c.invite_only)await checked(db.rpc('join_public_community',{target:c.id}));
  else if(!(await checked(db.from('community_members').select('user_id').eq('community_id',c.id).eq('user_id',session.user.id).maybeSingle())))throw Error('Este servidor exige um convite válido.');
  if(intent!==navigationEpoch)return;
  activeCommunity=c.id;if(!await loadCommunityAccess()||intent!==navigationEpoch)return;
  const found=await checked(db.from('channels').select('*').eq('community_id',c.id).order('position'));if(activeCommunity!==c.id||intent!==navigationEpoch)return;channels=found;rememberCommunity();renderCommunityRail();
  const target=channels.find(ch=>ch.default_for_new_members&&ch.kind==='text')||channels.find(ch=>ch.kind==='text')||channels.find(ch=>ch.kind==='voice');
  if(target)await selectChannel(target);else{showFriends();toast('Esta comunidade ainda não tem canais. Use o menu para criar o primeiro.');navigation(false);}
}
const baseSelect=selectChannel;
selectChannel=async channel=>{
  const intent=++navigationEpoch;if(channel.community_id&&!await ensureCommunityWelcome(channel.community_id)){showFriends();return;}if(intent!==navigationEpoch)return;
  if(channel.community_id&&activeCommunity!==channel.community_id){activeCommunity=channel.community_id;if(!await loadCommunityAccess())return;}
  if(intent!==navigationEpoch||channel.community_id&&activeCommunity!==channel.community_id)return;
  replyTarget=null;$('reply-banner').classList.add('hidden');
  await baseSelect(channel);syncVoiceChat().catch(error=>toast(errorText(error)));navigation(!!channel.private);renderCommunityRail();rememberCommunity();
  $('message-input').placeholder=channel.private?'Mensagem para '+channel.name:'Conversar em #'+channel.name;
  $('private-call').hidden=!channel.private||channel.kind==='voice';
  $('message-form').hidden=!!channel.is_announcement&&!hasCommunityPermission('manage_messages');
};
const baseShowFriends=showFriends;
showFriends=()=>{baseShowFriends();voiceChat?.update();navigation(true);};
$('friends-nav').onclick=showFriends;$('friends-shortcut').onclick=showFriends;
function updateFounders(){
  const names=siteRoles.filter(r=>r.role==='creator').map(r=>person(r.user_id).display_name);
  $('sidebar-boost-pill').textContent='COMUNIDADE';$('creators-credit').textContent='Criadores · '+(names.join(' & ')||'Órbita');
}
const baseRenderMembers=renderMembers;
renderMembers=()=>{baseRenderMembers();for(const row of [...$('member-list').children]){const name=row.querySelector('strong'),p=people.find(p=>p.id===row.dataset.userId);if(!p)continue;const assigned=memberRoles.filter(r=>r.user_id===p.id).map(m=>communityRoleList.find(role=>role.id===m.role_id)).filter(Boolean).sort((a,b)=>b.position-a.position);if(assigned[0]){name.style.color=assigned[0].color;const badge=el('span','role-badge',assigned[0].name);badge.style.color=assigned[0].color;if(!name.querySelector('.role-badge'))name.append(badge);else name.querySelector('.role-badge').style.color=assigned[0].color;}else if(roleFor(p.id)&&!name.querySelector('.role-badge'))name.append(el('span','role-badge',roleFor(p.id)==='creator'?'CRIADOR':'ADMIN'));setAvatar(row.querySelector('.avatar'),p);}
  const rows=[...$('member-list').children].sort((a,b)=>{const ar=memberRoles.filter(x=>x.user_id===a.dataset.userId).map(x=>communityRoleList.find(r=>r.id===x.role_id)?.position||0),br=memberRoles.filter(x=>x.user_id===b.dataset.userId).map(x=>communityRoleList.find(r=>r.id===x.role_id)?.position||0);return Math.max(0,...br)-Math.max(0,...ar)||Number(online.has(b.dataset.userId))-Number(online.has(a.dataset.userId));});reconcileNodes($('member-list'),rows);updateFounders();};
function safeRichText(text){
  const p=el('p');let last=0;
  const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[\[sticker:[a-z]+\]\]|:[a-z0-9_]{2,32}:|@[A-Za-z0-9_]{3,24}|https:\/\/[^\s<>]+)/g;
  for(const match of text.matchAll(pattern)){
    p.append(document.createTextNode(text.slice(last,match.index)));const value=match[0];
    if(value.startsWith('`')||value.startsWith('**')){const code=value.startsWith('`');p.append(el(code?'code':'strong','',value.slice(code?1:2,code?-1:-2)));}
    else if(value.startsWith('[[sticker:')){const name=value.slice(10,-2);if(stickerNames.includes(name)){const image=el('img','inline-sticker');image.src='/static/stickers/'+name+'.svg';image.alt='Sticker '+name;image.loading='lazy';reserveImage(image,120,120);p.append(image);}else p.append(document.createTextNode(value));}
    else if(value.startsWith(':')&&communityEmojiUrls.has(value)){const image=el('img','inline-custom-emoji');image.src=communityEmojiUrls.get(value);image.alt=value;p.append(image);}
    else if(value.startsWith('@')){const found=peopleByUsername.get(value.slice(1).toLowerCase());if(found)p.append(button(value,()=>showProfile(person(found.id)),'mention'));else p.append(document.createTextNode(value));}
    else{const url=safeLink(value);if(url){if(/\.(gif|webp|png)(\?|$)/i.test(url.pathname)){const image=el('img','inline-sticker');image.src=url.href;image.alt='Imagem ou GIF';reserveImage(image,240,160);image.referrerPolicy='no-referrer';image.loading='lazy';p.append(image);}else{const a=el('a','',value);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';p.append(a);}}else p.append(document.createTextNode(value));}
    last=match.index+value.length;
  }
  p.append(document.createTextNode(text.slice(last)));return p;
}
function renderPoll(message){
  const box=el('div','poll-live');box.append(el('strong','',message.poll.question));
  const votes=message.poll_votes||[],mine=votes.find(v=>v.user_id===session.user.id);
  message.poll.options.forEach((text,index)=>{const count=votes.filter(v=>v.option_index===index).length;const b=button((mine?.option_index===index?'✓ ':'')+text+' · '+count,async()=>{
    const target={...selected},key=target.private?'direct_message_id':'message_id';b.disabled=true;
    try{await checked(db.from('poll_votes').delete().eq(key,message.id).eq('user_id',session.user.id));if(mine?.option_index!==index)await checked(db.from('poll_votes').insert({[key]:message.id,user_id:session.user.id,option_index:index}));await refreshMessage(message.id,target);}finally{b.disabled=false;}
  },'poll-option');box.append(b);});
  box.append(el('small','muted',votes.length+(votes.length===1?' voto':' votos')+' · uma opção por pessoa'));return box;
}
function replyToMessage(message){replyTarget={id:message.id,scope:selected.id};$('reply-target-name').textContent=message.profiles?.display_name||'Participante';$('reply-banner').classList.remove('hidden');$('message-input').focus();}
$('cancel-reply-btn').onclick=()=>{replyTarget=null;$('reply-banner').classList.add('hidden');};
$('create-poll').onclick=()=>showDialog('Criar enquete',container=>{
  $('attach-popover').classList.add('hidden');const form=el('form'),question=inputField(form,'Pergunta','',200),options=el('textarea');options.rows=5;options.placeholder='Uma opção por linha (2 a 6 opções)';options.maxLength=486;form.append(options);
  const save=el('button','primary','Publicar enquete');save.type='submit';form.append(save);container.append(form);const target=selected;
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const choices=options.value.split('\n').map(s=>s.trim()).filter(Boolean);if(choices.length<2||choices.length>6||choices.some(s=>s.length>80)||!question.value.trim())throw Error('Informe uma pergunta e de 2 a 6 opções de até 80 caracteres.');
    await checked(db.from(target.private?'direct_messages':'messages').insert({[scopeKey(target)]:target.id,author_id:session.user.id,content:question.value.trim(),poll:{question:question.value.trim(),options:choices}}));$('app-dialog').close();await refreshMessages();enhancements.dispatchPush();
  }catch(error){toast(errorText(error));}finally{save.disabled=false;}};
});
$('btn-attach').onclick=()=>$('attach-popover').classList.toggle('hidden');
$('insert-code').onclick=()=>{insertComposer(' `seu código` ');$('message-input').focus();$('attach-popover').classList.add('hidden');};
$('btn-emoji').onclick=()=>$('emoji-popover').classList.toggle('hidden');
for(const emoji of ['😀','😂','❤️','👍','🎉','🔥','👀','🚀','🎧','✨','💜','🙌'])$('emoji-grid').append(button(emoji,()=>{insertComposer(emoji);$('emoji-popover').classList.add('hidden');$('message-input').focus();},'emoji-button'));
$('btn-open-add-friend').onclick=()=>{$('friend-username').focus();};
document.querySelectorAll('[data-ftab]').forEach(t=>t.classList.toggle('active',t.dataset.ftab===friendsFilter));
document.querySelectorAll('[data-ftab]').forEach(tab=>tab.onclick=()=>{friendsFilter=tab.dataset.ftab;document.querySelectorAll('[data-ftab]').forEach(t=>t.classList.toggle('active',t===tab));renderFriends();});
$('server-header-btn').onclick=()=>$('server-dropdown').classList.toggle('hidden');
document.querySelectorAll('.category-header').forEach(header=>header.onclick=e=>{if(!e.target.closest('button'))header.parentElement.classList.toggle('collapsed');});
$('dd-create-channel-btn').onclick=()=>{$('server-dropdown').classList.add('hidden');$('create-channel').click();};
$('dd-settings-btn').onclick=()=>{$('server-dropdown').classList.add('hidden');openManagement();};
function createCommunity(){showDialog('Criar comunidade',container=>{
  const form=el('form'),name=inputField(form,'Nome','',60),description=inputField(form,'Descrição','',240),save=el('button','primary','Criar comunidade');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const c=await checked(db.from('communities').insert({name:name.value.trim(),description:description.value.trim()}).select().single());communities.push(c);const channel=await insertChannel({name:'geral',kind:'text',community_id:c.id,position:0});channels.push(channel);$('app-dialog').close();await openCommunity(c);}catch(error){toast(errorText(error));}finally{save.disabled=false;}};
});}
$('btn-add-server').onclick=createCommunity;
$('btn-explore-servers').onclick=()=>showDialog('Explorar comunidades',container=>{
  container.append(el('p','muted','As comunidades desta versão são abertas às contas cadastradas.'));
  for(const c of communities){const card=el('article','community-card');card.append(el('strong','',c.name),el('p','muted',c.description||'Uma comunidade da Órbita'),button('Abrir',()=>{$('app-dialog').close();return openCommunity(c);},'primary'));container.append(card);}
});
async function copyInvitation(){const url=new URL(location.origin);url.searchParams.set('community',activeCommunity);await navigator.clipboard.writeText(url.href);toast('Link da comunidade copiado.');}
$('dd-invite-btn').onclick=()=>copyInvitation().catch(e=>toast(errorText(e)));
$('dm-quick-find').onclick=()=>showDialog('Busca rápida',container=>{const form=el('form'),input=inputField(form,'Canal ou @ de um amigo','',60),go=el('button','primary','Abrir');go.type='submit';form.append(go);container.append(form);form.onsubmit=async e=>{e.preventDefault();try{const text=input.value.trim().replace(/^[@#]/,'').toLowerCase(),ch=channels.find(c=>c.name.toLowerCase()===text),p=people.find(p=>p.username===text||p.display_name.toLowerCase()===text);if(ch){$('app-dialog').close();await selectChannel(ch);}else if(p){$('app-dialog').close();await startConversation(p);}else toast('Nenhum canal ou usuário encontrado.');}catch(error){toast(errorText(error));}};});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('dm-quick-find').click();}});
$('btn-search-toggle').onclick=()=>$('search-messages').focus();
// The right member column has been removed; profiles remain available in chat and calls.
document.body.classList.add('members-hidden');document.body.classList.remove('members-open');$('members-sidebar').hidden=true;$('btn-members-toggle').hidden=true;$('btn-members-toggle').onclick=null;
  $('mobile-menu-btn').onclick=()=>{const open=document.body.classList.toggle('mobile-menu-open');$('mobile-menu-btn').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',event=>{if(!document.body.classList.contains('mobile-menu-open'))return;const target=event.target;if(!(target instanceof Element)||!target.closest('.sidebar,.rail,#mobile-menu-btn,.mobile-nav-btn'))closeMobileMenu();});
for(const view of ['friends-view','voice-view']){const target=$(view).querySelector('.chat-title');const menu=button('☰',()=>{const open=document.body.classList.toggle('mobile-menu-open');menu.setAttribute('aria-expanded',String(open));},'mobile-nav-btn');menu.setAttribute('aria-label','Menu de canais');menu.setAttribute('aria-expanded','false');target.prepend(menu);}

$('up-profile-btn').onclick=()=>{
  if (profile) showProfile(profile);
  else $('status-popover').classList.toggle('hidden');
};
document.querySelectorAll('.sp-opt').forEach(opt=>opt.onclick=async()=>{try{const value=opt.dataset.status==='offline'?'invisible':opt.dataset.status||'online';await checked(db.from('profiles').update({presence_status:['online','idle','dnd','invisible'].includes(value)?value:'online'}).eq('id',session.user.id));$('status-popover').classList.add('hidden');await loadSocial();if(presenceChannel){if(value==='invisible')await presenceChannel.untrack();else await publishVoicePresence(true);}updateSelfStatus();}catch(e){toast(errorText(e));}});
$('save-custom-status-btn').onclick=async()=>{try{await checked(db.from('profiles').update({custom_status:$('custom-status-input').value.trim().slice(0,80)}).eq('id',session.user.id));await loadSocial();updateSelfStatus();$('status-popover').classList.add('hidden');}catch(e){toast(errorText(e));}};
function updateSelfStatus(){if(!profile)return;$('self-status-text').textContent=profile.custom_status||({online:'Disponível',idle:'Ausente',dnd:'Não perturbar',invisible:'Invisível'}[profile.presence_status]||'Disponível');$('self-status-dot').style.background=({online:'var(--online)',idle:'var(--idle)',dnd:'var(--dnd)',invisible:'var(--offline)'}[profile.presence_status]);}
const baseLoadSocial=loadSocial;loadSocial=async()=>{await baseLoadSocial();updateSelfStatus();};
const baseSettings=$('settings').onclick;
$('settings').onclick=()=>{
  baseSettings();const container=$('dialog-content'),appearance=el('div');
  loadExtraThemes().catch(error=>toast(errorText(error)));
  const themeLabel=el('label','field','Tema'),theme=el('select');for(const [key,label]of[['orbita','Violeta Órbita'],['blurple','Blurple'],['emerald','Emerald'],['nitro','Pink'],['cyber','Cyber Neon'],['forest','Floresta'],['ocean','Oceano'],['sunset','Pôr do Sol'],['midnight','Meia-Noite'],['blood','Sangue'],['gold','Ouro'],['sakura','Sakura']]){const option=el('option','',label);option.value=key;theme.append(option);}theme.value=localStorage.getItem('orbita-theme')||'orbita';theme.setAttribute('aria-label','Tema');themeLabel.append(theme);appearance.append(themeLabel);
  const densityLabel=el('label','field','Densidade'),density=el('select');for(const value of ['cozy','compact']){const option=el('option','',value==='cozy'?'Confortável':'Compacta');option.value=value;density.append(option);}density.value=localStorage.getItem('orbita-density')||'cozy';densityLabel.append(density);appearance.append(densityLabel);
  for(const [input,key]of[[theme,'theme'],[density,'density']])input.onchange=()=>{localStorage.setItem('orbita-'+key,input.value);document.body.dataset[key]=input.value;};
  container.append(appearance,button('Aceitar convite de criador',()=>showCreatorInvite()),button('Sobre esta versão',()=>openCloud()));
  if(isAdmin())container.append(button('Administrar o site',()=>openManagement(),'primary'));
};
function showCreatorInvite(){showDialog('Convite de criador — Kalil',container=>{
  container.append(el('p','muted','Use a conta de Kalil. O convite é privado e só pode ser usado uma vez.'));
  const form=el('form'),input=inputField(form,'Código do convite',new URLSearchParams(location.hash.slice(1)).get('convite')||'',256),save=el('button','primary','Assumir administração');input.type='password';save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await checked(db.rpc('claim_creator_invite',{invitation:input.value.trim()}));siteRoles=await checked(db.from('site_roles').select('*'));history.replaceState(null,'',location.pathname+location.search);$('app-dialog').close();renderMembers();toast('Conta vinculada como criador e administrador.');}catch(error){toast(errorText(error));}finally{save.disabled=false;}};
});}
function openManagement(){showDialog(isAdmin()?'Administração do site':'Configurações da comunidade',container=>{
  const c=communities.find(c=>c.id===activeCommunity);container.append(el('p','muted',isAdmin()?'Você pode administrar todas as comunidades e moderar mensagens públicas. As conversas privadas mantêm suas permissões.':'A administração desta comunidade pertence ao criador dela.'));
  if(!managesCommunity()){container.append(el('p','','Você não tem permissão para alterar esta comunidade.'));return;}
  const form=el('form'),name=inputField(form,'Nome',c?.name,60),description=inputField(form,'Descrição',c?.description,240),save=el('button','primary','Salvar comunidade');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async e=>{e.preventDefault();try{await checked(db.from('communities').update({name:name.value.trim(),description:description.value.trim()}).eq('id',activeCommunity));c.name=name.value.trim();c.description=description.value.trim();renderCommunityRail();toast('Comunidade atualizada.');}catch(error){toast(errorText(error));}};
  const actions=el('div','admin-menu');actions.append(button('Criar canal',()=>{$('app-dialog').close();$('create-channel').click();}),button('Sobre esta versão',()=>openCloud()));container.append(actions);
  for(const channel of channels.filter(ch=>ch.community_id===activeCommunity)){const row=el('div','community-card');row.append(el('strong','',channel.name),button('Editar',()=>editChannel(channel)));container.append(row);}
});}
function editChannel(channel){showDialog('Editar canal',container=>{const form=el('form'),name=inputField(form,'Nome',channel.name,40),description=inputField(form,'Descrição',channel.description,240),save=el('button','primary','Salvar');save.type='submit';form.append(save);container.append(form);form.onsubmit=async e=>{e.preventDefault();try{await checked(db.from('channels').update({name:name.value.trim(),description:description.value.trim()}).eq('id',channel.id));channel.name=name.value.trim();channel.description=description.value.trim();renderChannels();if(selected?.id===channel.id)await selectChannel(channel);$('app-dialog').close();}catch(error){toast(errorText(error));}};
container.append(button('Excluir canal e seu histórico',()=>showDialog('Excluir canal',box=>{box.append(el('p','','A exclusão remove permanentemente o histórico deste canal. Confirme somente se desejar apagar esses dados.'),button('Excluir permanentemente',async()=>{if(channel.kind==='voice'&&config.callsConfigured)await apiFetch(`/api/channels/${channel.id}/live-room`,{method:'DELETE'});await checked(db.from('channels').delete().eq('id',channel.id));channels=channels.filter(ch=>ch.id!==channel.id);$('app-dialog').close();renderChannels();if(selected?.id===channel.id)showFriends();},'danger'));}),'danger'));});}
function openCloud(){showDialog('Sobre esta versão',container=>{container.append(el('p','','Contas, mensagens e arquivos privados no Supabase. Chamadas de voz, vídeo e compartilhamento de tela com LiveKit. O áudio da tela depende do navegador e da opção marcada ao compartilhar.'));});}
$('dd-boost-btn').onclick=openCloud;$('banner-action-btn').onclick=openCloud;$('drive-info').onclick=openCloud;
$('up-mic-btn').onclick=()=>$('mic').click();$('up-deafen-btn').onclick=()=>$('deafen').click();$('vb-mic').onclick=()=>$('mic').click();$('vb-video').onclick=()=>$('camera').click();$('dock-name').onclick=()=>{if(callChannel)selectChannel(callChannel);};
$('back-to-call').onclick=()=>{if(selected?.private){const c=conversations.find(c=>c.id===selected.id);if(c)openConversation(c);}else{const c=channels.find(c=>c.community_id===activeCommunity&&c.kind==='text');if(c)selectChannel(c);}};
$('connection-info').onclick=()=>showDialog('Conexão da chamada',container=>{container.append(el('p','',room?'Estado: '+room.state:'Você ainda não está em uma chamada.'));if(room){container.append(el('p','','Qualidade local: '+room.localParticipant.connectionQuality));for(const p of room.remoteParticipants.values())container.append(el('p','',(p.name||'Participante')+' · '+p.connectionQuality));}container.append(el('p','muted',`Vídeo adaptativo: perfil ${mediaSettings().mode}. O navegador ajusta a recepção à rede; áudio da tela só é liberado em abas e navegadores compatíveis.`));});
function receiveCallData(...args){callReactions?.receive(...args);}
const screenLabel=el('label','screen-option'),screenCheck=el('input');screenCheck.type='checkbox';screenCheck.id='share-screen-audio';screenCheck.checked=localStorage.getItem('orbita-screen-audio')!=='false';screenLabel.append(screenCheck,document.createTextNode('Incluir áudio da tela (autorize também na janela do navegador)'));$('active-controls').before(screenLabel);
function updateScreenAudio(){localStorage.setItem('orbita-screen-audio',String(screenCheck.checked));}
screenCheck.onchange=updateScreenAudio;updateScreenAudio();
$('btn-notif-toggle').onclick=async()=>{if(!('Notification'in window))return toast('Este navegador não oferece notificações.');const permission=await Notification.requestPermission();toast(permission==='granted'?'Notificações ativadas neste navegador.':'Notificações não autorizadas.');};
function loadExtraThemes(){return loadStyle('/static/themes.css');}
if((localStorage.getItem('orbita-theme')||'orbita')!=='orbita')loadExtraThemes().catch(error=>toast(errorText(error)));
document.body.dataset.theme=localStorage.getItem('orbita-theme')||'orbita';document.body.dataset.density=localStorage.getItem('orbita-density')||'cozy';
window.addEventListener('pagehide',()=>{if(extraSubscription)db?.removeChannel(extraSubscription);});

async function publishVoicePresence(force=false){
  if(!presenceChannel||!session||!profile)return;
  if(profile.presence_status==='invisible'){if(force)await presenceChannel.untrack();return;}
  const value={status:enhancements?.presenceStatus()||profile.presence_status||'online',channel_id:room&&!callChannel?.private&&!callChannel?.is_private&&!communities.find(c=>c.id===callChannel?.community_id)?.invite_only?callChannel?.id:null,microphone:!!room?.localParticipant.isMicrophoneEnabled,screen:!!room?.localParticipant.isScreenShareEnabled};
  const signature=JSON.stringify(value);if(!force&&signature===lastPresenceSignature)return;lastPresenceSignature=signature;await presenceChannel.track(value);
}

// Community invitations, permissions, media uploads, and push-to-talk controls.
async function createCommunityInvite(){
  const {data:token,error}=await db.rpc('create_community_invite',{target:activeCommunity,expires_hours:168,uses_limit:100});if(error)throw error;
  const url=new URL(location.origin);url.searchParams.set('invite',token);try{await navigator.clipboard.writeText(url.href);toast('Convite copiado. Válido por 7 dias e até 100 entradas.');}catch{toast('Link criado. Selecione e copie o endereço exibido.');}return url.href;
}
function showCommunityInvite(){showDialog('Convidar pessoas',container=>{
  container.append(el('p','muted','Gere um link de convite para este servidor. Quem receber o link entra com a própria conta Órbita.'));
  const create=button('Criar link de convite',async()=>{const url=await createCommunityInvite();const output=el('input','invite-link');output.readOnly=true;output.value=url;container.append(output);output.select();});container.append(create);
});}
$('dd-invite-btn').onclick=()=>showCommunityInvite();

const baseOpenManagement=openManagement;
openManagement=()=>{
  const owner=isAdmin()||communities.find(item=>item.id===activeCommunity)?.created_by===session?.user.id;
  if(!owner){showDialog('Controles do servidor',container=>{container.append(el('p','muted','As permissões do seu cargo definem quais ferramentas você pode usar.'));if(hasCommunityPermission('manage_channels'))container.append(button('Criar canal',()=>{$('app-dialog').close();$('create-channel').click();}));if(isAdmin()||communities.find(item=>item.id===activeCommunity)?.created_by===session?.user.id)container.append(button('Cargos e membros',()=>showCommunityRoles()));if(hasCommunityPermission('create_invite'))container.append(button('Criar convite',()=>showCommunityInvite()));if(!container.children.length)container.append(el('p','','Seu cargo não permite alterar este servidor.'));});return;}
  baseOpenManagement();if(!managesCommunity())return;
  const container=$('dialog-content'),c=communities.find(item=>item.id===activeCommunity),form=container.querySelector('form');
  if(form&&c){const inviteOnly=el('label','check-field'),check=el('input');check.type='checkbox';check.checked=!!c.invite_only;inviteOnly.append(check,document.createTextNode('Servidor acessível somente por convite'));form.append(inviteOnly);
    form.onsubmit=async event=>{event.preventDefault();const fields=[...form.querySelectorAll('.field input')];try{await checked(db.from('communities').update({name:fields[0].value.trim(),description:fields[1].value.trim(),invite_only:check.checked}).eq('id',activeCommunity));c.name=fields[0].value.trim();c.description=fields[1].value.trim();c.invite_only=check.checked;renderCommunityRail();toast('Servidor atualizado.');}catch(error){toast(errorText(error));}};}
  const actions=container.querySelector('.admin-menu');if(actions){if(isAdmin()||c?.created_by===session?.user.id)actions.append(button('Cargos e membros',()=>showCommunityRoles()));if(hasCommunityPermission('manage_roles'))actions.append(button('Emojis do servidor',()=>showCommunityEmojis()));if(hasCommunityPermission('create_invite'))actions.append(button('Criar convite',()=>showCommunityInvite()));}
};
function showCommunityRoles(){showDialog('Cargos e membros',container=>{
  const list=el('div');for(const role of communityRoleList){const row=el('article','community-card'),title=el('strong','',role.name);title.style.color=role.color;row.append(title,el('small','muted',' · posição '+role.position),button('Excluir',async()=>{await checked(db.from('community_roles').delete().eq('id',role.id));await syncCommunityVoice();await loadCommunityAccess();showCommunityRoles();},'text-button'));list.append(row);}container.append(list);
  const form=el('form'),name=inputField(form,'Nome do cargo','',32),color=inputField(form,'Cor do cargo','#99aab5',7);color.type='color';const permissions=el('fieldset','role-permissions');permissions.append(el('legend','','Permissões'));
  const options=[['manage_channels','Gerenciar canais'],['manage_roles','Gerenciar cargos e emojis'],['manage_messages','Gerenciar mensagens e publicar anúncios'],['create_invite','Criar convites'],['manage_members','Gerenciar membros']];
  for(const [value,labelText]of options){const label=el('label','check-field'),input=el('input');input.type='checkbox';input.value=value;label.append(input,document.createTextNode(labelText));permissions.append(label);}form.append(permissions);const save=el('button','primary','Criar cargo');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const perms=[...permissions.querySelectorAll('input:checked')].map(input=>input.value);await checked(db.from('community_roles').insert({community_id:activeCommunity,name:name.value.trim(),color:color.value,position:communityRoleList.length+1,permissions:perms}));await loadCommunityAccess();showCommunityRoles();}catch(error){toast(errorText(error));}finally{save.disabled=false;}};
  const heading=el('h3','','Atribuir cargo');container.append(heading);
  for(const member of communityMemberList){const p=person(member.user_id),row=el('label','role-assignment',p.display_name),select=el('select');const none=el('option','','Sem cargo');none.value='';select.append(none);for(const role of communityRoleList){const option=el('option','',role.name);option.value=role.id;option.style.color=role.color;select.append(option);}select.value=memberRoles.find(item=>item.user_id===member.user_id)?.role_id||'';select.onchange=async()=>{try{await checked(db.from('community_member_roles').delete().eq('community_id',activeCommunity).eq('user_id',member.user_id));if(select.value)await checked(db.from('community_member_roles').insert({community_id:activeCommunity,user_id:member.user_id,role_id:select.value}));await syncCommunityVoice();await loadCommunityAccess();renderMembers();}catch(error){toast(errorText(error));}};row.append(select);container.append(row);}
});}
function showCommunityEmojis(){showDialog('Emojis personalizados',container=>{
  for(const emoji of communityEmojiList){const row=el('div','emoji-admin-row'),img=el('img');img.src=communityEmojiUrls.get(':'+emoji.name+':')||'';img.alt=emoji.name;row.append(img,el('strong','',':'+emoji.name+':'),button('Remover',async()=>{await checked(db.from('community_emojis').delete().eq('id',emoji.id));await db.storage.from('orbita-files').remove([emoji.storage_path]);await loadCommunityAccess();showCommunityEmojis();},'text-button'));container.append(row);}
  const form=el('form'),name=inputField(form,'Nome (2–32 letras, números ou _)','',32),file=el('input');file.type='file';file.accept='image/png,image/webp,image/gif';form.append(file);const save=el('button','primary','Adicionar emoji');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;const image=file.files[0];try{if(!/^[a-z0-9_]{2,32}$/.test(name.value.trim().toLowerCase()))throw Error('Use letras minúsculas, números e _ no nome.');if(!image||!/^image\/(png|webp|gif)$/.test(image.type)||image.size>512*1024)throw Error('Escolha PNG, WebP ou GIF de até 512 KB.');const path=`community-assets/${activeCommunity}/${session.user.id}/emojis/${crypto.randomUUID()}.${image.type.split('/')[1]}`;const uploaded=await db.storage.from('orbita-files').upload(path,image,{contentType:image.type,upsert:false});if(uploaded.error)throw uploaded.error;try{await checked(db.from('community_emojis').insert({community_id:activeCommunity,name:name.value.trim().toLowerCase(),storage_path:path,created_by:session.user.id}));}catch(error){await db.storage.from('orbita-files').remove([path]);throw error;}await loadCommunityAccess();showCommunityEmojis();}catch(error){toast(errorText(error));}finally{save.disabled=false;}};
});}

const baseEditChannel=editChannel;
editChannel=channel=>showDialog('Editar canal',container=>{
  const form=el('form'),name=inputField(form,'Nome',channel.name,40),description=inputField(form,'Descrição',channel.description,240),options=channelEditFields(form,channel),save=el('button','primary','Salvar canal');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{
    if(options.defaultBox.checked)await checked(db.from('channels').update({default_for_new_members:false}).eq('community_id',activeCommunity).eq('kind','text').eq('default_for_new_members',true));
    await checked(db.from('channels').update({name:name.value.trim(),description:description.value.trim(),is_stage:channel.kind==='voice'&&options.stageBox.checked,is_private:options.privateBox.checked,is_announcement:channel.kind==='text'&&options.announceBox.checked,default_for_new_members:channel.kind==='text'&&options.defaultBox.checked}).eq('id',channel.id));
    channel.name=name.value.trim();channel.description=description.value.trim();channel.is_stage=channel.kind==='voice'&&options.stageBox.checked;channel.is_private=options.privateBox.checked;channel.is_announcement=channel.kind==='text'&&options.announceBox.checked;channel.default_for_new_members=channel.kind==='text'&&options.defaultBox.checked;
    if(channel.is_private){await checked(db.from('channel_members').delete().eq('channel_id',channel.id));const ids=[...new Set([session.user.id,...[...options.memberSelect.selectedOptions].map(o=>o.value)])];await checked(db.from('channel_members').insert(ids.map(user_id=>({channel_id:channel.id,user_id,added_by:session.user.id}))).select());}
    let voiceWarning=false;try{await syncChannelVoice(channel);}catch{voiceWarning=true;}
    renderChannels();if(selected?.id===channel.id)await selectChannel(channel);$('app-dialog').close();toast(voiceWarning?'Canal salvo. Salve novamente para tentar sincronizar os participantes da chamada.':'Canal atualizado.');
  }catch(error){toast(errorText(error));}finally{save.disabled=false;}};
  container.append(button('Excluir canal e seu histórico',()=>showDialog('Excluir canal',box=>{box.append(el('p','','A exclusão remove permanentemente o histórico deste canal.'),button('Excluir permanentemente',async()=>{if(channel.kind==='voice'&&config.callsConfigured)await apiFetch(`/api/channels/${channel.id}/live-room`,{method:'DELETE'});await checked(db.from('channels').delete().eq('id',channel.id));channels=channels.filter(item=>item.id!==channel.id);$('app-dialog').close();renderChannels();if(selected?.id===channel.id)showFriends();},'danger'));}),'danger'));
});

const microphoneSwitch=serialToggle(async(participant,value)=>{await participant.setMicrophoneEnabled(value,audioCapture());if(room?.localParticipant===participant)updateCallUI();},(error,participant)=>{if(room?.localParticipant===participant)toast(errorText(error));});
function setTalkHeld(value){if(!room||!pushToTalk||talkHeld===value||value&&(deafened||room.localParticipant.permissions?.canPublish===false))return;talkHeld=value;microphoneSwitch.set(room.localParticipant,value);if(pttButton)pttButton.textContent=value?'Falando…':'Segure para falar';}
pttButton=button('Segure para falar',()=>{},'vc-btn ptt-button');pttButton.setAttribute('aria-label','Segure para falar');$('mic').after(pttButton);
pttButton.addEventListener('pointerdown',event=>{event.preventDefault();pttButton.setPointerCapture?.(event.pointerId);setTalkHeld(true);});
for(const eventName of ['pointerup','pointercancel','lostpointercapture'])pttButton.addEventListener(eventName,()=>setTalkHeld(false));
document.addEventListener('keydown',event=>{if(event.code!=='Space'||!pushToTalk||!room||$('voice-view').hidden||event.repeat||$('app-dialog').open||(document.activeElement!==pttButton&&document.activeElement?.closest('input,textarea,select,button,a,[role=button],[contenteditable=true]')))return;event.preventDefault();setTalkHeld(true);});
document.addEventListener('keyup',event=>{if(event.code==='Space')setTalkHeld(false);});
window.addEventListener('blur',()=>setTalkHeld(false));
document.addEventListener('visibilitychange',()=>{if(document.hidden)setTalkHeld(false);});
const priorUpdateCallUI=updateCallUI;
updateCallUI=()=>{priorUpdateCallUI();if(pttButton){const active=!!room&&callChannel?.id===selected?.id&&selected?.kind==='voice';pttButton.hidden=!active||!pushToTalk;pttButton.textContent=talkHeld?'Falando…':'Segure para falar';}};

const gifButton=button('🎞 GIF ou sticker','', 'soft-button');gifButton.onclick=()=>{showDialog('Enviar GIF ou sticker',container=>{container.append(el('p','muted','Envie um GIF/figurinha do dispositivo ou cole um link direto do Giphy ou Tenor.'));container.append(button('Escolher GIF do dispositivo',()=>{$('app-dialog').close();$('file-input').accept='image/gif,image/webp';$('file-input').click();}));const form=el('form'),url=inputField(form,'Link direto HTTPS para GIF','',500),send=el('button','primary','Inserir link');send.type='submit';form.append(send);container.append(form);form.onsubmit=event=>{event.preventDefault();try{const parsed=new URL(url.value.trim());if(parsed.protocol!=='https:'||!/(^|\.)giphy\.com$|(^|\.)tenor\.com$/.test(parsed.hostname)||!/\.(gif|webp|png)(\?|$)/i.test(parsed.pathname+parsed.search))throw Error('Use um link direto seguro do Giphy ou Tenor terminando em GIF, WebP ou PNG.');$('message-input').value+=' '+parsed.href;$('app-dialog').close();$('message-input').focus();}catch(error){toast(errorText(error));}};});};
$('attach-popover').append(gifButton);
updateSelfStatus=function(){if(!profile)return;$('self-status-text').textContent=profile.custom_status||profile.presence_activity||({online:'Disponível',idle:'Ausente',dnd:'Não perturbe',invisible:'Invisível'}[profile.presence_status]||'Disponível');$('self-status-dot').style.background=({online:'var(--online)',idle:'var(--idle)',dnd:'var(--dnd)',invisible:'var(--offline)'}[profile.presence_status]);};

createCommunity=()=>showDialog('Criar servidor',container=>{
  const form=el('form'),name=inputField(form,'Nome','',60),description=inputField(form,'Descrição','',240),save=el('button','primary','Criar servidor');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const c=await checked(db.from('communities').insert({name:name.value.trim(),description:description.value.trim()}).select().single());communities.push(c);const channel=await insertChannel({name:'geral',kind:'text',position:0,community_id:c.id,default_for_new_members:true});channels.push(channel);$('app-dialog').close();await openCommunity(c);}catch(error){toast(errorText(error));}finally{save.disabled=false;}};
});
$('btn-add-server').onclick=createCommunity;
const initialRenderChannels=renderChannels;
renderChannels=()=>{initialRenderChannels();for(const node of channelNodes.values()){const channel=node.orbitaChannel;if(channel){node.title=[channel.is_private?'Canal privado':null,channel.is_announcement?'Canal de anúncios':null,channel.default_for_new_members?'Canal padrão':null].filter(Boolean).join(' · ')||channel.description||channel.name;if(channel.is_private||channel.is_announcement){let mark=node.querySelector('.channel-kind-badge');if(!mark){mark=el('span','channel-kind-badge');node.append(mark);}mark.textContent=channel.is_private?'🔒':'📣';}else node.querySelector('.channel-kind-badge')?.remove();}}};
const priorCallUpdate=updateCallUI;
updateCallUI=()=>{if(!room)talkHeld=false;priorCallUpdate();if(pttButton){const active=!!room&&callChannel?.id===selected?.id&&selected?.kind==='voice';pttButton.hidden=!active||!pushToTalk;pttButton.textContent=talkHeld?'Falando…':'Segure para falar';pttButton.setAttribute('aria-pressed',String(talkHeld));}};

enhancements=initEnhancements({clearDrafts:()=>{drafts.erase();if(selected?.kind==='text')$('message-input').value='';},
  state:()=>({db,config,session,selected,messages,room,callChannel,profile,people,channels,conversations,communities,activeCommunity,home,deafened,communityMemberList}),
  el,button,toast,checked,showDialog,inputField,errorText,apiFetch,insertText:insertComposer,
  get messageFields(){return messageFields;},
  richText:text=>safeRichText(text),
  refreshMessages:()=>refreshMessages(),replyToMessage:message=>replyToMessage(message),
  messageAction:(message,action)=>messageAction(message,action),
  selectChannel:channel=>selectChannel(channel),openConversation:conversation=>openConversation(conversation),
  uploadFile:(file,target)=>uploadFile(file,target),downloadAttachment:a=>downloadAttachment(a),resolveAttachmentUrl:a=>resolveAttachmentUrl(a),
  hasPermission:permission=>hasCommunityPermission(permission),publishPresence:()=>publishVoicePresence(true),
  updateCallUI:()=>updateCallUI(),closeMobileMenu,
  moderationChanged:async row=>{if(!row||row.user_id!==session?.user.id)return;if(row.banned&&callChannel?.community_id===row.community_id)await leaveCall();channels=await checked(db.from('channels').select('*').order('position'));if(selected&&!selected.private&&!channels.some(c=>c.id===selected.id))showFriends();renderChannels();toast(row.banned?'Seu acesso a este servidor foi suspenso.':row.timeout_until&&new Date(row.timeout_until)>new Date()?'Você está silenciado até '+new Date(row.timeout_until).toLocaleString('pt-BR'):'Sua restrição foi atualizada.');},
  revealMessage:message=>{messages.set(message.id,message);renderMessages();requestAnimationFrame(()=>{const node=document.querySelector('[data-message-id="'+CSS.escape(message.id)+'"]');node?.scrollIntoView({block:'center'});node?.classList.add('message-target');});},
  loadMessages:()=>loadMessages(generation)
});
const selectBeforeEnhancements=selectChannel;
selectChannel=async channel=>{await selectBeforeEnhancements(channel);await enhancements.channelChanged();};
const friendsBeforeEnhancements=showFriends;
showFriends=()=>{friendsBeforeEnhancements();enhancements.channelChanged().catch(()=>{});};
const channelsBeforeEnhancements=renderChannels;
renderChannels=()=>{channelsBeforeEnhancements();enhancements.decorateNavigation();};
const callBeforeEnhancements=updateCallUI;
updateCallUI=()=>{callBeforeEnhancements();enhancements.callUpdated();if(room?.state==='connected'){const canPublish=room.localParticipant.permissions?.canPublish!==false;for(const id of ['mic','camera','screen'])$(id).disabled=!canPublish||(id==='screen'&&!canShareScreen)||(id==='mic'&&deafened);if(pttButton)pttButton.disabled=!canPublish||deafened;if(room.orbitaStage)$('call-status').textContent+=' · '+(canPublish?'Orador':'Plateia — peça a um moderador para falar');}};
gifButton.onclick=()=>enhancements.showMediaPicker();
$('file-input').multiple=true;
$('file-input').onchange=async()=>{const files=[...$('file-input').files];await enhancements.sendFiles(files);$('file-input').value='';$('file-input').accept='';};
const updateBeforeDeviceControls=updateCallUI;
updateCallUI=()=>{updateBeforeDeviceControls();updateCameraControl();};
callLayout=initCallLayout({audioSettings:()=>audioTools?.open(),soundSettings:box=>enhancements?.soundFields(box),
  state:()=>({room,selected,callChannel,deafened}),report:error=>toast(errorText(error)),toast,button,dialog:showDialog,
  paragraph:text=>el('p','muted',text),invite:()=>{if(selected?.private)showDialog('Chamada privada',box=>box.append(el('p','','Esta conversa é privada. Abra Amigos para iniciar uma chamada com outra pessoa.'),button('Abrir Amigos',()=>{$('app-dialog').close();showFriends();})));else showCommunityInvite();},
  avatar:(node,id)=>{const p=person(id);if(p.display_name==='Participante'){p.display_name=node.parentElement.querySelector('.participant-name')?.textContent||p.display_name;}setAvatar(node,p);},
  participant:participant=>showDialog(participant.name||'Participante',box=>{
    box.append(el('p','muted',qualityText(participant.connectionQuality)));
    if(participant.isLocal){box.append(button('Meu perfil e áudio',()=>{$('app-dialog').close();$('settings').click();}));return;}
    for(const [source,label] of [['microphone','Microfone'],['screen_share_audio','Transmissão de tela']]){const field=volumeControl(participant,source,label),slider=field.querySelector('input');slider.setAttribute('aria-label',(source==='microphone'?'Volume do microfone de ':'Volume da transmissão de ')+(participant.name||'Participante'));slider.value=sourceVolume(participant.identity,source);field.querySelector('output').value=Math.round(Number(slider.value)*100)+'%';box.append(field);}
    box.append(el('p','muted','Estes volumes alteram apenas o que você ouve.'));
  })
});
const updateBeforeCallLayout=updateCallUI;
updateCallUI=()=>{updateBeforeCallLayout();callLayout.update();};
const feedContext={
  state:()=>({db,session,profile,moderator:siteRoles.some(role=>role.user_id===session?.user.id&&['creator','admin'].includes(role.role))}),
  el,toast,checked,showDialog,tools:async action=>{const tools=await loadSocialTools();if(session)tools[action]();},sharePost:post=>sharePostToConversation(post),questions:async id=>{const tools=await loadSocialTools();if(session)tools.questions(id);},
  profile:p=>p.id===session?.user.id?$('settings').click():showProfile(person(p.id)||p),
  open:()=>{navigationEpoch++;saveComposerDraft();saveConversation();stopConversation();generation++;home=true;selected=null;
    for(const id of ['text-view','voice-view','friends-view'])$(id).hidden=true;
    renderChannels();renderSocial();updateCallUI();enhancements.channelChanged().catch(()=>{});},
  menu:()=>{document.body.classList.add('mobile-menu-open');document.querySelectorAll('.mobile-nav-btn').forEach(node=>node.setAttribute('aria-expanded','true'));},
  closeMenu:closeMobileMenu,
  rooms:()=>channels.filter(c=>c.kind==='voice'&&!c.is_private).map(c=>({...c,participants:publicVoicePresence.filter(p=>p.channel_id===c.id).length})),
  joinRoom:async channel=>{await selectChannel(channel);$('join-call').click();}
};
let feedInstance,feedTask,feedNavigation=0;
const feedNav=el('button','server-icon action-rail','◈');feedNav.id='feed-nav';feedNav.title='Feed da Órbita';feedNav.setAttribute('aria-label',feedNav.title);$('friends-nav').after(feedNav);
async function loadFeed(){if(feedInstance)return feedInstance;if(!feedTask)feedTask=Promise.all([import('./social-feed.js'),loadStyle('/static/social-feed.css')]).then(([module])=>feedInstance=module.initSocialFeed(feedContext)).catch(error=>{feedTask=null;throw error;});return feedTask;}
feed={open:async(...args)=>{const uid=session?.user.id,epoch=++feedNavigation;try{const instance=await loadFeed();if(uid===session?.user.id&&epoch===feedNavigation)return instance.open(...args);}catch(error){toast(errorText(error));}},hide:()=>{feedNavigation++;feedInstance?.hide();},sessionChanged:()=>{feedNavigation++;feedInstance?.sessionChanged();},deepLink:()=>{if(new URL(location.href).searchParams.has('post'))loadFeed().then(instance=>instance.deepLink()).catch(error=>toast(errorText(error)));}};
feedNav.onclick=()=>feed.open();

boot();


// === Profile customization (Discord-like) ===
const PROFILE_PREFS_KEY = 'orbita-profile-prefs';
function loadProfilePrefs() {
  try { return JSON.parse(localStorage.getItem(PROFILE_PREFS_KEY+':'+(session?.user.id||'guest')) || '{}') || {}; }
  catch { return {}; }
}
function saveProfilePrefs(prefs) {
  localStorage.setItem(PROFILE_PREFS_KEY+':'+(session?.user.id||'guest'), JSON.stringify(prefs));
  applyProfileStyles();
}
function applyProfileStyles() {
  const prefs = loadProfilePrefs();
  document.querySelectorAll('.message-meta strong, .up-name, .participant-name, .member-name, .member strong, .rp-name').forEach(el => {
    el.classList.remove('name-font-inter','name-font-mono','name-font-serif','name-font-display','name-effect-glow','name-effect-shimmer','name-effect-rainbow');
    const card=el.closest('[data-user-id],[data-participant-id],[data-message-id]');
    const owner=el.classList.contains('up-name') || card?.dataset.userId===session?.user.id || card?.dataset.participantId===session?.user.id || messages.get(card?.dataset.messageId)?.author_id===session?.user.id;
    if(owner && ['inter','mono','serif','display'].includes(prefs.font)) el.classList.add('name-font-'+prefs.font);
    if(owner && ['glow','shimmer','rainbow'].includes(prefs.effect)) el.classList.add('name-effect-'+prefs.effect);
  });
}
function openProfileCustomizer(){return openProfileAppearance('openProfileCustomizer');}
// Hook into settings if available
const originalSettingsClick = $('settings')?.onclick;
if ($('settings')) {
  $('settings').onclick = function(e) {
    if (originalSettingsClick) originalSettingsClick.call(this, e);
    setTimeout(() => {
      const body = $('dialog-content');
      if (body && !body.querySelector('#profile-custom-btn')) {
        const btn = button('Personalizar nome e capa', openProfileCustomizer, 'soft-button');
        btn.id = 'profile-custom-btn';
        body.append(btn);
      }
    }, 50);
  };
}
applyProfileStyles();

// === Server / community theme ===
const SERVER_THEME_KEY = 'orbita-server-theme';
function loadServerTheme() {
  try { return JSON.parse(localStorage.getItem(SERVER_THEME_KEY+':'+(session?.user.id||'guest')+':'+activeCommunity) || '{}') || {}; }
  catch { return {}; }
}
function applyServerTheme() {
  const t = !home&&session ? loadServerTheme() : {};
  const root = document.documentElement;
  for(const [key,value] of [['--accent',t.accent],['--bg-main',t.bg]]){if(/^#[0-9a-f]{6}$/i.test(value||''))root.style.setProperty(key,value);else root.style.removeProperty(key);}
  const banner=$('server-banner-box');let url;try{url=new URL(t.banner);if(url.protocol!=='https:')url=null;}catch{}
  banner.style.backgroundImage=url?'linear-gradient(#0003,#0007),url('+JSON.stringify(url.href)+')':'';banner.style.backgroundSize='cover';banner.style.backgroundPosition='center';
}
function openServerSettings() {
  showDialog('Configurações do servidor', container => {
    const t = loadServerTheme();
    const accent = el('input'); accent.type = 'color'; accent.value = t.accent || '#7c5cff';
    const bg = el('input'); bg.type = 'color'; bg.value = t.bg || '#10101b';
    const banner = el('input'); banner.type = 'url'; banner.placeholder = 'URL da imagem de fundo (opcional)'; banner.value = t.banner || '';
    container.append(
      el('p','muted','Personalize cores e fundo desta comunidade (local).'),
      (()=>{const l=el('label','field','Cor de destaque');l.append(accent);return l;})(),
      (()=>{const l=el('label','field','Fundo principal');l.append(bg);return l;})(),
      (()=>{const l=el('label','field','Banner (URL)');l.append(banner);return l;})(),
      button('Aplicar', () => {
        if(banner.value.trim()){let parsed;try{parsed=new URL(banner.value.trim());}catch{}if(!parsed||parsed.protocol!=='https:')throw Error('Use um endereço HTTPS válido para o banner.');}
        localStorage.setItem(SERVER_THEME_KEY+':'+(session?.user.id||'guest')+':'+activeCommunity, JSON.stringify({ accent: accent.value, bg: bg.value, banner: banner.value }));
        applyServerTheme();
        $('app-dialog').close();
        toast('Tema do servidor aplicado.');
      }, 'primary')
    );
  });
}
// Add button in community menu if possible
setTimeout(() => {
  const menu = document.querySelector('#sidebar-server-title')?.parentElement;
  if (menu && !document.getElementById('server-settings-btn')) {
    const btn = button('⚙', openServerSettings, 'tiny-button');
    btn.id = 'server-settings-btn';
    btn.title = 'Configurações do servidor';
    menu.append(btn);
  }
}, 2000);
applyServerTheme();

let preferencesFrame;
const preferencesObserver=new MutationObserver(()=>{if(preferencesFrame)return;preferencesFrame=requestAnimationFrame(()=>{preferencesFrame=null;applyProfileStyles();applyServerTheme();applyDecorations();});});
preferencesObserver.observe($('app-view'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});

// === Profile decorations gallery (Discord-shop style) ===


function applyDecorations() {
  const prefs = loadProfilePrefs();
  document.querySelectorAll('.rp-avatar, .up-avatar, .avatar').forEach(av => {
    DECORATIONS.filter(d => d.type === 'frame'&&d.css).forEach(d => av.classList.remove(d.css));
    const owner=av.dataset.userId||av.querySelector('[data-user-id]')?.dataset.userId||av.closest('[data-user-id],[data-participant-id]')?.dataset.userId||av.closest('[data-participant-id]')?.dataset.participantId;
    if (prefs.frame&&owner===session?.user.id) {
      const frame = DECORATIONS.find(d => d.id === prefs.frame);
      if (frame?.css&&frame.type==='frame') av.classList.add(frame.css);
    }
  });
  document.querySelectorAll('.rich-profile').forEach(p => {
    DECORATIONS.filter(d => d.type === 'effect').forEach(d => p.classList.remove(d.css));
    if (prefs.profileEffect&&p.dataset.userId===session?.user.id) {
      const effect = DECORATIONS.find(d => d.id === prefs.profileEffect&&d.type==='effect');
      if (effect?.css) p.classList.add(effect.css);
    }
  });
  document.querySelectorAll('.rp-banner').forEach(b=>{for(const d of DECORATIONS.filter(d=>d.type==='banner'&&d.css))b.classList.remove(d.css);if(b.closest('[data-user-id]')?.dataset.userId===session?.user.id){const style=DECORATIONS.find(d=>d.type==='banner'&&d.id===prefs.bannerStyle);if(style?.css)b.classList.add(style.css);}});
}

function openDecorationGallery(){return openProfileAppearance('openDecorationGallery');}
// Apply on load and after profile render
const baseShowProfile = showProfile;
showProfile = function(p) {
  baseShowProfile(p);
  applyDecorations();
};
setTimeout(applyDecorations, 1000);

// The status selector stays reachable when the mobile navigation drawer closes.
document.body.append($('status-popover'));

function callProfileTarget(target){return target instanceof Element?target.closest('.participant .avatar,.participant-name,.media-tile figcaption>span'):null;}
document.addEventListener('click',event=>{const target=callProfileTarget(event.target),tile=target?.closest('[data-participant-id]');if(tile)showProfile(person(tile.dataset.participantId));});
let profileTargetsFrame;
const callProfilesObserver=new MutationObserver(()=>{if(profileTargetsFrame)return;profileTargetsFrame=requestAnimationFrame(()=>{profileTargetsFrame=null;for(const node of $('voice-stage').querySelectorAll('.participant .avatar,.participant-name,.media-tile figcaption>span')){node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label','Abrir perfil de '+(node.closest('.participant')?.querySelector('.participant-name')?.textContent||node.textContent));}});});
callProfilesObserver.observe($('voice-stage'),{childList:true,subtree:true});
$('voice-stage').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&callProfileTarget(event.target)){event.preventDefault();event.target.click();}});

// ===== Big Picture mode (Steam-style) =====
function toggleBigPicture(force) {
  const on = force !== undefined ? force : !document.body.classList.contains('big-picture');
  if(on&&!session)return;
  document.body.classList.toggle('big-picture', on);
  localStorage.setItem('orbita-big-picture', on ? '1' : '0');
  toast(on ? 'Modo Big Picture ativado' : 'Modo Big Picture desativado');
  let bar = document.querySelector('.bp-bar');
  if (on && !bar) {
    bar = document.createElement('div');
    bar.className = 'bp-bar';
    const channels=document.createElement('button');channels.textContent='Canais';channels.className='mobile-nav-btn';channels.onclick=()=>document.body.classList.toggle('mobile-menu-open');
    const exit = document.createElement('button');
    exit.textContent = 'Sair do Big Picture';
    exit.onclick = () => toggleBigPicture(false);
    const settings = document.createElement('button');
    settings.textContent = 'Configurações';
    settings.onclick = () => $('settings').click();
    bar.append(channels,exit,settings);
    document.querySelector('.main').prepend(bar);
  } else if (!on && bar) {
    bar.remove();
  }
}
if (localStorage.getItem('orbita-big-picture') === '1') setTimeout(() => toggleBigPicture(true), 800);
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'Enter') { e.preventDefault(); toggleBigPicture(); }
});


const settingsBeforeBigPicture=$('settings').onclick;
$('settings').onclick=function(event){settingsBeforeBigPicture.call(this,event);const box=$('dialog-content').querySelector('.dialog-body');if(!box)return;box.append(el('p','muted','A redução de ruído, o cancelamento de eco e o ganho automático são aplicados pelos controles de Áudio acima. O filtro adicional de voz pode ser escolhido em Entrada e saída de áudio.'),button('Alternar Big Picture (Alt+Enter)',()=>{$('app-dialog').close();toggleBigPicture();}));};

communityUX=initCommunityUX({
 state:()=>({session,selected,channels,activeCommunity,room,home}),invite:()=>showCommunityInvite(),communityName:()=>communities.find(c=>c.id===activeCommunity)?.name||'Seu servidor',el,button,dialog:showDialog,report:error=>toast(errorText(error)),
 select:channel=>selectChannel(channel),edit:message=>messageAction(message,'edit'),
 lastOwnMessage:()=>[...messages.values()].filter(m=>m.author_id===session?.user.id&&!m.thread_root).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0],
 targets:()=>{if(!session)return [];const entries=[];for(const c of channels)entries.push({key:'channel:'+c.id,name:c.name,description:(c.kind==='voice'?'Sala de voz':'Canal de texto')+' · '+(communities.find(x=>x.id===c.community_id)?.name||'Servidor'),symbol:c.kind==='voice'?'◖':'#',open:()=>selectChannel(c)});for(const c of communities)entries.push({key:'server:'+c.id,name:c.name,description:'Servidor',symbol:'◎',open:()=>openCommunity(c)});const peers=new Set();for(const c of conversations){const p=person(otherUser(c));peers.add(p.id);entries.push({key:'dm:'+c.id,name:p.display_name,description:'Conversa · @'+p.username,symbol:'@',open:()=>openConversation(c)});}for(const f of friendships.filter(f=>f.status==='accepted')){const id=f.requester_id===session.user.id?f.recipient_id:f.requester_id;if(peers.has(id))continue;const p=person(id);entries.push({key:'friend:'+id,name:p.display_name,description:'Amigo · @'+p.username,symbol:'@',open:()=>startConversation(p)});}return entries;}
});
const renderMessagesBeforeUX=renderMessages;renderMessages=(...args)=>{renderMessagesBeforeUX(...args);communityUX.messages();};
const renderChannelsBeforeUX=renderChannels;renderChannels=()=>{renderChannelsBeforeUX();communityUX.channels();};
const selectBeforeUX=selectChannel;selectChannel=async channel=>{await selectBeforeUX(channel);communityUX.update();};
const friendsBeforeUX=showFriends;showFriends=()=>{friendsBeforeUX();communityUX.update();};
communityUX.update();

// Device preferences are local; no microphone is opened while listing settings.
audioTools=initAudioControls({el,button,toast,dialog:showDialog,room:()=>room,noise:()=>noise,output:async id=>{await setUploadedVideoOutput(id);await enhancements.setAudioOutput(id);}});
callReactions=initCallReactions({el,button,toast,dialog:showDialog,room:()=>room});
const settingsBeforeAudioDevices=$('settings').onclick;
$('settings').onclick=()=>{settingsBeforeAudioDevices();audioTools.fields($('dialog-content'));};

const adminContext={el,button,toast,checked,showDialog,inputField,errorText,apiFetch,
 state:()=>({db,session,people,siteRoles,activeCommunity,selected}),hasPermission:permission=>hasCommunityPermission(permission),
 refreshRoles:async()=>{siteRoles=await checked(db.from('site_roles').select('*'));renderMembers();},
 diagnostics:async()=>{const module=await import('./admin-diagnostics.js');if(session)module.showDiagnostics(adminContext);},
 reports:async()=>{const tools=await loadSocialTools();if(session)tools.moderation();},moderation:()=>enhancements.showModeration(),audit:()=>enhancements.showAudit(),clearDraft:()=>{drafts.set(draftKey(selected),'');resizeComposer();}
};

let adminTask;
function loadAdmin(){if(!adminTask)adminTask=import('./admin-controls.js').then(module=>module.initAdminControls(adminContext)).catch(error=>{adminTask=null;throw error;});return adminTask;}
const settingsBeforeLazyAdmin=$('settings').onclick;
$('settings').onclick=()=>{settingsBeforeLazyAdmin();if(siteRoles.some(r=>r.user_id===session?.user.id)){const box=$('dialog-content').querySelector('.dialog-body')||$('dialog-content');box.append(button('Administração da Órbita',async()=>{const admin=await loadAdmin();admin.management();}));}};
$('message-form').addEventListener('submit',event=>{const value=$('message-input').value.trim();if(!/^\/(admin|adm|removeradm|silenciar|liberar|banir|desbanir|auditoria|ajuda)(?:\s|$)/i.test(value))return;if(window.orbitaAdminReady)return;event.preventDefault();event.stopImmediatePropagation();const uid=session?.user.id;loadAdmin().then(admin=>{if(session?.user.id===uid&&$('message-input').value.trim()===value)admin.command(value);}).catch(error=>toast(errorText(error)));},true);

initAppUpdates({room:()=>room,dirty:()=>!!$('message-input').value.trim()||!!document.querySelector('.sf-composer textarea')?.value.trim(),beforeReload:()=>saveComposerDraft()});

initThemeAccessibility();

shareReceiver=initShareReceiver({el,button,showDialog,toast,insertText:insertComposer,state:()=>({session,channels,conversations}),conversationName:c=>person(otherUser(c)).display_name,select:target=>target.private?openConversation(target):selectChannel(target),sendFiles:files=>enhancements.sendFiles(files)});

let profileAppearanceTask;
async function openProfileAppearance(method){const uid=session?.user.id;try{if(!profileAppearanceTask)profileAppearanceTask=import('./profile-appearance.js').then(module=>module.initProfileAppearance({el,button,showDialog,loadProfilePrefs,saveProfilePrefs,applyDecorations,toast,state:()=>({profile})})).catch(error=>{profileAppearanceTask=null;throw error;});const appearance=await profileAppearanceTask;if(session?.user.id===uid)appearance[method]();}catch(error){toast(errorText(error));}}

const socialLogin=initSocialLogin({toast});
initNavigationMotion();
window.addEventListener('pagehide',()=>{saveComposerDraft();drafts.flush();});

let socialToolsTask;const welcomeAccess=new Map();
function loadSocialTools(){return socialToolsTask||=(import('./social-tools.js').then(module=>module.initSocialTools({el,button,toast,showDialog,inputField,checked,
 state:()=>({db,session,people,activeCommunity,selected}),legacyReports:()=>enhancements.showReports(),legacyFeedReports:async()=>{const instance=await loadFeed();instance.legacyReports();},config:()=>config,invalidateWelcome:id=>{welcomeAccess.delete(id);communityViews.delete(id);},isAdmin:()=>siteRoles.some(r=>r.user_id===session?.user.id),canManage:()=>hasCommunityPermission('manage_channels'),openCommunity:c=>openCommunity(c),refreshAccess:()=>loadCommunityAccess(),
 openProfile:id=>feed.open('profile',{author:id}),openPost:id=>feed.open('thread',{parent:id}),
 shareDM:async(id,text)=>{const p=person(id);await startConversation(p);if(selected?.private)insertComposer(text);}
})).catch(error=>{socialToolsTask=null;throw error;}));}
async function ensureCommunityWelcome(community){
 const user=session?.user.id;if(!user)return false;
 if(welcomeAccess.get(community))return true;
 const info=await checked(db.from('community_welcome').select('community_id,rules,version').eq('community_id',community).maybeSingle());
 if(session?.user.id!==user)return false;
 if(!info?.rules?.trim()||communities.find(c=>c.id===community)?.created_by===user||siteRoles.some(r=>r.user_id===user)){welcomeAccess.set(community,true);return true;}
 if(communities.some(c=>c.id===community&&!c.invite_only))await checked(db.rpc('join_public_community',{target:community}));if(session?.user.id!==user)return false;
 const accepted=await checked(db.from('community_rule_acceptances').select('version').eq('community_id',community).eq('user_id',user).maybeSingle());
 if(session?.user.id!==user)return false;
 if(accepted?.version===info.version){welcomeAccess.set(community,true);return true;}
 const tools=await loadSocialTools();if(session?.user.id!==user)return false;
 const okay=await tools.welcome(info);if(okay){welcomeAccess.set(community,true);communityViews.delete(community);}return okay;
}
const moreTools=button('Sua Órbita · privacidade e novidades',async()=>{const tools=await loadSocialTools();if(session)tools.menu();},'ux-shortcuts-help');moreTools.id='social-tools';$('dm-quick-find').after(moreTools);
const beforeSocialTools=$('settings').onclick;$('settings').onclick=()=>{beforeSocialTools();$('dialog-content').querySelector('.dialog-body')?.append(button('Privacidade, dados e recursos sociais',async()=>{const tools=await loadSocialTools();if(session)tools.menu();}));};

function sharePostToConversation(post){
 const user=session?.user.id;if(!user)return;showDialog('Compartilhar publicação',box=>{
 const select=el('select');select.setAttribute('aria-label','Destino da publicação');
 for(const c of channels.filter(c=>c.kind==='text'))select.append(new Option('#'+c.name,'channel:'+c.id));for(const c of conversations)select.append(new Option('@'+person(otherUser(c)).display_name,'dm:'+c.id));
 box.append(el('p','muted','O link será colocado no rascunho. Revise e envie quando quiser. Publicações privadas continuam exigindo permissão.'),select,button('Colocar na conversa',async()=>{if(session?.user.id!==user)return;const [kind,id]=select.value.split(':');const target=(kind==='dm'?conversations:channels).find(c=>c.id===id);if(!target)throw Error('Escolha uma conversa.');if(kind==='dm')await openConversation(target);else await selectChannel(target);if(session?.user.id===user){insertComposer(new URL('/p/'+post.id,location.origin).href);$('app-dialog').close();}}));
 });
}

async function trackVisibleActivity(){if(session&&!document.hidden&&profile?.presence_status!=='invisible')await db.rpc('touch_activity');}
setInterval(()=>trackVisibleActivity().catch(()=>{}),300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)trackVisibleActivity().catch(()=>{});});

function chooseOAuthNickname(next){
 if(!['google','discord'].includes(next.user.app_metadata?.provider)||!/^orbiter_[a-f0-9]{12}$/.test(profile?.username||''))return Promise.resolve();
 return new Promise(resolve=>{const user=next.user.id;showDialog('Escolha seu nickname',box=>{box.append(el('p','muted','Este será seu nome na Órbita e seu @ para adicionar amigos. Você pode mudar depois.'));const form=el('form'),name=inputField(form,'Seu nickname','',24);name.pattern='[A-Za-z0-9_]{3,24}';name.minLength=3;name.required=true;const save=el('button','primary','Continuar');save.type='submit';form.append(save);form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await checked(db.from('profiles').update({display_name:name.value.trim()}).eq('id',user));if(session?.user.id!==user)return;await loadSocial();$('app-dialog').close();}catch(error){toast(error.code==='23505'?'Esse nickname já está em uso. Escolha outro.':errorText(error));}finally{save.disabled=false;}};box.append(form);});$('app-dialog').addEventListener('close',resolve,{once:true});});
}

async function jumpToReply(id){
 const user=session?.user.id,target=selected&&{...selected},version=generation;if(!target||!user)return;
 const root=messages.get(id)||await checked(db.from(target.private?'direct_messages':'messages').select(messageFields).eq(target.private?'conversation_id':'channel_id',target.id).eq('id',id).maybeSingle());
 if(session?.user.id!==user||selected?.id!==target.id||generation!==version)return;if(!root)throw Error('A mensagem não está mais disponível.');messages.set(root.id,root);renderMessages();requestAnimationFrame(()=>{if(generation!==version)return;const node=document.querySelector('[data-message-id="'+CSS.escape(root.id)+'"]');node?.scrollIntoView({block:'center'});node?.classList.add('message-target');});
}

async function syncVoiceChat(force=false){
 if(!voiceChatTask&&(force||selected?.kind==='voice'))voiceChatTask=import('./voice-chat.js').then(module=>voiceChat=module.initVoiceChat({el,button,checked,toast,person,state:()=>({db,session,selected,home,room,callChannel})})).catch(error=>{voiceChatTask=null;throw error;});
 if(voiceChatTask){await voiceChatTask;voiceChat.update();}
}

const authRecovery=createAuthRecovery({auth:()=>db.auth,currentUser:()=>session?.user.id,onExpired:async account=>{
 if(session?.user.id!==account)return;
 saveComposerDraft();const cleanup=showSession(null);$('auth-submit').disabled=false;$('auth-status').textContent='Sua sessão expirou. Entre novamente para continuar.';
 // Only the confirmed invalid local login is removed. No other device is signed out.
 db.auth.signOut({scope:'local'}).catch(()=>{});await cleanup;
}});
let resumeAuth;
function checkResumedSession(){clearTimeout(resumeAuth);if(!session||sessionInitializing||document.hidden)return;const account=session.user.id;resumeAuth=setTimeout(()=>{if(session?.user.id===account)authRecovery.get(account).catch(error=>{if(error?.name!=='AbortError'&&session?.user.id===account)toast('Não foi possível verificar a sessão. Confira sua conexão e tente novamente.');});},200);}
window.addEventListener('focus',checkResumedSession);window.addEventListener('online',checkResumedSession);window.addEventListener('pageshow',checkResumedSession);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkResumedSession();});
