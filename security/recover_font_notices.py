"""Recover official notices at resolved immutable commits; no font downloads."""
import hashlib
import json
from pathlib import Path
import urllib.request

dest = Path('security/THIRD_PARTY_NOTICES')
dest.mkdir(exist_ok=True)
sources = [
    ('notofonts/latin-greek-cyrillic', 'main', 'OFL.txt', 'NotoSans-OFL.txt'),
    ('notofonts/noto-cjk', 'main', 'Sans/LICENSE', 'NotoSansCJK-OFL.txt'),
    ('mozilla/twemoji-colr', 'master', 'LICENSE.md', 'Twemoji-Mozilla-LICENSE.md'),
]
records = []
def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'StarliDigital-source-notice-audit'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()
for repo, branch, source, name in sources:
    commit = json.loads(get(f'https://api.github.com/repos/{repo}/commits/{branch}'))['sha']
    url = f'https://raw.githubusercontent.com/{repo}/{commit}/{source}'
    raw = get(url)
    (dest / name).write_bytes(raw)
    records.append({'file': name, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'retrieved': '2026-11-22', 'note': 'Official notice snapshot; exact font binary source commit not established.'})
for name, url in [('Twemoji-Apache-2.0.txt', 'https://www.apache.org/licenses/LICENSE-2.0.txt'), ('Twemoji-CC-BY-4.0.txt', 'https://creativecommons.org/licenses/by/4.0/legalcode.txt')]:
    raw = get(url)
    (dest / name).write_bytes(raw)
    records.append({'file': name, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'retrieved': '2026-11-22'})
(dest / 'retrieval-manifest.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
print(json.dumps(records, indent=2))
