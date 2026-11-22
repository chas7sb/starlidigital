import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {BusinessEventService} from '../src/business-events.js';
import {HostedAgentService} from '../src/hosted-agents/service.js';
import type {Context} from '../src/security.js';
async function fixture(t:any,events=new Events(),complete=async()=>({reply:'Hello. How can I help?',latencyMs:1})) {
 const store=new Store(':memory:');t.after(()=>store.close());
 store.saveUser({id:'admin',username:'admin',role:'ADMIN'});
 const actor={userId:'admin',role:'ADMIN' as const};
 const service=new HostedAgentService({store,events,router:{complete} as any});
 let agent=await service.create(actor,{name:'Test agent',businessName:'Fictional studio',type:'SALES',enabledTools:[]});
 agent=await service.publish(actor,agent.id,'DEMO',agent.version);
 const brain=new BusinessEventService(store,events);
 const ctx={store,user:store.user('admin'),setCookie:()=>{},ip:'test'} as Context;
 return {store,service,agent,brain,ctx};
}
test('hosted lifecycle emits ordered deduplicated safe events without capability or contact data',async t=>{
 const {store,service,agent,brain,ctx}=await fixture(t);
 const session=await service.startConversation({publicId:agent.publicId});
 const input={publicId:agent.publicId,conversationId:session.conversationId,visitorToken:session.visitorToken,requestId:'event-turn-1',message:'My email is alice@example.com. Can you help?'};
 const result=await service.chat(input);assert.equal(result.capturedLead,true);
 await service.chat(input);
 const page=brain.list(ctx);
 assert.deepEqual(page.events.map(e=>e.type),['agent.conversation_started','agent.message_received','agent.lead_captured']);
 assert.ok(page.events.every(e=>e.correlationId===session.conversationId && e.source==='HOSTED_AGENT'));
 const encoded=JSON.stringify(page.events);assert.ok(!encoded.includes(session.visitorToken));assert.ok(!encoded.includes('alice@example.com'));assert.ok(!encoded.includes(input.message));
 const received=page.events[1];const conversation=store.get('hosted-agent-conversations',session.conversationId)!;
 assert.equal(received.metadata.messageId,conversation.messages[0].id);
 await service.chat({...input,requestId:'event-turn-2',message:'Thank you.'});
 assert.equal(brain.list(ctx,{type:'agent.lead_captured'}).events.length,1);
 assert.equal(brain.list(ctx,{type:'agent.message_received'}).events.length,2);
});
test('provider failure and same-request retry retain one accepted-input event',async t=>{
 let calls=0;const {service,agent,brain,ctx}=await fixture(t,new Events(),async()=>{if(++calls===1)throw new Error('provider down');return {reply:'Hello',latencyMs:1};});
 const session=await service.startConversation({publicId:agent.publicId});
 const input={publicId:agent.publicId,...session,requestId:'retry-turn',message:'Hello'};
 await assert.rejects(service.chat(input),/temporarily busy/);await service.chat(input);
 assert.equal(brain.list(ctx,{type:'agent.message_received'}).events.length,1);
});
test('noncritical event consumer failure never breaks conversation start',async t=>{
 class BrokenConsumer extends Events { override publish(topic:string,value:any=null){if(topic==='business-events')throw new Error('consumer failed');super.publish(topic,value);} }
 const {service,agent,brain,ctx}=await fixture(t,new BrokenConsumer());
 const session=await service.startConversation({publicId:agent.publicId});assert.ok(session.visitorToken);
 assert.equal(brain.list(ctx).events.length,1);
});
test('event insert failure rolls back conversation creation atomically',async t=>{
 const {store,service,agent}=await fixture(t);
 store.db.exec("CREATE TRIGGER reject_business_event BEFORE INSERT ON business_events BEGIN SELECT RAISE(ABORT,'event storage failure'); END");
 await assert.rejects(service.startConversation({publicId:agent.publicId}),/event storage failure/);
 assert.equal(store.list('hosted-agent-conversations').length,0);
});
