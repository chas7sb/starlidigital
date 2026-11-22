"""Apply this audit's context decisions to immutable staged blob fingerprints."""
import json
import re
import subprocess
from pathlib import Path
report = json.loads(Path('security/index-audit.json').read_text(encoding='utf-8'))
for target in report['target_verification'].values():
    text = subprocess.check_output(['git', 'cat-file', 'blob', target['oid']]).decode('utf-8')
    target.pop('recovery_fallback', None)
    target['recovery_fallback_nonempty_literal'] = any(bool(m.group(2)) for m in re.finditer(r'''recoveryEmail\s*:\s*process\.env\.ADMIN_RECOVERY_EMAIL\s*\|\|\s*(["'])(.*?)\1''', text))
    target['upstream_mailbox_literal_lines'] = [i for i, s in enumerate(text.splitlines(), 1) if '@starlidigital.ro' in s and ('imapUser' in s or ('email:' in s and 'recoveryEmail:' not in s) or 'user:' in s)]
Path('security/index-audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
prior = json.loads(Path('security/review-dispositions.json').read_text(encoding='utf-8'))
lookup = {(i['path'], i['type']): i for i in prior['findings']}
blobs = {i['path']: i for i in report['blobs']}
items = []
for item in report['findings']:
    path, kind = item['path'], item['type']
    decision = lookup.get((path, kind))
    if 'youtube_noapi.py' in path and kind == 'google-key-literal':
        status, reason = 'upstream-public-web-client-constant', 'Source explicitly calls this a constant and uses it in the public YouTube web-client search URL. Not a configured user credential. No network validation; preserve upstream context and review changes if engine behavior changes.'
    elif 'openpencil/source/packages/core/src/constants.ts' in path and kind in {'google-key-literal', 'credential-literal-review'}:
        status, reason = 'staged-remediation-required', 'Staged blob still embeds the Google Fonts key. Working tree change exists; restage and rescan before push.'
    elif decision:
        status, reason = decision['disposition'], decision['reason']
    elif path == 'onboarding/test_first_run.py' and kind == 'credential-url':
        status, reason = 'synthetic-test-fixture', 'assertRaises validation case intentionally rejects credential-bearing localhost URL; not configured state.'
    elif path == 'platform/extensions/starli-runtime/provider-runtime.test.ts' and kind == 'credential-literal-review':
        status, reason = 'synthetic-test-fixture', 'Reviewed provider selection tests set local inference credentials with mocked fetch/assertions; not production runtime configuration.'
    elif path.startswith('security/'):
        status, reason = 'scanner-self-fixture', 'Scanner patterns/tests or audit documentation; matched values not included in reports.'
    else:
        status, reason = 'review-open', 'New staged candidate needs explicit context review.'
    items.append({**item, 'oid': blobs[path]['oid'], 'sha256': blobs[path]['sha256'], 'disposition': status, 'reason': reason})
blocked = any(i['disposition'] in {'review-open', 'staged-remediation-required', 'remediation-required'} for i in items) or any(i.get('recovery_fallback_nonempty_literal') for i in report['target_verification'].values())
result = {'date': '2026-11-22', 'index_entry_count': report['index_entry_count'], 'index_listing_sha256': report['index_listing_sha256'],
          'index_unchanged_during_scan': report.get('index_unchanged_during_scan'), 'status': 'remediation-required' if blocked else 'no-actionable-secret-patterns-in-reviewed-snapshot',
          'confirmed_live_leaks': 0, 'note': 'No credentials tested over network. This is bounded source screening; binary assets and final history/archive need separate review.',
          'findings': items, 'target_verification': report['target_verification']}
Path('security/index-review-dispositions.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'candidate_count': len(items), 'open': [i for i in items if i['disposition']=='review-open']}, indent=2))
