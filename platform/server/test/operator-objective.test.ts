import test from 'node:test';import assert from 'node:assert/strict';
import {createOperatorObjective} from '../src/operator-objective.js';
import {runAutonomousOperator} from '../src/operator-agent.js';
import {Store,id,now} from '../src/store.js';import {sessionContext} from '../src/security.js';
const observed=(ledger:ReturnType<typeof createOperatorObjective>,tool:string,data:Record<string,unknown>,sequence=1,args:Record<string,unknown>={})=>ledger.observe(tool,args,{tool,ok:true,summary:'Rezultat real',data},sequence);
test('prepared messages and queued email cannot satisfy a send objective',()=>{
 const ledger=createOperatorObjective('Creează website pentru Cafeneaua Test și trimite SMS și email.');
 observed(ledger,'create_lead_proposal',{projectId:'p',proposalId:'proposal'},1);
 observed(ledger,'send_proposal_sms',{messageId:'sms',status:'APROBAT'},2);observed(ledger,'send_proposal_email',{email:{id:'email',status:'QUEUED'}},3);
 assert.equal(ledger.snapshot().requirements.find(r=>r.id==='website')!.confirmedBy.length,1);assert(ledger.pending().some(p=>p.includes('SMS expediat')));assert(ledger.pending().some(p=>p.includes('Email acceptat')));
 observed(ledger,'inspect_outbound_message',{messageId:'sms',status:'TRIMIS_DISPOZITIV'},4);observed(ledger,'inspect_email',{email:{id:'email',status:'ACCEPTED'}},5);assert.deepEqual(ledger.pending(),[]);
});
test('queued Windows work and unfinished builds require real terminal outcomes',()=>{
 const ledger=createOperatorObjective('Finalizează operațiunea existentă.');
 observed(ledger,'run_device_tool',{job:{id:'j',status:'QUEUED_DEVICE'}});observed(ledger,'wait_for_project',{projectId:'p',status:'BUILDING'});
 assert.equal(ledger.pending().length,2);observed(ledger,'inspect_job',{job:{id:'j',status:'SUCCEEDED'}},2);observed(ledger,'wait_for_project',{projectId:'p',status:'PREVIEW'},3);assert.equal(ledger.pending().length,0);
});

test('read-only inspections and prepared invitations do not create unrequested dispatch objectives',()=>{
 const ledger=createOperatorObjective('Pregătește SMS. Nu trimite. Verifică doar starea website-ului și a lucrărilor.');observed(ledger,'prepare_proposal_sms',{messageId:'sms',status:'PREGATIT'});observed(ledger,'inspect_outbound_message',{messageId:'sms',status:'PREGATIT'});observed(ledger,'inspect_job',{job:{id:'j',status:'QUEUED_DEVICE'}});observed(ledger,'inspect_project',{id:'p',status:'BUILDING'});observed(ledger,'inspect_email',{email:{id:'e',status:'QUEUED'}});assert.deepEqual(ledger.pending(),[]);
});

test('a Windows-queued SMS remains pending until its actual device job succeeds',()=>{
 const ledger=createOperatorObjective('Trimite SMS-ul existent.');observed(ledger,'send_proposal_sms',{messageId:'sms',status:'TRIMIS_DISPOZITIV',deviceJobId:'adb-job',deviceJobStatus:'QUEUED_DEVICE'});
 assert(ledger.pending().some(p=>p.includes('SMS expediat')));observed(ledger,'wait_for_job',{job:{id:'adb-job',status:'SUCCEEDED'}},2);assert.deepEqual(ledger.pending(),[]);
});
test('the final reply cannot reuse an invitation code replaced during SMS preparation',()=>{
 const ledger=createOperatorObjective('Creează website și pregătește SMS.');observed(ledger,'create_lead_proposal',{projectId:'p',proposalId:'proposal',claimCode:'11111'});
 observed(ledger,'prepare_proposal_sms',{messageId:'sms',proposalId:'proposal',claimCode:'22222'},2);
 assert(ledger.reviewReply('Codul de revendicare: 11111.').length);assert.deepEqual(ledger.reviewReply('Codul de revendicare: 22222.'),[]);assert.deepEqual(ledger.snapshot().currentInvitationCodes,['22222']);
});

test('requested invitation codes are rendered from confirmed artifacts when the model omits them',()=>{
 const ledger=createOperatorObjective('Pregătește SMS și raportează codul.');observed(ledger,'prepare_proposal_sms',{messageId:'sms',proposalId:'proposal',claimCode:'22222'});
 assert.match(ledger.completeReply('Invitația este pregătită.'),/22222/);assert.equal(ledger.completeReply('Codul este 22222.'),'Codul este 22222.');
});

test('an outdated model code is replaced by the current invitation instead of failing the task',async()=>{
 const store=new Store(':memory:'),user=store.saveUser({id:id(),username:'code_admin',role:'ADMIN',createdAt:now()}),ctx=sessionContext(store,'',()=>{},'codes');ctx.user=user;let calls=0;
 try{const result=await runAutonomousOperator({store,ctx,conversation:{id:id(),ownerId:user.id,messages:[],createdAt:now(),updatedAt:now()},prompt:'Pregătește SMS și raportează codul.',model:async()=>++calls===1?JSON.stringify({type:'tool_calls',calls:[{tool:'prepare_proposal_sms',args:{proposalId:'p'}}]}):JSON.stringify({type:'final',status:'completed',reply:'Invitația este pregătită. Codul este 99999.'}),executeTool:async tool=>({tool,ok:true,summary:'Pregătit',data:{messageId:'m',proposalId:'p',status:'PREGATIT',claimCode:'01234'}})});assert.equal(result.status,'SUCCEEDED');assert.equal(calls,2);assert.match(result.reply,/01234/);assert(!result.reply.includes('99999'));}finally{store.close();}
});
test('SMS accepted by the radio/provider completes dispatch without claiming delivery',()=>{
 const ledger=createOperatorObjective('Try sending the SMS again.');observed(ledger,'send_proposal_sms',{messageId:'sms',status:'EXPEDIAT'});assert.deepEqual(ledger.pending(),[]);assert.equal(ledger.snapshot().effects[0].status,'EXPEDIAT');
});
test('bespoke objective cannot be satisfied by a template and negative send requests add no send requirement',()=>{
 const ledger=createOperatorObjective('Construiește un website cu opțiunea 1. Nu trimite SMS sau email.');
 observed(ledger,'create_lead_proposal',{projectId:'p',proposalId:'proposal',aiGenerated:false});assert(ledger.pending().length);
 observed(ledger,'inspect_project',{id:'p',status:'PREVIEW',aiGenerated:true},2);assert.deepEqual(ledger.pending(),[]);
 const readonly=createOperatorObjective('Nu crea website. Verifică doar proiectul.');assert.deepEqual(readonly.snapshot().requirements,[]);
});
test('a premature final answer is sent back for completion instead of falsely succeeding',async()=>{
 const store=new Store(':memory:'),user=store.saveUser({id:id(),username:'goal_admin',role:'ADMIN',createdAt:now()}),ctx=sessionContext(store,'',()=>{},'goals');ctx.user=user;
 const conversation={id:id(),ownerId:user.id,messages:[],createdAt:now(),updatedAt:now()};let step=0;
 try{const result=await runAutonomousOperator({store,ctx,conversation,prompt:'Execută comanda pe Windows.',model:async({messages})=>{
  step++;if(step===1)return JSON.stringify({type:'tool_calls',calls:[{tool:'run_device_tool',args:{deviceId:'device',tool:'device.tool.exec',args:{tool:'node',args:['--version']}}}]});
  if(step===2)return JSON.stringify({type:'final',status:'completed',reply:'Gata.'});
  if(step===3){assert(messages.some(m=>m.content.includes('Finalizarea a fost refuzată')));return JSON.stringify({type:'tool_calls',calls:[{tool:'wait_for_job',args:{jobId:'j'}}]});}
  return JSON.stringify({type:'final',status:'completed',reply:'Comanda a fost executată și rezultatul verificat.'});
 },executeTool:async(tool)=>({tool,ok:true,summary:'Rezultat',data:{job:{id:'j',status:tool==='run_device_tool'?'QUEUED_DEVICE':'SUCCEEDED'}}})});
 assert.equal(result.status,'SUCCEEDED');assert.equal(step,4);assert.equal(store.get('operator-agent-runs',result.runId)!.objectiveProgress.effects[0].confirmed,true);
 }finally{store.close();}
});
