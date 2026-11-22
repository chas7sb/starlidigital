import { MailboxServices, type CreateMailboxServicesOptions } from './service.js';
import { CrmServices } from '../crm/services.js';
import { companyForMessage } from '../crm/journey.js';

/** One integration path for GraphQL, MCP and background IMAP activity. */
export function createAgencyMailbox(options:CreateMailboxServicesOptions){
  const crm=new CrmServices(options.store,options.events);
  return new MailboxServices({...options,crmActivitySink:async activity=>{
    const message=options.store.get('mailbox-messages',activity.sourceEventId);
    const company=activity.companyId?crm.getCompany(activity.companyId):message?companyForMessage(crm.listCompanies(),message):undefined;
    if(company){
      if(message&&!message.companyId)options.store.put('mailbox-messages',{...message,companyId:company.id});
      crm.logActivity({kind:activity.kind,actorPrincipal:activity.actor,occurredAt:activity.occurredAt,companyId:company.id,
        opportunityId:activity.opportunityId,projectId:activity.projectId,sourceEventId:'mailbox:'+activity.sourceEventId,
        summary:activity.redactedSummary.slice(0,1000),visibility:'INTERNAL_ONLY'});
    }
    await options.crmActivitySink?.(activity);
  }});
}
