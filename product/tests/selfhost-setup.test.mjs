import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {compile,preprocess} from 'svelte/compiler';
const root=new URL('../',import.meta.url);
const source=readFileSync(new URL('src/lib/utils/selfhost-setup.ts',root),'utf8');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(transpile(source)).toString('base64'));
const fresh={setupRequired:true,singleCompany:true,registrationAllowed:false,setupLocked:false,companyConfigured:false};
const configured={...fresh,setupRequired:false,setupLocked:true,companyConfigured:true};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const signal=()=>new AbortController().signal;
const details={name:'Synthetic Owner',email:'owner@example.invalid',password:'Synthetic-QA-Password-Only',companyName:'Synthetic Company'};

test('first browser entry uses authoritative fresh/configured state, not a missing token',()=>{
 assert.equal(api.installationEntry(fresh),'create-initial-administrator');assert.equal(api.installationEntry(configured),'workspace');
 for(const value of [null,{}, {...fresh,singleCompany:false},{...fresh,registrationAllowed:true},{...fresh,setupLocked:true},{...configured,requiresMigration:true},{...configured,companyConfigured:false}])assert.throws(()=>api.verifiedSetupStatus(value));
});
test('unavailable or malformed status never exposes initial-admin flow',async()=>{
 for(const transport of [async()=>response({},503),async()=>new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}}),async()=>response({setupRequired:true})])await assert.rejects(api.loadSetupStatus(signal(),transport));
});
test('fresh initialization posts once with exact setup guard and confirms completion',async()=>{
 let initialized=false;const calls=[];
 const result=await api.createInitialAdministrator(details,signal(),async(url,options)=>{calls.push({url,options});if(url==='/api/v1/setup/status')return response(initialized?configured:fresh);assert.equal(url,'/api/v1/setup');assert.equal(options.headers['X-Starli-Setup'],'1');assert.deepEqual(JSON.parse(options.body),details);initialized=true;return response({setupComplete:true,companyId:'company-a',signInRequired:true},201);});
 assert.equal(result.companyId,'company-a');assert.deepEqual(calls.map(c=>c.url),['/api/v1/setup/status','/api/v1/setup','/api/v1/setup/status']);assert.equal('password'in result,false);
});
test('configured installation refuses setup locally before a mutation',async()=>{
 let calls=0;await assert.rejects(api.createInitialAdministrator(details,signal(),async(url)=>{calls++;assert.equal(url,'/api/v1/setup/status');return response(configured);}));assert.equal(calls,1);
});
test('concurrent loser gets no replay, signup or automatic sign-in',async()=>{
 const calls=[];await assert.rejects(api.createInitialAdministrator(details,signal(),async(url)=>{calls.push(url);return url.endsWith('/status')?response(fresh):response({detail:'SETUP_ALREADY_COMPLETE'},409);}));assert.deepEqual(calls,['/api/v1/setup/status','/api/v1/setup']);
});
test('post-setup sign-in uses existing native password auth and verifies admin identity',async()=>{
 const calls=[];const token=await api.signInInitialAdministrator(details.email,details.password,signal(),async(url,options)=>{calls.push(url);if(url.endsWith('/signin')){assert.deepEqual(JSON.parse(options.body),{email:details.email,password:details.password});return response({token:'synthetic-session'});}assert.equal(options.headers.Authorization,'Bearer synthetic-session');return response({id:'admin-a',role:'admin',email:details.email});});assert.equal(token,'synthetic-session');assert.deepEqual(calls,['/api/v1/auths/signin','/api/v1/auths/']);
 await assert.rejects(api.signInInitialAdministrator(details.email,details.password,signal(),async url=>url.endsWith('/signin')?response({token:'synthetic-session'}):response({id:'other',role:'user',email:details.email})));
});
test('single-company selection never chooses an arbitrary or production-named company',()=>{
 const one={id:'company-a',name:'Any Local Name'};assert.equal(api.onlyInstallationCompany([one]),one);assert.throws(()=>api.onlyInstallationCompany([]));assert.throws(()=>api.onlyInstallationCompany([one,{id:'company-b',name:'StarliDigital'}]));
});
test('selfhost root preserves native workspace and retires guest/invitation registration entry',async()=>{
 const read=path=>readFileSync(new URL(path,root),'utf8');const page=read('src/routes/+page.svelte'),layout=read('src/routes/+layout.svelte'),workspace=read('src/routes/app/+page.svelte');
 assert(page.includes("from './app/+page.svelte'"));assert(!page.includes('Homepage'));assert(layout.includes('SelfHostGate'));assert(!workspace.includes('openInvitations'));assert(!workspace.includes("list.find(c=>c.name"));assert(workspace.includes('onlyInstallationCompany(list)'));
 for(const text of [page,layout,workspace,read('src/routes/guest/+page.svelte'),read('src/routes/join/+page.svelte')])assert(!/href=["']\/(register|guest)|auths\/signup/.test(text));
 for(const path of ['src/routes/+page.svelte','src/routes/+layout.svelte','src/routes/app/+page.svelte','src/lib/components/enterprise/InitialAdministrator.svelte','src/lib/components/enterprise/SelfHostGate.svelte']){
  const output=await preprocess(read(path),{script:({content})=>({code:transpile(content)})},{filename:path});compile(output.code,{filename:path,generate:'ssr'});
 }
});
