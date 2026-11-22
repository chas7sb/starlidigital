"""Root/operator review step, never called with model arguments."""
import hashlib,json
import sys
from pathlib import Path
BASE=Path('/opt/starlidigital/network-child/releases/v1')
SEARCH=Path('/opt/starlidigital/search-gateway/releases/research-v2-r1')
MCP=Path('/opt/starlidigital/account-mcp/releases/profile-v1')
SDK=Path('/opt/starlidigital/account-mcp-sdk/releases/sdk-1.32.2')
def build():
 sys.path.insert(0,str(BASE))
 from profile_setup import immutable
 common=[Path(x).resolve() for x in ['/usr/lib','/usr/share/nodejs','/usr/share/ca-certificates','/usr/share/zoneinfo','/etc/ssl/certs','/etc/ssl/openssl.cnf','/etc/ld.so.cache','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf','/etc/gai.conf'] if Path(x).exists()]
 configs={}
 for profile,node,entry,roots in [('search-v1',Path('/usr/bin/node'),SEARCH/'gateway/research-cli-v2.mjs',[SEARCH]),('mcp-v1',Path('/opt/starlidigital/account-mcp-node/releases/node-v24.19.0/bin/node'),MCP/'remote/service.mjs',[MCP,SDK])]:
  pins={}
  if not entry.exists():continue # Missing package remains unavailable, never synthesize an anchor.
  for root in roots:
   immutable(root)
   for p in sorted(root.rglob('*')):
    if p.is_file():
     immutable(p)
     with p.open('rb') as f:pins[str(p)]=hashlib.file_digest(f,'sha256').hexdigest()
  immutable(node)
  with node.open('rb') as f:pins[str(node)]=hashlib.file_digest(f,'sha256').hexdigest()
  configs[profile]={'node':str(node),'entry':str(entry),'readPaths':list(map(str,common+roots)),'pins':pins}
 return configs
if __name__=='__main__':
 configs=build();(BASE/'profiles.json').write_text(json.dumps(configs,indent=2)+'\n')
 (BASE/'profiles.json').chmod(0o444)
 print(json.dumps({'profiles':list(configs),'activation':'separate root-reviewed activation.json; never enabled here'}))
