import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi.testclient import TestClient
from livekit import api

import app
from test_app import ENV, CHANNEL, USER


class VoiceAccessTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict('os.environ', ENV)
        self.environment.start()
        app.app.dependency_overrides[app.current_user] = lambda: ({'id': USER}, {})
        self.client = TestClient(app.app)
        self.calls = []
        self.denied = False
        self.allowed = {USER: False}
        self.lk = SimpleNamespace(room=SimpleNamespace(
            list_participants=AsyncMock(return_value=api.ListParticipantsResponse(participants=[
                api.ParticipantInfo(identity=USER, permission=api.ParticipantPermission(can_publish=True, can_subscribe=True, can_publish_data=True)),
                api.ParticipantInfo(identity=CHANNEL, permission=api.ParticipantPermission(can_publish=True)),
            ])), remove_participant=AsyncMock(), update_participant=AsyncMock(), delete_room=AsyncMock()))
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=self.lk)
        context.__aexit__ = AsyncMock(return_value=False)
        self.factory = patch('community_features.api.LiveKitAPI', return_value=context)
        self.factory_mock = self.factory.start()

        async def request(_client, method, url, **kwargs):
            self.calls.append(kwargs['json'])
            if self.denied:
                return httpx.Response(403, json={'message': 'Sem permissão'})
            return httpx.Response(200, json={'kind': 'voice', 'participants': self.allowed})
        self.remote = patch.object(httpx.AsyncClient, 'request', request)
        self.remote.start()

    def tearDown(self):
        self.remote.stop()
        self.factory.stop()
        app.app.dependency_overrides.clear()
        self.environment.stop()

    def test_unauthorized_manager_never_reaches_livekit(self):
        self.denied = True
        self.assertEqual(self.client.post(f'/api/channels/{CHANNEL}/sync-voice').status_code, 403)
        self.factory_mock.assert_not_called()

    def test_revoked_access_kicks_and_audience_cannot_publish(self):
        response = self.client.post(f'/api/channels/{CHANNEL}/sync-voice')
        self.assertEqual(response.json(), {'ok': True, 'removed': 1, 'updated': 1})
        self.assertEqual(self.lk.room.remove_participant.call_args.args[0].identity, CHANNEL)
        permission = self.lk.room.update_participant.call_args.args[0].permission
        self.assertFalse(permission.can_publish)
        self.assertTrue(permission.can_subscribe)
        self.assertTrue(permission.can_publish_data)
        self.assertCountEqual(self.calls[1]['member_ids'], [USER, CHANNEL])

    def test_room_deletion_requires_its_own_database_permission(self):
        self.assertEqual(self.client.delete(f'/api/channels/{CHANNEL}/live-room').status_code, 200)
        self.assertEqual(self.calls[0]['action_name'], 'close')
        self.lk.room.delete_room.assert_awaited_once()
        self.lk.room.list_participants.assert_not_called()

    def test_invalid_database_snapshot_never_removes_everyone(self):
        self.allowed = []
        self.assertEqual(self.client.post(f'/api/channels/{CHANNEL}/sync-voice').status_code, 503)
        self.lk.room.remove_participant.assert_not_called()
        self.lk.room.update_participant.assert_not_called()
