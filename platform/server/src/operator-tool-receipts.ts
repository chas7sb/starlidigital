import{createHash}from'node:crypto';
import{Store,id,now,type RecordData}from'./store.js';
import{fail,type Context}from'./security.js';
import{requireOperator,redactSecrets}from'./operator-auth.js';
import type{OperatorToolCallResult}from'./operator-tools.js';

export type OperatorReceiptInput={store:Store;ctx:Context;conversationId:string;tool:string;args:Record<string,unknown>;requestId?:string;runId:string;signal?:AbortSignal;isWrite:boolean;retryInputFailure?:boolean};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const stable=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable((value as Record<string,unknown>)[key]))])):value??null);
const safe=(value:unknown)=>redactSecrets(String(value??'')).slice(0,4000);
const inputCodes=new Set(['BAD_USER_INPUT','INVALID_ARGUMENTS','NOT_FOUND','ENOENT','FORBIDDEN','UNAUTHENTICATED']);
function scope(input:OperatorReceiptInput){
 let messageId=String(input.args.messageId||'');
 if(input.tool==='send_proposal_sms'&&!messageId&&input.args.proposalId){const messages=input.store.list('outbound-messages').filter(m=>m.proposalId===input.args.proposalId&&m.kind==='COMMERCIAL_PROPOSAL');if(messages.length===1)messageId=messages[0].id;}
 if(input.tool==='send_proposal_sms'&&messageId){const message=input.store.get('outbound-messages',messageId);return{key:'sms:'+messageId,fingerprint:digest(stable({tool:input.tool,messageId,recipient:message?.recipientPhone||'',body:message?.body||''})),messageId};}
 if(input.tool==='send_proposal_email'&&input.args.proposalId&&input.args.recipient){const recipient=String(input.args.recipient).trim().toLowerCase();return{key:'email:'+input.args.proposalId+':'+digest(recipient),fingerprint:digest(stable({tool:input.tool,proposalId:input.args.proposalId,recipient})),messageId:''};}
 const fingerprint=digest(stable({tool:input.tool,args:input.args}));return{key:input.requestId||input.runId+':'+fingerprint,fingerprint,messageId:''};
}
function refreshedResult(store:Store,receipt:RecordData,messageId:string):OperatorToolCallResult{
 const original=receipt.result as OperatorToolCallResult;
 if(messageId){const message=store.get('outbound-messages',messageId);if(message)return{...original,ok:!['INCERT','ESUAT'].includes(message.status),summary:`Invitația SMS existentă are starea ${message.status}. ${message.status==='LIVRAT'?'Livrarea este confirmată.':'Livrarea nu este confirmată.'}`,data:{...original.data,messageId,status:message.status,capabilityReport:safe(message.capabilityReport),error:safe(message.error),deduplicated:true}};}
 return{...original,data:{...original.data,deduplicated:true}};
}

/** Claim a private durable receipt before effects; no database transaction remains open while awaiting a tool. */
export async function executeWithOperatorReceipt(input:OperatorReceiptInput,execute:()=>Promise<OperatorToolCallResult>|OperatorToolCallResult):Promise<OperatorToolCallResult>{
 const{user}=requireOperator(input.ctx,'READ');if(input.signal?.aborted)fail('Operațiunea a fost oprită înainte de execuție.','CANCELED');
 if(!input.isWrite)return await execute();
 const target=scope(input),receiptId=digest(user.id+':'+target.key),store=input.store;
 const nested=store.db.isTransaction,savepoint='tool_receipt_'+id().replace(/-/g,'');
 store.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
 let receipt:RecordData;
 try{
  const prior=store.get('operator-tool-receipts',receiptId);
  if(prior){
   if(prior.ownerId!==user.id||prior.fingerprint!==target.fingerprint||prior.tool!==input.tool)fail('Cheia operațiunii a fost folosită pentru alt instrument sau alte argumente.','CONFLICT');
   const sms=target.messageId?store.get('outbound-messages',target.messageId):undefined;
   const confirmedNotDispatched=Boolean(sms&&['PREGATIT','APROBAT','ESUAT'].includes(sms.status)&&!sms.dispatchLeaseUntil);
   if(prior.status==='SUCCEEDED'&&!confirmedNotDispatched){
    store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return refreshedResult(store,prior,target.messageId);
   }
   const authorizationOnlyRejection=prior.status==='FAILED'&&prior.inputOnly===true&&prior.errorCode==='FORBIDDEN'&&/Trimiterea necesită o cerere explicită a operatorului/.test(String(prior.error||''))&&confirmedNotDispatched&&!sms?.deviceJobId&&!sms?.providerMessageId&&!sms?.dispatchStartedAt;
   const retry=authorizationOnlyRejection||(prior.status==='SUCCEEDED'&&confirmedNotDispatched)||prior.safeToRetry===true||(prior.inputOnly===true&&input.retryInputFailure===true);
   if(!retry){
    if(prior.status==='RUNNING')fail('Operațiunea este deja în execuție. Verifică rezultatul existent; nu a fost repetată.','OPERATION_IN_PROGRESS');
    fail(prior.status==='NEEDS_REVIEW'?'Rezultatul operațiunii precedente este incert. Verificarea manuală sau reconcilierea este necesară înainte de retrimitere.':safe(prior.error)||'Operațiunea anterioară a eșuat. Nu a fost repetată automat.',prior.inputOnly?prior.errorCode||'BAD_USER_INPUT':'NEEDS_REVIEW');
   }
  }
  receipt={id:receiptId,ownerId:user.id,conversationId:input.conversationId,runId:input.runId,tool:input.tool,fingerprint:target.fingerprint,status:'RUNNING',attempts:(prior?.attempts||0)+1,startedAt:now(),updatedAt:now(),createdAt:prior?.createdAt||now(),safeToRetry:false,inputOnly:false};
  store.put('operator-tool-receipts',receipt,user.id);store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');
 }catch(error){if(nested){try{store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}catch{}}else if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
 try{
  const result=await execute();
  if(!result||typeof result.ok!=='boolean'||typeof result.summary!=='string')throw Error('Instrumentul nu a furnizat un rezultat verificabil.');
  const status=String(result.data?.status||'');
  const definitelyNotDispatched=input.tool==='send_proposal_sms'&&['PREGATIT','APROBAT','ESUAT'].includes(status);
  const uncertain=['INCERT','NEEDS_REVIEW'].includes(status);
  const saved={...receipt,status:uncertain?'NEEDS_REVIEW':definitelyNotDispatched?'FAILED':result.ok?'SUCCEEDED':'NEEDS_REVIEW',safeToRetry:definitelyNotDispatched,result,error:result.ok?null:safe(result.summary),updatedAt:now(),completedAt:now()};
  store.put('operator-tool-receipts',saved,user.id);return result;
 }catch(error){
  const typed=error as{code?:string;extensions?:{code?:string;operatorContactAuthorizationDenied?:boolean};unknownOutcome?:boolean;sideEffectStarted?:boolean};
  const errorCode=typed?.extensions?.code||typed?.code||'TOOL_FAILED';
  const inputOnly=inputCodes.has(errorCode)&&!typed?.unknownOutcome&&!typed?.sideEffectStarted;
  const safeToRetry=input.tool==='send_proposal_sms'&&typed.extensions?.operatorContactAuthorizationDenied===true&&inputOnly;
  store.put('operator-tool-receipts',{...receipt,status:inputOnly?'FAILED':'NEEDS_REVIEW',inputOnly,errorCode,error:safe(error instanceof Error?error.message:error),safeToRetry,unknownOutcome:!inputOnly,updatedAt:now(),completedAt:now()},user.id);throw error;
 }
}

/** Administrative metadata only; result payloads and arguments never enter customer APIs. */
export function listOperatorToolReceipts(store:Store,ctx:Context,options:{runId?:string;limit?:number}={}):RecordData[]{
 const{user}=requireOperator(ctx,'READ');return store.list('operator-tool-receipts',user.id).filter(r=>!options.runId||r.runId===options.runId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,Math.max(1,Math.min(100,options.limit||30))).map(r=>({id:r.id,tool:r.tool,status:r.status,runId:r.runId,conversationId:r.conversationId,attempts:r.attempts,safeToRetry:!!r.safeToRetry,error:safe(r.error),startedAt:r.startedAt,completedAt:r.completedAt,createdAt:r.createdAt,updatedAt:r.updatedAt}));
}

/** A gateway restart cannot prove whether an external side effect happened. Never replay it. */
export function recoverInterruptedOperatorReceipts(store:Store):number{
 let count=0;for(const receipt of store.list('operator-tool-receipts'))if(receipt.status==='RUNNING'){store.put('operator-tool-receipts',{...receipt,status:'NEEDS_REVIEW',unknownOutcome:true,error:'Gateway-ul s-a repornit în timpul operațiunii. Verifică rezultatul extern înainte de repetare.',updatedAt:now(),completedAt:now()},receipt.ownerId);count++;}return count;
}
