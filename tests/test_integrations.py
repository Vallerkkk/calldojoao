from contextlib import ExitStack
import os
import unittest
from unittest.mock import patch
import httpx
import jwt
from fastapi.testclient import TestClient
import app

USER='22222222-2222-4222-8222-222222222222'
OTHER='33333333-3333-4333-8333-333333333333'
TARGET='11111111-1111-4111-8111-111111111111'
ENV={'SUPABASE_URL':'https://example.supabase.co','SUPABASE_PUBLISHABLE_KEY':'public','LIVEKIT_URL':'wss://example.livekit.cloud','LIVEKIT_API_KEY':'test-key','LIVEKIT_API_SECRET':'test-secret-32-characters-long-1234', 'GOOGLE_CLIENT_ID':'','GOOGLE_CLIENT_SECRET':'','GOOGLE_DRIVE_REFRESH_TOKEN':'','GOOGLE_DRIVE_FOLDER_ID':''}

class IntegrationTests(unittest.TestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,ENV);self.env.start();self.client=TestClient(app.app)
 def tearDown(self):self.env.stop()
 def remote(self,member=True,friend=True,record=None,privacy=True):
  async def get(_client,url,**kwargs):
   if url.endswith('/auth/v1/user'):data={'id':USER}
   elif url.endswith('/conversations'):data=[{'id':TARGET,'user_a':USER if member else OTHER,'user_b':OTHER}]
   elif url.endswith('/friendships'):data=[{'id':TARGET}] if friend else []
   elif url.endswith('/attachments'):data=[record] if record else []
   elif url.endswith('/channels'):data=[{'id':TARGET,'kind':'text'}]
   else:raise AssertionError('Unexpected external request: '+url)
   return httpx.Response(200,json=data)
  async def privacy_post(_client,url,**kwargs):
   self.assertTrue(url.endswith('/rpc/can_call_conversation'));return httpx.Response(200,json=privacy)
  stack=ExitStack();stack.enter_context(patch.object(httpx.AsyncClient,'get',get));stack.enter_context(patch.object(httpx.AsyncClient,'post',privacy_post));return stack
 def post(self,path,**kwargs):return self.client.post(path,headers={'Authorization':'Bearer test'},**kwargs)
 def test_non_member_cannot_join_even_if_upstream_is_wrong(self):
  with self.remote(member=False):self.assertEqual(self.post(f'/api/conversations/{TARGET}/join').status_code,404)
 def test_non_friend_cannot_join(self):
  with self.remote(friend=False):self.assertEqual(self.post(f'/api/conversations/{TARGET}/join').status_code,403)
 def test_private_token_room_is_scoped(self):
  with self.remote():response=self.post(f'/api/conversations/{TARGET}/join')
  token=jwt.decode(response.json()['token'],ENV['LIVEKIT_API_SECRET'],algorithms=['HS256'])
  self.assertEqual(token['video']['room'],'direct-'+TARGET)
 def test_google_credentials_are_not_exposed(self):
  with patch.dict(os.environ,{'GOOGLE_CLIENT_SECRET':'do-not-disclose','GOOGLE_DRIVE_REFRESH_TOKEN':'never-return-token'}):response=self.client.get('/api/config')
  self.assertNotIn('do-not-disclose',response.text);self.assertNotIn('never-return-token',response.text)

 def test_private_call_respects_privacy_even_for_an_existing_friend(self):
  with self.remote(privacy=False):response=self.post(f'/api/conversations/{TARGET}/join')
  self.assertEqual(response.status_code,403);self.assertNotIn('token',response.json())
