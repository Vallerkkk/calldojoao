/**
 * Módulo de Transcrição Contínua e Assistente de Voz LulaDroid para Órbita.
 * - Transcrição de toda a conversa na chamada via Puter Speech-to-Text (puter.ai.speech2txt) e Web Speech API.
 * - Ativação exclusiva quando alguém fala na chamada "eai LulaDroid".
 * - Análise inteligente de texto via Google Gemini API (Key: AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA / Project: projects/735777445484 / 735777445484).
 * - Resposta por voz na chamada via Puter Text-to-Speech API (https://developer.puter.com/tutorials/free-unlimited-text-to-speech-api/).
 * - Exibição de todas as transcrições no Chat Exclusivo da Call (#call-chat-panel).
 */

const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA';
const DEFAULT_GEMINI_PROJECT = '735777445484';
const DEFAULT_GEMINI_PROJECT_RESOURCE = 'projects/735777445484';

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
  let puterRecorderStop = null;
  const recentTranscripts = new Map();
  const conversationHistory = [];

  function getGeminiKey() {
    return state()?.config?.geminiApiKey || DEFAULT_GEMINI_KEY;
  }

  function getGeminiProject() {
    return state()?.config?.geminiProject || DEFAULT_GEMINI_PROJECT;
  }

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
      const badge = el('span', 'call-tag transcript-tag', 'Transcrição');
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
    const tag = el('span', 'call-tag transcript-interim-tag', 'Transcrevendo...');
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
    body.append(dot, document.createTextNode(` Analisando pergunta de ${speaker}: "${query}"...`));
    node.append(header, body);
    scrollToBottom();
  }

  function hideThinkingState() {
    const node = $('luladroid-thinking-node');
    if (node) node.remove();
  }

  // --- Voz na chamada com Puter Text-to-Speech API ---
  // Tutorial oficial: https://developer.puter.com/tutorials/free-unlimited-text-to-speech-api/
  async function speakWithPuter(text) {
    if (!text || !text.trim()) return;
    if (state()?.deafened) return;

    if (window.puter && window.puter.ai && typeof window.puter.ai.txt2speech === 'function') {
      const optionsToTry = [
        { language: 'pt-BR', engine: 'neural', voice: 'Camila' },
        { language: 'pt-BR', engine: 'neural' },
        { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', voice: 'Puck', instructions: 'Fale em português brasileiro de forma amigável e natural.' },
        'pt-BR'
      ];
      for (const opts of optionsToTry) {
        try {
          const audio = await window.puter.ai.txt2speech(text, opts);
          if (audio && typeof audio.play === 'function') {
            await audio.play();
            return;
          }
        } catch (err) {
          console.warn('[LulaDroid] Tentativa Puter TTS:', err);
        }
      }
    }

    // Fallback Web SpeechSynthesis
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const ptVoice = voices.find(v => v.lang === 'pt-BR' || v.lang.startsWith('pt'));
        if (ptVoice) utterance.voice = ptVoice;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error('[LulaDroid] Erro ao reproduzir síntese de voz:', err);
      }
    }
  }

  // --- Análise de texto com Gemini API (Key: AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA / Project: 735777445484) ---
  async function askGemini(promptText, speakerName) {
    const key = getGeminiKey();
    const project = getGeminiProject();

    const recentContext = conversationHistory
      .slice(-8)
      .map(item => `${item.sender}: ${item.text}`)
      .join('\n');

    const systemPrompt = (
      `Você é o LulaDroid, um assistente de voz inteligente, prestativo e carismático na chamada do aplicativo Órbita (Projeto ${DEFAULT_GEMINI_PROJECT_RESOURCE}). ` +
      `Você só ativa quando alguém diz "eai LulaDroid" na chamada. ` +
      `Analise o contexto da conversa e responda em português brasileiro de forma direta, clara e natural (em 2 a 3 frases curtas) para ser falada em voz alta na chamada.`
    );

    const fullUserPrompt = recentContext
      ? `Contexto recente da conversa na call:\n${recentContext}\n\nPergunta atual de ${speakerName}: ${promptText}`
      : `Pergunta de ${speakerName}: ${promptText}`;

    // 1. Chamada direta à API Google Gemini com a chave AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA e projeto 735777445484
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const headers = {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        };
        if (project) {
          headers['x-goog-user-project'] = project;
        }

        const body = {
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: fullUserPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;
          if (text) {
            return text.trim();
          }
        }
      } catch (err) {
        console.warn(`[LulaDroid] Erro direto ao consultar modelo ${model}:`, err);
      }
    }

    // 2. Tentativa via Backend Proxy do servidor Órbita (/api/ai/luladroid/analyze)
    try {
      const resp = await context.apiFetch('/api/ai/luladroid/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullUserPrompt, speaker: speakerName })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.reply && !data.fallback) return data.reply;
      }
    } catch (e) {
      console.warn('[LulaDroid] Backend proxy indisponível:', e);
    }

    // 3. Fallback via Puter AI Chat (com modelo Gemini)
    if (window.puter && window.puter.ai && typeof window.puter.ai.chat === 'function') {
      try {
        const puterPrompt = `${systemPrompt}\n\n${fullUserPrompt}`;
        const chatRes = await window.puter.ai.chat(puterPrompt, { model: 'gemini-2.0-flash' });
        const text = chatRes?.message?.content || chatRes?.text || (typeof chatRes === 'string' ? chatRes : '');
        if (text) return text.trim();
      } catch (e) {
        try {
          const chatRes = await window.puter.ai.chat(`${systemPrompt}\n\n${fullUserPrompt}`);
          const text = chatRes?.message?.content || chatRes?.text || (typeof chatRes === 'string' ? chatRes : '');
          if (text) return text.trim();
        } catch (e2) {
          console.warn('[LulaDroid] Puter AI chat falhou:', e2);
        }
      }
    }

    return `E aí, ${speakerName}! LulaDroid na escuta. Ouvi sua pergunta sobre "${promptText}" e estou acompanhando toda a chamada com vocês!`;
  }

  // --- Processar ativação "eai LulaDroid" ---
  async function handleLulaDroidTrigger(query, speakerName) {
    if (isThinking) return;
    isThinking = true;

    const statusEl = $('call-stt-status');
    const lulaState = $('luladroid-state-indicator');
    if (statusEl) statusEl.textContent = '🤖 LulaDroid analisando com Gemini...';
    if (lulaState) lulaState.textContent = 'Analisando...';

    const cleanQuery = query.trim() || 'Olá! Diga que está na escuta na chamada e pergunte como pode ajudar.';
    showThinkingState(speakerName, cleanQuery);

    try {
      const answer = await askGemini(cleanQuery, speakerName);
      hideThinkingState();

      // Exibir resposta no chat exclusivo da call
      addChatMessage({
        type: 'bot',
        sender: 'LulaDroid',
        text: answer,
        isBot: true,
        isLocal: false
      });

      // Transmitir para todos os outros participantes na sala LiveKit
      broadcastCallData('orbita-luladroid-resp', {
        text: answer,
        speaker: speakerName,
        query: cleanQuery
      });

      // Responder por voz na chamada (Puter TTS)
      if (lulaState) lulaState.textContent = 'Falando na call 🔊';
      toast('🤖 LulaDroid respondendo por voz na chamada...');
      await speakWithPuter(answer);

    } catch (error) {
      hideThinkingState();
      const errText = 'Desculpe companheiro, tive uma falha ao processar essa resposta agora.';
      addChatMessage({
        type: 'bot',
        sender: 'LulaDroid',
        text: errText,
        isBot: true
      });
      speakWithPuter(errText).catch(() => {});
    } finally {
      isThinking = false;
      if (statusEl) statusEl.textContent = '🎙️ Transcrição ativa · "eai LulaDroid"';
      if (lulaState) lulaState.textContent = 'Pronto na call';
    }
  }

  // --- Verificar se o texto falado contém "eai LulaDroid" ---
  function checkTrigger(text, speakerName) {
    if (!text || !text.trim()) return false;
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Ativa apenas quando alguém fala na chamada "eai LulaDroid" (incluindo variações fonéticas da transcrição como "e ai lula droid", "eaí luladroid")
    const triggerRegex = /(?:e\s*a[ií]|ea[ií])\s*[,.\s-]*lula\s*droid[,.:?!\s]*(.*)/i;
    const match = normalized.match(triggerRegex);
    if (match) {
      const query = (match[1] || '').trim();
      handleLulaDroidTrigger(query, speakerName);
      return true;
    }
    return false;
  }

  // --- Registrar uma transcrição finalizada ---
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

    checkTrigger(finalText, speakerName);
  }

  // --- Transmissão e Recepção no LiveKit ---
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
        checkTrigger(data.text, author);
      } else if (topic === 'orbita-luladroid-resp' && data.text) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
          text: data.text,
          isBot: true,
          isLocal: false
        });
        speakWithPuter(data.text).catch(() => {});
      }
    } catch (e) {
      console.warn('[CallChat] Erro ao decodificar dados da chamada:', e);
    }
  }

  // --- Transcrição de Áudio via Puter Speech-to-Text API (puter.ai.speech2txt) ---
  function startPuterAudioRecorder() {
    stopPuterAudioRecorder();
    if (!isTranscribing || !activeRoom || typeof MediaRecorder === 'undefined') return;

    let cancelled = false;
    let currentRecorder = null;
    let vadTimer = null;
    let audioCtx = null;

    async function attachStream() {
      try {
        // Obter a track de áudio do microfone local do LiveKit ou via getUserMedia
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
              if (blob.size < 1800) return;
              if (window.puter?.ai?.speech2txt) {
                try {
                  const res = await window.puter.ai.speech2txt(blob);
                  const text = (res?.text || (typeof res === 'string' ? res : '')).trim();
                  if (text) {
                    const localName = state()?.profile?.display_name || state()?.session?.user?.user_metadata?.display_name || 'Você';
                    handleFinalTranscript(localName, text, true);
                  }
                } catch (err) {
                  console.warn('[Puter STT] Aviso na transcrição de bloco:', err);
                }
              }
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
      } catch (err) {
        console.warn('[Puter STT] Não foi possível acoplar gravador auxiliar:', err);
      }
    }

    attachStream();

    puterRecorderStop = () => {
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

  function stopPuterAudioRecorder() {
    if (puterRecorderStop) {
      puterRecorderStop();
      puterRecorderStop = null;
    }
  }

  // --- Reconhecimento de Voz Contínuo em Tempo Real (Web Speech API + Puter STT) ---
  function startSpeechRecognition() {
    if (!isTranscribing) return;

    // Inicia gravador Puter STT em paralelo para garantir transcrição via Puter API
    startPuterAudioRecorder();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const statusEl = $('call-stt-status');
      if (statusEl) statusEl.textContent = '🎙️ Transcrição Puter ativa · Fale "eai LulaDroid"';
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
          sttBtn.title = 'Pausar transcrição contínua';
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
        console.warn('[CallTranscription] Aviso no reconhecimento de voz:', err.error);
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
    } catch (e) {
      console.warn('[CallTranscription] Web Speech API indisponível, usando Puter STT:', e);
    }
  }

  function stopSpeechRecognition() {
    clearTimeout(recognitionRestartTimer);
    stopPuterAudioRecorder();
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
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

  // --- Configuração dos Eventos da Interface ---
  function setupUI() {
    $('call-chat-close-btn')?.addEventListener('click', () => {
      toggleChatPanel(false);
    });

    $('call-stt-toggle-btn')?.addEventListener('click', () => {
      isTranscribing = !isTranscribing;
      if (isTranscribing) {
        startSpeechRecognition();
        toast('Transcrição de voz ativada na chamada.');
      } else {
        stopSpeechRecognition();
        toast('Transcrição pausada.');
      }
    });

    $('call-chat-toggle-btn')?.addEventListener('click', () => {
      toggleChatPanel();
    });

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

      addChatMessage({
        type: 'chat',
        sender: localName,
        text: val,
        isLocal: true
      });

      broadcastCallData('orbita-call-chat', {
        text: val,
        speaker: localName
      });

      checkTrigger(val, localName);
    });
  }

  setupUI();

  return {
    connected(room) {
      activeRoom = room;
      isTranscribing = true;
      // Abre automaticamente o Chat Exclusivo da Call em telas desktop para mostrar as transcrições ao vivo
      if (!window.__qaRoom && typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 800px)').matches) {
        toggleChatPanel(true);
      }
      startSpeechRecognition();
      const messages = $('call-chat-messages');
      if (messages && (!messages.children.length || $('call-chat-empty'))) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
          text: 'Transcrição da chamada ativa! Toda a conversa aparece aqui no chat exclusivo da call. Diga "eai LulaDroid" seguido da sua pergunta para eu analisar com Gemini e responder por voz!',
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
    speak: speakWithPuter
  };
}
