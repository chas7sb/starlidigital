import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graphql} from 'graphql';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {createAppSchema} from '../src/schema.js';
import {sourceHash,processStripeEvent} from '../src/billing.js';
import {makeNextProjectFiles} from '../src/site-builder.js';

test('GraphQL publication requires ownership and verified paid revision, then uses durable queue without a second POST',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('GraphQL must queue, not publish directly');};
 const store=new Store(':memory:'),schema=createAppSchema(store,new Events()),date=new Date().toISOString();
 const files=makeNextProjectFiles({page:'export default function Page(){return <main><h1>Atelier de ceramică</h1><p>Obiecte realizate manual în Brașov.</p></main>}',css:'body { margin: 0; color: #18232a; background: #faf7f2; }',title:'Atelier de ceramică',description:'Obiecte de ceramică realizate manual în Brașov.'});
 const project=store.put('projects',{id:'project-unit',ownerId:'owner',name:'Atelier',brief:'Ceramică',files,status:'SOURCE_READY',createdAt:date,updatedAt:date});store.saveUser({id:'owner',username:'owner',role:'USER',createdAt:date});
 const owner={store,user:{id:'owner',role:'USER'},ip:'deployment-queue-unit',setCookie:()=>{}},stranger={...owner,user:{id:'stranger',role:'USER'}};
 const run=(source:string,context=owner)=>graphql({schema,source,contextValue:context});
 try{
  assert.equal((await run('mutation{deployProject(id:"project-unit"){id}}',stranger)).errors?.[0].extensions.code,'FORBIDDEN');
  assert.equal((await run('mutation{deployProject(id:"project-unit"){id}}')).errors?.[0].extensions.code,'PAYMENT_REQUIRED');
  const hash=sourceHash(files);store.put('source-snapshots',{id:'owner:'+hash,ownerId:'owner',projectId:project.id,sourceHash:hash,files});
  store.put('payments',{id:'paid',ownerId:'owner',projectId:project.id,sourceHash:hash,status:'PENDING',livemode:false,sessionId:'cs_test_unit',amount:10000,currency:'ron'});
  processStripeEvent(store,{id:'evt_deployment_paid',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_unit',metadata:{paymentId:'paid',projectId:project.id,ownerId:'owner',sourceHash:hash},client_reference_id:'owner',amount_total:10000,currency:'ron',payment_status:'paid'}}});
  const queued=await run('mutation{deployProject(id:"project-unit"){status deploymentStatus}}');assert.equal(queued.errors,undefined);assert.equal((queued.data as any).deployProject.status,'DEPLOYING');assert.equal((queued.data as any).deployProject.deploymentStatus,'PENDING');assert.equal(calls,0);
  const list=await run('{fulfillmentJobs(projectId:"project-unit"){id status publicVerified}}');assert.equal(list.errors,undefined);assert.equal((list.data as any).fulfillmentJobs.length,1);
  assert.equal((await run('{fulfillmentJobs(projectId:"project-unit"){id}}',stranger)).errors?.[0].extensions.code,'FORBIDDEN');
  assert.equal((await run('mutation{retryFulfillment(id:"payment-paid"){id}}')).errors?.[0].extensions.code,'FORBIDDEN');
 }finally{globalThis.fetch=original;store.close();}
});
