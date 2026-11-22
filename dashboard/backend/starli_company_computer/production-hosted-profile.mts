/** Operator-selected Hosted provider for an enrolled production company. */
import{createHash}from'node:crypto';
import{createSelectedProviderHost}from'./runtime/company_bot_runtime/sdk/selected-provider-host.mts';
const SDK = process.env.STARLI_COMPANY_PI_SDK;
if (!SDK?.startsWith('/') || SDK.split('/').includes('..')) throw Error('COMPANY_SDK_INSTALL_REQUIRED');
const enrolledCompany = process.env.STARLI_COMPANY_ENROLLMENT_ID;
if (!enrolledCompany || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(enrolledCompany)) {
  throw Error('COMPANY_PROVIDER_ENROLLMENT_REQUIRED');
}
const{ModelRuntime}=await import(SDK+'/pi-coding-agent/dist/index.js');
const{streamSimple}=await import(SDK+'/pi-ai/dist/api/openai-completions.js');
const configured = process.env.STARLI_COMPANY_HOSTED_BASE;
if (!configured || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\/v1$/.test(configured)) {
  throw new Error('OPERATOR_HOSTED_ENDPOINT_REQUIRED');
}
export const ENDPOINT = configured;
export const MODEL='gpt-oss-120b';
export const metrics={requests:0};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function configure(selection:any,signal:AbortSignal){
 if(selection?.provider!=='hosted'||selection.model!==MODEL||selection.companyId!==enrolledCompany)throw Error('COMPANY_HOSTED_SCOPE_DENIED');
 const key=process.env.STARLI_COMPANY_HOSTED_API_KEY||'public-endpoint-no-secret';
 const fetch=globalThis.fetch;
 const permittedWireTools=new Set<string>(['runtime_ping']);
 const bindTools=(tools:any[])=>{
  if(!Array.isArray(tools)||tools.length>1000)throw Error('HOSTED_TOOL_CATALOG_INVALID');
  permittedWireTools.clear();permittedWireTools.add('runtime_ping');
  for(const tool of tools){if(typeof tool?.name!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name))throw Error('HOSTED_TOOL_CATALOG_INVALID');permittedWireTools.add(tool.name);}
 };

 const guard={profileId:'hosted.company.production.v1',revision:sha('hosted.company.production.v1|'+ENDPOINT+'|'+MODEL),
  assert({selection,model,auth}:any){return selection.provider==='starli-hosted'&&selection.model===MODEL&&(!model||model.baseUrl===ENDPOINT&&model.api==='openai-completions')&&(!auth||auth.auth?.apiKey===key);},
  async fetch(input:any,init:any={}){
   const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
   if(url.href!==ENDPOINT+'/chat/completions'||(init.method??input?.method)!=='POST')throw Error('HOSTED_ENDPOINT_DENIED');
   const body=JSON.parse(init.body);
   if(body.model!==MODEL||body.tool_choice&&body.tool_choice!=='auto')throw Error('HOSTED_MODEL_OR_FORCED_TOOL_DENIED');
   for(const tool of body.tools??[])if(tool.type!=='function'||!permittedWireTools.has(tool.function?.name))throw Error('HOSTED_TOOL_NOT_ALLOWED');
   metrics.requests++;return fetch(input,{...init,redirect:'error'});
  }};
 const runtime={async create(options:any){const instance=await ModelRuntime.create(options);
  instance.registerNativeProvider({id:'starli-hosted',name:'Verified operator Hosted',auth:{apiKey:{name:'Hosted private server credential',async resolve(){return{auth:{apiKey:key}};},async check(){return true;}}},
   getModels(){return[{id:MODEL,name:MODEL,provider:'starli-hosted',api:'openai-completions',baseUrl:ENDPOINT,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:1024}];},
   stream:streamSimple,streamSimple(model:any,context:any,options:any){return streamSimple(model,context,{...options,maxTokens:Math.min(options.maxTokens??1024,1024)});}});
  return instance;
 }};
 return {guard,bindTools,hostedFactory:async({authorize,guard:wrapped}:any)=>createSelectedProviderHost({
  selection:{version:'starli.selected-provider.v1',ownerId:selection.actorUserId,agentId:selection.botId,provider:'starli-hosted',model:MODEL,selectionRevision:selection.selectionRevision,
   guardProfileId:guard.profileId,guardRevision:guard.revision,credentials:{'starli-hosted':{type:'api_key',key}}},ModelRuntime:runtime,guard:wrapped,authorize,signal})};
}
