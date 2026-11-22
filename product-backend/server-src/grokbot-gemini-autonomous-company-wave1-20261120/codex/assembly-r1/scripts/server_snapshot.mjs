
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const fail=c=>{throw Error(c)};
export async function serverSnapshot({nativeRoot,intentId,nativeJwt,authorityPackage,orchestrationPackage,lifecyclePackage,nativeOrigin}){
 const {resolveVerifiedContext}=await import(pathToFileURL(join(lifecyclePackage,'verified-context.mjs')).href);
 const c=await resolveVerifiedContext({nativeRoot,intentId,nativeJwt,authorityPackage,orchestrationPackage,allowStoppedGraph:true});
 const execution=JSON.parse(readFileSync(c.executionPath));
 const db=new DatabaseSync(join(nativeRoot,'native-worker-runtime','graphs.sqlite'),{readOnly:true});
 let links;try{links=db.prepare('SELECT * FROM delegation_links WHERE graph_id=? ORDER BY task_id').all(c.graphId);}finally{db.close();}
 const chain={companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,sourceMessageId:c.sourceMessageId,graphId:c.graphId,roomId:c.roomId,authorizationRevision:c.authorizationRevision,generation:c.generation};
 const canonical=new DatabaseSync(join(nativeRoot,'native-worker-runtime','canonical.sqlite'),{readOnly:true});
 const canonicalRecords=canonical.prepare("SELECT collection,id,payload FROM records WHERE collection IN ('agency-execution-requests','agency-execution-receipts')").all().map(x=>({...x,value:JSON.parse(x.payload)}));canonical.close();
 const workers=execution.outputs.map(output=>{
  const r=output.receipt,l=links.find(x=>x.task_id===r.taskId);
  if(!l||l.artifact_digest!==r.artifactDigest||r.agencyReceiptId!==output.provenance.agencyReceiptId)fail('CANONICAL_WORKER_JOIN_MISMATCH');
  const agency=canonicalRecords.find(x=>x.collection==='agency-execution-receipts'&&x.value.id===r.agencyReceiptId)?.value;
  const request=canonicalRecords.find(x=>x.collection==='agency-execution-requests'&&x.id===r.childRunId)?.value;
  if(!agency||agency.state!=='SUCCEEDED'||!request||request.tenantId!==c.companyId||agency.tenantId!==c.companyId||agency.projectId!==c.projectId||agency.executionRequestId!==request.id)fail('ACTUAL_AGENCY_COMPLETION_REQUIRED');
  return {...chain,taskId:r.taskId,botId:l.bot_id,executorRunId:r.childRunId,agencyReceiptId:r.agencyReceiptId,artifactDigest:r.artifactDigest,actualExecutorCompleted:r.verifiedByExecutor===true,actualAgencyCompleted:agency.state==='SUCCEEDED',provider:c.provider,modelCalls:c.modelCalls,receiptExecutionClass:r.executionClass};
 });
 let original={};
 if(nativeOrigin){
  const u=new URL(nativeOrigin);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))fail('PRIVATE_NATIVE_ORIGIN_REQUIRED');
  const response=await fetch(u.origin+'/api/v1/starli/companies/'+encodeURIComponent(c.companyId)+'/messaging/rooms/'+encodeURIComponent(c.roomId)+'/messages?after=0&limit=100',{headers:{Authorization:'Bearer '+nativeJwt}});
  if(!response.ok)fail('NATIVE_ORIGINAL_MESSAGE_READ_DENIED');
  const data=await response.json(),messages=data.messages;
  const originals=messages.filter(x=>x.id===c.originalPromptMessageId);
  if(originals.length!==1||originals[0].roomId!==c.roomId||originals[0].speaker?.kind!=='system'||originals[0].speaker?.id!=='starli-guest-intake')fail('CANONICAL_ORIGINAL_MESSAGE_REQUIRED');
  original={originalPrompt:originals[0].content,originalPromptCount:originals.length,originalPromptProvenance:'system'};
 }
 return {...original,chain,intentId:c.intentId,originalPromptMessageId:c.originalPromptMessageId,workers,nativeStoreReadback:true,backendFixturesUsed:[],executionDigest:c.executionDigest,nativeFiles:c.nativeFiles,executionClass:'NATIVE_NONPRODUCTION',browserObservationsIncluded:false};
}
export function processIdentity(pid){
 try{const raw=readFileSync('/proc/'+pid+'/stat','utf8'),f=raw.slice(raw.lastIndexOf(') ')+2).split(' ');return {pid,startTicks:f[19],state:f[0]};}catch{return null;}
}
export function readPrivateCapability(file){
 const s=statSync(file);if((s.mode&0o077)!==0)fail('PRIVATE_CAPABILITY_FILE_REQUIRED');
 return JSON.parse(readFileSync(file,'utf8'));
}
if(process.argv[1]?.endsWith('server_snapshot.mjs')&&process.argv[2]){
 const c=readPrivateCapability(process.argv[2]);
 const result=await serverSnapshot(c);
 console.log(JSON.stringify(result));
}

/** Read-only coordinator audit; does not grant or assert current tenant access. */
export function auditPersistedStorage({dataRoot,companyId,projectId,baseline}){
 const partition=createHash('sha256').update(companyId+'\0'+projectId).digest('hex');
 const dbPath=join(dataRoot,partition,'doglove.sqlite');
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  const records=db.prepare('SELECT id,name,created_at FROM doglove_pets WHERE company_id=? ORDER BY created_at,id').all(companyId);
  const writeCount=Number(db.prepare('SELECT count(*) n FROM native_pet_write_log').get().n);
  const contentDigest=createHash('sha256').update(JSON.stringify(records)).digest('hex');
  return {scope:'COORDINATOR_READ_ONLY_AUDIT_NOT_CURRENT_USER_ACCESS',records:records.map(x=>x.name),recordCount:records.length,writeCount,contentDigest,storageId:createHash('sha256').update(dbPath).digest('hex'),unauthorizedWriteDelta:baseline?writeCount-baseline.writeCount:null,recordsUnchanged:baseline?contentDigest===baseline.contentDigest:null};
 }finally{db.close();}
}
