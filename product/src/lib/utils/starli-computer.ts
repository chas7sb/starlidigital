export const COMPUTER_RAM_BYTES=1073741824;
export const COMPUTER_PREFIX='/api/v1/starli/computer';
export type ComputerAction='status'|'ensure'|'start'|'openDesktop';
export type ComputerState={version:'starli.computer.v1';conversationId:string;computerId:string|null;ramPolicyBytes:number;availability:{code:string;available:boolean};allowedActions:ComputerAction[];observedState:string|null;state:string|null;controlEpoch:number|null;memoryBytes:number|null;memoryVerified:boolean;guestReady:boolean|null;desktopReady:boolean;selectedAgentActive:boolean|null;controlOwner:'agent'|'human'|'waiting'|'disconnected'|'unknown';observedAt:string|number|null};
export type DesktopState={version:'starli.computer.desktop.v1';state:'Ready'|'Waiting'|'Agent controlling'|'You are controlling';epoch:number;connected:boolean;expiresIn?:number;explicitResumeRequired?:boolean};
export type ComputerPort={status(chatId:string,signal:AbortSignal):Promise<ComputerState>;operate(action:'ensure'|'start',chatId:string,operationId:string,signal:AbortSignal):Promise<ComputerState>;open(chatId:string,signal:AbortSignal):Promise<DesktopState>;control(action:'takeover'|'handback'|'renew',epoch:number,operationId:string,signal:AbortSignal):Promise<DesktopState>};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export class ComputerError extends Error{constructor(public code:string,public status=0){super(code);this.name='ComputerError';}}
const invalid=()=>{throw new ComputerError('COMPUTER_RESPONSE_INVALID');};
function descriptor(v:any){if(!v||v.wsPath!==COMPUTER_PREFIX+'/desktop'||v.protocol!=='rfb.binary'||v.cookieOnly!==true||v.inputAllowed!==false||v.expiresIn!==300)invalid();}
export function computerState(value:any,chatId:string):ComputerState{
 if(value?.version!=='starli.computer.v1'||value.conversationId!==chatId||value.ramPolicyBytes!==COMPUTER_RAM_BYTES)invalid();
 if(value.computerId!==null&&!id(value.computerId))invalid();
 const a=value.availability;if(!a||!['AVAILABLE','NOT_READY','NOT_ENROLLED','MEMORY_POLICY_MISMATCH','AGENT_NOT_ACTIVE'].includes(a.code)||typeof a.available!=='boolean')invalid();
 if(!Array.isArray(value.allowedActions)||value.allowedActions.length>4||new Set(value.allowedActions).size!==value.allowedActions.length||!value.allowedActions.every((v:any)=>['status','ensure','start','openDesktop'].includes(v)))invalid();
 if(value.lifecycleRevision!==null||value.desiredLifecycle!==null||typeof value.memoryVerified!=='boolean'||typeof value.desktopReady!=='boolean')invalid();
 if(value.memoryBytes!==null&&!integer(value.memoryBytes))invalid();
 if(value.memoryVerified&&value.memoryBytes!==COMPUTER_RAM_BYTES)invalid();
 for(const k of ['guestReady','selectedAgentActive'])if(value[k]!==null&&typeof value[k]!=='boolean')invalid();
 if(value.desktopReady&&(!a.available||!value.memoryVerified||value.guestReady!==true||value.selectedAgentActive!==true))invalid();
 if(!['agent','human','waiting','disconnected','unknown'].includes(value.controlOwner))invalid();
 descriptor(value.desktop);
 const controlEpoch=value.controlEpoch===undefined?null:value.controlEpoch;if(controlEpoch!==null&&!integer(controlEpoch))invalid();
 const state=typeof value.state==='string'&&value.state.length<=40?value.state:null,observedState=typeof value.observedState==='string'&&value.observedState.length<=40?value.observedState:null;
 const observedAt=value.observedAt===null?null:typeof value.observedAt==='number'&&Number.isFinite(value.observedAt)?value.observedAt:typeof value.observedAt==='string'&&value.observedAt.length<=80&&Number.isFinite(Date.parse(value.observedAt))?value.observedAt:invalid();
 return {version:'starli.computer.v1',conversationId:chatId,computerId:value.computerId,ramPolicyBytes:COMPUTER_RAM_BYTES,availability:{code:a.code,available:a.available},allowedActions:[...value.allowedActions],observedState,state,controlEpoch,memoryBytes:value.memoryBytes,memoryVerified:value.memoryVerified,guestReady:value.guestReady,desktopReady:value.desktopReady,selectedAgentActive:value.selectedAgentActive,controlOwner:value.controlOwner,observedAt};
}
export function desktopState(value:any,chatId?:string):DesktopState{
 if(value?.version!=='starli.computer.desktop.v1'||!['Ready','Waiting','Agent controlling','You are controlling'].includes(value.state)||!integer(value.epoch)||typeof value.connected!=='boolean')invalid();
 if(chatId){if(value.conversationId!==chatId||value.state!=='Ready'||value.connected!==false||value.expiresIn!==300)invalid();descriptor(value.desktop);}
 return {version:'starli.computer.desktop.v1',state:value.state,epoch:value.epoch,connected:value.connected,...(value.expiresIn===300?{expiresIn:300}:{}),...(typeof value.explicitResumeRequired==='boolean'?{explicitResumeRequired:value.explicitResumeRequired}:{})};
}
export function desktopSocketURL(origin:string){
 let u:URL;try{u=new URL(origin);}catch{throw new ComputerError('COMPUTER_SECURE_CONNECTION_REQUIRED');}
 if(u.origin!==origin||u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new ComputerError('COMPUTER_SECURE_CONNECTION_REQUIRED');
 return (u.protocol==='https:'?'wss://':'ws://')+u.host+COMPUTER_PREFIX+'/desktop';
}
export function computerErrorText(error:unknown){
 const code=error instanceof ComputerError?error.code:'';
 if(code==='COMPUTER_CONTEXT_CHANGED')return 'Your account or conversation changed. Reopen Computer to continue.';
 if(code==='COMPUTER_BINDING_UNAVAILABLE'||code==='COMPUTER_BINDING_INVALID')return 'This conversation is not ready to open its computer yet.';
 if(code==='COMPUTER_BINDING_CHANGED'||code==='DESKTOP_STALE_EPOCH')return 'Computer control changed. Reconnect to see its current state.';
 if(code==='DESKTOP_ACTION_UNCERTAIN')return 'Control could not be confirmed. Reconnect in view-only mode before taking control again.';
 if(error instanceof ComputerError&&[401,403].includes(error.status))return 'Computer access could not be confirmed. Check your sign-in and reopen this panel.';
 if(code==='COMPUTER_SECURE_CONNECTION_REQUIRED')return 'Open Starli over a secure connection to use Computer.';
 if(error instanceof ComputerError&&[404,503].includes(error.status))return 'Computer is not available for this conversation yet.';
 return 'Computer could not complete this request. Check its status before trying again.';
}
export function createComputerClient(identity:()=>{ownerId:string;token:string},fetcher:typeof fetch=globalThis.fetch.bind(globalThis)):ComputerPort{
 async function request(path:string,signal:AbortSignal,body?:object){
  const captured=identity();if(!captured.ownerId||!captured.token)throw new ComputerError('COMPUTER_CONTEXT_CHANGED',401);
  const current=()=>{const next=identity();return !signal.aborted&&next.ownerId===captured.ownerId&&next.token===captured.token;};
  let response:Response;try{response=await fetcher(COMPUTER_PREFIX+path,{method:body?'POST':'GET',signal,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+captured.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}catch{if(!current())throw new ComputerError('COMPUTER_CONTEXT_CHANGED');throw new ComputerError('COMPUTER_CONNECTION_UNAVAILABLE');}
  if(!current())throw new ComputerError('COMPUTER_CONTEXT_CHANGED');
  if(!response.headers.get('content-type')?.includes('application/json'))throw new ComputerError('COMPUTER_UNAVAILABLE',response.status===200?503:response.status);
  let value:any;try{value=await response.json();}catch{invalid();}if(!current())throw new ComputerError('COMPUTER_CONTEXT_CHANGED');
  if(!response.ok)throw new ComputerError(typeof value?.code==='string'&&/^(?:COMPUTER|DESKTOP)_[A-Z0-9_]{1,80}$/.test(value.code)?value.code:'COMPUTER_UNAVAILABLE',response.status);
  return value;
 }
 function binding(chatId:string){if(!id(chatId))throw new ComputerError('COMPUTER_BINDING_INVALID');return {chatId};}
 return {
  async status(chatId,signal){binding(chatId);return computerState(await request('/status?'+new URLSearchParams({chatId}),signal),chatId);},
  async operate(action,chatId,operationId,signal){if(!['ensure','start'].includes(action)||!uuid(operationId))throw new ComputerError('COMPUTER_OPERATION_ID_INVALID');return computerState(await request('/'+action,signal,{...binding(chatId),operationId}),chatId);},
  async open(chatId,signal){return desktopState(await request('/desktop-session',signal,binding(chatId)),chatId);},
  async control(action,epoch,operationId,signal){if(!['takeover','handback','renew'].includes(action)||!integer(epoch)||!uuid(operationId))throw new ComputerError('DESKTOP_ACTION_INVALID');const d=desktopState(await request('/desktop-session/'+action,signal,{expectedEpoch:epoch,operationId}));if(!d.connected||action==='takeover'&&(d.state!=='You are controlling'||d.epoch<=epoch)||action==='handback'&&(d.state!=='Waiting'||d.explicitResumeRequired!==true||d.epoch<=epoch)||action==='renew'&&(d.epoch!==epoch||d.state!=='You are controlling'))throw new ComputerError('DESKTOP_BARRIER_UNCONFIRMED');return d;}
 };
}
