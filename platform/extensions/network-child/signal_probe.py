"""Operator-only: signal target is a new benign fixture, never a native PID."""
import os,subprocess,sys
from pathlib import Path
import profile_setup as setup
if len(sys.argv)==1:
 outside=subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(30)'])
 try:
  r=subprocess.run([sys.executable,__file__,str(outside.pid)],capture_output=True,text=True,timeout=10)
  if r.returncode or outside.poll()is not None:raise RuntimeError(r.stdout+r.stderr)
  print(r.stdout)
 finally:outside.terminate();outside.wait()
else:
 probe=(Path(__file__).parent/'boundary_probe').resolve();loader=Path('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
 setup.landlock([Path('/usr/lib'),Path('/etc/ld.so.cache'),probe,loader],[probe,loader],[]);setup.seccomp()
 os.execve(probe,[str(probe),sys.argv[1]],{'PATH':'/usr/bin:/bin'})
