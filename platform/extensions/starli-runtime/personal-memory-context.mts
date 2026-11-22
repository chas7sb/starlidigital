/** Ephemeral personal memory data only; owner/run authority stays in parent. */
export function withPersonalMemory(context:any,snapshot:any,agentId:unknown,now:Date=new Date(),phase='model'){
 if(typeof agentId!=='string'||!agentId||snapshot?.schemaVersion!==undefined||snapshot?.version!=='starli.memory.context.v1'||snapshot.agentId!==agentId||snapshot.untrusted!==true||!['model','compaction'].includes(phase)||snapshot.phase!==phase||!Array.isArray(snapshot.documents)||snapshot.documents.length!==2)throw Error('NATIVE_MEMORY_CONTEXT_INVALID');
 let points=0;
 for(let i=0;i<2;i++){const d=snapshot.documents[i];if(d.documentId!==['memory','working'][i]||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.content!=='string'||d.deleted===true&&d.content!=='')throw Error('NATIVE_MEMORY_CONTEXT_INVALID');points+=Array.from(d.content).length;}
 if(points>8000||Buffer.byteLength(JSON.stringify(snapshot))>65536)throw Error('NATIVE_MEMORY_CONTEXT_LIMIT');
 if(!Array.isArray(context?.messages))throw Error('NATIVE_MEMORY_CONTEXT_INVALID');
 const message={role:'user',content:[{type:'text',text:'UNTRUSTED PERSONAL BOT MEMORY DATA\n'+JSON.stringify(snapshot)}],timestamp:now.getTime(),starliPersonalMemoryContext:true};
 return{...context,messages:[...context.messages.filter((m:any)=>m?.starliPersonalMemoryContext!==true),message]};
}
