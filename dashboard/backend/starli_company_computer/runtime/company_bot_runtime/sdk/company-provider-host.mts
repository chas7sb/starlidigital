/** Private company envelope; preserves separate actor, company and stable bot identity. */
import {createSelectedProviderHost} from './selected-provider-host.mts';
import {companyMemoryContext} from './company-memory-context.mts';
export async function createCompanyProviderHost(options:any){
 const envelope=structuredClone(options.selection);
 if(envelope?.version!=='starli.company-provider.v1'||!['companyId','actorUserId','botId','provider','model'].every(k=>typeof envelope[k]==='string'&&envelope[k].length>0)||!/^[a-f0-9]{64}$/.test(envelope.selectionRevision))throw Error('COMPANY_PROVIDER_INVALID');
 if(envelope.provider==='hosted'&&typeof options.hostedFactory!=='function')throw Error('COMPANY_HOSTED_FACTORY_REQUIRED');
 let memorySnapshot:any;
 const check=async()=>await options.checkCompanySelection(envelope)===true&&(!memorySnapshot||!options.loadMemory||await options.checkMemory(memorySnapshot)===true);
 if(!await check())throw Error('COMPANY_PROVIDER_REVOKED');
 if(options.loadMemory && (typeof options.checkMemory!=='function'||typeof options.loadMemory!=='function'))throw Error('MEMORY_BINDING_REQUIRED');
 const guard=options.guard&&{...options.guard,async assert(request:any){
  if(await options.guard.assert(request)!==true)return false;
  if(request.phase==='model'&&options.loadMemory){
   if(!memorySnapshot||await options.checkMemory(memorySnapshot)!==true)throw Error('MEMORY_CONTEXT_CHANGED');
  }
  return true;
 }};
 const host=envelope.provider==='hosted'?await options.hostedFactory({selection:structuredClone(envelope),authorize:check,guard,signal:options.signal}):options.selectedFactory?await options.selectedFactory({selection:structuredClone(envelope),authorize:check,signal:options.signal,refreshCredential:options.refreshCredential}):await createSelectedProviderHost({
  selection:{version:'starli.selected-provider.v1',ownerId:envelope.actorUserId,agentId:envelope.botId,
   provider:envelope.provider,model:envelope.model,selectionRevision:envelope.selectionRevision,
   guardProfileId:options.guard?.profileId,guardRevision:options.guard?.revision,
   credentials:{[envelope.provider]:envelope.credential}},
  ModelRuntime:options.ModelRuntime,guard,signal:options.signal,
  authorize:check,
  // OAuth refresh requires company-vault CAS; absent adapter fails closed.
 });
 let busy=false;
 return {...host,async streamFn(model:any,context:any,requestOptions:any={}){
  if(busy)throw Error('MODEL_REQUEST_ALREADY_ACTIVE');
  busy=true;
  try{
   if(options.loadMemory){
    memorySnapshot=await options.loadMemory('model');
    context={...context,messages:companyMemoryContext(envelope,memorySnapshot,context.messages)};
   }
   return await host.streamFn(model,context,requestOptions);
  }finally{busy=false;}
 },async compactionContext(messages:any[]){
  if(!options.loadMemory)throw Error('MEMORY_BINDING_REQUIRED');
  const memory=await options.loadMemory('compaction');
  const context=companyMemoryContext(envelope,memory,messages,'compaction');
  if(!await check()||await options.checkMemory(memory)!==true)throw Error('MEMORY_CONTEXT_CHANGED');
  return context;
 },publicReceipt(){return {companyId:envelope.companyId,botId:envelope.botId,...host.publicReceipt()};}};
}
