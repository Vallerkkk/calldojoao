const $ = id => document.getElementById(id);
let db, config, session, channels = [], selected, signup = false;
let subscription, generation = 0, messages = new Map(), oldest, hasMore = false, loading = false;
let room, callChannel, joining = false, shuttingDown = false;
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
    await leaveCall(); return;
  }
  const name = next.user.user_metadata.display_name || 'Participante';
  $('user-name').textContent = name; $('user-avatar').textContent = initials(name);
  try {
    const {data, error} = await db.from('channels').select('*').order('position');
    if (error) throw error;
    if (!session || session.user.id !== next.user.id) return;
    channels = data;
    if (!data.length) throw Error('Nenhum canal disponível. Execute o arquivo supabase.sql.');
    renderChannels(); await selectChannel(channels.find(c => c.kind === 'text') || channels[0]);
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
  $('message-input').value = '';
  selected = channel; const version = ++generation;
  if (subscription) { db.removeChannel(subscription); subscription = null; }
  renderChannels(); $('channel-title').textContent = channel.name;
  $('text-view').hidden = channel.kind !== 'text'; $('voice-view').hidden = channel.kind !== 'voice';
  $('channel-description').textContent = channel.kind === 'text' ? 'O começo de boas conversas.' : 'Voz, vídeo e boas companhias.';
  if (channel.kind === 'voice') {
    $('voice-title').textContent = channel.name; updateCallUI(); return;
  }
  messages = new Map(); oldest = null; hasMore = false; loading = false; renderMessages();
  subscription = db.channel('messages-' + channel.id + '-' + version)
    .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}`}, async payload => {
      const {data, error} = await db.from('messages').select('*,profiles(display_name)').eq('id', payload.new.id).single();
      if (version !== generation) return;
      if (error) { toast('Uma mensagem não pôde ser atualizada. Reabra o canal.'); return; }
      const list = $('message-list'); const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
      messages.set(data.id, data); renderMessages(nearBottom);
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
    let query = db.from('messages').select('*,profiles(display_name)').eq('channel_id', selected.id)
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
    el('h1', '', 'Bem-vindo a #' + selected.name), el('p', '', 'Este é o espaço da comunidade. Puxe uma cadeira e comece uma conversa.'));
  list.append(welcome);
  if (hasMore) { const more = el('button', 'load-more', 'Carregar mensagens anteriores'); more.onclick = () => loadMessages(generation); list.append(more); }
  const sorted = [...messages.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const message of sorted) {
    const name = message.profiles?.display_name || 'Participante';
    const item = el('article', 'message'), content = el('div', 'message-content'), meta = el('div', 'message-meta');
    const time = el('time', '', new Date(message.created_at).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));
    time.dateTime = message.created_at; meta.append(el('strong', '', name), time);
    content.append(meta, el('p', '', message.content)); item.append(el('div', 'avatar', initials(name)), content); list.append(item);
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
    const {data, error} = await db.from('messages').insert({channel_id:channelId, author_id:session.user.id, content}).select('*,profiles(display_name)').single();
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
    const figure = el('figure', 'media-tile'); figure.dataset.track = track.sid;
    media.muted = true;
    figure.append(media, el('figcaption', '', (participant.name || 'Participante') + (track.source === 'screen_share' ? ' · Tela' : ' · Câmera')));
    $('media-grid').append(figure);
  } else { media.dataset.remoteAudio = 'true'; document.body.append(media); }
}
function removeTrack(track) {
  track.detach().forEach(node => { const tile = node.closest('.media-tile'); if (tile) tile.remove(); else node.remove(); });
}
function updateCallUI() {
  const here = !!room && callChannel?.id === selected?.id;
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
    const response = await fetch(`/api/channels/${target.id}/join`, {method:'POST', headers:{Authorization:`Bearer ${fresh.access_token}`}});
    const result = await response.json(); if (!response.ok) throw Error(result.detail || 'Não foi possível entrar.');
    const {Room, RoomEvent} = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/+esm');
    if (!session || shuttingDown) return;
    await leaveCall();
    const connected = new Room({adaptiveStream:true, dynacast:true}); room = connected; callChannel = target;
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
    try { await connected.localParticipant.setMicrophoneEnabled(true); }
    catch (error) { toast('Você entrou sem microfone. ' + errorText(error)); }
  } catch (error) { await leaveCall(); toast(errorText(error)); }
  finally { joining = false; updateCallUI(); }
};
$('leave-call').onclick = () => leaveCall();
for (const [id, property, method] of [['mic','isMicrophoneEnabled','setMicrophoneEnabled'],['camera','isCameraEnabled','setCameraEnabled'],['screen','isScreenShareEnabled','setScreenShareEnabled']]) {
  $(id).onclick = async () => {
    if (!room) return; $(id).disabled = true;
    try { await room.localParticipant[method](!room.localParticipant[property]); }
    catch (error) { toast(errorText(error)); }
    finally { $(id).disabled = false; updateCallUI(); }
  };
}
window.addEventListener('pagehide', () => { shuttingDown = true; if (room) room.disconnect(); });
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
boot();
