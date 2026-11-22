import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {makeNextProjectFiles} from '../src/next-template.js';
import {sourceHash,processStripeEvent} from '../src/billing.js';
import {tickFulfillment,enqueueAdminFulfillment} from '../src/fulfillment.js';
import {VercelRequestError} from '../src/integrations/vercel.js';

const files=()=>makeNextProjectFiles({page:'export default function Page(){return <main><h1>Atelier</h1><p>Obiecte de ceramică realizate manual.</p></main>}',css:'body { color: #123; background: #fafafa; margin: 0; }',title:'Atelier',description:'Obiecte de ceramică realizate manual.'});
function paid(store:Store){
 const source=files(),hash=sourceHash(source);store.saveUser({id:'owner',username:'owner',role:'USER',disabled:false});
 store.put('projects',{id:'project-test',ownerId:'owner',name:'Atelier',files:source,status:'SOURCE_READY',validationStatus:'NOT_RUN'});
 store.put('source-snapshots',{id:'owner:'+hash,ownerId:'owner',projectId:'project-test',sourceHash:hash,files:source});
 store.put('payments',{id:'payment-test',ownerId:'owner',projectId:'project-test',sourceHash:hash,status:'PENDING',amount:10000,currency:'ron',livemode:false,sessionId:'cs_test_checkout'});
 processStripeEvent(store,{id:'evt_paid_test',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_checkout',metadata:{paymentId:'payment-test',ownerId:'owner',projectId:'project-test',sourceHash:hash},client_reference_id:'owner',amount_total:10000,currency:'ron',payment_status:'paid',payment_intent:'pi_test'}}});
 return {source,hash,jobId:'payment-payment-test'};
}
function provider(store:Store,clock:()=>number){
 return {clock,configured:()=>true,ensure:async({name,onCreated}:any)=>{onCreated?.({id:'prj_test',name});return {id:'prj_test',name,publicConfigured:true as const};},deploy:async({requestId,sourceHash}:any)=>({id:'dpl_test',url:'https://site-test.vercel.app',status:'READY' as const,projectId:'prj_test',requestId,sourceHash}),get:async()=>{const job=store.get('fulfillment-jobs','payment-payment-test')!;return {id:'dpl_test',url:'https://site-test.vercel.app',status:'READY' as const,projectId:'prj_test',requestId:job.requestId,sourceHash:job.sourceHash};},find:async():Promise<any>=>null,public:async()=>true};
}

test('paid fulfillment uses immutable purchased source and verifies public access before LIVE',async()=>{
 const store=new Store(':memory:');const events=new Events();const {source,hash,jobId}=paid(store);let time=Date.now(),calls=0,publicAccess=false;
 const changed=files().map(file=>file.path==='app/page.tsx'?{...file,content:file.content.replace('Atelier','Studio')}:file);
 store.put('projects',{...store.get('projects','project-test')!,files:changed});
 const api=provider(store,()=>time);const original=api.deploy;api.deploy=async(args:any)=>{calls++;assert.equal(sourceHash(args.files),hash);assert.deepEqual(args.files,source);return original(args);};api.public=async()=>publicAccess;
 await tickFulfillment(store,events,api);assert.equal(store.get('fulfillment-jobs',jobId)?.status,'VERIFYING_PUBLIC');assert.equal(store.get('projects','project-test')?.deploymentUrl,undefined);
 publicAccess=true;time+=16000;await tickFulfillment(store,events,api);
 assert.equal(store.get('fulfillment-jobs',jobId)?.status,'LIVE');assert.equal(store.get('payments','payment-test')?.fulfillmentStatus,'LIVE');assert.equal(store.get('projects','project-test')?.status,'SOURCE_READY');assert.equal(sourceHash(store.get('projects','project-test')!.files),sourceHash(changed));assert.equal(store.get('projects','project-test')?.publishedSourceHash,hash);assert.equal(store.list('memories')[0].publicApproved,false);
 await tickFulfillment(store,events,api);assert.equal(calls,1);store.close();
});

test('unknown deployment POST recovers after process restart by request metadata without another POST',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'starli-fulfillment-test-'));const path=join(directory,'test.sqlite');let store=new Store(path);const events=new Events();const {jobId}=paid(store);let time=Date.now(),posts=0;
 try{
  const first=provider(store,()=>time);first.deploy=async()=>{posts++;throw new VercelRequestError('connection lost after acceptance',true);};
  await tickFulfillment(store,events,first);assert.equal(store.get('fulfillment-jobs',jobId)?.status,'RECONCILING');assert.equal(store.get('fulfillment-jobs',jobId)?.submissionAttempted,true);store.close();
  store=new Store(path);time+=31000;const recovered=provider(store,()=>time);recovered.deploy=async()=>{posts++;throw new Error('Must not repeat POST');};recovered.find=async()=>recovered.get();
  await tickFulfillment(store,events,recovered);assert.equal(store.get('fulfillment-jobs',jobId)?.status,'LIVE');assert.equal(posts,1);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});

test('unpaid/revoked orders and missing snapshots never fall back to current project source',async()=>{
 const store=new Store(':memory:');const events=new Events();const {jobId}=paid(store);const api=provider(store,Date.now);let calls=0;api.ensure=async()=>{calls++;throw new Error('Unexpected provider');};
 store.put('payments',{...store.get('payments','payment-test')!,status:'REFUNDED'});await tickFulfillment(store,events,api);assert.equal(store.get('fulfillment-jobs',jobId)?.status,'BLOCKED');assert.equal(calls,0);
 store.put('payments',{...store.get('payments','payment-test')!,status:'PAID'});store.put('fulfillment-jobs',{...store.get('fulfillment-jobs',jobId)!,status:'PENDING'});for(const item of store.list('source-snapshots'))store.remove('source-snapshots',item.id);
 await tickFulfillment(store,events,api);assert.equal(store.get('fulfillment-jobs',jobId)?.status,'BLOCKED');assert.equal(calls,0);store.close();
});

test('operator override is durable and requires a persisted active administrator',async()=>{
 const store=new Store(':memory:');const source=files();const project=store.put('projects',{id:'guest-project',ownerId:'guest-owner',files:source,status:'SOURCE_READY'});const events=new Events();
 assert.throws(()=>enqueueAdminFulfillment(store,project,{id:'fake',role:'ADMIN'}),/administratorului/);
 const admin=store.saveUser({id:'alex',username:'alex',role:'ADMIN'});const job=enqueueAdminFulfillment(store,project,admin);assert.equal(job.paymentId,null);
 const api=provider(store,Date.now);api.get=async()=>{throw new Error('Not needed');};api.deploy=async(args:any)=>({id:'dpl_operator',url:'https://operator-test.vercel.app',status:'READY',projectId:'prj_test',requestId:args.requestId,sourceHash:args.sourceHash});
 await tickFulfillment(store,events,api);assert.equal(store.get('fulfillment-jobs',job.id)?.status,'LIVE');store.close();
});
