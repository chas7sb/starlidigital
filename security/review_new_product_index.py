"""Record current new-product index candidate review; never prints source values."""
import json
from pathlib import Path
import hashlib
import subprocess
from collections import Counter

source=Path('work/new-product-index-screen.json')
report=json.loads(source.read_text(encoding='utf-8'))
blobs={x['path']:x for x in report['scanned_blobs']}
entries={x['path']:x for x in report['index_entries']}
decisions=[]
for f in report['findings']:
    p,k=f['path'],f['type']
    if k=='runtime-or-vendor-path-review' and '/grokbot1/vendor/' in p:
        reason='Two recovered Python source dependencies (guest_intents/provisional); vendor names source code, not runtime state.';status='source-dependency'
    elif k=='runtime-or-vendor-path-review' and p.startswith('product/src/lib/vendor/novnc-1.7.0/'):
        reason='Vendored noVNC/pako source with included root AUTHORS/LICENSE and MPL/OFL/BSD/pako texts; no runtime/session state.';status='licensed-vendored-source'
    elif k=='runtime-or-vendor-path-review' and p.startswith('product/static/vendor/novnc-') and p.endswith('.tgz'):
        reason='Source TGZ inspected without extraction: no traversal/symlink/private-key/database/private-JSON members; embedded license texts retained.';status='licensed-source-archive'
    elif k=='credential-literal-review' and p.endswith('/operator-auth.ts'):
        reason='Literal is only a type prefix concatenated with randomBytes(32), not an issued secret.';status='generated-prefix'
    elif k=='credential-literal-review' and any(t in p for t in ['tests_r4_all.mjs','native-revocation.test.mjs','company-connections-client.test.cjs']):
        reason='Reviewed current source test context: mocked authentication/shared-secret or revocation input, not deployed credential/config.';status='synthetic-fixture'
    elif k=='credential-url' and ('/i18n/locales/' in p or p.endswith('/WebSearch.svelte')):
        reason='Translated form proxy-URL example/placeholder, not stored connection.';status='ui-placeholder'
    elif k=='credential-url' and any(t in p for t in ['automations-client.test.cjs','providers-client.test.cjs']):
        reason='Explicit assert rejects credential-bearing authorization URL; synthetic validation input.';status='synthetic-fixture'
    else:
        reason='Requires explicit review; no automatic clearance.';status='open'
    decisions.append({**f,'oid':entries[p]['oid'],'sha256':blobs.get(p,{}).get('sha256'),'disposition':status,'reason':reason})
summary={
 'scope':'New-product staged source checkpoint only; active untracked/changed wrapper/provider/collaboration source is not implicitly covered',
 'index_entry_count':report['index_entry_count'],'content_selected_count':report['content_selected_count'],
 'index_listing_sha256':report['index_listing_sha256'],'index_unchanged_during_scan':report['index_unchanged_during_scan'],
 'findings':decisions,'open_findings':[f for f in decisions if f['disposition']=='open'],
 'skip_review':{
  'eight_fixture_pngs':'Visually inspected: synthetic owner/company/co-worker/orders/approvals/schedule/catalog data; no credentials, customer contacts or private documents observed.',
  'fonts':'Exact font hashes mapped; official OFL texts recovered into security/THIRD_PARTY_NOTICES/product; must be staged with source.',
  'editor_js':'Immutable staged ead520b0a86c17d4731c2343b21e84cfb5ed9dc8 (6971051 bytes) independently scanned; no configured secret patterns. Sheets notices retained.',
  'novnc_archives':'Inspected license and member-path/symlink/sensitive-file boundaries without extraction.',
  'remaining_static_media':'Original base-asset hashes match; brand/space/avatars/audio media, not exported runtime files. Binary metadata/steganographic screening not claimed.'},
 'generated_demo_apps_indexed':[p for p in entries if p.startswith('product-backend/') and '/generated/' in p],
 'notice_requirements':['product/LICENSE.upstream (byte-matches retained deployed license)','dashboard/LICENSE (native dependency remains)','security/THIRD_PARTY_NOTICES/product/**','security/THIRD_PARTY_NOTICES/Twemoji-CC-BY-4.0.txt','product/static/sheets/THIRD_PARTY_NOTICES.txt','product/src/lib/vendor/novnc-1.7.0/** notice files retained'],
 'source_stage_result':'No actionable secret/runtime-data finding in the reviewed staged new-source set. Include recovered notices; no runnable-product acceptance.',
}
Path('security/new-product-index-review.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'index_entry_count':summary['index_entry_count'],'new_content_blobs':summary['content_selected_count'],'index_listing_sha256':summary['index_listing_sha256'],'disposition_counts':dict(Counter(x['disposition'] for x in decisions)),'open_count':len(summary['open_findings']),'generated_demo_apps_indexed':len(summary['generated_demo_apps_indexed'])}))
