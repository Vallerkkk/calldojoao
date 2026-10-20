import io
import unittest
import zipfile
from fastapi.testclient import TestClient
import app

class LauncherTests(unittest.TestCase):
    def test_install_page_is_public_and_uses_own_manifest(self):
        with TestClient(app.app) as client:
            response=client.get('/instalar')
            self.assertEqual(response.status_code,200)
            self.assertIn('no-store',response.headers['cache-control'])
            self.assertIn('/static/manifest.webmanifest',response.text)
            self.assertIn('id="install-app"',response.text)
            self.assertNotIn('supabase',response.text)

    def test_download_contains_only_https_shortcut_and_readme(self):
        with TestClient(app.app) as client:
            response=client.get('/baixar/Orbita-Windows.zip')
            self.assertEqual(response.status_code,200)
            self.assertIn('attachment',response.headers['content-disposition'])
            self.assertEqual(response.headers['content-type'],'application/zip')
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                self.assertEqual(set(archive.namelist()),{'Órbita.url','LEIA-ME.txt'})
                self.assertEqual(archive.read('Órbita.url').decode(),'[InternetShortcut]\r\nURL=https://orbita-8nwu.onrender.com/\r\n')
                self.assertIn('/instalar',archive.read('LEIA-ME.txt').decode())
