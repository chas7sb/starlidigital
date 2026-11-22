/** Installed Pi provider catalog and interactive authentication; credentials use stdin/stdout IPC only. */
import {createInterface} from 'node:readline';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const originalFetch=globalThis.fetch;
function privateAddress(address:string){
 const ip=address.toLowerCase();
 if(ip.includes(':'))return ip==='::'||ip==='::1'||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe8')||ip.startsWith('fe9')||ip.startsWith('fea')||ip.startsWith('feb')||ip.startsWith('::ffff:');
 const n=ip.split('.').map(Number);
 return n[0]===0||n[0]===10||n[0]===127||n[0]===169&&n[1]===254||n[0]===172&&n[1]>=16&&n[1]<=31||n[0]===192&&n[1]===168||n[0]===100&&n[1]>=64&&n[1]<=127||n[0]>=224;
}
async function approvedUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.hostname==='localhost'||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))throw Error('PROVIDER_ENDPOINT_NOT_PUBLIC');
 const addresses=isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true});
 if(!addresses.length||addresses.some(a=>privateAddress(a.address)))throw Error('PROVIDER_ENDPOINT_NOT_PUBLIC');
 return url;
}
const safeFetch:typeof fetch=async(input:any,options:any={})=>{
 let url=await approvedUrl(typeof input==='string'||input instanceof URL?String(input):input.url);
 const response=await originalFetch(input,{...options,redirect:'manual'});
 if(response.status>=300&&response.status<400&&response.headers.get('location')){
  await response.body?.cancel();
  throw Error('PROVIDER_REDIRECT_REQUIRES_REVIEW');
 }
 return response;
};
globalThis.fetch=safeFetch;

const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const first=await lines.next();if(first.done)throw Error('REQUEST_REQUIRED');
const request=JSON.parse(first.value);
const modulePath=process.env.STARLI_PI_MODULE_PATH||import.meta.resolve('@earendil-works/pi-coding-agent');
const {ModelRuntime}=await import(modulePath);
const data=new Map<string,any>(Object.entries(request.credentials||{}));
const credentials={
 async read(provider:string){return data.get(provider);},
 async list(){return [...data.entries()].map(([providerId,value])=>({providerId,type:value.type}));},
 async modify(provider:string,fn:any){const value=await fn(data.get(provider));if(value!==undefined)data.set(provider,value);return data.get(provider);},
 async delete(provider:string){data.delete(provider);}
};
const controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());
const send=(event:any)=>process.stdout.write(JSON.stringify(event)+'\n');
const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,signal:controller.signal});
function models(provider?:string){return runtime.getAllModels(provider).map((m:any)=>({
 id:m.id,provider:m.provider,name:m.name||m.id,type:m.type||'chat',api:m.api,reasoning:!!m.reasoning,
 input:m.input||[],contextWindow:m.contextWindow,maxTokens:m.maxTokens,cost:m.cost||null
}));}
function providers(){return runtime.getProviders().map((p:any)=>({
 id:p.id,name:p.name,modelCount:models(p.id).length,dynamicModels:typeof p.refreshModels==='function',
 authMethods:[
 ...(p.auth?.apiKey?[{type:'api_key',label:p.auth.apiKey.name||'API key',interactive:typeof p.auth.apiKey.login==='function',subscription:false}]:[]),
 ...(p.auth?.oauth?[{type:'oauth',label:p.auth.oauth.loginLabel||p.auth.oauth.name||'Sign in',interactive:true,subscription:p.auth.oauth.isSubscription===true}]:[])
 ]
}));}
try{
 if(request.operation==='catalog'){send({type:'result',providers:providers(),models:models()});}
 else if(request.operation==='login'){
  const provider=runtime.getProvider(request.provider);
  if(!provider)throw Error('PROVIDER_NOT_SUPPORTED');
  const auth=request.authType==='oauth'?provider.auth?.oauth:provider.auth?.apiKey;
  if(!auth||typeof auth.login!=='function')throw Error('INTERACTIVE_AUTH_NOT_SUPPORTED');
  await runtime.login(request.provider,request.authType,{
   signal:controller.signal,
   notify(event:any){send({type:'event',event});},
   async prompt(prompt:any){
    const id=crypto.randomUUID();
    const {signal,...display}=prompt;
    // A web account must never select the host's cloud profiles or filesystem credentials.
    if(display.type==='select'&&request.provider==='google-vertex')display.options=display.options.filter((o:any)=>o.id==='api-key');
    if(display.type==='select'&&request.provider==='amazon-bedrock')display.options=display.options.filter((o:any)=>o.id==='bearer-token');
    if(display.type!=='select'&&/credentials? file path|AWS profile|credential chain/i.test(String(display.message)))throw Error('HOST_CREDENTIALS_NOT_AVAILABLE');
    send({type:'prompt',id,prompt:display});
    if(signal?.aborted)throw Error('PROMPT_CANCELLED');
    const answer=await lines.next();if(answer.done)throw Error('LOGIN_CANCELLED');
    const value=JSON.parse(answer.value);
    if(value.promptId!==id||typeof value.value!=='string')throw Error('INVALID_PROMPT_RESPONSE');
    if(display.type==='select'&&!display.options.some((o:any)=>o.id===value.value))throw Error('INVALID_PROMPT_RESPONSE');
    if(display.type==='secret'&&(value.value.startsWith('!')||[...value.value].some(c=>c.charCodeAt(0)<32)))throw Error('INVALID_PROMPT_RESPONSE');
    return value.value;
   }
  },{agentName:'StarliDigital',getDeviceId:()=>request.deviceId});
  send({type:'authenticated',provider:request.provider,credentials:Object.fromEntries(data)});
 }else if(request.operation==='refresh'){
  if(!runtime.getProvider(request.provider))throw Error('PROVIDER_NOT_SUPPORTED');
  const result=await runtime.refresh({allowNetwork:true,providers:[request.provider],force:true,signal:controller.signal});
  if(result.errors.size)throw Error('MODEL_REFRESH_FAILED');
  send({type:'refreshed',models:models(request.provider),credentials:Object.fromEntries(data)});
 }else if(request.operation==='infer'){
  if(!request.provider||!data.has(request.provider))throw Error('PROVIDER_NOT_CONNECTED');
  const desiredModel=request.model||(Array.isArray(request.modelHints)?request.modelHints.find((id:any)=>typeof id==='string'&&runtime.getModel(request.provider,id)):undefined);
  if(!desiredModel)throw Error('MODEL_NOT_SUPPORTED');
  let model=runtime.getModel(request.provider,desiredModel);
  if(!model){
   const refreshed=await runtime.refresh({allowNetwork:true,providers:[request.provider],force:true,signal:controller.signal});
   if(refreshed.errors.size)throw Error('MODEL_REFRESH_FAILED');
   model=runtime.getModel(request.provider,desiredModel);
  }
  if(!model)throw Error('MODEL_NOT_SUPPORTED');
  const messages=(request.messages||[]).filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m:any)=>m.role==='user'?{role:'user',content:m.content,timestamp:Date.now()}:{role:'assistant',content:[{type:'text',text:m.content}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
  const images=Array.isArray(request.images)?request.images:[];
  if(images.length&&!model.input?.includes('image'))throw Error('MODEL_VISION_NOT_SUPPORTED');
  const content=images.length?[{type:'text',text:String(request.prompt||'')},...images.filter((i:any)=>i?.type==='image'&&['image/png','image/jpeg','image/webp'].includes(i.mimeType)&&typeof i.data==='string')]:String(request.prompt||'');
  messages.push({role:'user',content,timestamp:Date.now()});
  for(const value of Object.values(data.get(request.provider)?.env||{})){if(typeof value==='string'&&/^https?:/i.test(value))await approvedUrl(value);}
  const response=await runtime.completeSimple(model,{systemPrompt:'You are the inference component of StarliDigital. Return the tool decision requested by the current prompt. All tools are executed by the authenticated Starli server.',messages},{signal:controller.signal,maxTokens:Math.min(8192,Number(model.maxTokens)||8192,Math.max(1,Number(request.maxOutputTokens)||8192)),fetch:safeFetch});
  if(response.stopReason==='length')throw Error('PROVIDER_OUTPUT_LIMIT');
  if(response.stopReason==='error'){
   const status=Number(/(?:HTTP|status|statusCode)[^0-9]{0,10}(429|502|503|504)/i.exec(response.errorMessage||'')?.[1]);
   throw Object.assign(Error('PROVIDER_INFERENCE_FAILED'),{status});
  }
  const text=(response.content||[]).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n');
  if(!text.trim())throw Error('PROVIDER_EMPTY_RESPONSE');
  send({type:'inference',text,model:response.model,provider:response.provider,usage:response.usage,credentials:Object.fromEntries(data)});
 }else throw Error('OPERATION_NOT_SUPPORTED');
}catch(error){
 const safe=['PROVIDER_NOT_SUPPORTED','INTERACTIVE_AUTH_NOT_SUPPORTED','PROMPT_CANCELLED','LOGIN_CANCELLED','INVALID_PROMPT_RESPONSE','MODEL_REFRESH_FAILED','PROVIDER_NOT_CONNECTED','MODEL_NOT_SUPPORTED','PROVIDER_INFERENCE_FAILED','PROVIDER_EMPTY_RESPONSE','OPERATION_NOT_SUPPORTED','HOST_CREDENTIALS_NOT_AVAILABLE','MODEL_VISION_NOT_SUPPORTED','PROVIDER_OUTPUT_LIMIT','PROVIDER_ENDPOINT_NOT_PUBLIC','PROVIDER_REDIRECT_REQUIRES_REVIEW'];
 const message=error instanceof Error?error.message:'';
 const status=Number((error as any)?.status||(error as any)?.statusCode);
 send({type:'error',code:safe.includes(message)?message:'PROVIDER_OPERATION_FAILED',retryable:[429,502,503,504].includes(status),credentials:Object.fromEntries(data)});
 process.exitCode=1;
}finally{controller.abort();}
await new Promise<void>(resolve=>process.stdout.write('',()=>resolve()));
process.exit();
