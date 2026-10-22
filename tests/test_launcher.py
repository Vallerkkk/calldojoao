import unittest
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

    def test_downloads_redirect_only_to_versioned_official_release(self):
        with TestClient(app.app) as client:
            for path,asset in [('/baixar/Orbita-Windows.zip','Orbita-1.0.2-x64.zip'),('/baixar/Orbita-Setup.exe','Orbita-Setup-1.0.2-x64.exe')]:
                response=client.get(path,follow_redirects=False)
                self.assertEqual(response.status_code,302)
                self.assertEqual(response.headers['location'],'https://github.com/Vallerkkk/calldojoao/releases/download/v1.0.2/'+asset)
                self.assertIn('no-store',response.headers['cache-control'])
