import asyncio,json,os,sqlite3,subprocess,sys,tempfile
from pathlib import Path
from native_build_queue import NativeBuildQueue
async def child(path):
    async def crash(admission,token):os._exit(0)
    q=NativeBuildQueue(path,crash)
    q.enqueue('first',{'requestId':'component-first'},'')
    q.enqueue('second',{'requestId':'component-second'},'')
    await q.start();await asyncio.sleep(2)
if len(sys.argv)>1 and sys.argv[1]=='--crash':
    asyncio.run(child(Path(sys.argv[2])));raise SystemExit(2)
out=Path(sys.argv[1]);root=Path(tempfile.mkdtemp(prefix='native-queue-component-'));path=root/'queue.sqlite'
try:
    r=subprocess.run([sys.executable,'-B',__file__,'--crash',str(path)],timeout=5)
    assert r.returncode==0
    async def restart():
        seen=[]
        async def execute(admission,token):seen.append(admission['requestId']);return {'done':True}
        q=NativeBuildQueue(path,execute)
        assert q.state('first')['state']=='UNCERTAIN'
        assert q.state('second')['state']=='QUEUED'
        await q.start()
        for _ in range(50):
            if q.state('second')['state']=='SUCCEEDED':break
            await asyncio.sleep(.02)
        assert q.state('second')['state']=='SUCCEEDED'
        assert seen==['component-second']
        await q.close()
        assert os.stat(path).st_mode&0o777==0o600
        return {'executionClass':'COMPONENT_QUEUE_PROCESS_CRASH_TEST','passed':True,'interruptedJob':'UNCERTAIN','unstartedJobAfterRestart':'SUCCEEDED','interruptedJobAutomaticallyReexecuted':False,'privateDatabaseMode':'0600','nativeIdentityAcceptance':False}
    result=asyncio.run(restart());out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
    import shutil;shutil.rmtree(root)
