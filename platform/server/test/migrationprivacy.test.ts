import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,id,now} from '../src/store.js';
import {Events} from '../src/events.js';
import {hashPassword,sessionContext} from '../src/security.js';
import {sourceHash} from '../src/billing.js';
import {createOrUpdateProposalDemo} from '../src/leads-proposals.js';
import {repairOperatorPrivacy} from '../src/operator-privacy-repair.js';

function fixture(){
 const store=new Store(':memory:'),events=new Events();
 const admin=store.saveUser({id:id(),username:'repair_admin',email:'repair_admin@starlidigital.ro',role:'ADMIN',passwordHash:hashPassword('RepairAdmin2026!'),createdAt:now()});
 const ctx=sessionContext(store,'',()=>{},'repair-'+id());ctx.user=admin;
 const raw='Creează o propunere pentru o afacere fictivă:\nNume: Cafeneaua Miez\nDomeniu: cafenea\nLocalitate: Brașov\nPRIVAT_MIGRARE_78219: Nu publica și nu încasa bani. Raportează-mi doar operațiunile executate.';
 const prepared=createOrUpdateProposalDemo(store,events,ctx,{businessName:'Cafeneaua Miez',industry:'Cafenea',locality:'Brașov'});
 const oldName='pentru o afacere fictivă:';
 const replace=(value:any):any=>typeof value==='string'?value.split('Cafeneaua Miez').join(oldName):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)])):value;
 const project=replace(prepared.project);project.brief=raw;project.operatorPrompt=raw;
 project.files=project.files.map((file:any)=>file.path==='app/globals.css'?{...file,content:file.content+'\n/* CLIENT_STYLE_KEEP */'}:file);
 project.versions=project.versions.map((version:any)=>({...version,files:project.files,sourceHash:sourceHash(project.files)}));
 project.knowledge={businessSummary:oldName,customInstructions:raw};
 store.put('projects',project,project.ownerId);
 const lead=replace(prepared.lead),proposal=replace(prepared.proposal);proposal.specJson=JSON.stringify(replace(JSON.parse(prepared.proposal.specJson!)));
 store.put('leads',lead,lead.ownerId);store.put('proposals',proposal,proposal.ownerId);
 const welcome=replace(store.get('conversations',proposal.welcomeConversationId));welcome.messages.push({id:id(),role:'user',content:'Păstrează fotografia mea și culoarea verde.',createdAt:now()});store.put('conversations',welcome,welcome.ownerId);
 store.put('operator-conversations',{id:id(),ownerId:admin.id,messages:[{id:id(),role:'user',content:raw,createdAt:now()}],createdAt:now(),updatedAt:now()},admin.id);
 const snapshotId=admin.id+':'+sourceHash(project.files);store.put('source-snapshots',{id:snapshotId,ownerId:admin.id,projectId:project.id,sourceHash:sourceHash(project.files),files:project.files,createdAt:now()},admin.id);
 const message=store.put('outbound-messages',{id:id(),ownerId:admin.id,proposalId:proposal.id,status:'PREGATIT',body:`Website pentru ${oldName}. Cod: 01234.`,createdAt:now(),updatedAt:now()},admin.id);
 return{store,events,ctx,prepared,raw,oldName,project,proposal,lead,snapshotId,message};
}

test('legacy privacy repair archives first, cleans public artifacts and preserves client edits, invitation and identifiers',()=>{
 const f=fixture();
 try{
  const result=repairOperatorPrivacy(f.store);assert.equal(result.projects,1);assert.equal(result.snapshots,1);assert.equal(result.messages,1);
  const project=f.store.get('projects',f.project.id)!;
  assert.equal(project.name,'Cafeneaua Miez');assert.ok(!project.brief.includes('PRIVAT_MIGRARE'));assert.ok(!JSON.stringify(project).includes(f.oldName));
  assert.equal(project.operatorPrompt,undefined);assert.equal(project.knowledge.customInstructions,'');
  assert.ok(project.files.find((file:any)=>file.path==='app/globals.css').content.includes('CLIENT_STYLE_KEEP'));
  assert.equal(project.versions[0].id,f.project.versions[0].id);assert.equal(project.versions[0].sourceHash,sourceHash(project.versions[0].files));
  assert.equal(project.validationStatus,'NOT_RUN');
  const proposal=f.store.get('proposals',f.proposal.id)!;
  for(const key of ['id','projectId','leadId','ownerId','publicSlug','claimCodeHash','claimExpiresAt'])assert.equal(proposal[key],f.proposal[key]);
  assert.equal(proposal.businessName,'Cafeneaua Miez');assert.equal(f.store.get('leads',f.lead.id)!.businessName,'Cafeneaua Miez');
  const conversation=f.store.get('conversations',proposal.welcomeConversationId)!;
  assert.ok(conversation.title.includes('Cafeneaua Miez'));assert.ok(!JSON.stringify(conversation).includes(f.oldName));
  assert.equal(conversation.messages.at(-1).content,'Păstrează fotografia mea și culoarea verde.');
  const message=f.store.get('outbound-messages',f.message.id)!;assert.ok(message.body.includes('Cafeneaua Miez'));assert.ok(message.body.includes('01234'));assert.equal(message.status,'PREGATIT');
  const snapshot=f.store.get('source-snapshots',f.snapshotId)!;assert.equal(snapshot.id,f.snapshotId);assert.equal(snapshot.sourceHash,sourceHash(snapshot.files));assert.notEqual(snapshot.sourceHash,f.project.versions[0].sourceHash);
  const archive=f.store.list('operator-project-context').find(record=>record.kind==='legacy-privacy-repair')!;assert.ok(archive);assert.equal(archive.ownerId,f.ctx.user!.id);assert.equal(archive.instructions,f.raw);assert.equal(archive.originals.project.brief,f.raw);
  assert.equal(repairOperatorPrivacy(f.store).projects,0);
 }finally{f.store.close();}
});

test('repair does not change an unrelated client-authored project or remove an independent client rename',()=>{
 const f=fixture();
 try{
  const unrelated=createOrUpdateProposalDemo(f.store,f.events,f.ctx,{businessName:'Atelier Client',industry:'Mobilă',locality:'Sibiu'});
  f.store.put('projects',{...f.project,name:'Numele ales ulterior de client'},f.project.ownerId);
  const before=JSON.stringify(f.store.get('projects',unrelated.project.id));
  repairOperatorPrivacy(f.store);
  assert.equal(f.store.get('projects',f.project.id)!.name,'Numele ales ulterior de client');
  assert.equal(JSON.stringify(f.store.get('projects',unrelated.project.id)),before);
 }finally{f.store.close();}
});

test('a persistence failure rolls back the private archive and all public repairs together',()=>{
 const f=fixture();const original=f.store.put.bind(f.store),before=JSON.stringify(f.store.get('projects',f.project.id)),archiveCount=f.store.list('operator-project-context').length;
 try{
  f.store.put=((collection,value,owner)=>{if(collection==='projects')throw new Error('Repair persistence failure');return original(collection,value,owner);}) as Store['put'];
  assert.throws(()=>repairOperatorPrivacy(f.store),/Repair persistence failure/);
  f.store.put=original;
  assert.equal(JSON.stringify(f.store.get('projects',f.project.id)),before);
  assert.equal(f.store.list('operator-project-context').length,archiveCount);
  assert.equal(f.store.get('leads',f.lead.id)!.businessName,f.oldName);
 }finally{f.store.put=original;f.store.close();}
});
