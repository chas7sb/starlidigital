import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../../server/src/store.ts';
import {Events} from '../../server/src/events.ts';
import {HostedAgentService} from '../../server/src/hosted-agents/service.ts';
import {tenantStore,CUSTOMER_TOOLS} from './tenant-store.ts';
import {tenantBusinessEvents} from './tenant-business-events.ts';

test('tenant hosted agent events use trusted schema initialization without exposing SQL or other tenant events',async t=>{
 const backing=new Store(':memory:');t.after(()=>backing.close());const events=new Events();
 const alice=tenantStore(backing,'alice'),bob=tenantStore(backing,'bob');
 const writer=tenantBusinessEvents(backing,alice,'alice',events);
 const service=new HostedAgentService({store:alice,events,businessEvents:writer});
 const actor={userId:'alice',role:'ADMIN' as const};
 let agent=await service.create(actor,{name:'Alice agent',businessName:'Test',type:'SALES',enabledTools:[]});
 agent=await service.publish(actor,agent.id,'DEMO',agent.version);
 const session=await service.startConversation({publicId:agent.publicId});
 assert.equal(backing.db.prepare('SELECT COUNT(*) AS n FROM business_events').get()!.n,1);
 assert.equal(bob.get('hosted-agent-conversations',session.conversationId),undefined);
 const event={type:'agent.message_received' as const,idempotencyKey:'attempt',correlationId:session.conversationId,metadata:{conversationId:session.conversationId,agentId:agent.id,ownerId:'alice'}};
 assert.throws(()=>tenantBusinessEvents(backing,bob,'bob').append(event),/TENANT_EVENT_DENIED/);
 assert.throws(()=>writer.append({...event,metadata:{...event.metadata,ownerId:'bob'}}),/TENANT_EVENT_DENIED/);
 assert.throws(()=>writer.notifyCommitted(999999),/TENANT_EVENT_DENIED/);
 assert.throws(()=>alice.db.exec('SELECT * FROM business_events'),/RAW_DATABASE_ACCESS_DENIED/);
 assert.equal((alice.db as any).prepare,undefined);
 assert.equal(backing.db.prepare('SELECT COUNT(*) AS n FROM business_events').get()!.n,1);
});

test('actual private bridge catalog starts for customer and administrator, retaining tenant tool allowlist',()=>{
 const dir=mkdtempSync(join(tmpdir(),'starli-catalog-regression-')),db=join(dir,'platform.sqlite'),backing=new Store(db);
 backing.saveUser({id:'admin',username:'catalog-admin',role:'ADMIN'});backing.close();
 try{
  for(const customer of [true,false]){
   const result=spawnSync(process.execPath,['--import','tsx',new URL('./platform-bridge.mts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{cwd:new URL('../../',import.meta.url),env:{...process.env,STARLI_STATE_DIR:dir,STARLI_SOURCE_DATABASE:db},input:JSON.stringify({operation:'catalog',customer,owner:customer?'alice':'admin'})+'\n',encoding:'utf8',timeout:30000,windowsHide:true});
   assert.equal(result.status,0,result.stderr);
   const catalog=JSON.parse(result.stdout);assert.ok(catalog.tools.length>20);
   assert.ok(catalog.tools.some((tool:any)=>tool.name==='agent_create'));
   if(customer)assert.ok(catalog.tools.every((tool:any)=>CUSTOMER_TOOLS.has(tool.name)));
  }
  const call=(owner:string,tool:string,args:any)=>{
   const result=spawnSync(process.execPath,['--import','tsx',new URL('./platform-bridge.mts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{cwd:new URL('../../',import.meta.url),env:{...process.env,STARLI_STATE_DIR:dir,STARLI_SOURCE_DATABASE:db},input:JSON.stringify({operation:'call',customer:true,owner,tool,args})+'\n',encoding:'utf8',timeout:30000,windowsHide:true});
   assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  const created=call('alice','agent_create',{name:'Private Alice agent',businessName:'Test business',type:'SALES'});
  assert.ok(!created.isError,JSON.stringify(created));
  const agent=JSON.parse(created.content.find((c:any)=>c.type==='text').text);
  assert.equal(agent.ownerId,'alice');
  assert.equal(call('bob','agent_get',{id:agent.id}).isError,true);
  assert.ok(!call('alice','agent_get',{id:agent.id}).isError);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
