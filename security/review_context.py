"""Private triage helper: prints line numbers and redacted context, never matches."""
import json
from pathlib import Path
import re
from scan import RULES

for component in ['dashboard', 'platform']:
    report = json.loads(Path(f'security/local-{component}-scan.json').read_text())
    for finding in report['findings']:
        kind = finding['type']
        if kind not in {'provider-token', 'credential-literal-review', 'credential-url'}:
            continue
        path = Path(component, finding['path'])
        for num, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            for match in RULES[kind].finditer(line):
                value = match.group()
                flags = [word for word in ['test', 'example', 'dummy', 'fake', 'placeholder', 'changeme', 'your_', 'some_secret', 'ultrasecret', 'secret-key', '${', 'process.env', 'not-a-real'] if word in value.lower()]
                safe = line
                for rule in RULES.values():
                    safe = rule.sub('[REDACTED]', safe)
                safe = re.sub(r'''(["'`]).*?\1''', '[STRING]', safe)
                print(json.dumps({'path': path.as_posix(), 'line': num, 'type': kind, 'synthetic_indicators': flags, 'redacted_context': safe[:240]}))
