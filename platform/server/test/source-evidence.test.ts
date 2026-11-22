import test from 'node:test';import assert from 'node:assert/strict';import {graphql} from 'graphql';
import{Store}from'../src/store.js';import{Events}from'../src/events.js';import{createAppSchema}from'../src/schema.js';import{sessionContext}from'../src/security.js';import{makeNextProjectFiles}from'../src/next-template.js';
test('code edits, visual edits and restores invalidate evidence without erasing the old published URL',async()=>{
 const store=new Store(':memory:');const user={id:'owner',username:'owner',role:'USER'};store.saveUser(user);const ctx=sessionContext(store,'');ctx.user=user;
 const files=makeNextProjectFiles({page:'export default function Page(){return <main><h1>Atelier de ceramică</h1><p>Lucrăm obiecte ceramice manual în Brașov.</p></main>}',css:'body{margin:0}',title:'Atelier',description:'Ceramică'});
 store.put('projects',{id:'project',ownerId:user.id,name:'Atelier',brief:'Ceramică',status:'LIVE',validationStatus:'PASSED',validationProvider:'DOCKER',publicVerified:true,deploymentUrl:'https://old-release.vercel.app',files,versions:[{id:'original',files,summary:'Original'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const schema=createAppSchema(store,new Events());
 try{
  for(const source of ['mutation{updateProjectFile(projectId:"project",path:"app/globals.css",content:"body{margin:1px}"){status validationStatus validationProvider publicVerified deploymentUrl}}','mutation{inlineTextEdit(projectId:"project",originalText:"Atelier de ceramică",replacementText:"Atelier creativ"){status validationStatus validationProvider publicVerified deploymentUrl}}','mutation{restoreProjectVersion(projectId:"project",versionId:"original"){status validationStatus validationProvider publicVerified deploymentUrl}}']){
   const current=store.get('projects','project')!;store.put('projects',{...current,status:'LIVE',validationStatus:'PASSED',validationProvider:'DOCKER',publicVerified:true});
   const response=await graphql({schema,source,contextValue:ctx});assert.equal(response.errors,undefined);const result=Object.values(response.data!)[0] as any;
   assert.equal(result.validationStatus,'NOT_RUN');assert.equal(result.validationProvider,null);assert.equal(result.publicVerified,false);assert.equal(result.status,'SOURCE_READY');assert.equal(result.deploymentUrl,'https://old-release.vercel.app');
  }
 }finally{store.close();}
});
