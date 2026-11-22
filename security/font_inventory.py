"""Extract SFNT font notice metadata without loading executable font engines."""
import hashlib
import json
from pathlib import Path
import struct

root = Path('dashboard/backend/open_webui/static/fonts')
results = []
for path in sorted(root.glob('*.ttf')):
    raw = path.read_bytes()
    count = struct.unpack_from('>H', raw, 4)[0]
    tables = {}
    for index in range(count):
        tag, _, offset, length = struct.unpack_from('>4sIII', raw, 12 + 16 * index)
        tables[tag] = (offset, length)
    offset, length = tables[b'name']
    _, entries, storage = struct.unpack_from('>HHH', raw, offset)
    names = {}
    for index in range(entries):
        platform, encoding, language, name, size, position = struct.unpack_from('>HHHHHH', raw, offset + 6 + 12 * index)
        if name not in {0, 1, 2, 3, 5, 6, 8, 9, 11, 13, 14}:
            continue
        data = raw[offset + storage + position:offset + storage + position + size]
        value = data.decode('utf-16-be' if platform in {0, 3} else 'mac_roman', errors='replace')
        names.setdefault(str(name), [])
        if value not in names[str(name)]:
            names[str(name)].append(value)
    results.append({'path': path.as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(), 'name_table': names})
dest = Path('security/THIRD_PARTY_NOTICES')
dest.mkdir(exist_ok=True)
(dest / 'font-metadata.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
for item in results:
    print(json.dumps({'path': item['path'], 'metadata': {k: v for k, v in item['name_table'].items() if k in {'0', '1', '5', '13', '14'}}}))
