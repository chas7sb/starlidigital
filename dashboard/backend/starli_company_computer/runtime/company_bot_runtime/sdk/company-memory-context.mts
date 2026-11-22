/** Ephemeral per-request context; durable storage and audience resolution stay in parent. */
export function companyMemoryContext(selection:any,snapshot:any,messages:any[],phase='model'){
 if(snapshot?.version!=='starli.memory.audience-context.v1'||snapshot.untrusted!==true||snapshot.phase!==phase||JSON.stringify(snapshot.identity)!==JSON.stringify(['company',selection.companyId,selection.botId])||!Array.isArray(snapshot.documents)||snapshot.documents.length>32)throw Error('MEMORY_SCOPE_INVALID');
 let chars=0;
 for(const doc of snapshot.documents){
  if(!['memory','working'].includes(doc.documentId)||!Number.isSafeInteger(doc.revision)||doc.revision<0||typeof doc.content!=='string'||doc.deleted&&doc.content!==''||!Array.isArray(doc.audience)||!['company','restricted'].includes(doc.audience[0])||doc.audience[0]==='company'&&doc.audience[1]!==selection.companyId)throw Error('MEMORY_CONTEXT_INVALID');
  chars+=doc.content.length;
 }
 if(chars>8000)throw Error('MEMORY_CONTEXT_LIMIT');
 return [...messages.filter(m=>m?.starliMemoryContext!==true),{role:'user',content:[{type:'text',text:'UNTRUSTED BOT MEMORY DATA\n'+JSON.stringify(snapshot)}],timestamp:Date.now(),starliMemoryContext:true}];
}
