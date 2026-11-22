"""Fixed root-installed profile setup. This is NOT a generic command launcher."""
import ctypes,errno,hashlib,json,os,platform,resource,stat,sys
from pathlib import Path

BASE=Path('/opt/starlidigital/network-child/releases/v1')
CG=Path('/sys/fs/cgroup/starli-network-children')
PROFILES={'search-v1':(201326592,96,10),'mcp-v1':(268435456,128,10)}
RESOLVER=Path('/run/systemd/resolve/stub-resolv.conf')
libc=ctypes.CDLL(None,use_errno=True)
def call(n,*args):
 r=libc.syscall(n,*args)
 if r<0:raise OSError(ctypes.get_errno(),'KERNEL_PROFILE_FAILED')
 return r
def immutable(path):
 p=Path(path)
 if not p.is_absolute():raise ValueError('ABSOLUTE_PATH_REQUIRED')
 real=p.resolve(strict=True)
 for item in [real,*real.parents]:
  s=item.stat()
  if s.st_uid!=0 or s.st_mode & 0o022:raise PermissionError('ROOT_IMMUTABLE_REQUIRED')
 return real
def read_path(path):
 p=Path(path)
 if p!=RESOLVER:return immutable(p)
 if p.resolve(strict=True)!=p:raise PermissionError('RESOLVER_PATH')
 for item in [p,*p.parents]:
  s=item.lstat();owners={0,991} if item in (p,p.parent) else {0}
  if s.st_uid not in owners or s.st_mode&0o022:raise PermissionError('RESOLVER_DATA_OWNER')
 if not stat.S_ISREG(p.lstat().st_mode):raise PermissionError('RESOLVER_DATA_TYPE')
 return p
def landlock(read_paths,execute_paths,ports):
 abi=call(444,0,0,1)
 if abi<4:raise RuntimeError('LANDLOCK_ABI4_REQUIRED')
 class Ruleset(ctypes.Structure):_fields_=[('fs',ctypes.c_uint64),('net',ctypes.c_uint64)]
 class PathRule(ctypes.Structure):_pack_=1;_fields_=[('access',ctypes.c_uint64),('parent_fd',ctypes.c_int32)]
 class NetRule(ctypes.Structure):_fields_=[('access',ctypes.c_uint64),('port',ctypes.c_uint64)]
 # Includes truncate and refer. No write/create/remove/rename permission is granted.
 rules=Ruleset((1<<15)-1,3);fd=call(444,ctypes.byref(rules),ctypes.sizeof(rules),0)
 try:
  for path in sorted(set(map(str,read_paths))|set(map(str,execute_paths))):
   p=Path(path);opened=os.open(p,os.O_PATH|os.O_CLOEXEC|os.O_NOFOLLOW)
   try:
    metadata=os.fstat(opened)
    if stat.S_ISLNK(metadata.st_mode):raise PermissionError('RULE_SYMLINK')
    if p==RESOLVER and (metadata.st_uid not in {0,991} or metadata.st_mode&0o022 or not stat.S_ISREG(metadata.st_mode)):raise PermissionError('RESOLVER_DATA_OWNER')
    access=4|(8 if stat.S_ISDIR(metadata.st_mode) else 0)|(1 if str(p) in set(map(str,execute_paths)) else 0)
    rule=PathRule(access,opened);call(445,fd,1,ctypes.byref(rule),0)
   finally:os.close(opened)
  for port in ports:
   rule=NetRule(2,port);call(445,fd,2,ctypes.byref(rule),0)
  if libc.prctl(38,1,0,0,0):raise OSError(ctypes.get_errno(),'NO_NEW_PRIVS')
  call(446,fd,0)
 finally:os.close(fd)

def seccomp():
 if platform.machine()!='x86_64':raise RuntimeError('ARCH_NOT_REVIEWED')
 class Filter(ctypes.Structure):_fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint)]
 class Program(ctypes.Structure):_fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(Filter))]
 ALLOW=0x7fff0000;DENY=0x50000|errno.EPERM
 rows=[(0x20,0,0,4),(0x15,1,0,0xc000003e),(0x06,0,0,0x80000000),(0x20,0,0,0),
       (0x35,0,1,0x40000000),(0x06,0,0,DENY)] # x32 uses the same audit arch
 # No process creation, namespace changes, foreign-process memory/FD access,
 # raw/kernel socket APIs, io_uring, privileged kernel or alternate exec API.
 deny=[57,58,62,129,200,297,424,101,141,142,144,155,165,166,169,175,176,203,246,248,249,250,251,272,298,303,304,308,310,311,312,313,314,321,323,425,426,427,438,440,448,322,53,50,43,288]
 for nr in deny:rows.extend([(0x15,0,1,nr),(0x06,0,0,DENY)])
 rows.extend([(0x15,0,1,435),(0x06,0,0,0x50000|errno.ENOSYS)]) # glibc thread fallback
 # tgkill is needed for thread-local runtime signals, never another TGID.
 rows.extend([(0x15,0,4,234),(0x20,0,0,16),(0x15,1,0,os.getpid()),(0x06,0,0,DENY),(0x06,0,0,ALLOW)])
 # prlimit64 may inspect/change only this process, not other same-UID accounts.
 rows.extend([(0x15,0,5,302),(0x20,0,0,16),(0x15,2,0,0),(0x15,1,0,os.getpid()),(0x06,0,0,DENY),(0x06,0,0,ALLOW)])
 # clone is allowed only with CLONE_THREAD and no namespace/vfork flags.
 rows.extend([(0x15,0,6,56),(0x20,0,0,16),(0x45,1,0,0x10000),(0x06,0,0,DENY),(0x45,0,1,0x7e024000),(0x06,0,0,DENY),(0x06,0,0,ALLOW)])
 # Only IPv4 sockets. nft enforces destination IP+port by profile cgroup.
 rows.extend([(0x15,0,4,41),(0x20,0,0,16),(0x15,1,0,2),(0x06,0,0,DENY),(0x06,0,0,ALLOW),(0x06,0,0,ALLOW)])
 array=(Filter*len(rows))(*(Filter(*row) for row in rows));program=Program(len(rows),array)
 if libc.prctl(22,2,ctypes.byref(program),0,0):raise OSError(ctypes.get_errno(),'SECCOMP_FAILED')

def setup(profile):
 if profile not in PROFILES or os.getuid()!=997 or os.geteuid()!=997 or os.getgroups():raise PermissionError('PROFILE_IDENTITY')
 cfg=json.loads(immutable(BASE/'profiles.json').read_text())[profile]
 expected='/starli-network-children/'+profile+'/child-'+str(os.getpid())
 if Path('/proc/self/cgroup').read_text().strip()!='0::'+expected:raise PermissionError('CGROUP_REQUIRED')
 group=CG/profile/('child-'+str(os.getpid()))
 if (group/'memory.max').read_text().strip()!=str(PROFILES[profile][0]) or (group/'pids.max').read_text().strip()!='16':raise PermissionError('CGROUP_LIMITS')
 for filename,digest in cfg['pins'].items():
  p=immutable(filename)
  with p.open('rb') as f:
   if hashlib.file_digest(f,'sha256').hexdigest()!=digest:raise PermissionError('SOURCE_PIN')
 node=str(immutable(cfg['node']));entry=str(immutable(cfg['entry']))
 reads=[read_path(x) for x in cfg['readPaths']]
 executes=[immutable(node),immutable('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')]
 reads += executes+[Path('/proc')/str(os.getpid())]
 resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(0,0))
 resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));resource.setrlimit(resource.RLIMIT_CPU,(PROFILES[profile][2],PROFILES[profile][2]))
 landlock(reads,executes,[53,443]+([8888] if profile=='search-v1' else []));seccomp()
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'}
 # No NODE_OPTIONS, proxy, config, credentials or ambient SDK settings inherited.
 os.execve(node,[node,'--max-old-space-size='+str(PROFILES[profile][1]),entry],env)

if __name__=='__main__':
 try:
  if len(sys.argv)!=2:raise ValueError('PROFILE_ARGUMENTS')
  setup(sys.argv[1])
 except Exception:
  os.write(2,b'NETWORK_CHILD_PROFILE_UNAVAILABLE\n');sys.exit(126)
