import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const port=Number(process.env.TEST_PORT||4121),url=`http://127.0.0.1:${port}`;
const password=randomBytes(24).toString('base64url');
const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATABASE_PATH:':memory:',ADMIN_USERNAME:'operator',ADMIN_PASSWORD:password,OPENAI_API_KEY:'',NODE_ENV:'test',ALLOWED_ORIGINS:'http://127.0.0.1:5173'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function browser(){let cookies=new Map();return{get cookie(){return [...cookies].map(([k,v])=>`${k}=${v}`).join('; ');},async query(query,variables={}){const res=await fetch(url+'/graphql',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5173',Cookie:this.cookie},body:JSON.stringify({query,variables})});for(const c of res.headers.getSetCookie()){const [pair]=c.split(';');const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return res.json();}};}
let ws;
try{
  let ready=false;for(let i=0;i<60;i++){try{ready=(await fetch(url+'/health')).ok;if(ready)break;}catch{}if(child.exitCode!==null)throw new Error(logs);await sleep(250);}assert.ok(ready,'API ready');
  const guest=browser(),other=browser(),admin=browser();
  let result=await guest.query('mutation { createConversation(mode:ALEX) { id mode messages { content } } }');assert.ok(!result.errors,JSON.stringify(result.errors));const conversation=result.data.createConversation.id;
  result=await other.query('query($id:ID!){conversation(id:$id){id}}',{id:conversation});assert.equal(result.errors[0].extensions.code,'FORBIDDEN');
  result=await guest.query('mutation($id:ID!){sendMessage(conversationId:$id,content:"Salut Alex, am nevoie de un website."){content role}}',{id:conversation});assert.equal(result.data.sendMessage.role,'user');
  result=await guest.query('query{adminOverview{users}}');assert.equal(result.errors[0].extensions.code,'UNAUTHENTICATED');
  result=await admin.query('mutation($password:String!){login(username:"operator",password:$password){role}}',{password});assert.equal(result.data.login.role,'ADMIN');assert.match(admin.cookie,/starli_session=/);
  result=await admin.query('query{conversations{id messages{content}}}');assert.ok(result.data.conversations.some(c=>c.id===conversation));
  ws=createClient({url:`ws://127.0.0.1:${port}/graphql`,webSocketImpl:class extends WebSocket{constructor(address,protocols){super(address,protocols,{headers:{Cookie:guest.cookie,Origin:'http://127.0.0.1:5173'}});}},lazy:false,retryAttempts:0});
  let finish;let reject;const received=new Promise((resolve,rejectFn)=>{finish=resolve;reject=rejectFn;});
  const dispose=ws.subscribe({query:'subscription($id:ID!){conversationUpdated(id:$id){id messages{content role}}}',variables:{id:conversation}},{next:value=>{if(value.data?.conversationUpdated?.messages.some(m=>m.content==='Salut! Sunt Alex.'))finish(value);},error:reject,complete:()=>{}});
  await sleep(350);
  result=await admin.query('mutation($id:ID!){sendMessage(conversationId:$id,content:"Salut! Sunt Alex."){role authorName}}',{id:conversation});assert.equal(result.data.sendMessage.role,'human');
  await Promise.race([received,sleep(5000).then(()=>{throw new Error('GraphQL subscription did not receive admin reply');})]);dispose();
  result=await guest.query('mutation{createProject(name:"Atelier test",brief:"Website de prezentare pentru un atelier local."){id status}}');assert.ok(!result.errors,JSON.stringify(result.errors));const project=result.data.createProject.id;
  result=await guest.query('mutation($id:ID!){buildProject(id:$id){status}}',{id:project});assert.equal(result.errors[0].extensions.code,'INTEGRATION_UNAVAILABLE');
  result=await guest.query('mutation($password:String!){register(username:"client_test",password:$password,recoveryEmail:"client@example.com"){email role}}',{password});assert.equal(result.data.register.email,'client_test@local.invalid');assert.equal(result.data.register.role,'USER');
  result=await guest.query('query{projects{id} conversations{id}}');assert.ok(result.data.projects.some(p=>p.id===project));assert.ok(result.data.conversations.some(c=>c.id===conversation));
  result=await other.query('query{projects{id} conversations{id}}');assert.deepEqual(result.data.projects,[]);assert.deepEqual(result.data.conversations,[]);
  result=await admin.query('mutation{saveMemory(title:"Proiect aprobat",content:"Am construit un website de prezentare fără date personale.",publicApproved:true){id publicApproved}}');assert.equal(result.data.saveMemory.publicApproved,true);
  result=await guest.query('query{memories{id content}}');assert.equal(result.errors[0].extensions.code,'FORBIDDEN');
  result=await guest.query('mutation{logout}');assert.equal(result.data.logout,true);result=await guest.query('query{me{id} projects{id}}');assert.equal(result.data.me,null);assert.deepEqual(result.data.projects,[]);
  const forbidden=await fetch(url+'/graphql',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({query:'{me{id}}'})});assert.equal(forbidden.status,403);
  console.log('PASS: HTTP cookies, guest ownership, human inbox, live GraphQL subscription, account transfer, admin permissions, unavailable AI, logout, origin protection.');
}catch(error){console.error(error);console.error(logs.slice(-3000));process.exitCode=1;}finally{await ws?.dispose();child.kill();}
