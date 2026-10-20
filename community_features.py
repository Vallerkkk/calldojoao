"""Authenticated moderation and Web Push delivery; no background paid service."""
import asyncio
import base64
import json
import os
import time
from collections import defaultdict, deque
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from livekit import api
from pydantic import BaseModel, Field
from upstream import client_for, read_json


PUSH_HOSTS = ('fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com')


def valid_push_endpoint(endpoint):
    try:
        parsed = urlparse(endpoint)
        host = (parsed.hostname or '').lower()
        return (parsed.scheme == 'https' and not parsed.username and not parsed.password
                and parsed.port in (None, 443) and len(endpoint) < 2000
                and any(host == suffix or host.endswith('.' + suffix) for suffix in PUSH_HOSTS))
    except ValueError:
        return False


class PushRegistration(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: dict[str, str] = Field(max_length=2)


class MemberAction(BaseModel):
    member: UUID
    action: Literal['timeout', 'untimeout', 'ban', 'unban']
    reason: str = Field(default='', max_length=500)
    minutes: int = Field(default=10, ge=1, le=40320)


class VoiceAction(BaseModel):
    member: UUID
    action: Literal['mute', 'speaker', 'audience', 'kick']


def install_features(app, current_user, settings):
    dispatch_times = defaultdict(deque)
    dispatch_gate = asyncio.Lock()

    async def rest(path, headers, *, method='POST', body=None, params=None):
        try:
            async with client_for(app) as client:
                result = await client.request(method, settings()['SUPABASE_URL'] + '/rest/v1/' + path,
                                              headers=headers, json=body, params=params)
        except httpx.HTTPError:
            raise HTTPException(503, 'O serviço de dados está indisponível. Tente novamente.')
        if result.is_error:
            message = 'Sem permissão para esta ação.'
            try:
                details = result.json()
                if isinstance(details, dict) and isinstance(details.get('message'), str):
                    message = details['message'][:250]
            except (ValueError, TypeError):
                pass
            raise HTTPException(403 if result.status_code in (400, 401, 403) else 503, message)
        return read_json(result, (dict, list, bool, str, int, float, type(None))) if result.content else None

    def livekit():
        config = settings()
        if not all(config[key] for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
            raise HTTPException(503, 'As chamadas não estão configuradas.')
        return api.LiveKitAPI(config['LIVEKIT_URL'], config['LIVEKIT_API_KEY'], config['LIVEKIT_API_SECRET'])

    @app.post('/api/push/subscribe')
    async def subscribe(body: PushRegistration, identity=Depends(current_user)):
        user, headers = identity
        if not valid_push_endpoint(body.endpoint):
            raise HTTPException(400, 'Serviço de push inválido.')
        for name in ('p256dh', 'auth'):
            value = body.keys.get(name, '')
            try:
                if len(value) > 150:
                    raise ValueError()
                decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
                if (name == 'p256dh' and len(decoded) != 65) or (name == 'auth' and len(decoded) != 16):
                    raise ValueError()
            except (ValueError, TypeError):
                raise HTTPException(400, 'Chave de push inválida.')
        # Own-device replacement is explicit; the endpoint UNIQUE constraint prevents cross-account takeover.
        await rest('push_subscriptions', headers, method='DELETE', params={'user_id': f'eq.{user["id"]}', 'endpoint': f'eq.{body.endpoint}'})
        await rest('push_subscriptions', headers, body={'user_id': user['id'], 'endpoint': body.endpoint,
                   'p256dh': body.keys['p256dh'], 'auth': body.keys['auth']})
        return {'ok': True}

    @app.delete('/api/push/subscribe')
    async def unsubscribe(body: PushRegistration, identity=Depends(current_user)):
        user, headers = identity
        await rest('push_subscriptions', headers, method='DELETE', params={'user_id': f'eq.{user["id"]}', 'endpoint': f'eq.{body.endpoint}'})
        return {'ok': True}

    @app.post('/api/notifications/dispatch')
    async def dispatch(identity=Depends(current_user)):
        user, headers = identity
        secret, private = os.getenv('PUSH_TRANSPORT_KEY', ''), os.getenv('VAPID_PRIVATE_KEY', '')
        if not secret or not private:
            return {'enabled': False, 'sent': 0}
        queue = dispatch_times[user['id']]
        while queue and queue[0] < time.monotonic() - 20:
            queue.popleft()
        if len(queue) >= 4:
            return {'enabled': True, 'sent': 0, 'retry': True}
        queue.append(time.monotonic())
        if len(dispatch_times) > 2000:
            for key in list(dispatch_times):
                if not dispatch_times[key] or dispatch_times[key][-1] < time.monotonic() - 60:
                    dispatch_times.pop(key, None)
        if dispatch_gate.locked():
            return {'enabled': True, 'sent': 0, 'retry': True}
        async with dispatch_gate:
            jobs = await rest('rpc/push_take', headers, body={'transport_key': secret})
            from pywebpush import webpush, WebPushException
            sent, results = 0, {}
            semaphore = asyncio.Semaphore(10)

            async def deliver(job):
                nonlocal sent
                success, expired = True, None
                try:
                    if not valid_push_endpoint(job['endpoint']):
                        expired = job['subscription_id']
                        return
                    async with semaphore:
                        await asyncio.to_thread(webpush,
                            subscription_info={'endpoint': job['endpoint'], 'keys': {'p256dh': job['p256dh'], 'auth': job['auth']}},
                            data=json.dumps(job['payload']), vapid_private_key=private,
                            vapid_claims={'sub': os.getenv('VAPID_SUBJECT', 'https://orbita-8nwu.onrender.com')}, ttl=300, timeout=5)
                    sent += 1
                except WebPushException as error:
                    status = error.response.status_code if error.response is not None else 0
                    if status in (404, 410):
                        expired = job['subscription_id']
                    else:
                        success = False
                except Exception:
                    success = False
                finally:
                    results[job['job_id']] = results.get(job['job_id'], True) and success
                    if expired:
                        await rest('rpc/push_finish', headers, body={'transport_key': secret, 'job': job['job_id'], 'expired': expired, 'success': False})

            await asyncio.gather(*(deliver(job) for job in jobs))
            for job, success in results.items():
                await rest('rpc/push_finish', headers, body={'transport_key': secret, 'job': job, 'success': success})
            return {'enabled': True, 'sent': sent, 'retry': len(results) >= 5 or any(not done for done in results.values())}

    @app.post('/api/communities/{community_id}/moderate')
    async def moderate(community_id: UUID, body: MemberAction, identity=Depends(current_user)):
        _user, headers = identity
        await rest('rpc/moderate_member', headers, body={'community': str(community_id), 'member': str(body.member),
                   'action_name': body.action, 'reason_text': body.reason, 'duration_minutes': body.minutes})
        warning = None
        if body.action in ('timeout', 'ban'):
            try:
                channels = await rest('channels', headers, method='GET', params={'community_id': f'eq.{community_id}', 'kind': 'eq.voice', 'select': 'id'})
                async with livekit() as lk:
                    for channel in channels:
                        room = 'channel-' + channel['id']
                        try:
                            if body.action == 'ban':
                                await lk.room.remove_participant(api.RoomParticipantIdentity(room=room, identity=str(body.member)))
                            else:
                                await lk.room.update_participant(api.UpdateParticipantRequest(room=room, identity=str(body.member), permission=api.ParticipantPermission(can_subscribe=True, can_publish=False, can_publish_data=True)))
                        except api.TwirpError as error:
                            if error.code != 'not_found':
                                warning = 'A moderação foi salva. A sincronização da chamada precisa ser tentada novamente.'
            except HTTPException as error:
                if error.status_code != 503 or 'configuradas' not in str(error.detail):
                    warning = 'A moderação foi salva. A chamada não pôde ser sincronizada agora.'
            except Exception:
                warning = 'A moderação foi salva. A chamada não pôde ser atualizada agora.'
        return {'ok': True, 'warning': warning}

    @app.post('/api/channels/{channel_id}/voice-action')
    async def voice_action(channel_id: UUID, body: VoiceAction, identity=Depends(current_user)):
        _user, headers = identity
        await rest('rpc/voice_authorize', headers, body={'target': str(channel_id), 'member': str(body.member), 'action_name': body.action})
        try:
            async with livekit() as lk:
                room = 'channel-' + str(channel_id)
                if body.action == 'kick':
                    await lk.room.remove_participant(api.RoomParticipantIdentity(room=room, identity=str(body.member)))
                elif body.action in ('speaker', 'audience'):
                    await lk.room.update_participant(api.UpdateParticipantRequest(room=room, identity=str(body.member), permission=api.ParticipantPermission(can_subscribe=True, can_publish=body.action=='speaker', can_publish_data=True)))
                else:
                    participant = await lk.room.get_participant(api.RoomParticipantIdentity(room=room, identity=str(body.member)))
                    for track in participant.tracks:
                        if track.type == api.TrackType.AUDIO:
                            await lk.room.mute_published_track(api.MuteRoomTrackRequest(room=room, identity=str(body.member), track_sid=track.sid, muted=True))
        except Exception:
            raise HTTPException(503, 'Não foi possível atualizar este participante na chamada. Tente novamente.')
        return {'ok': True}

    async def reconcile_voice(channel_id, headers, *, close=False):
        body = {'target': str(channel_id), 'action_name': 'close' if close else 'sync'}
        snapshot = await rest('rpc/voice_access_snapshot', headers, body=body)
        if not isinstance(snapshot, dict) or snapshot.get('kind') not in ('voice', 'text'):
            raise HTTPException(503, 'Não foi possível verificar as permissões da chamada.')
        if snapshot['kind'] != 'voice':
            return {'ok': True, 'removed': 0, 'updated': 0}
        try:
            async with livekit() as lk:
                room = 'channel-' + str(channel_id)
                if close:
                    await lk.room.delete_room(api.DeleteRoomRequest(room=room))
                    return {'ok': True}
                response = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
                identities = []
                for participant in response.participants:
                    try:
                        identities.append(str(UUID(participant.identity)))
                    except ValueError:
                        pass
                snapshot = await rest('rpc/voice_access_snapshot', headers, body={**body, 'member_ids': identities})
                allowed = snapshot.get('participants') if isinstance(snapshot, dict) else None
                if not isinstance(allowed, dict) or any(type(value) is not bool for value in allowed.values()):
                    raise HTTPException(503, 'Não foi possível verificar os participantes.')
                removed, updated = 0, 0
                for participant in response.participants:
                    if participant.identity not in allowed:
                        await lk.room.remove_participant(api.RoomParticipantIdentity(room=room, identity=participant.identity))
                        removed += 1
                    elif participant.permission.can_publish != allowed[participant.identity]:
                        permission = api.ParticipantPermission()
                        permission.CopyFrom(participant.permission)
                        permission.can_publish = allowed[participant.identity]
                        await lk.room.update_participant(api.UpdateParticipantRequest(room=room, identity=participant.identity, permission=permission))
                        updated += 1
                return {'ok': True, 'removed': removed, 'updated': updated}
        except api.TwirpError as error:
            if error.code == 'not_found':
                return {'ok': True, 'removed': 0, 'updated': 0}
            raise HTTPException(503, 'Não foi possível sincronizar a chamada. Tente novamente.')
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, 'Não foi possível sincronizar a chamada. Tente novamente.')

    @app.post('/api/channels/{channel_id}/sync-voice')
    async def sync_voice(channel_id: UUID, identity=Depends(current_user)):
        return await reconcile_voice(channel_id, identity[1])

    @app.delete('/api/channels/{channel_id}/live-room')
    async def close_voice(channel_id: UUID, identity=Depends(current_user)):
        return await reconcile_voice(channel_id, identity[1], close=True)

