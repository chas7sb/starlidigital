"""Durable jobs/schedules; host starts one or more supervised worker loops.

No process-local locks or silent retry of external effects. Database claims and
operation receipts fence concurrent workers. A restart invokes recover once.
"""
import asyncio
import json
from .common import need,identifier,encoded,public_error,envelope,exact
from .notifications import deliver

class Worker:
    def __init__(self,gateway):self.gateway=gateway;self.store=gateway.store
    async def run_once(self):
        with self.store.db() as db:
            companies=[r[0] for r in db.execute("SELECT DISTINCT company FROM sa_approvals WHERE state='PENDING' AND expires<=?",(self.gateway.clock(),))]
            for company in companies:self.gateway._expire(db,company)
            row=db.execute("SELECT j.*,e.workflow FROM sa_jobs j JOIN sa_executions e ON e.id=j.execution AND e.company=j.company WHERE j.state='PENDING' AND j.next<=? ORDER BY j.next,j.id LIMIT 1",(self.gateway.clock(),)).fetchone()
            if row:db.execute("UPDATE sa_jobs SET state='CLAIMED' WHERE id=? AND company=? AND state='PENDING'",(row['id'],row['company']))
        if row:
            try:
                ctx=self.gateway.worker_context(row['workflow'])
                await self.gateway.advance(ctx,row['execution'])
            except Exception as error:
                with self.store.db() as db:
                    db.execute("UPDATE sa_jobs SET state='DEAD',error=? WHERE id=? AND company=? AND state NOT IN ('DONE','DEAD')",(public_error(error),row['id'],row['company']))
                    db.execute("UPDATE sa_executions SET state='FAILED',error=?,updated=? WHERE id=? AND company=? AND state IN ('QUEUED','WAITING_FOR_HUMAN')",(public_error(error),self.gateway.clock(),row['execution'],row['company']))
                    self.gateway.feedback.cleanup(db,row['company'],row['execution'])
            return True
        with self.store.db(readonly=True) as db:
            notification=db.execute("SELECT n.id,a.workflow,n.company FROM sa_notifications n JOIN sa_approvals a ON a.id=n.approval AND a.company=n.company WHERE n.state='PENDING' ORDER BY n.created,n.id LIMIT 1").fetchone()
        if notification:
            try:await deliver(self.gateway,self.gateway.worker_context(notification['workflow']),notification['id'])
            except Exception as error:
                with self.store.db() as db:
                    # Persist unmet delivery prerequisites instead of a hot loop.
                    db.execute("UPDATE sa_notifications SET state='BLOCKED' WHERE id=? AND company=? AND state='PENDING'",(notification['id'],notification['company']))
            return True
        return await self.fire_schedule()

    def schedule(self,ctx,workflow,form):
        exact(form,('intervalSeconds','firstRunAt','input'))
        need(type(form['intervalSeconds'])is int and 300<=form['intervalSeconds']<=2592000,'SCHEDULE_INTERVAL_INVALID',422)
        need(type(form['firstRunAt'])in (int,float) and self.gateway.clock()<=form['firstRunAt']<=self.gateway.clock()+2592000,'SCHEDULE_TIME_INVALID',422)
        # Exact execution input is validated again by ingest, and every scheduled
        # request still requires a new per-execution exact human decision.
        from .common import text
        internal_input=type(form['input'])is dict and set(form['input'])=={'label'}
        exact(form['input'],('label',) if internal_input else ('orderId','amount','currency','paymentProvider','store'))
        for value in form['input'].values():text(value,200)
        ident=identifier()
        with self.gateway.access(ctx,'integrations.install') as db:
            row=self.gateway.row(db,ctx,'sa_workflows',workflow);need(row['state']=='ACTIVE','WORKFLOW_NOT_ACTIVE',409)
            definition=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(workflow,row['version'],ctx.company)).fetchone()[0])
            need(internal_input==(definition['kind']=='internal_approval_test'),'SCHEDULE_INPUT_KIND_MISMATCH',422)
            need(db.execute("SELECT count(*) FROM sa_schedules WHERE company=? AND state='ACTIVE'",(ctx.company,)).fetchone()[0]<30,'SCHEDULE_QUOTA_EXCEEDED',429)
            db.execute('INSERT INTO sa_schedules VALUES(?,?,?,?,?,?,?,?)',(ident,ctx.company,workflow,row['version'],form['firstRunAt'],form['intervalSeconds'],'ACTIVE',1))
            db.execute('INSERT INTO sa_schedule_events VALUES(?,?,?)',(ident,ctx.company,encoded(form['input'])))
            self.gateway.audit(db,ctx,'schedule.created',ident)
        return envelope(ctx.company,id=ident,workflowId=workflow,workflowVersion=row['version'],revision=1,status='ACTIVE',nextRunAt=form['firstRunAt'])

    async def fire_schedule(self):
        with self.store.db() as db:
            row=db.execute("SELECT s.*,i.input FROM sa_schedules s JOIN sa_schedule_events i ON i.schedule=s.id AND i.company=s.company JOIN sa_workflows w ON w.id=s.workflow AND w.company=s.company WHERE s.state='ACTIVE' AND w.state='ACTIVE' AND s.version=w.version AND s.next<=? ORDER BY s.next,s.id LIMIT 1",(self.gateway.clock(),)).fetchone()
            if row:
                db.execute('INSERT OR IGNORE INTO sa_scheduled_fires VALUES(?,?,?,?,?,?,?,?)',(identifier(),row['company'],row['workflow'],row['version'],row['id'],row['next'],row['input'],'PENDING'))
                # Skip missed intervals after downtime rather than refund storms.
                next_at=max(row['next']+row['interval'],self.gateway.clock()+row['interval'])
                db.execute('UPDATE sa_schedules SET next=? WHERE id=? AND company=?',(next_at,row['id'],row['company']))
            fire=db.execute("SELECT * FROM sa_scheduled_fires WHERE state='PENDING' ORDER BY slot,id LIMIT 1").fetchone()
        if not fire:return False
        try:
            ctx=self.gateway.worker_context(fire['workflow']);need(ctx.workflow_version==fire['version'],'SCHEDULE_VERSION_CHANGED')
            await self.gateway.ingest(ctx,fire['workflow'],'schedule:'+fire['schedule']+':'+str(fire['slot']),json.loads(fire['input']))
            state='DONE'
        except Exception:state='BLOCKED'
        with self.store.db() as db:db.execute('UPDATE sa_scheduled_fires SET state=? WHERE id=? AND company=?',(state,fire['id'],fire['company']))
        return True

    async def run(self,stop):
        while not stop.is_set():
            worked=await self.run_once()
            if not worked:
                try:await asyncio.wait_for(stop.wait(),timeout=1)
                except TimeoutError:pass
