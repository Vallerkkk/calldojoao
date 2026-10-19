const $ = id => document.getElementById(id);
let db, config, session, channels = [], selected, signup = false;
let subscription, generation = 0, messages = new Map(), oldest, hasMore = false, loading = false;
let room, callChannel, joining = false, shuttingDown = false;
// Metas de qualidade: o navegador e o LiveKit podem reduzir conforme o dispositivo e a rede.
const CAMERA_CAPTURE = {resolution: {width:1920, height:1080, frameRate:30}};
const SCREEN_CAPTURE = {resolution: {width:1920, height:1080, frameRate:30}, contentHint:'detail'};
const CAMERA_PUBLISH = {videoEncoding: {maxBitrate:4_500_000, maxFramerate:30}, degradationPreference:'balanced'};
const SCREEN_PUBLISH = {screenShareEncoding: {maxBitrate:6_000_000, maxFramerate:30}, degradationPreference:'maintain-resolution'};
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
  if (error?.name === 'NotAllowedError') return 'Permissão recusada. Autorize o dispositivo no navegador.';
  if (error?.name === 'NotFoundError') return 'Nenhum dispositivo compatível foi encontrado.';
  if (error?.message === 'Invalid login credentials') return 'E-mail ou senha incorretos.';
  if (error?.message === 'Email not confirmed') return 'Confirme seu e-mail antes de entrar.';
  return error?.message || 'Não foi possível concluir. Tente novamente.';
}

$('toggle-auth').onclick = () => {
  signup = !signup; $('name-label').hidden = !signup; $('display-name').required = signup;
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

async function showSession(next) {
  if (session?.user.id === next?.user.id && next) { session = next; return; }
  session = next;
  $('auth-view').hidden = !!next; $('app-view').hidden = !next;
  if (!next) {
    generation++; if (subscription) { db.removeChannel(subscription); subscription = null; }
    await leaveCall();
    for(const channel of [socialSubscription,presenceChannel,musicSubscription])if(channel)db.removeChannel(channel);
    audioPlayer.pause();musicVersion++;people=[];friendships=[];conversations=[];
    if(musicUrl)URL.revokeObjectURL(musicUrl);musicUrl=null;audioPlayer.removeAttribute('src');return;
  }
  const name = next.user.user_metadata.display_name || 'Participante';
  $('user-name').textContent = name; $('user-avatar').textContent = initials(name);
  try {
    const {data, error} = await db.from('channels').select('*').order('position');
    if (error) throw error;
    if (!session || session.user.id !== next.user.id) return;
    channels = data;
    if (!data.length) throw Error('Nenhum canal disponível. Execute o arquivo supabase.sql.');
    await initSocial(); renderChannels(); await selectChannel(channels.find(c => c.kind === 'text') || channels[0]);
  } catch (error) { toast('Não foi possível carregar a comunidade: ' + errorText(error)); }
}
$('logout').onclick = async () => {
  const {error} = await db.auth.signOut(); if (error) toast(errorText(error));
};
function renderChannels() {
  $('text-channels').replaceChildren(); $('voice-channels').replaceChildren();
  for (const channel of channels) {
    const button = el('button', 'channel' + (selected?.id === channel.id ? ' active' : '') + (callChannel?.id === channel.id ? ' connected' : ''));
    button.append(el('span', '', channel.kind === 'text' ? '#' : '◖'));
    button.append(document.createTextNode(channel.name));
    button.setAttribute('aria-pressed', String(selected?.id === channel.id));
    button.onclick = () => selectChannel(channel); $(channel.kind + '-channels').append(button);
  }
}
async function selectChannel(channel) {
  $('message-input').value = '';home=false;pinsOnly=false;
  $('friends-view').hidden=true;$('search-messages').value='';
  $('private-call').hidden=!channel.private||channel.kind!=='text';
  $('pins-toggle').setAttribute('aria-pressed','false');
  selected = channel;watchMusic(channel).catch(e=>toast(errorText(e))); const version = ++generation;
  if (subscription) { db.removeChannel(subscription); subscription = null; }
  renderChannels(); $('channel-title').textContent = channel.name;
  $('text-view').hidden = channel.kind !== 'text'; $('voice-view').hidden = channel.kind !== 'voice';
  $('channel-description').textContent = channel.private?'Conversa privada · só vocês dois':channel.kind === 'text' ? 'O começo de boas conversas.' : 'Voz, vídeo e boas companhias.';
  if (channel.kind === 'voice') {
    $('voice-title').textContent = channel.name; updateCallUI(); return;
  }
  messages = new Map(); oldest = null; hasMore = false; loading = false; renderMessages();
  subscription = db.channel((channel.private?'direct-':'messages-') + channel.id + '-' + version)
    .on('postgres_changes', {event: '*', schema: 'public', table: messageTable(), filter: `${scopeKey(channel)}=eq.${channel.id}`}, async payload => {
      if(payload.eventType==='DELETE'){if(version===generation){messages.delete(payload.old.id);renderMessages();}return;}
      const {data, error} = await db.from(channel.private?'direct_messages':'messages').select(messageFields).eq('id', payload.new.id).single();
      if (version !== generation) return;
      if (error) { toast('Uma mensagem não pôde ser atualizada. Reabra o canal.'); return; }
      const list = $('message-list'); const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
      messages.set(data.id, data); renderMessages(nearBottom);
    }).on('postgres_changes',{event:'DELETE',schema:'public',table:channel.private?'direct_messages':'messages'},payload=>{
      if(version===generation&&messages.has(payload.old.id)){messages.delete(payload.old.id);renderMessages();}
    }).subscribe((status) => {
      if (version !== generation) return;
      if (status === 'SUBSCRIBED') loadMessages(version, true);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        toast('A conexão ao vivo falhou. Carregando o histórico; reabra o canal para reconectar.');
        loadMessages(version, true);
      }
    });
}
async function loadMessages(version, first = false) {
  if (loading || version !== generation) return;
  loading = true;
  try {
    let query = db.from(messageTable()).select(messageFields).eq(scopeKey(selected), selected.id)
      .order('created_at', {ascending:false}).order('id', {ascending:false}).limit(60);
    if (!first && oldest) query = query.or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`);
    const {data, error} = await query;
    if (version !== generation) return;
    if (error) throw error;
    const list = $('message-list'), height = list.scrollHeight, top = list.scrollTop;
    data.forEach(m => messages.set(m.id, m)); oldest = data.at(-1) || oldest; hasMore = data.length === 60;
    renderMessages(first);
    if (!first) list.scrollTop = top + list.scrollHeight - height;
  } catch (error) { toast('Erro ao carregar mensagens: ' + errorText(error)); }
  finally { if (version === generation) loading = false; }
}
function renderMessages(scroll = false) {
  const list = $('message-list'), top = list.scrollTop; list.replaceChildren();
  const welcome = el('div', 'welcome'); welcome.append(el('div', 'welcome-icon', '#'),
    el('h1', '', (selected.private?'Sua conversa com ':'Bem-vindo a #') + selected.name), el('p', '', selected.private?'Mensagens e chamadas visíveis apenas para vocês dois.':'Um espaço para conversar, compartilhar e estar junto.'));
  list.append(welcome);
  if (hasMore) { const more = el('button', 'load-more', 'Carregar mensagens anteriores'); more.onclick = () => loadMessages(generation); list.append(more); }
  const sorted = [...messages.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const message of sorted) {
    if(pinsOnly&&!message.pinned)continue;
    const search=$('search-messages').value.trim().toLocaleLowerCase();
    if(search&&!message.content.toLocaleLowerCase().includes(search))continue;
    const name = message.profiles?.display_name || 'Participante';
    const item = el('article', 'message'), content = el('div', 'message-content'), meta = el('div', 'message-meta');
    const time = el('time', '', new Date(message.created_at).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));
    time.dateTime = message.created_at; meta.append(el('strong', '', name), time);
    if(message.pinned)meta.append(el('small','pin-label','◆ Fixada'));
    content.append(meta, el('p', '', message.content));
    if(message.attachments){const a=message.attachments;content.append(button('↓ '+a.name+' · '+(a.size/1024/1024).toFixed(1)+' MB',()=>downloadAttachment(a),'file-card'));}
    const actions=el('div','message-actions');
    for(const emoji of ['👍','❤️','😂','🎉','🔥','👀']){const count=(message.reactions||[]).filter(r=>r.emoji===emoji).length;actions.append(button(emoji+(count?' '+count:''),()=>react(message,emoji),'reaction'));}
    if(message.author_id===session.user.id){actions.append(button('Editar',()=>messageAction(message,'edit'),'tiny-button'),button(message.pinned?'Desafixar':'Fixar',()=>messageAction(message,'pin'),'tiny-button'),button('Excluir',()=>messageAction(message,'delete'),'tiny-button'));}
    content.append(actions);const avatar=el('div','avatar',initials(name));avatar.style.background=message.profiles?.avatar_color||'#8b80ff';
    item.append(avatar,content);list.append(item);
  }
  list.scrollTop = scroll ? list.scrollHeight : top;
}
$('message-input').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('message-form').requestSubmit(); }
};
$('message-form').onsubmit = async event => {
  event.preventDefault(); const content = $('message-input').value.trim();
  if (!content || !session || selected?.kind !== 'text' || $('send').disabled) return;
  const channelId = selected.id, version = generation; $('send').disabled = true;
  try {
    const {data, error} = await db.from(messageTable()).insert({[scopeKey(selected)]:channelId, author_id:session.user.id, content}).select(messageFields).single();
    if (error) throw error;
    if ($('message-input').value.trim() === content) $('message-input').value = '';
    if (version === generation) { messages.set(data.id, data); renderMessages(true); }
  } catch (error) { toast(errorText(error)); }
  finally { $('send').disabled = false; }
};

function onTrack(track, participant) {
  if (track.kind === 'video' && $('media-grid').querySelector(`[data-track="${track.sid}"]`)) return;
  const media = track.attach(); media.dataset.track = track.sid;
  if (track.kind === 'video') {
    const isScreen = track.source === 'screen_share';
    const figure = el('figure', 'media-tile' + (isScreen ? ' media-screen' : '')); figure.dataset.track = track.sid;
    media.muted = true; media.playsInline = true;
    const caption = el('figcaption');
    caption.append(el('span', '', (participant.name || 'Participante') + (isScreen ? ' · Tela' : ' · Câmera')));
    const expand = el('button', 'expand-video', 'Tela cheia');
    expand.type = 'button'; expand.setAttribute('aria-label', `Ver ${isScreen ? 'tela' : 'câmera'} de ${participant.name || 'Participante'} em tela cheia`);
    expand.onclick = async () => {
      try {
        if (document.fullscreenElement === figure) await document.exitFullscreen();
        else if (figure.requestFullscreen) await figure.requestFullscreen();
        else if (media.webkitEnterFullscreen) media.webkitEnterFullscreen();
        else toast('Este navegador não oferece tela cheia para este vídeo.');
      } catch (error) { toast(errorText(error)); }
    };
    caption.append(expand); figure.append(media, caption);
    $('media-grid').append(figure);
  } else { media.dataset.remoteAudio = 'true';media.muted=deafened; document.body.append(media); }
}
function removeTrack(track) {
  track.detach().forEach(node => { const tile = node.closest('.media-tile'); if (tile) tile.remove(); else node.remove(); });
}
function updateCallUI() {
  const here = !!room && callChannel?.id === selected?.id && selected?.kind === 'voice';
  $('call-dock').hidden=!room;$('dock-name').textContent=callChannel?.name||'';
  $('join-call').hidden = here; $('join-call').disabled = joining || !config?.callsConfigured;
  $('join-call').textContent = joining ? 'Conectando…' : (room ? 'Trocar para esta sala ↗' : 'Entrar na sala ↗');
  $('active-controls').hidden = !here; $('empty-call').hidden = here;
  $('call-status').textContent = !config?.callsConfigured ? 'As chamadas precisam das credenciais LIVEKIT no .env.'
    : here ? 'Você está conectado. Sua câmera começa desligada.'
    : room ? `Você continua conectado em ${callChannel.name}.` : 'Entre na sala e faça parte da conversa.';
  $('participants').hidden = !here; $('media-grid').hidden = !here;
  $('participants').replaceChildren();
  if (room) {
    const participants = [room.localParticipant, ...room.remoteParticipants.values()];
    for (const participant of participants) {
      const card = el('div', 'participant' + (participant.isSpeaking ? ' speaking' : ''));
      card.append(el('span', 'avatar', initials(participant.name)), el('strong', '', participant.name || 'Participante'),
        el('small', '', participant.isMicrophoneEnabled ? 'Microfone ligado' : 'Microfone desligado'));
      $('participants').append(card);
    }
    for (const [id, enabled] of [['mic',room.localParticipant.isMicrophoneEnabled],['camera',room.localParticipant.isCameraEnabled],['screen',room.localParticipant.isScreenShareEnabled]]) {
      $(id).setAttribute('aria-pressed', String(enabled));
    }
  }
  renderChannels();
}
async function leaveCall() {
  const previous = room; room = null; callChannel = null;
  if (previous) { previous.removeAllListeners(); await previous.disconnect(); }
  document.querySelectorAll('[data-remote-audio]').forEach(node => node.remove());
  $('media-grid').replaceChildren(); updateCallUI();
}
$('join-call').onclick = async () => {
  if (joining || !session || selected?.kind !== 'voice') return;
  joining = true; updateCallUI(); const target = selected;
  try {
    const {data: {session: fresh}} = await db.auth.getSession();
    if (!fresh) throw Error('Sua sessão expirou. Entre novamente.');
    const response = await fetch(`/api/${target.private?'conversations':'channels'}/${target.id}/join`, {method:'POST', headers:{Authorization:`Bearer ${fresh.access_token}`}});
    const result = await response.json(); if (!response.ok) throw Error(result.detail || 'Não foi possível entrar.');
    const {Room, RoomEvent, VideoPresets, ScreenSharePresets} = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/+esm');
    if (!session || shuttingDown) return;
    await leaveCall();
    const connected = new Room({
      adaptiveStream: {pixelDensity:'screen'},
      dynacast:true,
      audioCaptureDefaults:audioCapture(),
      videoCaptureDefaults:CAMERA_CAPTURE,
      publishDefaults: {
        simulcast:true,
        videoCodec:'vp8',
        videoEncoding:CAMERA_PUBLISH.videoEncoding,
        screenShareEncoding:SCREEN_PUBLISH.screenShareEncoding,
        videoSimulcastLayers:[VideoPresets.h360, VideoPresets.h720],
        screenShareSimulcastLayers:[ScreenSharePresets.h720fps15],
      },
    }); room = connected; callChannel = target;
    connected.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => onTrack(track, participant)).on(RoomEvent.TrackUnsubscribed, removeTrack)
      .on(RoomEvent.LocalTrackPublished, publication => { if (publication.track?.kind === 'video') onTrack(publication.track, connected.localParticipant); updateCallUI(); })
      .on(RoomEvent.LocalTrackUnpublished, publication => {
        if (publication.track) removeTrack(publication.track);
        document.querySelectorAll(`[data-track="${publication.trackSid}"]`).forEach(node => node.remove());
        updateCallUI();
      });
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged]) connected.on(event, updateCallUI);
    connected.on(RoomEvent.Reconnecting, () => { $('call-status').textContent = 'Reconectando à sala…'; });
    connected.on(RoomEvent.Reconnected, updateCallUI);
    connected.on(RoomEvent.Disconnected, () => { if (room === connected) { leaveCall(); toast('Você saiu da chamada.'); } });
    await connected.connect(result.url, result.token);
    if (!session || room !== connected) { await connected.disconnect(); return; }
    await connected.startAudio();
    const known=people.find(p=>p.id===session.user.id);if(known)await connected.localParticipant.setName(known.display_name);
    try { await connected.localParticipant.setMicrophoneEnabled(true, audioCapture()); }
    catch (error) { toast('Você entrou sem microfone. ' + errorText(error)); }
  } catch (error) { await leaveCall(); toast(errorText(error)); }
  finally { joining = false; updateCallUI(); }
};
$('leave-call').onclick = () => leaveCall();
for (const [id, property, method] of [['mic','isMicrophoneEnabled','setMicrophoneEnabled'],['camera','isCameraEnabled','setCameraEnabled'],['screen','isScreenShareEnabled','setScreenShareEnabled']]) {
  $(id).onclick = async () => {
    if (!room) return; $(id).disabled = true;
    try {
      const enabled = !room.localParticipant[property];
      if (id === 'camera') await room.localParticipant.setCameraEnabled(enabled, CAMERA_CAPTURE, CAMERA_PUBLISH);
      else if (id === 'screen') await room.localParticipant.setScreenShareEnabled(enabled, SCREEN_CAPTURE, SCREEN_PUBLISH);
      else await room.localParticipant[method](enabled, audioCapture());
    }
    catch (error) { toast(errorText(error)); }
    finally { $(id).disabled = false; updateCallUI(); }
  };
}
window.addEventListener('pagehide', () => { shuttingDown = true;audioPlayer.pause();if(presenceChannel)presenceChannel.untrack(); if (room) room.disconnect(); });
window.addEventListener('pageshow', () => { shuttingDown = false; });

async function boot() {
  try {
    config = await (await fetch('/api/config')).json();
    if (!config.configured) { $('setup').hidden = false; $('auth-submit').disabled = true; return; }
    const {createClient} = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
    db = createClient(config.supabaseUrl, config.supabaseKey);
    // Não execute chamadas ao Supabase dentro do callback de Auth.
    db.auth.onAuthStateChange((_event, next) => { setTimeout(() => showSession(next), 0); });
    const {data, error} = await db.auth.getSession(); if (error) throw error;
    await showSession(data.session);
  } catch (error) { $('auth-status').textContent = 'Falha ao iniciar: ' + errorText(error); $('auth-submit').disabled = true; }
}
// Social features share the authenticated Supabase client and its row policies.
let profile, people = [], friendships = [], conversations = [], socialSubscription, presenceChannel;
let online = new Set(), home = false, pinsOnly = false, musicSubscription, musicState, musicUrl, musicVersion = 0, musicRevision = 0;
const audioPlayer = new Audio();
let noise = localStorage.getItem('orbita-noise') !== 'false', deafened = false;
const audioCapture = () => ({noiseSuppression:noise, echoCancellation:true, autoGainControl:true, channelCount:1});
const scopeKey = target => target?.private ? 'conversation_id' : 'channel_id';
const messageTable = () => selected?.private ? 'direct_messages' : 'messages';
const messageFields = '*,profiles(display_name,username,avatar_color),attachments(id,name,mime_type,size),reactions(id,emoji,user_id)';
const otherUser = c => c.user_a === session.user.id ? c.user_b : c.user_a;
const person = id => people.find(p => p.id === id) || {id,display_name:'Participante',username:'',avatar_color:'#8b80ff'};
function button(label, action, css = 'soft-button') { const b = el('button', css, label); b.type='button'; b.onclick=()=>Promise.resolve(action()).catch(e=>toast(errorText(e))); return b; }
async function checked(query) { const result=await query; if(result.error) throw result.error; return result.data; }
async function apiFetch(path, options={}) {
  const {data:{session:fresh}}=await db.auth.getSession();
  if(!fresh) throw Error('Entre novamente na sua conta.');
  const response=await fetch(path,{...options,headers:{...options.headers,Authorization:`Bearer ${fresh.access_token}`}});
  if(!response.ok) {const error=await response.json().catch(()=>({}));throw Error(error.detail||'Não foi possível concluir.');}
  return response;
}
function showDialog(title, build) {
  $('dialog-title').textContent=title; $('dialog-content').replaceChildren(); build($('dialog-content')); $('app-dialog').showModal();
}
function inputField(parent,label,value,max=160) {
  const l=el('label','field',label), input=el('input'); input.value=value||'';input.maxLength=max;l.append(input);parent.append(l);return input;
}
async function loadSocial() {
  const userId=session?.user.id;if(!userId)return;
  const results=await Promise.all([
    checked(db.from('profiles').select('*').order('display_name')),
    checked(db.from('friendships').select('*')),
    checked(db.from('conversations').select('*').order('created_at',{ascending:false}))]);
  if(session?.user.id!==userId)return;[people,friendships,conversations]=results;
  profile=person(session.user.id); $('user-name').textContent=profile.display_name;
  $('user-avatar').textContent=initials(profile.display_name);$('user-avatar').style.background=profile.avatar_color;
  renderSocial();renderMembers();if(home)renderFriends();
}
async function initSocial() {
  await loadSocial();
  if(socialSubscription) await db.removeChannel(socialSubscription);
  socialSubscription=db.channel('social-'+session.user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'friendships'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'conversations'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles'},()=>loadSocial().catch(e=>toast(errorText(e))))
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'channels'},async()=>{channels=await checked(db.from('channels').select('*').order('position'));renderChannels();})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'call_events'},payload=>incomingCall(payload.new))
    .on('postgres_changes',{event:'*',schema:'public',table:'reactions'},()=>{if(!home&&selected?.kind==='text')refreshMessages();})
    .subscribe();
  if(presenceChannel) await db.removeChannel(presenceChannel);
  presenceChannel=db.channel('community:main',{config:{private:true,presence:{key:session.user.id}}});
  presenceChannel.on('presence',{event:'sync'},()=>{online=new Set(Object.keys(presenceChannel.presenceState()));renderMembers();if(home)renderFriends();});
  presenceChannel.subscribe(async status=>{if(status==='SUBSCRIBED')await presenceChannel.track({online_at:new Date().toISOString()});});
}
function renderMembers() {
  $('member-count').textContent=String(people.length); $('member-list').replaceChildren();
  const ordered=[...people].sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id)));
  for(const p of ordered){
    const row=el('div','member');const a=el('span','avatar',initials(p.display_name));a.style.background=p.avatar_color;
    const content=el('div');content.append(el('strong','',p.display_name),el('small','',online.has(p.id)?'● Disponível':'Offline'));
    row.append(a,content);row.onclick=()=>showProfile(p);$('member-list').append(row);
  }
  $('online-count').textContent=online.size+' online';
}
function renderSocial() {
  $('dm-channels').replaceChildren();
  const pending=friendships.filter(f=>f.status==='pending'&&f.recipient_id===session.user.id).length;
  $('friends-badge').textContent=pending||'';
  for(const c of conversations){const p=person(otherUser(c));const b=button('@ '+p.display_name,()=>openConversation(c),'channel'+(selected?.private&&selected.id===c.id?' active':''));$('dm-channels').append(b);}
}
function showFriends() {
  home=true;generation++;if(subscription){db.removeChannel(subscription);subscription=null;}
  $('friends-view').hidden=false;$('text-view').hidden=true;$('voice-view').hidden=true;
  $('channel-title').textContent='Amigos';$('channel-description').textContent='Sua galera, sempre por perto.';
  $('private-call').hidden=true;renderFriends();
}
function renderFriends() {
  $('friends-list').replaceChildren();
  const accepted=friendships.filter(f=>f.status==='accepted'), pending=friendships.filter(f=>f.status==='pending');
  $('friend-total').textContent=accepted.length+(accepted.length===1?' amigo':' amigos');
  for(const f of [...pending,...accepted]) {
    const p=person(f.requester_id===session.user.id?f.recipient_id:f.requester_id), row=el('article','friend-card');
    const avatar=el('span','avatar',initials(p.display_name));avatar.style.background=p.avatar_color;
    const info=el('div','friend-info');info.append(el('strong','',p.display_name),el('small','', '@'+p.username+' · '+(f.status==='accepted'?(online.has(p.id)?'Online':'Offline'):(f.recipient_id===session.user.id?'Quer ser seu amigo':'Pedido enviado'))));
    row.append(avatar,info);
    if(f.status==='accepted'){
      row.append(button('Mensagem',()=>startConversation(p)),button('Ligar',()=>startConversation(p,true)),button('Remover',()=>removeFriend(f),'text-button'));
    }else{
      if(f.recipient_id===session.user.id)row.append(button('Aceitar',async()=>{await checked(db.from('friendships').update({status:'accepted'}).eq('id',f.id));await loadSocial();},'primary'));
      row.append(button(f.recipient_id===session.user.id?'Recusar':'Cancelar',()=>removeFriend(f),'text-button'));
    }
    $('friends-list').append(row);
  }
  if(!friendships.length)$('friends-list').append(el('p','empty-state','As boas conversas começam com um oi. Adicione alguém pelo nome de usuário.'));
}
async function removeFriend(f){
  showDialog('Remover conexão',container=>{container.append(el('p','','A amizade será removida. O histórico continua disponível, mas novas mensagens e chamadas exigirão uma nova amizade.'));
    container.append(button('Confirmar',async()=>{await checked(db.from('friendships').delete().eq('id',f.id));$('app-dialog').close();await loadSocial();},'danger'));});
}
function showProfile(p) {
  showDialog(p.display_name,container=>{
    container.append(el('p','muted','@'+p.username),el('p','',p.bio||'Ainda sem biografia.'));
    if(p.id===session.user.id)return;
    const f=friendships.find(f=>[f.requester_id,f.recipient_id].includes(p.id));
    if(f?.status==='accepted')container.append(button('Enviar mensagem',async()=>{$('app-dialog').close();await startConversation(p);},'primary'));
    else if(!f)container.append(button('Adicionar amigo',async()=>{await sendFriend(p);$('app-dialog').close();},'primary'));
    else container.append(el('p','muted','Pedido de amizade pendente.'));
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
$('private-call').onclick=()=>{const c=conversations.find(c=>c.id===selected?.id);if(c)startConversation(person(otherUser(c)),true).catch(e=>toast(errorText(e)));};
function incomingCall(event){
  if(event.caller_id===session?.user.id||Date.now()-Date.parse(event.created_at)>60000)return;
  const p=person(event.caller_id);$('incoming-name').textContent=p.display_name+' está chamando…';$('incoming-call').hidden=false;
  $('answer-call').onclick=async()=>{try{const c=await checked(db.from('conversations').select('*').eq('id',event.conversation_id).single());$('incoming-call').hidden=true;await openConversation(c,true);$('join-call').click();}catch(e){toast(errorText(e));}};
  setTimeout(()=>{$('incoming-call').hidden=true;},30000);
}
$('decline-call').onclick=()=>{$('incoming-call').hidden=true;};
$('friends-nav').onclick=showFriends;
$('music-toggle').onclick=()=>document.body.classList.toggle('show-music');
$('settings').onclick=()=>showDialog('Seu perfil e áudio',container=>{
  const form=el('form');const name=inputField(form,'Nome de exibição',profile.display_name,50),username=inputField(form,'Nome de usuário (3–24 letras, números ou _)',profile.username,24),bio=inputField(form,'Sobre você',profile.bio,160),color=inputField(form,'Cor do perfil',profile.avatar_color,7);color.type='color';
  const label=el('label','check-field');const check=el('input');check.type='checkbox';check.checked=noise;label.append(check,document.createTextNode('Supressão de ruído do microfone'));form.append(label,el('p','muted','O navegador reduz ruído, eco e variações de volume. O resultado depende do dispositivo.'));
  const save=el('button','primary','Salvar alterações');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{
    await checked(db.from('profiles').update({display_name:name.value.trim(),username:username.value.trim().toLowerCase(),bio:bio.value.trim(),avatar_color:color.value}).eq('id',session.user.id));
    noise=check.checked;localStorage.setItem('orbita-noise',String(noise));
    if(room){for(const pub of room.localParticipant.audioTrackPublications.values())if(pub.track?.source==='microphone')await pub.track.restartTrack(audioCapture());}
    await loadSocial();$('app-dialog').close();toast('Perfil e áudio atualizados.');
  }catch(e){toast(e.code==='23505'?'Esse nome de usuário já está em uso.':errorText(e));}finally{save.disabled=false;}};
});
$('create-channel').onclick=()=>showDialog('Novo canal',container=>{
  const form=el('form'),name=inputField(form,'Nome do canal','',40),type=el('select');
  for(const [value,text]of[['text','Canal de texto'],['voice','Sala de voz e vídeo']]){const opt=el('option','',text);opt.value=value;type.append(opt);}form.append(type);
  const save=el('button','primary','Criar canal');save.type='submit';form.append(save);container.append(form);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const c=await checked(db.from('channels').insert({name:name.value.trim(),kind:type.value,position:channels.length+1}).select().single());channels.push(c);$('app-dialog').close();await selectChannel(c);}catch(e){toast(errorText(e));}finally{save.disabled=false;}};
});
$('dialog-close').onclick=()=>$('app-dialog').close();
$('search-messages').oninput=()=>renderMessages();
$('pins-toggle').onclick=()=>{pinsOnly=!pinsOnly;$('pins-toggle').setAttribute('aria-pressed',String(pinsOnly));renderMessages();};
$('back-to-call').onclick=()=>{if(callChannel)selectChannel(callChannel);};
$('dock-leave').onclick=()=>leaveCall();
$('deafen').onclick=()=>{deafened=!deafened;document.querySelectorAll('[data-remote-audio]').forEach(a=>a.muted=deafened);$('deafen').setAttribute('aria-pressed',String(deafened));};
async function refreshMessages(){
  const version=generation,table=messageTable(),target=selected;
  try{const data=await checked(db.from(table).select(messageFields).eq(scopeKey(target),target.id).order('created_at',{ascending:false}).limit(60));if(version!==generation)return;for(const m of data)messages.set(m.id,m);renderMessages();}catch(e){toast(errorText(e));}
}
async function messageAction(message,action){
  if(action==='delete'){showDialog('Excluir mensagem',container=>{container.append(el('p','','Deseja excluir esta mensagem?'),button('Excluir',async()=>{await checked(db.from(messageTable()).delete().eq('id',message.id));messages.delete(message.id);$('app-dialog').close();renderMessages();},'danger'));});return;}
  if(action==='pin'){await checked(db.from(messageTable()).update({pinned:!message.pinned}).eq('id',message.id));message.pinned=!message.pinned;renderMessages();return;}
  showDialog('Editar mensagem',container=>{const form=el('form'),input=inputField(form,'Mensagem',message.content,4000),save=el('button','primary','Salvar');save.type='submit';form.append(save);container.append(form);form.onsubmit=async e=>{e.preventDefault();try{await checked(db.from(messageTable()).update({content:input.value.trim()}).eq('id',message.id));message.content=input.value.trim();$('app-dialog').close();renderMessages();}catch(error){toast(errorText(error));}};});
}
async function react(message,emoji){
  const mine=(message.reactions||[]).find(r=>r.user_id===session.user.id&&r.emoji===emoji);
  if(mine)await checked(db.from('reactions').delete().eq('id',mine.id));
  else await checked(db.from('reactions').insert({[selected.private?'direct_message_id':'message_id']:message.id,user_id:session.user.id,emoji}));
  await refreshMessages();
}
async function downloadAttachment(a,play=false){
  const response=await apiFetch(`/api/attachments/${a.id}/download`),blob=await response.blob(),url=URL.createObjectURL(new Blob([blob],{type:play?a.mime_type:'application/octet-stream'}));
  if(play)return url;
  const link=el('a');link.href=url;link.download=a.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function uploadFile(file,target){
  if(!config.driveConfigured)throw Error('O proprietário ainda precisa conectar o Google Drive.');
  if(file.size>config.uploadLimit)throw Error('Escolha um arquivo de até 25 MB.');
  return (await apiFetch(`/api/attachments?target_kind=${target.private?'direct':'channel'}&target_id=${target.id}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file})).json();
}
$('attach-file').onclick=()=>{if(!config.driveConfigured)return toast('O Drive está preparado no site, mas falta a autorização Google do proprietário.');$('file-input').click();};
$('file-input').onchange=async()=>{
  const file=$('file-input').files[0],target=selected,version=generation;if(!file)return;
  $('attach-file').disabled=true;try{toast('Enviando arquivo para o Drive…');const attachment=await uploadFile(file,target);
    await checked(db.from(target.private?'direct_messages':'messages').insert({[scopeKey(target)]:target.id,author_id:session.user.id,content:'📎 '+attachment.name,attachment_id:attachment.id}));
    if(version===generation)await refreshMessages();toast('Arquivo enviado.');
  }catch(e){toast(errorText(e));}finally{$('attach-file').disabled=false;$('file-input').value='';}
};
$('drive-info').onclick=()=>showDialog('Arquivos no Google Drive',container=>{
  container.append(el('p','',config.driveConfigured?'O Drive está conectado. Você pode compartilhar arquivos de até 25 MB.':'A integração está preparada. O proprietário precisa autorizar uma pasta do Google Drive para ativar os envios.'),el('p','muted','Os downloads passam pelo site e respeitam as permissões da conversa. Nenhum arquivo privado é compartilhado publicamente.'));
});
function renderMusicStatus(text){$('music-status').textContent=text;}
async function watchMusic(target){
  const version=++musicVersion;musicState=null;audioPlayer.pause();audioPlayer.removeAttribute('src');if(musicUrl){URL.revokeObjectURL(musicUrl);musicUrl=null;}
  if(musicSubscription)await db.removeChannel(musicSubscription);
  renderMusicStatus('Escolha um áudio para ouvir juntos');$('music-play').textContent='▶';
  const reload=async()=>{try{const data=await checked(db.from('music_state').select('*,attachments(id,name,mime_type,size)').eq(scopeKey(target),target.id).maybeSingle());if(version===musicVersion)await applyMusic(data,version);}catch(e){toast(errorText(e));}};
  musicSubscription=db.channel('music-'+target.id+'-'+version).on('postgres_changes',{event:'*',schema:'public',table:'music_state',filter:`${scopeKey(target)}=eq.${target.id}`},reload).subscribe(status=>{if(status==='SUBSCRIBED')reload();});
}
async function applyMusic(state,version){
  if(!state)return;const revision=++musicRevision;const changed=musicState?.attachment_id!==state.attachment_id;musicState=state;
  if(changed){renderMusicStatus('Carregando '+state.attachments.name+'…');const url=await downloadAttachment(state.attachments,true);if(version!==musicVersion||revision!==musicRevision){URL.revokeObjectURL(url);return;}if(musicUrl)URL.revokeObjectURL(musicUrl);musicUrl=url;await new Promise(resolve=>{const timer=setTimeout(resolve,10000);const done=()=>{clearTimeout(timer);resolve();};audioPlayer.addEventListener('loadedmetadata',done,{once:true});audioPlayer.addEventListener('error',done,{once:true});audioPlayer.src=url;});}
  if(version!==musicVersion||revision!==musicRevision)return;
  const position=state.position+(state.playing?Math.max(0,(Date.now()-Date.parse(state.updated_at))/1000):0);
  if(Number.isFinite(audioPlayer.duration)&&Math.abs(audioPlayer.currentTime-position)>1)audioPlayer.currentTime=Math.min(position,audioPlayer.duration);
  renderMusicStatus(state.attachments.name);$('music-play').textContent=state.playing?'❚❚':'▶';
  if(state.playing)try{await audioPlayer.play();}catch{renderMusicStatus('Clique em “Ouvir” para liberar o áudio');}else audioPlayer.pause();
}
async function setMusic(values){
  if(!musicState)throw Error('Primeiro escolha um arquivo de áudio.');
  await checked(db.from('music_state').update({...values,updated_by:session.user.id}).eq('id',musicState.id));
}
$('music-play').onclick=()=>setMusic({playing:!musicState?.playing,position:audioPlayer.currentTime}).catch(e=>toast(errorText(e)));
$('music-listen').onclick=()=>audioPlayer.play().catch(()=>toast('Escolha uma música primeiro.'));
$('music-volume').oninput=e=>{audioPlayer.volume=Number(e.target.value);};
$('music-upload').onclick=()=>{if(!config.driveConfigured)return toast('Conecte o Drive para compartilhar arquivos de música.');$('music-input').click();};
$('music-input').onchange=async()=>{
  const file=$('music-input').files[0],target=selected,version=musicVersion;if(!file||!target)return;
  $('music-upload').disabled=true;
  try{if(!file.type.startsWith('audio/'))throw Error('Escolha um arquivo de áudio compatível com o navegador.');const a=await uploadFile(file,target);
    const existing=await checked(db.from('music_state').select('id').eq(scopeKey(target),target.id).maybeSingle());
    const values={attachment_id:a.id,playing:true,position:0,updated_by:session.user.id};
    if(existing)await checked(db.from('music_state').update(values).eq('id',existing.id));
    else await checked(db.from('music_state').insert({...values,[scopeKey(target)]:target.id}));
    if(version===musicVersion)toast('Música compartilhada com este espaço.');
  }catch(e){toast(errorText(e));}finally{$('music-upload').disabled=false;$('music-input').value='';}
};
audioPlayer.addEventListener('ended',()=>{if(musicState?.updated_by===session?.user.id)setMusic({playing:false,position:0}).catch(e=>toast(errorText(e)));});
$('music-seek').onchange=e=>setMusic({position:Number(e.target.value)}).catch(error=>toast(errorText(error)));
audioPlayer.addEventListener('timeupdate',()=>{if(Number.isFinite(audioPlayer.duration)){$('music-seek').max=String(audioPlayer.duration);if(document.activeElement!==$('music-seek'))$('music-seek').value=String(audioPlayer.currentTime);}});
setInterval(()=>{
  if(!musicState?.playing||audioPlayer.paused||!Number.isFinite(audioPlayer.duration))return;
  const expected=musicState.position+Math.max(0,(Date.now()-Date.parse(musicState.updated_at))/1000);
  if(Math.abs(expected-audioPlayer.currentTime)>2&&expected<audioPlayer.duration)audioPlayer.currentTime=expected;
},5000);

boot();
