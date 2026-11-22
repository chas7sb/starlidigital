
import {homedir} from 'node:os';
import {join} from 'node:path';

export type PiSession={
 model?:{id:string;provider:string};
 messages?:Array<any>;
 prompt(text:string):Promise<unknown>;
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
 const auth=await runtime.checkAuth('xai');
 if(!auth||!['oauth','api_key'].includes(auth.type))throw Error('PI_XAI_AUTH_REQUIRED: run pi login as starlidigital');
 const selected=pi.resolveCliModel({cliProvider:'xai',cliModel:model,modelRuntime:runtime});
 if(!selected.model||selected.model.provider!=='xai'||selected.model.id!==model)throw Error('PI_XAI_MODEL_UNAVAILABLE');
 const settingsManager=pi.SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false}});
 const loader=new pi.DefaultResourceLoader({
  cwd:process.cwd(),agentDir,settingsManager,noExtensions:true,disabledBuiltinExtensions:['mcp'],
  noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
  systemPrompt:'You are an inference-only worker. Return the JSON decision requested by Starli. All tool execution is handled by Starli; do not execute tools directly.'
 });
 await loader.reload();
 const {session,modelFallbackMessage}=await pi.createAgentSession({
  cwd:process.cwd(),agentDir,modelRuntime:runtime,model:selected.model,thinkingLevel:'medium',
  resourceLoader:loader,settingsManager,sessionManager:pi.SessionManager.inMemory(),
  noTools:'all',tools:[],customTools:[]
 });
 if(modelFallbackMessage||session.model?.provider!=='xai'||session.model?.id!==model||
    session.getActiveToolNames().length||session.getCallableToolNames().length){
  session.dispose();throw Error('PI_XAI_SESSION_POLICY_MISMATCH');
 }
 return session as PiSession;
}

export class PiXaiAgentClient{
 readonly provider='XAI';
 readonly transport='PI';
 receipt?:{responseId?:string;model?:string;usage?:unknown;transport?:string};
 private session?:PiSession;
 private requests=0;
 constructor(readonly model='grok-4.7',private factory:PiFactory=createPiXaiSession,private timeoutMs=120000){}
 async ask(prompt:string,{signal}:{signal:AbortSignal}):Promise<string>{
  if(signal.aborted)throw Error('PI_XAI_CANCELLED');
  if(++this.requests>12)throw Error('PI_XAI_REQUEST_LIMIT');
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
     if(created.model?.provider!=='xai'||created.model?.id!==this.model||created.getActiveToolNames().length||created.getCallableToolNames().length){
      created.dispose();throw Error('PI_XAI_SESSION_POLICY_MISMATCH');
     }
     this.session=created;
    }
    await this.session.prompt(prompt);
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
