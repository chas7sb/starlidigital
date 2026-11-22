import {randomUUID} from 'node:crypto';
const KEYS=['companyId','actorUserId','botId','conversationId','assistantMessageId','runId','toolCallId'];
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());
// INTERNAL adapter: context and finalAuthorize come from runtime admission, never tool arguments.
export function nativeEmailPanelReceipt(studio,context,resourceId,{operation='open',expectedRevision,finalAuthorize}={}){
 if(!context||Object.keys(context).length!==KEYS.length||KEYS.some(k=>typeof context[k]!=='string'||!context[k]||context[k].length>200)||!['draft','review','open'].includes(operation)||typeof finalAuthorize!=='function')throw Error('Invalid bound email context');
 studio.db.exec('CREATE TABLE IF NOT EXISTS email_tool_receipts(id TEXT PRIMARY KEY,company TEXT,run TEXT,tool_call TEXT,context TEXT,ref TEXT,revision INTEGER,operation TEXT,UNIQUE(company,run,tool_call));');
 const ctx={companyId:context.companyId,actorId:context.actorUserId};const ref={scope:'company',ownerId:context.companyId,kind:'email',id:resourceId};
 return studio.transaction(()=>{
  studio.scope(ctx,'bots.run');const previous=studio.db.prepare('SELECT * FROM email_tool_receipts WHERE company=? AND run=? AND tool_call=?').get(context.companyId,context.runId,context.toolCallId);
  const draft=studio.get(ctx,resourceId,previous?.revision);
  if(previous&&(previous.context!==canonical(context)||previous.ref!==canonical(ref)||previous.operation!==operation))throw Error('409 tool receipt conflict');
  const revision=previous?.revision??draft.revision;if(expectedRevision!==undefined&&expectedRevision!==revision)throw Error('409 tool receipt revision conflict');
  const allowed=finalAuthorize({...context},{...ref});if(allowed!==true)throw Error('Email tool audience denied');
  const id=previous?.id??randomUUID();if(!previous)studio.db.prepare('INSERT INTO email_tool_receipts VALUES(?,?,?,?,?,?,?,?)').run(id,context.companyId,context.runId,context.toolCallId,canonical(context),canonical(ref),revision,operation);
  const receipt={version:'starli.panel.receipt.v1',id,ref,revision,...context};
  return {version:'starli.panel.v1',action:'open',type:'resource.email',ref,mode:'docked',receipt};
 });
}
