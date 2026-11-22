import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureVercelProject,findDeploymentByRequest,verifyPublicDeployment} from '../src/integrations/vercel.js';

test('project provisioning confirms stable binding and public protection settings',async()=>{
 const original=globalThis.fetch,key=process.env.VERCEL_TOKEN;process.env.VERCEL_TOKEN='unit';let calls=0,created='';
 globalThis.fetch=async(_url,init)=>{calls++;if(calls===1)return new Response('{}',{status:404});if(calls===2){assert.equal(init?.method,'POST');const body=JSON.parse(String(init?.body));assert.equal(body.name,'starli-example');assert.equal(body.ssoProtection,null);return new Response(JSON.stringify({id:'prj_created',name:body.name,framework:'nextjs'}));}return new Response(JSON.stringify({id:'prj_created',name:'starli-example',framework:'nextjs',ssoProtection:null,passwordProtection:null,trustedIps:null}));};
 try{const result=await ensureVercelProject({name:'starli-example',onCreated:project=>{created=project.id;}});assert.equal(result.id,'prj_created');assert.equal(created,'prj_created');assert.equal(calls,3);
  globalThis.fetch=async()=>new Response(JSON.stringify({id:'prj_created',name:'starli-example',framework:'nextjs'}));await assert.rejects(ensureVercelProject({name:'starli-example'}),/asociere locală/);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=key;}
});

test('unknown deployment reconciliation requires provider metadata and project identity',async()=>{
 const original=globalThis.fetch,key=process.env.VERCEL_TOKEN;process.env.VERCEL_TOKEN='unit';const hash='a'.repeat(64);
 globalThis.fetch=async(url)=>String(url).includes('/v7/deployments?')?new Response(JSON.stringify({deployments:[{uid:'dpl_found',meta:{starliRequestId:'fulfill-test'}}],pagination:{next:null}})):new Response(JSON.stringify({id:'dpl_found',url:'found.vercel.app',readyState:'READY',projectId:'prj_test',meta:{starliRequestId:'fulfill-test',starliSourceHash:hash}}));
 try{const result=await findDeploymentByRequest({projectId:'prj_test',requestId:'fulfill-test',since:Date.now()});assert.equal(result?.id,'dpl_found');assert.equal(result?.sourceHash,hash);await assert.rejects(findDeploymentByRequest({projectId:'prj_other',requestId:'fulfill-test',since:Date.now()}),/verificată/);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=key;}
});

test('public verification uses no credentials and rejects protected, redirected or untrusted URLs',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(_url,init)=>{calls++;assert.equal((init?.headers as any)?.Authorization,undefined);assert.equal(init?.redirect,'error');return new Response('login',{status:401,headers:{'Content-Type':'text/html'}});};
 try{assert.equal(await verifyPublicDeployment('https://private.vercel.app'),false);assert.equal(await verifyPublicDeployment('https://outside.example'),false);assert.equal(calls,1);globalThis.fetch=async()=>new Response('<html>public</html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});assert.equal(await verifyPublicDeployment('https://public.vercel.app'),true);
 }finally{globalThis.fetch=original;}
});
