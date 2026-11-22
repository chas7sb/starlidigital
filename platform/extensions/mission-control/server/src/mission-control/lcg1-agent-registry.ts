import { DatabaseSync } from 'node:sqlite';

export type AgentStatus = 'START'|'BUSY'|'IDLE'|'DONE'|'BLOCKED'|'UNKNOWN';
export type AgentRole = 'BOSS' | 'LCG';
export type AgentPrincipal = { tenantId:string; subjectId:string; operator:boolean; sessionId?:string };
/** Authority for principals created ONLY after the host has authenticated a request.
 * Never expose issue() or this instance to a browser/WS/model payload.
 * The private WeakSet attests the precise immutable server-created object. */
export class Lcg1RegistryPrincipalAuthority {
 private readonly issued=new WeakSet<object>();
 issue(input:{tenantId:string;subjectId:string;operator:boolean;sessionId?:string}):Readonly<AgentPrincipal>{
  const tenantId=checkId(input.tenantId),subjectId=checkId(input.subjectId);
  if(typeof input.operator!=='boolean')throw Error('REGISTRY_PRINCIPAL_INVALID');
  const sessionId=input.sessionId===undefined?undefined:checkId(input.sessionId);
  const principal=Object.freeze({tenantId,subjectId,operator:input.operator,...(sessionId?{sessionId}:{})});
  this.issued.add(principal);
  return principal;
 }
 /** Trusted host calls this on logout, role removal, or grant/session revocation. */
 revoke(principal:AgentPrincipal):void{this.issued.delete(principal);}
 verifyOperator=(principal:AgentPrincipal):boolean=>this.issued.has(principal)&&
  Object.isFrozen(principal)&&principal.operator===true;
}
export type AgentIdentity = { tenantId:string;agentId:string;role:AgentRole;ownerId:string;sessionEpoch:number;status:AgentStatus;heartbeatAt:number;updatedAt:number;revision:number;sessionId:string|null;note:string };
type AgentRow = AgentIdentity;
export type AgentEvent = { seq:number;tenantId:string;agentId:string;eventKey:string;kind:string;at:number;sessionEpoch:number;status:AgentStatus;note:string };
const ident=/^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/;
const noteMax=4096;
function nextRevision(value:number):number{
 if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)
  throw Error('REGISTRY_COUNTER_EXHAUSTED');
 return value+1;
}
function ensureFence(value:number):void{
 if(!Number.isSafeInteger(value)||value<0)throw Error('REGISTRY_FENCE_INVALID');
}
function checkId(value:string){if(typeof value!=='string'||!ident.test(value))throw Error('INVALID_AGENT_IDENTIFIER');return value;}
function checkNote(value:string){if(typeof value!=='string'||value.length>noteMax||/[\x00-\x08\x0b-\x1f\x7f]/.test(value))throw Error('INVALID_AGENT_NOTE');return value;}
function requireAccess(principal:AgentPrincipal,tenantId:string,ownerId:string,verifiedOperator:boolean){
 if(principal.tenantId!==tenantId)throw Error('REGISTRY_TENANT_DENIED');
 if(!verifiedOperator && principal.subjectId!==ownerId)throw Error('REGISTRY_OWNER_DENIED');
}
const statuses=new Set<AgentStatus>(['START','BUSY','IDLE','DONE','BLOCKED','UNKNOWN']);
const allowed:Record<AgentStatus,ReadonlySet<AgentStatus>>={
 START:new Set(['BUSY','IDLE','BLOCKED','UNKNOWN']),
 BUSY:new Set(['IDLE','DONE','BLOCKED','UNKNOWN']),
 IDLE:new Set(['START','BUSY','DONE','BLOCKED','UNKNOWN']),
 DONE:new Set(['START','UNKNOWN']),
 BLOCKED:new Set(['START','IDLE','UNKNOWN']),
 UNKNOWN:new Set(), // Manual reconciliation requires a separately reviewed, durable recovery protocol.
};
/** SQLite-backed registry; it never sends commands or resumes an uncertain action. */
export class Lcg1AgentRegistry {
 constructor(private readonly db:DatabaseSync, private readonly clock:()=>number=Date.now,
  private readonly verifyOperator:(principal:AgentPrincipal)=>boolean=()=>false){
  db.exec(`CREATE TABLE IF NOT EXISTS lcg1_agents(
   tenantId TEXT NOT NULL,agentId TEXT NOT NULL,role TEXT NOT NULL,ownerId TEXT NOT NULL,
   sessionEpoch INTEGER NOT NULL,status TEXT NOT NULL,heartbeatAt INTEGER NOT NULL,
   updatedAt INTEGER NOT NULL,revision INTEGER NOT NULL,sessionId TEXT,note TEXT NOT NULL,
   PRIMARY KEY(tenantId,agentId));
  CREATE TABLE IF NOT EXISTS lcg1_events(
   seq INTEGER PRIMARY KEY AUTOINCREMENT,tenantId TEXT NOT NULL,agentId TEXT NOT NULL,
   eventKey TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,sessionEpoch INTEGER NOT NULL,
   status TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(tenantId,agentId,eventKey));
  CREATE INDEX IF NOT EXISTS lcg1_events_tenant_seq ON lcg1_events(tenantId,seq);
  CREATE TABLE IF NOT EXISTS lcg1_session_history(tenantId TEXT NOT NULL,agentId TEXT NOT NULL,sessionId TEXT NOT NULL,PRIMARY KEY(tenantId,agentId,sessionId));`);
 }
 /** Operator elevation must be attested by trusted host context, never a request boolean.
  * No verifier configured means every operator claim fails closed. */
 private trustedOperator(principal:AgentPrincipal):boolean{
  if(principal.operator!==true)return false;
  let verified=false;
  try{verified=this.verifyOperator(principal)===true;}catch{verified=false;}
  if(!verified)throw Error('REGISTRY_OPERATOR_UNVERIFIED');
  return true;
 }
 private run<T>(fn:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const value=fn();this.db.exec('COMMIT');return value;}
  catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 private row(tenantId:string,agentId:string):AgentRow|undefined{
  return this.db.prepare('SELECT * FROM lcg1_agents WHERE tenantId=? AND agentId=?').get(tenantId,agentId) as AgentRow|undefined;
 }
 private event(tenantId:string,agentId:string,eventKey:string):AgentEvent|undefined{
  return this.db.prepare('SELECT * FROM lcg1_events WHERE tenantId=? AND agentId=? AND eventKey=?').get(tenantId,agentId,eventKey) as AgentEvent|undefined;
 }
 private record(row:AgentRow,eventKey:string,kind:string):void{
  this.db.prepare('UPDATE lcg1_agents SET sessionEpoch=?,status=?,heartbeatAt=?,updatedAt=?,revision=?,sessionId=?,note=? WHERE tenantId=? AND agentId=?')
   .run(row.sessionEpoch,row.status,row.heartbeatAt,row.updatedAt,row.revision,row.sessionId,row.note,row.tenantId,row.agentId);
  this.db.prepare('INSERT INTO lcg1_events(tenantId,agentId,eventKey,kind,at,sessionEpoch,status,note) VALUES(?,?,?,?,?,?,?,?)')
   .run(row.tenantId,row.agentId,eventKey,kind,row.updatedAt,row.sessionEpoch,row.status,row.note);
 }
 private sessionWasUsed(row:AgentRow,sessionId:string):boolean{
  return Boolean(this.db.prepare('SELECT 1 FROM lcg1_session_history WHERE tenantId=? AND agentId=? AND sessionId=?').get(row.tenantId,row.agentId,sessionId));
 }
 private rememberSession(row:AgentRow,sessionId:string):void{
  this.db.prepare('INSERT OR IGNORE INTO lcg1_session_history(tenantId,agentId,sessionId) VALUES(?,?,?)').run(row.tenantId,row.agentId,sessionId);
 }
 private pendingRotation(row:AgentRow):boolean{
  const last=this.db.prepare('SELECT kind FROM lcg1_events WHERE tenantId=? AND agentId=? ORDER BY seq DESC LIMIT 1').get(row.tenantId,row.agentId) as {kind?:string}|undefined;
  return last?.kind==='ROTATE_PENDING_ACK';
 }
 private requireCurrent(principal:AgentPrincipal,agentId:string,epoch:number,revision:number){
  const row=this.row(principal.tenantId,checkId(agentId));
  if(!row)throw Error('REGISTRY_NOT_FOUND');
  requireAccess(principal,row.tenantId,row.ownerId,this.trustedOperator(principal));
  ensureFence(epoch);ensureFence(revision);
  if(row.sessionEpoch!==epoch||row.revision!==revision)throw Error('REGISTRY_STALE_FENCE');
  return row;
 }
 register(principal:AgentPrincipal,input:{agentId:string;ownerId:string;role:AgentRole;eventKey:string}):AgentIdentity{
  const agentId=checkId(input.agentId),ownerId=checkId(input.ownerId),eventKey=checkId(input.eventKey);
  if((input.role!=='BOSS'&&input.role!=='LCG')||(input.role==='BOSS'&&agentId!=='BOSS')||(input.role==='LCG'&&!/^LCG(?:10|[1-9])$/.test(agentId)))throw Error('REGISTRY_ROLE_INVALID');
  const verifiedOperator=this.trustedOperator(principal);
  if(input.role==='BOSS'&&!verifiedOperator)throw Error('REGISTRY_BOSS_OPERATOR_REQUIRED');
  requireAccess(principal,principal.tenantId,ownerId,verifiedOperator);
  return this.run(()=>{
   const existing=this.row(principal.tenantId,agentId);
   if(existing){
    if(existing.ownerId!==ownerId||existing.role!==input.role)throw Error('REGISTRY_IDENTITY_CONFLICT');
    const previous=this.event(principal.tenantId,agentId,eventKey);
    if(previous){
     if(previous.kind!=='REGISTER')throw Error('REGISTRY_EVENT_KEY_CONFLICT');
     return existing;
    }
    throw Error('REGISTRY_ALREADY_EXISTS');
   }
   const at=this.clock(),row:AgentRow={tenantId:principal.tenantId,agentId,role:input.role,ownerId,
    sessionEpoch:0,status:'IDLE',heartbeatAt:0,updatedAt:at,revision:0,sessionId:null,note:''};
   this.db.prepare('INSERT INTO lcg1_agents VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.tenantId,row.agentId,row.role,row.ownerId,row.sessionEpoch,row.status,row.heartbeatAt,row.updatedAt,row.revision,row.sessionId,row.note);
   this.record(row,eventKey,'REGISTER');
   return row;
  });
 }
 get(principal:AgentPrincipal,agentId:string):AgentIdentity|undefined{
  const row=this.row(principal.tenantId,checkId(agentId));
  const verified=this.trustedOperator(principal);
  if(row)requireAccess(principal,row.tenantId,row.ownerId,verified);
  return row;
 }
 list(principal:AgentPrincipal):AgentIdentity[]{
  if(this.trustedOperator(principal))
   return this.db.prepare('SELECT * FROM lcg1_agents WHERE tenantId=? ORDER BY agentId').all(principal.tenantId) as AgentRow[];
  return this.db.prepare('SELECT * FROM lcg1_agents WHERE tenantId=? AND ownerId=? ORDER BY agentId')
   .all(principal.tenantId,principal.subjectId) as AgentRow[];
 }
 events(principal:AgentPrincipal,afterSeq=0,limit=100):AgentEvent[]{
  if(!Number.isSafeInteger(afterSeq)||afterSeq<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('REGISTRY_CURSOR_INVALID');
  if(this.trustedOperator(principal))
   return this.db.prepare('SELECT * FROM lcg1_events WHERE tenantId=? AND seq>? ORDER BY seq LIMIT ?')
    .all(principal.tenantId,afterSeq,limit) as AgentEvent[];
  return this.db.prepare('SELECT e.* FROM lcg1_events e INNER JOIN lcg1_agents a ON e.tenantId=a.tenantId AND e.agentId=a.agentId WHERE e.tenantId=? AND a.ownerId=? AND e.seq>? ORDER BY e.seq LIMIT ?')
   .all(principal.tenantId,principal.subjectId,afterSeq,limit) as AgentEvent[];
 }
 transition(principal:AgentPrincipal,input:{agentId:string;epoch:number;revision:number;status:AgentStatus;eventKey:string;note?:string;sessionId?:string}):AgentIdentity{
  const eventKey=checkId(input.eventKey);
  ensureFence(input.epoch);ensureFence(input.revision);
  if(!statuses.has(input.status))throw Error('REGISTRY_STATUS_INVALID');
  const note=checkNote(input.note??'');
  return this.run(()=>{
   const old=this.row(principal.tenantId,checkId(input.agentId));
   if(!old)throw Error('REGISTRY_NOT_FOUND');
   requireAccess(principal,old.tenantId,old.ownerId,this.trustedOperator(principal));
   // Authentication and conversation fencing MUST precede idempotent replay.
   if(old.sessionId&&principal.sessionId!==old.sessionId)throw Error('REGISTRY_SESSION_DENIED');
   if(input.sessionId!==undefined&&input.sessionId!==principal.sessionId)throw Error('REGISTRY_SESSION_DENIED');
   const previous=this.event(old.tenantId,old.agentId,eventKey);
   if(previous){
    // Return a retry receipt only when the same status mutation is still current.
    // A reused key may never silently authorize another command or later state.
    if(previous.kind!=='STATUS'||previous.status!==input.status||
       previous.note!==note||previous.sessionEpoch!==input.epoch||
       old.status!==input.status||old.revision!==input.revision+1)
      throw Error('REGISTRY_EVENT_KEY_CONFLICT');
    return old;
   }
   if(old.sessionEpoch!==input.epoch||old.revision!==input.revision)throw Error('REGISTRY_STALE_FENCE');
   if(old.status==='BLOCKED'&&old.sessionId!==null&&this.pendingRotation(old))throw Error('REGISTRY_ROTATION_ACK_REQUIRED');
   if(!allowed[old.status].has(input.status))throw Error('REGISTRY_TRANSITION_DENIED');
   if(input.sessionId!==undefined && input.sessionId!==principal.sessionId)throw Error('REGISTRY_SESSION_DENIED');
   if(old.sessionId===null&&input.sessionId!==undefined&&!principal.sessionId)throw Error('REGISTRY_SESSION_DENIED');
   const at=this.clock();
   const next:AgentRow={...old,status:input.status,note,revision:nextRevision(old.revision),updatedAt:at,
    heartbeatAt:input.status==='UNKNOWN'?old.heartbeatAt:at,
    sessionId:old.sessionId??(principal.sessionId?checkId(principal.sessionId):null)};
   if(next.sessionId)this.rememberSession(next,next.sessionId);
   this.record(next,eventKey,'STATUS');
   return next;
  });
 }
 heartbeat(principal:AgentPrincipal,input:{agentId:string;epoch:number;revision:number;eventKey:string;note?:string}):AgentIdentity{
  const eventKey=checkId(input.eventKey);
  ensureFence(input.epoch);ensureFence(input.revision);
  return this.run(()=>{
   const row=this.row(principal.tenantId,checkId(input.agentId));
   if(!row)throw Error('REGISTRY_NOT_FOUND');
   requireAccess(principal,row.tenantId,row.ownerId,this.trustedOperator(principal));
   if(row.sessionId&&principal.sessionId!==row.sessionId)throw Error('REGISTRY_SESSION_DENIED');
   const previous=this.event(row.tenantId,row.agentId,eventKey);
   if(previous){
    if(previous.kind!=='HEARTBEAT'||previous.sessionEpoch!==input.epoch||
       (input.note!==undefined&&checkNote(input.note)!==previous.note)||
       row.revision!==input.revision+1||row.sessionEpoch!==input.epoch)
      throw Error('REGISTRY_EVENT_KEY_CONFLICT');
    return row;
   }
   if(row.sessionEpoch!==input.epoch||row.revision!==input.revision)throw Error('REGISTRY_STALE_FENCE');
   if(row.status==='UNKNOWN'||row.status==='DONE'||row.status==='BLOCKED')throw Error('REGISTRY_HEARTBEAT_DISABLED');
   const at=this.clock(),next={...row,heartbeatAt:at,updatedAt:at,revision:nextRevision(row.revision),
    note:input.note===undefined?row.note:checkNote(input.note)};
   this.record(next,eventKey,'HEARTBEAT');
   return next;
  });
 }
 /** Requires an operator; rotation invalidates the previous conversation epoch. Does not wake work. */
 rotate(principal:AgentPrincipal,input:{agentId:string;epoch:number;revision:number;newSessionId:string;eventKey:string;note:string}):AgentIdentity{
  if(!this.trustedOperator(principal))throw Error('REGISTRY_ROTATION_OPERATOR_REQUIRED');
  const eventKey=checkId(input.eventKey),session=checkId(input.newSessionId),note=checkNote(input.note);
  ensureFence(input.epoch);ensureFence(input.revision);
  return this.run(()=>{
   const row=this.row(principal.tenantId,checkId(input.agentId));
   if(!row)throw Error('REGISTRY_NOT_FOUND');
   requireAccess(principal,row.tenantId,row.ownerId,this.trustedOperator(principal));
   const previous=this.event(row.tenantId,row.agentId,eventKey);
   if(previous){
    if(previous.kind!=='ROTATE_PENDING_ACK'||row.status!=='BLOCKED'||
       !this.pendingRotation(row)||row.sessionId!==session||row.note!==note||
       previous.note!==note||previous.sessionEpoch!==row.sessionEpoch||
       row.sessionEpoch!==input.epoch+1||row.revision!==input.revision+1)
      throw Error('REGISTRY_EVENT_KEY_CONFLICT');
    return row;
   }
   if(row.sessionEpoch!==input.epoch||row.revision!==input.revision)throw Error('REGISTRY_STALE_FENCE');
   if(row.status==='BUSY'||row.status==='START')throw Error('REGISTRY_ROTATE_BUSY');
   if(row.status==='UNKNOWN')throw Error('REGISTRY_MANUAL_RECOVERY_REQUIRED');
   if(row.sessionId===session||this.sessionWasUsed(row,session))throw Error('REGISTRY_RETIRED_SESSION_DENIED');
   if(!Number.isSafeInteger(row.sessionEpoch)||row.sessionEpoch>=Number.MAX_SAFE_INTEGER||
      !Number.isSafeInteger(row.revision)||row.revision>=Number.MAX_SAFE_INTEGER)
    throw Error('REGISTRY_COUNTER_EXHAUSTED');
   const at=this.clock(),next={...row,sessionEpoch:nextRevision(row.sessionEpoch),sessionId:session,status:'BLOCKED' as const,
    note,updatedAt:at,revision:nextRevision(row.revision)};
   if(row.sessionId)this.rememberSession(row,row.sessionId);
   this.rememberSession(next,session);
   this.record(next,eventKey,'ROTATE_PENDING_ACK');
   return next;
  });
 }
 /** Must be invoked by an authenticated NEW conversation, never by a cached old tab.
  * The adapter MUST derive principal.sessionId from trusted session metadata. */
 acknowledgeRotation(principal:AgentPrincipal,input:{agentId:string;epoch:number;revision:number;eventKey:string}):AgentIdentity{
  const eventKey=checkId(input.eventKey);
  ensureFence(input.epoch);ensureFence(input.revision);
  return this.run(()=>{
   const row=this.requireCurrent(principal,input.agentId,input.epoch,input.revision);
   if(!row.sessionId||principal.sessionId!==row.sessionId||
      row.status!=='BLOCKED'||!this.pendingRotation(row))
    throw Error('REGISTRY_ROTATION_ACK_DENIED');
   const at=this.clock(),next={...row,status:'START' as const,revision:nextRevision(row.revision),
    updatedAt:at,heartbeatAt:at};
   this.record(next,eventKey,'ROTATION_ACK');
   return next;
  });
 }
 /** Expiration is evidence of uncertainty; it never declares DONE or replays external work. */
 markStale(principal:AgentPrincipal,agentId:string,thresholdMs:number,eventKey:string):AgentIdentity|undefined{
  if(!this.trustedOperator(principal))throw Error('REGISTRY_OPERATOR_REQUIRED');
  checkId(eventKey);
  if(!Number.isSafeInteger(thresholdMs)||thresholdMs<1000)throw Error('REGISTRY_THRESHOLD_INVALID');
  return this.run(()=>{
   const row=this.row(principal.tenantId,checkId(agentId));
   if(!row)return;
   const previous=this.event(row.tenantId,row.agentId,eventKey);
   if(previous){
    if(previous.kind!=='STALE'||row.status!=='UNKNOWN'||previous.status!=='UNKNOWN'||
       row.sessionEpoch!==previous.sessionEpoch||row.updatedAt!==previous.at||
       row.note!==previous.note)
      throw Error('REGISTRY_EVENT_KEY_CONFLICT');
    return row;
   }
   if((row.status!=='START'&&row.status!=='BUSY'&&row.status!=='IDLE')||!row.heartbeatAt||
    this.clock()-row.heartbeatAt<thresholdMs)return row;
   const next={...row,status:'UNKNOWN' as const,revision:nextRevision(row.revision),updatedAt:this.clock(),note:'Heartbeat stale; manual reconciliation required'};
   this.record(next,eventKey,'STALE');
   return next;
  });
 }
}


/** Mission Control v1 durable operator roster. Not a command execution or ACK receipt store.
 * Host MUST derive principal from trusted authentication, never from WS/HTTP JSON. */
export type MissionRosterStatus='IDLE'|'WORKING'|'WAITING'|'BLOCKED'|'REVIEW'|'DONE'|'STOPPED';
export type MissionRosterId='ULTRA_BOSS'|`LCG${1|2|3|4|5|6|7|8|9|10}`;
export type MissionRosterEntry={
 tenantId:string;agentId:MissionRosterId;ownerId:string;sessionId:string|null;
 sessionEpoch:number;status:MissionRosterStatus;revision:number;
 heartbeatAt:number;updatedAt:number
};
const rosterIds:readonly MissionRosterId[]=['ULTRA_BOSS','LCG1','LCG2','LCG3','LCG4','LCG5','LCG6','LCG7','LCG8','LCG9','LCG10'];
const rosterAllowed:Record<MissionRosterStatus,ReadonlySet<MissionRosterStatus>>={
 IDLE:new Set(['WORKING','WAITING','BLOCKED','REVIEW','STOPPED']),
 WORKING:new Set(['IDLE','WAITING','BLOCKED','REVIEW','DONE','STOPPED']),
 WAITING:new Set(['WORKING','BLOCKED','REVIEW','STOPPED']),
 BLOCKED:new Set(['IDLE','REVIEW','STOPPED']),
 REVIEW:new Set(['WORKING','WAITING','BLOCKED','DONE','STOPPED']),
 DONE:new Set(['IDLE','REVIEW','STOPPED']),
 STOPPED:new Set(),
};
/** Requires shared STOP table in the same SQLite WAL database.
 * This projection never dispatches effects, treats a socket ACK as completion, or auto-resumes. */
export class Lcg1MissionRoster {
 constructor(private readonly db:DatabaseSync,private readonly now:()=>number=Date.now,
  private readonly verifyOperator:(principal:AgentPrincipal)=>boolean=()=>false){
  db.exec(`CREATE TABLE IF NOT EXISTS lcg1_roster(
    tenantId TEXT NOT NULL,agentId TEXT NOT NULL,ownerId TEXT NOT NULL,
    sessionId TEXT,sessionEpoch INTEGER NOT NULL,status TEXT NOT NULL,
    revision INTEGER NOT NULL,heartbeatAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,
    PRIMARY KEY(tenantId,agentId));
   CREATE TABLE IF NOT EXISTS lcg1_roster_events(
    tenantId TEXT NOT NULL,agentId TEXT NOT NULL,eventKey TEXT NOT NULL,
    status TEXT NOT NULL,revision INTEGER NOT NULL,at INTEGER NOT NULL,
    PRIMARY KEY(tenantId,agentId,eventKey));
   CREATE TABLE IF NOT EXISTS lcg1_roster_sessions(
    tenantId TEXT NOT NULL,agentId TEXT NOT NULL,sessionId TEXT NOT NULL,
    PRIMARY KEY(tenantId,agentId,sessionId));`);
 }
 private operator(principal:AgentPrincipal):boolean{
  if(principal.operator!==true)return false;
  let valid=false;
  try{valid=this.verifyOperator(principal)===true;}catch{valid=false;}
  if(!valid)throw Error('ROSTER_OPERATOR_UNVERIFIED');
  return true;
 }
 private transact<T>(cb:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const value=cb();this.db.exec('COMMIT');return value;}
  catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 private checkStop(tenantId:string):void{
  // Fail closed if STOP ledger absent: never infer safe-to-work from missing schema.
  const table=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get();
  if(!table)throw Error('ROSTER_STOP_STORE_UNAVAILABLE');
  if(this.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=? LIMIT 1').get(tenantId))
   throw Error('ROSTER_TENANT_STOPPED');
 }
 private row(tenantId:string,id:MissionRosterId):MissionRosterEntry{
  if(!rosterIds.includes(id))throw Error('ROSTER_ID_INVALID');
  const row=this.db.prepare('SELECT * FROM lcg1_roster WHERE tenantId=? AND agentId=?').get(tenantId,id) as MissionRosterEntry|undefined;
  if(!row)throw Error('ROSTER_NOT_FOUND');
  return row;
 }
 private access(principal:AgentPrincipal,row:MissionRosterEntry):boolean{
  const verified=this.operator(principal);
  if(row.tenantId!==principal.tenantId)throw Error('ROSTER_TENANT_DENIED');
  if(!verified&&principal.subjectId!==row.ownerId)throw Error('ROSTER_OWNER_DENIED');
  return verified;
 }
 /** One authorized operator provisions a complete 11-slot tenant roster; idempotent.
  * Owner IDs are trusted host assignments, never accepted directly from a browser. */
 provision(principal:AgentPrincipal,owners:Readonly<Record<MissionRosterId,string>>):MissionRosterEntry[]{
  if(!this.operator(principal))throw Error('ROSTER_OPERATOR_REQUIRED');
  return this.transact(()=>{
   this.checkStop(principal.tenantId);
   for(const id of rosterIds){
    const owner=checkId(owners[id]),existing=this.db.prepare('SELECT ownerId FROM lcg1_roster WHERE tenantId=? AND agentId=?').get(principal.tenantId,id) as {ownerId:string}|undefined;
    if(existing&&existing.ownerId!==owner)throw Error('ROSTER_IDENTITY_CONFLICT');
    if(!existing)this.db.prepare('INSERT INTO lcg1_roster VALUES(?,?,?,?,?,?,?,?,?)')
      .run(principal.tenantId,id,owner,null,0,'IDLE',0,0,this.now());
   }
   return this.list(principal);
  });
 }
 list(principal:AgentPrincipal):MissionRosterEntry[]{
  if(this.operator(principal))
   return this.db.prepare('SELECT * FROM lcg1_roster WHERE tenantId=? ORDER BY agentId').all(principal.tenantId) as MissionRosterEntry[];
  return this.db.prepare('SELECT * FROM lcg1_roster WHERE tenantId=? AND ownerId=? ORDER BY agentId').all(principal.tenantId,principal.subjectId) as MissionRosterEntry[];
 }
 get(principal:AgentPrincipal,id:MissionRosterId):MissionRosterEntry|undefined{
  if(!rosterIds.includes(id))throw Error('ROSTER_ID_INVALID');
  const row=this.db.prepare('SELECT * FROM lcg1_roster WHERE tenantId=? AND agentId=?').get(principal.tenantId,id) as MissionRosterEntry|undefined;
  if(row)this.access(principal,row);
  else this.operator(principal);
  return row;
 }
 /** Session is server-attested. Rotation always fences old session and requires operator. */
 bindSession(principal:AgentPrincipal,id:MissionRosterId,revision:number,sessionId:string):MissionRosterEntry{
  if(!this.operator(principal))throw Error('ROSTER_OPERATOR_REQUIRED');
  ensureFence(revision);checkId(sessionId);
  return this.transact(()=>{
   this.checkStop(principal.tenantId);
   const row=this.row(principal.tenantId,id);
   if(row.revision!==revision)throw Error('ROSTER_STALE_FENCE');
   if(row.status==='WORKING'||row.status==='STOPPED')throw Error('ROSTER_ROTATION_DENIED');
   if(row.sessionId===sessionId||this.db.prepare('SELECT 1 FROM lcg1_roster_sessions WHERE tenantId=? AND agentId=? AND sessionId=?').get(row.tenantId,id,sessionId))
    throw Error('ROSTER_SESSION_REPLAY');
   const nextEpoch=nextRevision(row.sessionEpoch),nextRev=nextRevision(row.revision);
   this.db.prepare('INSERT INTO lcg1_roster_sessions VALUES(?,?,?)').run(row.tenantId,id,sessionId);
   this.db.prepare('UPDATE lcg1_roster SET sessionId=?,sessionEpoch=?,revision=?,updatedAt=?,status=? WHERE tenantId=? AND agentId=?')
    .run(sessionId,nextEpoch,nextRev,this.now(),'BLOCKED',row.tenantId,id);
   return this.row(principal.tenantId,id);
  });
 }
 transition(principal:AgentPrincipal,input:{agentId:MissionRosterId;epoch:number;revision:number;status:MissionRosterStatus;eventKey:string}):MissionRosterEntry{
  ensureFence(input.epoch);ensureFence(input.revision);checkId(input.eventKey);
  if(!Object.prototype.hasOwnProperty.call(rosterAllowed,input.status))throw Error('ROSTER_STATUS_INVALID');
  return this.transact(()=>{
   const row=this.row(principal.tenantId,input.agentId),operator=this.access(principal,row);
   if(input.status==='STOPPED'){
    if(!operator)throw Error('ROSTER_STOP_OPERATOR_REQUIRED');
   }else this.checkStop(principal.tenantId);
   // DONE is an operator projection after separately verified receipt/effect proof.
   // Neither a browser-reported state nor WS delivery ACK is execution evidence.
   if(input.status==='DONE'&&!operator)throw Error('ROSTER_DONE_OPERATOR_REQUIRED');
   if(row.sessionEpoch!==input.epoch||row.revision!==input.revision)throw Error('ROSTER_STALE_FENCE');
   if(!operator&&(!row.sessionId||principal.sessionId!==row.sessionId))throw Error('ROSTER_SESSION_DENIED');
   if(row.status==='BLOCKED'&&input.status!=='REVIEW'&&!operator)throw Error('ROSTER_REVIEW_REQUIRED');
   if(row.status==='STOPPED'||!rosterAllowed[row.status].has(input.status))throw Error('ROSTER_TRANSITION_DENIED');
   const old=this.db.prepare('SELECT 1 FROM lcg1_roster_events WHERE tenantId=? AND agentId=? AND eventKey=?')
      .get(row.tenantId,row.agentId,input.eventKey);
   if(old)throw Error('ROSTER_EVENT_REPLAY');
   const revision=nextRevision(row.revision),now=this.now();
   this.db.prepare('UPDATE lcg1_roster SET status=?,revision=?,updatedAt=?,heartbeatAt=? WHERE tenantId=? AND agentId=?')
      .run(input.status,revision,now,input.status==='WORKING'?now:row.heartbeatAt,row.tenantId,row.agentId);
   this.db.prepare('INSERT INTO lcg1_roster_events VALUES(?,?,?,?,?,?)')
      .run(row.tenantId,row.agentId,input.eventKey,input.status,revision,now);
   return this.row(row.tenantId,input.agentId);
  });
 }
 heartbeat(principal:AgentPrincipal,id:MissionRosterId,epoch:number,revision:number):MissionRosterEntry{
  ensureFence(epoch);ensureFence(revision);
  return this.transact(()=>{
   this.checkStop(principal.tenantId);
   const row=this.row(principal.tenantId,id);
   this.access(principal,row);
   if(row.sessionEpoch!==epoch||row.revision!==revision)throw Error('ROSTER_STALE_FENCE');
   if(row.sessionId&&row.sessionId!==principal.sessionId)throw Error('ROSTER_SESSION_DENIED');
   if(row.status!=='WORKING')throw Error('ROSTER_HEARTBEAT_DENIED');
   const at=this.now();
   this.db.prepare('UPDATE lcg1_roster SET heartbeatAt=?,updatedAt=?,revision=? WHERE tenantId=? AND agentId=?')
    .run(at,at,nextRevision(row.revision),row.tenantId,id);
   return this.row(row.tenantId,id);
  });
 }
 /** Stale work becomes BLOCKED for review, never DONE or auto-resumed. */
 fenceStale(principal:AgentPrincipal,id:MissionRosterId,thresholdMs:number):MissionRosterEntry{
  if(!this.operator(principal))throw Error('ROSTER_OPERATOR_REQUIRED');
  if(!Number.isSafeInteger(thresholdMs)||thresholdMs<1000)throw Error('ROSTER_THRESHOLD_INVALID');
  return this.transact(()=>{
   this.checkStop(principal.tenantId);
   const row=this.row(principal.tenantId,id);
   if(row.status!=='WORKING'||this.now()-row.heartbeatAt<thresholdMs)return row;
   this.db.prepare('UPDATE lcg1_roster SET status=?,revision=?,updatedAt=? WHERE tenantId=? AND agentId=?')
    .run('BLOCKED',nextRevision(row.revision),this.now(),row.tenantId,id);
   return this.row(row.tenantId,id);
  });
 }
 freshness(principal:AgentPrincipal,id:MissionRosterId,maxAgeMs:number):'NEVER'|'FRESH'|'STALE'{
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000)throw Error('ROSTER_THRESHOLD_INVALID');
  const row=this.get(principal,id);
  if(!row||!row.heartbeatAt)return 'NEVER';
  return this.now()-row.heartbeatAt>maxAgeMs?'STALE':'FRESH';
 }
}
