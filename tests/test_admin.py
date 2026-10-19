import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
import app
from admin_features import firebase_config
from test_integrations import ENV, USER


class AdminTests(unittest.TestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,ENV);self.env.start();self.client=TestClient(app.app)
 def tearDown(self):self.env.stop()
 def remote(self,admin=False):
  async def get(_client,url,**kwargs):
   if url.endswith('/auth/v1/user'):data={'id':USER}
   elif url.endswith('/site_roles'):data=[{'role':'creator'}]if admin else []
   else:raise AssertionError('Unexpected request: '+url)
   return httpx.Response(200,json=data)
  return patch.object(httpx.AsyncClient,'get',get)
 def test_member_cannot_export_database(self):
  with self.remote():response=self.client.post('/api/admin/drive-backup',headers={'Authorization':'Bearer test'})
  self.assertEqual(response.status_code,403)
 def test_admin_is_told_drive_requires_authorization(self):
  with self.remote(admin=True):response=self.client.post('/api/admin/drive-backup',headers={'Authorization':'Bearer test'})
  self.assertEqual(response.status_code,503)
 def test_anonymous_cannot_view_admin_status(self):
  self.assertEqual(self.client.get('/api/admin/status').status_code,401)
 def test_admin_status_excludes_secrets(self):
  with self.remote(admin=True):response=self.client.get('/api/admin/status',headers={'Authorization':'Bearer test'})
  self.assertEqual(response.status_code,200)
  self.assertNotIn(ENV['LIVEKIT_API_SECRET'],response.text)
 def test_firebase_config_allowlist_excludes_private_keys(self):
  value={'apiKey':'public','appId':'app','projectId':'project','private_key':'must-never-be-returned','client_email':'private@example.invalid'}
  with patch.dict(os.environ,{'FIREBASE_WEB_CONFIG':json.dumps(value)}):config=firebase_config()
  self.assertEqual(set(config),{'apiKey','appId','projectId'})
 def test_invalid_google_configuration_does_not_crash_site(self):
  with patch.dict(os.environ,{'FIREBASE_WEB_CONFIG':'not-json'}):self.assertIsNone(firebase_config())
