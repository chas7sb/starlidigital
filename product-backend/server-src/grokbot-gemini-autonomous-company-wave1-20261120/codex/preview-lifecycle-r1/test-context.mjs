import {resolveVerifiedContext} from './verified-context.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
let raw='';for await(const b of process.stdin)raw+=b;
const config=JSON.parse(raw);const c=await resolveVerifiedContext(config);
const checks=['actual claimed company/graph/two signed receipts/native files'];
await assert.rejects(resolveVerifiedContext({...config,intentId:'foreign-missing-intent'}),e=>e.code==='COMMITTED_CLAIM_REQUIRED');checks.push('unknown claim denies');
const db=new DatabaseSync(join(config.nativeRoot,'native-worker-runtime/graphs.sqlite'));
try{
 db.prepare("UPDATE orchestration_graphs SET graph_state='STOP_REQUESTED' WHERE graph_id=?").run(c.graphId);
 await assert.rejects(resolveVerifiedContext(config),e=>e.code==='CURRENT_CANONICAL_GRAPH_REQUIRED');checks.push('current stopped graph denies reopening');
 const cleanup=await resolveVerifiedContext({...config,allowStoppedGraph:true});assert.equal(cleanup.graphId,c.graphId);checks.push('cleanup can resolve exact stopped owner graph');
 db.prepare("UPDATE orchestration_graphs SET graph_state='ACTIVE',generation=generation+1 WHERE graph_id=?").run(c.graphId);
 await assert.rejects(resolveVerifiedContext(config),e=>e.code==='CURRENT_CANONICAL_GRAPH_REQUIRED');checks.push('current generation mismatch denies');
}finally{db.prepare("UPDATE orchestration_graphs SET graph_state='ACTIVE',generation=? WHERE graph_id=?").run(c.generation,c.graphId);db.close();}
const file=c.nativeFiles[0].path,original=readFileSync(file);
try{writeFileSync(file,'tampered-owned-test-output');await assert.rejects(resolveVerifiedContext(config),e=>e.code==='NATIVE_GENERATED_FILE_CHANGED');checks.push('generated output tampering denies');}finally{writeFileSync(file,original);}
console.log(JSON.stringify({passed:true,checks,companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,graphId:c.graphId,sourceMessageId:c.sourceMessageId,taskIds:c.taskIds,outputReceipts:c.outputReceipts,provider:c.provider,modelCalls:c.modelCalls}));
