import os
import unittest
from unittest.mock import patch

import httpx
import jwt
from fastapi.testclient import TestClient
import app as module

CHANNEL = '11111111-1111-4111-8111-111111111111'
USER = '22222222-2222-4222-8222-222222222222'
ENV = {'SUPABASE_URL':'https://example.supabase.co', 'SUPABASE_PUBLISHABLE_KEY':'public-test',
       'LIVEKIT_URL':'wss://example.livekit.cloud', 'LIVEKIT_API_KEY':'test-key',
       'LIVEKIT_API_SECRET':'secret-test-32-characters-long-1234'}


class AppTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, ENV)
        self.environment.start()
        self.client = TestClient(module.app)

    def tearDown(self):
        self.environment.stop()

    def mock_remote(self, *, user_status=200, kind='voice', exists=True):
        async def get(client, url, **kwargs):
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer user-token')
            if url.endswith('/auth/v1/user'):
                return httpx.Response(user_status, json={'id':USER,'user_metadata':{'display_name':'Teste'}})
            self.assertEqual(kwargs['params']['id'], 'eq.' + CHANNEL)
            return httpx.Response(200, json=[{'id':CHANNEL,'kind':kind}] if exists else [])
        return patch.object(httpx.AsyncClient, 'get', get)

    def join(self):
        return self.client.post(f'/api/channels/{CHANNEL}/join', headers={'Authorization':'Bearer user-token'})

    def test_configuration_never_exposes_livekit_secrets(self):
        result = self.client.get('/api/config')
        self.assertEqual(result.status_code, 200)
        self.assertNotIn(ENV['LIVEKIT_API_SECRET'], result.text)
        self.assertNotIn(ENV['LIVEKIT_API_KEY'], result.text)
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_healthcheck_is_public(self):
        result = self.client.get('/healthz')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {'status': 'ok'})

    def test_security_headers_are_present(self):
        result = self.client.get('/healthz')
        self.assertEqual(result.headers['x-frame-options'], 'DENY')
        self.assertIn('frame-ancestors', result.headers['content-security-policy-report-only'])
        self.assertNotIn(ENV['LIVEKIT_API_SECRET'], str(result.headers))

    def test_anonymous_cannot_join(self):
        self.assertEqual(self.client.post(f'/api/channels/{CHANNEL}/join').status_code, 401)

    def test_invalid_session_cannot_join(self):
        with self.mock_remote(user_status=401):
            self.assertEqual(self.join().status_code, 401)

    def test_hidden_channel_cannot_join(self):
        with self.mock_remote(exists=False):
            self.assertEqual(self.join().status_code, 404)

    def test_text_channel_cannot_join(self):
        with self.mock_remote(kind='text'):
            self.assertEqual(self.join().status_code, 400)

    def test_token_is_signed_and_limited_to_requested_room(self):
        with self.mock_remote():
            result = self.join()
        self.assertEqual(result.status_code, 200)
        token = jwt.decode(result.json()['token'], ENV['LIVEKIT_API_SECRET'], algorithms=['HS256'])
        self.assertEqual(token['sub'], USER)
        self.assertEqual(token['video']['room'], 'channel-' + CHANNEL)
        self.assertTrue(token['video']['roomJoin'])
        self.assertFalse(token['video'].get('roomAdmin', False))
        self.assertLessEqual(token['exp'] - token['nbf'], 600)

    def test_missing_livekit_is_actionable(self):
        with patch.dict(os.environ, {'LIVEKIT_API_SECRET':''}), self.mock_remote():
            self.assertEqual(self.join().status_code, 503)

    def test_home_and_static_assets_are_served(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/static/app.js').status_code, 200)
        self.assertEqual(self.client.get('/static/style.css').status_code, 200)
        self.assertEqual(self.client.get('/.env').status_code, 404)


if __name__ == '__main__':
    unittest.main()
