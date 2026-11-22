"""R2 private host bridge and durable scope -> live cancellation socket resolver."""
import asyncio,hashlib,json,os,sqlite3,stat,signal
from pathlib import Path
class NativeNodeDispatcher:
    def __init__(self,root,*,node='/opt/starlidigital/node/bin/node',worker_hold_ms=0):
        self.root=str(Path(root).resolve());self.node=node;self.worker_hold_ms=worker_hold_ms
        if not self.root.startswith('/tmp/grokbot1-w1-'):raise ValueError('DISPOSABLE_NATIVE_ROOT_REQUIRED')
        if not isinstance(worker_hold_ms,int) or not 0<=worker_hold_ms<=5000:raise ValueError('INVALID_PRIVATE_WORKER_HOLD')
        self.control_requests=0;self.last_failure=None;self.terminal_inspections=0
    async def __call__(self,admission,revalidate):return await self.request(admission,revalidate)
    async def prepare(self,admission,revalidate):return await self.request(admission,revalidate,operation='prepare')
    async def progress(self,admission,revalidate,graph_id):
        result=await self.request(admission,revalidate,operation='progress',graph_id=graph_id)
        # Internal control inspection is authenticated too; it never controls cancellation state.
        live=await self.control(admission,revalidate,graph_id,action='inspect')
        if live.get('activeProcesses') is not None:result['liveNativeProcesses']=live['activeProcesses']
        return result
    async def stop(self,admission,revalidate,graph_id):return await self.control(admission,revalidate,graph_id,action='stop')
    async def completed_quiescence(self,admission,revalidate,graph_id,completed):
        from terminal_quiescence import verify_completed_quiescence
        if not revalidate():return None
        self.terminal_inspections+=1
        return await verify_completed_quiescence(self,admission,revalidate,graph_id,completed)
    async def stop_queued(self,admission,revalidate,graph_id):return await self.request(admission,revalidate,operation='stopQueued',graph_id=graph_id)
    async def control(self,admission,revalidate,graph_id,action):
        pending={'confirmedStopped':False,'disposition':'STOP_PENDING','detail':'Live execution identity or exit confirmation unavailable.'}
        if not revalidate():return pending
        dbpath=Path(self.root)/'native-worker-runtime/canonical.sqlite'
        if not dbpath.exists():return pending
        with sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True) as db:
            row=db.execute("SELECT payload FROM records WHERE collection='native-live-controls' AND id=?",(graph_id,)).fetchone()
        if not row:return pending
        record=json.loads(row[0])
        if record.get('phase')!='LIVE' or record.get('companyId')!=admission['companyId'] or record.get('requestId')!=admission['requestId'] or record.get('ownerId')!=admission['actor']['userId']:return pending
        base=Path(self.root)/'worker-controls';label=hashlib.sha256(graph_id.encode()).hexdigest()[:20]
        socketpath=base/(label+'.sock');cap=base/(label+'.cap')
        if record.get('socketPath')!=str(socketpath) or record.get('noncePath')!=str(cap):return pending
        try:
            for item in (socketpath,cap):
                info=item.lstat()
                if info.st_uid!=os.geteuid() or info.st_mode&0o077:return pending
            if not stat.S_ISSOCK(socketpath.lstat().st_mode) or not stat.S_ISREG(cap.lstat().st_mode):return pending
            proc=Path('/proc')/str(record['nodePid'])/'stat';raw=proc.read_text()
            start=raw[raw.rfind(')')+2:].split()[19]
            if start!=str(record['startTicks']):return pending
            nonce=cap.read_text()
            if hashlib.sha256(nonce.encode()).hexdigest()!=record.get('nonceHash'):return pending
            reader,writer=await asyncio.wait_for(asyncio.open_unix_connection(str(socketpath),limit=64*1024),1)
            self.control_requests+=1
            writer.write((json.dumps({'action':action,'graphId':graph_id,'nonce':nonce})+'\n').encode());await writer.drain()
            try:
                data=await asyncio.wait_for(reader.readline(),4)
                result=json.loads(data)
                if not revalidate():return pending
                return result
            finally:writer.close();await writer.wait_closed()
        except (OSError,ValueError,KeyError,asyncio.TimeoutError):return pending
    async def request(self,admission,revalidate,operation='execute',graph_id=None):
        script=Path(__file__).with_name('native-worker-cli.ts')
        proc=await asyncio.create_subprocess_exec(self.node,'--max-old-space-size=256','--import','tsx',str(script),
            cwd='/srv/starlidigital/mcp-workspace',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,limit=256*1024,start_new_session=True,env={"PATH":"/usr/bin:/bin","TZ":"UTC"})
        try:
            raw=(Path('/proc')/str(proc.pid)/'stat').read_text()
            executor_start=raw[raw.rfind(')')+2:].split()[19]
        except OSError:executor_start=None
        async def interact():
            proc.stdin.write((json.dumps({'root':self.root,'admission':admission,'operation':operation,'graphId':graph_id,'workerControl':{'holdMs':self.worker_hold_ms}})+'\n').encode());await proc.stdin.drain()
            result=None
            while True:
                line=await proc.stdout.readline()
                if not line:break
                event=json.loads(line)
                if event.get('kind')=='authorize':
                    allowed=revalidate(event.get('candidate'))
                    proc.stdin.write((json.dumps({'allow':allowed})+'\n').encode());await proc.stdin.drain()
                elif event.get('kind')=='result':result=event['result'];proc.stdin.close();break
                else:raise RuntimeError('UNRECOGNIZED_NATIVE_WORKER_IPC')
            await proc.wait()
            if proc.returncode or result is None:
                diagnostic=(await proc.stderr.read(16384)).decode(errors='replace')
                destination=Path(self.root)/"native-worker-runtime"/"last-error.txt"
                destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                destination.write_text(diagnostic);destination.chmod(0o600)
                self.last_failure={'operation':operation,'exit':proc.returncode,'nativeCompletionFence':('NATIVE_COMPLETION_REQUIRED' in diagnostic or 'NATIVE_GRAPH_STOPPED' in diagnostic)}
                raise RuntimeError('NATIVE_WORKER_PROCESS_FAILED:'+str(proc.returncode))
            if operation=='execute':
                result['_executorExit']={'pid':proc.pid,'startTicks':executor_start,'exitCode':proc.returncode,'waitConfirmed':True,'operation':'execute','graphId':result.get('graphId'),'companyId':admission['companyId'],'requestId':admission['requestId']}
            return result
        try:return await asyncio.wait_for(interact(),240)
        finally:
            if proc.returncode is None:
                try:os.killpg(proc.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:await asyncio.wait_for(proc.wait(),3)
                except asyncio.TimeoutError:
                    try:os.killpg(proc.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    await proc.wait()
            await proc.wait()
