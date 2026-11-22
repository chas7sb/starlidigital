import test from 'node:test';
import assert from 'node:assert/strict';
import {graphql} from 'graphql';
import {Store,type RecordData} from '../src/store.js';
import {Events} from '../src/events.js';
import {CrmServices} from '../src/crm/services.js';
import {agencyOverview,companyForMessage,reconcileLegacyLeads,backfillMailboxTimeline} from '../src/crm/journey.js';
import {createAgencyMailbox} from '../src/mailbox/agency-mailbox.js';
import {createAppSchema} from '../src/schema.js';

const actor={userId:'admin',role:'ADMIN',principal:'admin'};
function setup(){const store=new Store(':memory:'),events=new Events(),crm=new CrmServices(store,events);return {store,events,crm};}
function message(id:string,overrides:Record<string,unknown>={}):RecordData{return {id,accountId:'alex-starlidigital',folder:'INBOX',messageId:id+'@example.com',threadId:'thread-'+id,direction:'INBOUND',from:{address:'client@example.com'},to:[{address:'alex@starlidigital.ro'}],cc:[],bcc:[],subject:'Website question',snippet:'Question',textBody:'Could we discuss the website?',hasHtml:false,hasRemoteImages:false,attachments:[],status:'SENT',isRead:false,isStarred:false,date:'2026-11-01T10:00:00Z',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z',references:[],...overrides};}

test('legacy connection previews without writes, preserves curated data, and is idempotent',()=>{
 const {store,crm}=setup();try{
  const current=crm.upsertCompany(actor,{name:'Curated studio',email:'client@example.com',phone:'curated phone'});
  store.put('leads',{id:'lead-1',businessName:'Imported studio',email:'CLIENT@example.com',normalizedPhone:'imported phone'});
  store.put('proposals',{id:'demo-1',leadId:'lead-1',projectId:'project-1',status:'READY',buildVerified:true,updatedAt:'2026-11-01T09:00:00Z'});
  store.put('mailbox-messages',message('incoming'));
  const preview=reconcileLegacyLeads(store,crm,actor);assert.equal(preview.updated,1);assert.equal(crm.getCompany(current.id)?.legacyLeadId,null);assert.equal(store.get('mailbox-messages','incoming')?.companyId,undefined);
  reconcileLegacyLeads(store,crm,actor,{dryRun:false});const linked=crm.getCompany(current.id)!;
  assert.equal(linked.name,'Curated studio');assert.equal(linked.phone,'curated phone');assert.equal(linked.legacyLeadId,'lead-1');assert.equal(linked.proposalId,'demo-1');assert.equal(linked.projectId,'project-1');assert.equal(store.get('mailbox-messages','incoming')?.companyId,current.id);
  const again=reconcileLegacyLeads(store,crm,actor,{dryRun:false});assert.equal(again.updated,0);assert.equal(crm.getCompany(current.id)?.version,linked.version);assert.equal(crm.listActivities({companyId:current.id}).filter(activity=>activity.kind==='EMAIL_INBOUND').length,1);
 }finally{store.close();}
});
test('shared identifiers are conflicts, not silently merged; source pagination advances',()=>{
 const {store,crm}=setup();try{
  for(const id of ['a','b'])store.put('leads',{id,businessName:'Different business '+id,email:'shared@example.com'});
  const preview=reconcileLegacyLeads(store,crm,actor,{dryRun:true});assert.equal(preview.created,1);assert.equal(preview.conflicts,1);assert.equal(crm.listCompanies().length,0);
  const first=reconcileLegacyLeads(store,crm,actor,{dryRun:false,limit:1});assert.equal(first.nextCursor,'a');
  const second=reconcileLegacyLeads(store,crm,actor,{dryRun:false,limit:1,after:first.nextCursor!});assert.equal(second.conflicts,1);assert.equal(second.nextCursor,null);assert.equal(crm.listCompanies().length,1);
 }finally{store.close();}
});
test('message matching refuses ambiguous emails and stale explicit links',()=>{
 const {store,crm}=setup();try{
  const one=crm.upsertCompany(actor,{name:'One',email:'shared@example.com'}),two=crm.upsertCompany(actor,{name:'Two',email:'shared@example.com'});
  assert.equal(companyForMessage([one,two],message('a',{from:{address:'shared@example.com'}})),undefined);
  assert.equal(companyForMessage([one,two],message('a',{from:{address:'shared@example.com'},companyId:two.id}))?.id,two.id);
  assert.equal(companyForMessage([one],message('a',{from:{address:'shared@example.com'},companyId:'deleted-company'})),undefined);
 }finally{store.close();}
});
test('next actions prioritize unanswered replies; failed sends do not count as a response',()=>{
 const {store,crm}=setup();try{
  const company=crm.upsertCompany(actor,{name:'Client',email:'client@example.com',legacyLeadId:'lead'});
  store.put('mailbox-messages',message('first',{threadId:'thread'}));
  store.put('mailbox-messages',message('failed',{threadId:'thread',direction:'OUTBOUND',to:[{address:'client@example.com'}],status:'FAILED',date:'2026-11-01T11:00:00Z'}));
  store.put('proposals',{id:'demo',leadId:'lead',buildVerified:true,claimedByUserId:'user',claimedAt:'2026-11-01T09:00:00Z',updatedAt:'2026-11-01T09:00:00Z'});
  crm.upsertTask(actor,{companyId:company.id,title:'Prepare quote',status:'PENDING',dueDate:'2026-10-31T10:00:00Z'});
  let overview=agencyOverview(store,crm,Date.parse('2026-11-01T12:00:00Z'));assert.equal(overview.awaitingReply,1);assert.equal(overview.overdueTasks,1);assert.equal(overview.actions.length,1);assert.equal(overview.actions[0].kind,'REPLY_NEEDED');
  store.put('mailbox-messages',message('sent',{threadId:'thread',direction:'OUTBOUND',to:[{address:'client@example.com'}],status:'ACCEPTED',date:'2026-11-01T11:30:00Z'}));
  overview=agencyOverview(store,crm,Date.parse('2026-11-01T12:00:00Z'));assert.equal(overview.awaitingReply,0);assert.equal(overview.actions[0].kind,'OVERDUE_TASK');
 }finally{store.close();}
});
test('mailbox sends attach to the CRM timeline and replies from Sent address the customer',async()=>{
 const {store,events,crm}=setup();try{
  const company=crm.upsertCompany(actor,{name:'Client',email:'client@example.com'});const captured:any[]=[];
  const mailbox=createAgencyMailbox({store,events,accountConfig:{id:'local-test',email:'mailbox@example.test',displayName:'Test mailbox'},transport:async args=>{captured.push(args);return {success:true,response:'250 mock',messageId:args.messageId};}});
  const draft=mailbox.createDraft({to:[{address:'client@example.com'}],subject:'Your demo',textBody:'Mock send only',cc:[{address:'copy@example.com'}],bcc:[{address:'private@example.com'}]});mailbox.approveDraft(draft.id,'admin');const sent=await mailbox.sendApprovedDraft({draftId:draft.id,actor:'admin'});
  assert.equal(store.get('mailbox-messages',sent.id)?.companyId,company.id);assert.equal(crm.listActivities({companyId:company.id}).filter(activity=>activity.kind==='EMAIL_OUTBOUND').length,1);
  assert.deepEqual(captured[0].cc,['copy@example.com']);assert.deepEqual(captured[0].bcc,['private@example.com']);
  const reply=mailbox.prepareReply(sent.id,true);assert.equal(reply.to[0].address,'client@example.com');assert.ok(reply.cc.some(recipient=>recipient.address==='copy@example.com'));assert.ok(!reply.cc.some(recipient=>recipient.address==='private@example.com'));assert.equal(backfillMailboxTimeline(store,crm,'admin').activities,0);
 }finally{store.close();}
});
test('actual application schema serves draft content and agency overview only to admins',async()=>{
 const {store,events}=setup();try{
  const schema=createAppSchema(store,events),admin={store,user:{id:'admin',role:'ADMIN',username:'admin'},setCookie:()=>{},ip:'test'};
  const created=await graphql({schema,source:'mutation{mailboxCreateDraft(to:[{address:"client@example.com"}],subject:"Demo",textBody:"Draft body"){id}}',contextValue:admin});assert.equal(created.errors,undefined);
  const result=await graphql({schema,source:'{crmAgencyOverview{companies unlinkedLeads actions{id kind}} mailboxDrafts{id subject textBody revision}}',contextValue:admin});assert.equal(result.errors,undefined);assert.equal((result.data?.mailboxDrafts as any[])[0].textBody,'Draft body');
  const denied=await graphql({schema,source:'{mailboxDrafts{id} crmAgencyOverview{companies}}',contextValue:{store,setCookie:()=>{},ip:'test'}});assert.ok(denied.errors?.length);assert.equal(denied.data,null);
 }finally{store.close();}
});
