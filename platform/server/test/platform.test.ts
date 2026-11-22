import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphql, subscribe, parse, validate } from 'graphql';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createAppSchema } from '../src/schema.js';
import { sessionContext, hashPassword, verifyPassword, hashToken } from '../src/security.js';
import { complexityRule } from '../src/graphql-limits.js';

test('password hashing uses independent salts and verifies credentials',()=>{const a=hashPassword('correct horse battery');const b=hashPassword('correct horse battery');assert.notEqual(a,b);assert.equal(verifyPassword('correct horse battery',a),true);assert.equal(verifyPassword('incorrect',a),false);});

test('accounts use brand identifier, guests transfer only their conversations, tenant isolation enforced',async()=>{
 const store=new Store(':memory:');const events=new Events();const schema=createAppSchema(store,events);let cookies:string[]=[];
 const ctx=sessionContext(store,'',cookie=>cookies.push(cookie),'test-guest');
 const run=(source:string,context=ctx,variables?:any)=>graphql({schema,source,contextValue:context,variableValues:variables});
 const created=await run('mutation { createConversation(mode:ALEX){id mode} }');assert.equal(created.errors,undefined);const chatId=(created.data as any).createConversation.id;assert.ok(cookies.some(x=>x.startsWith('starli_guest=')));
 const registered=await run('mutation {register(username:"maria.test",password:"very strong password",recoveryEmail:"maria@example.com"){id email role}}');assert.equal(registered.errors,undefined);assert.equal((registered.data as any).register.email,'maria.test@local.invalid');assert.equal((registered.data as any).register.role,'USER');
 assert.equal(store.get('conversations',chatId)?.ownerId,ctx.user?.id);
 const other=sessionContext(store,'',()=>{},'test-other');await run('mutation {register(username:"other.test",password:"very strong password",recoveryEmail:"other@example.com"){id}}',other);
 const denied=await run('query($id:ID!){conversation(id:$id){id messages{content}}}',other,{id:chatId});assert.equal(denied.errors?.[0].extensions.code,'FORBIDDEN');
 const memory=await run('{ memories { content } }',other);assert.equal(memory.errors?.[0].extensions.code,'FORBIDDEN');
 const conversation=await run('mutation($id:ID!){sendMessage(conversationId:$id,content:"Salut Alex"){role content}}',ctx,{id:chatId});assert.equal(conversation.errors,undefined);
 assert.equal(store.get('conversations',chatId)?.messages.length,1);
 store.close();
});

test('public blog excludes drafts and account mutation cannot set administrator role',async()=>{
 const store=new Store(':memory:');const schema=createAppSchema(store,new Events());const ctx=sessionContext(store,'');
 store.put('posts',{id:'draft',title:'Draft',slug:'draft',excerpt:'draft',content:'draft',status:'DRAFT',createdAt:new Date().toISOString(),author:'Starli AI'});
 const result=await graphql({schema,source:'{blogPosts{id} adminOverview{users}}',contextValue:ctx});assert.equal(result.errors?.[0].extensions.code,'UNAUTHENTICATED');
 const posts=await graphql({schema,source:'{blogPosts{id}}',contextValue:ctx});assert.deepEqual(JSON.parse(JSON.stringify(posts.data)),{blogPosts:[]});
 const denied=await graphql({schema,source:'mutation {register(username:"admin",password:"long enough password",recoveryEmail:"a@example.com"){role}}',contextValue:ctx});assert.ok(denied.errors);store.close();
});

test('subscription refuses access to another tenant before stream opens',async()=>{
 const store=new Store(':memory:');const events=new Events();const schema=createAppSchema(store,events);
 store.put('conversations',{id:'private',ownerId:'victim',title:'Secret',mode:'ALEX',status:'OPEN',messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const result=await subscribe({schema,document:parse('subscription{conversationUpdated(id:"private"){id}}'),contextValue:sessionContext(store,'')});assert.ok('errors' in result);store.close();
});

test('human messages require admin and remain separate from Starli conversations',async()=>{
 const store=new Store(':memory:');const schema=createAppSchema(store,new Events());const admin={store,user:{id:'admin',role:'ADMIN',username:'alex'},ip:'admin-test',setCookie:()=>{}};
 store.put('conversations',{id:'human',ownerId:'client',title:'Support',mode:'ALEX',status:'OPEN',messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const result=await graphql({schema,source:'mutation{sendMessage(conversationId:"human",content:"Salut, sunt Alex."){role authorName}}',contextValue:admin});assert.equal(result.errors,undefined);assert.equal((result.data as any).sendMessage.role,'human');assert.equal((result.data as any).sendMessage.authorName,'Alex');store.close();
});

test('password recovery token is single use and revokes active websocket access',async()=>{
 const store=new Store(':memory:');const events=new Events();const schema=createAppSchema(store,events);let session='';
 const ctx=sessionContext(store,'',cookie=>{if(cookie.startsWith('starli_session='))session=cookie.split(';')[0];},'recovery-test');
 await graphql({schema,source:'mutation{register(username:"recover.test",password:"original secure password",recoveryEmail:"recover@example.com"){id}}',contextValue:ctx});
 store.put('projects',{id:'private-project',ownerId:ctx.user!.id,name:'Private',brief:'Private',status:'BRIEF',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const socketContext=sessionContext(store,session);const stream=await subscribe({schema,document:parse('subscription{projectsUpdated{id}}'),contextValue:socketContext});assert.ok(Symbol.asyncIterator in stream);
 const token='proof-of-email-possession';store.db.prepare('INSERT INTO resets(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),ctx.user!.id,Date.now()+60000);
 const reset=await graphql({schema,source:'mutation($token:String!){resetPassword(token:$token,password:"new secure password")} ',variableValues:{token},contextValue:sessionContext(store,'',()=>{},'reset-test')});assert.equal(reset.errors,undefined);
 const iterator=(stream as AsyncIterableIterator<any>)[Symbol.asyncIterator]();const pending=iterator.next();events.publish('projects');const update=await pending;assert.deepEqual(JSON.parse(JSON.stringify(update.value.data)),{projectsUpdated:[]});await iterator.return?.();
 const replay=await graphql({schema,source:'mutation($token:String!){resetPassword(token:$token,password:"other secure password")} ',variableValues:{token},contextValue:sessionContext(store,'',()=>{},'reset-test')});assert.ok(replay.errors);assert.equal(verifyPassword('new secure password',store.findUser('recover.test')!.passwordHash),true);store.close();
});

test('expanded-fragment GraphQL complexity is bounded',()=>{
 const store=new Store(':memory:');const schema=createAppSchema(store,new Events());
 const repeated=Array.from({length:610},(_,i)=>`v${i}: name`).join(' ');
 const errors=validate(schema,parse(`query{platform{...Fields}} fragment Fields on Platform{${repeated}}`),[complexityRule]);assert.equal(errors.length,1);store.close();
});

test('guest website briefs are persistent and claimed after registration',async()=>{
 const store=new Store(':memory:');const schema=createAppSchema(store,new Events());const ctx=sessionContext(store,'',()=>{},'guest-project-test');
 const project=await graphql({schema,source:'mutation{createProject(name:"Atelier",brief:"Un atelier de ceramică în Brașov"){id status}}',contextValue:ctx});assert.equal(project.errors,undefined);const projectId=(project.data as any).createProject.id;assert.equal(store.get('projects',projectId)?.ownerId,ctx.guest);
 const signup=await graphql({schema,source:'mutation{register(username:"atelier.test",password:"very strong password",recoveryEmail:"atelier@example.com"){id}}',contextValue:ctx});assert.equal(signup.errors,undefined);assert.equal(store.get('projects',projectId)?.ownerId,ctx.user?.id);store.close();
});

test('administrator can disable users, revoke their sessions, withdraw posts and inspect audit without secrets',async()=>{
 const store=new Store(':memory:');const events=new Events();const schema=createAppSchema(store,events);const userContext=sessionContext(store,'',()=>{},'disable-user-test');
 await graphql({schema,source:'mutation{register(username:"disable.test",password:"very secure password",recoveryEmail:"disable@example.com"){id}}',contextValue:userContext});const userId=userContext.user!.id;
 const adminUser=store.saveUser({id:'admin-test',username:'alex',email:'alex@starlidigital.ro',recoveryEmail:'alex@example.com',role:'ADMIN',createdAt:new Date().toISOString(),passwordHash:hashPassword('admin secure password')});
 const admin={store,user:adminUser,ip:'admin-disable-test',setCookie:()=>{}};
 const self=await graphql({schema,source:'mutation{setUserDisabled(id:"admin-test",disabled:true){id}}',contextValue:admin});assert.ok(self.errors);
 const disabled=await graphql({schema,source:'mutation($id:ID!){setUserDisabled(id:$id,disabled:true){disabled}}',variableValues:{id:userId},contextValue:admin});assert.equal(disabled.errors,undefined);assert.equal((disabled.data as any).setUserDisabled.disabled,true);
 const me=await graphql({schema,source:'{me{id}}',contextValue:userContext});assert.equal(me.data?.me,null);
 const login=await graphql({schema,source:'mutation{login(username:"disable.test",password:"very secure password"){id}}',contextValue:sessionContext(store,'',()=>{},'disabled-login-test')});assert.equal(login.errors?.[0].extensions.code,'UNAUTHENTICATED');
 store.put('posts',{id:'published',slug:'published',title:'Title',excerpt:'Excerpt',content:'Content',status:'PUBLISHED',author:'Starli AI',createdAt:new Date().toISOString(),publishedAt:new Date().toISOString()});
 const withdraw=await graphql({schema,source:'mutation{unpublishBlogPost(id:"published"){status publishedAt}}',contextValue:admin});assert.equal(withdraw.errors,undefined);assert.equal((withdraw.data as any).unpublishBlogPost.status,'DRAFT');
 const publicPosts=await graphql({schema,source:'{blogPosts{id}}',contextValue:sessionContext(store,'')});assert.deepEqual(JSON.parse(JSON.stringify(publicPosts.data)),{blogPosts:[]});
 const audit=await graphql({schema,source:'{adminAudit{action actorName} adminUsers{disabled}}',contextValue:admin});assert.equal(audit.errors,undefined);assert.ok((audit.data as any).adminAudit.some((x:any)=>x.action==='account.disabled'));store.close();
});

test('persisted daily build admission blocks provider calls across API schema instances',async()=>{
 const saved={key:process.env.OPENAI_API_KEY,global:process.env.GLOBAL_DAILY_BUILD_LIMIT,anonymous:process.env.ANONYMOUS_DAILY_BUILD_LIMIT};const store=new Store(':memory:');let network=0;const original=globalThis.fetch;
 process.env.OPENAI_API_KEY='unit-test';process.env.GLOBAL_DAILY_BUILD_LIMIT='1';process.env.ANONYMOUS_DAILY_BUILD_LIMIT='0';globalThis.fetch=async()=>{network++;throw new Error('Quota must stop provider calls');};
 try{
  const ctx=sessionContext(store,'',()=>{},'quota-first');const schema=createAppSchema(store,new Events());const created=await graphql({schema,source:'mutation{createProject(name:"Atelier",brief:"Un atelier de ceramică"){id}}',contextValue:ctx});const id=(created.data as any).createProject.id;
  const blocked=await graphql({schema,source:'mutation($id:ID!){buildProject(id:$id){status}}',variableValues:{id},contextValue:ctx});assert.equal(blocked.errors?.[0].extensions.code,'RATE_LIMITED');assert.equal(network,0);assert.equal(store.get('projects',id)?.status,'BRIEF');
  process.env.ANONYMOUS_DAILY_BUILD_LIMIT='20';const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());store.put('usage-limits',{id:'builds-'+day,global:1,anonymous:0});
  const restarted=createAppSchema(store,new Events());const again=await graphql({schema:restarted,source:'mutation($id:ID!){buildProject(id:$id){status}}',variableValues:{id},contextValue:{...ctx,ip:'quota-after-restart'}});assert.equal(again.errors?.[0].extensions.code,'RATE_LIMITED');assert.equal(network,0);
 }finally{globalThis.fetch=original;for(const[key,value]of Object.entries({OPENAI_API_KEY:saved.key,GLOBAL_DAILY_BUILD_LIMIT:saved.global,ANONYMOUS_DAILY_BUILD_LIMIT:saved.anonymous})){if(value===undefined)delete process.env[key];else process.env[key]=value;}store.close();}
});
