"""Private SQLite-backed native build queue. QUEUED survives restart.
RUNNING at restart is UNCERTAIN and never automatically replayed.
The actual native session token stays in this private 0600 DB, never in receipts.
"""
import asyncio, json, os, sqlite3, time
class NativeBuildQueue:
    def __init__(self,path,execute):
        self.path=path;self.execute=execute;self.event=asyncio.Event();self.task=None
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS native_build_jobs (id TEXT PRIMARY KEY, admission TEXT NOT NULL, session_token TEXT NOT NULL, state TEXT NOT NULL, result TEXT, error TEXT, updated REAL NOT NULL)')
            db.execute("UPDATE native_build_jobs SET state='UNCERTAIN',error='HOST_RESTART_DURING_EXECUTION',updated=? WHERE state='RUNNING'",(time.time(),))
        with sqlite3.connect(path) as db:db.execute('CREATE TABLE IF NOT EXISTS native_terminal_quiescence (job_id TEXT PRIMARY KEY,result_hash TEXT NOT NULL,proof TEXT NOT NULL)')
        os.chmod(path,0o600)
    def enqueue(self,job_id,admission,token):
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR IGNORE INTO native_build_jobs VALUES(?,?,?,'QUEUED',NULL,NULL,?)",(job_id,json.dumps(admission),token,time.time()))
        self.event.set()
    async def start(self):
        if self.task is None:self.task=asyncio.create_task(self.run())
        self.event.set()
    async def close(self):
        if self.task:self.task.cancel()
        if self.task:
            try:await self.task
            except asyncio.CancelledError:pass
    async def run(self):
        while True:
            with sqlite3.connect(self.path) as db:
                row=db.execute("SELECT id,admission,session_token FROM native_build_jobs WHERE state='QUEUED' ORDER BY updated,id LIMIT 1").fetchone()
                if row:
                    claimed=db.execute("UPDATE native_build_jobs SET state='RUNNING',updated=? WHERE id=? AND state='QUEUED'",(time.time(),row[0])).rowcount
                else:claimed=0
            if not row or not claimed:
                self.event.clear()
                try:await asyncio.wait_for(self.event.wait(),1)
                except asyncio.TimeoutError:pass
                continue
            try:
                result=await self.execute(json.loads(row[1]),row[2])
                with sqlite3.connect(self.path) as db:db.execute("UPDATE native_build_jobs SET state=?,result=?,session_token='',updated=? WHERE id=?",('STOPPED' if result.get('stopped') and result.get('stop',{}).get('confirmedStopped') else 'SUCCEEDED',json.dumps(result),time.time(),row[0]))
            except asyncio.CancelledError:
                with sqlite3.connect(self.path) as db:db.execute("UPDATE native_build_jobs SET state='UNCERTAIN',error='HOST_CONSUMER_CANCELLED',session_token='',updated=? WHERE id=?",(time.time(),row[0]))
                raise
            except Exception:
                with sqlite3.connect(self.path) as db:db.execute("UPDATE native_build_jobs SET state='FAILED',error='NATIVE_EXECUTION_FAILED',session_token='',updated=? WHERE id=?",(time.time(),row[0]))
    def state(self,job_id):
        with sqlite3.connect(self.path) as db:
            row=db.execute('SELECT state,error FROM native_build_jobs WHERE id=?',(job_id,)).fetchone()
        return {'state':row[0],'error':row[1]} if row else None

    def reserve_queued_stop(self,job_id):
        with sqlite3.connect(self.path) as db:
            return db.execute("UPDATE native_build_jobs SET state='STOP_REQUESTED',updated=? WHERE id=? AND state='QUEUED'",(time.time(),job_id)).rowcount==1
    def confirm_stop(self,job_id,result):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE native_build_jobs SET state='STOPPED',result=?,session_token='',updated=? WHERE id=?",(json.dumps({'stopped':True,'stop':result}),time.time(),job_id))

    def confirmed_stop(self,job_id):
        with sqlite3.connect(self.path) as db:
            row=db.execute("SELECT result FROM native_build_jobs WHERE id=? AND state='STOPPED'",(job_id,)).fetchone()
        if not row or not row[0]:return None
        result=json.loads(row[0])
        return result.get('stop') if result.get('stopped') and result.get('stop',{}).get('confirmedStopped') is True else None

    def completed_result(self,job_id):
        with sqlite3.connect(self.path) as db:
            row=db.execute("SELECT admission,result FROM native_build_jobs WHERE id=? AND state='SUCCEEDED'",(job_id,)).fetchone()
        if not row or not row[1]:return None
        import hashlib
        return {'admission':json.loads(row[0]),'result':json.loads(row[1]),'resultHash':hashlib.sha256(row[1].encode()).hexdigest()}
    def record_quiescence(self,job_id,completed,proof):
        with sqlite3.connect(self.path) as db:
            row=db.execute("SELECT result FROM native_build_jobs WHERE id=? AND state='SUCCEEDED'",(job_id,)).fetchone()
            import hashlib
            if not row or hashlib.sha256(row[0].encode()).hexdigest()!=completed['resultHash']:return False
            db.execute("INSERT OR REPLACE INTO native_terminal_quiescence VALUES(?,?,?)",(job_id,completed['resultHash'],json.dumps(proof)))
        return True
    def confirmed_quiescence(self,job_id):
        completed=self.completed_result(job_id)
        if not completed:return None
        with sqlite3.connect(self.path) as db:row=db.execute('SELECT result_hash,proof FROM native_terminal_quiescence WHERE job_id=?',(job_id,)).fetchone()
        return json.loads(row[1]) if row and row[0]==completed['resultHash'] else None
