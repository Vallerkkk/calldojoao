import json
import os
import unittest
import time
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from fastapi import FastAPI
import app
from diagnostics import configured, csv_report, parse_findings, install_diagnostics

UID = '11111111-1111-4111-8111-111111111111'


class DiagnosticsTests(unittest.TestCase):
    def tearDown(self):
        app.app.dependency_overrides.clear()

    def identify(self):
        async def identity():
            return {'id': UID, 'user_metadata': {'role': 'creator'}}, {'Authorization': 'Bearer fixture'}
        app.app.dependency_overrides[app.current_user] = identity

    def test_requires_login(self):
        client = TestClient(app.app)
        self.assertEqual(client.get('/api/admin/diagnostics.csv').status_code, 401)
        self.assertEqual(client.post('/api/diagnostics/events', json={'events': []}).status_code, 401)

    def test_rejects_free_text_and_invalid_categories(self):
        self.identify()
        client = TestClient(app.app)
        for item in [{'screen': 'voice', 'signal': 'view', 'count': 1, 'message': 'private'},
                     {'screen': '/@someone', 'signal': 'view', 'count': 1},
                     {'screen': 'voice', 'signal': 'view', 'count': True},
                     {'screen': 'voice', 'signal': 'view', 'count': 21}]:
            self.assertEqual(client.post('/api/diagnostics/events', json={'events': [item]}).status_code, 422)

    def test_user_metadata_never_grants_admin(self):
        self.identify()
        async def get(_client, url, **kw):
            self.assertIn('/site_roles', url)
            self.assertEqual(kw['params']['user_id'], 'eq.' + UID)
            return httpx.Response(200, json=[])
        with patch.object(httpx.AsyncClient, 'get', get):
            self.assertEqual(TestClient(app.app).get('/api/admin/diagnostics.csv').status_code, 403)

    def test_admin_csv_and_cache_protection(self):
        self.identify()
        async def get(_client, url, **kw):
            if '/site_roles' in url:
                return httpx.Response(200, json=[{'role': 'creator'}])
            if '/app_diagnostic_counts' in url:
                return httpx.Response(200, json=[{'day': '2026-10-22', 'screen': 'voice', 'signal': 'api_error', 'count': 3}])
            return httpx.Response(200, json=[])
        with patch.object(httpx.AsyncClient, 'get', get):
            response = TestClient(app.app).get('/api/admin/diagnostics.csv')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        self.assertIn('Regra técnica', response.content.decode())

    def test_model_is_off_without_explicit_free_confirmation(self):
        with patch.dict(os.environ, {'GEMINI_DIAGNOSTICS_ENABLED': 'true', 'GEMINI_FREE_TIER_CONFIRMED': 'false', 'GEMINI_API_KEY': 'fixture'}):
            self.assertFalse(configured())
        with patch.dict(os.environ, {'GEMINI_DIAGNOSTICS_ENABLED': 'false', 'GEMINI_FREE_TIER_CONFIRMED': 'true', 'GEMINI_API_KEY': 'fixture'}):
            self.assertFalse(configured())

    def test_collection_persists_and_never_calls_disabled_gemini(self):
        self.identify()
        seen = []
        async def post(_client, url, **kw):
            seen.append((url, kw.get('json')))
            self.assertIn('/rpc/record_app_diagnostics', url)
            return httpx.Response(200, json=True)
        events = [{'screen': 'voice', 'signal': 'api_error', 'count': 3}]
        with patch.dict(os.environ, {'GEMINI_DIAGNOSTICS_ENABLED': 'false'}), patch.object(httpx.AsyncClient, 'post', post):
            response = TestClient(app.app).post('/api/diagnostics/events', json={'events': events})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][1], {'events': events})

    def test_model_output_is_only_advice_for_observed_signals(self):
        items = [{'screen': 'voice', 'signal': 'api_error', 'priority': 'alta', 'suggestion': '=EXEC("evil")'},
                 {'screen': 'friends', 'signal': 'api_error', 'priority': 'alta', 'suggestion': 'Invented bug'},
                 {'screen': 'voice', 'signal': 'view', 'priority': 'alta', 'suggestion': 'Invented bug'}]
        payload = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(items)}]}}]}
        result = parse_findings(payload, {('voice', 'api_error'): 3, ('voice', 'view'): 4})
        self.assertEqual(list(result), [('voice', 'api_error')])
        report = csv_report([{'screen': 'voice', 'signal': 'api_error', 'count': 3}], result).decode()
        self.assertIn("'=EXEC", report)
        payload['candidates'][0]['finishReason'] = 'MAX_TOKENS'
        self.assertEqual(parse_findings(payload, {('voice', 'api_error'): 3}), {})

    def test_enabled_model_gets_only_categories_and_respects_reservation(self):
        for budget in (False, True):
            site = FastAPI()
            async def identity():
                return {'id': UID}, {'Authorization': 'Bearer user-fixture'}
            install_diagnostics(site, identity, lambda: {'SUPABASE_URL': 'https://database.invalid'})
            requests = []
            async def post(_client, url, **kw):
                requests.append((url, kw))
                if 'record_app_diagnostics' in url:
                    return httpx.Response(200, json=True)
                if 'reserve_diagnostic_analysis' in url:
                    return httpx.Response(200, json=budget)
                self.assertIn('generativelanguage.googleapis.com', url)
                self.assertNotIn('key=', url)
                self.assertEqual(kw['headers'], {'x-goog-api-key': 'fixture-model-key'})
                body = kw['json']
                self.assertEqual(body['generationConfig']['maxOutputTokens'], 1400)
                self.assertNotIn('tools', body)
                self.assertNotIn(UID, json.dumps(body))
                summary = json.loads(body['contents'][0]['parts'][0]['text'])
                self.assertEqual(summary, [{'screen': 'voice', 'signal': 'api_error', 'count': 3}])
                return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '[]'}]}}]})
            env = {'GEMINI_DIAGNOSTICS_ENABLED': 'true', 'GEMINI_FREE_TIER_CONFIRMED': 'true', 'GEMINI_API_KEY': 'fixture-model-key'}
            with patch.dict(os.environ, env), patch.object(httpx.AsyncClient, 'post', post):
                with TestClient(site) as client:
                    result = client.post('/api/diagnostics/events', json={'events': [{'screen': 'voice', 'signal': 'api_error', 'count': 3}]})
                    self.assertEqual(result.status_code, 202)
                    for _ in range(100):
                        task = getattr(site.state, 'diagnostic_task', None)
                        if task and task.done():
                            task.result()
                            break
                        time.sleep(.01)
                    self.assertTrue(task.done())
                    client.post('/api/diagnostics/events', json={'events': [{'screen': 'voice', 'signal': 'api_error', 'count': 3}]})
            self.assertEqual(sum('generativelanguage' in url for url, _ in requests), int(budget))
            self.assertEqual(sum('reserve_diagnostic_analysis' in url for url, _ in requests), 1)
