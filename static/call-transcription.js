/**
<<<<<<< HEAD
 * Módulo de Transcrição e Assistente de Voz LulaDroid para Órbita.
 * 100% integrado via Google Gemini API:
 * - Transcrição de áudio da chamada diretamente pelo Gemini (multimodal).
 * - Ativação e análise da conversa com Gemini (Key: AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA / Project: 735777445484).
 * - Exibição em tempo real de todas as transcrições no Chat Exclusivo da Call (#call-chat-panel).
 * - Resposta por voz na chamada quando ativado com "eai LulaDroid".
=======
 * Módulo de Transcrição Contínua e Assistente de Voz LulaDroid para Órbita.
 * - Transcrição de toda a conversa na chamada via Puter Speech-to-Text (puter.ai.speech2txt) e Web Speech API.
 * - Ativação exclusiva quando alguém fala na chamada "eai LulaDroid".
 * - Análise inteligente de texto via Google Gemini API (Key: AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA / Project: projects/735777445484 / 735777445484).
 * - Resposta por voz na chamada via Puter Text-to-Speech API (https://developer.puter.com/tutorials/free-unlimited-text-to-speech-api/).
 * - Exibição de todas as transcrições no Chat Exclusivo da Call (#call-chat-panel).
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
 */

const DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA';
const DEFAULT_GEMINI_PROJECT = '735777445484';
<<<<<<< HEAD
=======
const DEFAULT_GEMINI_PROJECT_RESOURCE = 'projects/735777445484';
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435

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
<<<<<<< HEAD
  let audioRecorderStop = null;
=======
  let puterRecorderStop = null;
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
    header.append(senderSpan);

    if (type === 'transcript') {
      const badge = el('span', 'call-tag transcript-tag', 'Transcrição Gemini');
=======

    header.append(senderSpan);

    if (type === 'transcript') {
      const badge = el('span', 'call-tag transcript-tag', 'Transcrição');
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
    const tag = el('span', 'call-tag transcript-interim-tag', 'Ouvindo...');
=======
    const tag = el('span', 'call-tag transcript-interim-tag', 'Transcrevendo...');
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
    body.append(dot, document.createTextNode(` Gemini analisando pergunta de ${speaker}: "${query}"...`));
=======
    body.append(dot, document.createTextNode(` Analisando pergunta de ${speaker}: "${query}"...`));
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    node.append(header, body);
    scrollToBottom();
  }

  function hideThinkingState() {
    const node = $('luladroid-thinking-node');
    if (node) node.remove();
  }

<<<<<<< HEAD
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
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
          if (audio && typeof audio.play === 'function') {
            await audio.play();
            return;
          }
<<<<<<< HEAD
        } catch (e2) {}
      }
    }

    // 2. Fallback de voz nativa do navegador
=======
        } catch (err) {
          console.warn('[LulaDroid] Tentativa Puter TTS:', err);
        }
      }
    }

    // Fallback Web SpeechSynthesis
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        utterance.rate = 1.05;
<<<<<<< HEAD
=======
        utterance.pitch = 1.0;
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
        const voices = window.speechSynthesis.getVoices();
        const ptVoice = voices.find(v => v.lang === 'pt-BR' || v.lang.startsWith('pt'));
        if (ptVoice) utterance.voice = ptVoice;
        window.speechSynthesis.speak(utterance);
<<<<<<< HEAD
      } catch (err) {}
    }
  }

  // --- Transcrição e Análise 100% via Gemini API ---
  async function processAudioWithGemini(base64Audio, mimeType, speakerName) {
    const key = getGeminiKey();
    const project = getGeminiProject();

    const cleanB64 = base64Audio.split(',')[-1];
    const systemPrompt = (
      `Você é o LulaDroid, assistente inteligente na chamada de voz do Órbita (Projeto ${project}). ` +
      `Sua tarefa: 1) Transcrever em português brasileiro exatamente o que foi falado no áudio. ` +
      `2) Verificar se a pessoa disse "eai LulaDroid" (ou "e aí LulaDroid"). ` +
      `3) Se disse "eai LulaDroid", responda com simpatia e de forma concisa (2 a 3 frases) à pergunta ou saudação. ` +
      `Retorne APENAS um JSON no formato: {"transcricao": "texto transcrito", "ativou": true/false, "resposta": "texto da resposta ou vazio"}`
    );

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: cleanB64
            }
          },
          { text: 'Transcreva e analise este áudio da chamada.' }
        ]
      }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 350 }
    };

    // 1. Tentar direto na Gemini API
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
        if (project) headers['x-goog-user-project'] = project;

        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (response.ok) {
          const resJson = await response.json();
          const outText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
          if (outText) {
            try {
              const cleanJson = outText.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
              return JSON.parse(cleanJson);
            } catch {
              return { transcricao: outText.trim(), ativou: checkTriggerPhrase(outText), resposta: outText.trim() };
            }
          }
        }
      } catch (err) {}
    }

    // 2. Tentar via backend proxy
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
=======
      } catch (err) {
        console.error('[LulaDroid] Erro ao reproduzir síntese de voz:', err);
      }
    }
  }

  // --- Análise de texto com Gemini API (Key: AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA / Project: 735777445484) ---
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
  async function askGemini(promptText, speakerName) {
    const key = getGeminiKey();
    const project = getGeminiProject();

    const recentContext = conversationHistory
<<<<<<< HEAD
      .slice(-6)
=======
      .slice(-8)
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      .map(item => `${item.sender}: ${item.text}`)
      .join('\n');

    const systemPrompt = (
<<<<<<< HEAD
      `Você é o LulaDroid, assistente de voz do Órbita (Projeto ${project}). ` +
      `Você responde em português brasileiro a quem diz "eai LulaDroid" na chamada. ` +
      `Responda de forma direta, amigável e concisa (2 a 3 frases) para ser falada em voz alta na chamada.`
    );

    const fullPrompt = recentContext
      ? `Histórico recente da chamada:\n${recentContext}\n\nPergunta de ${speakerName}: ${promptText}`
      : `Pergunta de ${speakerName}: ${promptText}`;

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
    };

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
        if (project) headers['x-goog-user-project'] = project;

        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (response.ok) {
          const resJson = await response.json();
          const out = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
          if (out) return out.trim();
        }
      } catch (err) {}
    }

=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    try {
      const resp = await context.apiFetch('/api/ai/luladroid/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
<<<<<<< HEAD
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
    const triggerRegex = /(?:e\s*a[ií]|ea[ií])\s*[,.\s-]*lula\s*droid[,.:?!\s]*(.*)/i;
    const match = normalized.match(triggerRegex);
    return match ? (match[1] || '').trim() : null;
  }

=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
  async function handleLulaDroidTrigger(query, speakerName) {
    if (isThinking) return;
    isThinking = true;

    const statusEl = $('call-stt-status');
    const lulaState = $('luladroid-state-indicator');
    if (statusEl) statusEl.textContent = '🤖 LulaDroid analisando com Gemini...';
<<<<<<< HEAD
    if (lulaState) lulaState.textContent = 'Pensando...';

    const cleanQuery = query.trim() || 'Olá! Fale que você está na escuta e pergunte como pode ajudar.';
=======
    if (lulaState) lulaState.textContent = 'Analisando...';

    const cleanQuery = query.trim() || 'Olá! Diga que está na escuta na chamada e pergunte como pode ajudar.';
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    showThinkingState(speakerName, cleanQuery);

    try {
      const answer = await askGemini(cleanQuery, speakerName);
      hideThinkingState();

<<<<<<< HEAD
=======
      // Exibir resposta no chat exclusivo da call
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      addChatMessage({
        type: 'bot',
        sender: 'LulaDroid',
        text: answer,
        isBot: true,
        isLocal: false
      });

<<<<<<< HEAD
=======
      // Transmitir para todos os outros participantes na sala LiveKit
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      broadcastCallData('orbita-luladroid-resp', {
        text: answer,
        speaker: speakerName,
        query: cleanQuery
      });

<<<<<<< HEAD
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
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      if (lulaState) lulaState.textContent = 'Pronto na call';
    }
  }

<<<<<<< HEAD
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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

<<<<<<< HEAD
    const query = checkTriggerPhrase(finalText);
    if (query !== null) {
      handleLulaDroidTrigger(query, speakerName);
    }
  }

=======
    checkTrigger(finalText, speakerName);
  }

  // --- Transmissão e Recepção no LiveKit ---
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
        const query = checkTriggerPhrase(data.text);
        if (query !== null) handleLulaDroidTrigger(query, author);
=======
        checkTrigger(data.text, author);
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      } else if (topic === 'orbita-luladroid-resp' && data.text) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
          text: data.text,
          isBot: true,
          isLocal: false
        });
<<<<<<< HEAD
        speakInCall(data.text).catch(() => {});
      }
    } catch (e) {}
  }

  // --- Captura de Áudio da Chamada e Envio Direto ao Gemini ---
  function startCallAudioRecorder() {
    stopCallAudioRecorder();
=======
        speakWithPuter(data.text).catch(() => {});
      }
    } catch (e) {
      console.warn('[CallChat] Erro ao decodificar dados da chamada:', e);
    }
  }

  // --- Transcrição de Áudio via Puter Speech-to-Text API (puter.ai.speech2txt) ---
  function startPuterAudioRecorder() {
    stopPuterAudioRecorder();
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    if (!isTranscribing || !activeRoom || typeof MediaRecorder === 'undefined') return;

    let cancelled = false;
    let currentRecorder = null;
    let vadTimer = null;
    let audioCtx = null;

    async function attachStream() {
      try {
<<<<<<< HEAD
=======
        // Obter a track de áudio do microfone local do LiveKit ou via getUserMedia
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
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
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
      } catch (err) {}
=======
      } catch (err) {
        console.warn('[Puter STT] Não foi possível acoplar gravador auxiliar:', err);
      }
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    }

    attachStream();

<<<<<<< HEAD
    audioRecorderStop = () => {
=======
    puterRecorderStop = () => {
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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

<<<<<<< HEAD
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
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const statusEl = $('call-stt-status');
<<<<<<< HEAD
      if (statusEl) statusEl.textContent = '🎙️ Transcrição Gemini ativa · Fale "eai LulaDroid"';
=======
      if (statusEl) statusEl.textContent = '🎙️ Transcrição Puter ativa · Fale "eai LulaDroid"';
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
          sttBtn.title = 'Pausar transcrição da chamada';
=======
          sttBtn.title = 'Pausar transcrição contínua';
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
=======
        console.warn('[CallTranscription] Aviso no reconhecimento de voz:', err.error);
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
    } catch (e) {}
=======
    } catch (e) {
      console.warn('[CallTranscription] Web Speech API indisponível, usando Puter STT:', e);
    }
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
  }

  function stopSpeechRecognition() {
    clearTimeout(recognitionRestartTimer);
<<<<<<< HEAD
    stopCallAudioRecorder();
    if (recognition) {
      try { recognition.stop(); } catch {}
=======
    stopPuterAudioRecorder();
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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

<<<<<<< HEAD
  function setupUI() {
    $('call-chat-close-btn')?.addEventListener('click', () => toggleChatPanel(false));
=======
  // --- Configuração dos Eventos da Interface ---
  function setupUI() {
    $('call-chat-close-btn')?.addEventListener('click', () => {
      toggleChatPanel(false);
    });
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435

    $('call-stt-toggle-btn')?.addEventListener('click', () => {
      isTranscribing = !isTranscribing;
      if (isTranscribing) {
        startSpeechRecognition();
<<<<<<< HEAD
        toast('Transcrição da chamada ativada.');
=======
        toast('Transcrição de voz ativada na chamada.');
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      } else {
        stopSpeechRecognition();
        toast('Transcrição pausada.');
      }
    });

<<<<<<< HEAD
    $('call-chat-toggle-btn')?.addEventListener('click', () => toggleChatPanel());
=======
    $('call-chat-toggle-btn')?.addEventListener('click', () => {
      toggleChatPanel();
    });
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435

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

<<<<<<< HEAD
      addChatMessage({ type: 'chat', sender: localName, text: val, isLocal: true });
      broadcastCallData('orbita-call-chat', { text: val, speaker: localName });

      const query = checkTriggerPhrase(val);
      if (query !== null) handleLulaDroidTrigger(query, localName);
=======
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
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    });
  }

  setupUI();

  return {
    connected(room) {
      activeRoom = room;
      isTranscribing = true;
<<<<<<< HEAD
=======
      // Abre automaticamente o Chat Exclusivo da Call em telas desktop para mostrar as transcrições ao vivo
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
      if (!window.__qaRoom && typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 800px)').matches) {
        toggleChatPanel(true);
      }
      startSpeechRecognition();
      const messages = $('call-chat-messages');
      if (messages && (!messages.children.length || $('call-chat-empty'))) {
        addChatMessage({
          type: 'bot',
          sender: 'LulaDroid',
<<<<<<< HEAD
          text: 'Transcrição da chamada ativa com Gemini! Toda a conversa aparece aqui no chat exclusivo da call. Diga "eai LulaDroid" seguido da sua pergunta para eu analisar e responder por voz!',
=======
          text: 'Transcrição da chamada ativa! Toda a conversa aparece aqui no chat exclusivo da call. Diga "eai LulaDroid" seguido da sua pergunta para eu analisar com Gemini e responder por voz!',
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
    speak: speakInCall
=======
    speak: speakWithPuter
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
  };
}
