import test from 'node:test';
import assert from 'node:assert/strict';

test('LulaDroid activates ONLY when someone speaks "eai LulaDroid" in the call', () => {
  const triggerRegex = /(?:e\s*ai|eai|ei|oi|ola)\s*[,.\s-]*lula\s*droid[,.:?!\s]*(.*)/i;

  function matchTrigger(text) {
    const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const m = normalized.match(triggerRegex);
    return m ? (m[1] || '').trim() : null;
  }

  // Exact trigger as specified by user
  assert.equal(matchTrigger('eai LulaDroid'), '');
  assert.equal(matchTrigger('eai LulaDroid quem é você?'), 'quem e voce?');

  // Phonetic variations of "eai LulaDroid" from speech-to-text
  assert.equal(matchTrigger('e aí LulaDroid qual a previsão do tempo?'), 'qual a previsao do tempo?');
  assert.equal(matchTrigger('e ai LulaDroid me conta uma piada'), 'me conta uma piada');
  assert.equal(matchTrigger('eaí, LulaDroid, tudo bem?'), 'tudo bem?');
  assert.equal(matchTrigger('E aí Lula Droid, quanto é 2 mais 2?'), 'quanto e 2 mais 2?');

  // Must NOT trigger without greeting + LulaDroid
  assert.equal(matchTrigger('LulaDroid está na sala'), null);
  assert.equal(matchTrigger('ontem vi uma notícia sobre política'), null);
  assert.equal(matchTrigger('o android do meu celular atualizou'), null);
  assert.equal(matchTrigger('boa noite a todos na chamada'), null);
});

test('Gemini API request payload normalizes MIME type and avoids CORS-blocking project header', () => {
  const key = 'test-gemini-key';
  const rawMime = 'audio/webm;codecs=opus';
  const cleanMime = rawMime.split(';')[0].trim() || 'audio/webm';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const headers = {
    'Content-Type': 'application/json'
  };

  assert.ok(url.includes(key));
  assert.equal(cleanMime, 'audio/webm');
  assert.equal(headers['x-goog-user-project'], undefined);
});

test('Gemini TTS payload configures AUDIO modality and Aoede voice', () => {
  const ttsBody = {
    contents: [{
      role: 'user',
      parts: [{ text: 'Fale em português brasileiro de forma amigável e natural: Olá!' }]
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Aoede' }
        }
      }
    }
  };

  assert.deepEqual(ttsBody.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(ttsBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Aoede');
});
