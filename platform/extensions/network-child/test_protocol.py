"""Protocol/physical subprocess fixtures. No claim of cgroup/nft coverage."""
import asyncio,json,os,tempfile,unittest
from pathlib import Path
import broker,client
class Protocol(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.original_spawn=asyncio.create_subprocess_exec
  self.oldbase=broker.BASE;self.oldempty=broker.group_empty;self.oldsocket=client.SOCKET
  broker.BASE=self.root;(self.root/'activation.json').write_text('{"profiles":["search-v1"]}')
  client.SOCKET=str(self.root/'broker.sock');broker.JOBS.clear();broker.RECEIPTS.clear()
  broker.group_empty=lambda job:job.proc.returncode is not None
  async def spawn(*argv,**kwargs):
   assert argv[:2]==('/usr/bin/python3','-I')
   return await self.original_spawn('/usr/bin/python3','-u','-c','import sys,time; print("fixture-ready",flush=True); time.sleep(30)',**kwargs)
  asyncio.create_subprocess_exec=spawn
  self.server=await asyncio.start_unix_server(broker.connection,client.SOCKET,limit=16384)
 async def asyncTearDown(self):
  for job in list(broker.JOBS.values()):
   if job is not None:await job.stop(True)
  self.server.close();await self.server.wait_closed()
  asyncio.create_subprocess_exec=self.original_spawn;broker.BASE=self.oldbase;broker.group_empty=self.oldempty;client.SOCKET=self.oldsocket
  self.tmp.cleanup()
 async def launch(self):
  launcher=client.Launcher('starli.research.public-https.v1');assert await launcher.ready()
  _,node,heap,entry,_,_=client.PROFILES[launcher.profile_id]
  return await launcher.launch((node,'--max-old-space-size='+heap,entry),cwd=entry.rsplit('/',1)[0],env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},limits={})
 async def test_concurrent_wait_cancel_does_not_cancel_ack(self):
  p=await self.launch();assert await p.stdout.readline()==b'fixture-ready\n'
  a=asyncio.create_task(p.wait());b=asyncio.create_task(p.wait());a.cancel()
  await asyncio.gather(a,return_exceptions=True)
  await p.kill_group();assert await b==p.returncode and p.returncode is not None
  assert await p.wait()==p.returncode
 async def test_disconnect_then_stop_recovers_root_receipt(self):
  p=await self.launch();await p.stdout.readline();p.writer.close();await p.writer.wait_closed()
  with self.assertRaises(client.ProfileUnavailable):await p.wait()
  assert p.returncode is None
  await p.kill_group();assert await p.wait() is not None
 async def test_unreachable_never_fabricates_stop(self):
  p=await self.launch();await p.stdout.readline();p.writer.close();await p.writer.wait_closed()
  with self.assertRaises(client.ProfileUnavailable):await p.wait()
  client.SOCKET=str(self.root/'missing.sock')
  with self.assertRaises(OSError):await p.kill_group()
  assert p.returncode is None
if __name__=='__main__':unittest.main()
