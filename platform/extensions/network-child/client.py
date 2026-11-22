"""Trusted native-only client. No credentials/configuration accepted by launcher."""
import asyncio,base64,json
SOCKET='/run/starli-network-child/broker.sock'
PROFILES={
 'starli.research.public-https.v1':('search-v1','/usr/bin/node','96','/opt/starlidigital/search-gateway/releases/research-v2-r1/gateway/research-cli-v2.mjs',16384,131072),
 'starli.account-mcp.public-https.v1':('mcp-v1','/opt/starlidigital/node/bin/node','128','/opt/starlidigital/account-mcp/releases/profile-v1/remote/service.mjs',262144,1500000)}
class ProfileUnavailable(RuntimeError):pass
async def request(value):
 reader,writer=await asyncio.open_unix_connection(SOCKET,limit=16384)
 try:
  writer.write(json.dumps(value).encode()+b'\n');await writer.drain()
  return json.loads(await asyncio.wait_for(reader.readline(),5))
 finally:
  writer.close();await writer.wait_closed()
class Input:
 def __init__(self,process):self.process=process;self.pending=bytearray();self.total=0;self.closed=False
 def write(self,data):
  if self.closed:raise ProfileUnavailable('STDIN_CLOSED')
  self.total+=len(data)
  if self.total>self.process.input_limit:raise ProfileUnavailable('INPUT_LIMIT')
  self.pending.extend(data)
 async def drain(self):
  while self.pending:
   data=bytes(self.pending[:8192]);del self.pending[:8192]
   self.process.writer.write(json.dumps({'op':'stdin','data':base64.b64encode(data).decode()}).encode()+b'\n')
   await self.process.writer.drain()
 def close(self):
  if self.closed:return
  if self.pending:raise ProfileUnavailable('STDIN_NOT_DRAINED')
  self.closed=True;self.process.writer.write(b'{"op":"eof"}\n')
 async def wait_closed(self):await self.process.writer.drain()
class Process:
 def __init__(self,reader,writer,header,input_limit,output_limit):
  self.reader=reader;self.writer=writer;self.token=header['token'];self.pid=header['pid'];self.returncode=None
  self.input_limit=input_limit;self.output_limit=output_limit;self.stdin=Input(self)
  self.stdout=asyncio.StreamReader(limit=output_limit+1);self.stderr=None
  self.done=asyncio.get_running_loop().create_future();self.reader_task=asyncio.create_task(self.read())
 async def read(self):
  size=0
  try:
   while line:=await self.reader.readline():
    value=json.loads(line)
    if value.get('type')=='stdout':
     data=base64.b64decode(value['data'],validate=True);size+=len(data)
     if size>self.output_limit:raise ProfileUnavailable('OUTPUT_LIMIT')
     self.stdout.feed_data(data)
    elif value.get('type')=='finished' and value.get('physicalStopAcknowledged')is True:
     self.returncode=value['returncode'];self.stdout.feed_eof()
     if not self.done.done():self.done.set_result(self.returncode)
     return
    else:raise ProfileUnavailable('PROFILE_PROTOCOL')
   raise ProfileUnavailable('PHYSICAL_STOP_UNKNOWN')
  except BaseException as e:
   if self.done.done() and self.returncode is not None:return
   self.stdout.set_exception(e)
   if not self.done.done():self.done.set_exception(e)
  finally:
   self.writer.close()
   try:await self.writer.wait_closed()
   except (ConnectionError,OSError):pass
 async def wait(self):return await asyncio.shield(self.done)
 async def communicate(self,data=None):
  if data is not None:self.stdin.write(data);await self.stdin.drain()
  self.stdin.close();out=await self.stdout.read(self.output_limit+1)
  # StreamReader.read(n) can return a partial frame; accumulate only to hard cap.
  while len(out)<=self.output_limit:
   chunk=await self.stdout.read(self.output_limit+1-len(out))
   if not chunk:break
   out+=chunk
  if len(out)>self.output_limit:await self.kill_group();raise ProfileUnavailable('OUTPUT_LIMIT')
  await self.wait();return out,None
 async def stop(self,force):
  if self.returncode is not None:return self.returncode
  result=await request({'op':'stop','token':self.token,'force':force})
  if result.get('physicalStopAcknowledged')is not True:raise ProfileUnavailable('PHYSICAL_STOP_UNKNOWN')
  # Root receipt is authoritative even if original connection is being drained.
  self.returncode=result['returncode']
  if self.done.done():
   if not self.done.cancelled():self.done.exception()
   self.done=asyncio.get_running_loop().create_future()
  self.done.set_result(self.returncode)
  self.stdout.feed_eof()
  if not self.reader_task.done():
   self.reader_task.cancel();await asyncio.gather(self.reader_task,return_exceptions=True)
  return self.returncode
 async def terminate_group(self):return await self.stop(False)
 async def kill_group(self):return await self.stop(True)
class Launcher:
 def __init__(self,profile_id):
  if profile_id not in PROFILES:raise ValueError('FIXED_PROFILE_REQUIRED')
  self.profile_id=profile_id;self.available=False
 async def ready(self):
  try:self.available=(await request({'op':'ready','profile':PROFILES[self.profile_id][0]})).get('ready')is True
  except (OSError,ValueError,asyncio.TimeoutError):self.available=False
  return self.available
 async def prepare(self):
  if not await self.ready():raise ProfileUnavailable('PROFILE_UNAVAILABLE')
  return {'env':{'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'}}
 async def launch(self,argv,*,cwd,env,limits):
  profile,node,heap,entry,input_limit,output_limit=PROFILES[self.profile_id]
  if tuple(argv)!=(node,'--max-old-space-size='+heap,entry) or cwd!=entry.rsplit('/',1)[0]:raise ProfileUnavailable('FIXED_COMMAND_REQUIRED')
  if not isinstance(env,dict) or set(env)-{'PATH','HOME','LANG'} or env.get('PATH')!='/usr/bin:/bin' or env.get('LANG')!='C.UTF-8' or env.get('HOME','/nonexistent')!='/nonexistent':raise ProfileUnavailable('CLEAN_ENV_REQUIRED')
  if not self.available or not await self.ready():raise ProfileUnavailable('PROFILE_UNAVAILABLE')
  reader,writer=await asyncio.open_unix_connection(SOCKET,limit=16384)
  try:
   writer.write(json.dumps({'op':'launch','profile':profile}).encode()+b'\n');await writer.drain()
   header=json.loads(await asyncio.wait_for(reader.readline(),5))
   if header.get('type')!='launched':raise ProfileUnavailable('PROFILE_UNAVAILABLE')
   return Process(reader,writer,header,input_limit,output_limit)
  except BaseException:
   writer.close();await writer.wait_closed();raise
