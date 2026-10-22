import os
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app
from test_integrations import ENV, USER, TARGET

class ModerationTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,ENV);self.env.start();self.client=TestClient(app.app)
    def tearDown(self):
        self.env.stop()
    def remote(self,allowed=False):
        async def request(_client,method,url,**kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200,json={'id':USER})
            if url.endswith('/rpc/moderate_member') or url.endswith('/rpc/voice_authorize'):
                return httpx.Response(200,json=True) if allowed else httpx.Response(403,json={'message':'Sem permissão.'})
            if url.endswith('/channels'):
                return httpx.Response(200,json=[])
            raise AssertionError('Unexpected outbound request: '+url)
        return patch.object(httpx.AsyncClient,'request',request)
    def test_unauthorized_moderation_never_reaches_livekit(self):
        with self.remote(),patch('community_features.api.LiveKitAPI') as lk:
            response=self.client.post(f'/api/communities/{TARGET}/moderate',json={'member':USER,'action':'ban'},headers={'Authorization':'Bearer test'})
        self.assertEqual(response.status_code,403);lk.assert_not_called()
    def test_unauthorized_voice_controls_never_reach_livekit(self):
        with self.remote(),patch('community_features.api.LiveKitAPI') as lk:
            response=self.client.post(f'/api/channels/{TARGET}/voice-action',json={'member':USER,'action':'mute'},headers={'Authorization':'Bearer test'})
        self.assertEqual(response.status_code,403);lk.assert_not_called()
    def test_vapid_and_transport_secrets_never_reach_the_client(self):
        with patch.dict(os.environ,{'VAPID_PRIVATE_KEY':'private-never-return','PUSH_TRANSPORT_KEY':'transport-never-return','VAPID_PUBLIC_KEY':'public-key'}):
            response=self.client.get('/api/config')
        self.assertNotIn('private-never-return',response.text)
        self.assertNotIn('transport-never-return',response.text)
        self.assertEqual(response.json()['pushPublicKey'],'public-key')
