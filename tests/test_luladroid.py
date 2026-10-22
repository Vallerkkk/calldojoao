import unittest,os
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace
import httpx
from fastapi.testclient import TestClient
import app,luladroid

class LuladroidTests(unittest.TestCase):
 def test_wake_phrase(self):
  for speech in ['eai LulaDroid qual a capital do Brasil?','E aí Lula Droid, qual a capital do Brasil?']:
   self.assertEqual(luladroid.question_from_speech(speech),'qual a capital do brasil?')
  for speech in ['LulaDroid qual a capital?','falando normalmente','eai LulaDroid']:
   self.assertEqual(luladroid.question_from_speech(speech),'')
 def test_never_configured_without_free_confirmation(self):
  with patch.dict(os.environ,{'GEMINI_API_KEY':'fixture-only','GEMINI_FREE_TIER_CONFIRMED':'false'}):self.assertFalse(luladroid.configured())
 def test_authentication_required(self):
  self.assertEqual(TestClient(app.app).post('/api/luladroid/ask',json={'room_name':'channel-11111111-1111-4111-8111-111111111111','speech':'eai LulaDroid oi'}).status_code,401)
 def test_no_wake_never_contacts_a_provider(self):
  async def identity():return({'id':'11111111-1111-4111-8111-111111111111'},{'apikey':'fixture'})
  app.app.dependency_overrides[app.current_user]=identity
  try:
   with patch.object(httpx.AsyncClient,'post',side_effect=AssertionError('No upstream')):
    response=TestClient(app.app).post('/api/luladroid/ask',json={'room_name':'channel-11111111-1111-4111-8111-111111111111','speech':'conversa normal'})
   self.assertEqual(response.status_code,400)
  finally:app.app.dependency_overrides.clear()
 def test_only_question_reaches_gemini_and_broadcast_is_server_side(self):
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
    response=TestClient(app.app).post('/api/luladroid/ask',json={'room_name':room,'speech':'segredo que não deve ir. eai LulaDroid qual a capital do Brasil?'})
   self.assertEqual(response.status_code,200,response.text);self.assertNotIn('fixture-only',response.text)
   request=next(args for url,args in calls if 'generativelanguage'in url)
   self.assertEqual(request['json']['contents'],[{'parts':[{'text':'qual a capital do brasil?'}]}]);service.send_data.assert_awaited_once()
  finally:app.app.dependency_overrides.clear()
