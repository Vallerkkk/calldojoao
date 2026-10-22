"""Optional private-call invitations; credentials never leave the server."""
import hashlib
import hmac
import os
import time
from collections import OrderedDict
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from upstream import client_for, read_json

API_ORIGIN = 'https://api.videochamada.com.br'


def configured():
    return (os.getenv('VIDEOCHAMADA_FREE_PLAN_CONFIRMED', '').strip().lower() == 'true'
            and bool(os.getenv('VIDEOCHAMADA_API_KEY', '').strip()))


class PrivateCallRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    expires_at: datetime


def valid_call_url(value):
    if not isinstance(value, str) or len(value) > 1500 or any(ord(char) < 32 for char in value):
        return False
    try:
        url = urlsplit(value)
        host = (url.hostname or '').lower()
        return (url.scheme == 'https' and not url.username and not url.password
                and url.port in (None, 443) and not url.query and not url.fragment
                and (host == 'videochamada.com.br' or host.endswith('.videochamada.com.br'))
                and url.path.startswith(('/chamada/', '/calls/'))
                and len(url.path.rsplit('/', 1)[-1]) > 0)
    except ValueError:
        return False


def install_videochamada(app, current_user, scope):
    # Small process-local abuse guard; provider idempotency also survives restarts.
    admissions = OrderedDict()

    def admit(user_id):
        now = time.monotonic()
        while admissions and next(iter(admissions.values()))[-1] < now - 60:
            admissions.popitem(last=False)
        recent = [stamp for stamp in admissions.pop(user_id, []) if stamp > now - 60]
        if len(recent) >= 6:
            admissions[user_id] = recent
            raise HTTPException(429, 'Aguarde um minuto antes de criar outro convite.')
        recent.append(now)
        admissions[user_id] = recent
        while len(admissions) > 2000:
            admissions.popitem(last=False)

    @app.post('/api/conversations/{conversation_id}/videochamada')
    async def create_private_call(conversation_id: UUID, body: PrivateCallRequest,
                                  identity=Depends(current_user)):
        if not configured():
            raise HTTPException(503, 'A chamada alternativa não está disponível. Use a chamada integrada.')
        user, headers = identity
        # Explicit membership AND accepted friendship, in addition to Supabase RLS.
        await scope('direct', conversation_id, user, headers)
        if body.expires_at.tzinfo is None:
            raise HTTPException(400, 'Informe um prazo com fuso horário.')
        expires = body.expires_at.astimezone(timezone.utc).replace(microsecond=0)
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
        if not 0 < remaining <= 65 * 60:
            raise HTTPException(400, 'O convite deve expirar em até uma hora. Crie um novo convite.')
        admit(user['id'])
        key = os.environ['VIDEOCHAMADA_API_KEY'].strip()
        operation = f"orbita-private:{user['id']}:{conversation_id}:{body.request_id}"
        idempotency = hmac.new(key.encode(), operation.encode(), hashlib.sha256).hexdigest()
        try:
            async with client_for(app) as client:
                response = await client.post(API_ORIGIN + '/api/calls',
                    headers={'Authorization': 'Bearer ' + key, 'Idempotency-Key': idempotency},
                    json={'recording': False, 'expiresAt': expires.isoformat()})
        except httpx.HTTPError:
            raise HTTPException(503, 'A chamada não respondeu. Tente novamente para recuperar o mesmo convite.') from None
        if response.status_code == 403:
            raise HTTPException(503, 'A franquia ou o acesso da Videochamada está indisponível. Use a chamada integrada.')
        if response.status_code == 409:
            raise HTTPException(409, 'Este convite já foi solicitado com outro prazo. Reabra a opção de chamada.')
        if response.status_code not in (200, 201):
            raise HTTPException(503, 'A Videochamada está indisponível. Use a chamada integrada.')
        result = read_json(response, dict)
        if not valid_call_url(result.get('url')) or result.get('recording') is not False:
            raise HTTPException(503, 'Não foi possível confirmar uma chamada sem gravação. Use a chamada integrada.')
        return {'url': result['url'], 'expiresAt': expires.isoformat(),
                'provider': 'videochamada', 'maxParticipants': 4}
