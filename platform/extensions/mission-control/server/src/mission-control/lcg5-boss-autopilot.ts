/**
 * LCG5 isolated, transport-neutral Boss autopilot decision engine.
 * Produces suggestions for an authorized dispatcher; NEVER clicks, sends or
 * synthesizes conversation messages. Caller must persist snapshots atomically.
 */
export type BossMode='IDLE'|'BUSY'|'WAITING_FOR_USER'|'OFFLINE';
export type WakeDecision='WAKE'|'NO_WORK'|'UI_BUSY'|'WAITING_FOR_USER'|'OFFLINE'|'LEASE_ACTIVE'|'UNCERTAIN_SEND'|'STALE_HEARTBEAT'|'STALE_CURSOR'|'NO_APPROVAL'|'INVALID_WORK';
export type WorkCandidate={
 id:string;tenantId:string;kind:'WORK_ITEM';revision:string;approved:boolean;
 requiresHuman:boolean;status:'QUEUED'|'RUNNING'|'DONE'|'CANCELLED';
};
export type BossSnapshot={
 tenantId:string;mode:BossMode;uiIdle:boolean;sessionGenerating:boolean;
 uiCursor:string;observedAtMs:number;lastHeartbeatMs:number;
 waitingReason?:string;inflight?:{workId:string;revision:string;nonce:string;claimedAtMs:number;state:'LEASED'|'SENT_UNCONFIRMED'};
};
export type WakeInput={
 snapshot:Readonly<BossSnapshot>;candidate?:Readonly<WorkCandidate>;
 nowMs:number;currentUiCursor:string;uiIdleConfirmed:boolean;
};
export type WakeResult={decision:WakeDecision;status:BossMode;workId?:string;reason:string};
const validId=(s:string)=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(s);
const HEARTBEAT_TTL_MS=30_000;
export function evaluateBossWake({snapshot:s,candidate:c,nowMs,currentUiCursor,uiIdleConfirmed}:WakeInput):WakeResult{
 const no=(decision:WakeDecision,reason:string):WakeResult=>({decision,status:s.mode,reason});
 if(!Number.isSafeInteger(nowMs)||nowMs<0||!validId(s.tenantId)||!validId(s.uiCursor)||!validId(currentUiCursor)||
    typeof s.uiIdle!=='boolean'||typeof uiIdleConfirmed!=='boolean'||typeof s.sessionGenerating!=='boolean')
  return no('INVALID_WORK','invalid state or clock');
 if(s.mode==='WAITING_FOR_USER')return no('WAITING_FOR_USER','human input required');
 if(s.mode==='OFFLINE')return no('OFFLINE','boss offline');
 if(s.inflight){
  // Unknown durable states may reflect an effect whose receipt was lost.
  // Never classify a corrupt reservation as a safely unattempted lease.
  return no(s.inflight.state==='LEASED'?'LEASE_ACTIVE':'UNCERTAIN_SEND',
   'existing reservation must be reconciled; never retry an uncertain send');
 }
 if(s.mode!=='IDLE'||!s.uiIdle||!uiIdleConfirmed||s.sessionGenerating)
  return no('UI_BUSY','UI is not confirmed idle');
 if(s.uiCursor!==currentUiCursor)return no('STALE_CURSOR','UI cursor changed');
 if(!Number.isSafeInteger(s.lastHeartbeatMs)||!Number.isSafeInteger(s.observedAtMs)||
    s.lastHeartbeatMs<0||s.observedAtMs<0||
    s.lastHeartbeatMs>nowMs||s.observedAtMs>nowMs||
    nowMs-s.lastHeartbeatMs>HEARTBEAT_TTL_MS||nowMs-s.observedAtMs>HEARTBEAT_TTL_MS)
  return no('STALE_HEARTBEAT','fresh UI heartbeat and observation required');
 if(!c)return no('NO_WORK','no queued server work');
 if(!validId(c.id)||!validId(c.revision)||c.tenantId!==s.tenantId||c.kind!=='WORK_ITEM'||c.status!=='QUEUED'||
    typeof c.approved!=='boolean'||typeof c.requiresHuman!=='boolean')
  return no('INVALID_WORK','work must be queued, tenant-bound and revision-bound');
 if(c.requiresHuman||!c.approved)return no('NO_APPROVAL','human barrier or missing approval');
 return {decision:'WAKE',status:'IDLE',workId:c.id,reason:'server candidate can be claimed once by authorized queue'};
}
export type Reservation={workId:string;revision:string;nonce:string;claimedAtMs:number;state:'LEASED'|'SENT_UNCONFIRMED'};
export function reserveBossWork(snapshot:Readonly<BossSnapshot>,candidate:Readonly<WorkCandidate>,
 nonce:string,nowMs:number,currentUiCursor:string,uiIdleConfirmed:boolean):BossSnapshot{
 const decision=evaluateBossWake({snapshot,candidate,nowMs,currentUiCursor,uiIdleConfirmed});
 if(decision.decision!=='WAKE')throw Error('BOSS_WAKE_DENIED:'+decision.decision);
 if(!validId(nonce))throw Error('INVALID_BOSS_NONCE');
 return {...snapshot,mode:'BUSY',inflight:{workId:candidate.id,revision:candidate.revision,nonce,claimedAtMs:nowMs,state:'LEASED'}};
}
/**
 * Fail-closed local STOP projection. The caller MUST persist this snapshot
 * with authoritative tenant/session/epoch STOP fencing in durable storage.
 * Never clear a lease or an uncertain browser send merely because STOP fired.
 * This helper performs NO browser/transport/provider action.
 */
export function stopBossAutopilot(snapshot:Readonly<BossSnapshot>):BossSnapshot{
 return {...snapshot,mode:'OFFLINE',uiIdle:false,sessionGenerating:false,
   observedAtMs:0,lastHeartbeatMs:0};
}
/** Atomic compare-and-swap expected from queue owner: this is a PURE transition. */
export function markBossSendAttempt(snapshot:Readonly<BossSnapshot>,nonce:string):BossSnapshot{
 if(snapshot.mode!=='BUSY'||!snapshot.inflight||
    !validId(snapshot.tenantId)||!validId(nonce)||
    snapshot.inflight.nonce!==nonce||
    !validId(snapshot.inflight.workId)||!validId(snapshot.inflight.revision)||
    !Number.isSafeInteger(snapshot.inflight.claimedAtMs)||
    snapshot.inflight.claimedAtMs<0||
    snapshot.inflight.state!=='LEASED')
  throw Error('BOSS_LEASE_MISMATCH');
 return {...snapshot,mode:'BUSY',inflight:{...snapshot.inflight,state:'SENT_UNCONFIRMED'}};
}
export type VerifiedBossReceipt={
  receiptId:string;tenantId:string;workId:string;revision:string;nonce:string;
  outcome:'COMPLETED'|'FAILED_NO_EFFECT'|'WAITING_FOR_USER';
  source:'AUTHENTICATED_BACKEND';
};
/**
 * A claimed outcome cannot clear an uncertain browser send. The trusted
 * server verifier MUST check receipt signature/provenance AND consume
 * receiptId exactly once in durable storage in the same transaction as
 * the state transition. This helper does not persist or transmit anything.
 */
export function reconcileBossReceipt(
 snapshot:Readonly<BossSnapshot>,
 receipt:Readonly<VerifiedBossReceipt>,
 verifyReceipt:(receipt:Readonly<VerifiedBossReceipt>)=>boolean,
):BossSnapshot{
 const pending=snapshot.inflight;
 if(snapshot.mode!=='BUSY'||!pending||!receipt||
    !validId(snapshot.tenantId)||
    !validId(pending.workId)||!validId(pending.revision)||!validId(pending.nonce)||
    !Number.isSafeInteger(pending.claimedAtMs)||pending.claimedAtMs<0||
    !validId(receipt.receiptId)||receipt.source!=='AUTHENTICATED_BACKEND'||
    receipt.tenantId!==snapshot.tenantId||
    receipt.workId!==pending.workId||receipt.revision!==pending.revision||
    receipt.nonce!==pending.nonce||
    !['COMPLETED','FAILED_NO_EFFECT','WAITING_FOR_USER'].includes(receipt.outcome))
   throw Error('BOSS_RECEIPT_NOT_VERIFIED');
 // All local state rejection MUST happen before invoking a potentially
 // one-shot external proof verifier that may consume the receipt atomically.
 if(pending.state==='LEASED'&&receipt.outcome!=='FAILED_NO_EFFECT')
   throw Error('BOSS_SEND_NOT_ATTEMPTED');
 if(!['LEASED','SENT_UNCONFIRMED'].includes(pending.state)||
    typeof verifyReceipt!=='function'||verifyReceipt(receipt)!==true)
   throw Error('BOSS_RECEIPT_NOT_VERIFIED');
 if(receipt.outcome==='WAITING_FOR_USER')
  return {...snapshot,inflight:undefined,mode:'WAITING_FOR_USER',
    uiIdle:false,observedAtMs:0,lastHeartbeatMs:0,waitingReason:'human response needed'};
 return {...snapshot,inflight:undefined,mode:'IDLE',uiIdle:false,
   observedAtMs:0,lastHeartbeatMs:0,waitingReason:undefined};
}

/**
 * Required server-derived identity, never reconstructed from client-supplied
 * fields. The durable owner (LCG2/LCG9) must independently verify active
 * grants, session/device generations and operator authority.
 */
export type BossProofIdentity={
 tenantId:string;sessionId:string;sessionEpoch:number;deviceId:string;grantGeneration:number;
};
export type BoundBossReceipt=VerifiedBossReceipt & BossProofIdentity;
export type BossReceiptAtomicCommit=(args:Readonly<{
 previous:Readonly<BossSnapshot>;next:Readonly<BossSnapshot>;
 receipt:Readonly<BoundBossReceipt>;identity:Readonly<BossProofIdentity>;
}>)=>boolean;
const validProofIdentity=(value:BossProofIdentity|undefined):boolean=>!!value&&
 validId(value.tenantId)&&validId(value.sessionId)&&validId(value.deviceId)&&
 Number.isSafeInteger(value.sessionEpoch)&&value.sessionEpoch>=1&&
 Number.isSafeInteger(value.grantGeneration)&&value.grantGeneration>=0;
const sameProofIdentity=(proof:BossProofIdentity,active:BossProofIdentity):boolean=>
 proof.tenantId===active.tenantId&&proof.sessionId===active.sessionId&&
 proof.deviceId===active.deviceId&&proof.sessionEpoch===active.sessionEpoch&&
 proof.grantGeneration===active.grantGeneration;

/**
 * Production entry point: validates local transition and complete binding
 * BEFORE requesting the trusted caller to atomically consume the receipt and
 * CAS the state. Returning true means COMMITTED, not simply "verified".
 *
 * The callback MUST perform authenticated proof validation, single-use
 * receiptId consumption, grant/STOP/session revalidation and durable state
 * mutation in ONE transaction; a standalone boolean verifier is insufficient.
 */
export function commitBoundBossReceipt(
 snapshot:Readonly<BossSnapshot>,receipt:Readonly<BoundBossReceipt>,
 active:Readonly<BossProofIdentity>,commit:BossReceiptAtomicCommit,
):BossSnapshot{
 if(!validProofIdentity(active)||!validProofIdentity(receipt)||
    receipt.tenantId!==snapshot.tenantId||!sameProofIdentity(receipt,active)||
    typeof commit!=='function')throw Error('BOSS_BOUND_RECEIPT_DENIED');
 // Compute eligibility without consuming proof or changing persistence.
 const next=reconcileBossReceipt(snapshot,receipt,()=>true);
 if(commit({previous:snapshot,next,receipt,identity:active})!==true)
  throw Error('BOSS_BOUND_RECEIPT_NOT_COMMITTED');
 return next;
}

export type VerifiedHumanInput={
 tenantId:string;sessionId:string;sessionEpoch:number;eventId:string;
 previousUiCursor:string;nextUiCursor:string;
};
/**
 * Human barrier is released ONLY after an authoritative server verifier has
 * checked signed/authorized user input, bound to exact tenant and session.
 * Extension idle reports and cursor changes are never sufficient evidence.
 */
export function acknowledgeUserInput(
 snapshot:Readonly<BossSnapshot>,
 event:Readonly<VerifiedHumanInput>,
 context:Readonly<{tenantId:string;sessionId:string;sessionEpoch:number}>,
 verifyHumanInput:(event:Readonly<VerifiedHumanInput>)=>boolean,
):BossSnapshot{
 if(snapshot.mode!=='WAITING_FOR_USER'||snapshot.inflight||
    !validId(snapshot.tenantId)||!validId(snapshot.uiCursor)||
    !validId(context?.tenantId)||!validId(context?.sessionId)||
    !Number.isSafeInteger(context?.sessionEpoch)||context.sessionEpoch<1||
    !validId(event?.tenantId)||
    !validId(event?.eventId)||!validId(event?.sessionId)||
    !validId(event?.previousUiCursor)||!validId(event?.nextUiCursor)||
    !Number.isSafeInteger(event?.sessionEpoch)||event.sessionEpoch<1||
    event.previousUiCursor!==snapshot.uiCursor||
    event.nextUiCursor===snapshot.uiCursor||
    event.tenantId!==snapshot.tenantId||event.tenantId!==context.tenantId||
    event.sessionId!==context.sessionId||event.sessionEpoch!==context.sessionEpoch||
    typeof verifyHumanInput!=='function'||verifyHumanInput(event)!==true)
  throw Error('BOSS_HUMAN_INPUT_NOT_VERIFIED');
 return {...snapshot,mode:'IDLE',uiCursor:event.nextUiCursor,
   uiIdle:false,waitingReason:undefined,observedAtMs:0,lastHeartbeatMs:0};
}

export type BoundHumanInput=VerifiedHumanInput & {
 deviceId:string;grantGeneration:number;
};
export type BossHumanAtomicCommit=(args:Readonly<{
 previous:Readonly<BossSnapshot>;next:Readonly<BossSnapshot>;
 event:Readonly<BoundHumanInput>;identity:Readonly<BossProofIdentity>;
}>)=>boolean;
/** Production manual-input entry point with server-authenticated device and grant binding. */
export function commitBoundBossHumanInput(
 snapshot:Readonly<BossSnapshot>,event:Readonly<BoundHumanInput>,
 active:Readonly<BossProofIdentity>,commit:BossHumanAtomicCommit,
):BossSnapshot{
 if(!validProofIdentity(active)||!event||
    !validProofIdentity({tenantId:event.tenantId,sessionId:event.sessionId,
      sessionEpoch:event.sessionEpoch,deviceId:event.deviceId,grantGeneration:event.grantGeneration})||
    !sameProofIdentity(event,active)||snapshot.tenantId!==active.tenantId||
    typeof commit!=='function')throw Error('BOSS_BOUND_HUMAN_DENIED');
 const next=acknowledgeUserInput(snapshot,event,active,()=>true);
 if(commit({previous:snapshot,next,event,identity:active})!==true)
  throw Error('BOSS_BOUND_HUMAN_NOT_COMMITTED');
 return next;
}

export function displayBossStatus(s:Readonly<BossSnapshot>){
 return {role:'ULTRA_BOSS' as const,mode:s.mode,needsUser:s.mode==='WAITING_FOR_USER',
  hasUnresolvedReservation:!!s.inflight,
  // Unknown persisted reservation states may represent an attempted send.
  // Never suppress the warning merely because storage contains corrupt data.
  hasUnresolvedSend:!!s.inflight&&s.inflight.state!=='LEASED',
  currentWorkId:s.inflight?.workId??null,
  // Read-only signal only; does not certify freshness or authorize dispatch.
  uiIdleReported:s.mode==='IDLE'&&s.uiIdle===true&&s.sessionGenerating===false&&!s.inflight&&
    validId(s.tenantId)&&validId(s.uiCursor)&&
    Number.isSafeInteger(s.observedAtMs)&&s.observedAtMs>=0&&
    Number.isSafeInteger(s.lastHeartbeatMs)&&s.lastHeartbeatMs>=0};
}

/** Permanent logical identity survives browser tab and conversation rotation. */
export const ULTRA_BOSS_PERMANENT_ID='ultra-boss-primary';
export type BossCoordinator={
  bossId:typeof ULTRA_BOSS_PERMANENT_ID;
  tenantId:string;
  coordinatorId:string;
  epoch:number;
  sessionId:string;
  leaseUntilMs:number;
};
export type BossRotation={
  fromSessionId:string;
  toSessionId:string;
  checkpointId:string;
  epoch:number;
  acknowledgement:'PENDING'|'ACKED';
};
/** Return a fenced new coordinator lease only from a confirmed durable CAS. */
export function evaluateCoordinatorLease(
  current:Readonly<BossCoordinator>|undefined,
  incoming:Readonly<BossCoordinator>,
  nowMs:number,
  expectedEpoch:number,
):'ACCEPT'|'DENY'{
  if(incoming.bossId!==ULTRA_BOSS_PERMANENT_ID||
     !validId(incoming.tenantId)||!validId(incoming.coordinatorId)||!validId(incoming.sessionId)||
     !Number.isSafeInteger(nowMs)||nowMs<0||
     !Number.isSafeInteger(incoming.epoch)||incoming.epoch<1||incoming.epoch>=Number.MAX_SAFE_INTEGER||
     !Number.isSafeInteger(expectedEpoch)||expectedEpoch<0||
     !Number.isSafeInteger(incoming.leaseUntilMs)||incoming.leaseUntilMs<=nowMs)
    return 'DENY';
  if(!current)return incoming.epoch===1&&expectedEpoch===0?'ACCEPT':'DENY';
  if(current.bossId!==ULTRA_BOSS_PERMANENT_ID||
     !validId(current.tenantId)||!validId(current.coordinatorId)||!validId(current.sessionId)||
     !Number.isSafeInteger(current.epoch)||current.epoch<1||current.epoch>=Number.MAX_SAFE_INTEGER||
     !Number.isSafeInteger(current.leaseUntilMs)||current.leaseUntilMs<0||
     current.tenantId!==incoming.tenantId||
     expectedEpoch!==current.epoch||incoming.epoch!==current.epoch+1)
    return 'DENY';
  // No epoch handoff may supersede a live lease, even from the same
  // coordinator: an unconfirmed browser send may belong to that epoch.
  // Same-coordinator lease renewal must use a separate durable CAS operation.
  if(current.leaseUntilMs>nowMs)
    return 'DENY';
  return 'ACCEPT';
}
/**
 * Rotation cannot erase uncertain sends or human barriers. Only an ACK from
 * the new session with a matching durable checkpoint permits completion.
 * Caller must apply this transition in the same durable transaction as
 * session-epoch fencing and checkpoint ACK (owned by LCG1/LCG2).
 */
export function rotateBossSession(
  snapshot:Readonly<BossSnapshot>,
  coordinator:Readonly<BossCoordinator>,
  rotation:Readonly<BossRotation>,
  currentEpoch:number,
  verifyCheckpointAck:(rotation:Readonly<BossRotation>)=>boolean,
):BossSnapshot{
  if(coordinator.bossId!==ULTRA_BOSS_PERMANENT_ID||
     !validId(snapshot.tenantId)||!validId(snapshot.uiCursor)||
     !['IDLE','WAITING_FOR_USER','BUSY','OFFLINE'].includes(snapshot.mode)||
     !validId(coordinator.tenantId)||!validId(coordinator.coordinatorId)||
     !validId(coordinator.sessionId)||
     !Number.isSafeInteger(coordinator.leaseUntilMs)||coordinator.leaseUntilMs<0||
     coordinator.tenantId!==snapshot.tenantId||
     !validId(rotation.checkpointId)||!validId(rotation.fromSessionId)||
     !validId(rotation.toSessionId)||rotation.fromSessionId===rotation.toSessionId||
     rotation.fromSessionId!==coordinator.sessionId||
     !Number.isSafeInteger(coordinator.epoch)||coordinator.epoch<1||
     !Number.isSafeInteger(currentEpoch)||currentEpoch<1||
     !Number.isSafeInteger(rotation.epoch)||rotation.epoch<1||
     coordinator.epoch>=Number.MAX_SAFE_INTEGER||
     currentEpoch>=Number.MAX_SAFE_INTEGER||
     rotation.epoch!==coordinator.epoch+1||rotation.epoch!==currentEpoch+1||
     rotation.acknowledgement!=='ACKED')
    throw Error('BOSS_ROTATION_NOT_ACKNOWLEDGED');
  // Do not consume an external one-time checkpoint ACK if the local Boss
  // state is ineligible for rotation.
  if(snapshot.inflight||snapshot.mode==='BUSY')
    throw Error('BOSS_ROTATION_UNRESOLVED_SEND');
  if(snapshot.mode==='OFFLINE')
    throw Error('BOSS_ROTATION_OFFLINE');
  if(typeof verifyCheckpointAck!=='function'||verifyCheckpointAck(rotation)!==true)
    throw Error('BOSS_ROTATION_NOT_ACKNOWLEDGED');
  return {...snapshot,mode:snapshot.mode==='WAITING_FOR_USER'?'WAITING_FOR_USER':'IDLE',
    uiIdle:false,sessionGenerating:false,uiCursor:rotation.checkpointId,
    observedAtMs:0,lastHeartbeatMs:0};
}

/**
 * P0 one-shot browser-command lifecycle contract for the Codex2 integrator.
 * Transport-neutral: neither a Mission Control WSS delivery ACK nor a legacy
 * /browser-bridge/v1 receipt nor COPY_MANUALLY is execution evidence.
 * A trusted store must CAS the entire transition and consume each proof once.
 */
export type BossCommandPhase=
 'WAITING_FOR_USER'|'APPROVED'|'SENT_UNCONFIRMED'|'DELIVERY_ACKED'|
 'UNKNOWN'|'EXECUTED'|'FAILED_NO_EFFECT'|'EXPIRED'|'STOPPED';
export type BossCommandBinding=BossProofIdentity&{
 commandId:string;commandRevision:string;tabSessionId:string;
};
export type BossCommandLifecycle=BossCommandBinding&{
 phase:BossCommandPhase;stateRevision:number;
 approvalExpiresAtMs:number;approvalId?:string;executionReceiptId?:string;
 deliveryEventId?:string;
 executionUncertain?:boolean;
};
export type BossHumanCommandApproval=BossCommandBinding&{
 approvalId:string;actor:'HUMAN_OPERATOR';issuedAtMs:number;expiresAtMs:number;
};
export type BossDeliveryAck=BossCommandBinding&{
 eventId:string;provenance:'DURABLE_EVENT_ACK';
};
export type BossExecutionEvidence=BossCommandBinding&{
 receiptId:string;outcome:'EXECUTED'|'FAILED_NO_EFFECT';
 provenance:'VERIFIED_EXECUTION';executedAtMs:number;
};
export type BossCommandCommit<T>=(
 transition:Readonly<{previous:Readonly<BossCommandLifecycle>;next:Readonly<BossCommandLifecycle>;
 proof?:Readonly<T>}>
)=>boolean;
const validCommandBinding=(b:BossCommandBinding|undefined):boolean=>
 !!b&&validProofIdentity(b)&&validId(b.commandId)&&validId(b.commandRevision)&&
 validId(b.tabSessionId);
const sameCommandBinding=(a:BossCommandBinding,b:BossCommandBinding)=>
 sameProofIdentity(a,b)&&a.commandId===b.commandId&&
 a.commandRevision===b.commandRevision&&a.tabSessionId===b.tabSessionId;
const safeNow=(nowMs:number)=>Number.isSafeInteger(nowMs)&&nowMs>=0;
const validLifecycle=(s:BossCommandLifecycle):boolean=>
 validCommandBinding(s)&&Number.isSafeInteger(s.stateRevision)&&s.stateRevision>=0&&
 safeNow(s.approvalExpiresAtMs);
const commitCommand=<T>(
 previous:Readonly<BossCommandLifecycle>,next:BossCommandLifecycle,
 commit:BossCommandCommit<T>,proof?:Readonly<T>,
):BossCommandLifecycle=>{
 if(typeof commit!=='function'||commit({previous,next,proof})!==true)
  throw Error('BOSS_COMMAND_CAS_DENIED');
 return next;
};
/** Caller must authenticate a *human* operator independently, verify CSRF
 * and approval signature, consume approvalId once, and CAS state+grant+STOP
 * in the very same durable transaction. Agent-originated text is never proof. */
export function approveBossCommand(
 previous:Readonly<BossCommandLifecycle>,
 approval:Readonly<BossHumanCommandApproval>,
 active:Readonly<BossCommandBinding>,
 nowMs:number,
 verifyAuthorizedHuman:(proof:Readonly<BossHumanCommandApproval>)=>boolean,
 commit:BossCommandCommit<BossHumanCommandApproval>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||!validCommandBinding(active)||!approval||
    !validCommandBinding(approval)||!sameCommandBinding(previous,active)||
    !sameCommandBinding(approval,active)||
    previous.phase!=='WAITING_FOR_USER'||!safeNow(nowMs)||
    !validId(approval.approvalId)||approval.actor!=='HUMAN_OPERATOR'||
    !safeNow(approval.issuedAtMs)||!safeNow(approval.expiresAtMs)||
    approval.issuedAtMs>nowMs||approval.expiresAtMs<=nowMs||
    approval.expiresAtMs<=approval.issuedAtMs||
    approval.expiresAtMs-approval.issuedAtMs>15*60_000||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER||
    typeof verifyAuthorizedHuman!=='function'||
    verifyAuthorizedHuman(approval)!==true)
  throw Error('BOSS_HUMAN_COMMAND_APPROVAL_DENIED');
 return commitCommand(previous,{...previous,phase:'APPROVED',
   approvalId:approval.approvalId,
   approvalExpiresAtMs:approval.expiresAtMs,
   stateRevision:previous.stateRevision+1},commit,approval);
}
/** Must durably claim BEFORE handing anything to browser/legacy bridge.
 * After this boundary loss of receipt is UNKNOWN, never retry the effect. */
export function claimApprovedBossCommand(
 previous:Readonly<BossCommandLifecycle>,active:Readonly<BossCommandBinding>,
 nowMs:number,eventId:string,commit:BossCommandCommit<never>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||!validCommandBinding(active)||
    !validId(eventId)||!sameCommandBinding(previous,active)||previous.phase!=='APPROVED'||
    !validId(previous.approvalId!)||!safeNow(nowMs)||
    nowMs>=previous.approvalExpiresAtMs||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER)
  throw Error('BOSS_COMMAND_DISPATCH_DENIED');
 return commitCommand(previous,{...previous,phase:'SENT_UNCONFIRMED',
   deliveryEventId:eventId,stateRevision:previous.stateRevision+1},commit);
}
/** Delivery ACK is transport metadata, NEVER proof of browser execution. */
export function acknowledgeBossDelivery(
 previous:Readonly<BossCommandLifecycle>,ack:Readonly<BossDeliveryAck>,
 active:Readonly<BossCommandBinding>,
 verifyDurableAck:(ack:Readonly<BossDeliveryAck>)=>boolean,
 commit:BossCommandCommit<BossDeliveryAck>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||!validCommandBinding(active)||!ack||
    !validCommandBinding(ack)||!sameCommandBinding(previous,active)||
    !sameCommandBinding(ack,active)||!validId(ack.eventId)||
    ack.eventId!==previous.deliveryEventId||
    ack.provenance!=='DURABLE_EVENT_ACK'||
    previous.phase!=='SENT_UNCONFIRMED'||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER||
    typeof verifyDurableAck!=='function'||verifyDurableAck(ack)!==true)
  throw Error('BOSS_DELIVERY_ACK_DENIED');
 return commitCommand(previous,{...previous,phase:'DELIVERY_ACKED',
   stateRevision:previous.stateRevision+1},commit,ack);
}
/** Timeout, transport loss, COPY_MANUALLY and ambiguous legacy receipts all
 * become UNKNOWN; an expired approval can NEVER cause automatic replay. */
export function markBossCommandUnknown(
 previous:Readonly<BossCommandLifecycle>,commit:BossCommandCommit<never>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||
    !['SENT_UNCONFIRMED','DELIVERY_ACKED'].includes(previous.phase)||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER)
  throw Error('BOSS_COMMAND_UNKNOWN_DENIED');
 return commitCommand(previous,{...previous,phase:'UNKNOWN',
   stateRevision:previous.stateRevision+1},commit);
}
/** An expired approval before dispatch must stay inert, not become UNKNOWN. */
export function expireBossCommand(
 previous:Readonly<BossCommandLifecycle>,nowMs:number,
 commit:BossCommandCommit<never>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||!safeNow(nowMs)||
    !['WAITING_FOR_USER','APPROVED'].includes(previous.phase)||
    (previous.phase==='APPROVED'&&nowMs<previous.approvalExpiresAtMs)||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER)
  throw Error('BOSS_COMMAND_EXPIRE_DENIED');
 return commitCommand(previous,{...previous,phase:'EXPIRED',
   stateRevision:previous.stateRevision+1},commit);
}
/** STOP is a final immutable fence. It preserves the uncertainty flag for
 * attempted effects but never permits post-STOP success or redispatch. */
export function stopBossCommand(
 previous:Readonly<BossCommandLifecycle>,commit:BossCommandCommit<never>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||previous.stateRevision>=Number.MAX_SAFE_INTEGER||
    ['EXECUTED','FAILED_NO_EFFECT','EXPIRED','STOPPED'].includes(previous.phase))
  throw Error('BOSS_COMMAND_STOP_DENIED');
 return commitCommand(previous,{...previous,phase:'STOPPED',
   executionUncertain:['SENT_UNCONFIRMED','DELIVERY_ACKED','UNKNOWN'].includes(previous.phase),
   stateRevision:previous.stateRevision+1},commit);
}
/** Executed can ONLY be recorded with independently authenticated execution
 * evidence matching exact tenant/command revision/tab/session/device/grant.
 * Store callback must validate provenance, consume receiptId single-use and
 * atomically CAS STOP/grant/state; WSS ACK and COPY_MANUALLY cannot pass here. */
export function confirmBossExecution(
 previous:Readonly<BossCommandLifecycle>,
 evidence:Readonly<BossExecutionEvidence>,
 active:Readonly<BossCommandBinding>,
 nowMs:number,
 verifyActualExecution:(proof:Readonly<BossExecutionEvidence>)=>boolean,
 commit:BossCommandCommit<BossExecutionEvidence>,
):BossCommandLifecycle{
 if(!validLifecycle(previous)||!validCommandBinding(active)||
    !evidence||!validCommandBinding(evidence)||
    !sameCommandBinding(previous,active)||!sameCommandBinding(evidence,active)||
    !['SENT_UNCONFIRMED','DELIVERY_ACKED','UNKNOWN'].includes(previous.phase)||
    evidence.provenance!=='VERIFIED_EXECUTION'||
    !['EXECUTED','FAILED_NO_EFFECT'].includes(evidence.outcome)||
    !validId(evidence.receiptId)||!safeNow(nowMs)||
    !safeNow(evidence.executedAtMs)||evidence.executedAtMs>nowMs||
    previous.stateRevision>=Number.MAX_SAFE_INTEGER||
    typeof verifyActualExecution!=='function'||
    verifyActualExecution(evidence)!==true)
  throw Error('BOSS_EXECUTION_RECEIPT_DENIED');
 return commitCommand(previous,{...previous,phase:evidence.outcome,
   executionReceiptId:evidence.receiptId,
   stateRevision:previous.stateRevision+1},commit,evidence);
}

/**
 * Read-only evidence/status projection. This does not claim that client- or
 * database-supplied proof fields are authenticated. The integrating host
 * must additionally confirm its independently verified, durable receipts.
 * Invalid/contradictory snapshots must never appear as execution success.
 */
export type BossCommandStatusEvidence={
 status:BossCommandPhase|'UNVERIFIED';
 commandId:string|null;
 commandRevision:string|null;
 tabSessionId:string|null;
 stateRevision:number|null;
 needsHumanApproval:boolean;
 approvalExpired:boolean;
 deliveryOnly:boolean;
 executionUncertain:boolean;
 hasExecutionReceipt:boolean;
 evidence:'NONE'|'HUMAN_APPROVAL_ONLY'|'DISPATCH_ATTEMPT'|
   'DELIVERY_ONLY'|'UNKNOWN_EFFECT'|'EXECUTION_RECEIPT_CLAIM'|'INVALID_STATE';
};
export function projectBossCommandStatus(
 snapshot:Readonly<BossCommandLifecycle>|undefined,
 nowMs:number,
):BossCommandStatusEvidence{
 const valid=!!snapshot&&validLifecycle(snapshot)&&safeNow(nowMs)&&
  (['WAITING_FOR_USER','APPROVED','SENT_UNCONFIRMED','DELIVERY_ACKED',
    'UNKNOWN','EXECUTED','FAILED_NO_EFFECT','EXPIRED','STOPPED'] as string[])
      .includes(snapshot.phase);
 const s=valid?snapshot!:undefined;
 const approved=!!s&&validId(s.approvalId!);
 const dispatched=approved&&!!s&&validId(s.deliveryEventId!);
 const done=dispatched&&!!s&&validId(s.executionReceiptId!);
 const consistent=!!s&&(
  s.phase==='WAITING_FOR_USER'||
  s.phase==='EXPIRED'||
  (s.phase==='APPROVED'&&approved)||
  (['SENT_UNCONFIRMED','DELIVERY_ACKED','UNKNOWN'].includes(s.phase)&&dispatched)||
  (['EXECUTED','FAILED_NO_EFFECT'].includes(s.phase)&&done)||
  (s.phase==='STOPPED'&&(!s.executionUncertain||dispatched))
 );
 const recognized=consistent?s:undefined;
 const phase=recognized?.phase??'UNVERIFIED';
 const unresolved=!!recognized&&(
  ['SENT_UNCONFIRMED','DELIVERY_ACKED','UNKNOWN'].includes(recognized.phase)||
  (recognized.phase==='STOPPED'&&recognized.executionUncertain===true));
 let evidence:BossCommandStatusEvidence['evidence']='INVALID_STATE';
 if(recognized){
  if(recognized.phase==='WAITING_FOR_USER'||recognized.phase==='EXPIRED'||recognized.phase==='STOPPED'&&!unresolved)
   evidence='NONE';
  else if(recognized.phase==='APPROVED')evidence='HUMAN_APPROVAL_ONLY';
  else if(recognized.phase==='SENT_UNCONFIRMED')evidence='DISPATCH_ATTEMPT';
  else if(recognized.phase==='DELIVERY_ACKED')evidence='DELIVERY_ONLY';
  else if(unresolved)evidence='UNKNOWN_EFFECT';
  else if(['EXECUTED','FAILED_NO_EFFECT'].includes(recognized.phase))
   evidence='EXECUTION_RECEIPT_CLAIM';
 }
 return {
  status:phase,
  commandId:recognized?.commandId??null,
  commandRevision:recognized?.commandRevision??null,
  tabSessionId:recognized?.tabSessionId??null,
  stateRevision:recognized?.stateRevision??null,
  needsHumanApproval:phase==='WAITING_FOR_USER',
  approvalExpired:!!recognized&&(
   phase==='EXPIRED'||(phase==='APPROVED'&&nowMs>=recognized.approvalExpiresAtMs)),
  deliveryOnly:phase==='DELIVERY_ACKED',
  executionUncertain:unresolved||phase==='UNVERIFIED',
  hasExecutionReceipt:!!recognized&&done&&
   ['EXECUTED','FAILED_NO_EFFECT'].includes(phase),
  evidence,
 };
}
