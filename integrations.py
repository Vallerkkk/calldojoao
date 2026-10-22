from uuid import UUID
import httpx
from fastapi import Depends, HTTPException
from upstream import client_for, read_json
from videochamada import install_videochamada

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
            if not all(isinstance(convo.get(key), str) and convo[key] for key in ('user_a', 'user_b')):
                raise HTTPException(503, 'O serviço de dados retornou uma conversa inválida.')
            if user['id'] not in (convo['user_a'], convo['user_b']):
                raise HTTPException(404, 'Conversa sem acesso.')
            friends = await rows('friendships', headers, {'status': 'eq.accepted', 'or': f'(and(requester_id.eq.{convo["user_a"]},recipient_id.eq.{convo["user_b"]}),and(requester_id.eq.{convo["user_b"]},recipient_id.eq.{convo["user_a"]}))', 'select': 'id'})
            if not friends:
                raise HTTPException(403, 'Adicionem-se como amigos para continuar.')
            try:
                async with client_for(app) as client:
                    permission = await client.post(settings()['SUPABASE_URL']+'/rest/v1/rpc/can_call_conversation',headers=headers,json={'target':str(target_id)})
                if permission.status_code != 200:
                    raise HTTPException(503, 'Não foi possível verificar a privacidade da chamada.')
                if permission.json() is not True:
                    raise HTTPException(403, 'Esta chamada foi limitada pelas configurações de privacidade.')
            except (httpx.HTTPError, ValueError):
                raise HTTPException(503, 'Não foi possível verificar a privacidade da chamada.') from None
        return found[0]

    install_videochamada(app, current_user, scope)

    @app.post('/api/conversations/{conversation_id}/join')
    async def private_join(conversation_id: UUID, identity=Depends(current_user)):
        user, headers = identity
        await scope('direct', conversation_id, user, headers)
        return make_token(user, f'direct-{conversation_id}')

