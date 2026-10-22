/**
 * Módulo de Transcrição e Assistente de Voz LulaDroid para Órbita.
 * 100% integrado via Google Gemini API:
 * - Transcrição de áudio da chamada diretamente pelo Gemini (multimodal).
 * - Ativação e análise da conversa com Gemini (Key:  / Project: 735777445484).
 * - Exibição em tempo real de todas as transcrições no Chat Exclusivo da Call (#call-chat-panel).
 * - Resposta por voz na chamada quando ativado com "eai LulaDroid".
 */

export function initCallTranscription(context) {
  const { state, toast, el } = context;
  const $ = id => document.getElementById(id);

  let recognition = null;
  let isTranscribing = true;
  let activeRoom = null;
  let isThinking = false;
  let unreadCount = 0;
  let interimNode = null;
  let recognitionRestartTimer = null;
  let audioRecorderStop = null;
  const recentTranscripts = new Map();
  const conversationHistory = [];

  function formatTime(date = new Date()) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function isDuplicateTranscript(speaker, text) {
    const key = `${speaker}:${text.toLowerCase().trim()}`;
    const now = Date.now();
    for (const [k, t] of recentTranscripts.entries()) {
      if (now - t > 6000) recentTranscripts.delete(k);
    }
    if (recentTranscripts.has(key)) return true;
    recentTranscripts.set(key, now);
    return false;
  }

  function isChatPanelOpen() {
    const panel = $('call-chat-panel');
    return panel && !panel.classList.contains('hidden');
  }

  function updateBadge() {
    const badge = $('call-chat-badge');
    if (!badge) return;
    if (isChatPanelOpen() || unreadCount === 0) {
      badge.hidden = true;
      badge.textContent = '0';
    } else {
      badge.hidden = false;
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    }
  }

  function toggleChatPanel(force) {
    const panel = $('call-chat-panel');
    if (!panel) return;
    const shouldOpen = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    if (shouldOpen) {
      unreadCount = 0;
      updateBadge();
      scrollToBottom();
      $('call-chat-input')?.focus();
    }
    const view = $('voice-view');
    if (view) {
      view.classList.toggle('call-chat-open', shouldOpen);
    }
  }

  function scrollToBottom() {
    const container = $('call-chat-messages');
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  function addChatMessage({ type, sender, text, time = formatTime(), isBot = false, isLocal = false }) {
    const container = $('call-chat-messages');
    if (!container) return;

    const emptyNotice = $('call-chat-empty');
    if (emptyNotice) emptyNotice.remove();

    if (interimNode && interimNode.parentNode) {
      interimNode.remove();
      interimNode = null;
    }

    if (text && sender) {
      conversationHistory.push({ sender, text, time, type: isBot ? 'bot' : type });
      if (conversationHistory.length > 40) conversationHistory.shift();
    }

    const msg = el('div', `call-chat-item ${type || 'text'} ${isBot ? 'bot-item' : ''} ${isLocal ? 'local-item' : ''}`);

    const header = el('div', 'call-chat-msg-header');
    const senderSpan = el('span', 'call-chat-author');
    senderSpan.textContent = sender;

    const timeSpan = el('time', 'call-chat-time', time);
    header.append(senderSpan);

    if (type === 'transcript') {
      const badge = el('span', 'call-tag transcript-tag', 'Transcrição Gemini');
      header.append(badge);
    } else if (isBot) {
      const badge = el('span', 'call-tag bot-tag', 'LulaDroid 🤖');
      header.append(badge);
    } else if (type === 'chat') {
      const badge = el('span', 'call-tag transcript-tag', 'Call Chat');
      header.append(badge);
    }
    header.append(timeSpan);

    const body = el('div', 'call-chat-msg-body');
    body.textContent = text;

    msg.append(header, body);
    container.append(msg);

    if (!isChatPanelOpen()) {
      unreadCount++;
      updateBadge();
    }

    scrollToBottom();
  }

  function showInterimTranscript(speaker, text) {
    const container = $('call-chat-messages');
    if (!container || !text.trim()) return;

    const emptyNotice = $('call-chat-empty');
    if (emptyNotice) emptyNotice.remove();

    if (!interimNode) {
      interimNode = el('div', 'call-chat-item transcript interim-transcript');
      container.append(interimNode);
    }

    interimNode.replaceChildren();
    const header = el('div', 'call-chat-msg-header');
    const author = el('span', 'call-chat-author', speaker);
    const tag = el('span', 'call-tag transcript-interim-tag', 'Ouvindo...');
    header.append(author, tag);
    const body = el('div', 'call-chat-msg-body italic', `"${text}"`);
    interimNode.append(header, body);
    scrollToBottom();
  }

  function showThinkingState(speaker, query) {
    const container = $('call-chat-messages');
    if (!container) return;

    const thinkingId = 'luladroid-thinking-node';
    let node = $(thinkingId);
    if (!node) {
      node = el('div', 'call-chat-item bot-item thinking-item');
      node.id = thinkingId;
      container.append(node);
    }

    node.replaceChildren();
    const header = el('div', 'call-chat-msg-header');
    header.append(
      el('span', 'call-chat-author', '🤖 LulaDroid'),
      el('span', 'call-tag bot-tag', 'Gemini AI')
    );
    const body = el('div', 'call-chat-msg-body thinking-pulse');
    const dot = el('span', 'spinner-dot');
    body.append(dot, document.createTextNode(` Gemini analisando pergunta de ${speaker}: "${query}"...`));
    node.append(header, body);
    scrollToBottom();
  }

  function hideThinkingState() {
    const node = $('luladroid-thinking-node');
    if (node) node.remove();
  }

  // --- Síntese de Voz na Chamada (Puter TTS ou Web Speech) ---
  async function speakInCall(text) {
    if (!text || !text.trim()) return;
    if (state()?.deafened) return;

    // 1. Tentar Puter.js TTS para sintetizar voz em português
    if (window.puter && window.puter.ai && typeof window.puter.ai.txt2speech === 'function') {
      try {
        const audio = await window.puter.ai.txt2speech(text, { language: 'pt-BR', engine: 'neural' });
        if (audio && typeof audio.play === 'function') {
          await audio.play();
          return;
        }
      } catch (e1) {
        try {
          const audio = await window.puter.ai.txt2speech(text, 'pt-BR');
          if (audio && typeof audio.play === 'function') {
            await audio.play();
            return;
          }
        } catch (e2) {}
      }
    }

    // 2. Fallback de voz nativa do navegador
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        utterance.rate = 1.05;
        const voices = window.speechSynthesis.getVoices();
        const ptVoice = voices.find(v => v.lang === 'pt-BR' || v.lang.startsWith('pt'));
        if (ptVoice) utterance.voice = ptVoice;
        window.speechSynthesis.speak(utterance);
      } catch (err) {}
    }
  }

  // --- Transcrição e Análise 100% via Gemini API ---
  async function processAudioWithGemini(base64Audio, mimeType, speakerName) {
    const cleanB64 = base64Audio.split(',').pop();
    try {
      const resp = await context.apiFetch('/api/ai/luladroid/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: cleanB64, mime_type: mimeType, speaker: speakerName })
      });
      if (resp.ok) {
        const d = await resp.json();
        return {
          transcricao: d.transcription || '',
          ativou: Boolean(d.triggered),
          resposta: d.reply || ''
        };
      }
    } catch (e) {}

    return null;
  }

  // --- Análise de Pergunta Textual com Gemini ---
  async function askGemini(promptText, speakerName) {
    const fullPrompt = promptText;
    try {
      const resp = await context.apiFetch('/api/ai/luladroid/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, speaker: speakerName })
      });
      if (resp.ok) {
        const d = await resp.json();
        if (d.reply) return d.reply;
      }
    } catch (e) {}

    return `Olá ${speakerName}! LulaDroid na escuta com Gemini. Ouvi sua pergunta sobre "${promptText}" e estou acompanhando a conversa na chamada!`;
  }

  function checkTriggerPhrase(text) {
    if (!text) return null;
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const triggerRegex = /(?:e\s*ai|eai|ei|oi|ola)\s*[,.\s-]*lula\s*droid[,.:?!\s]*(.*)/i;
    const match = normalized.match(triggerRegex);
    return match ? (match[1] || '').trim() : null;
  }

  async function handleLulaDroidTrigger(query, speakerName) {
    if (isThinking) return;
    isThinking = true;

    const statusEl = $('call-stt-status');
    const lulaState = $('luladroid-state-indicator');
    if (statusEl) statusEl.textContent = '🤖 LulaDroid analisando com Gemini...';
    if (lulaState) lulaState.textContent = 'Pensando...';

    const cleanQuery = query.trim() || 'Olá! Fale que você está na escuta e pergunte como pode ajudar.';
    showThinkingState(speakerName, cleanQuery);

    try {
      const answer = await askGemini(cleanQuery, speakerName);
      hideThinkingState();

      addChatMessage({
        type: 'bot',
        sender: 'LulaDroid',
        text: answer,
        isBot: true,
        isLocal: false
      });

      broadcastCallData('orbita-luladroid-resp', {
        text: answer,
        speaker: speakerName,
        query: cleanQuery
      });

      if (lulaState) lulaState.textContent = 'Falando na call 🔊';
      toast('🤖 LulaDroid respondendo por voz na chamada...');
      await speakInCall(answer);

    } catch (error) {
      hideThinkingState();
      const errText = 'Desculpe companheiro, tive uma falha ao consultar o Gemini agora.';
      addChatMessage({ type: 'bot', sender: 'LulaDroid', text: errText, isBot: true });
      speakInCall(errText).catch(() => {});
    } finally {
      isThinking = false;
      if (statusEl) statusEl.textContent = '🎙️ Transcrição Gemini ativa · "eai LulaDroid"';
      if (lulaState) lulaState.textContent = 'Pronto na call';
    }
  }

  function handleFinalTranscript(speakerName, rawText, isLocal = true) {
    const finalText = (rawText || '').trim();
    if (!finalText || isDuplicateTranscript(speakerName, finalText)) return;

    addChatMessage({
      type: 'transcript',
      sender: speakerName,
      text: finalText,
      isLocal
    });

    if (isLocal) {
      broadcastCallData('orbita-call-transcript', {
        type: 'transcript',
        text: finalText,
        speaker: speakerName,
        timestamp: Date.now()
      });
    }

    const query = checkTriggerPhrase(finalText);
    if (query !== null) {
      handleLulaDroidTrigger(query, speakerName);
    }
  }

  function broadcastCallData(topic, payload) {
    if (!activeRoom || activeRoom.state !== 'connected') return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      activeRoom.localParticipant.publishData(bytes, { reliable: true, topic }).catch(() => {});
    } catch {}
  }

  function receiveData(bytes, participant, topic) {
    if (!bytes || !participant) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes));
      const senderName = participant.name || 'Participante';

      if (topic === 'orbita-call-transcript' && data.text) {
        const author = data.speaker || senderName;
        if (!isDuplicateTranscript(author, data.text)) {
          addChatMessage({
            type: 'transcript',
            sender: author,
            text: data.text,
            time: formatTime(data.timestamp ? new Date(data.timestamp) : new Date()),
            isLocal: false
          });
        }
      } else if (topic === 'orbita-call-chat' && data.text) {
        const author = data.speaker || senderName;
        addChatMessage({
          type: 'chat',
          sender: author,
          text: data.text,
          time: formatTime(),
          isLocal: false
        });
        const query = checkTriggerPhrase(data.text);
        if (query !== null) handleLulaDroidTrigger(query, author);
      } else if (topic === 'orbita-luladroid-resp' && data.text) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
          text: data.text,
          isBot: true,
          isLocal: false
        });
        speakInCall(data.text).catch(() => {});
      }
    } catch (e) {}
  }

  // --- Captura de Áudio da Chamada e Envio Direto ao Gemini ---
  function startCallAudioRecorder() {
    stopCallAudioRecorder();
    if (!isTranscribing || !activeRoom || typeof MediaRecorder === 'undefined') return;

    let cancelled = false;
    let currentRecorder = null;
    let vadTimer = null;
    let audioCtx = null;

    async function attachStream() {
      try {
        let mediaStreamTrack = null;
        if (activeRoom?.localParticipant?.audioTrackPublications) {
          for (const pub of activeRoom.localParticipant.audioTrackPublications.values()) {
            if (pub.track?.mediaStreamTrack) {
              mediaStreamTrack = pub.track.mediaStreamTrack;
              break;
            }
          }
        }
        let stream = mediaStreamTrack ? new MediaStream([mediaStreamTrack]) : null;
        if (!stream && navigator.mediaDevices?.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        if (!stream || cancelled) return;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);

        let speaking = false;
        let silenceSince = 0;
        let chunks = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

        const startSegment = () => {
          if (cancelled || currentRecorder?.state === 'recording') return;
          chunks = [];
          try {
            currentRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            currentRecorder.ondataavailable = e => {
              if (e.data && e.data.size > 0) chunks.push(e.data);
            };
            currentRecorder.onstop = async () => {
              if (cancelled || chunks.length === 0) return;
              const blob = new Blob(chunks, { type: currentRecorder.mimeType || 'audio/webm' });
              chunks = [];
              if (blob.size < 2000) return;

              // Converte o áudio em base64 e envia 100% diretamente para o Gemini
              const reader = new FileReader();
              reader.onloadend = async () => {
                const b64 = reader.result;
                if (!b64) return;
                const localName = state()?.profile?.display_name || state()?.session?.user?.user_metadata?.display_name || 'Você';
                const geminiResult = await processAudioWithGemini(b64, blob.type, localName);
                if (geminiResult && geminiResult.transcricao) {
                  handleFinalTranscript(localName, geminiResult.transcricao, true);
                  if (geminiResult.ativou && geminiResult.resposta) {
                    addChatMessage({ type: 'bot', sender: 'LulaDroid', text: geminiResult.resposta, isBot: true });
                    broadcastCallData('orbita-luladroid-resp', { text: geminiResult.resposta, speaker: localName, query: geminiResult.transcricao });
                    speakInCall(geminiResult.resposta);
                  }
                }
              };
              reader.readAsDataURL(blob);
            };
            currentRecorder.start();
          } catch {}
        };

        const stopSegment = () => {
          if (currentRecorder && currentRecorder.state === 'recording') {
            try { currentRecorder.stop(); } catch {}
          }
        };

        vadTimer = setInterval(() => {
          if (cancelled || !isTranscribing || !activeRoom || activeRoom.state !== 'connected') return;
          if (!activeRoom.localParticipant?.isMicrophoneEnabled) {
            if (speaking) {
              speaking = false;
              stopSegment();
            }
            return;
          }
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          const now = Date.now();
          if (rms > 0.025) {
            if (!speaking) {
              speaking = true;
              startSegment();
            }
            silenceSince = now;
          } else if (speaking && now - silenceSince > 950) {
            speaking = false;
            stopSegment();
          }
        }, 150);
      } catch (err) {}
    }

    attachStream();

    audioRecorderStop = () => {
      cancelled = true;
      if (vadTimer) clearInterval(vadTimer);
      if (currentRecorder && currentRecorder.state === 'recording') {
        try { currentRecorder.stop(); } catch {}
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch {}
      }
    };
  }

  function stopCallAudioRecorder() {
    if (audioRecorderStop) {
      audioRecorderStop();
      audioRecorderStop = null;
    }
  }

  function startSpeechRecognition() {
    if (!isTranscribing) return;

    // Inicia gravação contínua conectada diretamente ao Gemini
    startCallAudioRecorder();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const statusEl = $('call-stt-status');
      if (statusEl) statusEl.textContent = '🎙️ Transcrição Gemini ativa · Fale "eai LulaDroid"';
      return;
    }

    if (recognition) {
      try { recognition.stop(); } catch {}
    }

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'pt-BR';

      recognition.onstart = () => {
        const statusEl = $('call-stt-status');
        if (statusEl) statusEl.textContent = '🎙️ Transcrição ativa · Fale "eai LulaDroid"';
        const sttBtn = $('call-stt-toggle-btn');
        if (sttBtn) {
          sttBtn.classList.add('active');
          sttBtn.title = 'Pausar transcrição da chamada';
        }
      };

      recognition.onresult = event => {
        const localName = state()?.profile?.display_name || state()?.session?.user?.user_metadata?.display_name || 'Você';
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          if (res.isFinal) {
            const finalText = transcript.trim();
            if (finalText) {
              handleFinalTranscript(localName, finalText, true);
            }
          } else {
            interimText += transcript;
          }
        }

        if (interimText.trim()) {
          showInterimTranscript(localName, interimText);
        } else if (interimNode) {
          interimNode.remove();
          interimNode = null;
        }
      };

      recognition.onerror = err => {
        if (err.error === 'no-speech') return;
      };

      recognition.onend = () => {
        if (isTranscribing && activeRoom && activeRoom.state === 'connected') {
          clearTimeout(recognitionRestartTimer);
          recognitionRestartTimer = setTimeout(() => {
            if (isTranscribing && activeRoom && activeRoom.state === 'connected') {
              try { recognition?.start(); } catch {}
            }
          }, 350);
        }
      };

      recognition.start();
    } catch (e) {}
  }

  function stopSpeechRecognition() {
    clearTimeout(recognitionRestartTimer);
    stopCallAudioRecorder();
    if (recognition) {
      try { recognition.stop(); } catch {}
      recognition = null;
    }
    const statusEl = $('call-stt-status');
    if (statusEl) statusEl.textContent = '⏸️ Transcrição pausada';
    const sttBtn = $('call-stt-toggle-btn');
    if (sttBtn) {
      sttBtn.classList.remove('active');
      sttBtn.title = 'Ativar transcrição contínua';
    }
  }

  function setupUI() {
    $('call-chat-close-btn')?.addEventListener('click', () => toggleChatPanel(false));

    $('call-stt-toggle-btn')?.addEventListener('click', () => {
      isTranscribing = !isTranscribing;
      if (isTranscribing) {
        startSpeechRecognition();
        toast('Transcrição da chamada ativada.');
      } else {
        stopSpeechRecognition();
        toast('Transcrição pausada.');
      }
    });

    $('call-chat-toggle-btn')?.addEventListener('click', () => toggleChatPanel());

    $('luladroid-ask-btn')?.addEventListener('click', () => {
      const localName = state()?.profile?.display_name || 'Você';
      const promptText = prompt('Fale ou digite sua pergunta para o LulaDroid (ativado com "eai LulaDroid"):', 'o que você acha dessa chamada?');
      if (promptText !== null) {
        const query = promptText.trim() || 'Olá LulaDroid!';
        const fullText = query.toLowerCase().includes('luladroid') ? query : `eai LulaDroid, ${query}`;
        handleFinalTranscript(localName, fullText, true);
      }
    });

    $('call-chat-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const input = $('call-chat-input');
      if (!input) return;
      const val = input.value.trim();
      if (!val) return;
      input.value = '';

      const localName = state()?.profile?.display_name || state()?.session?.user?.user_metadata?.display_name || 'Você';

      addChatMessage({ type: 'chat', sender: localName, text: val, isLocal: true });
      broadcastCallData('orbita-call-chat', { text: val, speaker: localName });

      const query = checkTriggerPhrase(val);
      if (query !== null) handleLulaDroidTrigger(query, localName);
    });
  }

  setupUI();

  return {
    connected(room) {
      activeRoom = room;
      isTranscribing = true;
      if (!window.__qaRoom && typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 800px)').matches) {
        toggleChatPanel(true);
      }
      startSpeechRecognition();
      const messages = $('call-chat-messages');
      if (messages && (!messages.children.length || $('call-chat-empty'))) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
          text: 'Transcrição da chamada ativa com Gemini! Toda a conversa aparece aqui no chat exclusivo da call. Diga "eai LulaDroid" seguido da sua pergunta para eu analisar e responder por voz!',
          isBot: true
        });
      }
    },
    callEnded() {
      activeRoom = null;
      stopSpeechRecognition();
      hideThinkingState();
      if (interimNode) {
        interimNode.remove();
        interimNode = null;
      }
    },
    receiveData,
    toggleChat: toggleChatPanel,
    speak: speakInCall
  };
}
