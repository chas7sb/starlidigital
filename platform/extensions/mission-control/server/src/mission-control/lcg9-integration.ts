import type {BridgePrincipal, BrowserEventStore} from './lcg3-browser-transport.js';
import {Lcg2MissionControlQueue} from './lcg2-queue.js';
import {evaluateBossWake, type BossSnapshot, type WakeResult} from './lcg5-boss-autopilot.js';

/**
 * Offline Mission Control integration boundary.
 * It does not send browser commands. Caller must independently authenticate
 * principals and verify approval records before invoking this layer.
 */
export type TrustedMissionControlGate = {
 verifyPrincipal(principal:BridgePrincipal):boolean;
 verifyApproval(input:{tenantId:string;taskId:string;revision:string}):boolean;
};
export class Lcg9MissionControlIntegration {
 constructor(
  private readonly queue:Lcg2MissionControlQueue,
  private readonly browserEvents:BrowserEventStore,
  private readonly gate:TrustedMissionControlGate={verifyPrincipal:()=>false,verifyApproval:()=>false},
 ) {}

 /** Replay existing durable queue events into tenant+device scoped bridge storage.
  * Source cursor is queue-scoped, NOT the bridge event cursor.
  * Retry is safe because the target store has a unique scoped event ID.
  */
 mirrorQueueEvents(principal:BridgePrincipal, after=0, limit=100) {
  if(!principal||!principal.tenantId||!principal.subjectId||!principal.deviceId||!this.gate.verifyPrincipal(principal))
   throw Error('MC_AUTHENTICATED_PRINCIPAL_REQUIRED');
  const events=this.queue.events(principal.tenantId,after,limit);
  let cursor=after;
  for(const event of events){
   this.browserEvents.publish({
    tenantId:principal.tenantId,
    deviceId:principal.deviceId,
    eventId:'mcq-'+event.seq,
    kind:'queue_status',
    body:{seq:event.seq,taskId:event.taskId,kind:event.kind,atMs:event.atMs},
   });
   cursor=event.seq;
  }
  return {sourceCursor:cursor,mirrored:events.length,hasMore:events.length===limit};
 }

 /** A recommendation only. No queue claim, approval, Chrome send or auto-continue. */
 evaluateWake(input:{
  snapshot:Readonly<BossSnapshot>;
  actorTenant:string;
  approval:{tenantId:string;taskId:string;revision:string;approved:boolean;requiresHuman:boolean};
  nowMs:number;currentUiCursor:string;uiIdleConfirmed:boolean;
 }):WakeResult {
  const {snapshot:s,actorTenant,approval:a,nowMs,currentUiCursor,uiIdleConfirmed}=input;
  if(!s||!a||actorTenant!==s.tenantId||a.tenantId!==actorTenant)
   return {decision:'INVALID_WORK',status:s?.mode??'OFFLINE',reason:'tenant approval mismatch'};
  const row=this.queue.get(actorTenant,a.taskId);
  if(!row||row.state!=='QUEUED'||!this.queue.wakeupCandidates(actorTenant,100).some(x=>x.taskId===a.taskId))
   return {decision:'NO_WORK',status:s.mode,reason:'no unlocked queued work'};
  if(a.revision!==row.taskId+':'+row.fence||!this.gate.verifyApproval({tenantId:actorTenant,taskId:a.taskId,revision:a.revision}))
   return {decision:'INVALID_WORK',status:s.mode,reason:'stale task approval revision'};
  return evaluateBossWake({
   snapshot:s,nowMs,currentUiCursor,uiIdleConfirmed,
   candidate:{id:row.taskId,tenantId:actorTenant,kind:'WORK_ITEM',status:'QUEUED',
    revision:a.revision,approved:a.approved,requiresHuman:a.requiresHuman},
  });
 }
}
