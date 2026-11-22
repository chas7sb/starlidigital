/** Trusted private IPC host; no env/vault lookup, provider fallback or second agent loop. */
import {createHash} from 'node:crypto';
export type Selection={version:'starli.selected-provider.v1';ownerId:string;agentId:string;provider:string;model:string;selectionRevision:string;guardProfileId:string;guardRevision:string;credentials:Record<string,unknown>};
type Phase='capture'|'auth'|'model'|'refresh';
export type Guard={profileId:string;revision:string;assert:(request:{phase:Phase;selection:Readonly<Selection>;model?:any;auth?:any})=>Promise<boolean>|boolean;fetch?:typeof fetch};
const fail=(code:string):never=>{throw Error(code);};
const clone=<T,>(v:T):T=>structuredClone(v);
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function valid(s:Selection){
 if(!s||s.version!=='starli.selected-provider.v1'||!['ownerId','agentId','provider','model','guardProfileId'].every(k=>typeof (s as any)[k]==='string'&&(s as any)[k].length>0&&(s as any)[k].length<=300)||![s.selectionRevision,s.guardRevision].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))||!s.credentials||Object.keys(s.credentials).length!==1||!Object.hasOwn(s.credentials,s.provider)||!s.credentials[s.provider])fail('SELECTED_PROVIDER_CONFIGURATION_INVALID');
}
export async function createSelectedProviderHost(options:{
 selection:Selection;ModelRuntime:any;guard?:Guard;
 authorize:(selection:Readonly<Selection>,phase:Phase)=>Promise<boolean>|boolean;
 refreshCredential?:(selection:Readonly<Selection>,credential:unknown)=>Promise<{selectionRevision:string}>;
 signal?:AbortSignal;
}){
 let selection=clone(options.selection);valid(selection);
 const guard=options.guard;
 if(!guard||guard.profileId!==selection.guardProfileId||guard.revision!==selection.guardRevision||typeof guard.assert!=='function')fail('PROVIDER_NATIVE_PROFILE_UNAVAILABLE');
 let disposed=false;let credential=clone(selection.credentials[selection.provider]);let revision=selection.selectionRevision;
 const admitted=async(phase:Phase,model?:any,auth?:any)=>{
  if(disposed||options.signal?.aborted)fail('PROVIDER_EXECUTION_STOPPED');
  const privateSelection={...selection,selectionRevision:revision,credentials:{[selection.provider]:clone(credential)}};
  const authorized=await options.authorize(privateSelection,phase);
  if(disposed||options.signal?.aborted)fail('PROVIDER_EXECUTION_STOPPED');
  if(authorized!==true)fail('PROVIDER_AUTHORIZATION_DENIED');
  const guarded=await guard!.assert({phase,selection:privateSelection,model,auth});
  if(disposed||options.signal?.aborted)fail('PROVIDER_EXECUTION_STOPPED');
  if(guarded!==true)fail('PROVIDER_AUTHORIZATION_DENIED');
 };
 await admitted('capture');
 let serial:Promise<unknown>=Promise.resolve();
 const credentials={
  async read(provider:string){if(provider!==selection.provider)return undefined;return clone(credential);},
  async list(){return [{providerId:selection.provider,type:(credential as any)?.type}];},
  async modify(provider:string,fn:any){
   if(provider!==selection.provider)fail('PROVIDER_CREDENTIAL_SCOPE_DENIED');
   const action=serial.then(async()=>{
    await admitted('refresh');const next=await fn(clone(credential));
    if(next!==undefined&&hash(next)!==hash(credential)){
     if(!options.refreshCredential)fail('PROVIDER_REFRESH_UNAVAILABLE');
     const receipt=await options.refreshCredential({...selection,selectionRevision:revision,credentials:{[selection.provider]:clone(credential)}},clone(next));
     if(!receipt||!/^[a-f0-9]{64}$/.test(receipt.selectionRevision))fail('PROVIDER_REFRESH_CONFLICT');
     credential=clone(next);revision=receipt.selectionRevision;
    }
    return clone(credential);
   });serial=action.catch(()=>{});return action;
  },
  async delete(){fail('PROVIDER_CREDENTIAL_SCOPE_DENIED');}
 };
 const runtime=await options.ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,signal:options.signal});
 const model=runtime.getPhysicalModel(selection.provider,selection.model);
 if(!model||model.provider!==selection.provider||model.id!==selection.model||typeof model.api!=='string'||!Array.isArray(model.input)||!model.input.includes('text'))fail('PROVIDER_MODEL_UNSUPPORTED');
 const fingerprint=hash(model);await admitted('capture',model);
 const streamFn=async(requestModel:any,context:any,requestOptions:any={})=>{
  if(hash(requestModel)!==fingerprint)fail('PROVIDER_MODEL_CHANGED');
  await admitted('auth',model);
  const auth=await runtime.getAuth(model,{signal:options.signal});
  if(!auth?.auth)fail('PROVIDER_NOT_CONNECTED');
  await admitted('model',model,auth);
  // ModelRuntime dispatches to the selected provider's native API, including Codex OAuth.
  // Caller request options cannot override captured credentials, headers, endpoint, transport or retries.
  const {apiKey,headers,env,fetch:ignoredFetch,transport,maxRetries,onPayload,onResponse,...safe}=requestOptions;
  const requestedTokens=requestOptions.maxTokens===undefined?8192:requestOptions.maxTokens;
  if(!Number.isSafeInteger(requestedTokens)||requestedTokens<=0)fail('PROVIDER_OUTPUT_BUDGET_INVALID');
  return runtime.streamSimple(model,context,{...safe,signal:options.signal??safe.signal,
   apiKey:auth.auth.apiKey,headers:auth.auth.headers,env:auth.env??{},
   fetch:guard!.fetch,maxRetries:0,transport:'http',maxTokens:Math.min(requestedTokens,8192,Number(model.maxTokens)||8192)});
 };
 return {model:clone(model),streamFn,dispose(){disposed=true;credential=undefined;selection={...selection,credentials:{}};},
  publicReceipt(){return {provider:selection.provider,model:selection.model,transport:'PI_NATIVE_SELECTED'};}};
}
