import unittest
from fastapi.testclient import TestClient
import app
class RetiredTranscriptionTests(unittest.TestCase):
 def test_old_clients_cannot_start_transcription(self):
  for path in ('/api/transcription/room','/api/luladroid/room'):
   self.assertEqual(TestClient(app.app).post(path,json={'room_name':'unused'}).status_code,410)
 def test_old_assistant_is_absent(self):
  self.assertEqual(TestClient(app.app).post('/api/luladroid/ask',json={}).status_code,404)
