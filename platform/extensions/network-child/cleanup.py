"""Root fixed-parent cleanup, only kernel cgroups owned by this profile family."""
import re,time
from pathlib import Path
BASE=Path('/sys/fs/cgroup/starli-network-children')
def cleanup():
 for profile in ('search-v1','mcp-v1'):
  parent=BASE/profile
  if not parent.exists():continue
  for group in parent.iterdir():
   if not group.is_dir() or not re.fullmatch('child-[0-9]+',group.name):continue
   (group/'cgroup.kill').write_text('1')
   for _ in range(100):
    if not (group/'cgroup.procs').read_text().strip():break
    time.sleep(.02)
   if (group/'cgroup.procs').read_text().strip():raise RuntimeError('PHYSICAL_STOP_UNCONFIRMED')
   group.rmdir()
if __name__=='__main__':cleanup()
