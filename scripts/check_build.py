from pathlib import Path
import hashlib,json

root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'static/dist/manifest.json').read_text(encoding='utf-8'))
for url,expected in manifest['integrity'].items():
    path=(root/url.lstrip('/')).resolve()
    if not path.is_relative_to((root/'static/dist').resolve()):raise SystemExit('Invalid build path')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise SystemExit('Asset changed: '+url)
print('Built assets verified:',len(manifest['integrity']))
