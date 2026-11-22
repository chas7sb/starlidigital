import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,id,now} from '../src/store.js';
import {hashToken} from '../src/security.js';
import {cancelQueuedOperatorRunJobs,recoverInterruptedOperatorRuns} from '../src/operator-run-cancellation.js';
import {acquireJobLease} from '../src/operator-jobs.js';
import {recordDeviceHeartbeat,reportDeviceJobOutcome} from '../src/operator-devices.js';

test('run cancellation scopes ownership, preserves terminal results and makes running effects uncertain',()=>{
 const store=new Store(':memory:');try{
  const put=(status:string,runId='run',actorId='owner')=>{const job={id:id(),runId,actorId,status,leaseToken:'lease',leaseUntil:Date.now()+10000,createdAt:now(),updatedAt:now()};store.put('operator-jobs',job,actorId);return job;};
  const pending=['PENDING','QUEUED_DEVICE','AWAITING_APPROVAL'].map(s=>put(s)),running=put('RUNNING');
  const succeeded=put('SUCCEEDED'),otherRun=put('PENDING','other'),otherOwner=put('PENDING','run','other');
  const result=cancelQueuedOperatorRunJobs(store,'run','owner');
  assert.deepEqual(result.canceledIds.sort(),pending.map(j=>j.id).sort());assert.deepEqual(result.uncertainIds,[running.id]);
  for(const job of pending){assert.equal(store.get('operator-jobs',job.id)!.status,'CANCELED');assert.equal(acquireJobLease(store,undefined,job.id),null);}
  assert.equal(store.get('operator-jobs',running.id)!.status,'INCERT');assert.equal(store.get('operator-jobs',running.id)!.leaseToken,null);
  assert.equal(store.get('operator-jobs',succeeded.id)!.status,'SUCCEEDED');assert.equal(store.get('operator-jobs',otherRun.id)!.status,'PENDING');assert.equal(store.get('operator-jobs',otherOwner.id)!.status,'PENDING');
  assert.deepEqual(cancelQueuedOperatorRunJobs(store,'run','owner'),{canceledIds:[],uncertainIds:[]});
 }finally{store.close();}
});

test('restart interrupts private runs and removes their queued work without replaying uncertain effects',()=>{
 const store=new Store(':memory:');try{store.put('operator-agent-runs',{id:'run',ownerId:'owner',status:'RUNNING'},'owner');store.put('operator-jobs',{id:'queued',runId:'run',actorId:'owner',status:'QUEUED_DEVICE'},'owner');store.put('operator-tool-receipts',{id:'receipt',runId:'run',status:'NEEDS_REVIEW'},'owner');assert.equal(recoverInterruptedOperatorRuns(store),1);assert.equal(store.get('operator-agent-runs','run')!.status,'NEEDS_REVIEW');assert.equal(store.get('operator-jobs','queued')!.status,'CANCELED');assert.equal(recoverInterruptedOperatorRuns(store),0);}finally{store.close();}
});

test('reconnecting device does not receive canceled work and stale dispatch cannot claim execution',()=>{
 const store=new Store(':memory:');try{
  const token='starli_dev_test_device_token_long_enough',deviceId=id();store.put('operator-devices',{id:deviceId,tokenHash:hashToken(token),status:'ONLINE',pairedBy:'owner',capabilities:[],adbDevices:[],createdAt:now(),updatedAt:now()},'owner');
  const job={id:id(),runId:'run',actorId:'owner',deviceId,kind:'device.fs.write',status:'QUEUED_DEVICE',argsJson:'{}',createdAt:now(),updatedAt:now()};store.put('operator-jobs',job,'owner');
  cancelQueuedOperatorRunJobs(store,'run','owner');
  assert.deepEqual(recordDeviceHeartbeat(store,undefined,token,{}).pendingJobs,[]);
  assert.throws(()=>reportDeviceJobOutcome(store,undefined,token,{jobId:job.id,status:'RUNNING'}),/nu mai poate fi executată/);
  assert.equal(store.get('operator-jobs',job.id)!.status,'CANCELED');
 }finally{store.close();}
});

