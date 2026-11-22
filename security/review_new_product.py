"""Manifest-scoped new-product source audit. Never emits matched values."""
from pathlib import Path
import hashlib
import json
import re
from scan_index import RULES

root = Path('.').resolve()
paths = set()
verification = []
for manifest, prefix in [('product/SOURCE-MANIFEST.json','product'),('product/BASE-ASSETS-MANIFEST.json','product'),('product-backend/SOURCE-MANIFEST.json','product-backend/server-src')]:
    doc = json.loads(Path(manifest).read_text(encoding='utf-8'))
    missing, changed, matched = [], [], 0
    for item in doc['files']:
        path = Path(prefix, item['path'])
        if not path.is_file():
            missing.append(path.as_posix()); continue
        paths.add(path.as_posix())
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == item['sha256']:
            matched += 1
        else:
            changed.append(path.as_posix())
    verification.append({'manifest':manifest,'matched':matched,'changed':changed,'missing':missing})
for base in ['product','product-backend']:
    paths.update(p.as_posix() for p in Path(base).iterdir() if p.is_file())
findings, skipped, blobs = [], [], []
for name in sorted(paths):
    p = Path(name)
    data = p.read_bytes()
    blobs.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)})
    if len(data)>2_000_000 or b'\x00' in data:
        skipped.append({'path':name,'type':'binary-or-large'});continue
    try:text=data.decode('utf-8')
    except UnicodeError:
        skipped.append({'path':name,'type':'encoding'});continue
    for number,line in enumerate(text.splitlines(),1):
        for kind,pattern in RULES.items():
            if kind=='credential-url' and '@' not in line:continue
            if pattern.search(line):findings.append({'path':name,'line':number,'type':kind})
        if '/run/starlidigital' in line or '/srv/starlidigital' in line or '/tmp/grokbot' in line:
            findings.append({'path':name,'line':number,'type':'production-path-reference'})
        if 'starlidigital.ro' in line or 'starliapp.com' in line:
            findings.append({'path':name,'line':number,'type':'production-domain-reference'})
report={'scope':'current manifest-selected files and root wrapper/config/manifest files only; no generated builds/dependency trees','files':blobs,'manifest_verification':verification,'findings':findings,'skipped':skipped}
Path('security/new-product-manifest-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'selected_files':len(paths),'manifest_verification':verification,'credential_candidates':[f for f in findings if not f['type'].startswith('production-')],'production_reference_count':sum(f['type'].startswith('production-') for f in findings)},indent=2))
