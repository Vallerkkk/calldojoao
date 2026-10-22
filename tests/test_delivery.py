import json,re,unittest
from pathlib import Path
from fastapi.testclient import TestClient
import app

class DeliveryTests(unittest.TestCase):
    def setUp(self):self.client=TestClient(app.app)
    def test_hashed_assets_are_immutable_and_api_is_not(self):
        manifest=json.loads((app.ROOT/'static/dist/manifest.json').read_text(encoding='utf-8'))
        response=self.client.get(manifest['entry']);self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['Cache-Control'],'public, max-age=31536000, immutable')
        cached=self.client.get(manifest['entry'],headers={'If-None-Match':response.headers['etag']})
        self.assertEqual(cached.status_code,304);self.assertIn('immutable',cached.headers['Cache-Control'])
        for path in ['/','/sw.js','/api/version','/api/config']:
            self.assertEqual(self.client.get(path).headers['Cache-Control'],'no-store')
        self.assertNotIn('immutable',self.client.get('/static/app.js').headers['Cache-Control'])
        self.assertNotIn('immutable',self.client.get('/static/dist/missing-ABCDEFGH.js').headers['Cache-Control'])
    def test_version_and_html_match(self):
        version=self.client.get('/api/version').json()['version']
        self.assertRegex(version,r'^[a-f0-9]{16}$');self.assertIn('content="'+version+'"',self.client.get('/').text)
    def test_share_manifest_and_fallback(self):
        manifest=self.client.get('/static/manifest.webmanifest').json()
        self.assertEqual(manifest['share_target']['method'],'POST');self.assertEqual(len(manifest['screenshots']),2)
        response=self.client.post('/share-target');self.assertEqual(response.status_code,200);self.assertIn('anexar',response.text)
    def test_canonical_database_sql(self):
        from scripts.database import combined
        self.assertEqual((app.ROOT/'supabase.sql').read_text(encoding='utf-8'),combined())
