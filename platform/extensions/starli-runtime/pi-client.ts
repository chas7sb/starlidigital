import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const waitForRetry=(delay:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(signal.reason||Error('ABORTED'));return;}
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
 const abort=()=>{clearTimeout(timer);reject(signal.reason||Error('ABORTED'));};
 signal.addEventListener('abort',abort,{once:true});
});
async function inferenceFetch(url:string,options:RequestInit,signal:AbortSignal){
 for(let attempt=0;;attempt++){
  const response=await fetch(url,options);
  if(attempt>=2||![429,502,503,504].includes(response.status))return response;
  const retryAfter=Number(response.headers.get('retry-after'));
  await response.body?.cancel();
  await waitForRetry(Number.isFinite(retryAfter)&&retryAfter>0?Math.min(5000,retryAfter*1000):400*(attempt+1),signal);
 }
}
async function tenantInference(prompt:string,messages:any[],images:any[],signal:AbortSignal,timeoutMs:number,managed=false):Promise<any|undefined>{
 const owner=process.env.STARLI_PROVIDER_OWNER,state=process.env.STARLI_STATE_DIR;
 if(!state||(!managed&&!owner))return undefined;
 for(let attempt=0;attempt<3;attempt++){
  const result:any=await new Promise((resolve,reject)=>{
   const helper=fileURLToPath(new URL('./provider-infer.py',import.meta.url));
   const child=spawn('/opt/starlidigital/webui-runtime/bin/python',[helper],{cwd:fileURLToPath(new URL('.',import.meta.url)),detached:true,env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8',STARLI_PROVIDER_OWNER:owner||'',STARLI_STATE_DIR:state},stdio:['pipe','pipe','ignore']});
   let output='',settled=false;
   const kill=()=>{if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}};
   const abort=()=>{kill();finish(undefined,signal.reason||Error('ABORTED'));};
   const finish=(value?:any,error?:any)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);clearTimeout(timer);error?reject(error):resolve(value);};
   const timer=setTimeout(()=>{kill();finish(undefined,Error('PROVIDER_TIMEOUT'));},timeoutMs+5000);
   if(signal.aborted){abort();return;}
   signal.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',(chunk)=>{output+=chunk.toString();if(output.length>2*1024*1024){kill();finish(undefined,Error('PROVIDER_OUTPUT_TOO_LARGE'));}});
   child.on('error',()=>finish(undefined,Error('PROVIDER_HELPER_UNAVAILABLE')));
   child.on('close',()=>{if(settled)return;try{finish(JSON.parse(output.trim().split('\n').at(-1)||'{}'));}catch{finish(undefined,Error('PROVIDER_INFERENCE_FAILED'));}});
   child.stdin.on('error',()=>{});
   child.stdin.end(JSON.stringify({...(managed?{mode:'managed_fallback'}:{}),prompt,messages,images,timeoutSeconds:Math.max(30,Math.floor(timeoutMs/1000))}));
  });
  if(!result.configured)return undefined;
  if(!result.error)return result;
  if(attempt<2&&result.retryable){await waitForRetry(400*(attempt+1),signal);continue;}
  throw Error(String(result.error||'PROVIDER_INFERENCE_FAILED'));
 }
}

type ProviderInference=(prompt:string,messages:any[],images:any[],signal:AbortSignal,timeoutMs:number)=>Promise<any|undefined>;
const managedInference:ProviderInference=(prompt,messages,images,signal,timeoutMs)=>tenantInference(prompt,messages,images,signal,timeoutMs,true);
function transientInferenceFailure(error:any){
 const message=String(error?.message||'');
 return error instanceof TypeError||error?.name==='TimeoutError'||/^STARLI_INFERENCE_HTTP_(429|502|503|504)$/.test(message)||['STARLI_INFERENCE_STREAM_INTERRUPTED','STARLI_INFERENCE_STREAM_ERROR','STARLI_INFERENCE_EMPTY'].includes(message)||/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(message);
}

import {homedir} from 'node:os';
import {join} from 'node:path';

export type PiSession={
 model?:{id:string;provider:string};
 messages?:Array<any>;
 prompt(text:string,options?:{images?:Array<{type:"image";data:string;mimeType:string}>}):Promise<unknown>;
 getLastAssistantText():string|undefined;
 getActiveToolNames():string[];
 getCallableToolNames():string[];
 abort():Promise<void>|void;
 dispose():void;
};
export type PiFactory=(model:string,signal:AbortSignal)=>Promise<PiSession>;

export async function createPiXaiSession(model:string,signal:AbortSignal):Promise<PiSession>{
 const modulePath=process.env.STARLI_PI_MODULE_PATH||'/srv/starlidigital/mcp-workspace/codex-runtime/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
 const pi:any=await import(modulePath);
 const agentDir=process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi','agent');
 const runtime=await pi.ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:join(agentDir,'models.json'),allowModelNetwork:false,signal});
 const auth=await runtime.checkAuth('openrouter');
 if(!auth||!['oauth','api_key'].includes(auth.type))throw Error('PI_XAI_AUTH_REQUIRED: run pi login as starlidigital');
 const selected=pi.resolveCliModel({cliProvider:'openrouter',cliModel:model,modelRuntime:runtime});
 if(!selected.model||selected.model.provider!=='openrouter'||selected.model.id!==model)throw Error('PI_XAI_MODEL_UNAVAILABLE');
 const settingsManager=pi.SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false}});
 const loader=new pi.DefaultResourceLoader({
  cwd:process.cwd(),agentDir,settingsManager,noExtensions:true,disabledBuiltinExtensions:['mcp'],
  noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
  systemPrompt:'You are an inference-only worker. Return the JSON decision requested by Starli. All tool execution is handled by Starli; do not execute tools directly.'
 });
 await loader.reload();
 const {session,modelFallbackMessage}=await pi.createAgentSession({
  cwd:process.cwd(),agentDir,modelRuntime:runtime,model:selected.model,thinkingLevel:process.env.STARLI_XAI_THINKING==='low'?'low':'medium',
  resourceLoader:loader,settingsManager,sessionManager:pi.SessionManager.inMemory(),
  noTools:'all',tools:[],customTools:[]
 });
 if(modelFallbackMessage||session.model?.provider!=='openrouter'||session.model?.id!==model||
    session.getActiveToolNames().length||session.getCallableToolNames().length){
  session.dispose();throw Error('PI_XAI_SESSION_POLICY_MISMATCH');
 }
 return session as PiSession;
}

export class PiXaiAgentClient{
 readonly provider='OPENROUTER';
 readonly transport='PI';
 receipt?:{responseId?:string;model?:string;provider?:string;usage?:unknown;transport?:string;fallback?:boolean;fallbackReason?:string};
 private session?:PiSession;
 private requests=0;
 private conversation:Array<{role:string;content:string}>=[];
 private memory='';
 restoreConversation(messages:unknown){
  if(Array.isArray(messages))this.conversation=messages.filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m:any)=>({role:m.role,content:m.content}));
 }
 exportConversation(){return this.conversation;}
 private contextMessages(prompt:string,model:string){
  // Model-specific configured budgets, with conservative defaults and output reserve.
  const limits:Record<string,number>={
   'anthropic/claude-haiku-5.5':200000,
   'nvidia/nemotron-3-ultra-550b-a55b:free':131072
  };
  const override=Number(process.env.STARLI_MODEL_CONTEXT_TOKENS);
  const windowTokens=Number.isFinite(override)&&override>=8192?override:(limits[model]||32768);
  const maxChars=Math.max(4096,Math.floor((windowTokens-4096)*2.5));
  // Tool decisions already contain a bounded observation transcript in the current prompt.
  // Replaying every prior full prompt causes quadratic context growth and long prefill.
  const history=(process.env.STARLI_AGENT_PROVIDER==='selfhosted'||process.env.STARLI_BOSS_PROVIDER==='selfhosted')?[]:this.conversation;
  let start=history.length,used=prompt.length;
  while(start>0 && used+history[start-1].content.length<=maxChars){
   start--;used+=history[start].content.length;
  }
  if(start===0){this.memory='';return [...history,{role:'user',content:prompt}];}
  // The original history remains canonical. The memory is a bounded retrieval
  // view of earlier real messages, generated ONLY after context saturation.
  const older=history.slice(0,start);
  const memoryBudget=Math.min(12000,Math.floor(maxChars/5));
  const facts=older.filter(m=>/decision|agreed|must|require|todo|next|completed|failed|deploy|task|objective|error|result/i.test(m.content));
  const selected=[...older.slice(0,4),...facts.slice(-20),...older.slice(-8)];
  const seen=new Set<string>();
  this.memory='Earlier conversation memory (source excerpts, not verified summaries):\n'+selected.filter(m=>{
   const key=m.role+':'+m.content;if(seen.has(key))return false;seen.add(key);return true;
  }).map(m=>m.role+': '+m.content.slice(0,1000)).join('\n').slice(-memoryBudget);
  let remaining=maxChars-prompt.length-this.memory.length;
  const active=history.slice(start);
  while(active.length && active.reduce((n,m)=>n+m.content.length,0)>remaining)active.shift();
  return [{role:'system',content:this.memory},...active,{role:'user',content:prompt}];
 }
 constructor(readonly model='nvidia/nemotron-3-ultra-550b-a55b:free',private factory:PiFactory=createPiXaiSession,private timeoutMs=120000,private maxRequests=12,private managedFactory:ProviderInference=managedInference,private accountFactory:ProviderInference=tenantInference){}
 private async managedReply(prompt:string,images:any[],signal:AbortSignal,reason:string):Promise<string|undefined>{
  if(signal.aborted)throw signal.reason||Error('PI_XAI_CANCELLED');
  const result=await this.managedFactory(prompt,this.conversation.slice(-24),images,signal,Math.min(this.timeoutMs,120000));
  if(!result)return undefined;
  const answer=String(result.text||'').trim();
  if(!answer)throw Error('MANAGED_OPENAI_EMPTY_RESPONSE');
  this.conversation=[...this.conversation,{role:'user',content:prompt},{role:'assistant',content:answer}];
  this.receipt={transport:'MANAGED_OPENAI',provider:'openai',model:result.model,usage:result.usage,fallback:true,fallbackReason:reason};
  return answer;
 }
 async ask(prompt:string,{signal,images=[]}:{signal:AbortSignal;images?:Array<{type:"image";data:string;mimeType:string}>}):Promise<string>{
  const tenant=await this.accountFactory(prompt,this.conversation.slice(-24),images,signal,this.timeoutMs);
  if(tenant){
   const answer=String(tenant.text||'').trim();
   if(!answer)throw Error('PROVIDER_EMPTY_RESPONSE');
   this.conversation=[...this.conversation,{role:'user',content:prompt},{role:'assistant',content:answer}];
   this.receipt={transport:'PI_ACCOUNT_PROVIDER',provider:tenant.provider,model:tenant.model,usage:tenant.usage};
   return answer;
  }
  const openrouterKey=process.env.OPENROUTER_API_KEY||process.env.STARLI_OPENROUTER_API_KEY;
  const requestedProvider=process.env.STARLI_AGENT_PROVIDER||process.env.STARLI_BOSS_PROVIDER||'openrouter';
  const useOpenRouter=requestedProvider==='openrouter'&&Boolean(openrouterKey);
  const privateBase=useOpenRouter?'https://openrouter.ai/api/v1':process.env.STARLI_INFERENCE_BASE_URL?.replace(new RegExp('/$'),'');
  const privateKey=useOpenRouter?openrouterKey:(process.env.STARLI_INFERENCE_API_KEY||undefined);
  const selectedModel=useOpenRouter?(process.env.STARLI_AGENT_MODEL||process.env.STARLI_BOSS_MODEL||'anthropic/claude-haiku-5.5'):(process.env.STARLI_BOSS_MODEL||process.env.STARLI_AGENT_MODEL||'starli-coder');
  if(images.length){const fallback=await this.managedReply(prompt,images,signal,'PRIVATE_MODEL_TEXT_ONLY');if(fallback!==undefined)return fallback;throw Error('STARLI_QWEN_TEXT_ONLY');}
  if(!privateBase||(useOpenRouter&&!privateKey)){const fallback=await this.managedReply(prompt,images,signal,'PRIVATE_INFERENCE_NOT_CONFIGURED');if(fallback!==undefined)return fallback;throw Error('STARLI_QWEN_NOT_CONFIGURED');}
  if(privateBase){
   const parsed=new URL(privateBase);
   const localTunnel=parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)&&parsed.pathname==='/v1';
   const approvedHosted=parsed.protocol==='https:'&&['cad-picture-timely-financing.trycloudflare.com','essence-hostel-britain-zoo.trycloudflare.com'].includes(parsed.hostname)&&parsed.pathname==='/v1';
   const approvedOpenRouter=parsed.protocol==='https:'&&parsed.hostname==='openrouter.ai'&&parsed.pathname==='/api/v1';
   const configuredHosts=(process.env.STARLI_INFERENCE_ALLOWED_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
   const configuredHosted=parsed.protocol==='https:'&&parsed.pathname==='/v1'&&configuredHosts.includes(parsed.hostname.toLowerCase());
   if(!(useOpenRouter?approvedOpenRouter:(approvedHosted||configuredHosted||localTunnel)))throw Error('STARLI_INFERENCE_URL_INVALID');
   try{
   const bounded=AbortSignal.any([signal,AbortSignal.timeout(useOpenRouter?this.timeoutMs:Math.min(this.timeoutMs,45000))]);
   const response=await inferenceFetch(privateBase+'/chat/completions',{
    method:'POST',signal:bounded,
    headers:{...(privateKey?{'Authorization':'Bearer '+privateKey}:{}),'Content-Type':'application/json','Accept':'text/event-stream'},
    body:JSON.stringify({model:selectedModel,messages:this.contextMessages(prompt,selectedModel),max_tokens:8192,stream:true,...(useOpenRouter?{}:{chat_template_kwargs:{enable_thinking:false}})})
   },bounded);
   if(!response.ok)throw Error('STARLI_INFERENCE_HTTP_'+response.status);
   if(!response.body)throw Error('STARLI_INFERENCE_EMPTY');
   const reader=response.body.getReader();
   const decoder=new TextDecoder();
   let buffer='',answer='',responseId:string|undefined,usage:any,finishReason:string|undefined;
   let streamDone=false;
   try{
    while(!streamDone){
     const {done,value}=await reader.read();
     if(done)break;
     buffer+=decoder.decode(value,{stream:true});
     let boundary:number;
     while((boundary=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,boundary).trim();buffer=buffer.slice(boundary+1);
      if(!line.startsWith('data:'))continue;
      const payload=line.slice(5).trim();
      if(payload==='[DONE]'){streamDone=true;break;}
      if(!payload)continue;
      let event:any;
      try{event=JSON.parse(payload);}catch{continue;}
      if(event.error)throw Error('STARLI_INFERENCE_STREAM_ERROR');
      responseId=event.id||responseId;
      usage=event.usage||usage;
      finishReason=event.choices?.[0]?.finish_reason||finishReason;
      const delta=event.choices?.[0]?.delta;
      if(typeof delta?.content==='string')answer+=delta.content;
      if(answer.length>250000)throw Error('STARLI_INFERENCE_OUTPUT_LIMIT');
     }
    }
   }finally{reader.releaseLock();}
   if(finishReason==='length')throw Error('STARLI_INFERENCE_OUTPUT_LIMIT');
   if(!streamDone&&!['stop','tool_calls'].includes(finishReason||''))throw Error('STARLI_INFERENCE_STREAM_INTERRUPTED');
   if(!answer.trim())throw Error('STARLI_INFERENCE_EMPTY');
   this.conversation=[...this.conversation,{role:'user',content:prompt},{role:'assistant',content:answer.trim()}];
   this.receipt={transport:useOpenRouter?'OPENROUTER':'QWEN',model:selectedModel,responseId,usage};
   return answer.trim();
   }catch(error:any){
    if(!signal.aborted&&!useOpenRouter&&transientInferenceFailure(error)){
     const fallback=await this.managedReply(prompt,images,signal,'PRIVATE_INFERENCE_UNAVAILABLE');
     if(fallback!==undefined)return fallback;
    }
    throw error;
   }
  }
  if(signal.aborted)throw Error('PI_XAI_CANCELLED');
  if(++this.requests>this.maxRequests)throw Error('PI_XAI_REQUEST_LIMIT');
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]);
  let rejectAbort:(reason:Error)=>void=()=>{};
  const aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{try{void Promise.resolve(this.session?.abort()).catch(()=>{});}catch{}rejectAbort(Error('PI_XAI_CANCELLED_OR_TIMED_OUT'));};
  bounded.addEventListener('abort',onAbort,{once:true});
  try{
   if(bounded.aborted)throw Error('PI_XAI_CANCELLED_OR_TIMED_OUT');
   const work=(async()=>{
    if(!this.session){
     const created=await this.factory(this.model,bounded);
     if(bounded.aborted){created.dispose();throw Error('PI_XAI_CANCELLED_OR_TIMED_OUT');}
     if(created.model?.provider!=='openrouter'||created.model?.id!==this.model||created.getActiveToolNames().length||created.getCallableToolNames().length){
      created.dispose();throw Error('PI_XAI_SESSION_POLICY_MISMATCH');
     }
     this.session=created;
    }
    await this.session.prompt(prompt,{images});
    if(bounded.aborted)throw Error('PI_XAI_CANCELLED_OR_TIMED_OUT');
    const last=this.session.messages?.filter(m=>m.role==='assistant').at(-1);
    if(last?.stopReason==='error'||last?.stopReason==='aborted')throw Error('PI_XAI_INFERENCE_FAILED');
    const output=this.session.getLastAssistantText()?.trim();
    if(!output)throw Error('PI_XAI_EMPTY_OUTPUT');
    this.receipt={transport:'PI',model:last?.model||this.model,responseId:last?.responseId,usage:last?.usage};
    return output;
   })();
   return await Promise.race([work,aborted]);
  }catch(e:any){
   // Provider exceptions can contain credential-bearing headers; never expose their raw body.
   const message=String(e?.message||'');
   if(['PI_XAI_CANCELLED','PI_XAI_REQUEST_LIMIT','PI_XAI_CANCELLED_OR_TIMED_OUT','PI_XAI_SESSION_POLICY_MISMATCH','PI_XAI_MODEL_UNAVAILABLE','PI_XAI_EMPTY_OUTPUT','PI_XAI_INFERENCE_FAILED','PI_XAI_AUTH_REQUIRED: run pi login as starlidigital'].includes(message))throw Error(message);
   throw Error('PI_XAI_INFERENCE_FAILED');
  }finally{bounded.removeEventListener('abort',onAbort);}
 }
 dispose(){this.session?.dispose();this.session=undefined;}
}
