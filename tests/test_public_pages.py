import os, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app

class PublicPagesTests(unittest.TestCase):
    def setUp(self):
        self.environment=patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_PUBLISHABLE_KEY':'public-only'})
        self.environment.start();self.client=TestClient(app.app)
    def tearDown(self):self.environment.stop()
    def test_public_profile_escapes_markup_and_does_not_forward_credentials(self):
        async def post(_client,url,**kwargs):
            self.assertTrue(url.endswith('/rpc/public_profile'))
            self.assertEqual(kwargs['headers'],{'apikey':'public-only'})
            return httpx.Response(200,json={'id':'11111111-1111-4111-8111-111111111111','display_name':'<script>bad()</script>','bio':'" onload="bad','posts':[]})
        with patch.object(httpx.AsyncClient,'post',post):response=self.client.get('/@someone')
        self.assertEqual(response.status_code,200);self.assertNotIn('<script>',response.text)
        self.assertIn('&lt;script&gt;',response.text);self.assertIn('og:title',response.text)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
    def test_private_post_does_not_leak_a_title_or_body(self):
        async def post(*args,**kwargs):return httpx.Response(200,json=None)
        with patch.object(httpx.AsyncClient,'post',post):response=self.client.get('/p/11111111-1111-4111-8111-111111111111')
        self.assertEqual(response.status_code,404);self.assertIn('verificar se você tem acesso',response.text)
    def test_invalid_handle_never_queries_supabase(self):
        async def post(*args,**kwargs):raise AssertionError('Invalid handles must not reach Supabase')
        with patch.object(httpx.AsyncClient,'post',post):self.assertEqual(self.client.get('/@invalid!!!').status_code,404)
