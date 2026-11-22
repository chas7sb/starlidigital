/** Native Pi Agent adapter. Host owns credentials, IPC, durable storage and public transport.
 * Pinned/tested API target: pi-agent-core + pi-ai 1.5.0; constructor is injected.
 * Checkpoints contain PRIVATE full transcripts. Never send them to public event channels.
 */
export type ToolSpec = {name:string;description:string;parameters:object;effect:'read'|'write'};
export type SafeEvent =
 | {type:'text_delta';text:string}
 | {type:'tool';toolCallId:string;modelTurn:number;name:string;status:'started'|'progress'|'succeeded'|'failed'|'pending'|'uncertain'}
 | {type:'state';status:RunStatus};
export type RunStatus='ANSWERED'|'PENDING'|'INTERRUPTED'|'CANCELLED'|'LIMIT_REACHED'|'DENIED'|'FAILED';
export type Checkpoint={version:1;messages:any[];inFlight:{toolCallId:string;modelTurn:number;name:string;effect:'read'|'write'}[];receipts:{toolCallId:string;modelTurn:number;name:string;outcome:ExecuteResult['outcome'];result:ExecuteResult['result']}[];modelCalls:number;toolCalls:number;status:'RUNNING'|RunStatus};
export type ExecuteResult={result:{content:any[];details?:unknown;isError?:boolean;[key:string]:unknown};outcome:'settled'|'pending'|'uncertain'};
export interface LiveOptions {
 Agent:new(options:any)=>any;
 model:any; streamFn:(...args:any[])=>any;systemPrompt?:string;
 tools:ToolSpec[];
 execute:(call:{toolCallId:string;modelTurn:number;name:string;args:unknown;signal:AbortSignal;update:()=>void})=>Promise<ExecuteResult>;
 authorize:(request:{phase:'model'|'tool';toolCallId?:string;name?:string;signal:AbortSignal})=>Promise<boolean>;
 checkpoint:(snapshot:Checkpoint)=>Promise<void>;
 onEvent?:(event:SafeEvent)=>Promise<void>|void;
 limits:{maxModelCalls:number|null;maxToolCalls:number|null;deadlineAt:number};
 promptImages?:{type:'image';data:string;mimeType:string}[];
 initialMessages?:any[];initialInFlight?:Checkpoint['inFlight'];restore?:Checkpoint;signal?:AbortSignal;
}
const copy=<T,>(value:T):T=>structuredClone(value);
export function createPiLiveAgent(o:LiveOptions){
 if((o.limits.maxModelCalls!==null&&(!Number.isSafeInteger(o.limits.maxModelCalls)||o.limits.maxModelCalls<1))||(o.limits.maxToolCalls!==null&&(!Number.isSafeInteger(o.limits.maxToolCalls)||o.limits.maxToolCalls<0))||!Number.isFinite(o.limits.deadlineAt))throw Error('INVALID_LIMITS');
 const specs=new Map<string,ToolSpec>();
 for(const t of o.tools){if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(t.name)||specs.has(t.name)||!t.parameters||typeof t.parameters!=='object'||!['read','write'].includes(t.effect))throw Error('INVALID_TOOL');specs.set(t.name,copy(t));}
 let agent:any,modelCalls=o.restore?.modelCalls??0,toolCalls=o.restore?.toolCalls??0,used=false,stop:RunStatus|undefined,finalStatus:RunStatus|undefined;
 const inFlight=new Map((o.restore?.inFlight??o.initialInFlight??[]).map(x=>[x.modelTurn+':'+x.toolCallId,copy(x)]));
 const receipts:Checkpoint['receipts']=copy(o.restore?.receipts??[]);
 const outcomes=new Map<string,ExecuteResult['outcome']>(),seen=new Set<string>();
 const controller=new AbortController();
 let task:Promise<any>|undefined;
 const emit=async(event:SafeEvent)=>{if(o.onEvent)await o.onEvent(event);};
 const halt=(why:RunStatus)=>{stop??=why;controller.abort();agent?.abort();};
 const snapshot=():Checkpoint=>({version:1,messages:copy(agent.state.messages),inFlight:copy([...inFlight.values()]),receipts:copy(receipts),modelCalls,toolCalls,status:finalStatus??stop??'RUNNING'});
 const save=async()=>{try{await o.checkpoint(snapshot());}catch{halt('FAILED');throw Error('CHECKPOINT_FAILED');}};
 const check=async(phase:'model'|'tool',signal?:AbortSignal,call?:{id:string;name:string})=>{
  if(stop||controller.signal.aborted||signal?.aborted)throw Error('RUN_STOPPED');
  if(Date.now()>=o.limits.deadlineAt){halt('LIMIT_REACHED');throw Error('RUN_LIMIT');}
  let allowed=false;
  try{allowed=await o.authorize({phase,toolCallId:call?.id,name:call?.name,signal:controller.signal});}
  catch{halt('DENIED');throw Error('AUTHORIZATION_UNAVAILABLE');}
  if(allowed!==true){halt('DENIED');throw Error('AUTHORIZATION_DENIED');}
  if(stop||controller.signal.aborted||signal?.aborted)throw Error('RUN_STOPPED');
  if(Date.now()>=o.limits.deadlineAt){halt('LIMIT_REACHED');throw Error('RUN_LIMIT');}
 };
 const tools=[...specs.values()].map(t=>({...t,label:t.name,replay:'never',executionMode:'sequential',
  execute:async(id:string,args:unknown,signal:AbortSignal,onUpdate:any)=>{
   await check('tool',signal,{id,name:t.name});
   const key=modelCalls+':'+id;
   if(seen.has(key)){halt('INTERRUPTED');throw Error('DUPLICATE_TOOL_CALL');}
   seen.add(key);inFlight.set(key,{toolCallId:id,modelTurn:modelCalls,name:t.name,effect:t.effect});
   // Durable intent must finish BEFORE execution. Failure leaves the effect unexecuted.
   try{await save();}catch{halt('FAILED');throw Error('CHECKPOINT_FAILED');}
   await check('tool',signal,{id,name:t.name});
   let receipt:ExecuteResult;
   try{
    receipt=await o.execute({toolCallId:id,modelTurn:modelCalls,name:t.name,args,signal:controller.signal,update:()=>onUpdate?.({content:[],details:undefined})});
    if(!receipt||!['settled','pending','uncertain'].includes(receipt.outcome)||!Array.isArray(receipt.result?.content))throw Error('INVALID_RECEIPT');
   }catch{
    if(t.effect==='write'){outcomes.set(key,'uncertain');stop='INTERRUPTED';halt('INTERRUPTED');}
    else {inFlight.delete(key);outcomes.set(key,'settled');}
    const result={content:[{type:'text',text:'Tool execution failed; inspect the private receipt.'}],details:undefined,isError:true};
    receipts.push({toolCallId:id,modelTurn:modelCalls,name:t.name,outcome:t.effect==='write'?'uncertain':'settled',result});
    await save();
    return result;
   }
   outcomes.set(key,receipt.outcome);
   receipts.push({toolCallId:id,modelTurn:modelCalls,name:t.name,outcome:receipt.outcome,result:copy(receipt.result)});
   if(receipt.outcome==='settled')inFlight.delete(key);
   else {stop=receipt.outcome==='pending'?'PENDING':'INTERRUPTED';halt(stop);}
   await save();
   return receipt.result;
  }}));
 agent=new o.Agent({initialState:{model:o.model,systemPrompt:o.systemPrompt??'',messages:copy(o.restore?.messages??o.initialMessages??[]),tools},streamFn:o.streamFn,toolExecution:'sequential',
  prepareRequest:async(_:any,signal:AbortSignal)=>{
   await check('model',signal);
   if(o.limits.maxModelCalls!==null&&modelCalls>=o.limits.maxModelCalls){halt('LIMIT_REACHED');throw Error('MODEL_LIMIT');}
   modelCalls++;await save();
  },
  beforeToolCall:async(c:any,signal:AbortSignal)=>{
   if(stop||signal?.aborted)return {block:true,reason:'Run stopped.',terminate:true};
   // Pi validates schemas before this hook. It rejects unknown/truncated calls itself.
   if(c.assistantMessage.stopReason!=='toolUse'){halt('INTERRUPTED');return {block:true,reason:'Incomplete tool turn.',terminate:true};}
   return undefined;
  },
 });
 agent.subscribe(async(e:any)=>{
  if(e.type==='tool_execution_start'){
   if(typeof e.toolCallId!=='string'||!/^[A-Za-z0-9_.:|-]{1,200}$/.test(e.toolCallId)){halt('INTERRUPTED');return;}
   if(o.limits.maxToolCalls!==null&&toolCalls>=o.limits.maxToolCalls){halt('LIMIT_REACHED');return;}
   toolCalls++;
   const known=specs.has(e.toolName);
   // Only trusted declared names; ids are native provider call IDs, never synthesized.
   await emit({type:'tool',toolCallId:e.toolCallId,modelTurn:modelCalls,name:known?e.toolName:'tool',status:'started'});
  }else if(e.type==='tool_execution_update'&&specs.has(e.toolName)){
   await emit({type:'tool',toolCallId:e.toolCallId,modelTurn:modelCalls,name:e.toolName,status:'progress'});
  }else if(e.type==='tool_execution_end'&&typeof e.toolCallId==='string'&&/^[A-Za-z0-9_.:|-]{1,200}$/.test(e.toolCallId)){
   const outcome=outcomes.get(modelCalls+':'+e.toolCallId);
   await emit({type:'tool',toolCallId:e.toolCallId,modelTurn:modelCalls,name:specs.has(e.toolName)?e.toolName:'tool',status:outcome==='pending'?'pending':outcome==='uncertain'?'uncertain':e.isError?'failed':'succeeded'});
  }else if(e.type==='message_update'&&e.assistantMessageEvent?.type==='text_delta'){
   const text=e.assistantMessageEvent.delta;if(typeof text==='string'&&text)await emit({type:'text_delta',text});
  }
  if(e.type==='message_end'||e.type==='turn_end')await save();
 });
 const abort=(why:'CANCELLED'|'INTERRUPTED'='CANCELLED')=>halt(why);
 const externalAbort=()=>abort();
 const run=async(prompt:string)=>{
  if(used)throw Error('RUN_ALREADY_USED');used=true;
  if(typeof prompt!=='string'||!prompt.trim())throw Error('PROMPT_REQUIRED');
  // Continuing an unresolved transcript can replay effects. Require host reconciliation.
  const unresolved=new Set<string>();
  for(const m of o.restore?.messages??o.initialMessages??[]){if(m.role==='assistant')for(const c of m.content??[])if(c.type==='toolCall')unresolved.add(c.id);if(m.role==='toolResult')unresolved.delete(m.toolCallId);}
  if(inFlight.size||unresolved.size)halt('INTERRUPTED');
  o.signal?.addEventListener('abort',externalAbort,{once:true});if(o.signal?.aborted)abort();
  const timer=setTimeout(()=>halt('LIMIT_REACHED'),Math.max(0,Math.min(2147483647,o.limits.deadlineAt-Date.now())));
  // The SDK may insert a system message while constructing its state.
  const executionStart=agent.state.messages.length;
  try{
   if(!stop){if(o.promptImages?.length&&!o.model.input?.includes('image'))throw Error('MODEL_DOES_NOT_SUPPORT_IMAGES');await agent.prompt(prompt,o.promptImages);}
  }catch{if(!stop)halt('FAILED');}
  finally{
   await agent.waitForIdle();clearTimeout(timer);o.signal?.removeEventListener('abort',externalAbort);
  }
  const newMessages=copy(agent.state.messages.slice(executionStart));
  const last=[...newMessages].reverse().find((m:any)=>m.role==='assistant');
  finalStatus=stop??(last?.stopReason==='stop'?'ANSWERED':last?.stopReason==='aborted'?'CANCELLED':['pending','deferred'].includes(last?.stopReason)?'PENDING':'FAILED');
  // An unsettled intent can never be advertised as answered.
  if(inFlight.size&&finalStatus==='ANSWERED')finalStatus='INTERRUPTED';
  await save();await emit({type:'state',status:finalStatus});
  return {status:finalStatus,messages:copy(agent.state.messages),newMessages,modelCalls,toolCalls,inFlight:copy([...inFlight.values()])};
 };
 return {
  run(prompt:string){if(task)throw Error('RUN_ALREADY_USED');task=run(prompt);return task;},
  abort,async waitForIdle(){if(task)await task;else await agent.waitForIdle();},
  steer(text:string){if(!task||finalStatus||stop||!text.trim())throw Error('RUN_NOT_ACTIVE');agent.steer({role:'user',content:[{type:'text',text}],timestamp:Date.now()});},
 };
}
