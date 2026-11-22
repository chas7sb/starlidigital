const kinds={'resource.document':'knowledge','resource.tasks':'task','resource.project':'project','resource.file':'file','resource.sheet':'sheet','resource.email':'email'};
const titles={'resource.document':'document','resource.tasks':'task','resource.project':'project','resource.file':'Drive file','resource.sheet':'spreadsheet','resource.email':'email'};
const sameRef=(a,b)=>a&&b&&['scope','ownerId','kind','id'].every(k=>a[k]===b[k]);
export function panelCommandsFromMessage(message,companyId){
 const result=[],seen=new Set();
 if(Array.isArray(message?.panels)&&message?.speaker?.kind==='agent')for(const value of message.panels){const action=boundPanel(value,{companyId,conversationId:message.roomId,assistantMessageId:message.id,botId:message.speaker.id,runId:message.runId});if(action&&!seen.has(action.receiptId)){seen.add(action.receiptId);result.push(action);}}
 if(!Array.isArray(message?.starliPanels))return result;
 for(const receipt of message.starliPanels){
  const command=receipt?.open,r=receipt?.ref;
  if(receipt?.version!=='starli.panel.receipt.v1'||typeof receipt.receiptId!=='string'||!receipt.receiptId||seen.has(receipt.receiptId)||!Number.isSafeInteger(receipt.revision)||receipt.revision<1)continue;
  if(command?.version!=='starli.panel.v1'||command.action!=='open'||!sameRef(command.ref,r)||r.scope!=='company'||r.ownerId!==companyId||kinds[command.type]!==r.kind||typeof r.id!=='string'||!r.id)continue;
  seen.add(receipt.receiptId);
  // Copy only canonical routing data. Proposed content never enters this event.
  result.push({receiptId:receipt.receiptId,title:titles[command.type],command:{version:'starli.panel.v1',action:'open',type:command.type,ref:{scope:r.scope,ownerId:r.ownerId,kind:r.kind,id:r.id},mode:'docked'}});
 }
 return result;
}

const ident=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value);
export function boundPanel(value,context){
 const receipt=value?.receipt,r=value?.ref;if(value?.version!=='starli.panel.v1'||value.action!=='open'||kinds[value.type]!==r?.kind||r?.scope!=='company'||r.ownerId!==context.companyId||!ident(r.id)||receipt?.version!=='starli.panel.receipt.v1'||!ident(receipt.id)||!sameRef(receipt.ref,r)||!Number.isSafeInteger(receipt.revision)||receipt.revision<1)return null;
 if(!['companyId','actorUserId','botId','conversationId','assistantMessageId','runId','toolCallId'].every(k=>ident(receipt[k])))return null;
 if(['companyId','conversationId','assistantMessageId','botId','runId','toolCallId'].some(k=>context[k]!==undefined&&context[k]!==null&&receipt[k]!==context[k]))return null;
 return {receiptId:receipt.id,title:titles[value.type],command:{version:'starli.panel.v1',action:'open',type:value.type,ref:{scope:r.scope,ownerId:r.ownerId,kind:r.kind,id:r.id},mode:'docked'}};
}
export function panelFromCompanyEvent(event,turn){if(event?.type!=='tool.lifecycle'||event.status!=='COMPLETED'||event.runId!==turn.runId||event.assistantMessageId!==turn.assistantMessageId)return null;return boundPanel(event.panel,{companyId:turn.companyId,conversationId:turn.conversationId,assistantMessageId:turn.assistantMessageId,botId:turn.botId,runId:turn.runId,toolCallId:event.toolCallId});}
