import type { Store, RecordData } from '../store.js';
import type { CrmServices, CallerContext } from './services.js';
import type { CrmCompany } from './types.js';
import { createHash } from 'node:crypto';
import { redactSecrets } from '../mailbox/sanitizer.js';

const emailOf=(value:unknown)=>typeof value==='string'?value.trim().toLowerCase():'';
const time=(value:unknown)=>{const parsed=typeof value==='number'?value:Date.parse(String(value || ''));return Number.isFinite(parsed)?parsed:0;};

/** Match explicit record links first; shared email addresses are deliberately ambiguous. */
export function companyForMessage(companies: CrmCompany[], message: RecordData): CrmCompany | undefined {
  if(message.companyId)return companies.find(company=>company.id===message.companyId);
  if(message.prospectId){const linked=companies.filter(company=>company.id===message.prospectId||company.legacyLeadId===message.prospectId);if(linked.length===1)return linked[0];}
  const addresses=message.direction==='INBOUND'?[emailOf(message.from?.address)]:(message.to || []).map((recipient:any)=>emailOf(recipient.address));
  const matched=companies.filter(company=>company.email&&addresses.includes(emailOf(company.email)));
  return matched.length===1?matched[0]:undefined;
}

export function reconcileLegacyLeads(store:Store,crm:CrmServices,caller:CallerContext,options:{dryRun?:boolean;limit?:number;after?:string}={}){
  const dryRun=options.dryRun!==false,limit=Math.min(250,Math.max(1,options.limit || 100));
  const all=store.list('leads').sort((a,b)=>a.id.localeCompare(b.id));
  const remaining=all.filter(lead=>!options.after||lead.id.localeCompare(options.after)>0),batch=remaining.slice(0,limit);
  const companies:CrmCompany[]=[],proposals=store.list('proposals');
  let created=0,updated=0,unchanged=0,conflicts=0;
  const changes:{leadId:string;companyId?:string;name:string;action:string}[]=[];
  if(!dryRun)store.db.exec('BEGIN IMMEDIATE');
  try{
    companies.push(...crm.listCompanies());
    for(const lead of batch){
      if(!dryRun&&lead.optedOutAt&&lead.email){const email=emailOf(lead.email),key=createHash('sha256').update(email).digest('hex');if(!store.get('outreach-suppressions',key))store.put('outreach-suppressions',{id:key,email,reason:'Imported legacy opt-out',createdAt:new Date().toISOString(),actor:caller.userId});}
      const linked=companies.filter(company=>company.legacyLeadId===lead.id);
      const byEmail=lead.email?companies.filter(company=>emailOf(company.email)===emailOf(lead.email)):[];
      const candidates=linked.length?linked:byEmail;
      if(candidates.length>1||(candidates[0]?.legacyLeadId&&candidates[0].legacyLeadId!==lead.id)){conflicts++;changes.push({leadId:lead.id,name:lead.businessName,action:'CONFLICT'});continue;}
      const current=candidates[0];
      const related=proposals.filter(proposal=>proposal.leadId===lead.id&&!['REVOKED','EXPIRED'].includes(proposal.status)).sort((a,b)=>time(b.updatedAt)-time(a.updatedAt));
      const preferred=related.find(proposal=>proposal.id===current?.proposalId)||related[0];
      const patch={name:current?.name||lead.businessName||'Unnamed business',legacyLeadId:lead.id,
        email:current?.email||lead.email||null,phone:current?.phone||lead.normalizedPhone||null,
        website:current?.website||lead.existingWebsite||null,domain:current?.domain||lead.websiteDomain||null,
        industry:current?.industry||lead.industry||null,locality:current?.locality||lead.locality||null,
        proposalId:current?.proposalId||preferred?.id||null,projectId:current?.projectId||preferred?.projectId||null};
      const changed=!current||Object.entries(patch).some(([key,value])=>(current[key]??null)!==value);
      if(!changed){unchanged++;continue;}
      if(current)updated++;else created++;
      const saved=dryRun?(current?{...current,...patch}:{...patch,id:'preview:'+lead.id,ownerId:caller.userId,qualificationStatus:'UNQUALIFIED' as const,tags:[],version:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}):crm.upsertCompany(caller,{...patch,...(current?{id:current.id}:{})},current?.version);
      if(saved&&!current)companies.push(saved);
      else if(saved&&current)companies.splice(companies.indexOf(current),1,saved);
      changes.push({leadId:lead.id,companyId:dryRun?current?.id:saved?.id,name:patch.name,action:current?'UPDATE':'CREATE'});
    }
    if(!dryRun)store.db.exec('COMMIT');
  }catch(error){if(!dryRun)store.db.exec('ROLLBACK');throw error;}
  if(!dryRun&&remaining.length<=batch.length)backfillMailboxTimeline(store,crm,caller.userId);
  return {dryRun,totalLeads:all.length,processed:batch.length,created,updated,unchanged,conflicts,changes,nextCursor:remaining.length>batch.length?batch.at(-1)?.id:null};
}

export function backfillMailboxTimeline(store:Store,crm:CrmServices,actor:string){
  const companies=crm.listCompanies(),known=new Set(crm.listActivities().map(activity=>activity.sourceEventId));
  let linked=0,activities=0;
  for(const message of store.list('mailbox-messages')){
    const company=companyForMessage(companies,message);if(!company)continue;
    if(!message.companyId){store.put('mailbox-messages',{...message,companyId:company.id});linked++;}
    const sourceEventId='mailbox:'+message.id;if(known.has(sourceEventId))continue;
    crm.logActivity({kind:message.direction==='INBOUND'?'EMAIL_INBOUND':'EMAIL_OUTBOUND',actorPrincipal:actor,
      occurredAt:message.date||message.createdAt,companyId:company.id,projectId:message.projectId,sourceEventId,
      summary:redactSecrets(`${message.direction==='INBOUND'?'Received':'Sent'} email: ${message.subject||'(No subject)'}`).slice(0,1000),visibility:'INTERNAL_ONLY'});
    known.add(sourceEventId);activities++;
  }
  return {linked,activities};
}

export interface AgencyAction {id:string;kind:string;priority:number;title:string;description:string;companyId:string;companyName:string;resourceId:string;targetView:string;occurredAt:string;}
export function agencyOverview(store:Store,crm:CrmServices,now=Date.now()){
  const companies=crm.listCompanies(),proposals=store.list('proposals'),messages=store.list('mailbox-messages'),tasks=crm.listTasks();
  const matched=new Map<string,RecordData[]>();
  for(const message of messages){const company=companyForMessage(companies,message);if(company)matched.set(company.id,[...(matched.get(company.id)||[]),message]);}
  const actions:AgencyAction[]=[];
  const add=(company:CrmCompany,kind:string,priority:number,title:string,description:string,resourceId:string,targetView:string,occurredAt:string)=>actions.push({id:kind+':'+resourceId,kind,priority,title,description,companyId:company.id,companyName:company.name,resourceId,targetView,occurredAt});
  let awaitingReply=0,claimedDemos=0,readyDemos=0;
  for(const company of companies){
    const mail=matched.get(company.id)||[],threads=new Map<string,RecordData>();
    for(const message of mail){if(message.direction==='OUTBOUND'&&!['ACCEPTED','SENT','DELIVERED'].includes(message.status))continue;const key=message.threadId||message.messageId||message.id;const current=threads.get(key);if(!current||time(message.date)>time(current.date))threads.set(key,message);}
    for(const latest of threads.values())if(latest.direction==='INBOUND'){awaitingReply++;add(company,'REPLY_NEEDED',100,'Reply to this client',latest.subject||'An incoming message is waiting.',latest.id,'mailbox',latest.date||latest.createdAt);}
    const related=proposals.filter(proposal=>proposal.companyId===company.id||proposal.id===company.proposalId||(company.legacyLeadId&&proposal.leadId===company.legacyLeadId));
    for(const proposal of related){
      if(['REVOKED','EXPIRED'].includes(proposal.status))continue;
      const claimed=!!proposal.claimedByUserId;
      if(claimed)claimedDemos++;
      if(proposal.buildVerified&&!claimed)readyDemos++;
      const cutoff=time(claimed?(proposal.claimedAt||proposal.updatedAt):(proposal.createdAt||proposal.updatedAt));
      const contacted=mail.some(message=>message.direction==='OUTBOUND'&&time(message.date)>=cutoff&&['ACCEPTED','SENT','DELIVERED'].includes(message.status));
      const suppressed=(company.legacyLeadId&&store.get('leads',company.legacyLeadId)?.optedOutAt)||(company.email&&store.get('outreach-suppressions',createHash('sha256').update(emailOf(company.email)).digest('hex')));
      if(!contacted&&!suppressed&&(claimed||proposal.buildVerified))add(company,claimed?'CLAIMED_DEMO':'DEMO_READY',claimed?80:40,claimed?'Welcome a client who claimed their demo':'Review a demo before outreach',claimed?'Their demo is claimed. Review the handoff and agree on the next step.':'A verified demo is ready. Review it and prepare a personal introduction.',proposal.id,'crm',proposal.updatedAt||proposal.createdAt);
    }
  }
  const overdue=tasks.filter(task=>['PENDING','IN_PROGRESS'].includes(task.status)&&task.dueDate&&time(task.dueDate)>0&&time(task.dueDate)<now);
  for(const task of overdue){const company=companies.find(company=>company.id===task.companyId);if(company)add(company,'OVERDUE_TASK',90,'Complete an overdue task',task.title,task.id,'tasks',task.dueDate!);}
  const seen=new Set<string>();
  const queue=actions.sort((a,b)=>b.priority-a.priority||time(a.occurredAt)-time(b.occurredAt)||a.id.localeCompare(b.id)).filter(action=>{if(seen.has(action.companyId))return false;seen.add(action.companyId);return true;}).slice(0,50);
  const runtime=store.get('mailbox-runtime','default');
  return {generatedAt:new Date(now).toISOString(),companies:companies.length,unlinkedLeads:store.list('leads').filter(lead=>!companies.some(company=>company.legacyLeadId===lead.id)).length,awaitingReply,claimedDemos,readyDemos,overdueTasks:overdue.length,actions:queue,actionCount:seen.size,mailboxLastSyncedAt:store.list('mailbox-cursors').map(cursor=>cursor.syncedAt).sort().at(-1)||null,mailboxConfigured:!!runtime?.configured,mailboxCatchingUp:!!runtime?.hasMore,mailboxLastError:runtime?.lastError||null};
}
