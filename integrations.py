from uuid import UUID
import os
import json
import re
import unicodedata
import httpx
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from upstream import client_for, read_json
from videochamada import install_videochamada

DEFAULT_GEMINI_KEY = ''
DEFAULT_GEMINI_PROJECT = '735777445484'


class LulaDroidQuery(BaseModel):
    model_config = ConfigDict(extra='ignore')
    prompt: str | None = None
    audio_base64: str | None = None
    mime_type: str | None = 'audio/webm'
    speaker: str | None = None
    channel_id: str | None = None


class LulaDroidTTSRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    text: str


def _normalize_trigger_check(text: str) -> bool:
    if not text:
        return False
    norm = ''.join(
        c for c in unicodedata.normalize('NFD', text.lower())
        if unicodedata.category(c) != 'Mn'
    )
    return bool(re.search(r'(?:e\s*ai|eai|ei|oi|ola)\s*[,.\s-]*lula\s*droid', norm))


def _extract_json_dict(raw_text: str) -> dict | None:
    cleaned = raw_text.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    match = re.search(r'\{[\s\S]*\}', cleaned)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return None


def install(app, current_user, settings, make_token):
    async def rows(table, headers, params):
        try:
            async with client_for(app) as client:
                response = await client.get(settings()['SUPABASE_URL'] + '/rest/v1/' + table, headers=headers, params=params)
        except httpx.HTTPError:
            raise HTTPException(503, 'A conexão com os dados falhou. Tente novamente.') from None
        if response.status_code != 200:
            raise HTTPException(503, 'Não foi possível consultar os dados da comunidade.')
        result = read_json(response, list)
        if any(not isinstance(item, dict) for item in result):
            raise HTTPException(503, 'O serviço de dados retornou uma resposta inválida.')
        return result

    async def scope(kind, target_id, user, headers):
        if kind not in ('channel', 'direct'):
            raise HTTPException(400, 'Destino inválido.')
        table = 'channels' if kind == 'channel' else 'conversations'
        found = await rows(table, headers, {'id': f'eq.{target_id}', 'select': '*'})
        if not found:
            raise HTTPException(404, 'Espaço inexistente ou sem acesso.')
        if kind == 'direct':
            convo = found[0]
            if user['id'] not in (convo['user_a'], convo['user_b']):
                raise HTTPException(404, 'Conversa sem acesso.')
            friends = await rows('friendships', headers, {'status': 'eq.accepted', 'or': f'(and(requester_id.eq.{convo["user_a"]},recipient_id.eq.{convo["user_b"]}),and(requester_id.eq.{convo["user_b"]},recipient_id.eq.{convo["user_a"]}))', 'select': 'id'})
            if not friends:
                raise HTTPException(403, 'Adicionem-se como amigos para continuar.')
        return found[0]

    install_videochamada(app, current_user, scope)

    @app.post('/api/conversations/{conversation_id}/join')
    async def private_join(conversation_id: UUID, identity=Depends(current_user)):
        user, headers = identity
        await scope('direct', conversation_id, user, headers)
        return make_token(user, f'direct-{conversation_id}')

    @app.post('/api/ai/luladroid/analyze')
    async def analyze_luladroid(body: LulaDroidQuery, identity=Depends(current_user)):
        user, _ = identity
        prompt = (body.prompt or '').strip()
        audio_b64 = (body.audio_base64 or '').strip()

        if not prompt and not audio_b64:
            raise HTTPException(400, 'Forneça um texto ou áudio para o Gemini processar.')

        key = os.getenv('GEMINI_API_KEY', '').strip()
        if not key:
            raise HTTPException(503, 'Configure GEMINI_API_KEY no servidor.')
        speaker_name = body.speaker or (user.get('user_metadata') or {}).get('display_name', 'Participante')

        system_instruction = (
            'Você é o LulaDroid, um assistente robô inteligente, carismático e prestativo '
            'em português brasileiro para as chamadas de voz e vídeo do aplicativo Órbita. '
            'Você realiza a transcrição precisa da fala e responde às dúvidas de forma amigável, direta e concisa '
            '(no máximo 2 ou 3 frases curtas), de modo que sua resposta soe excelente ao ser falada na chamada.'
        )

        # Do not pass x-goog-user-project with AI Studio Auth keys (AQ.Ab...)
        req_headers = {
            'Content-Type': 'application/json',
        }

        parts = []
        if audio_b64:
            clean_b64 = audio_b64.split(',')[-1].strip()
            clean_mime = (body.mime_type or 'audio/webm').split(';')[0].strip() or 'audio/webm'
            parts.append({
                'inlineData': {
                    'mimeType': clean_mime,
                    'data': clean_b64
                }
            })
            inst = (
                'Transcreva com precisão o que foi falado no áudio em português brasileiro (se houver apenas silêncio ou ruído sem fala, deixe "transcricao" vazia ""). '
                'Em seguida, verifique se a fala ativou o comando "eai LulaDroid" (ou variações como "e aí LulaDroid", "ei LulaDroid"). '
                'Se ativou, responda com gentileza à pergunta ou saudação (em 2 ou 3 frases curtas). '
                'Retorne estritamente um JSON no seguinte formato: '
                '{"transcricao": "texto transcrito aqui", "ativou": true ou false, "resposta": "sua resposta aqui ou vazio"}'
            )
            parts.append({'text': inst})
        else:
            parts.append({'text': prompt})

        payload = {
            'system_instruction': {'parts': [{'text': system_instruction}]},
            'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'temperature': 0.5 if audio_b64 else 0.7, 'maxOutputTokens': 400},
        }

        last_error = None
        for model in ('gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'):
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
            try:
                async with client_for(app) as client:
                    response = await client.post(url, headers=req_headers, json=payload)
                if response.status_code == 200:
                    data = read_json(response, dict)
                    candidates = data.get('candidates') or []
                    if candidates:
                        c_parts = (candidates[0].get('content') or {}).get('parts') or []
                        if c_parts and isinstance(c_parts[0].get('text'), str) and c_parts[0]['text'].strip():
                            raw_out = c_parts[0]['text'].strip()
                            if audio_b64:
                                parsed = _extract_json_dict(raw_out)
                                if parsed is not None:
                                    transcricao = str(parsed.get('transcricao') or '').strip()
                                    ativou = bool(parsed.get('ativou')) or _normalize_trigger_check(transcricao)
                                    resposta = str(parsed.get('resposta') or '').strip()
                                    return {
                                        'success': True,
                                        'transcription': transcricao,
                                        'triggered': ativou,
                                        'reply': resposta,
                                        'model': model,
                                        'speaker': speaker_name,
                                    }
                                triggered = _normalize_trigger_check(raw_out)
                                return {
                                    'success': True,
                                    'transcription': raw_out,
                                    'triggered': triggered,
                                    'reply': raw_out if triggered else '',
                                    'model': model,
                                    'speaker': speaker_name,
                                }
                            return {
                                'success': True,
                                'reply': raw_out,
                                'model': model,
                                'speaker': speaker_name,
                            }
                else:
                    last_error = f'HTTP {response.status_code}'
            except Exception as exc:
                last_error = str(exc)

        fallback_reply = (
            f"Olá {speaker_name}! LulaDroid na escuta com Gemini. "
            f"Ouvi sua mensagem: '{prompt or 'áudio recebido'}' e estou ativo na chamada!"
        )
        return {
            'success': True,
            'transcription': prompt or '',
            'triggered': False,
            'reply': fallback_reply if not audio_b64 else '',
            'model': 'fallback-gemini',
            'fallback': True,
            'error_detail': last_error,
        }

    @app.post('/api/ai/luladroid/tts')
    async def tts_luladroid(body: LulaDroidTTSRequest, identity=Depends(current_user)):
        _user, _ = identity
        text = (body.text or '').strip()
        if not text:
            raise HTTPException(400, 'Forneça o texto para sintetizar.')
        key = os.getenv('GEMINI_API_KEY', '').strip()
        if not key:
            raise HTTPException(503, 'Configure GEMINI_API_KEY no servidor.')
        url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key={key}'
        payload = {
            'contents': [{'role': 'user', 'parts': [{'text': f'Fale em português brasileiro de forma animada e natural: {text}'}]}],
            'generationConfig': {
                'responseModalities': ['AUDIO'],
                'speechConfig': {
                    'voiceConfig': {
                        'prebuiltVoiceConfig': {'voiceName': 'Aoede'}
                    }
                }
            }
        }
        try:
            async with client_for(app) as client:
                response = await client.post(url, headers={'Content-Type': 'application/json'}, json=payload)
            if response.status_code == 200:
                data = read_json(response, dict)
                candidates = data.get('candidates') or []
                if candidates:
                    parts = (candidates[0].get('content') or {}).get('parts') or []
                    for part in parts:
                        inline = part.get('inlineData') or {}
                        if inline.get('data'):
                            return {
                                'success': True,
                                'audioBase64': inline['data'],
                                'mimeType': inline.get('mimeType', 'audio/L16;rate=24000'),
                            }
        except Exception:
            pass
        return {'success': False, 'audioBase64': None}
