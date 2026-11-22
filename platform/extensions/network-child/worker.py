"""Root broker's fixed worker; drops privilege before reading any task input."""
import os,sys
from pathlib import Path
BASE=Path('/sys/fs/cgroup/starli-network-children')
def main():
 if os.geteuid()!=0 or len(sys.argv)!=2 or sys.argv[1] not in ('search-v1','mcp-v1'):raise PermissionError()
 profile=sys.argv[1];group=BASE/profile/('child-'+str(os.getpid()))
 group.mkdir(mode=0o700)
 os.chmod(group,0o755) # Root-only control writes, owning child may verify read-only limits.
 for name,value in {'memory.max':str(201326592 if profile=='search-v1' else 268435456),'memory.swap.max':'0','pids.max':'16','cpu.max':'50000 100000','memory.oom.group':'1','cgroup.procs':'0'}.items():(group/name).write_text(value)
 os.setgroups([]);os.setresgid(988,988,988);os.setresuid(997,997,997)
 # Isolated mode does not add the script directory to imports.
 sys.path.insert(0,'/opt/starlidigital/network-child/releases/v1')
 from profile_setup import setup
 setup(profile)
if __name__=='__main__':
 try:main()
 except BaseException:
  os.write(2,b'NETWORK_CHILD_PROFILE_UNAVAILABLE\n');os._exit(126)
