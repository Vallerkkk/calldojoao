import unittest,os
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace
import httpx
from fastapi.testclient import TestClient
import app,luladroid
class TranscriptionTests(unittest.TestCase):
 def test_assistant_endpoint_removed(self):
  with patch.object(httpx.AsyncClient,'post',side_effect=AssertionError('No provider requests')):
   response=TestClient(app.app).post('/api/luladroid/ask',json={'room_name':'channel-11111111-1111-4111-8111-111111111111','speech':'eai LulaDroid oi'})
  self.assertEqual(response.status_code,404)
 def test_authentication_required(self):
  self.assertEqual(TestClient(app.app).post('/api/transcription/room',json={'room_name':'channel-11111111-1111-4111-8111-111111111111'}).status_code,401)
 def test_room_verifies_livekit_membership_without_assistant(self):
  room='channel-11111111-1111-4111-8111-111111111111';calls=[]
  async def identity():return({'id':'11111111-1111-4111-8111-111111111111'},{'apikey':'fixture'})
  async def get(_client,url,**kwargs):return httpx.Response(200,json=[{'id':'11111111-1111-4111-8111-111111111111'}])
  async def post(_client,url,**kwargs):
   calls.append((url,kwargs))
   return httpx.Response(200,json='req-fixture')if'reserve_luladroid'in url else httpx.Response(200,json={'candidates':[{'content':{'parts':[{'text':'Brasília.'}]}}]})
  service=SimpleNamespace(get_participant=AsyncMock(),list_rooms=AsyncMock(return_value=SimpleNamespace(rooms=[SimpleNamespace(sid='RM_fixture')])) ,send_data=AsyncMock())
  class LK:
   def __init__(self,*args):self.room=service
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
  app.app.dependency_overrides[app.current_user]=identity
  try:
   env={'GEMINI_API_KEY':'fixture-only','GEMINI_FREE_TIER_CONFIRMED':'true','SUPABASE_URL':'https://example.invalid','LIVEKIT_URL':'wss://example.invalid','LIVEKIT_API_KEY':'fixture','LIVEKIT_API_SECRET':'fixture'}
   with patch.dict(os.environ,env),patch.object(httpx.AsyncClient,'get',get),patch.object(httpx.AsyncClient,'post',post),patch.object(luladroid.api,'LiveKitAPI',LK):
    response=TestClient(app.app).post('/api/transcription/room',json={'room_name':room})
   self.assertEqual(response.status_code,200,response.text);self.assertNotIn('fixture-only',response.text)
   self.assertEqual(response.json(),{'room_sid':'RM_fixture','assistant':False});self.assertEqual(calls,[]);service.get_participant.assert_awaited_once()
  finally:app.app.dependency_overrides.clear()
