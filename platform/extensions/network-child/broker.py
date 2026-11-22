"""Root-only fixed-profile process broker. Socket data and stderr are never logged."""
import asyncio,base64,json,os,re,secrets,signal,socket,struct,time
from collections import OrderedDict
from pathlib import Path
BASE=Path('/opt/starlidigital/network-child/releases/v1')
SOCKET='/run/starli-network-child/broker.sock'
LIMITS={'search-v1':(16384,131072,18),'mcp-v1':(262144,1500000,25)}
JOBS={}
RECEIPTS=OrderedDict()
def remember(job):
 if not job.acked:return
 RECEIPTS[job.token]={'expires':time.monotonic()+90,'returncode':job.proc.returncode}
 while len(RECEIPTS)>256:RECEIPTS.popitem(last=False)
def receipt(token):
 value=RECEIPTS.get(token)
 if value and value['expires']>time.monotonic():return value
 RECEIPTS.pop(token,None);return None
async def frame(writer,value):
 writer.write(json.dumps(value,separators=(',',':')).encode()+b'\n');await asyncio.wait_for(writer.drain(),3)
def peer(writer):return struct.unpack('3i',writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]
def group_empty(job):
 path=Path('/sys/fs/cgroup/starli-network-children')/job.profile/('child-'+str(job.proc.pid))/'cgroup.procs'
 return not path.exists() or not path.read_text().strip()
class Job:
 def __init__(self,profile,proc):
  self.profile=profile;self.proc=proc;self.token=secrets.token_hex(32);self.stop_lock=asyncio.Lock();self.finished=asyncio.Event();self.acked=False
 async def stop(self,force=False):
  async with self.stop_lock:
   if self.acked:return
   # Popen identity remains owned by this broker; never accept caller PID/unit.
   if self.proc.returncode is None:
    try:os.killpg(self.proc.pid,signal.SIGKILL if force else signal.SIGTERM)
    except ProcessLookupError:pass
    try:await asyncio.wait_for(asyncio.shield(self.proc.wait()),1)
    except asyncio.TimeoutError:
     try:os.killpg(self.proc.pid,signal.SIGKILL)
     except ProcessLookupError:pass
     await self.proc.wait()
   cg=Path('/sys/fs/cgroup/starli-network-children')/self.profile/('child-'+str(self.proc.pid))
   if not group_empty(self):
    (cg/'cgroup.kill').write_text('1')
    for _ in range(100):
     if group_empty(self):break
     await asyncio.sleep(.01)
   if not group_empty(self):raise RuntimeError('PHYSICAL_STOP_UNCONFIRMED')
   self.acked=True;self.finished.set()
   remember(self)
   if cg.exists():
    try:cg.rmdir()
    except OSError:pass

async def connection(reader,writer):
 job=None;tasks=[]
 try:
  if peer(writer)!=997:raise PermissionError()
  line=await asyncio.wait_for(reader.readline(),3)
  if len(line)>16384:raise ValueError()
  request=json.loads(line)
  if request.get('op')=='ready':
   if set(request)!={'op','profile'} or request['profile']not in LIMITS:raise PermissionError()
   enabled=json.loads((BASE/'activation.json').read_text())['profiles']
   await frame(writer,{'type':'ready','ready':request['profile']in enabled});return
  if request.get('op')=='stop':
   if set(request)!={'op','token','force'} or type(request['force'])is not bool:raise ValueError()
   job=JOBS.get(request['token'])
   if job is None:
    prior=receipt(request['token'])
    if prior is None:raise PermissionError()
    await frame(writer,{'type':'stopped','physicalStopAcknowledged':True,'returncode':prior['returncode']});return
   await job.stop(request['force']);await frame(writer,{'type':'stopped','physicalStopAcknowledged':True,'returncode':job.proc.returncode});job=None;return
  if set(request)!={'op','profile'} or request['op']!='launch' or request['profile']not in LIMITS:raise PermissionError()
  if len(JOBS)>=4:raise PermissionError()
  profile=request['profile'];input_limit,output_limit,wall=LIMITS[profile]
  if profile not in json.loads((BASE/'activation.json').read_text())['profiles']:raise PermissionError()
  # No await between admission and reservation. Placeholder prevents launch races.
  reservation=secrets.token_hex(32);JOBS[reservation]=None
  try:
   proc=await asyncio.create_subprocess_exec('/usr/bin/python3','-I',str(BASE/'worker.py'),profile,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},cwd='/',start_new_session=True,limit=16384)
  finally:JOBS.pop(reservation,None)
  job=Job(profile,proc);JOBS[job.token]=job
  await frame(writer,{'type':'launched','token':job.token,'pid':proc.pid})
  async def incoming():
   total=0
   while line:=await reader.readline():
    if len(line)>16384:raise ValueError()
    value=json.loads(line)
    if value=={'op':'eof'}:
     proc.stdin.close();await proc.wait();return
    if set(value)!={'op','data'} or value['op']!='stdin':raise ValueError()
    data=base64.b64decode(value['data'],validate=True);total+=len(data)
    if len(data)>8192 or total>input_limit:raise ValueError()
    proc.stdin.write(data);await proc.stdin.drain()
   raise ConnectionError('CLIENT_DISCONNECTED')
  async def outgoing():
   total=0
   while data:=await proc.stdout.read(8192):
    total+=len(data)
    if total>output_limit:raise ValueError('OUTPUT_LIMIT')
    await frame(writer,{'type':'stdout','data':base64.b64encode(data).decode()})
   await proc.wait()
  tasks=[asyncio.create_task(incoming()),asyncio.create_task(outgoing()),asyncio.create_task(proc.wait())]
  done,_=await asyncio.wait(tasks,timeout=wall,return_when=asyncio.FIRST_COMPLETED)
  normal=tasks[2] in done
  if normal:
   await asyncio.wait_for(tasks[1],2)
  await job.stop(force=not normal)
  await frame(writer,{'type':'finished','physicalStopAcknowledged':True,'returncode':proc.returncode,'reason':'exited' if normal else 'cancelled_or_limit'})
 except BaseException:
  if job is not None:
   try:await job.stop(force=True)
   except BaseException:pass
  try:await frame(writer,{'type':'error','code':'NETWORK_CHILD_UNAVAILABLE'})
  except BaseException:pass
 finally:
  for task in tasks:
   if not task.done():task.cancel()
  if tasks:await asyncio.gather(*tasks,return_exceptions=True)
  if job is not None and job.acked:
   remember(job);JOBS.pop(job.token,None)
  writer.close()
  try:await writer.wait_closed()
  except (ConnectionError,OSError):pass

async def main():
 os.umask(0o077)
 path=Path(SOCKET)
 if path.exists():
  if not path.is_socket() or path.stat().st_uid!=0:raise PermissionError()
  path.unlink()
 server=await asyncio.start_unix_server(connection,SOCKET,limit=16384)
 os.chown(SOCKET,0,988);os.chmod(SOCKET,0o660)
 async with server:await server.serve_forever()
if __name__=='__main__':asyncio.run(main())
