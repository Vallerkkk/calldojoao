import unittest
import gzip
import json
from pathlib import Path
from unittest.mock import patch

import httpx
import jwt
from fastapi.testclient import TestClient

import app
from test_app import CHANNEL, USER, ENV


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict('os.environ', ENV)
        self.environment.start()
        self.client = TestClient(app.app)

    def tearDown(self):
        self.environment.stop()

    def join(self):
        return self.client.post('/api/channels/' + CHANNEL + '/join', headers={'Authorization': 'Bearer test'})

    def upstream(self, rights=None, auth_status=200, bad_channels=False):
        async def get(_client, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(auth_status, json={'id': USER})
            return httpx.Response(200, json={} if bad_channels else [{'id': CHANNEL, 'kind': 'voice'}])

        async def post(_client, url, **kwargs):
            return httpx.Response(200, json=rights)

        return patch.object(httpx.AsyncClient, 'get', get), patch.object(httpx.AsyncClient, 'post', post)

    def test_auth_outage_does_not_look_like_an_expired_password(self):
        get, post = self.upstream(auth_status=503)
        with get, post:
            self.assertEqual(self.join().status_code, 503)

    def test_network_timeout_is_a_recoverable_error(self):
        async def fail(*args, **kwargs):
            raise httpx.ReadTimeout('upstream unavailable')
        with patch.object(httpx.AsyncClient, 'get', fail):
            response = self.join()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('Traceback', response.text)

    def test_invalid_rights_never_issue_a_voice_token(self):
        for rights in ({}, [], {'can_publish': 'false', 'stage': False, 'moderator': False}):
            with self.subTest(rights=rights):
                get, post = self.upstream(rights=rights)
                with get, post:
                    response = self.join()
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('token', response.json())

    def test_invalid_channel_response_is_not_a_server_crash(self):
        get, post = self.upstream(bad_channels=True)
        with get, post:
            self.assertEqual(self.join().status_code, 503)

    def test_non_json_permissions_are_handled(self):
        get, _post = self.upstream()
        async def post(*args, **kwargs):
            return httpx.Response(200, content=b'<html>unavailable</html>')
        with get, patch.object(httpx.AsyncClient, 'post', post):
            self.assertEqual(self.join().status_code, 503)

    def test_private_call_network_failure_does_not_crash(self):
        async def get(_client, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER})
            raise httpx.ConnectError('unavailable')
        with patch.object(httpx.AsyncClient, 'get', get):
            result = self.client.post('/api/conversations/' + CHANNEL + '/join', headers={'Authorization': 'Bearer test'})
        self.assertEqual(result.status_code, 503)

    def test_connection_pool_is_reused_and_closed(self):
        clients, authorization = [], []
        async def get(client, url, **kwargs):
            clients.append(id(client))
            authorization.append(kwargs['headers']['Authorization'])
            return httpx.Response(200, json={'id': USER} if url.endswith('/auth/v1/user') else [{'id': CHANNEL, 'kind': 'voice'}])
        async def post(client, url, **kwargs):
            clients.append(id(client))
            authorization.append(kwargs['headers']['Authorization'])
            return httpx.Response(200, json={'can_publish': True, 'stage': False, 'moderator': False})
        with patch.object(httpx.AsyncClient, 'get', get), patch.object(httpx.AsyncClient, 'post', post), TestClient(app.app) as client:
            for token in ['first-user-token', 'second-user-token']:
                response = client.post('/api/channels/' + CHANNEL + '/join', headers={'Authorization': 'Bearer ' + token})
                self.assertEqual(response.status_code, 200)
        self.assertEqual(len(set(clients)), 1)
        self.assertEqual(authorization, ['Bearer first-user-token'] * 3 + ['Bearer second-user-token'] * 3)
        self.assertIsNone(app.app.state.upstream)

    def test_scripts_are_compressed_for_the_network(self):
        with self.client.stream('GET', '/static/app.js', headers={'Accept-Encoding': 'gzip'}) as response:
            self.assertEqual(response.headers['content-encoding'], 'gzip')
            self.assertIn('Accept-Encoding', response.headers['vary'])
            encoded = b''.join(response.iter_raw())
        original = (Path(app.ROOT) / 'static/app.js').read_bytes()
        self.assertEqual(gzip.decompress(encoded), original)
        self.assertLess(len(encoded), len(original))

    def test_browser_cannot_frame_the_login_page(self):
        response = self.client.get('/')
        self.assertEqual(response.headers['x-frame-options'], 'DENY')
        self.assertIn("frame-ancestors 'none'", response.headers['content-security-policy'])

    def test_invalid_optional_profile_metadata_cannot_break_call_tokens(self):
        for metadata in (None, [], 'invalid', {'display_name': []}, {'display_name': '  '}):
            with self.subTest(metadata=metadata):
                token = app.make_token({'id': USER, 'user_metadata': metadata}, 'channel-' + CHANNEL)
                payload = json.loads(token.body)
                decoded = jwt.decode(payload['token'], ENV['LIVEKIT_API_SECRET'], algorithms=['HS256'])
                self.assertEqual(decoded['name'], 'Participante')
                self.assertEqual(decoded['sub'], USER)

    def test_malformed_private_conversation_is_recoverable_and_never_issues_token(self):
        async def get(_client, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER})
            return httpx.Response(200, json=[{'id': CHANNEL, 'user_a': USER}])
        with patch.object(httpx.AsyncClient, 'get', get):
            result = self.client.post('/api/conversations/' + CHANNEL + '/join', headers={'Authorization': 'Bearer test'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('token', result.json())
