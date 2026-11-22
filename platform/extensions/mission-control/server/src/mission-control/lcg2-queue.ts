import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

type TaskState='QUEUED'|'RUNNING'|'DONE'|'FAILED'|'UNKNOWN'|'CANCELLED';
type EffectMode='PURE'|'EXTERNAL';
type TaskRow={id:string;tenant:string;request_key:string;fingerprint:string;title:string;priority:number;assigned_worker:string|null;state:TaskState;effect_mode:EffectMode;resources_json:string;fence:number;lease_worker:string|null;lease_until:number|null;created_at:number;updated_at:number;result_json:string|null};
type LockRow={resource:string;task_id:string;fence:number};
type NewTask={tenant:string;requestKey:string;title:string;priority?:number;assignedWorker?:string;dependencies?:string[];resources?:string[];effectMode?:EffectMode};
export type WorkerLease={taskId:string;tenant:string;worker:string;fence:number;leaseUntil:number;title:string;priority:number;effectMode:EffectMode;resources:string[]};
export type Lcg2SignedStopGrant={issuedAtMs:number;nonce:string;signature:string};
const actor=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
function valid(s:string){if(typeof s!=='string'||!actor.test(s))throw Error('MC_INVALID_ID');return s;}
function resource(s:string){
 if(typeof s!=='string'||s.length>240||s.startsWith('/')||s.includes('\\')||s.includes('//')||s.split('/').some(x=>!x||x==='.'||x==='..'||!actor.test(x)))throw Error('MC_INVALID_RESOURCE');
 return s;
}
function uniqueSorted(xs:string[],fn:(s:string)=>string){return [...new Set(xs.map(fn))].sort();}
function conflict(a:string,b:string){return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');}
function integer(n:number,min:number,max:number){if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('MC_INVALID_NUMBER');return n;}
function checkedLeaseDeadline(now:number,leaseMs:number){
 integer(now,0,Number.MAX_SAFE_INTEGER);
 if(now>Number.MAX_SAFE_INTEGER-leaseMs)throw Error('MC_LEASE_TIME_OVERFLOW');
 return now+leaseMs;
}
function nextFence(fence:number){
 integer(fence,0,Number.MAX_SAFE_INTEGER);
 if(fence===Number.MAX_SAFE_INTEGER)throw Error('MC_FENCE_EXHAUSTED');
 return fence+1;
}
function json(x:unknown){return JSON.stringify(x);}
const ERROR_STALE='MC_STALE_LEASE';
export class Lcg2MissionControlQueue {
 private readonly db:DatabaseSync;
 constructor(path:string,private readonly now:()=>number=Date.now,private readonly stopVerificationKey?:Buffer){
  this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=4000; PRAGMA foreign_keys=ON;');
  this.db.exec(`
CREATE TABLE IF NOT EXISTS mc_tasks (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL, request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
 title TEXT NOT NULL,priority INTEGER NOT NULL,assigned_worker TEXT,state TEXT NOT NULL,
 effect_mode TEXT NOT NULL,resources_json TEXT NOT NULL,fence INTEGER NOT NULL DEFAULT 0,
 lease_worker TEXT,lease_until INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,result_json TEXT,
 UNIQUE(tenant,request_key));
CREATE TABLE IF NOT EXISTS mc_deps (
 tenant TEXT NOT NULL,task_id TEXT NOT NULL,depends_on TEXT NOT NULL,
 PRIMARY KEY(task_id,depends_on), FOREIGN KEY(task_id) REFERENCES mc_tasks(id),
 FOREIGN KEY(depends_on) REFERENCES mc_tasks(id));
CREATE TABLE IF NOT EXISTS mc_locks (
 resource TEXT PRIMARY KEY,task_id TEXT NOT NULL,fence INTEGER NOT NULL,
 FOREIGN KEY(task_id) REFERENCES mc_tasks(id));
CREATE TABLE IF NOT EXISTS mc_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,task_id TEXT NOT NULL,
 kind TEXT NOT NULL,actor TEXT NOT NULL,detail TEXT NOT NULL,at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mc_task_coordination (
 task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
 progress INTEGER NOT NULL DEFAULT 0, blocker TEXT,
 FOREIGN KEY(task_id) REFERENCES mc_tasks(id));
CREATE TABLE IF NOT EXISTS mc_tenant_stop (
 tenant TEXT PRIMARY KEY,operator TEXT NOT NULL,reason TEXT NOT NULL,at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mc_tasks_claim ON mc_tasks(tenant,state,priority,created_at);
CREATE INDEX IF NOT EXISTS mc_deps_lookup ON mc_deps(tenant,task_id);
CREATE INDEX IF NOT EXISTS mc_events_cursor ON mc_events(tenant,seq);
`);
 }
 close(){this.db.close();}
 private tx<T>(fn:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=fn();this.db.exec('COMMIT');return result;}
  catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 private stopped(tenant:string){
  return !!this.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(tenant);
 }
 // A trusted authenticated operator service must issue this scoped, short-lived HMAC grant.
 // This store verifies integrity/freshness; authorization of the signer is a separate ingress gate.
 private verifyStopGrant(tenant:string,operator:string,reason:string,grant?:Lcg2SignedStopGrant){
  const key=this.stopVerificationKey;
  if(!key||key.length<32||!grant||typeof grant!=='object')throw Error('MC_STOP_AUTH_REQUIRED');
  valid(grant.nonce);
  integer(grant.issuedAtMs,0,Number.MAX_SAFE_INTEGER);
  const now=integer(this.now(),0,Number.MAX_SAFE_INTEGER);
  if(grant.issuedAtMs>now||now-grant.issuedAtMs>300_000)throw Error('MC_STOP_AUTH_EXPIRED');
  if(typeof grant.signature!=='string'||!/^[0-9a-f]{64}$/.test(grant.signature))throw Error('MC_STOP_AUTH_REQUIRED');
  const canonical=JSON.stringify(['LCG2_STOP_V1',tenant,operator,reason,grant.issuedAtMs,grant.nonce]);
  const expected=createHmac('sha256',key).update(canonical).digest();
  if(!timingSafeEqual(expected,Buffer.from(grant.signature,'hex')))throw Error('MC_STOP_AUTH_REQUIRED');
 }
 // Durable, one-way emergency STOP. No automatic resume; uncertain effects retain locks.
 stopTenant(tenant:string,operator:string,reason:string,grant?:Lcg2SignedStopGrant){
  valid(tenant);valid(operator);
  if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000)throw Error('MC_INVALID_REASON');
  this.verifyStopGrant(tenant,operator,reason,grant);
  return this.tx(()=>{
   if(this.stopped(tenant))return {stopped:true,reused:true};
   this.db.prepare('INSERT INTO mc_tenant_stop(tenant,operator,reason,at_ms) VALUES(?,?,?,?)')
    .run(tenant,operator,reason,this.now());
   const running=this.db.prepare("SELECT * FROM mc_tasks WHERE tenant=? AND state='RUNNING'")
    .all(tenant) as unknown as TaskRow[];
   for(const row of running){
    const uncertain=row.effect_mode==='EXTERNAL',state=uncertain?'UNKNOWN':'QUEUED';
    this.db.prepare('UPDATE mc_tasks SET state=?,lease_worker=NULL,lease_until=NULL,updated_at=? WHERE id=?')
     .run(state,this.now(),row.id);
    if(!uncertain)this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(row.id,row.fence);
    this.event(tenant,row.id,uncertain?'TENANT_STOP_UNKNOWN':'TENANT_STOP_QUEUED',operator,{fence:row.fence});
   }
   return {stopped:true,reused:false};
  });
 }
 isStopped(tenant:string){valid(tenant);return this.stopped(tenant);}
 private row(id:string,tenant:string):TaskRow|undefined{
  return this.db.prepare('SELECT * FROM mc_tasks WHERE id=? AND tenant=?').get(id,tenant) as unknown as TaskRow|undefined;
 }
 private event(tenant:string,taskId:string,kind:string,by:string,detail:unknown={}){
  this.db.prepare('INSERT INTO mc_events(tenant,task_id,kind,actor,detail,at_ms) VALUES(?,?,?,?,?,?)')
   .run(tenant,taskId,kind,by,json(detail),this.now());
 }
 create(x:NewTask){
  valid(x.tenant);valid(x.requestKey);
  const title=x.title?.trim();
  if(!title||title.length>240)throw Error('MC_INVALID_TITLE');
  const deps=uniqueSorted(x.dependencies??[],valid);
  const locks=uniqueSorted(x.resources??[],resource);
  const priority=integer(x.priority??0,-100,100);
  const mode=x.effectMode??'EXTERNAL';
  if(mode!=='EXTERNAL'&&mode!=='PURE')throw Error('MC_INVALID_EFFECT_MODE');
  const assigned=x.assignedWorker?valid(x.assignedWorker):null;
  const fingerprint=createHash('sha256').update(json([title,priority,assigned,deps,locks,mode])).digest('hex');
  return this.tx(()=>{
   if(this.stopped(x.tenant))throw Error('MC_TENANT_STOPPED');
   const duplicate=this.db.prepare('SELECT id,fingerprint FROM mc_tasks WHERE tenant=? AND request_key=?')
    .get(x.tenant,x.requestKey) as {id:string;fingerprint:string}|undefined;
   if(duplicate){
    if(duplicate.fingerprint!==fingerprint)throw Error('MC_IDEMPOTENCY_CONFLICT');
    return {taskId:duplicate.id,reused:true};
   }
   for(const dep of deps){
    const row=this.row(dep,x.tenant);
    if(!row)throw Error('MC_DEPENDENCY_MISSING_OR_FOREIGN');
   }
   const taskId=randomUUID(),time=this.now();
   this.db.prepare(`INSERT INTO mc_tasks(id,tenant,request_key,fingerprint,title,priority,assigned_worker,state,effect_mode,resources_json,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId,x.tenant,x.requestKey,fingerprint,title,priority,assigned,'QUEUED',mode,json(locks),time,time);
   const add=this.db.prepare('INSERT INTO mc_deps(tenant,task_id,depends_on) VALUES(?,?,?)');
   for(const dep of deps)add.run(x.tenant,taskId,dep);
   this.db.prepare('INSERT INTO mc_task_coordination(task_id,revision,progress) VALUES(?,0,0)').run(taskId);
   this.event(x.tenant,taskId,'TASK_CREATED','boss',{priority,assigned,dependencies:deps,resources:locks,mode});
   return {taskId,reused:false};
  });
 }
 assign(tenant:string,taskId:string,worker:string){
  valid(tenant);valid(taskId);valid(worker);
  return this.tx(()=>{
   if(this.stopped(tenant))throw Error('MC_TENANT_STOPPED');
   const row=this.row(taskId,tenant);
   if(!row||row.state!=='QUEUED')throw Error('MC_TASK_NOT_ASSIGNABLE');
   const c=this.coordination(row);
   if(c.revision===Number.MAX_SAFE_INTEGER)throw Error('MC_TASK_REVISION_EXHAUSTED');
   this.db.prepare('UPDATE mc_tasks SET assigned_worker=?,updated_at=? WHERE id=?').run(worker,this.now(),taskId);
   this.db.prepare('UPDATE mc_task_coordination SET revision=? WHERE task_id=?').run(c.revision+1,taskId);
   this.event(tenant,taskId,'TASK_ASSIGNED','boss',{worker,revision:c.revision+1});
   return true;
  });
 }

 // Durable task-control revisions are independent of browser command delivery receipts.
 // All mutating operations below serialize with tenant STOP in the same BEGIN IMMEDIATE WAL txn.
 private coordination(task:TaskRow){
  this.db.prepare('INSERT OR IGNORE INTO mc_task_coordination(task_id,revision,progress) VALUES(?,0,0)').run(task.id);
  return this.db.prepare('SELECT revision,progress,blocker FROM mc_task_coordination WHERE task_id=?')
   .get(task.id) as {revision:number;progress:number;blocker:string|null};
 }
 private assertRevision(task:TaskRow,expectedRevision:number){
  integer(expectedRevision,0,Number.MAX_SAFE_INTEGER);
  const current=this.coordination(task);
  if(current.revision!==expectedRevision)throw Error('MC_TASK_REVISION_CONFLICT');
  if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('MC_TASK_REVISION_EXHAUSTED');
  return current;
 }
 getTaskStatus(tenant:string,taskId:string){
  const task=this.get(tenant,taskId);
  if(!task)return null;
  const c=this.db.prepare('SELECT revision,progress,blocker FROM mc_task_coordination WHERE task_id=?')
   .get(taskId) as {revision:number;progress:number;blocker:string|null}|undefined;
  return {...task,revision:c?.revision??0,progress:c?.progress??0,
   blocker:c?.blocker??null,tenantStopped:this.isStopped(tenant)};
 }
 assignTask(tenant:string,taskId:string,worker:string,expectedRevision:number){
  valid(tenant);valid(taskId);valid(worker);
  return this.tx(()=>{
   if(this.stopped(tenant))throw Error('MC_TENANT_STOPPED');
   const task=this.row(taskId,tenant);
   if(!task||task.state!=='QUEUED')throw Error('MC_TASK_NOT_ASSIGNABLE');
   const c=this.assertRevision(task,expectedRevision);
   this.db.prepare('UPDATE mc_tasks SET assigned_worker=?,updated_at=? WHERE id=?').run(worker,this.now(),taskId);
   this.db.prepare('UPDATE mc_task_coordination SET revision=? WHERE task_id=?')
    .run(c.revision+1,taskId);
   this.event(tenant,taskId,'TASK_ASSIGNED_CAS','boss',{worker,revision:c.revision+1});
   return {taskId,assignedWorker:worker,revision:c.revision+1};
  });
 }
 reportProgress(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,
  expectedRevision:number,progress:number,note:string){
  integer(progress,0,100);
  if(typeof note!=='string'||!note.trim()||note.length>2000)throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{
   const task=this.active(lease),c=this.assertRevision(task,expectedRevision);
   if(progress<c.progress)throw Error('MC_PROGRESS_REGRESSION');
   this.db.prepare('UPDATE mc_task_coordination SET revision=?,progress=? WHERE task_id=?')
    .run(c.revision+1,progress,task.id);
   this.event(task.tenant,task.id,'TASK_PROGRESS',lease.worker,
    {progress,note,revision:c.revision+1,fence:lease.fence});
   return {taskId:task.id,revision:c.revision+1,progress};
  });
 }
 setBlocker(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,
  expectedRevision:number,reason:string){
  if(typeof reason!=='string'||reason.trim().length<5||reason.length>2000)throw Error('MC_INVALID_REASON');
  return this.tx(()=>{
   const task=this.active(lease),c=this.assertRevision(task,expectedRevision);
   this.db.prepare('UPDATE mc_task_coordination SET revision=?,blocker=? WHERE task_id=?')
    .run(c.revision+1,reason,task.id);
   this.event(task.tenant,task.id,'TASK_BLOCKED',lease.worker,
    {reason,revision:c.revision+1,fence:lease.fence});
   return {taskId:task.id,revision:c.revision+1,blocker:reason};
  });
 }
 clearBlocker(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,
  expectedRevision:number,note:string){
  if(typeof note!=='string'||!note.trim()||note.length>2000)throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{
   const task=this.active(lease),c=this.assertRevision(task,expectedRevision);
   if(c.blocker===null)throw Error('MC_TASK_NOT_BLOCKED');
   this.db.prepare('UPDATE mc_task_coordination SET revision=?,blocker=NULL WHERE task_id=?')
    .run(c.revision+1,task.id);
   this.event(task.tenant,task.id,'TASK_UNBLOCKED',lease.worker,
    {note,revision:c.revision+1,fence:lease.fence});
   return {taskId:task.id,revision:c.revision+1,blocker:null};
  });
 }
 handoffTask(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,
  expectedRevision:number,nextWorker:string,note:string){
  valid(nextWorker);
  if(typeof note!=='string'||note.trim().length<5||note.length>2000)throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{
   const task=this.active(lease),c=this.assertRevision(task,expectedRevision);
   const safe=task.effect_mode==='PURE',state=safe?'QUEUED':'UNKNOWN';
   this.db.prepare('UPDATE mc_tasks SET state=?,assigned_worker=?,lease_worker=NULL,lease_until=NULL,updated_at=? WHERE id=?')
    .run(state,nextWorker,this.now(),task.id);
   if(safe)this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(task.id,lease.fence);
   this.db.prepare('UPDATE mc_task_coordination SET revision=? WHERE task_id=?')
    .run(c.revision+1,task.id);
   this.event(task.tenant,task.id,safe?'SAFE_HANDOFF_CAS':'UNCERTAIN_HANDOFF_CAS',
    lease.worker,{nextWorker,note,fence:lease.fence,revision:c.revision+1});
   return {taskId:task.id,state,nextWorker,revision:c.revision+1};
  });
 }
 private recoverInTx(tenant:string){
  const expired=this.db.prepare("SELECT * FROM mc_tasks WHERE tenant=? AND state='RUNNING' AND lease_until<=?")
   .all(tenant,this.now()) as unknown as TaskRow[];
  for(const row of expired){
   const state=row.effect_mode==='EXTERNAL'?'UNKNOWN':'QUEUED';
   this.db.prepare('UPDATE mc_tasks SET state=?,lease_worker=NULL,lease_until=NULL,updated_at=? WHERE id=?')
    .run(state,this.now(),row.id);
   if(state==='QUEUED')this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(row.id,row.fence);
   // UNKNOWN must keep file locks: unknown external effects cannot be safely replayed.
   this.event(tenant,row.id,state==='UNKNOWN'?'LEASE_EXPIRED_UNCERTAIN':'LEASE_EXPIRED_REQUEUE','system',{fence:row.fence});
  }
  return expired.length;
 }
 recover(tenant:string){valid(tenant);return this.tx(()=>this.recoverInTx(tenant));}
 claim(tenant:string,worker:string,leaseMs=30_000):WorkerLease|null{
  valid(tenant);valid(worker);integer(leaseMs,1_000,600_000);
  return this.tx(()=>{
   if(this.stopped(tenant))throw Error('MC_TENANT_STOPPED');
   this.recoverInTx(tenant);
   const candidates=this.db.prepare(`SELECT t.* FROM mc_tasks t
 WHERE t.tenant=? AND t.state='QUEUED' AND (t.assigned_worker IS NULL OR t.assigned_worker=?)
 AND NOT EXISTS(SELECT 1 FROM mc_deps d JOIN mc_tasks p ON p.id=d.depends_on
 WHERE d.task_id=t.id AND p.state!='DONE')
 ORDER BY t.priority DESC,t.created_at ASC,t.id ASC`).all(tenant,worker) as unknown as TaskRow[];
   const held=this.db.prepare('SELECT resource,task_id,fence FROM mc_locks').all() as unknown as LockRow[];
   for(const task of candidates){
    const resources=JSON.parse(task.resources_json) as string[];
    if(resources.some(r=>held.some(lock=>conflict(r,lock.resource))))continue;
    const fence=nextFence(task.fence),leaseUntil=checkedLeaseDeadline(this.now(),leaseMs);
    this.db.prepare("UPDATE mc_tasks SET state='RUNNING',fence=?,lease_worker=?,lease_until=?,updated_at=? WHERE id=? AND state='QUEUED'")
     .run(fence,worker,leaseUntil,this.now(),task.id);
    const addLock=this.db.prepare('INSERT INTO mc_locks(resource,task_id,fence) VALUES(?,?,?)');
    for(const r of resources)addLock.run(r,task.id,fence);
    this.event(tenant,task.id,'WORKER_STARTED',worker,{fence,leaseUntil});
    return {taskId:task.id,tenant,worker,fence,leaseUntil,title:task.title,priority:task.priority,effectMode:task.effect_mode,resources};
   }
   return null;
  });
 }
 private active(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>){
  valid(lease.tenant);valid(lease.taskId);valid(lease.worker);
  if(this.stopped(lease.tenant))throw Error('MC_TENANT_STOPPED');
  const task=this.row(lease.taskId,lease.tenant);
  if(!task||task.state!=='RUNNING'||task.lease_worker!==lease.worker||task.fence!==lease.fence||
   task.lease_until===null||task.lease_until<=this.now())throw Error(ERROR_STALE);
  return task;
 }
 heartbeat(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,leaseMs=30_000,note?:string){
  integer(leaseMs,1_000,600_000);
  if(note!==undefined&&(typeof note!=='string'||note.length>2000))throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{
   const task=this.active(lease),until=checkedLeaseDeadline(this.now(),leaseMs);
   this.db.prepare('UPDATE mc_tasks SET lease_until=?,updated_at=? WHERE id=?').run(until,this.now(),task.id);
   this.event(task.tenant,task.id,'WORKER_HEARTBEAT',lease.worker,note?{note,until}:{until});
   return {leaseUntil:until};
  });
 }
 note(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,note:string){
  if(typeof note!=='string'||!note.trim()||note.length>2000)throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{const task=this.active(lease);this.event(task.tenant,task.id,'WORKER_NOTE',lease.worker,{note});return true;});
 }
 finish(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,outcome:'DONE'|'FAILED',note:string=''){
  if(!['DONE','FAILED'].includes(outcome)||typeof note!=='string'||note.length>2000)throw Error('MC_INVALID_OUTCOME');
  return this.tx(()=>{
   const existing=this.row(lease.taskId,lease.tenant);
   if(existing&&existing.fence===lease.fence&&existing.lease_worker===lease.worker&&existing.state===outcome)return {state:outcome,reused:true};
   const task=this.active(lease);
   this.db.prepare('UPDATE mc_tasks SET state=?,lease_until=NULL,result_json=?,updated_at=? WHERE id=?')
    .run(outcome,json({note}),this.now(),task.id);
   this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(task.id,lease.fence);
   this.event(task.tenant,task.id,'WORKER_FINISHED',lease.worker,{outcome,note,fence:lease.fence});
   return {state:outcome,reused:false};
  });
 }
 // Explicit worker handoff. PURE tasks can be safely requeued; EXTERNAL tasks stay UNKNOWN.
 handoff(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,nextWorker:string,note:string){
  valid(nextWorker);
  if(typeof note!=='string'||note.trim().length<5||note.length>2000)throw Error('MC_INVALID_NOTE');
  return this.tx(()=>{
   const task=this.active(lease),safe=task.effect_mode==='PURE';
   const c=this.coordination(task);
   if(c.revision===Number.MAX_SAFE_INTEGER)throw Error('MC_TASK_REVISION_EXHAUSTED');
   const state=safe?'QUEUED':'UNKNOWN';
   this.db.prepare('UPDATE mc_tasks SET state=?,assigned_worker=?,lease_worker=NULL,lease_until=NULL,updated_at=? WHERE id=?')
    .run(state,nextWorker,this.now(),task.id);
   if(safe)this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(task.id,lease.fence);
   this.db.prepare('UPDATE mc_task_coordination SET revision=? WHERE task_id=?').run(c.revision+1,task.id);
   this.event(task.tenant,task.id,safe?'SAFE_HANDOFF':'UNCERTAIN_HANDOFF',lease.worker,{nextWorker,note,fence:lease.fence,revision:c.revision+1});
   return {state,nextWorker};
  });
 }
 // Worker explicitly reports an uncertain external effect; never send again automatically.
 markUnknown(lease:Pick<WorkerLease,'taskId'|'tenant'|'worker'|'fence'>,reason:string){
  if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000)throw Error('MC_INVALID_REASON');
  return this.tx(()=>{
   const task=this.active(lease);
   if(task.effect_mode!=='EXTERNAL')throw Error('MC_UNKNOWN_EXTERNAL_ONLY');
   this.db.prepare("UPDATE mc_tasks SET state='UNKNOWN',lease_worker=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(this.now(),task.id);
   this.event(task.tenant,task.id,'EXTERNAL_EFFECT_UNCERTAIN',lease.worker,{reason,fence:lease.fence});
   return 'UNKNOWN' as const;
  });
 }
 // No automatic retry of unknown external sends. Human reconciliation with evidence only.
 reconcileUnknown(tenant:string,taskId:string,reviewer:string,
  verdict:'CONFIRMED_DONE'|'PROVEN_NO_EFFECT',evidence:string){
  valid(tenant);valid(taskId);valid(reviewer);
  if(typeof evidence!=='string'||evidence.trim().length<12||evidence.length>2000||
   !['CONFIRMED_DONE','PROVEN_NO_EFFECT'].includes(verdict))throw Error('MC_RECONCILIATION_EVIDENCE_REQUIRED');
  return this.tx(()=>{
   if(this.stopped(tenant))throw Error('MC_TENANT_STOPPED');
   const row=this.row(taskId,tenant);
   if(!row||row.state!=='UNKNOWN')throw Error('MC_NOT_UNKNOWN');
   const state=verdict==='CONFIRMED_DONE'?'DONE':'QUEUED';
   this.db.prepare('UPDATE mc_tasks SET state=?,updated_at=?,result_json=? WHERE id=?')
    .run(state,this.now(),json({reconciliation:verdict,evidence,reviewer}),taskId);
   this.db.prepare('DELETE FROM mc_locks WHERE task_id=? AND fence=?').run(taskId,row.fence);
   this.event(tenant,taskId,'HUMAN_RECONCILED',reviewer,{verdict,evidence});
   return state;
  });
 }
 cancelQueued(tenant:string,taskId:string,reason:string){
  valid(tenant);valid(taskId);
  if(typeof reason!=='string'||reason.trim().length<5||reason.length>2000)throw Error('MC_INVALID_REASON');
  return this.tx(()=>{
   if(this.stopped(tenant))throw Error('MC_TENANT_STOPPED');
   const task=this.row(taskId,tenant);
   if(!task||task.state!=='QUEUED')throw Error('MC_CANCEL_REQUIRES_QUEUED');
   this.db.prepare("UPDATE mc_tasks SET state='CANCELLED',updated_at=? WHERE id=?").run(this.now(),taskId);
   this.event(tenant,taskId,'TASK_CANCELLED','boss',{reason});
   return true;
  });
 }
 get(tenant:string,taskId:string){
  valid(tenant);valid(taskId);
  const t=this.row(taskId,tenant);
  if(!t)return null;
  const deps=this.db.prepare('SELECT depends_on FROM mc_deps WHERE tenant=? AND task_id=? ORDER BY depends_on')
   .all(tenant,taskId).map(x=>x.depends_on);
  return {taskId:t.id,tenant:t.tenant,title:t.title,priority:t.priority,state:t.state,assignedWorker:t.assigned_worker,
   effectMode:t.effect_mode,resources:JSON.parse(t.resources_json) as string[],dependencies:deps,
   leaseWorker:t.lease_worker,leaseUntil:t.lease_until,fence:t.fence,createdAt:t.created_at,updatedAt:t.updated_at};
 }
 events(tenant:string,after=0,limit=100){
  valid(tenant);integer(after,0,Number.MAX_SAFE_INTEGER);integer(limit,1,500);
  return this.db.prepare('SELECT seq,task_id AS taskId,kind,actor,detail,at_ms AS atMs FROM mc_events WHERE tenant=? AND seq>? ORDER BY seq ASC LIMIT ?')
   .all(tenant,after,limit).map(x=>({
    seq:Number(x.seq),taskId:String(x.taskId),kind:String(x.kind),actor:String(x.actor),
    detail:JSON.parse(String(x.detail)) as unknown,atMs:Number(x.atMs),
   }));
 }
 bossStatus(tenant:string){
  valid(tenant);
  const rows=this.db.prepare('SELECT state,COUNT(*) AS count FROM mc_tasks WHERE tenant=? GROUP BY state').all(tenant);
  const counts:Record<string,number>={QUEUED:0,RUNNING:0,DONE:0,FAILED:0,UNKNOWN:0,CANCELLED:0};
  for(const r of rows)counts[r.state as string]=Number(r.count);
  const cursor=this.db.prepare('SELECT MAX(seq) AS cursor FROM mc_events WHERE tenant=?').get(tenant) as {cursor:number|null};
  return {tenant,counts,eventCursor:cursor.cursor??0};
 }
 graph(tenant:string,limit=500){
  valid(tenant);integer(limit,1,2000);
  const nodes=this.db.prepare('SELECT id,title,state,priority,assigned_worker AS assignedWorker,fence FROM mc_tasks WHERE tenant=? ORDER BY created_at,id LIMIT ?')
   .all(tenant,limit).map(r=>({taskId:String(r.id),title:String(r.title),state:String(r.state),
    priority:Number(r.priority),assignedWorker:r.assignedWorker===null?null:String(r.assignedWorker),fence:Number(r.fence)}));
  const ids=new Set(nodes.map(x=>x.taskId));
  const edges=this.db.prepare('SELECT task_id,depends_on FROM mc_deps WHERE tenant=? ORDER BY task_id,depends_on')
   .all(tenant).filter(r=>ids.has(String(r.task_id))&&ids.has(String(r.depends_on)))
   .map(r=>({taskId:String(r.task_id),dependsOn:String(r.depends_on)}));
  return {tenant,nodes,edges};
 }
 // Offers wake-up intents only; never dispatches a Chrome or ChatGPT message.
 wakeupCandidates(tenant:string,limit=20){
  valid(tenant);integer(limit,1,100);
  const tasks=this.db.prepare(`SELECT t.id AS taskId,t.priority,t.assigned_worker AS assignedWorker,t.resources_json AS resources FROM mc_tasks t
 WHERE t.tenant=? AND t.state='QUEUED' AND NOT EXISTS(
 SELECT 1 FROM mc_deps d JOIN mc_tasks p ON p.id=d.depends_on WHERE d.task_id=t.id AND p.state!='DONE')
 ORDER BY t.priority DESC,t.created_at,t.id`).all(tenant);
  const held=this.db.prepare('SELECT resource,task_id,fence FROM mc_locks').all() as unknown as LockRow[];
  return tasks.filter(t=>(JSON.parse(String(t.resources)) as string[]).every(r=>!held.some(h=>conflict(r,h.resource))))
   .slice(0,limit).map(t=>({taskId:String(t.taskId),priority:Number(t.priority),
    assignedWorker:t.assignedWorker===null?null:String(t.assignedWorker)}));
 }
}
