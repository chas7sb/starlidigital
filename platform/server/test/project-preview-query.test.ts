import test from 'node:test';import assert from 'node:assert/strict';import {graphql} from 'graphql';
import{Store}from'../src/store.js';import{Events}from'../src/events.js';import{createAppSchema}from'../src/schema.js';import{sessionContext}from'../src/security.js';
test('preview pages use the requested owned project version and reject unknown paths',async()=>{
 const store=new Store(':memory:');const user={id:'owner',username:'owner',role:'USER'};const other={id:'other',username:'other',role:'USER'};store.saveUser(user);store.saveUser(other);const ctx=sessionContext(store,'');ctx.user=user;
 const page=(label:string)=>({path:'app/contact/page.tsx',content:`export default function Contact(){return <main><h1>${label}</h1></main>}`});
 store.put('projects',{id:'project',ownerId:user.id,name:'Atelier',files:[page('Contact actual')],versions:[{id:'old',files:[page('Contact anterior')]}]});
 const schema=createAppSchema(store,new Events());const source='query($path:String!,$version:ID){projectPreview(projectId:"project",path:$path,versionId:$version)}';
 const query=(path:string,version?:string)=>graphql({schema,source,variableValues:{path,version},contextValue:ctx});
 try{
  let result=await query('/contact');assert.equal(result.errors,undefined);assert.match(String(result.data?.projectPreview),/Contact actual/);
  result=await query('/contact','old');assert.equal(result.errors,undefined);assert.match(String(result.data?.projectPreview),/Contact anterior/);
  for(const path of ['/app/admin','https://example.com','/../contact'])assert.ok((await query(path)).errors?.length);
  assert.ok((await query('/contact','missing')).errors?.length);
  ctx.user=other;assert.ok((await query('/contact')).errors?.length);
 }finally{store.close();}
});
