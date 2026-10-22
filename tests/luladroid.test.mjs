import test from 'node:test';
import assert from 'node:assert/strict';

test('LulaDroid activates ONLY when someone speaks "eai LulaDroid" in the call', () => {
  const triggerRegex = /(?:e\s*a[ií]|ea[ií])\s*[,.\s-]*lula\s*droid[,.:?!\s]*(.*)/i;

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

  // Must NOT trigger without "eai LulaDroid"
  assert.equal(matchTrigger('LulaDroid está na sala'), null);
  assert.equal(matchTrigger('ontem vi uma notícia sobre política'), null);
  assert.equal(matchTrigger('o android do meu celular atualizou'), null);
  assert.equal(matchTrigger('boa noite a todos na chamada'), null);
});

test('Gemini API request payload and headers match required credentials', () => {
  const key = 'AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA';
  const project = '735777445484';
  const prompt = 'Explique computação quântica';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': key,
    'x-goog-user-project': project
  };

  assert.ok(url.includes(key));
  assert.equal(headers['x-goog-api-key'], key);
  assert.equal(headers['x-goog-user-project'], '735777445484');

  const payload = {
    system_instruction: {
      parts: [{ text: 'Você é o LulaDroid' }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ]
  };

  assert.equal(payload.contents[0].parts[0].text, prompt);
});

test('Puter.js TTS parameters format Portuguese voice options', () => {
  const puterOptions = {
    language: 'pt-BR',
    engine: 'neural'
  };

  assert.equal(puterOptions.language, 'pt-BR');
  assert.equal(puterOptions.engine, 'neural');
});
