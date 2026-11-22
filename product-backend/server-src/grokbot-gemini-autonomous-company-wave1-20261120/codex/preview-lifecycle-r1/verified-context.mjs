import {DatabaseSync} from 'node:sqlite';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
function readDb(path,fn){const db=new DatabaseSync(path,{readOnly:true});try{return fn(db)}finally{db.close()}}
function scopedFile(root,file){const r=realpathSync(root),f=realpathSync(file),rel=relative(r,f);if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(f).isFile())fail('NATIVE_ARTIFACT_SCOPE_DENIED');return f;}
export async function resolveVerifiedContext({nativeRoot,authorityPackage,orchestrationPackage,intentId,nativeJwt,allowStoppedGraph=false}){
 const root=realpathSync(nativeRoot);if(!root.startsWith('/tmp/grokbot1-w1-'))fail('DISPOSABLE_NATIVE_ROOT_REQUIRED');
 const {verifyNativeJwt}=await import(pathToFileURL(join(authorityPackage,'server/native-authority.ts')).href);
 const claims=readDb(join(root,'intake/grokbot1-intake.sqlite3'),db=>db.prepare("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND state='COMMITTED' ORDER BY updated DESC LIMIT 1").get(intentId));
 if(!claims)fail('COMMITTED_CLAIM_REQUIRED');
 process.env.GB3_DISPOSABLE_PARENT=resolve(root,'..');
 const verdict=verifyNativeJwt(root,claims.company_id,nativeJwt);
 if(verdict.nativeUserId!==claims.owner_user_id||verdict.role!=='owner')fail('CURRENT_NATIVE_CLAIM_OWNER_REQUIRED');
 const receipts=JSON.parse(claims.receipts);
 const found=readDb(join(root,'native-worker-admission.sqlite'),db=>db.prepare("SELECT admission,result FROM builds WHERE json_extract(admission,'$.intentId')=? AND json_extract(admission,'$.claimId')=? AND result IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(intentId,claims.txn));
 if(!found)fail('ACTUAL_NATIVE_BUILD_REQUIRED');
 const admission=JSON.parse(found.admission),apiResult=JSON.parse(found.result);
 if(admission.actor.userId!==verdict.nativeUserId||admission.companyId!==claims.company_id||admission.projectId!==receipts.projectId||admission.parentRoomId!==receipts.doglovRoomId||admission.originalPromptMessageId!==receipts.originalPromptMessageId||admission.authorizationRevision!==verdict.membershipRevision)fail('NATIVE_CLAIM_BUILD_BINDING_MISMATCH');
 const graphId=apiResult.graphId;
 const runtime=join(root,'native-worker-runtime');
 const graph=readDb(join(runtime,'graphs.sqlite'),db=>db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(graphId));
 if(!graph||graph.registration_mode!=='CANONICAL_VERIFIED'||(!allowStoppedGraph&&['STOP_REQUESTED','STOPPED','REVOKED'].includes(graph.graph_state))||graph.company_id!==admission.companyId||graph.project_id!==admission.projectId||graph.request_id!==admission.requestId||graph.source_message_id!==admission.sourceMessageId||graph.parent_room_id!==admission.parentRoomId||graph.authorization_revision!==verdict.membershipRevision||graph.generation!==admission.generation)fail('CURRENT_CANONICAL_GRAPH_REQUIRED');
 const links=readDb(join(runtime,'graphs.sqlite'),db=>db.prepare('SELECT * FROM delegation_links WHERE graph_id=? ORDER BY task_id').all(graphId));
 if(links.length!==2||links.some(x=>x.child_company_id!==graph.company_id||x.execution_class!=='NATIVE_NONPRODUCTION'||!x.server_provenance_verified||x.status!=='WORKER_TERMINAL'||!admission.workers.some(w=>w.botId===x.bot_id&&w.roomId===x.child_room_id)))fail('TWO_VERIFIED_NATIVE_WORKERS_REQUIRED');
 const executionPath=scopedFile(runtime,join(runtime,'execution-'+graphId.replace(/[^a-zA-Z0-9]/g,'_')+'.json'));
 const execution=JSON.parse(readFileSync(executionPath));
 if(execution.graphId!==graphId||execution.machineryRunId!==graph.machinery_run_id||execution.outputs?.length!==2||execution.modelCalls!==0||execution.provider!=='DETERMINISTIC_LOCAL')fail('NATIVE_EXECUTION_RESULT_MISMATCH');
 const {buildReceiptCanonicalPayload}=await import(pathToFileURL(join(orchestrationPackage,'executor-receipt-issuer.mjs')).href);
 const key=readFileSync(join(runtime,'.receipt-key'));
 const artifactRoot=join(runtime,'artifacts');const signedFiles=[];
 for(const o of execution.outputs){
  const r=o.receipt,l=links.find(x=>x.call_id===r?.callId);
  if(!l||r.companyId!==graph.company_id||r.projectId!==graph.project_id||r.requestId!==graph.request_id||r.graphId!==graphId||r.taskId!==l.task_id||r.childRunId!==l.child_run_id||r.artifactDigest!==l.artifact_digest||r.authorizationRevision!==graph.authorization_revision||r.generation!==graph.generation||r.executionClass!=='NATIVE_NONPRODUCTION')fail('TRUSTED_RECEIPT_BINDING_MISMATCH');
  const expected=Buffer.from(createHmac('sha256',key).update(buildReceiptCanonicalPayload(r)).digest('hex')),actual=Buffer.from(r.hmac||'');if(expected.length!==actual.length||!timingSafeEqual(expected,actual))fail('TRUSTED_RECEIPT_SIGNATURE_INVALID');
  const artifact=readFileSync(scopedFile(artifactRoot,o.artifactPath));if(sha(artifact)!==o.artifactDigest)fail('NATIVE_OUTPUT_DIGEST_MISMATCH');
  const produced=JSON.parse(artifact);if(produced.worker?.botId!==l.bot_id||produced.scope?.graphId!==graphId||produced.scope?.companyId!==graph.company_id||produced.scope?.projectId!==graph.project_id||produced.scope?.requestId!==graph.request_id)fail('SIGNED_WORKER_OUTPUT_BINDING_MISMATCH');
  for(const f of produced.files||[])signedFiles.push({path:f.path,sha256:sha(f.content),agencyReceiptId:r.agencyReceiptId,workerId:produced.worker.botId});
 }
 const buildDir=realpathSync(execution.buildDir);
 if(!buildDir.startsWith(realpathSync(artifactRoot)+'/'))fail('NATIVE_BUILD_SCOPE_DENIED');
 if(signedFiles.length!==execution.files?.length)fail('GENERATED_FILE_PROVENANCE_MISMATCH');
 for(const f of execution.files||[]){const signed=signedFiles.find(x=>join(buildDir,x.path)===f.path);if(!signed||signed.sha256!==f.sha256||signed.agencyReceiptId!==f.agencyReceiptId||signed.workerId!==f.workerId)fail('GENERATED_FILE_PROVENANCE_MISMATCH');if(sha(readFileSync(scopedFile(buildDir,f.path)))!==f.sha256)fail('NATIVE_GENERATED_FILE_CHANGED');}
 if(!execution.files?.length)fail('NATIVE_GENERATED_FILES_REQUIRED');
 return {nativeRoot:root,intentId,claimId:claims.txn,companyId:graph.company_id,projectId:graph.project_id,requestId:graph.request_id,graphId,sourceMessageId:graph.source_message_id,originalPromptMessageId:admission.originalPromptMessageId,roomId:graph.parent_room_id,subjectId:verdict.nativeUserId,authorizationRevision:graph.authorization_revision,generation:graph.generation,taskIds:links.map(x=>x.task_id),executionPath,executionDigest:sha(readFileSync(executionPath)),nativeBuildDir:buildDir,nativeFiles:execution.files,outputReceipts:execution.outputs.map(x=>({agencyReceiptId:x.provenance.agencyReceiptId,artifactDigest:x.artifactDigest})),provider:execution.provider,modelCalls:execution.modelCalls};
}
