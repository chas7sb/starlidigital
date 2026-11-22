export type PreviewBinding={chatId:string;agentId:string;runId:string};
export type PreviewReceipt=PreviewBinding&{schemaVersion:'starli.project.preview.v1';type:'preview.ready';projectId:string;name:string;phase:'ready';sourceVersion:number;sourceDigest:string;buildId:string;buildKey:string;routes:string[];previewEndpoint:string;showPreview:true;explicitShow:boolean};
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,180}$/.test(x);
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function previewReceipt(value:any,binding:PreviewBinding):PreviewReceipt|null {
 if(!value||value.schemaVersion!=='starli.project.preview.v1'||value.type!=='preview.ready'||value.phase!=='ready'||
  ![binding.chatId,binding.agentId,binding.runId].every(id)||value.chatId!==binding.chatId||value.agentId!==binding.agentId||value.runId!==binding.runId||
  !id(value.projectId)||typeof value.name!=='string'||!value.name.trim()||value.name.length>300||/[\u0000-\u001f\u007f]/.test(value.name)||
  !Number.isSafeInteger(value.sourceVersion)||value.sourceVersion<0||!hash(value.sourceDigest)||!hash(value.buildId)||value.buildKey!==value.buildId||
  value.previewEndpoint!==`/api/v1/starli/workspace/projects/${value.projectId}/preview`||value.showPreview!==true||typeof value.explicitShow!=='boolean'||
  !Array.isArray(value.routes)||value.routes.length>200||!value.routes.every((r:any)=>typeof r==='string'&&r.length<=2048&&r.startsWith('/')&&!r.startsWith('//')&&!/[\\\u0000-\u0020\u007f?#]/.test(r))) return null;
 return {schemaVersion:value.schemaVersion,type:value.type,...binding,projectId:value.projectId,name:value.name,phase:'ready',sourceVersion:value.sourceVersion,sourceDigest:value.sourceDigest,buildId:value.buildId,buildKey:value.buildId,routes:[...value.routes],previewEndpoint:value.previewEndpoint,showPreview:true,explicitShow:value.explicitShow};
}
export function verifiedPreviewHtml(snapshot:any,receipt:PreviewReceipt):string {
 if(snapshot?.available!==true||snapshot.compiledReady!==true||snapshot?.project?.id!==receipt.projectId||snapshot.sourceVersion!==receipt.sourceVersion||snapshot.sourceDigest!==receipt.sourceDigest||snapshot.buildId!==receipt.buildId||
  typeof snapshot.html!=='string'||!snapshot.html.trim()||snapshot.html.length>10_000_000)throw Error('This preview no longer matches the verified build. Wait for a new build, then reopen it.');
 return snapshot.html;
}
/** Same build replay and older source snapshots cannot reopen or replace a newer preview. */
export function newerPreview(next:PreviewReceipt,previous:PreviewReceipt|null) {
 if(!previous)return true;
 if(next.chatId!==previous.chatId||next.agentId!==previous.agentId||next.projectId!==previous.projectId)return false;
 return next.sourceVersion>previous.sourceVersion || (next.sourceVersion===previous.sourceVersion&&next.sourceDigest===previous.sourceDigest&&next.buildId!==previous.buildId&&(next.runId===previous.runId||next.explicitShow));
}
