import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {tenantStore} from './tenant-store.ts';
const {Store}=await import('/srv/starlidigital/current/server/src/store.ts');
const {Events}=await import('/srv/starlidigital/current/server/src/events.ts');
const {createCrmServices}=await import('/srv/starlidigital/current/server/src/crm/services.ts');
const {registerProjectTools}=await import('/srv/starlidigital/current/control-plane/src/tools/projects.ts');
const {registerCrmTools}=await import('/srv/starlidigital/current/control-plane/src/tools/crm.ts');
const parse=(result:any)=>JSON.parse(result.content.find(c=>c.type==='text').text);
async function setup(owner:string,store:any){
 const scoped=tenantStore(store,owner),events=new Events();
 const server=new McpServer({name:'tenant-isolation-test',version:'1'});
 const ctx:any={server,principal:{id:owner,role:'admin',scopes:['read','write']},store:scoped,events,crmServices:createCrmServices({store:scoped,events}),auditCall:()=>{}};
 registerProjectTools(ctx);registerCrmTools(ctx);
 const client=new Client({name:'tenant-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 return {client,server,scoped,async call(name:string,args:any={}){return client.callTool({name,arguments:args});}};
}
test('real legacy project/CRM tools cannot cross tenant ownership',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'starli-tenant-tool-test-')),store=new Store(join(dir,'fixture.sqlite'));
 let alice:any,bob:any;
 try{
  store.saveUser({id:'alice',username:'alice-test',role:'USER',disabled:false,passwordHash:'!SERVICE_ONLY!'});
  store.saveUser({id:'bob',username:'bob-test',role:'USER',disabled:false,passwordHash:'!SERVICE_ONLY!'});
  alice=await setup('alice',store);bob=await setup('bob',store);
  const projectA=parse(await alice.call('project_manage',{action:'create',name:'Alice private project'})).project;
  const projectB=parse(await bob.call('project_manage',{action:'create',name:'Bob private project'})).project;
  const listedA=parse(await alice.call('projects_list',{}));
  assert.equal(listedA.projects.length,1);assert.equal(listedA.projects[0].id,projectA.id);
  assert.equal((await alice.call('project_get',{projectId:projectB.id})).isError,true);
  assert.equal((await alice.call('project_manage',{action:'delete',projectId:projectB.id,confirmDelete:true})).isError,true);
  assert.ok(store.get('projects',projectB.id));
  assert.equal((await alice.call('project_manage',{action:'delete',projectId:projectA.id,confirmDelete:true})).isError,undefined);
  assert.equal(store.get('projects',projectA.id),undefined);
  const companyA=parse(await alice.call('crm_upsert_prospect',{name:'Alice company',domain:'alice.example.test'}));
  const companyB=parse(await bob.call('crm_upsert_prospect',{name:'Bob company',domain:'bob.example.test'}));
  assert.ok(companyA.id&&companyB.id);
  const companiesA=parse(await alice.call('crm_search_prospects',{}));assert.equal(companiesA.length,1);assert.equal(companiesA[0].id,companyA.id);
  assert.equal((await alice.call('crm_get_prospect',{id:companyB.id})).isError,true);
  assert.equal((await alice.call('crm_upsert_prospect',{id:companyB.id,name:'Takeover',expectedVersion:companyB.version})).isError,true);
  assert.equal(store.get('crm_companies',companyB.id).name,'Bob company');
  assert.equal(alice.scoped.user('bob'),undefined);
  assert.throws(()=>alice.scoped.saveUser({id:'alice',role:'ADMIN'}),/DENIED/);
  assert.equal(store.user('alice').role,'USER');
 }finally{await alice?.client.close();await alice?.server.close();await bob?.client.close();await bob?.server.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
