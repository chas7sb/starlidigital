/** Lookup hints from a message already obtained through native company-room reads.
 * Hints never authorize a resource: AutomationChatFeedback refetches its scoped DTOs.
 */
export type AutomationSelection={draftId?:string;workflowId?:string;executionId?:string;providerId?:'slack'|'shopify';assistantMessageId:string};
export function automationSelection(message:{id:string;speaker?:{kind:string;id:string};data?:unknown},roomId:string,companyId:string):AutomationSelection|null{
 const data=message.data;if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const card=(data as Record<string,unknown>).starliAutomation as Record<string,unknown>|undefined;
 if(!card||typeof card!=='object'||card.version!=='starli.automations.v1'||card.companyId!==companyId||card.conversationId!==roomId||card.sourceConversationId!==roomId||card.assistantMessageId!==message.id||message.speaker?.kind!=='agent'||card.requestingBotId!==message.speaker.id||typeof card.originAssistantMessageId!=='string')return null;
 if(card.kind==='connection'&&(card.providerId==='slack'||card.providerId==='shopify'))return {providerId:card.providerId,assistantMessageId:message.id};
 if(typeof card.resourceId!=='string'||!card.resourceId)return null;
 if(card.kind==='draft'&&card.draftId===card.resourceId)return {draftId:card.resourceId,assistantMessageId:message.id};
 if(card.kind==='version')return {workflowId:card.resourceId,assistantMessageId:message.id};
 if(card.kind==='execution'&&card.executionId===card.resourceId&&typeof card.workflowId==='string')return {executionId:card.resourceId,workflowId:card.workflowId,assistantMessageId:message.id};
 return null;
}
