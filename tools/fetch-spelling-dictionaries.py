"""Fetch pinned dictionary sources; runtime never downloads dictionaries."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request

REVISION = '8cfea406b505e4d7df52d5a19bce525df98c54ab'
ROOT = Path(__file__).resolve().parent.parent / 'src-tauri' / 'dictionaries'
MANIFEST = ROOT / 'sources.json'
EXPECTED = {entry['file']: entry['sha256'] for entry in json.loads(MANIFEST.read_text(encoding='utf-8'))['files']} if MANIFEST.exists() else {}
BASE = f'https://raw.githubusercontent.com/wooorm/dictionaries/{REVISION}/dictionaries'

def fetch(item):
    language, name = item
    url = f'{BASE}/{language}/{name}'
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise ValueError('Dictionary file exceeds download limit')
    digest = hashlib.sha256(data).hexdigest()
    expected = EXPECTED.get(f'{language}/{name}')
    if expected and digest != expected:
        raise ValueError(f'Dictionary hash mismatch: {language}/{name}')
    data.decode('utf-8')
    target = ROOT / language / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {'file': f'{language}/{name}', 'source': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

if __name__ == '__main__':
    items = [(language, name) for language in ['ru', 'uk', 'en'] for name in ['index.aff', 'index.dic', 'license']]
    with ThreadPoolExecutor(max_workers=4) as executor:
        files = list(executor.map(fetch, items))
    (ROOT / 'sources.json').write_text(json.dumps({'revision': REVISION, 'files': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([{'file': f['file'], 'bytes': f['bytes']} for f in files]))
