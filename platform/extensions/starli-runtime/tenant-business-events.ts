import {BusinessEventService, type AppendBusinessEvent} from '../../server/src/business-events.js';
import type {Store} from '../../server/src/store.js';
import type {Events} from '../../server/src/events.js';

/** Only trusted bootstrap receives the backing store. Tenant callers get no SQL or event reader. */
export function tenantBusinessEvents(backing:Store,scoped:Store,owner:string,events?:Events){
 const trusted=new BusinessEventService(backing,events);
 const cursors=new Set<number>();
 return {
  append(input:AppendBusinessEvent){
   const metadata=input.metadata||{},conversationId=metadata.conversationId;
   if(!['agent.conversation_started','agent.message_received','agent.lead_captured'].includes(input.type)||typeof conversationId!=='string'||input.correlationId!==conversationId)throw Error('TENANT_EVENT_DENIED');
   const conversation=scoped.get('hosted-agent-conversations',conversationId);
   const agent=conversation&&scoped.get('hosted-agent-agents',conversation.agentId);
   if(!conversation||!agent||agent.ownerId!==owner||metadata.agentId!==agent.id||metadata.ownerId!==owner)throw Error('TENANT_EVENT_DENIED');
   const result=trusted.append({...input,source:'HOSTED_AGENT',idempotencyKey:owner+':'+input.idempotencyKey,metadata:{...metadata,ownerId:owner}});
   cursors.add(result.cursor);return result;
  },
  notifyCommitted(cursor:number){if(!cursors.has(cursor))throw Error('TENANT_EVENT_DENIED');trusted.notifyCommitted(cursor);}
 };
}
