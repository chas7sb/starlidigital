import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const root=new URL('../',import.meta.url);
const moduleUrl=(source)=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const workspace=moduleUrl(readFileSync(new URL('src/lib/utils/company-workspace.ts',root),'utf8'));
const source=readFileSync(new URL('src/lib/components/enterprise/messaging/collaboration-client.ts',root),'utf8').replace('$lib/utils/company-workspace',workspace);
const {CollaborationClient,verifiedTeamRun}=await import(moduleUrl(source));
const run={version:'starli.collaboration.run.v1',runId:'run-a',companyId:'company-a',conversationId:'room-a',bossId:'boss-a',teammateIds:['bot-b'],sourceMessageId:'message-a',state:'QUEUED',round:0,modelCalls:0,stopRequested:false,confirmedStopped:false,needsReview:false};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('start matches strict native body and keeps idempotency in header',async()=>{
 let request;
 const client=new CollaborationClient('company-a','room-a',()=> 'session-a',async(url,options)=>{request={url,options};return response(run,202);});
 await client.start({bossId:'boss-a',teammateIds:['bot-b'],sourceMessageId:'message-a',idempotencyKey:'operation-a'});
 assert.equal(request.url,'/api/v1/starli/companies/company-a/messaging/rooms/room-a/collaborations');
 assert.deepEqual(JSON.parse(request.options.body),{bossId:'boss-a',teammateIds:['bot-b'],sourceMessageId:'message-a'});
 assert.equal(request.options.headers['Idempotency-Key'],'operation-a');
 assert.equal(request.options.headers.Authorization,'Bearer session-a');
 client.close();
});
test('Stop requests once and does not fabricate confirmed cancellation',async()=>{
 let count=0;
 const client=new CollaborationClient('company-a','room-a',()=> 'session-a',async(url,options)=>{count++;assert(url.endsWith('/run-a/stop'));assert.equal(options.method,'POST');assert.equal(options.body,undefined);return response({...run,state:'STOP_REQUESTED',stopRequested:true});});
 const value=await client.stop('run-a');assert.equal(count,1);assert.equal(value.confirmedStopped,false);assert.equal(value.state,'STOP_REQUESTED');client.close();
});
test('rejects foreign company, room, run, malformed status and transcript',()=>{
 for(const patch of [{companyId:'other'},{conversationId:'other'},{runId:'other'},{state:'invented'},{confirmedStopped:true},{modelCalls:-1},{messages:[{botId:'boss-a',content:'not verified',state:'POSTED',kind:'reply'}]}])assert.throws(()=>verifiedTeamRun({...run,...patch},'company-a','room-a','run-a'));
});
test('session change or closed client cannot initiate a request',async()=>{
 let token='session-a',calls=0;
 const client=new CollaborationClient('company-a','room-a',()=>token,async()=>{calls++;return response(run);});
 token='session-b';await assert.rejects(client.read('run-a'));assert.equal(calls,0);client.close();
 await assert.rejects(client.read('run-a'));assert.equal(calls,0);
});
test('HTTP failure is not retried automatically',async()=>{
 let calls=0;const client=new CollaborationClient('company-a','room-a',()=> 'session-a',async()=>{calls++;return response({detail:'unavailable'},503);});
 await assert.rejects(client.start({bossId:'boss-a',teammateIds:['bot-b'],sourceMessageId:'message-a',idempotencyKey:'operation-a'}));assert.equal(calls,1);client.close();
});
test('room/message scope is freshly checked before choosing source',async()=>{
 const client=new CollaborationClient('company-a','room-a',()=> 'session-a',async url=>url.endsWith('/room-a')?response({id:'room-a',companyId:'company-a',agentIds:['boss-a','bot-b'],lastMessageSequence:1}):response({messages:[{id:'message-a',roomId:'foreign'}]}));
 await assert.rejects(client.context());client.close();
});
