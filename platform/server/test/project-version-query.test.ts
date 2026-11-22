import test from 'node:test';import assert from 'node:assert/strict';import {graphql} from 'graphql';
import{Store}from'../src/store.js';import{Events}from'../src/events.js';import{createAppSchema}from'../src/schema.js';import{sessionContext}from'../src/security.js';
test('version previews load on demand and remain bound to project ownership',async()=>{
 const store=new Store(':memory:');const user={id:'owner',username:'owner',role:'USER'};const other={id:'other',username:'other',role:'USER'};store.saveUser(user);store.saveUser(other);const ctx=sessionContext(store,'');ctx.user=user;
 const version={id:'version',projectId:'project',source:'edit',summary:'Variantă',createdBy:'owner',bookmarked:false,sourceHash:'hash',files:[],previewHtml:'<h1>Private version</h1>',createdAt:new Date().toISOString()};
 store.put('projects',{id:'project',ownerId:user.id,name:'Atelier',versions:[version]});
 const schema=createAppSchema(store,new Events());const source='query($v:ID!){projectVersion(projectId:"project",versionId:$v){id previewHtml}}';
 try{
  let result=await graphql({schema,source,variableValues:{v:'version'},contextValue:ctx});assert.equal(result.errors,undefined);assert.equal((result.data as any).projectVersion.previewHtml,version.previewHtml);
  result=await graphql({schema,source,variableValues:{v:'missing'},contextValue:ctx});assert.equal((result.data as any).projectVersion,null);
  ctx.user=other;result=await graphql({schema,source,variableValues:{v:'version'},contextValue:ctx});assert.ok(result.errors?.length);assert.equal((result.data as any).projectVersion,null);
 }finally{store.close();}
});

import {subscribe,parse} from 'graphql';
test('single project subscription returns only the authorized project and rechecks ownership',async()=>{
 const store=new Store(':memory:');const owner={id:'owner',username:'owner',role:'USER'};const other={id:'other',username:'other',role:'USER'};store.saveUser(owner);store.saveUser(other);const ctx=sessionContext(store,'');ctx.user=owner;
 store.put('projects',{id:'one',ownerId:'owner',name:'One'});store.put('projects',{id:'two',ownerId:'other',name:'Two'});const events=new Events();const schema=createAppSchema(store,events);const document=parse('subscription{projectUpdated(id:"one"){id name}}');
 let iterator:AsyncIterableIterator<any>|undefined;
 try{
  const result=await subscribe({schema,document,contextValue:ctx});assert.ok(Symbol.asyncIterator in result);iterator=result as AsyncIterableIterator<any>;
  const waiting=iterator.next();events.publish('projects');let update=await waiting;assert.equal(update.value.data.projectUpdated.id,'one');
  store.put('projects',{id:'one',ownerId:'other',name:'Transferred'});const next=iterator.next();events.publish('projects');update=await next;assert.ok(update.value.errors?.length);assert.equal(update.value.data.projectUpdated,null);
  const rejected=await subscribe({schema,document,contextValue:ctx});assert.ok('errors' in rejected);
 }finally{await iterator?.return?.();store.close();}
});
