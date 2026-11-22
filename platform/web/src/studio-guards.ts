export type PreviewSelection={tag:string;selector:string;text:string};
export type ProjectRequestScope={projectId:string;epoch:number};
export type ProjectCodeDraft={projectId:string;path:string;content:string;originalContent?:string};
export type QueuedStudioPrompt={content:string;actionMode:'AUTO'|'CHAT'|'PLAN'|'BUILD';selectedElementContext?:string;attachments:{name:string;mimeType:string;dataUrl?:string;textExcerpt?:string}[]};
export function snapshotStudioPrompt(request:QueuedStudioPrompt):QueuedStudioPrompt{return {...request,attachments:request.attachments.map(attachment=>({...attachment}))};}
export function hasUnsavedCodeDraft(draft:ProjectCodeDraft|null):boolean{return !!draft&&(draft.originalContent===undefined||draft.content!==draft.originalContent);}
export function canLeaveCodeDraft(draft:ProjectCodeDraft|null,confirmDiscard:()=>boolean):boolean{return !hasUnsavedCodeDraft(draft)||confirmDiscard();}
export function agentStepState(status:string):'running'|'success'|'error'|'pending'{const state=status.toLowerCase();return ['running','in_progress'].includes(state)?'running':['success','succeeded','completed','done'].includes(state)?'success':['error','failed','failure'].includes(state)?'error':'pending';}
export function actualStepDuration(createdAt?:string,completedAt?:string):string{if(!createdAt||!completedAt)return '—';const start=Date.parse(createdAt),end=Date.parse(completedAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return '—';const seconds=Math.round((end-start)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
export async function runManualInlineEdit<T>(save:()=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;message:string}>{try{return {ok:true,value:await save()};}catch(error){return {ok:false,message:error instanceof Error?error.message:'The text was not saved. Try again or ask Starli to make this change.'};}}
export function isCurrentProjectRequest(request:ProjectRequestScope,current:ProjectRequestScope):boolean{return request.projectId===current.projectId&&request.epoch===current.epoch;}
export function prepareProjectCodeSave(activeProjectId:string|undefined,draft:ProjectCodeDraft|null):ProjectCodeDraft{
 if(!draft||!activeProjectId||draft.projectId!==activeProjectId)throw new Error('The project changed. Reopen the file before saving.');
 return {...draft};
}
/** Sandboxed srcdoc frames have opaque origin "null"; only the exact active frame is trusted. */
export function readPreviewSelection(event:{source:unknown;origin:string;data:unknown},expectedSource:unknown,enabled:boolean):PreviewSelection|null{
 if(!enabled||!expectedSource||event.source!==expectedSource||event.origin!=='null')return null;
 if(!event.data||typeof event.data!=='object')return null;
 const message=event.data as Record<string,unknown>;
 if(message.type!=='STARLI_ELEMENT_SELECTED'||!message.payload||typeof message.payload!=='object'||Array.isArray(message.payload))return null;
 const value=message.payload as Record<string,unknown>;
 if(typeof value.tag!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(value.tag))return null;
 if(typeof value.selector!=='string'||!value.selector.trim()||value.selector.length>500)return null;
 if(typeof value.text!=='string'||value.text.length>140)return null;
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.selector+value.text))return null;
 return {tag:value.tag,selector:value.selector,text:value.text};
}
