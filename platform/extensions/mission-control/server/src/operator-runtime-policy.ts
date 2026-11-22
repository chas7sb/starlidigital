import type { Store, RecordData } from './store.js';
import { now } from './store.js';
export const OPERATOR_DEFAULT_LIMITS = Object.freeze({maxSteps:64, maxToolCalls:128, timeoutMs:300000});
export const OPERATOR_TRUSTED_LIMITS = Object.freeze({maxSteps:256, maxToolCalls:512, timeoutMs:1800000});
export type OperatorOutcome = 'SUCCEEDED'|'BLOCKED'|'FAILED'|'INTERRUPTED'|'NEEDS_REVIEW';
export function operatorLimits(input:{maxSteps?:number;maxToolCalls?:number;timeoutMs?:number},trusted=false){
 const cap=trusted?OPERATOR_TRUSTED_LIMITS:OPERATOR_DEFAULT_LIMITS;
 const bound=(key:keyof typeof cap)=>{const value=input[key];return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.max(1,Math.min(cap[key],Math.floor(value))):OPERATOR_DEFAULT_LIMITS[key];};
 return {maxSteps:bound('maxSteps'),maxToolCalls:bound('maxToolCalls'),timeoutMs:bound('timeoutMs')};
}
export type FailureClass='RETRYABLE_INPUT'|'RETRYABLE_READ'|'BLOCKER'|'INTEGRATION_FAILURE'|'APPROVAL_REQUIRED'|'UNCERTAIN_SIDE_EFFECT';
export function classifyOperatorFailure(error:unknown,isWrite=false):{code:string;classification:FailureClass;retryable:boolean}{
 const e=error as {code?:string;extensions?:{code?:string};unknownOutcome?:boolean;sideEffectStarted?:boolean;message?:string};
 const code=String(e?.extensions?.code||e?.code||'TOOL_FAILED');
 let classification:FailureClass;
 if(e?.unknownOutcome||e?.sideEffectStarted||['NEEDS_REVIEW','OPERATION_IN_PROGRESS','INCERT'].includes(code)) classification='UNCERTAIN_SIDE_EFFECT';
 else if(['APPROVAL_REQUIRED','AWAITING_APPROVAL'].includes(code)) classification='APPROVAL_REQUIRED';
 else if(['FORBIDDEN','UNAUTHENTICATED','SUPPRESSED','OPTED_OUT','CANCELED'].includes(code)) classification='BLOCKER';
 else if(['BAD_USER_INPUT','INVALID_ARGUMENTS','NOT_FOUND','ENOENT'].includes(code)) classification='RETRYABLE_INPUT';
 else if(isWrite&&e?.sideEffectStarted!==false) classification='UNCERTAIN_SIDE_EFFECT';
 else if(['ETIMEDOUT','ECONNRESET','EAI_AGAIN','RATE_LIMITED','SERVICE_UNAVAILABLE'].includes(code)) classification='RETRYABLE_READ';
 else classification='INTEGRATION_FAILURE';
 return {code,classification,retryable:classification==='RETRYABLE_INPUT'||classification==='RETRYABLE_READ'};
}
// Timestamps and incidental request identifiers must not disguise unchanged tool output.
export function operatorEvidence(value:unknown):string {
 return JSON.stringify(value, (key,item)=> /^(?:updatedAt|createdAt|checkedAt|capabilityCheckedAt|timestamp|durationMs|elapsedMs|requestId|deduplicated)$/i.test(key)?undefined:
 item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
}
export class OperatorLoopGuard {
 private observations=new Map<string,number>(); private freshAt=0; private calls=0;
 private decisions=new Map<string,number>();
 reasoning(value:unknown){const key=operatorEvidence(value),n=(this.decisions.get(key)||0)+1;this.decisions.set(key,n);return n>=4;}
 observe(tool:string,result:unknown){
  const key=tool+':'+operatorEvidence(result),n=(this.observations.get(key)||0)+1;
  this.observations.set(key,n);this.calls++;
  if(n===1)this.freshAt=this.calls;
  return {repeated:n>=3,stalled:this.calls-this.freshAt>=8};
 }
}
/** Immutable durable run outcome. Recovery and live execution share the same receipt key. */
export function finishOperatorRun(store:Store,run:RecordData,status:OperatorOutcome,patch:Record<string,unknown>={}){
 const prior=store.get('operator-run-outcomes',run.id);if(prior)return store.get('operator-agent-runs',run.id)!;
 const timestamp=now(),receipt={id:run.id,version:1,runId:run.id,status,steps:run.steps||0,toolCalls:run.toolCalls||0,unknownOutcome:!!patch.unknownOutcome,errorCode:patch.errorCode||null,recordedAt:timestamp,completedAt:timestamp};
 const current=store.get('operator-agent-runs',run.id)||run;
 const completed={...current,...patch,status,completedAt:timestamp,updatedAt:timestamp,terminalReceipt:receipt};
 const nested=store.db.isTransaction; if(!nested)store.db.exec('BEGIN IMMEDIATE');
 try { // Recheck after acquiring the SQLite writer lock.
  if(store.get('operator-run-outcomes',run.id)){if(!nested)store.db.exec('COMMIT');return store.get('operator-agent-runs',run.id)!;}
  store.put('operator-run-outcomes',receipt,run.ownerId);store.put('operator-agent-runs',completed,run.ownerId);
  if(!nested)store.db.exec('COMMIT');return completed;
 } catch(error){if(!nested&&store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
}
