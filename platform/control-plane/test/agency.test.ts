import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { CrmServices } from '../../server/src/crm/services.js';
import { createControlPlaneServer } from '../src/server.js';
import { FixtureTokenVerifier } from '../src/auth.js';
import { SqliteAuditSink } from '../src/audit.js';
import { reserveOutreach, finishOutreach } from '../src/outreach-guard.js';
import { isPublicAddress, publicRequest } from '../src/public-http.js';
import { scoreProspect } from '../src/tools/agency.js';
import { MailboxServices } from '../../server/src/mailbox/service.js';
import type { SmtpSendArgs } from '../../server/src/smtp.js';

const store=new Store(':memory:'),events=new Events(),crm=new CrmServices(store,events),audit=new SqliteAuditSink(':memory:');
const caller={userId:'admin',role:'admin'};
const sent:SmtpSendArgs[]=[];
const mailbox=new MailboxServices({accountConfig:{id: 'local-test',email: 'mailbox@example.test',displayName: 'Test mailbox'},store,events,transport:async args=>{sent.push(args);return {success:true,response:'250 mock accepted',messageId:args.messageId};}});
const company=crm.upsertCompany(caller,{name:'Example Studio',email:'owner@example.com'});
const verifier=new FixtureTokenVerifier();verifier.registerToken('admin-test',{id:'admin',role:'admin',scopes:['read','write']});verifier.registerToken('reader-test',{id:'reader',role:'admin',scopes:['read']});
const server=createControlPlaneServer({config:{host:'127.0.0.1',port:0,allowedOrigins:[],upstreamHealthUrl:'http://127.0.0.1/health',controlDbPath:':memory:'},tokenVerifier:verifier,auditSink:audit,healthProbe:{async probe(){return {ready:true,service:'fixture',dependencies:{}};}},store,events,crmServices:crm,mailboxServices:mailbox});
let client:Client,port:number;
before(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));port=(server.address() as {port:number}).port;client=await connect('admin-test');});
after(async()=>{await client.close();await new Promise<void>(resolve=>server.close(()=>resolve()));audit.close();store.close();});
async function connect(token:string){const instance=new Client({name:'agency-tests',version:'1.0.0'});await instance.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}}));return instance;}
async function call(name:string,args:Record<string,unknown>){const result=await client.callTool({name,arguments:args});const content=result.content as {text:string}[];return JSON.parse(content[0].text);}

it('discovers new schemas alongside existing tools',async()=>{const {tools}=await client.listTools();for(const name of ['client_workspace_create','client_workspace_get','lead_score','inbox_search','unsubscribe','outreach_send_email','website_generate'])assert.ok(tools.some(tool=>tool.name===name&&tool.inputSchema.type==='object'),name);});
it('persists a single workspace and aggregates real linked projects',async()=>{
 store.put('projects',{id:'test-project',companyId:company.id,name:'Studio website',files:[{path:'secret-content'}],previewHtml:'heavy preview'});
 const first=await call('client_workspace_create',{companyId:company.id}),second=await call('client_workspace_create',{companyId:company.id});
 assert.equal(first.result.workspace_id,second.result.workspace_id);assert.equal(second.result.created,false);
 const read=await call('client_workspace_get',{workspaceId:first.result.workspace_id});assert.equal(read.result.company_id,company.id);assert.equal(read.result.projects[0].id,'test-project');assert.equal(read.result.projects[0].files,undefined);
 const missing=await call('client_workspace_get',{workspaceId:'missing'});assert.equal(missing.error.code,'NOT_FOUND');
 const created=await call('project_manage',{action:'create',name:'Linked build',workspaceId:first.result.workspace_id});assert.equal(created.project.companyId,company.id);assert.equal(created.project.knowledge.language,'en');
});
it('reports unknown need without evidence and scores verified signals with sources',()=>{
 const unknown=scoreProspect(company,[]);assert.equal(unknown.developmentNeed,null);assert.equal(unknown.purchaseIntent,null);
 const input={id:'s',companyId:company.id,kind:'NO_WEBSITE',source:'DIRECTORY',title:'No official site',summary:'Observed',evidenceUrl:'https://example.com/source',verified:true,confidenceScore:1,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const scored=scoreProspect(company,[input]);assert.equal(scored.developmentNeed,50);assert.equal(scored.evidence[0].source,input.evidenceUrl);assert.equal(scoreProspect(company,[{...input,verified:false}]).developmentNeed,null);
});
it('moves pipeline through the CRM service and rejects stale versions',async()=>{
 const opportunity=crm.upsertOpportunity(caller,{companyId:company.id,title:'Website',amount:200,currency:'EUR',stageId:'lead'});
 const moved=await call('pipeline_move',{opportunityId:opportunity.id,stageId:'proposal',expectedVersion:opportunity.version});assert.equal(moved.result.stageId,'proposal');
 const stale=await call('pipeline_move',{opportunityId:opportunity.id,stageId:'closed_won',expectedVersion:opportunity.version});assert.ok(stale.error);
 assert.ok(crm.listActivities({companyId:company.id}).some(activity=>activity.kind==='STAGE_CHANGE'));
});
it('denies internal mutations for read-only tokens',async()=>{const reader=await connect('reader-test');try{const result=await reader.callTool({name:'client_workspace_create',arguments:{companyId:company.id}});assert.equal(result.isError,true);}finally{await reader.close();}});
it('enforces suppression and durable idempotency without a real SMTP call',async()=>{
 await call('unsubscribe',{email:'STOP@example.com',reason:'Requested opt-out'});
 assert.throws(()=>reserveOutreach(store,'admin',{to:['stop@example.com'],subject:'Test',bodyText:'No send'}),/SUPPRESSED/);
 const input={to:['test@example.org'],subject:'Test',bodyText:'No real send',idempotencyKey:'test-request'};
 const first=reserveOutreach(store,'admin',input);assert.equal(first.cached,false);
 assert.throws(()=>reserveOutreach(store,'admin',input),/UNCONFIRMED/);
 finishOutreach(store,first.record,{status:'SMTP_ACCEPTED',messageId:'mock-message'});
 assert.equal(reserveOutreach(store,'admin',input).cached,true);
 assert.throws(()=>reserveOutreach(store,'admin',{...input,bodyText:'Changed content'}),/CONFLICT/);
});
it('blocks local, reserved, encoded and IPv6 private HTTP targets',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.2','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('1.1.1.1'),true);
 for(const url of ['http://127.0.0.1/','http://2130706433/','http://[::1]/'])await assert.rejects(publicRequest(url),/prohibited/);
});
it('executes send through mocked SMTP once, preserves threading, and honors opt-outs',async()=>{
 store.put('mailbox-messages',{id:'incoming-1',messageId:'original@example.net',threadId:'thread-1',references:['earlier@example.net']});
 const args={to:['reply@example.net'],subject:'Re: Website',bodyText:'Mock-only reply',inReplyToMessageId:'incoming-1',idempotencyKey:'reply-test'};
 const first=await call('outreach_send_email',args),second=await call('outreach_send_email',args);
 assert.equal(first.status,'SENT');assert.equal(first.deliveryConfirmed,false);assert.equal(second.messageId,first.messageId);assert.equal(sent.length,1);
 assert.equal(sent[0].inReplyTo,'original@example.net');assert.deepEqual(sent[0].references,['earlier@example.net','original@example.net']);
 assert.equal(mailbox.getMessage(first.messageId)?.threadId,'thread-1');
 const blocked=await call('outreach_send_email',{...args,to:['stop@example.com'],idempotencyKey:'blocked-send'});assert.ok(blocked.error);assert.equal(sent.length,1);
});
