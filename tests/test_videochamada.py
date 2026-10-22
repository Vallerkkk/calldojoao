import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app as orbita
from videochamada import install_videochamada, valid_call_url

USER = '22222222-2222-4222-8222-222222222222'
CONVERSATION = '11111111-1111-4111-8111-111111111111'
URL = 'https://orbita.videochamada.com.br/chamada/abcd'


class VideochamadaTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'VIDEOCHAMADA_API_KEY': 'private-test-key',
            'VIDEOCHAMADA_FREE_PLAN_CONFIRMED': 'true'})
        self.env.start()
        self.allowed = True
        self.checked_scope = []
        application = FastAPI()

        async def current_user():
            return {'id': USER}, {'Authorization': 'Bearer supabase-session'}

        async def scope(kind, target, user, headers):
            self.checked_scope.append((kind, str(target), user['id']))
            if not self.allowed:
                raise HTTPException(403, 'Sem amizade ou acesso.')

        install_videochamada(application, current_user, scope)
        self.client = TestClient(application)
        self.path = f'/api/conversations/{CONVERSATION}/videochamada'
        self.body = {'request_id': str(uuid4()), 'expires_at':
            (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat()}

    def tearDown(self):
        self.client.close()
        self.env.stop()

    def provider(self, status=201, data=None, error=False):
        owner = self
        async def post(_client, url, **kwargs):
            owner.requests.append((url, kwargs))
            if error:
                raise httpx.ReadTimeout('sensitive upstream details')
            return httpx.Response(status, json=data if data is not None else {'url': URL, 'recording': False})
        self.requests = []
        return patch.object(httpx.AsyncClient, 'post', post)

    def test_private_scope_and_server_secret_with_recording_disabled(self):
        with self.provider():
            response = self.client.post(self.path, json=self.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.checked_scope, [('direct', CONVERSATION, USER)])
        url, request = self.requests[0]
        self.assertEqual(url, 'https://api.videochamada.com.br/api/calls')
        self.assertEqual(request['headers']['Authorization'], 'Bearer private-test-key')
        self.assertFalse(request['json']['recording'])
        self.assertNotIn('supabase-session', str(request))
        self.assertNotIn('private-test-key', response.text)
        self.assertEqual(response.json()['url'], URL)

    def test_retry_reuses_provider_operation_without_leaking_user_id(self):
        with self.provider():
            for _ in range(2):
                self.assertEqual(self.client.post(self.path, json=self.body).status_code, 200)
        self.assertEqual(self.requests[0][1], self.requests[1][1])
        self.assertNotIn(USER, self.requests[0][1]['headers']['Idempotency-Key'])

    def test_no_provider_request_without_access(self):
        self.allowed = False
        with self.provider():
            self.assertEqual(self.client.post(self.path, json=self.body).status_code, 403)
        self.assertEqual(self.requests, [])

    def test_explicit_free_plan_gate(self):
        with patch.dict(os.environ, {'VIDEOCHAMADA_FREE_PLAN_CONFIRMED': 'false'}), self.provider():
            self.assertEqual(self.client.post(self.path, json=self.body).status_code, 503)
        self.assertEqual(self.requests, [])

    def test_reject_expired_unbounded_naive_dates_and_unknown_options(self):
        for expiry in [datetime.now(timezone.utc) - timedelta(seconds=2),
                       datetime.now(timezone.utc) + timedelta(hours=2), datetime.now()]:
            with self.provider():
                self.assertEqual(self.client.post(self.path, json={**self.body, 'expires_at': expiry.isoformat()}).status_code, 400)
            self.assertEqual(self.requests, [])
        self.assertEqual(self.client.post(self.path, json={**self.body, 'recording': True}).status_code, 422)

    def test_rate_limit_repeated_create_requests(self):
        with self.provider():
            for _ in range(6):
                self.assertEqual(self.client.post(self.path, json=self.body).status_code, 200)
            self.assertEqual(self.client.post(self.path, json=self.body).status_code, 429)
        self.assertEqual(len(self.requests), 6)

    def test_reject_unverified_recording_and_unsafe_urls(self):
        for data in [{'url': URL}, {'url': URL, 'recording': True},
                     {'url': 'https://attacker.example/chamada/abcd', 'recording': False}]:
            with self.provider(data=data):
                self.assertEqual(self.client.post(self.path, json=self.body).status_code, 503)

    def test_sanitize_errors_and_preserve_fallback(self):
        for status in [401, 403, 409, 429, 500]:
            with self.provider(status=status, data={'message': 'private-test-key'}):
                response = self.client.post(self.path, json=self.body)
            self.assertEqual(response.status_code, 409 if status == 409 else 503)
            self.assertNotIn('private-test-key', response.text)
        with self.provider(error=True):
            response = self.client.post(self.path, json=self.body)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('sensitive upstream', response.text)

    def test_configuration_does_not_expose_credentials_and_requires_auth(self):
        with TestClient(orbita.app) as client:
            response = client.get('/api/config')
            self.assertTrue(response.json()['videochamadaConfigured'])
            self.assertNotIn('private-test-key', response.text)
            self.assertEqual(client.post(self.path, json=self.body).status_code, 401)

    def test_url_allowlist(self):
        self.assertTrue(valid_call_url(URL))
        for value in ['http://orbita.videochamada.com.br/chamada/a',
            'https://orbita.videochamada.com.br.attacker.example/chamada/a',
            'https://user@orbita.videochamada.com.br/chamada/a',
            'https://orbita.videochamada.com.br:444/chamada/a',
            'https://orbita.videochamada.com.br/chamada/a?secret=x',
            'https://orbita.videochamada.com.br/other/a', None]:
            self.assertFalse(valid_call_url(value))
