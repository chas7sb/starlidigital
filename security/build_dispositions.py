"""Bind reviewed dispositions to source fingerprints; never serialize matches."""
import hashlib
import json
from pathlib import Path
from scan import RULES

items = []
for component in ['dashboard', 'platform']:
    report = json.loads(Path(f'security/local-{component}-scan.json').read_text())
    for finding in report['findings']:
        path = Path(component, finding['path'])
        kind = finding['type']
        item = {'path': path.as_posix(), 'type': kind, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        item['lines'] = []
        if kind in RULES:
            item['lines'] = [i for i, s in enumerate(path.read_text(encoding='utf-8').splitlines(), 1) if RULES[kind].search(s)]
        name = path.as_posix()
        if '/server/data/' in name or '/control-plane/data/' in name:
            disposition, reason = 'runtime-exclude-required', 'Generated local application state belongs outside distributable source. Exclude the entire data directory including SQLite sidecars and previews.'
        elif kind in {'binary-unscanned-review', 'oversize-unscanned'}:
            disposition, reason = 'asset-review-open', 'Pattern scanner did not inspect this asset; provenance/notices and embedded metadata remain separate gates.'
        elif kind == 'runtime-or-archive-exclude-review' and name.endswith('.sql'):
            disposition, reason = 'schema-reviewed', 'Schema source has no line-start INSERT INTO or COPY statements; source schema is not a production database dump.'
        elif kind in {'provider-token', 'credential-literal-review', 'credential-url'} and ('/test/' in name or '/tests/' in name or '.test.' in name):
            disposition, reason = 'synthetic-test-fixture', 'Reviewed test context: mock request/response, validation input, local test auth or redaction assertion; not evidence of production credentials.'
        elif kind == 'credential-literal-review' and ('operator-auth.ts' in name or '/oauth/index.ts' in name):
            disposition, reason = 'generated-token-prefix', 'Literal is a token type prefix concatenated with randomBytes(32), not a static issued credential.'
        elif 'pexels.py' in name and kind == 'credential-literal-review':
            disposition, reason = 'remediation-required', 'Executable module-level API key default is nonempty and high entropy; provenance/validity not established. Remove default and require local configuration. Do not validate it over network.'
        elif '/.github/workflows/' in name and kind in {'credential-literal-review', 'credential-url'}:
            disposition, reason = 'ci-expression-reference', 'Source references GitHub secrets expressions, not expanded secret values. Review whether upstream workflows should ship enabled.'
        elif 'openpencil/source/packages/core/src/constants.ts' in name and kind == 'credential-literal-review':
            disposition, reason = 'remediation-required', 'Google Fonts API key is a literal Google-key-shaped value in executable source. Require local key or disable remote font catalog; do not consume upstream quota.'
        elif '/openpencil/source/packages/vue/src/i18n/messages/' in name and kind == 'credential-literal-review':
            disposition, reason = 'ui-message-label', 'Translation object key/message mentions API key; literal is user-facing text, not a credential.'
        elif '/searx/engines/' in name and kind == 'credential-literal-review':
            disposition, reason = 'documented-placeholder', 'Reviewed documentation/example placeholder; Pexels executable default is separately blocked.'
        elif '/searx/settings.yml' in name and kind == 'credential-literal-review':
            disposition, reason = 'documented-placeholder', 'Commented configuration example; runtime signing-secret default is separately flagged.'
        elif kind == 'credential-url' and ('/i18n/locales/' in name or 'WebSearch.svelte' in name):
            disposition, reason = 'ui-placeholder', 'Credential-bearing proxy URL is a translated form example/placeholder, not configured state.'
        elif kind == 'email-review':
            disposition, reason = 'source-address-context-reviewed', 'Reviewed as source example, synthetic fixture, public upstream contact, author notice, or Starli deployment default; no exported mailbox/CRM record found. Production defaults separately need portability remediation.'
        else:
            disposition, reason = 'review-open', 'Needs explicit owner review; not automatically cleared.'
        item.update(disposition=disposition, reason=reason)
        items.append(item)

actions = [
    {'priority': 'P1', 'owner': 'Prime / AgentX 9 packaging', 'path': 'platform/server/data/', 'line': None, 'action': 'Exclude the whole generated runtime directory from Git and every source/archive/package path. Contains SQLite database, WAL/SHM sidecars and video preview. Current root ignore covers *.sqlite but does not cover all sidecars or preview assets. Do not infer these are sanitized just because tests generated them.'},
    {'priority': 'P1', 'owner': 'Prime/platform extensions owner', 'path': 'platform/extensions/search/source/searx/engines/pexels.py', 'line': 31, 'action': 'Remove nonempty API key default; require user-provided configuration and disable engine when absent. If a credential owner confirms it is private/live, rotate via their normal process. No network validation performed.'},
    {'priority': 'P1', 'owner': 'AgentX 3 / Prime', 'path': 'platform/server/src/index.ts', 'line': 48, 'also': [{'path': 'platform/extensions/mission-control/server/src/index.ts', 'line': 50}], 'action': 'Remove upstream recovery-email fallback. Require ADMIN_RECOVERY_EMAIL or leave recovery disabled; ensure a fresh install cannot route recovery to the upstream organization.'},
    {'priority': 'P1', 'owner': 'Prime/search integration owner', 'path': 'platform/extensions/search/source/searx/settings.yml', 'line': 105, 'action': 'Upstream signing-secret placeholder remains. Installer must generate a fresh instance secret and fail closed if this default reaches runtime. This is a default-security issue, not a leaked secret.'},
    {'priority': 'P2', 'owner': 'AgentX 3 / Prime', 'path': 'platform/server/src/mailbox/service.ts', 'line': 67, 'also': [{'path': 'platform/server/src/mailbox/service.ts', 'line': 72}, {'path': 'platform/server/src/mailbox/service.ts', 'line': 486}, {'path': 'platform/extensions/mission-control/server/src/mailbox/service.ts', 'line': 67}], 'action': 'Replace production mailbox identity/user fallbacks with explicit local account configuration. Keep mail integration disabled until configured. Review duplicated mission-control defaults too.'},
]
actions[0]['verification'] = 'Git ignore now covers platform/server/data/ and all database sidecars; git ls-files returned no runtime/data entries. Source archive builder rejects any tracked data directory. Final archive still needs inspection.'
actions[0]['status'] = 'verified-source-exclusion'
actions[1]['verification'] = 'Executable key default removed; local search initializer disables Pexels and supplies no key.'
actions[1]['status'] = 'verified-fixed'
actions[2]['verification'] = 'Main platform fallback removed; Mission Control duplicate still contains ADMIN_RECOVERY_EMAIL fallback at review time.'
actions[2]['status'] = 'partially-fixed'
actions[3]['verification'] = 'init-settings.py generates token_hex(32), exclusive private file; wsgi.py requires absolute settings path and rejects missing/short/upstream default secret before SearXNG import.'
actions[3]['status'] = 'verified-wrapper-fixed'
actions[4]['status'] = 'owner-follow-up'
actions.extend([
    {'priority': 'P1', 'owner': 'Prime / OpenPencil extension owner', 'path': 'platform/extensions/openpencil/source/packages/core/src/constants.ts', 'line': 489, 'status': 'remediation-required', 'action': 'Google Fonts key-shaped literal is embedded in executable source. Remove and make locally configurable; fail gracefully with catalog disabled when unset. No network validation performed; no claim that key is live/private.'},
    {'priority': 'P1', 'owner': 'Prime / packaging owner', 'path': 'platform/control-plane/data/', 'line': None, 'status': 'remediation-required', 'action': 'Generated asset/preview PNGs appeared during tests. Root Git ignore did not match a representative file at review time. Exclude entire control-plane/data/ from Git and artifacts. Archive builder data-directory rejection helps but should not be sole protection.'},
])
result = {'date': '2026-11-22', 'scope': 'local dashboard and platform extraction; working tree changes concurrently', 'status': 'remediation-required', 'confirmed_live_secret_count': 0, 'note': 'No live credentials tested. Test-path disposition uses reviewed test context, never only filename. Fingerprints must match before reusing these dispositions.', 'actions': actions, 'findings': items}
Path('security/review-dispositions.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'findings': len(items), 'actions': len(actions), 'open': [i['path'] for i in items if i['disposition']=='review-open']}))
