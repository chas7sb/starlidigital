"""ROOT REVIEW REQUIRED. New fixed broker only; no existing service/guard changes."""
import hashlib,ipaddress,json,os,re,stat,subprocess,sys
from pathlib import Path
ROOT=Path('/opt/starlidigital/network-child/releases/v1')
def run(*args):return subprocess.run(args,capture_output=True,text=True,check=True).stdout
def immutable_stage(path):
 if path!=path.resolve(strict=True):raise PermissionError('STAGE_SYMLINK')
 for p in [path,*path.parents]:
  s=p.lstat()
  if s.st_uid!=0 or s.st_mode&0o022:raise PermissionError('ROOT_PRIVATE_STAGE_REQUIRED')
def read_regular(path):
 fd=os.open(path,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_size>1048576:raise ValueError('REVIEW_FILE_INVALID')
  with os.fdopen(fd,'rb',closefd=False) as f:return f.read(1048577)
 finally:os.close(fd)
def load_review(source,expected_sha,ownership_check=immutable_stage):
 if not re.fullmatch('[a-f0-9]{64}',expected_sha):raise ValueError('EXTERNAL_PIN_REQUIRED')
 ownership_check(source)
 raw=read_regular(source/'FILES.json')
 if hashlib.sha256(raw).hexdigest()!=expected_sha:raise ValueError('MANIFEST_PIN_MISMATCH')
 manifest=json.loads(raw)
 if not isinstance(manifest,dict) or not 1<=len(manifest)<=32:raise ValueError('MANIFEST_INVALID')
 content={}
 for name,digest in manifest.items():
  if not isinstance(name,str) or not re.fullmatch('[A-Za-z0-9_.-]{1,80}',name) or name in ('.','..') or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('REVIEW_PATH')
  ownership_check(source/name);data=read_regular(source/name)
  if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('SOURCE_PIN_MISMATCH')
  content[name]=data
 return content
def main():
 if os.geteuid()!=0:raise PermissionError('ROOT_REVIEW_REQUIRED')
 if len(sys.argv)!=3:raise ValueError('EXPECTED_SHA_AND_ROOT_PRIVATE_STAGE_REQUIRED')
 source=Path(sys.argv[2])
 if not source.is_absolute() or not source.is_relative_to('/var/lib/starli-network-child-review'):raise PermissionError('ROOT_PRIVATE_STAGE_REQUIRED')
 content=load_review(source,sys.argv[1])
 if ROOT.exists():raise RuntimeError('RELEASE_ALREADY_EXISTS_REVIEW_ROLLBACK_REQUIRED')
 if subprocess.run(['nft','list','table','inet','starli_network_child'],capture_output=True).returncode==0:raise RuntimeError('TABLE_ALREADY_EXISTS')
 top=Path('/sys/fs/cgroup');enabled=set((top/'cgroup.subtree_control').read_text().split())
 if not {'cpu','memory','pids'}<=enabled:raise RuntimeError('ROOT_CONTROLLERS_NOT_ALREADY_ENABLED')
 ROOT.mkdir(parents=True,mode=0o755)
 for name,data in content.items():(ROOT/name).write_bytes(data);(ROOT/name).chmod(0o444)
 family=top/'starli-network-children';family.mkdir(mode=0o755)
 for name,value in {'memory.max':'805306368','memory.swap.max':'0','pids.max':'96','cpu.max':'100000 100000','cgroup.subtree_control':'+cpu +memory +pids'}.items():(family/name).write_text(value)
 for profile,memory in [('search-v1','402653184'),('mcp-v1','536870912')]:
  p=family/profile;p.mkdir(mode=0o755)
  for name,value in {'memory.max':memory,'memory.swap.max':'0','pids.max':'64','cpu.max':'100000 100000','cgroup.subtree_control':'+cpu +memory +pids'}.items():(p/name).write_text(value)
 # Parse/check first. Installation affects ONLY socket cgroups under these new parents.
 run('nft','--check','-f',str(ROOT/'network.nft'));run('nft','-f',str(ROOT/'network.nft'))
 interfaces=json.loads(run('ip','-j','-4','addr','show'))
 for interface in interfaces:
  for item in interface.get('addr_info',[]):
   address=ipaddress.IPv4Address(item['local'])
   if address.is_global:run('nft','add','element','inet','starli_network_child','denied4','{',str(address),'}')
 run('/usr/bin/python3','-I',str(ROOT/'build_manifest.py'))
 (ROOT/'activation.json').write_text('{"profiles":[]}\n');(ROOT/'activation.json').chmod(0o444)
 unit=Path('/etc/systemd/system/starli-network-child.service');unit.write_bytes(content['starli-network-child.service']);unit.chmod(0o644)
 run('systemctl','daemon-reload');run('systemctl','enable','--now','starli-network-child.service')
 print(json.dumps({'installed':True,'profilesActivated':False,'existingServicesChanged':False,'next':'root verifies nft,cgroups,immutable packages and actual fixed-profile positive/negative/Stop/disconnect tests before activation and native mount'}))
if __name__=='__main__':main()
