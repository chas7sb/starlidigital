import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,id,now} from '../src/store.js';
import {sessionContext} from '../src/security.js';
import {Events} from '../src/events.js';
import {makeNextProjectFiles} from '../src/next-template.js';
import {renderNextPreviewHtml} from '../src/preview-renderer.js';
import {bespokeCreativeBrief,buildBespokeOperatorProposal,recoverInterruptedBespokeBuilds} from '../src/operator-bespoke.js';

function source(){return makeNextProjectFiles({page:'export default function Home(){return <main><h1>Pizeria Viva</h1><p>O primă pagină personalizată pentru pizzeria din Hunedoara.</p></main>}',css:'body{font-family:Arial;background:#faf7ed;color:#13241a}',title:'Pizeria Viva',description:'Pizerie în Hunedoara',extraFiles:['servicii','despre','contact'].map(page=>({path:`app/${page}/page.tsx`,content:`export default function Page(){return <main><h1>${page}</h1><p>Informații pentru vizita ta la Pizeria Viva.</p></main>}`}))});}
function fixture(){
 const store=new Store(':memory:'),events=new Events(),admin=store.saveUser({id:id(),username:'admin',role:'ADMIN',createdAt:now()}),ctx=sessionContext(store,'',()=>{},'test-operator-bespoke');ctx.user=admin;
 const lead={id:id(),businessName:'Pizeria Viva',industry:'Pizzerie',locality:'Hunedoara',normalizedPhone:'+40722111222',email:'viva@example.ro'};
 const files=source(),project={id:id(),ownerId:admin.id,name:lead.businessName,brief:'Website de prezentare pentru Pizeria Viva.',files,previewHtml:'last-good-preview',versions:[],status:'PREVIEW'};
 const proposal={id:id(),ownerId:admin.id,projectId:project.id,leadId:lead.id,businessName:lead.businessName,generationMode:'bespoke',status:'PREGATIT',specJson:JSON.stringify({branding:{visualMood:'editorial'}})};
 store.put('leads',lead,admin.id);store.put('projects',project,admin.id);store.put('proposals',proposal,admin.id);
 return{store,events,ctx,lead,project,proposal};
}

test('generated images survive a page failure and are reused on recovery without duplicating the project',async()=>{
 const f=fixture(),assets=[{path:'public/assets/hero.png',content:'aGVybw==',encoding:'base64' as const}];
 try{
  await assert.rejects(buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{build:async(_brief,_name,options)=>{options?.onAssets?.(assets);throw Error('Page generation interrupted');},workerEnabled:()=>false}),/interrupted/);
  assert.deepEqual(f.store.get('operator-build-assets',f.project.id)?.files,assets);
  const result=await buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{build:async(_brief,_name,options)=>{assert.deepEqual(options?.assets,assets);assert.equal(options?.requiredPages?.length,4);return{files:source()};},workerEnabled:()=>false});
  assert.equal(result.project.id,f.project.id);assert.equal(f.store.list('projects').length,1);assert.equal(f.store.get('operator-build-assets',f.project.id),undefined);
 }finally{f.store.close();}
});

test('bespoke builder receives public business facts, never raw operator instructions',async()=>{
 const f=fixture();let generated=0,verified=0;const privatePrompt='PRIVATE_SENTINEL_DO_NOT_EXPOSE\nStil: editorial, crem și verde\nNu publica și nu contacta clientul.';
 try{
  f.store.put('operator-project-context',{id:f.proposal.id,privateInstructions:privatePrompt},f.ctx.user!.id);
  const result=await buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{
   build:async(brief,name,options)=>{generated++;assert.equal(name,'Pizeria Viva');assert.ok(brief.includes('Hunedoara'));assert.ok(brief.includes('editorial, crem, verde'));assert.ok(!brief.includes('PRIVATE_SENTINEL'));assert.ok(!brief.includes('Nu publica'));assert.ok(options?.existingResearch?.sources.length===0);return{files:source()};},
   workerEnabled:()=>true,
   verify:async files=>{verified++;return{previewHtml:renderNextPreviewHtml(files),validationStatus:'PASSED',validationProvider:'DOCKER',buildLog:'verified'};}
  });
  assert.equal(generated,1);assert.equal(verified,1);assert.equal(result.project.operatorBespokeGenerated,true);assert.equal(result.proposal.buildVerified,true);assert.equal(result.project.validationProvider,'DOCKER');assert.equal(result.project.versions.length,1);assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  const repeat=await buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,privatePrompt,{build:async()=>{throw Error('duplicate request');}});
  assert.equal(repeat.alreadyGenerated,true);
 }finally{f.store.close();}
});

test('provider failure does not report template success or discard the last good source',async()=>{
 const f=fixture();try{
  await assert.rejects(buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,'private',{build:async()=>{throw Error('Provider is unavailable');},workerEnabled:()=>false}),/Provider is unavailable/);
  const project=f.store.get('projects',f.project.id)!,proposal=f.store.get('proposals',f.proposal.id)!;
  assert.equal(project.status,'BUILD_FAILED');assert.equal(project.operatorBespokeGenerated,false);assert.equal(proposal.status,'ESEC');assert.deepEqual(project.files,f.project.files);assert.equal(project.previewHtml,'last-good-preview');assert.equal(project.versions.length,0);assert.ok(!project.buildError.includes('Provider is unavailable'));assert.equal(f.store.get('operator-project-context',f.proposal.id)!.lastBuildError,'Provider is unavailable');
 }finally{f.store.close();}
});

test('incomplete AI output and failed real compilation cannot become a successful bespoke proposal',async()=>{
 const f=fixture();try{
  await assert.rejects(buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{build:async()=>({files:source().filter(x=>x.path!=='app/contact/page.tsx')}),workerEnabled:()=>false}),/patru pagini/);
  await assert.rejects(buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{build:async()=>({files:source()}),workerEnabled:()=>true,verify:async()=>{throw Error('Real compilation failed');}}),/Real compilation failed/);
  assert.equal(f.store.get('projects',f.project.id)!.operatorBespokeStatus,'FAILED');assert.equal(f.store.get('proposals',f.proposal.id)!.buildVerified,false);
 }finally{f.store.close();}
});

test('missing private context never causes raw instructions or secrets to be inferred from public fields',()=>{
 const brief=bespokeCreativeBrief({id:'lead',businessName:'Viva',industry:'Pizzerie',locality:'Hunedoara'},{id:'spec'});
 assert.ok(brief.includes('"phone":null'));assert.ok(!brief.includes('49523'));assert.ok(!brief.includes('privateInstructions'));
});

test('restart recovery releases stale operator builds without claiming completion or losing source',()=>{
 const f=fixture();try{f.store.put('projects',{...f.project,status:'BUILDING',operatorBespokeStatus:'BUILDING'},f.project.ownerId);assert.equal(recoverInterruptedBespokeBuilds(f.store),1);const current=f.store.get('projects',f.project.id)!;assert.equal(current.operatorBespokeStatus,'INTERRUPTED');assert.deepEqual(current.files,f.project.files);assert.equal(current.status,'BUILD_FAILED');assert.equal(recoverInterruptedBespokeBuilds(f.store),0);}finally{f.store.close();}
});

test('canceling a build prevents a late provider result from replacing the project',async()=>{
 const f=fixture(),controller=new AbortController();try{const pending=buildBespokeOperatorProposal(f.store,f.events,f.ctx,f.proposal.id,undefined,{signal:controller.signal,workerEnabled:()=>false,build:async()=>{await new Promise(resolve=>setTimeout(resolve,40));return{files:source()};}});controller.abort();await assert.rejects(pending,/oprită/);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(f.store.get('projects',f.project.id)!.operatorBespokeStatus,'FAILED');assert.equal(f.store.get('projects',f.project.id)!.versions.length,0);}finally{f.store.close();}
});
