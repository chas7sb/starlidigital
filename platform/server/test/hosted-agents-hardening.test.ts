import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { HostedAgentService, COLLECTIONS } from '../src/hosted-agents/service.js';
import { HostedAgentProposalService } from '../src/hosted-agent-integrations/proposals.js';
import type { Actor } from '../src/hosted-agents/types.js';
const admin: Actor={userId:'admin',role:'ADMIN'};
const owner: Actor={userId:'customer',role:'CUSTOMER'};
const reply={reply:'Please contact our team.',latencyMs:1};
async function setup(t:any, router:any={complete:async()=>reply}, store=new Store(':memory:'), env:any={}) {
 t.after(()=>store.close());
 store.saveUser({id:'admin',username:'admin',role:'ADMIN'});
 store.saveUser({id:'customer',username:'customer',role:'CUSTOMER'});
 const service=new HostedAgentService({store,router,env});
 const agent=await service.create(admin,{name:'Demo',businessName:'Fictional Co',type:'SALES'});
 await service.publish(admin,agent.id,'DEMO',1);
 const session=await service.startConversation({publicId:agent.publicId});
 const turn={publicId:agent.publicId,...session,requestId:'request-1',message:'Hello'};
 return {service,store,agent,session,turn};
}
test('separate database connections cannot concurrently execute a conversation; retry persists both turns',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hosted-agents-')); const db=join(dir,'test.sqlite');
 let complete:any; let calls=0;
 const router:any={complete:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}};
 const store1=new Store(db),store2=new Store(db);
 const {service,agent,turn}=await setup(t,router,store1);
 t.after(()=>{store2.close(); assert.ok(dir.startsWith(join(tmpdir(),'hosted-agents-'))); rmSync(dir,{recursive:true,force:true});});
 const second=new HostedAgentService({store:store2,router});
 const pending=service.chat(turn);
 await assert.rejects(second.chat({...turn,requestId:'request-2'}),/already in progress/);
 assert.equal(calls,1);
 complete(reply);await pending;
 const pending2=second.chat({...turn,requestId:'request-2'});complete(reply);await pending2;
 assert.equal(store2.get(COLLECTIONS.CONVERSATIONS,turn.conversationId)?.messages.length,4);
 assert.equal((await service.usage(admin,agent.id)).messages,4);
});
test('disable during provider await cannot publish reply, lead or conversation turn',async t=>{
 let complete:any;const router:any={complete:()=>new Promise(resolve=>{complete=resolve;})};
 const {service,store,agent,turn}=await setup(t,router);
 const pending=service.chat(turn);await service.disable(admin,agent.id,2);complete(reply);
 await assert.rejects(pending,/configuration changed/);
 assert.equal(store.get(COLLECTIONS.CONVERSATIONS,turn.conversationId)?.messages.length,0);
 assert.equal(store.list(COLLECTIONS.LEADS).length,0);
});
test('concurrent expectedVersion edits accept one; owner validation rejects nonexistent and disabled accounts',async t=>{
 const {service,store,agent}=await setup(t);
 const results=await Promise.allSettled([service.update(admin,agent.id,{name:'A'},2),service.update(admin,agent.id,{name:'B'},2)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(service.assignOwner(admin,agent.id,'missing',3),/active platform user/);
 store.saveUser({id:'disabled',username:'disabled',disabled:true});
 await assert.rejects(service.assignOwner(admin,agent.id,'disabled',3),/active platform user/);
 await assert.rejects(service.create(admin,{ownerId:'missing',name:'A',businessName:'B',type:'SALES'}),/active platform user/);
});
test('idempotency authenticates first, binds content, and scopes request IDs per conversation',async t=>{
 let calls=0;const {service,turn,agent}=await setup(t,{complete:async()=>{calls++;return reply;}});
 const first=await service.chat(turn);assert.deepEqual(await service.chat(turn),first);
 await assert.rejects(service.chat({...turn,visitorToken:'bad'}),/Unauthorized/);
 await assert.rejects(service.chat({...turn,message:'Different'}),/different content/);
 const other=await service.startConversation({publicId:agent.publicId});
 await service.chat({...turn,...other});assert.equal(calls,2);
});
test('ownership transfer revokes public sessions, archives former tenant records, requires admin republish',async t=>{
 let complete:any;const {service,store,agent,turn}=await setup(t,{complete:()=>new Promise(resolve=>{complete=resolve;})});
 const pending=service.chat(turn);
 const transferred=await service.assignOwner(admin,agent.id,'customer',2);
 complete(reply);await assert.rejects(pending,/configuration changed/);
 assert.equal(transferred.status,'DRAFT');
 assert.equal((await service.conversations(owner,agent.id)).total,0);
 const archived=store.get(COLLECTIONS.CONVERSATIONS,turn.conversationId);
 assert.equal(archived?.status,'ARCHIVED');assert.equal(archived?.visitorTokenHash,undefined);
 await assert.rejects(service.publish(owner,agent.id,'ACTIVE',3),/administrators/);
 await service.publish(admin,agent.id,'DEMO',3);
 await assert.rejects(service.chat(turn),/does not belong/);
});
test('durable shared budget reserves worst-case three provider attempts across services',async t=>{
 let calls=0;const router:any={complete:async()=>{calls++;return reply;}};
 const {service,store,turn}=await setup(t,router,new Store(':memory:'),{HOSTED_AGENTS_DAILY_MODEL_BUDGET:'3'});
 await service.chat(turn);
 const other=new HostedAgentService({store,router,env:{HOSTED_AGENTS_DAILY_MODEL_BUDGET:'3'}});
 await assert.rejects(other.chat({...turn,requestId:'request-2'}),/Platform model quota/);
 assert.equal(calls,1);
});
test('expired worker lease recovers; stale worker cannot commit over new turn',async t=>{
 let current=Date.now();let firstComplete:any;let calls=0;
 const router:any={complete:()=>++calls===1?new Promise(r=>{firstComplete=r;}):Promise.resolve(reply)};
 const {store,agent,turn}=await setup(t,router);
 const service=new HostedAgentService({store,router,clock:()=>current});
 const first=service.chat(turn);current+=120001;
 await service.chat({...turn,requestId:'request-2'});
 firstComplete(reply);await assert.rejects(first,/configuration changed/);
 assert.equal(store.get(COLLECTIONS.CONVERSATIONS,turn.conversationId)?.messages.length,2);
});
test('configuration rejects malformed, unbounded and wrong-shaped knowledge',async t=>{
 const {service,agent}=await setup(t);
 await assert.rejects(service.update(admin,agent.id,{name:' '},2),/Invalid/);
 await assert.rejects(service.update(admin,agent.id,{appearanceJson:'[]'},2),/JSON object/);
 await assert.rejects(service.setKnowledge(admin,agent.id,JSON.stringify({companyDescription:42}),2));
 await assert.rejects(service.setKnowledge(admin,agent.id,'a'.repeat(50000),2),/maximum size/);
 assert.equal((await service.get(admin,agent.id)).version,2);
});
test('proposals link real CRM, deduplicate retries, hide archived and disabled agent offers',async t=>{
 const {service,store,agent}=await setup(t);const proposals=new HostedAgentProposalService(store,new Events(),service);
 store.put('crm_companies',{id:'prospect',name:'Fictional Co'});
 const input={agentId:agent.id,prospectId:'prospect',quoteMonthlyEur:50};
 const proposal=await proposals.createProposal(admin,input);
 assert.equal((await proposals.createProposal(admin,input)).id,proposal.id);
 assert.equal(store.get('crm_companies','prospect')?.hostedAgentProposalId,proposal.id);
 assert.ok(proposals.getPublicProposal(proposal.publicSlug));
 assert.equal(proposals.getPublicProposal(proposal.id),null);
 store.put('hosted-agent-proposals',{...proposal,status:'ARCHIVED'});
 assert.equal(proposals.getPublicProposal(proposal.publicSlug),null);
 store.put('hosted-agent-proposals',proposal);await service.disable(admin,agent.id,2);
 assert.equal(proposals.getPublicProposal(proposal.publicSlug),null);
 await assert.rejects(proposals.createProposal(admin,{agentId:agent.id}),/Publish/);
});
