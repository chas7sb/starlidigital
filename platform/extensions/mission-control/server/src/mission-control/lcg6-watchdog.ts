/** Isolated Mission Control watchdog policy. No transport, provider, or browser sends. */
export type WorkState='QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'RETRY_WAIT'|'UNCERTAIN'|'CANCELLED'|'STOPPED';
export type FailureClass='TRANSIENT_SAFE'|'RATE_LIMIT'|'FATAL'|'POSSIBLY_SENT'|'UNKNOWN';
export type WorkItem={
 id:string;tenantId:string;state:WorkState;attempt:number;revision:number;leaseOwner?:string;leaseUntil?:number;
 nextRunAt:number;maxAttempts:number;idempotent:boolean;effectStarted:boolean;
 lastHeartbeat?:number;receipt?:string;note?:string;
};
export type LeaseClaim={item:WorkItem;token:{id:string;tenantId:string;attempt:number;revision:number;workerId:string}};
export type WatchdogPolicy={leaseMs:number;maxRetries:number;minRetryMs:number;maxRetryMs:number;maxInFlightPerTenant:number;globalMaxInFlight:number;maxPendingPerTenant:number};
export const DEFAULT_WATCHDOG_POLICY:WatchdogPolicy={leaseMs:45000,maxRetries:3,minRetryMs:1000,maxRetryMs:60000,maxInFlightPerTenant:2,globalMaxInFlight:20,maxPendingPerTenant:100};
export function validatePolicy(p:WatchdogPolicy){
 const positive=['leaseMs','minRetryMs','maxRetryMs','maxInFlightPerTenant','globalMaxInFlight','maxPendingPerTenant'] as const;
 if(positive.some(k=>!Number.isSafeInteger(p[k])||p[k]<1)||!Number.isSafeInteger(p.maxRetries)||p.maxRetries<0||p.maxRetries>20||p.minRetryMs>p.maxRetryMs)throw Error('INVALID_WATCHDOG_POLICY');
}
export function retryDelay(attempt:number,category:FailureClass,retryAfterMs:number|undefined,policy:WatchdogPolicy){
 validatePolicy(policy);
 if(category!=='TRANSIENT_SAFE'&&category!=='RATE_LIMIT')return undefined;
 if(!Number.isSafeInteger(attempt)||attempt<1)return undefined;
 const exponential=Math.min(policy.maxRetryMs,policy.minRetryMs*Math.pow(2,attempt-1));
 if(category==='RATE_LIMIT'){
  // Never create Infinity/NaN or an unbounded retry timestamp from server headers.
  // Respect valid Retry-After delays: a valid server delay can exceed policy max.
  if(!Number.isSafeInteger(retryAfterMs)||retryAfterMs!<0)return undefined;
  return Math.max(exponential,retryAfterMs!);
 }
 return exponential;
}
const clone=(i:WorkItem):WorkItem=>({...i});
const key=(tenantId:string,id:string)=>JSON.stringify([tenantId,id]);
const nextWorkRevision=(v:number)=>{if(!Number.isSafeInteger(v)||v<0||v>=Number.MAX_SAFE_INTEGER)throw Error('WORK_REVISION_EXHAUSTED');return v+1;};
/** Server-owned durable fence snapshot; NEVER accept directly from browser input. */
export type TrustedFleetFence={tenantId:string;generation:number;stopped:boolean;revoked:boolean};
export type TrustedFleetFenceReader=(tenantId:string)=>TrustedFleetFence;
/** In-memory model for deterministic testing; integration MUST implement each mutation as a fenced, durable SQLite transaction. */
export class WatchdogModel{
 private items=new Map<string,WorkItem>();
 private stopped=false;
 private fleetReader?:TrustedFleetFenceReader;
 private durableStopLatched=false;
 private tenantStopped=new Set<string>();
 private fleetGeneration=new Map<string,number>();
 /** Trusted storage adapter is bound once by the authenticated integrator. */
 attachTrustedFleetReader(reader:TrustedFleetFenceReader){
  if(typeof reader!=='function'||this.fleetReader)throw Error('INVALID_FLEET_READER');
  this.fleetReader=reader;
 }
 /** Operator/scheduler may poll, but claims/effects must also check synchronously.
  * Failed/malformed/rolled-back durable reads latch STOP (never fail-open). */
 reconcileTrustedFleet(tenantId:string){
  if(!this.fleetReader)throw Error('TRUSTED_FLEET_READER_NOT_CONFIGURED');
  try{
   const snapshot=this.fleetReader(tenantId);
   if(!snapshot||snapshot.tenantId!==tenantId||!Number.isSafeInteger(snapshot.generation)||snapshot.generation<0||
      typeof snapshot.stopped!=='boolean'||typeof snapshot.revoked!=='boolean'||
      snapshot.generation<(this.fleetGeneration.get(tenantId)??0))
    throw Error('INVALID_TRUSTED_FENCE');
   this.fleetGeneration.set(tenantId,snapshot.generation);
   if(snapshot.stopped||snapshot.revoked){this.durableStopLatched=true;this.tenantStopped.add(tenantId);}
   return {generation:snapshot.generation,stopped:this.stopped||this.tenantStopped.has(tenantId),revoked:snapshot.revoked};
  }catch{
   this.durableStopLatched=true;this.tenantStopped.add(tenantId);
   throw Error('TRUSTED_FLEET_FENCE_UNAVAILABLE');
  }
 }
 /** Active-command STOP fence. Durable store remains authoritative; this local
  * transition cannot substitute for transactional LCG2 STOP/CAS. */
 /** Emergency trust-registry loss: stop all locally active leases without
  * obtaining tenant identities from the unavailable external registry.
  * Actual distributed state must also be fenced transactionally in LCG2. */
 cancelAllActiveOnEmergencyStop(){
  // Registry trust loss is not a user-toggleable pause. Require verified
  // recovery via a new authenticated watchdog/session, not setStop(false).
  this.durableStopLatched=true;
  this.setStop(true);
  const active=[...this.items.values()].filter(i=>i.state==='RUNNING');
  // Preflight before changing any row. STOP stays latched if this fails.
  for(const i of active)nextWorkRevision(i.revision);
  let cancelled=0,uncertain=0;
  for(const i of active){
   if(!i.idempotent||i.effectStarted){i.state='UNCERTAIN';uncertain++;}
   else {i.state='STOPPED';cancelled++;}
   i.revision=nextWorkRevision(i.revision);
   delete i.leaseOwner;delete i.leaseUntil;
  }
  return {cancelled,uncertain};
 }
 cancelActiveOnTrustedStop(tenantId:string){
  if(!this.fleetReader)throw Error('TRUSTED_FLEET_READER_NOT_CONFIGURED');
  // Missing durable store already latches this tenant's STOP in the trusted
  // reader. Do not require a second healthy DB read to cancel local leases.
  let stopped=this.stopped||this.tenantStopped.has(tenantId);
  try{stopped=this.reconcileTrustedFleet(tenantId).stopped||stopped;}
  catch{stopped=true;}
  if(!stopped)return {cancelled:0,uncertain:0};
  const active=[...this.items.values()].filter(i=>i.tenantId===tenantId&&i.state==='RUNNING');
  // Preflight all revisions so no partially cancelled set is published.
  for(const i of active)nextWorkRevision(i.revision);
  let cancelled=0,uncertain=0;
  for(const i of active){
   if(!i.idempotent||i.effectStarted){i.state='UNCERTAIN';uncertain++;}
   else {i.state='STOPPED';cancelled++;}
   i.revision=nextWorkRevision(i.revision);
   delete i.leaseOwner;delete i.leaseUntil;
  }
  return {cancelled,uncertain};
 }
 private syncTrustedFleet(tenantId:string){
  if(this.fleetReader)this.reconcileTrustedFleet(tenantId);
  return !this.stopped&&!this.tenantStopped.has(tenantId);
 }

 public readonly policy:Readonly<WatchdogPolicy>;
 constructor(policy:WatchdogPolicy=DEFAULT_WATCHDOG_POLICY){
  validatePolicy(policy);
  // Snapshot validated values; neither caller mutation nor public object access
  // may change retry limits, leases or backpressure after construction.
  this.policy=Object.freeze({...policy});
 }
 setStop(stopped:boolean){if(typeof stopped!=='boolean')throw Error('INVALID_STOP_SIGNAL');if(stopped===false&&this.durableStopLatched)throw Error('DURABLE_STOP_LATCHED');this.stopped=stopped;}
 add(item:WorkItem){
  if(!item.id||!item.tenantId||typeof item.id!=='string'||typeof item.tenantId!=='string'||
     item.state!=='QUEUED'||item.attempt!==0||item.revision!==0||
     !Number.isSafeInteger(item.nextRunAt)||!Number.isSafeInteger(item.maxAttempts)||
     item.maxAttempts<1||item.maxAttempts>20||typeof item.idempotent!=='boolean'||item.effectStarted!==false||item.leaseOwner!==undefined||item.leaseUntil!==undefined||item.lastHeartbeat!==undefined||item.receipt!==undefined)throw Error('INVALID_WORK');
  const k=key(item.tenantId,item.id);if(this.items.has(k))throw Error('DUPLICATE_WORK');
  if([...this.items.values()].filter(x=>x.tenantId===item.tenantId&&!['SUCCEEDED','FAILED','CANCELLED','STOPPED'].includes(x.state)).length>=this.policy.maxPendingPerTenant)throw Error('QUEUE_BACKPRESSURE');
  this.items.set(k,clone(item));
 }
 get(tenantId:string,id:string){const item=this.items.get(key(tenantId,id));return item?clone(item):undefined;}
 list(tenantId:string){return [...this.items.values()].filter(i=>i.tenantId===tenantId).map(clone);}
 private matches(token:LeaseClaim['token']){const i=this.items.get(key(token.tenantId,token.id));if(!i||i.state!=='RUNNING'||i.leaseOwner!==token.workerId||i.revision!==token.revision||i.attempt!==token.attempt)throw Error('STALE_LEASE');return i;}
 private inflight(tenantId?:string){return [...this.items.values()].filter(i=>i.state==='RUNNING'&&(!tenantId||i.tenantId===tenantId)).length;}
 claim(tenantId:string,id:string,workerId:string,now:number):LeaseClaim|undefined{
  if(!this.syncTrustedFleet(tenantId))return undefined;
  if(!workerId||typeof workerId!=='string'||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CLAIM');
  if(this.inflight()>=this.policy.globalMaxInFlight||this.inflight(tenantId)>=this.policy.maxInFlightPerTenant)return undefined;
  const i=this.items.get(key(tenantId,id));
  if(!i||!['QUEUED','RETRY_WAIT'].includes(i.state)||i.nextRunAt>now)return undefined;
  if(i.effectStarted||i.attempt>=i.maxAttempts){const rev=nextWorkRevision(i.revision);i.state='UNCERTAIN';i.revision=rev;return undefined;}
  if(!Number.isSafeInteger(now+this.policy.leaseMs))throw Error('INVALID_LEASE_DEADLINE');
  const rev=nextWorkRevision(i.revision);
  i.state='RUNNING';i.attempt++;i.revision=rev;i.leaseOwner=workerId;i.leaseUntil=now+this.policy.leaseMs;i.lastHeartbeat=now;
  return {item:clone(i),token:{id:i.id,tenantId,attempt:i.attempt,revision:i.revision,workerId}};
 }
 heartbeat(token:LeaseClaim['token'],now:number,note?:string){
  this.syncTrustedFleet(token.tenantId);
  const i=this.matches(token);
  // A stopped worker must not renew the lease or change notes. Only
  // independently verified result observation may close outstanding work.
  if(this.stopped||this.tenantStopped.has(token.tenantId))throw Error('STOP_HEARTBEAT_DENIED');
  if(!Number.isSafeInteger(now)||now>=i.leaseUntil!||now<(i.lastHeartbeat??0))throw Error('LEASE_EXPIRED');
  if(note!==undefined&&(typeof note!=='string'||note.length>500))throw Error('NOTE_TOO_LONG');
  // Validate all conditions before changing ANY part of the active lease.
  if(!Number.isSafeInteger(now+this.policy.leaseMs))throw Error('INVALID_LEASE_DEADLINE');
  if(note!==undefined)i.note=note;
  i.lastHeartbeat=now;i.leaseUntil=now+this.policy.leaseMs;return clone(i);
 }
 /** Must be called and durably committed immediately BEFORE first non-idempotent external action. */
 markEffectStarted(token:LeaseClaim['token'],now:number){
  this.syncTrustedFleet(token.tenantId);
  const i=this.matches(token);if(this.stopped||this.tenantStopped.has(token.tenantId)||!Number.isSafeInteger(now)||now>=i.leaseUntil!||now<(i.lastHeartbeat??0))throw Error('STOP_OR_LEASE_EXPIRED');
  // A successful effect-start claim is a one-shot barrier. Repeated calls
  // cannot authorize a second externally visible browser/provider action.
  if(i.effectStarted)throw Error('EFFECT_ALREADY_STARTED');
  i.effectStarted=true;return clone(i);
 }
 finish(token:LeaseClaim['token'],now:number,receipt:string){
  const i=this.matches(token);
  // A worker's arbitrary receipt string is NOT independently verified
  // post-STOP effect evidence. Check shared durable STOP/revoke before
  // allowing normal completion; UNKNOWN requires operator reconciliation.
  if(this.fleetReader){
   this.syncTrustedFleet(token.tenantId);
   if(this.stopped||this.tenantStopped.has(token.tenantId))
    throw Error('STOP_COMPLETION_REQUIRES_RECONCILIATION');
  }
  if(!receipt||typeof receipt!=='string'||receipt.length>1024)throw Error('INVALID_RECEIPT');
  if(!Number.isSafeInteger(now)||now>=i.leaseUntil!||now<(i.lastHeartbeat??0))throw Error('LEASE_EXPIRED');
  // Non-idempotent externally visible work MUST record a one-shot effect-start
  // before the successful result is accepted. Prevent phantom success/receipt.
  if(!i.idempotent&&!i.effectStarted)throw Error('EFFECT_NOT_STARTED');
  const rev=nextWorkRevision(i.revision);
  i.state='SUCCEEDED';i.receipt=receipt;delete i.leaseOwner;delete i.leaseUntil;i.revision=rev;
  return clone(i);
 }
 fail(token:LeaseClaim['token'],now:number,kind:FailureClass,retryAfterMs?:number){
  // Re-read authoritative tenant STOP/revoke before classifying a stale
  // worker's result. A trusted-read failure must not mutate its lease.
  this.syncTrustedFleet(token.tenantId);
  const i=this.matches(token);
  if(!Number.isSafeInteger(now)||now<0||now<(i.lastHeartbeat??0))throw Error('INVALID_NOW');
  // Expired leases never empower mutation; recovery owns those.
  if(now>=i.leaseUntil!)throw Error('LEASE_EXPIRED');
  if(!(['TRANSIENT_SAFE','RATE_LIMIT','FATAL','POSSIBLY_SENT','UNKNOWN'] as string[]).includes(kind))throw Error('INVALID_FAILURE_CLASS');
  const rev=nextWorkRevision(i.revision);
  const delay=retryDelay(i.attempt,kind,retryAfterMs,this.policy);
  if(i.effectStarted||kind==='POSSIBLY_SENT'||kind==='UNKNOWN'||
     ((this.stopped||this.tenantStopped.has(token.tenantId))&&!i.idempotent)){
   // During STOP, even a stale worker reporting FATAL cannot establish
   // negative proof that an external non-idempotent action never occurred.
   i.state='UNCERTAIN';
  }
  else if(delay!==undefined&&Number.isSafeInteger(now+delay)&&i.idempotent&&
          !this.stopped&&!this.tenantStopped.has(token.tenantId)&&
          i.attempt<i.maxAttempts&&i.attempt<=this.policy.maxRetries){
   i.state='RETRY_WAIT';i.nextRunAt=now+delay;
  }
  else{i.state='FAILED';}
  delete i.leaseOwner;delete i.leaseUntil;i.revision=rev;return clone(i);
 }
 recover(now:number){
  if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_NOW');
  // Check every running tenant against authoritative STOP/revoke before
  // changing any local recovery item. A failed trusted read aborts this sweep.
  if(this.fleetReader){
   const tenants=new Set([...this.items.values()].filter(i=>i.state==='RUNNING').map(i=>i.tenantId));
   for(const tenantId of tenants)this.syncTrustedFleet(tenantId);
  }
  const report={safeRequeued:0,uncertain:0,unchanged:0};
  // All candidate fences preflight first: a saturated job cannot leave half the fleet recovered.
  for(const i of this.items.values())if(i.state==='RUNNING'&&(i.leaseUntil??Infinity)<=now)nextWorkRevision(i.revision);
  for(const i of this.items.values()){
   if(i.state!=='RUNNING'||(i.leaseUntil??Infinity)>now){report.unchanged++;continue;}
   // Even a worker that never committed its effectStart flag could have made an outbound send.
   // Require an explicitly idempotent/safe work type for any crash recovery attempt.
   if(!i.idempotent||i.effectStarted){i.state='UNCERTAIN';report.uncertain++;}
   else if(i.attempt<i.maxAttempts&&i.attempt<=this.policy.maxRetries&&!this.stopped&&!this.tenantStopped.has(i.tenantId)&&
      Number.isSafeInteger(now+this.policy.minRetryMs)){
    i.state='RETRY_WAIT';i.nextRunAt=now+this.policy.minRetryMs;report.safeRequeued++;
   }
   else{i.state='FAILED';}
   delete i.leaseOwner;delete i.leaseUntil;i.revision=nextWorkRevision(i.revision);
  }
  return report;
 }
 /** External positive evidence is mandatory; absence of a receipt is NOT proof of failure.
  * Operator authorization and cryptographic/provider receipt validation belong to the
  * trusted integration boundary. No reconciliation path ever queues or retries a send. */
 reconcile(tenantId:string,id:string,verifiedReceipt:string|undefined,operatorApproved:boolean){
  const i=this.items.get(key(tenantId,id));if(!i||i.state!=='UNCERTAIN')throw Error('NOT_UNCERTAIN');
  if(operatorApproved!==true)throw Error('OPERATOR_REVIEW_REQUIRED');
  if(!verifiedReceipt||typeof verifiedReceipt!=='string'||verifiedReceipt.length>1024)
   throw Error('VERIFIED_RECEIPT_REQUIRED');
  const rev=nextWorkRevision(i.revision);
  i.state='SUCCEEDED';i.receipt=verifiedReceipt;
  i.revision=rev;return clone(i);
 }
 /** Only externally VERIFIED non-execution can close UNKNOWN as terminal FAILED.
  * A bare operator click, expired HTTP timeout, no WS ACK, or missing DB receipt
  * is never sufficient. Proof is recorded for immutable operator audit review. */
 reconcileVerifiedNonExecution(tenantId:string,id:string,verifiedNegativeEvidence:string,operatorApproved:boolean){
  const i=this.items.get(key(tenantId,id));if(!i||i.state!=='UNCERTAIN')throw Error('NOT_UNCERTAIN');
  if(operatorApproved!==true)throw Error('OPERATOR_REVIEW_REQUIRED');
  if(!verifiedNegativeEvidence||typeof verifiedNegativeEvidence!=='string'||verifiedNegativeEvidence.length>1024)
   throw Error('VERIFIED_NON_EXECUTION_REQUIRED');
  const rev=nextWorkRevision(i.revision);
  i.state='FAILED';i.note='Verified non-execution: '+verifiedNegativeEvidence;
  i.revision=rev;return clone(i);
 }
}


/** Trusted poll adapter: host supplies durable fleet reader to WatchdogModel,
 * tenant list and socket cancellation. This never issues a browser command.
 * Unlike a network ACK, callback completion is NOT evidence of execution. */
export function startTrustedWatchdogStopMonitor(options:{
 watchdog:WatchdogModel;tenantIds:()=>readonly string[];
 closeTenantSockets:(tenantId:string)=>void;
 /** Production host must supply an all-socket shutdown for trusted registry failures. */
 closeAllSockets?:()=>void;intervalMs?:number;
}){
 if(!options||!(options.watchdog instanceof WatchdogModel)||
  typeof options.tenantIds!=='function'||typeof options.closeTenantSockets!=='function')
  throw Error('TRUSTED_STOP_MONITOR_REQUIRED');
 const intervalMs=options.intervalMs??1000;
 if(!Number.isSafeInteger(intervalMs)||intervalMs<250||intervalMs>5000)
  throw Error('INVALID_STOP_MONITOR_INTERVAL');
 let closed=false,busy=false;
 const alreadyClosed=new Set<string>();
 const poll=()=>{
  if(closed||busy)return;
  busy=true;
  try{
   const ids=options.tenantIds();
   if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||id.length===0))
    throw Error('INVALID_TRUSTED_TENANTS');
   for(const tenantId of new Set(ids)){
    let stop=false;
    try{
     const fence=options.watchdog.reconcileTrustedFleet(tenantId);
     stop=fence.stopped;
    }catch{stop=true;}
    if(!stop)continue;
    // Signal STOP to local sockets before touching active jobs. If callback
    // fails, do not claim closure; retry next poll, while claims already deny.
    if(!alreadyClosed.has(tenantId)){
     try{options.closeTenantSockets(tenantId);alreadyClosed.add(tenantId);}
     catch{/* Retry socket closure on next sweep, but never retain a live command lease. */}
    }
    options.watchdog.cancelActiveOnTrustedStop(tenantId);
   }
  }catch{
   // A throwing trusted tenant registry or cancellation invariant must not
   // escape setInterval and crash the process while leaving effects runnable.
   // Global emergency STOP blocks all new claims/effects; the host callback
   // closes sockets when tenant identities cannot be trusted.
   try{options.watchdog.cancelAllActiveOnEmergencyStop();}
   catch{options.watchdog.setStop(true);}
   try{options.closeAllSockets?.();}catch{/* STOP remains latched. */}
  }finally{busy=false;}
 };
 const timer=setInterval(poll,intervalMs);
 timer.unref();
 return {poll,close:()=>{closed=true;clearInterval(timer);}};
}

/** Context risk is an operator-supplied signal, never a claimed measurement of model tokens.
 * No task dispatch, browser send, or automatic session creation happens here. */
export type ContextRiskSignal={
 tenantId:string;agentId:string;sessionId:string;sessionEpoch:number;
 observationAt:number;estimatedUtilization?:number;continuityRequested?:boolean;heartbeatAt?:number;
};
export type ContextRiskDecision={level:'NORMAL'|'WARNING'|'ROTATION_REQUESTED'|'UNKNOWN';reason:string;requiresCheckpoint:boolean;autoWakeAllowed:false};
export function evaluateContextRisk(signal:ContextRiskSignal,now:number,staleAfterMs=120000):ContextRiskDecision{
 if(!signal.tenantId||!signal.agentId||!signal.sessionId||!Number.isSafeInteger(signal.sessionEpoch)||signal.sessionEpoch<1||
 !Number.isSafeInteger(now)||!Number.isSafeInteger(signal.observationAt)||signal.observationAt>now||
 !Number.isSafeInteger(staleAfterMs)||staleAfterMs<1000)
 throw Error('INVALID_CONTEXT_SIGNAL');
 if(signal.heartbeatAt!==undefined&&(!Number.isSafeInteger(signal.heartbeatAt)||signal.heartbeatAt>now))throw Error('INVALID_CONTEXT_HEARTBEAT');
 if((now-signal.observationAt)>staleAfterMs||(signal.heartbeatAt!==undefined&&(now-signal.heartbeatAt)>staleAfterMs))
 return {level:'UNKNOWN',reason:'SESSION_STALE_VERIFY_MANUALLY',requiresCheckpoint:true,autoWakeAllowed:false};
 if(signal.estimatedUtilization!==undefined&&(!Number.isFinite(signal.estimatedUtilization)||signal.estimatedUtilization<0||signal.estimatedUtilization>1))
 throw Error('INVALID_CONTEXT_ESTIMATE');
 if(signal.continuityRequested===true)
 return {level:'ROTATION_REQUESTED',reason:'MANUAL_OR_AGENT_ROTATION_REQUEST',requiresCheckpoint:true,autoWakeAllowed:false};
 if(signal.estimatedUtilization!==undefined&&signal.estimatedUtilization>=0.8)
 return {level:'WARNING',reason:'UNVERIFIED_CONTEXT_ESTIMATE',requiresCheckpoint:true,autoWakeAllowed:false};
 return {level:'NORMAL',reason:'NO_VERIFIED_RISK',requiresCheckpoint:false,autoWakeAllowed:false};
}

export type SessionLifecycle='ACTIVE'|'ROTATION_REQUESTED'|'WAITING_FOR_ACK'|'STALE'|'UNKNOWN'|'RETIRED';
export type SessionRecord={tenantId:string;agentId:string;sessionId:string;sessionEpoch:number;state:SessionLifecycle;checkpointId?:string;reconciliationEvidenceId?:string;lastSeenAt:number;revision:number;barrier:'NONE'|'WAITING_FOR_USER';hasUncertainSend:boolean};
export type SessionFence={tenantId:string;agentId:string;sessionId:string;sessionEpoch:number;revision:number};
const sessionKey=(tenantId:string,agentId:string)=>JSON.stringify([tenantId,agentId]);
/** Never lose session fencing precision by incrementing beyond IEEE-754 safe integers. */
const nextSessionFence=(v:number)=>{
 if(!Number.isSafeInteger(v)||v<0||v===Number.MAX_SAFE_INTEGER)throw Error('SESSION_FENCE_EXHAUSTED');
 return v+1;
};
/** Deterministic model only. LCG2 must persist sessions and rotate using SQLite compare-and-swap.
 * On unknown dispatch receipts, stale sessions remain blocked; there is no autonomous resend. */
export class SessionRecoveryModel{
 private sessions=new Map<string,SessionRecord>();
 private archived=new Map<string,SessionRecord[]>();
 private requireFence(fence:SessionFence){
  const record=this.sessions.get(sessionKey(fence.tenantId,fence.agentId));
  if(!record||record.sessionId!==fence.sessionId||record.sessionEpoch!==fence.sessionEpoch||record.revision!==fence.revision)
   throw Error('STALE_SESSION_FENCE');
  return record;
 }
 initialize(record:Omit<SessionRecord,'revision'>):SessionFence{
  if(typeof record.tenantId!=='string'||!record.tenantId||
   typeof record.agentId!=='string'||!record.agentId||
   typeof record.sessionId!=='string'||!record.sessionId||
   !Number.isSafeInteger(record.sessionEpoch)||record.sessionEpoch<1||
   record.sessionEpoch>=Number.MAX_SAFE_INTEGER||
   !Number.isSafeInteger(record.lastSeenAt)||record.lastSeenAt<0||
   record.state!=='ACTIVE'||
   (record.barrier!=='NONE'&&record.barrier!=='WAITING_FOR_USER')||
   record.hasUncertainSend!==false||
   record.reconciliationEvidenceId!==undefined||
   this.sessions.has(sessionKey(record.tenantId,record.agentId)))
  throw Error('SESSION_INIT_DENIED');
  this.sessions.set(sessionKey(record.tenantId,record.agentId),{...record,revision:1});
  return this.fence(record.tenantId,record.agentId);
 }
 fence(tenantId:string,agentId:string):SessionFence{
  const s=this.sessions.get(sessionKey(tenantId,agentId));if(!s)throw Error('SESSION_NOT_FOUND');
  return {tenantId,agentId,sessionId:s.sessionId,sessionEpoch:s.sessionEpoch,revision:s.revision};
 }
 get(tenantId:string,agentId:string){const s=this.sessions.get(sessionKey(tenantId,agentId));return s?{...s}:undefined;}
 history(tenantId:string,agentId:string){return (this.archived.get(sessionKey(tenantId,agentId))??[]).map(x=>({...x}));}
 heartbeat(fence:SessionFence,now:number){
  const s=this.requireFence(fence);
  if(!Number.isSafeInteger(now)||now<s.lastSeenAt||s.state!=='ACTIVE')throw Error('SESSION_HEARTBEAT_DENIED');
  const revision=nextSessionFence(s.revision);
  s.lastSeenAt=now;s.revision=revision;return this.fence(s.tenantId,s.agentId);
 }
 requestRotation(fence:SessionFence,checkpointId:string,now:number){
  const s=this.requireFence(fence);
  if(s.state!=='ACTIVE'||s.barrier!=='NONE'||s.hasUncertainSend)throw Error('ROTATION_BLOCKED');
  if(typeof checkpointId!=='string'||!checkpointId||checkpointId.length>160||!Number.isSafeInteger(now)||now<s.lastSeenAt)throw Error('INVALID_CHECKPOINT');
  const revision=nextSessionFence(s.revision);
  s.checkpointId=checkpointId;s.state='WAITING_FOR_ACK';s.lastSeenAt=now;s.revision=revision;return this.fence(s.tenantId,s.agentId);
 }
 markStale(tenantId:string,agentId:string,now:number,thresholdMs:number){
  const s=this.sessions.get(sessionKey(tenantId,agentId));if(!s)throw Error('SESSION_NOT_FOUND');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(thresholdMs)||thresholdMs<1||now<s.lastSeenAt)throw Error('INVALID_STALENESS_CHECK');
  if(now-s.lastSeenAt<thresholdMs)return false;
  // Preserve an unresolved receipt/previous stale disposition across
  // recurring watchdog sweeps. Do not mutate revision on no-op sweeps.
  if(s.state==='RETIRED'||s.state==='UNKNOWN'||s.state==='STALE')return false;
  const revision=nextSessionFence(s.revision);
  s.state=s.hasUncertainSend?'UNKNOWN':'STALE';s.revision=revision;return true;
 }
 markUncertainSend(fence:SessionFence){
  const s=this.requireFence(fence);
  if(s.state==='RETIRED')throw Error('SESSION_RETIRED');
  if(s.state==='UNKNOWN'||s.hasUncertainSend)throw Error('UNCERTAIN_ALREADY_RECORDED');
  const revision=nextSessionFence(s.revision);
  s.hasUncertainSend=true;s.state='UNKNOWN';s.revision=revision;return this.fence(s.tenantId,s.agentId);
 }
 /** Active session replacement is only possible with an explicit verified checkpoint ACK.
  * Do not infer ACK from mere tab creation, URL navigation or WS delivery. */
 acknowledgeRotation(oldFence:SessionFence,newSessionId:string,newEpoch:number,checkpointId:string,ackVerified:boolean,now:number){
  const s=this.requireFence(oldFence);
  if(s.state!=='WAITING_FOR_ACK'||ackVerified!==true||s.hasUncertainSend||s.barrier!=='NONE'||
   typeof newSessionId!=='string'||!newSessionId||newSessionId===s.sessionId||
   (this.archived.get(sessionKey(s.tenantId,s.agentId))??[]).some(old=>old.sessionId===newSessionId)||
   !Number.isSafeInteger(newEpoch)||newEpoch!==s.sessionEpoch+1||
   typeof checkpointId!=='string'||checkpointId!==s.checkpointId||!Number.isSafeInteger(now)||now<s.lastSeenAt||
   s.sessionEpoch>=Number.MAX_SAFE_INTEGER-1)
   throw Error('SESSION_ROTATION_NOT_VERIFIED');
  const nextRevision=nextSessionFence(s.revision);
  const key=sessionKey(s.tenantId,s.agentId);
  const old={...s,state:'RETIRED' as const};this.archived.set(key,[...(this.archived.get(key)??[]),old]);
  const next:SessionRecord={tenantId:s.tenantId,agentId:s.agentId,sessionId:newSessionId,sessionEpoch:newEpoch,
   state:'ACTIVE',checkpointId,barrier:'NONE',hasUncertainSend:false,lastSeenAt:now,revision:nextRevision};
  this.sessions.set(key,next);return this.fence(s.tenantId,s.agentId);
 }
 /** Explicit human-verified stale recovery, not auto-continue. In real storage this
  * entire epoch change and history append must be one fenced CAS transaction. */
 recoverStale(oldFence:SessionFence,newSessionId:string,checkpointId:string,checkpointVerified:boolean,operatorAuthorized:boolean,now:number){
  const s=this.requireFence(oldFence);
  if(s.state!=='STALE'||s.hasUncertainSend||s.barrier!=='NONE'||
     checkpointVerified!==true||operatorAuthorized!==true||typeof checkpointId!=='string'||!checkpointId||checkpointId.length>160||
     typeof newSessionId!=='string'||!newSessionId||newSessionId===s.sessionId||
     (this.archived.get(sessionKey(s.tenantId,s.agentId))??[]).some(old=>old.sessionId===newSessionId)||
     !Number.isSafeInteger(now)||now<s.lastSeenAt||s.sessionEpoch>=Number.MAX_SAFE_INTEGER-1)
     throw Error('STALE_RECOVERY_NOT_VERIFIED');
  const nextRevision=nextSessionFence(s.revision);
  const key=sessionKey(s.tenantId,s.agentId);
  this.archived.set(key,[...(this.archived.get(key)??[]),{...s,state:'RETIRED'}]);
  const next:SessionRecord={tenantId:s.tenantId,agentId:s.agentId,sessionId:newSessionId,
   sessionEpoch:s.sessionEpoch+1,state:'ACTIVE',checkpointId,barrier:'NONE',
   hasUncertainSend:false,lastSeenAt:now,revision:nextRevision};
  this.sessions.set(key,next);
  return this.fence(s.tenantId,s.agentId);
 }
 /** Manual recovery requires the integrator's independently VERIFIED non-send
  * evidence reference. A plain operator assertion is not sufficient.
  * This reference model checks shape only: LCG9 must authenticate evidence,
  * bind it to tenant/agent/session/command, and consume it atomically. */
 operatorRecoverUnknown(tenantId:string,agentId:string,expectedRevision:number,confirmedNoSend:boolean,authorized:boolean,now:number,verifiedNonSendEvidence?:string){
  const s=this.sessions.get(sessionKey(tenantId,agentId));
  if(!s||s.revision!==expectedRevision||s.state!=='UNKNOWN'||authorized!==true||confirmedNoSend!==true||
   !verifiedNonSendEvidence||typeof verifiedNonSendEvidence!=='string'||verifiedNonSendEvidence.length>256||
   s.barrier!=='NONE'||!Number.isSafeInteger(now)||now<s.lastSeenAt)
   throw Error('UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
  const revision=nextSessionFence(s.revision);
  s.state='STALE';s.hasUncertainSend=false;s.lastSeenAt=now;s.revision=revision;
  // Persist the reference with this retired-session lineage for an audit trail.
  // It is an opaque ID, NOT verification of the issuer or proof of non-execution.
  s.reconciliationEvidenceId=verifiedNonSendEvidence;
  // Still blocked: a separate checkpoint-based, verified rotation must be initiated by coordinator.
  return {...s};
 }
 /** Dispatch-time safety guard: NEVER trust cached ACTIVE status.
  * Caller must first load the current authoritative session snapshot and apply an
  * atomic DB epoch/fence check at command enqueue. This is a pure model check. */
 authorizeWake(tenantId:string,agentId:string,sessionId:string,epoch:number,now:number,heartbeatTtlMs:number){
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(heartbeatTtlMs)||heartbeatTtlMs<1000)
    throw Error('INVALID_WAKE_POLICY');
  const s=this.sessions.get(sessionKey(tenantId,agentId));
  if(!s)return {allowed:false,reason:'UNKNOWN_SESSION' as const};
  if(s.sessionId!==sessionId||s.sessionEpoch!==epoch)return {allowed:false,reason:'STALE_SESSION_FENCE' as const};
  if(s.barrier!=='NONE')return {allowed:false,reason:'WAITING_FOR_USER' as const};
  if(s.hasUncertainSend||s.state==='UNKNOWN')return {allowed:false,reason:'UNCERTAIN_RECEIPT' as const};
  if(s.state!=='ACTIVE')return {allowed:false,reason:'NOT_ACTIVE' as const};
  if(s.lastSeenAt>now||now-s.lastSeenAt>=heartbeatTtlMs)return {allowed:false,reason:'STALE_HEARTBEAT' as const};
  return {allowed:true,reason:'ACTIVE_FRESH' as const};
 }
 canWake(tenantId:string,agentId:string,sessionId:string,epoch:number){
  const s=this.sessions.get(sessionKey(tenantId,agentId));
  return Boolean(s&&s.state==='ACTIVE'&&s.sessionId===sessionId&&s.sessionEpoch===epoch&&s.barrier==='NONE'&&!s.hasUncertainSend);
 }
}
