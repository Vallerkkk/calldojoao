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
    keys: dict[str, str]


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

    async def rest(path, headers, *, method='POST', body=None, params=None):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                result = await client.request(method, settings()['SUPABASE_URL'] + '/rest/v1/' + path,
                                              headers=headers, json=body, params=params)
        except httpx.HTTPError:
            raise HTTPException(503, 'O serviço de dados está indisponível. Tente novamente.')
        if result.is_error:
            message = 'Sem permissão para esta ação.'
            try:
                message = result.json().get('message', message)[:250]
            except ValueError:
                pass
            raise HTTPException(403 if result.status_code in (400, 401, 403) else 503, message)
        return result.json() if result.content else None

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
        jobs = await rest('rpc/push_take', headers, body={'transport_key': secret})
        from pywebpush import webpush, WebPushException
        sent, results = 0, {}
        semaphore = asyncio.Semaphore(5)

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
                        vapid_claims={'sub': os.getenv('VAPID_SUBJECT', 'https://orbita-8nwu.onrender.com')}, ttl=300, timeout=8)
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
        return {'enabled': True, 'sent': sent}

    @app.post('/api/communities/{community_id}/moderate')
    async def moderate(community_id: UUID, body: MemberAction, identity=Depends(current_user)):
        _user, headers = identity
        await rest('rpc/moderate_member', headers, body={'community': str(community_id), 'member': str(body.member),
                   'action_name': body.action, 'reason_text': body.reason, 'duration_minutes': body.minutes})
        warning = None
        if body.action in ('timeout', 'ban'):
            channels = await rest('channels', headers, method='GET', params={'community_id': f'eq.{community_id}', 'kind': 'eq.voice', 'select': 'id'})
            try:
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
            except HTTPException:
                pass
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

