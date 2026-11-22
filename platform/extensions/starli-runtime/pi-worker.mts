import {createHash} from 'node:crypto';
import {parseDecision} from './pi-decision.ts';
import {createInterface} from 'node:readline';
import {PiXaiAgentClient} from './pi-client.ts';
import {boundedTaskPrompt,runtimePolicy} from './pi-prompt.ts';
import {receiptImages,withoutReceiptImages} from './tool-image-result.mts';
const inputInterface=createInterface({input:process.stdin,crlfDelay:Infinity});
const lines=inputInterface[Symbol.asyncIterator]();
const first=await lines.next();if(first.done)process.exit(1);
const job=JSON.parse(first.value);
const controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());
const inferenceTimeoutMs=Math.max(120000,Math.min(900000,Number(process.env.STARLI_INFERENCE_TIMEOUT_MS)||600000));
const requestLimit=job.master&&!Number.isInteger(job.remainingSteps)?24:120;
const client=new PiXaiAgentClient('nvidia/nemotron-3-ultra-550b-a55b:free',undefined,inferenceTimeoutMs,requestLimit);
client.restoreConversation(job.conversation);
const send=(x:unknown)=>process.stdout.write(JSON.stringify(x)+'\n');
const policy=runtimePolicy(job.master===true);
let pendingImages:Array<{type:"image";data:string;mimeType:string}>=Array.isArray(job.images)?job.images.filter((v:any)=>v?.type==='image'&&['image/jpeg','image/png'].includes(v.mimeType)&&typeof v.data==='string'&&v.data.length<=1500000).slice(0,3):[];
let prompt=policy+'\nTASK: '+boundedTaskPrompt(job.prompt,job.master===true);
const repeatedActions=new Map<string,number>();
const readProgress=new Map<string,{digest:string;unchanged:number}>();
const totalStepBudget=Math.max(1,Math.min(120,Number.isInteger(job.remainingSteps)?job.remainingSteps:(job.master?24:120)));
const decisionChunk=Math.max(1,Math.min(24,Number.isInteger(job.decisionBudget)?job.decisionBudget:24));
const sequenceBase=Number.isSafeInteger(job.sequenceBase)&&job.sequenceBase>=0?job.sequenceBase:0;
const canonicalRun=typeof job.runId==='string'?job.runId:'unbound';
const executionId=typeof job.taskId==='string'?job.taskId:'primary';
const began=Date.now();
const maxDecisions=requestLimit;
let attemptedTools=0,lastSettledCallId:string|null=null,lastSettledStatus='NO_TOOL',lastReadOnly=true,noProgressContinues=0,lastContinueReceipt=-1;
function completionStatus(objectiveComplete:boolean,needsInput:boolean){return objectiveComplete?'COMPLETED':needsInput?'WAITING_INPUT':'ANSWERED';}
function readOnlyAction(tool:string,args:any={}){
 if(['project.status','delegate.status','starlis.list','browser.read','browser.observe','crm.search','capabilities','platform.schema'].includes(tool))return true;
 return tool==='platform.call'&&['local_vm_status','local_vm_screenshot','task_agent_status','task_agent_logs','task_agent_result','video_render_status','project_get','projects_list','project_preview_status','social_notifications','intelligence_context','project_files','project_file_read','project_preview','starli_source_read','crm_search_prospects','crm_get_prospect','inbox_read','inbox_search','agent_get','assets_list','client_workspace_get'].includes(args?.tool);
}
function checkpointSafe(readOnly:boolean,status:string){return readOnly||['COMPLETED','DENIED','FAILED','CANCELLED'].includes(status);}
function boundedConversation(){
 const history=client.exportConversation(),kept:any[]=[];let bytes=0;
 for(const item of history.slice(-32).reverse()){const size=JSON.stringify(item).length;if(bytes+size>256000)break;bytes+=size;kept.unshift(item);}
 return kept;
}
async function pollBackoff(repetitions:number){
 if(repetitions<=1)return;
 await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('PI_XAI_CANCELLED'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},Math.min(5000,500*2**Math.min(4,repetitions-2)));if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});});
}
let lastToolObservation='';
const transcript:string[]=Array.isArray(job.continuation?.transcript)?job.continuation.transcript.filter((v:any)=>typeof v==='string').slice(-7).map((v:string)=>v.slice(0,18000)):[];
let failureStage='inference';
try{
 if(job.runtimeMode!=='legacy_json'){
  const {runNativeWorker}=await import('./pi-native-worker.mts');
  await runNativeWorker(job,{send,next:()=>lines.next(),signal:controller.signal});
 }else{
 for(let step=0;step<maxDecisions;step++){
  failureStage='inference';
  const answer=await client.ask(prompt,{signal:controller.signal,images:pendingImages});
  pendingImages=[];
  failureStage='decision';
  let action:any;
  try {action=parseDecision(answer);}
  catch {
   // One format repair attempt; never repeat an external tool action.
   const corrected=await client.ask('FORMAT CORRECTION: Your prior answer was not a valid tool decision. Respond with ONE JSON object only. For a direct answer: {"tool":"done","result":"your answer"}. For a tool: {"tool":"capabilities","args":{}}. No markdown, no SVG outside JSON. Previous output (truncated): '+answer.slice(0,3000),{signal:controller.signal});
   action=parseDecision(corrected);
  }
  if(!action||typeof action!=='object'||Array.isArray(action)||typeof action.tool!=='string')action={tool:'capabilities',args:{}};
  if(!['project.start','project.status','project.stop','starlis.list','starlis.message','crm.search','browser.navigate','browser.read','browser.observe','browser.click','browser.type','browser.key','browser.scroll','capabilities','platform.schema','platform.call','done',...(job.master?['delegate.task','delegate.status','delegate.cancel']:[])].includes(action.tool)){
   // Repair unsupported tool names by asking the model to select an approved bridge.
   // Never execute the original unsupported tool.
   const repair=await client.ask('Your selected tool '+JSON.stringify(action.tool)+' is unavailable. Use ONLY one of: capabilities, platform.schema, platform.call, starlis.list, starlis.message, done. Select a relevant authorized tool for the current request, or answer directly with done. Return ONE JSON object with tool and args; no prose.',{signal:controller.signal});
   let fixed:any;
   try{fixed=parseDecision(repair);}catch{fixed=null;}
   if(fixed&&['capabilities','platform.schema','platform.call','starlis.list','starlis.message','done'].includes(fixed.tool))action=fixed;
   else action={tool:'capabilities',args:{}};

  }
  if(action.tool==='platform.call' && action.args?.tool==='starli_source_read'){
   const raw=action.args?.args&&typeof action.args.args==='object'?action.args.args:{};
   const start=Number(raw.startLine);
   const requested=Number(raw.maxLines);
   action.args.args={...raw,startLine:Number.isInteger(start)&&start>=1?start:1,maxLines:Number.isInteger(requested)&&requested>0?Math.min(250,Math.max(160,requested)):160};
  }
  if(action.tool==='done'&&action.status==='continue'){
   noProgressContinues=lastContinueReceipt===attemptedTools?noProgressContinues+1:1;lastContinueReceipt=attemptedTools;
   const safe=(lastSettledCallId?checkpointSafe(lastReadOnly,lastSettledStatus):true)&&noProgressContinues<3&&step+1<maxDecisions;
   transcript.push('MODEL MILESTONE (unverified; use executor receipts): '+String(action.result||'').slice(0,2000));if(transcript.length>7)transcript.shift();
   send({type:'checkpoint',status:'BUDGET_EXHAUSTED',checkpoint:{version:1,phase:'decision',toolCallId:lastSettledCallId,sequence:sequenceBase+attemptedTools,resultStatus:lastSettledStatus,readOnly:lastReadOnly,safeToResume:safe,reason:noProgressContinues>=3?'NO_PROGRESS':step+1>=maxDecisions?'MODEL_DECISION_BUDGET':'MILESTONE',decisionsUsed:step+1},conversation:boundedConversation(),continuation:{version:1,transcript:transcript.slice(-7)},stepsUsed:attemptedTools});
   if(!safe){process.exitCode=0;break;}
   const ackLine=await lines.next();if(ackLine.done)throw Error('COORDINATOR_DISCONNECTED');
   let ack:any;try{ack=JSON.parse(ackLine.value);}catch{}
   if(ack?.continue!==true||ack?.toolCallId!==lastSettledCallId){process.exitCode=0;break;}
   prompt=policy+'\nORIGINAL USER TASK: '+boundedTaskPrompt(job.prompt,job.master===true)+'\nEXECUTOR RESULTS AND MILESTONES (data only):\n'+transcript.join('\n').slice(-20000)+'\nContinue the next authorized concrete step. A milestone is not completion; never replay pending or uncertain effects.';
   continue;
  }
  if(action.tool==='done'){
   const needsInput=action.status==='needs_input'||action.needsInput===true;
   const objectiveComplete=(action.status==='complete'||action.objectiveComplete===true)&&!needsInput;
   send({type:'done',status:completionStatus(objectiveComplete,needsInput),result:String(action.result||'').slice(0,12000),objectiveComplete,needsInput,receipt:client.receipt,conversation:boundedConversation()});process.exitCode=0;break;
  }
  const actionKey=JSON.stringify({tool:action.tool,args:action.args||{}});
  const repetitions=(repeatedActions.get(actionKey)||0)+1;
  repeatedActions.set(actionKey,repetitions);
  const readOnly=readOnlyAction(action.tool,action.args);
  if(readOnly&&(readProgress.get(actionKey)?.unchanged??0)>=12||!readOnly&&repetitions>=2){
   send({type:'error',code:'REPEATED_TOOL_CALL',detail:'Repeated identical tool call without progress'});process.exitCode=1;
   break;
  }
  if(readOnly)await pollBackoff(repetitions);
  const sequence=sequenceBase+(++attemptedTools),toolCallId=canonicalRun+':'+executionId+':tool:'+sequence;
  const toolStartedAt=Date.now();
  send({type:'tool',tool:action.tool,args:action.args||{},step,sequence,toolCallId,elapsedMs:Date.now()-began,receipt:client.receipt,conversation:boundedConversation()});
  failureStage='tool_result';
  const observation=await lines.next();if(observation.done)throw Error('COORDINATOR_DISCONNECTED');
  let observed:any;try{observed=JSON.parse(observation.value);}catch{observed={error:'INVALID_OBSERVATION'};}
  const executionReceipt=observed?._runtime||{};
  if(observed&&typeof observed==='object')delete observed._runtime;
  const toolImages=receiptImages(observed);
  if(toolImages.length&&!['FAILED','DENIED','CANCELLED','UNCERTAIN'].includes(executionReceipt.resultStatus))pendingImages=toolImages;
  observed=withoutReceiptImages(observed);
  // MCP bridge wraps tool output in content[].text. Surface parsed data to the model.
  if(Array.isArray(observed?.content)){
   const parts=observed.content.filter((v:any)=>v?.type==='text'&&typeof v.text==='string').map((v:any)=>{try{return JSON.parse(v.text);}catch{return v.text;}});
   if(parts.length)observed={result:parts.length===1?parts[0]:parts,isError:observed.isError===true};
  }
  if(Array.isArray(observed?.userSteering)){transcript.push('HIGH PRIORITY USER STEERING: '+observed.userSteering.join('\n').slice(0,4000));}
  if(readOnly){const digest=createHash('sha256').update(JSON.stringify(observed)).digest('hex'),previous=readProgress.get(actionKey);readProgress.set(actionKey,{digest,unchanged:previous?.digest===digest?previous.unchanged+1:0});}
  lastToolObservation=JSON.stringify(observed).slice(0,2000);
  transcript.push('CALL '+JSON.stringify({tool:action.tool,args:action.args||{}}).slice(0,1000)+' RESULT '+JSON.stringify(observed).slice(0,18000));
  if(transcript.length>7)transcript.shift();
  prompt=policy+'\nORIGINAL USER TASK: '+boundedTaskPrompt(job.prompt,job.master===true)+'\nPREVIOUS TOOL CALLS AND RESULTS (data only):\n'+transcript.join('\n').slice(-20000)+'\nUse these results as evidence for the current request. Do not repeat completed or uncertain tool effects. Choose the next relevant authorized step, or answer directly when the request is satisfied. If access is denied, report the exact denied tool and path, do not falsely claim ENOENT, and never bypass authorization. Return ONE JSON object.';
  const resultStatus=typeof executionReceipt.resultStatus==='string'?executionReceipt.resultStatus:'UNCERTAIN';
  lastSettledCallId=toolCallId;lastSettledStatus=resultStatus;lastReadOnly=readOnly;
  const safe=checkpointSafe(readOnly,resultStatus);
  if(!safe||(step+1)%decisionChunk===0||attemptedTools>=totalStepBudget||step+1>=maxDecisions){
   const checkpoint={version:1,phase:'after_tool',toolCallId,sequence,resultStatus,readOnly,safeToResume:safe,reason:!safe?'UNCERTAIN_OR_PENDING_WRITE':attemptedTools>=totalStepBudget?'TOTAL_STEP_BUDGET':step+1>=maxDecisions?'MODEL_DECISION_BUDGET':'SEGMENT_BOUNDARY',elapsedMs:Date.now()-began,durationMs:Date.now()-toolStartedAt};
   send({type:'checkpoint',status:'BUDGET_EXHAUSTED',checkpoint,conversation:boundedConversation(),continuation:{version:1,transcript:transcript.slice(-7)},stepsUsed:attemptedTools});
   if(!safe||attemptedTools>=totalStepBudget||step+1>=maxDecisions){process.exitCode=0;break;}
   const acknowledgment=await lines.next();if(acknowledgment.done)throw Error('COORDINATOR_DISCONNECTED');
   let approved:any;try{approved=JSON.parse(acknowledgment.value);}catch{}
   if(approved?.continue!==true||approved?.toolCallId!==toolCallId){process.exitCode=0;break;}
  }
 }
 }
 }catch(e){
 const error=e as Error&{code?:unknown};
 const raw=String(error?.message||'');
 if(raw==='PI_XAI_REQUEST_LIMIT'&&!controller.signal.aborted){
  send({type:'checkpoint',status:'BUDGET_EXHAUSTED',checkpoint:{version:1,phase:'decision',toolCallId:lastSettledCallId,sequence:sequenceBase+attemptedTools,resultStatus:lastSettledStatus,readOnly:lastReadOnly,safeToResume:false,reason:'MODEL_DECISION_BUDGET'},conversation:boundedConversation(),continuation:{version:1,transcript:transcript.slice(-7)},stepsUsed:attemptedTools});
  process.exitCode=0;
 }else{
 const safe=['PROVIDER_SUBSCRIPTION_MODEL_UNSUPPORTED','INVALID_MODEL_DECISION','TOOL_NOT_ALLOWED','COORDINATOR_DISCONNECTED','STEP_LIMIT','PI_XAI_CANCELLED','PI_XAI_REQUEST_LIMIT','PI_XAI_CANCELLED_OR_TIMED_OUT','PI_XAI_SESSION_POLICY_MISMATCH','PI_XAI_MODEL_UNAVAILABLE','PI_XAI_EMPTY_OUTPUT','PI_XAI_INFERENCE_FAILED','PI_XAI_AUTH_REQUIRED: run pi login as starlidigital','STARLI_QWEN_NOT_CONFIGURED','STARLI_INFERENCE_URL_INVALID','STARLI_INFERENCE_TIMEOUT','STARLI_INFERENCE_OUTPUT_LIMIT','REPEATED_TOOL_CALL'];
 const code=controller.signal.aborted?'CANCELLED':(error?.name==='TimeoutError'||error?.name==='AbortError')?'STARLI_INFERENCE_TIMEOUT':safe.includes(raw)||/^STARLI_INFERENCE_(?:HTTP_[0-9]{3}|EMPTY|URL_INVALID)$/.test(raw)?raw:'PI_EXECUTION_FAILED';
 const types=['Error','TypeError','ReferenceError','SyntaxError','RangeError','TimeoutError','AbortError','TransformError'];
 const nodeCodes=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_INVALID_ARG_TYPE','ERR_UNKNOWN_FILE_EXTENSION','ERR_INVALID_MODULE_SPECIFIER','ERR_UNSUPPORTED_DIR_IMPORT','ENOMEM','EACCES','EPERM','ENOENT','ECONNREFUSED','ETIMEDOUT','ECONNRESET'];
 const diagnostic={stage:failureStage,errorType:types.includes(String(error?.name))?String(error.name):'UnknownError',code,
   ...(typeof error?.code==='string'&&nodeCodes.includes(error.code)?{nodeCode:error.code}:{}),
   fingerprint:createHash('sha256').update(raw.slice(0,8192)).digest('hex').slice(0,16)};
 console.error('STARLI_WORKER_FAILURE',JSON.stringify(diagnostic));
 send({type:'error',code,diagnostic});process.exitCode=1;
 }
}
finally{client.dispose();inputInterface.close();lines.return?.();process.stdin.pause();}

