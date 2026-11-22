import type {Store} from '../store.js';
import type {Events} from '../events.js';
import {CrmServices} from '../crm/services.js';
import type {CrmCompany,CrmContact,CrmOpportunity,CrmSignal} from '../crm/types.js';
import {MailboxServices} from '../mailbox/service.js';
import type {MailDraftRecord,MailMessageRecord} from '../mailbox/types.js';
import {AgencyApprovalService} from '../agency-approvals/service.js';
import type {AgencyApprovalRecord} from '../agency-approvals/types.js';
import type {AgencyActionPlan} from '../agency-intelligence/types.js';

const FIXTURE_TAG='SYNTHETIC_FIXTURE';
const COMPANY_KEY='machinery-demo-company';
const CONTACT_EMAIL='mira@example.invalid';
const PROPOSAL_ID='machinery-demo-proposal';
const ACTION_PLAN_ID='machinery-demo-email-send-plan';
const THREAD_ID='machinery-demo-thread';
const STUB_RECEIPT_ID='machinery-demo-stub-email-receipt';

export interface MachinerySalesFixtureFact{label:string;value:string;provenance:'SYNTHETIC_FIXTURE';verified:boolean}
export interface MachinerySalesScore{value:number;band:'LOW'|'MEDIUM'|'HIGH';reasons:string[];provenance:'DEMO_HEURISTIC'}
export interface MachineryDemoProposal{id:string;tenantId:string;companyId:string;opportunityId:string;title:string;summary:string;status:'PREPARED_FIXTURE';provenance:'SYNTHETIC_FIXTURE';createdAt:string;updatedAt:string}
export interface MachineryDemoStubReceipt{id:string;tenantId:string;draftId:string;status:'ACCEPTED';transport:'TEST_STUB';delivered:false;detail:string;createdAt:string}
export interface MachinerySalesDemoSnapshot{
  tenantId:string;company:CrmCompany;contact:CrmContact;signals:CrmSignal[];facts:MachinerySalesFixtureFact[];score:MachinerySalesScore;opportunity:CrmOpportunity;proposal:MachineryDemoProposal;draft:MailDraftRecord;approval:AgencyApprovalRecord;stubReceipt:MachineryDemoStubReceipt|null;fixtureThread:MailMessageRecord[];nextAction:string;sendPerformed:false;
}

export class MachinerySalesDemoService{
  private crm:CrmServices;
  private mailbox:MailboxServices;
  private approvals:AgencyApprovalService;
  constructor(private store:Store,private events:Events,private clock=()=>Date.now()){
    this.crm=new CrmServices(store,events);
    this.mailbox=new MailboxServices({store,events,accountConfig:{id:'demo-mailbox',email:'starli-demo@example.invalid',displayName:'Starli Demo'}});
    this.approvals=new AgencyApprovalService(store,events,clock);
  }

  run(tenantId:string):MachinerySalesDemoSnapshot{
    const tenant=this.safeTenant(tenantId),caller={userId:tenant,principal:'machinery-demo'};
    const company=this.ensureCompany(tenant);
    const contact=this.ensureContact(tenant,company.id);
    const facts:MachinerySalesFixtureFact[]=[
      {label:'Business type',value:'Synthetic boutique clinic fixture',provenance:'SYNTHETIC_FIXTURE',verified:false},
      {label:'Website state',value:'Fixture says current site has no online booking CTA',provenance:'SYNTHETIC_FIXTURE',verified:false},
      {label:'Growth signal',value:'Fixture says team is testing paid social acquisition',provenance:'SYNTHETIC_FIXTURE',verified:false},
    ];
    const signals=this.ensureSignals(tenant,company.id,facts);
    const score=this.score(signals);
    const opportunity=this.ensureOpportunity(tenant,company.id,contact.id,score);
    const proposal=this.ensureProposal(tenant,company.id,opportunity.id);
    const draft=this.ensureDraft(company,contact,opportunity,proposal);
    const approval=this.ensureApproval(tenant,company,opportunity,draft);
    const fixtureThread=this.ensureFixtureThread(company,contact,opportunity,draft);
    const stubReceipt=this.store.get('machinery-demo-email-receipts',STUB_RECEIPT_ID) as MachineryDemoStubReceipt|undefined;
    return{tenantId:tenant,company,contact,signals,facts,score,opportunity,proposal,draft,approval,stubReceipt:stubReceipt||null,fixtureThread,nextAction:this.nextAction(fixtureThread,approval),sendPerformed:false};
  }

  recordExplicitTestStubAcceptance(tenantId:string,draftId:string):MachineryDemoStubReceipt{
    const tenant=this.safeTenant(tenantId),draft=this.store.get('mailbox-drafts',draftId) as MailDraftRecord|undefined;
    if(!draft)throw new Error('Demo draft unavailable.');
    const approval=this.approvals.list(tenant).find(row=>row.actionPlanId===ACTION_PLAN_ID);
    if(!approval||approval.status!=='APPROVED')throw new Error('Explicit approved demo action is required before creating a test stub receipt.');
    const existing=this.store.get('machinery-demo-email-receipts',STUB_RECEIPT_ID) as MachineryDemoStubReceipt|undefined;if(existing)return existing;
    const receipt:MachineryDemoStubReceipt={id:STUB_RECEIPT_ID,tenantId:tenant,draftId,status:'ACCEPTED',transport:'TEST_STUB',delivered:false,detail:'Accepted by the explicit test stub only. This is not SMTP delivery and not recipient delivery.',createdAt:new Date(this.clock()).toISOString()};
    this.store.put('machinery-demo-email-receipts',receipt as any,tenant);return receipt;
  }

  private ensureCompany(tenant:string){
    const existing=this.crm.listCompanies({ownerId:tenant,tag:FIXTURE_TAG}).find(c=>c.customFields?.demoKey===COMPANY_KEY);if(existing)return existing;
    return this.crm.upsertCompany({userId:tenant,principal:'machinery-demo'},{name:'Aurora Clinic Demo',industry:'Healthcare',country:'RO',email:'hello@example.invalid',qualificationStatus:'QUALIFYING',ownerId:tenant,tags:[FIXTURE_TAG],customFields:{demoKey:COMPANY_KEY,factProvenance:'SYNTHETIC_FIXTURE'}});
  }
  private ensureContact(tenant:string,companyId:string){const existing=this.crm.listContacts(companyId).find(c=>c.email===CONTACT_EMAIL);if(existing)return existing;return this.crm.upsertContact({userId:tenant,principal:'machinery-demo'},{companyId,firstName:'Mira',lastName:'Demo',email:CONTACT_EMAIL,roleTitle:'Founder',isPrimary:true,ownerId:tenant});}
  private ensureSignals(tenant:string,companyId:string,facts:MachinerySalesFixtureFact[]){return facts.map((fact,index)=>{const kind=`DEMO_FACT_${index+1}`,existing=this.crm.listSignals(companyId).find(s=>s.source===FIXTURE_TAG&&s.kind===kind);if(existing)return existing;return this.crm.addSignal({userId:tenant,principal:'machinery-demo'},{companyId,source:FIXTURE_TAG,kind,title:fact.label,summary:fact.value,evidenceUrl:null,confidenceScore:[.65,.8,.7][index]||.5,verified:false,metadata:{provenance:'SYNTHETIC_FIXTURE',demoOnly:true}});});}
  private score(signals:CrmSignal[]):MachinerySalesScore{const avg=signals.length?signals.reduce((sum,s)=>sum+s.confidenceScore,0)/signals.length:0;const value=Math.round(Math.min(100,Math.max(0,avg*80+signals.length*5)));return{value,band:value>=70?'HIGH':value>=40?'MEDIUM':'LOW',reasons:[`${signals.length} synthetic fixture signals`,`${Math.round(avg*100)}% average fixture confidence`,'Score is demo heuristic only; it is not verified market intelligence.'],provenance:'DEMO_HEURISTIC'};}
  private ensureOpportunity(tenant:string,companyId:string,contactId:string,score:MachinerySalesScore){const existing=this.crm.listOpportunities({companyId}).find(o=>o.title==='Machinery demo opportunity');if(existing)return existing;return this.crm.upsertOpportunity({userId:tenant,principal:'machinery-demo'},{companyId,primaryContactId:contactId,title:'Machinery demo opportunity',amount:750,currency:'EUR',stageId:'proposal',probability:score.value,ownerId:tenant});}
  private ensureProposal(tenant:string,companyId:string,opportunityId:string){const existing=this.store.get('machinery-demo-proposals',PROPOSAL_ID) as MachineryDemoProposal|undefined;if(existing)return existing;const at=new Date(this.clock()).toISOString(),proposal:MachineryDemoProposal={id:PROPOSAL_ID,tenantId:tenant,companyId,opportunityId,title:'Aurora Clinic — demo growth system',summary:'Synthetic demo proposal: booking-focused website refresh + AI intake assistant + campaign landing page.',status:'PREPARED_FIXTURE',provenance:'SYNTHETIC_FIXTURE',createdAt:at,updatedAt:at};this.store.put('machinery-demo-proposals',proposal as any,tenant);return proposal;}
  private ensureDraft(company:CrmCompany,contact:CrmContact,opportunity:CrmOpportunity,proposal:MachineryDemoProposal){const existing=this.mailbox.listDrafts(200).find(d=>d.companyId===company.id&&d.opportunityId===opportunity.id&&d.subject==='[DEMO DRAFT] Aurora Clinic idea');if(existing)return existing;return this.mailbox.createDraft({fromAccount:'starli-demo@example.invalid',to:[{address:contact.email||CONTACT_EMAIL,name:contact.fullName}],subject:'[DEMO DRAFT] Aurora Clinic idea',textBody:`Synthetic demo draft only — not sent.\n\nHi ${contact.firstName},\n\nI prepared a fixture proposal for ${company.name}: ${proposal.summary}\n\nThis draft exists only to demonstrate Starli's approval-before-send workflow.`,companyId:company.id,opportunityId:opportunity.id});}
  private ensureApproval(tenant:string,company:CrmCompany,opportunity:CrmOpportunity,draft:MailDraftRecord){const createdAt=new Date(this.clock()).toISOString();const plan:AgencyActionPlan={id:ACTION_PLAN_ID,tenantId:tenant,opportunityId:opportunity.id,status:'PROPOSED',action:{kind:'SEND_EMAIL',label:'Send demo outreach email',rationale:'Send the prepared fixture email draft only after explicit human approval.',autonomyAllowed:'EXECUTE_APPROVED',approvalRequired:true},entityRefs:[{kind:'crm_company',id:company.id},{kind:'mail_draft',id:draft.id}],evidenceRefs:['fixture:synthetic-demo-only'],capabilityRequirement:'mail.send',approvalRequired:true,autonomyAllowed:'EXECUTE_APPROVED',createdAt};const existing=this.store.get('agency-action-plans',ACTION_PLAN_ID) as AgencyActionPlan|undefined;if(!existing)this.store.put('agency-action-plans',plan as any,tenant);return this.approvals.ensureForPlan(existing||plan)!;}
  private ensureFixtureThread(company:CrmCompany,contact:CrmContact,opportunity:CrmOpportunity,draft:MailDraftRecord){const existing=this.mailbox.getThread(THREAD_ID);if(existing.length)return existing;const at=new Date(this.clock()).toISOString();const outbound:MailMessageRecord={id:'machinery-demo-thread-outbound',accountId:'demo-mailbox',folder:'Fixture',messageId:'<fixture-outbound@example.invalid>',threadId:THREAD_ID,direction:'OUTBOUND',from:{address:'starli-demo@example.invalid',name:'Starli Demo'},to:[{address:contact.email||CONTACT_EMAIL,name:contact.fullName}],cc:[],references:[],subject:'[SYNTHETIC FIXTURE] Demo proposal follow-up',snippet:'Fixture thread only; no provider send occurred.',textBody:'Synthetic fixture thread. This is stored demo data, not evidence of an email send.',hasHtml:false,hasRemoteImages:false,attachments:[],status:'ACCEPTED',isRead:true,isStarred:false,date:at,createdAt:at,updatedAt:at,companyId:company.id,opportunityId:opportunity.id};const inbound:MailMessageRecord={id:'machinery-demo-thread-inbound',accountId:'demo-mailbox',folder:'Fixture',messageId:'<fixture-inbound@example.invalid>',inReplyTo:outbound.messageId,references:[outbound.messageId],threadId:THREAD_ID,direction:'INBOUND',from:{address:contact.email||CONTACT_EMAIL,name:contact.fullName},to:[{address:'starli-demo@example.invalid',name:'Starli Demo'}],cc:[],subject:'Re: [SYNTHETIC FIXTURE] Demo proposal follow-up',snippet:'Synthetic reply: looks interesting, can we see a booking demo?',textBody:'Synthetic fixture reply: Looks interesting. Can you show me how the booking flow would work?',hasHtml:false,hasRemoteImages:false,attachments:[],status:'ACCEPTED',isRead:false,isStarred:false,date:at,createdAt:at,updatedAt:at,companyId:company.id,opportunityId:opportunity.id};this.store.put('mailbox-messages',outbound);this.store.put('mailbox-messages',inbound);return[outbound,inbound];}
  private nextAction(thread:MailMessageRecord[],approval:AgencyApprovalRecord){const inbound=thread.filter(m=>m.direction==='INBOUND').at(-1);if(inbound)return 'Prepare a booking-flow demo response draft from the stored synthetic reply; do not send without a fresh governed approval.';if(approval.status==='PENDING')return 'Review the pending send approval. Approval grants permission only; no send has happened.';return 'No verified next action is available.';}
  private safeTenant(value:string){const v=String(value||'').trim();if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(v))throw new Error('Invalid tenant identity.');return v;}
}
