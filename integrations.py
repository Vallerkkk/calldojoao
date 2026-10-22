from uuid import UUID
import os
<<<<<<< HEAD
import json
=======
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
import httpx
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from upstream import client_for, read_json
from videochamada import install_videochamada

DEFAULT_GEMINI_KEY = 'AQ.Ab8RN6LwIVMnELQD7LmloIbFn9gK3bu5MAgVV8Lmc1T6xOsRPA'
DEFAULT_GEMINI_PROJECT = '735777445484'


class LulaDroidQuery(BaseModel):
    model_config = ConfigDict(extra='ignore')
<<<<<<< HEAD
    prompt: str | None = None
    audio_base64: str | None = None
    mime_type: str | None = 'audio/webm'
=======
    prompt: str
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
    speaker: str | None = None
    channel_id: str | None = None


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
<<<<<<< HEAD
        audio_b64 = (body.audio_base64 or '').strip()

        if not prompt and not audio_b64:
            raise HTTPException(400, 'Forneça um texto ou áudio para o Gemini processar.')
=======
        if not prompt:
            raise HTTPException(400, 'Texto para análise não fornecido.')
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435

        key = os.getenv('GEMINI_API_KEY', DEFAULT_GEMINI_KEY).strip() or DEFAULT_GEMINI_KEY
        project = os.getenv('GEMINI_PROJECT', DEFAULT_GEMINI_PROJECT).strip() or DEFAULT_GEMINI_PROJECT

        system_instruction = (
            'Você é o LulaDroid, um assistente robô inteligente, carismático e prestativo '
            'em português brasileiro para as chamadas de voz e vídeo do aplicativo Órbita. '
<<<<<<< HEAD
            'Você realiza a transcrição precisa da fala e responde às dúvidas de forma amigável, direta e concisa '
            '(no máximo 2 ou 3 frases curtas), de modo que sua resposta soe excelente ao ser falada na chamada.'
=======
            'Responda à pergunta feita pelo usuário de forma amigável, direta e concisa '
            '(no máximo 2 ou 3 frases curtas), de modo que sua resposta soe excelente e natural '
            'ao ser reproduzida por sintetizador de voz (TTS) na chamada.'
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
        )

        req_headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
        }
        if project:
            req_headers['x-goog-user-project'] = project

<<<<<<< HEAD
        parts = []
        if audio_b64:
            clean_b64 = audio_b64.split(',')[-1]
            parts.append({
                'inlineData': {
                    'mimeType': body.mime_type or 'audio/webm',
                    'data': clean_b64
                }
            })
            inst = (
                'Transcreva com precisão o que foi falado no áudio em português brasileiro. '
                'Em seguida, verifique se a fala ativou o comando "eai LulaDroid" (ou "e aí LulaDroid"). '
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
            'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 400},
=======
        payload = {
            'system_instruction': {'parts': [{'text': system_instruction}]},
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 300},
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
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
<<<<<<< HEAD
                        c_parts = candidates[0].get('content', {}).get('parts') or []
                        if c_parts and isinstance(c_parts[0].get('text'), str) and c_parts[0]['text'].strip():
                            raw_out = c_parts[0]['text'].strip()
                            if audio_b64:
                                try:
                                    clean_json = raw_out.strip('`').replace('json\n', '', 1).strip()
                                    parsed = json.loads(clean_json)
                                    return {
                                        'success': True,
                                        'transcription': parsed.get('transcricao', ''),
                                        'triggered': bool(parsed.get('ativou')),
                                        'reply': parsed.get('resposta', ''),
                                        'model': model,
                                        'speaker': body.speaker or (user.get('user_metadata') or {}).get('display_name', 'Participante'),
                                    }
                                except Exception:
                                    return {
                                        'success': True,
                                        'transcription': raw_out,
                                        'triggered': 'eai luladroid' in raw_out.lower() or 'e aí luladroid' in raw_out.lower(),
                                        'reply': raw_out,
                                        'model': model,
                                    }
                            return {
                                'success': True,
                                'reply': raw_out,
=======
                        parts = candidates[0].get('content', {}).get('parts') or []
                        if parts and isinstance(parts[0].get('text'), str) and parts[0]['text'].strip():
                            return {
                                'success': True,
                                'reply': parts[0]['text'].strip(),
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
                                'model': model,
                                'speaker': body.speaker or (user.get('user_metadata') or {}).get('display_name', 'Participante'),
                            }
                else:
                    last_error = f'HTTP {response.status_code}'
            except Exception as exc:
                last_error = str(exc)

        fallback_reply = (
<<<<<<< HEAD
            f"Olá companheiro! LulaDroid na escuta com Gemini. "
            f"Ouvi sua mensagem: '{prompt or 'áudio recebido'}' e estou ativo na chamada!"
        )
        return {
            'success': True,
            'transcription': prompt or 'Áudio processado pelo Gemini',
            'triggered': False,
            'reply': fallback_reply,
            'model': 'fallback-gemini',
=======
            f"Olá companheiro! LulaDroid na escuta. Ouvi sua pergunta sobre '{prompt}'. "
            'Estou conectado na chamada e pronto para ajudar!'
        )
        return {
            'success': True,
            'reply': fallback_reply,
            'model': 'fallback-agent',
>>>>>>> b5a39d3b668be49dd09253e2141ca6f5c279f435
            'fallback': True,
            'error_detail': last_error,
        }
