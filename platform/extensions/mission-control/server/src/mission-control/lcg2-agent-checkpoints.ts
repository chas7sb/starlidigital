import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export type Lcg2SignedCheckpointReceipt={
 tenant:string;agentId:string;sessionEpoch:number;revision:number;checkpointId:string;
 receiptId:string;commandId:string;issuedAtMs:number;signature:string;
};
type AgentCheckpointInput={
 tenant:string;agentId:string;sessionEpoch:number;expectedRevision:number;
 objective:string;tasks:string[];ownedFiles:string[];commitSha:string|null;
 tests:string;blockers:string[];nextStep:string;notes:string;
};
type Row={tenant:string;agent_id:string;session_epoch:number;revision:number;checkpoint_id:string;objective:string;tasks_json:string;owned_files_json:string;commit_sha:string|null;tests:string;blockers_json:string;next_step:string;notes:string;rotation_id:string|null;rotation_phase:string;rotation_target_epoch:number|null;rotation_request_key:string|null;updated_at:number};
const safe=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
function id(s:string){if(typeof s!=='string'||!safe.test(s))throw Error('MC_CHECKPOINT_INVALID_ID');return s;}
function nat(v:number){if(!Number.isSafeInteger(v)||v<0)throw Error('MC_CHECKPOINT_INVALID_NUMBER');return v;}
function successor(v:number){nat(v);if(v===Number.MAX_SAFE_INTEGER)throw Error('MC_CHECKPOINT_SEQUENCE_EXHAUSTED');return v+1;}
function bounded(s:string,max=4000){if(typeof s!=='string'||s.length>max)throw Error('MC_CHECKPOINT_INVALID_TEXT');return s;}
function lines(x:string[],max=80){if(!Array.isArray(x)||x.length>max)throw Error('MC_CHECKPOINT_INVALID_LIST');return x.map(v=>bounded(v,1000));}
export class Lcg2AgentCheckpointStore{
 private db:DatabaseSync;
 constructor(dbPath:string,private readonly now:()=>number=Date.now,private readonly receiptVerificationKey?:Buffer){
  this.db=new DatabaseSync(dbPath);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=4000;');
  this.db.exec(`CREATE TABLE IF NOT EXISTS lcg2_agent_checkpoints(
 tenant TEXT NOT NULL,agent_id TEXT NOT NULL,session_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,
 checkpoint_id TEXT NOT NULL,objective TEXT NOT NULL,tasks_json TEXT NOT NULL,owned_files_json TEXT NOT NULL,
 commit_sha TEXT,tests TEXT NOT NULL,blockers_json TEXT NOT NULL,next_step TEXT NOT NULL,notes TEXT NOT NULL,
 rotation_id TEXT,rotation_phase TEXT NOT NULL DEFAULT 'NONE',rotation_target_epoch INTEGER,
 rotation_request_key TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(tenant,agent_id));
 CREATE TABLE IF NOT EXISTS lcg2_checkpoint_events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,agent_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,
 kind TEXT NOT NULL,revision INTEGER NOT NULL,session_epoch INTEGER NOT NULL,at_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS lcg2_checkpoint_events_tenant ON lcg2_checkpoint_events(tenant,seq);
 CREATE TABLE IF NOT EXISTS lcg2_consumed_checkpoint_receipts(
  tenant TEXT NOT NULL,receipt_id TEXT NOT NULL,command_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,session_epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,consumed_at INTEGER NOT NULL,
  PRIMARY KEY(tenant,receipt_id),UNIQUE(tenant,command_id));`);
 }
 close(){this.db.close();}
 private tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private assertTenantNotStopped(tenant:string){
  // The standalone checkpoint store predates the queue. On a shared DB, a durable
  // tenant STOP fences all checkpoint writes/rotation/continuation before any CAS.
  if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get() &&
     this.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(tenant))
   throw Error('MC_CHECKPOINT_TENANT_STOPPED');
 }
 private row(tenant:string,agent:string){return this.db.prepare('SELECT * FROM lcg2_agent_checkpoints WHERE tenant=? AND agent_id=?').get(tenant,agent) as unknown as Row|undefined;}
 private event(r:Row,kind:string){this.db.prepare('INSERT INTO lcg2_checkpoint_events(tenant,agent_id,checkpoint_id,kind,revision,session_epoch,at_ms) VALUES(?,?,?,?,?,?,?)').run(r.tenant,r.agent_id,r.checkpoint_id,kind,r.revision,r.session_epoch,this.now());}
 private view(r:Row){return {tenant:r.tenant,agentId:r.agent_id,sessionEpoch:r.session_epoch,revision:r.revision,
  checkpointId:r.checkpoint_id,objective:r.objective,tasks:JSON.parse(r.tasks_json) as string[],
  ownedFiles:JSON.parse(r.owned_files_json) as string[],commitSha:r.commit_sha,tests:r.tests,
  blockers:JSON.parse(r.blockers_json) as string[],nextStep:r.next_step,notes:r.notes,
  rotationId:r.rotation_id,rotationPhase:r.rotation_phase,rotationTargetEpoch:r.rotation_target_epoch,updatedAt:r.updated_at};}
 get(tenant:string,agentId:string){id(tenant);id(agentId);const r=this.row(tenant,agentId);return r?this.view(r):null;}
 // This store requires the SAME SQLite database as the durable LCG2 queue STOP barrier.
 // A trusted authenticated backend signs receipts. This method verifies and consumes;
 // it does not establish the identity/authorization of the issuing backend.
 consumeSignedReceipt(x:Lcg2SignedCheckpointReceipt){
  id(x.tenant);id(x.agentId);id(x.checkpointId);id(x.receiptId);id(x.commandId);
  nat(x.sessionEpoch);nat(x.revision);nat(x.issuedAtMs);
  const key=this.receiptVerificationKey;
  if(!key||key.length<32||typeof x.signature!=='string'||!/^[0-9a-f]{64}$/.test(x.signature))
   throw Error('MC_RECEIPT_SIGNATURE_REQUIRED');
  const now=nat(this.now());
  if(x.issuedAtMs>now||now-x.issuedAtMs>300_000)throw Error('MC_RECEIPT_EXPIRED');
  const canonical=JSON.stringify(['LCG2_CHECKPOINT_RECEIPT_V1',x.tenant,x.agentId,
   x.sessionEpoch,x.revision,x.checkpointId,x.receiptId,x.commandId,x.issuedAtMs]);
  const expected=createHmac('sha256',key).update(canonical).digest();
  if(!timingSafeEqual(expected,Buffer.from(x.signature,'hex')))throw Error('MC_RECEIPT_INVALID_SIGNATURE');
  return this.tx(()=>{
   // No silent fail-open if integrator uses a distinct checkpoint DB without queue STOP.
   const stopTable=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get();
   if(!stopTable)throw Error('MC_RECEIPT_STOP_STORE_REQUIRED');
   if(this.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(x.tenant))
    throw Error('MC_RECEIPT_TENANT_STOPPED');
   const r=this.row(x.tenant,x.agentId);
   if(!r||r.session_epoch!==x.sessionEpoch||r.revision!==x.revision||
      r.checkpoint_id!==x.checkpointId||r.rotation_phase!=='NONE')
    throw Error('MC_RECEIPT_CHECKPOINT_STALE');
   if(this.db.prepare('SELECT 1 FROM lcg2_consumed_checkpoint_receipts WHERE tenant=? AND (receipt_id=? OR command_id=?)')
      .get(x.tenant,x.receiptId,x.commandId))throw Error('MC_RECEIPT_ALREADY_CONSUMED');
   this.db.prepare('INSERT INTO lcg2_consumed_checkpoint_receipts(tenant,receipt_id,command_id,agent_id,checkpoint_id,session_epoch,revision,consumed_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(x.tenant,x.receiptId,x.commandId,x.agentId,x.checkpointId,x.sessionEpoch,x.revision,now);
   this.event(r,'TRUSTED_RECEIPT_CONSUMED');
   return {tenant:x.tenant,agentId:x.agentId,receiptId:x.receiptId,commandId:x.commandId,consumed:true as const};
  });
 }

 // Integrators must validate the current checkpoint before any authorized wake/rotation.
 // This is a store fence, NOT actor authentication or atomic fencing of an external effect.
 assertCurrentSession(x:{tenant:string;agentId:string;sessionEpoch:number;revision:number;checkpointId:string}){
  id(x.tenant);id(x.agentId);id(x.checkpointId);nat(x.sessionEpoch);nat(x.revision);
  this.assertTenantNotStopped(x.tenant);
  const r=this.row(x.tenant,x.agentId);
  if(!r||r.session_epoch!==x.sessionEpoch||r.revision!==x.revision||
     r.checkpoint_id!==x.checkpointId||r.rotation_phase!=='NONE')
   throw Error('MC_CHECKPOINT_SESSION_NOT_CURRENT');
  return {tenant:r.tenant,agentId:r.agent_id,sessionEpoch:r.session_epoch,revision:r.revision,checkpointId:r.checkpoint_id};
 }
 checkpoint(data:AgentCheckpointInput){
  id(data.tenant);id(data.agentId);nat(data.sessionEpoch);nat(data.expectedRevision);
  const objective=bounded(data.objective),tasks=lines(data.tasks),owned=lines(data.ownedFiles),tests=bounded(data.tests),
   blockers=lines(data.blockers),next=bounded(data.nextStep),notes=bounded(data.notes,8000);
  if(!objective.trim()||!next.trim())throw Error('MC_CHECKPOINT_REQUIRED_FIELDS');
  if(data.commitSha!==null&&!/^[0-9a-f]{40}$/.test(data.commitSha))throw Error('MC_CHECKPOINT_INVALID_SHA');
  return this.tx(()=>{
   this.assertTenantNotStopped(data.tenant);
   const existing=this.row(data.tenant,data.agentId);
   if(existing){
    if(existing.session_epoch!==data.sessionEpoch||existing.revision!==data.expectedRevision||
       existing.rotation_phase!=='NONE')throw Error('MC_CHECKPOINT_STALE_EPOCH_OR_REVISION');
   }else if(data.expectedRevision!==0||data.sessionEpoch!==1)throw Error('MC_CHECKPOINT_BOOTSTRAP_FENCE');
   const revision=successor(data.expectedRevision),checkpointId=randomUUID(),time=this.now();
   if(existing){
    this.db.prepare(`UPDATE lcg2_agent_checkpoints SET revision=?,checkpoint_id=?,objective=?,tasks_json=?,
    owned_files_json=?,commit_sha=?,tests=?,blockers_json=?,next_step=?,notes=?,updated_at=?
    WHERE tenant=? AND agent_id=?`).run(revision,checkpointId,objective,JSON.stringify(tasks),JSON.stringify(owned),data.commitSha,tests,
     JSON.stringify(blockers),next,notes,time,data.tenant,data.agentId);
   }else{
    this.db.prepare(`INSERT INTO lcg2_agent_checkpoints(tenant,agent_id,session_epoch,revision,checkpoint_id,objective,
    tasks_json,owned_files_json,commit_sha,tests,blockers_json,next_step,notes,rotation_phase,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'NONE',?)`).run(data.tenant,data.agentId,data.sessionEpoch,revision,checkpointId,objective,
     JSON.stringify(tasks),JSON.stringify(owned),data.commitSha,tests,JSON.stringify(blockers),next,notes,time);
   }
   const r=this.row(data.tenant,data.agentId)!;this.event(r,'CHECKPOINT_SAVED');return this.view(r);
  });
 }
 requestRotation(x:{tenant:string;agentId:string;sessionEpoch:number;expectedRevision:number;checkpointId:string;requestKey:string}){
  id(x.tenant);id(x.agentId);id(x.requestKey);nat(x.sessionEpoch);nat(x.expectedRevision);id(x.checkpointId);
  return this.tx(()=>{
   this.assertTenantNotStopped(x.tenant);
   const r=this.row(x.tenant,x.agentId);
   if(!r)throw Error('MC_CHECKPOINT_NOT_FOUND');
   if(r.rotation_phase==='REQUESTED'&&r.rotation_request_key===x.requestKey&&r.session_epoch===x.sessionEpoch&&r.checkpoint_id===x.checkpointId&&x.expectedRevision<Number.MAX_SAFE_INTEGER&&r.revision===x.expectedRevision+1)
    return {rotationId:r.rotation_id,targetEpoch:r.rotation_target_epoch,reused:true};
   if(r.session_epoch!==x.sessionEpoch||r.revision!==x.expectedRevision||r.checkpoint_id!==x.checkpointId||
      r.rotation_phase!=='NONE')throw Error('MC_CHECKPOINT_ROTATION_CONFLICT');
   const rotationId=randomUUID(),targetEpoch=successor(r.session_epoch);
   successor(r.revision);
   this.db.prepare(`UPDATE lcg2_agent_checkpoints SET rotation_id=?,rotation_phase='REQUESTED',
    rotation_target_epoch=?,rotation_request_key=?,revision=revision+1,updated_at=? WHERE tenant=? AND agent_id=?`)
    .run(rotationId,targetEpoch,x.requestKey,this.now(),x.tenant,x.agentId);
   this.event(this.row(x.tenant,x.agentId)!,'ROTATION_REQUESTED');
   return {rotationId,targetEpoch,reused:false};
  });
 }
 ackRotation(x:{tenant:string;agentId:string;rotationId:string;fromEpoch:number;toEpoch:number;checkpointId:string;expectedRevision:number}){
  id(x.tenant);id(x.agentId);id(x.rotationId);id(x.checkpointId);nat(x.fromEpoch);nat(x.toEpoch);nat(x.expectedRevision);
  return this.tx(()=>{
   this.assertTenantNotStopped(x.tenant);
   const r=this.row(x.tenant,x.agentId);
   if(!r)throw Error('MC_CHECKPOINT_NOT_FOUND');
   // Idempotent ACK must still match the exact original transition and resulting
   // revision; do not accept forged fromEpoch/revision or a replay after later writes.
   if(r.rotation_phase==='NONE'&&r.rotation_id===x.rotationId&&r.session_epoch===x.toEpoch&&
      r.checkpoint_id===x.checkpointId&&x.fromEpoch<Number.MAX_SAFE_INTEGER&&x.fromEpoch+1===x.toEpoch&&
      r.revision===x.expectedRevision+1)return {...this.view(r),reused:true};
   if(r.rotation_phase!=='REQUESTED'||r.rotation_id!==x.rotationId||r.session_epoch!==x.fromEpoch||
      r.rotation_target_epoch!==x.toEpoch||r.checkpoint_id!==x.checkpointId||
      r.revision!==x.expectedRevision)throw Error('MC_CHECKPOINT_ROTATION_FENCE');
   successor(r.revision);
   this.db.prepare(`UPDATE lcg2_agent_checkpoints SET session_epoch=?,revision=revision+1,
    rotation_phase='NONE',rotation_request_key=NULL,rotation_target_epoch=NULL,updated_at=?
    WHERE tenant=? AND agent_id=?`).run(x.toEpoch,this.now(),x.tenant,x.agentId);
   const done=this.row(x.tenant,x.agentId)!;this.event(done,'ROTATION_ACKNOWLEDGED');
   return {...this.view(done),reused:false};
  });
 }
 events(tenant:string,after=0,limit=100){
  id(tenant);nat(after);if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('MC_CHECKPOINT_INVALID_LIMIT');
  return this.db.prepare('SELECT seq,agent_id AS agentId,checkpoint_id AS checkpointId,kind,revision,session_epoch AS sessionEpoch,at_ms AS atMs FROM lcg2_checkpoint_events WHERE tenant=? AND seq>? ORDER BY seq LIMIT ?')
   .all(tenant,after,limit).map(r=>({seq:Number(r.seq),agentId:String(r.agentId),checkpointId:String(r.checkpointId),
    kind:String(r.kind),revision:Number(r.revision),sessionEpoch:Number(r.sessionEpoch),atMs:Number(r.atMs)}));
 }
}
