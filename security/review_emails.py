import json
from pathlib import Path
from scan import RULES

for component in ['dashboard', 'platform']:
    report = json.loads(Path(f'security/local-{component}-scan.json').read_text())
    for finding in report['findings']:
        if finding['type'] != 'email-review' or any(w in finding['path'] for w in ['/test', 'test.', 'README', 'CHANGELOG', 'package', 'pyproject', 'translation.json']):
            continue
        path = Path(component, finding['path'])
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if RULES['email-review'].search(line):
                safe = line
                for rule in RULES.values():
                    safe = rule.sub('[REDACTED]', safe)
                print(json.dumps({'path': path.as_posix(), 'line': number, 'context': safe[:300]}))
