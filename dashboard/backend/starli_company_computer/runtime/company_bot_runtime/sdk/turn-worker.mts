import {companyAgentSystemPrompt} from './agent-system-prompt.mts';
import {isAbsolute} from 'node:path';
import {createInterface}from'node:readline';import{pathToFileURL}from'node:url';
import{createCompanyProviderHost}from'./company-provider-host.mts';
import{createPiLiveAgent}from'./pi-live-agent.mts';
import{accountWireTools}from'./company-wire-tools.mts';
import{createHash}from'node:crypto';
const SAFE_RPC_CODES=new Set<string>(['ACCESS_DENIED','NATIVE_AUTHORITY_DENIED','NATIVE_RUN_DENIED','RUNTIME_RPC_UNAVAILABLE','TURN_STOPPED','TURN_CANCELLED','ROOM_CONTEXT_CHANGED','ROOM_NOT_FOUND','ROOM_REVISION_CHANGED','ROOM_TURN_ACTIVE','AGENT_NOT_IN_ROOM','AGENT_NOT_FOUND','AGENT_DISPATCH_DENIED','COMPANY_BOT_NOT_FOUND','COMPANY_PERMISSION_DENIED','COMPANY_AUTHORIZATION_DENIED','COMPANY_CAPABILITY_DENIED','COMPANY_BOT_DENIED','COMPANY_SCOPE_INVALID','COMPANY_SELECTION_REQUIRED','COMPANY_SELECTION_CHANGED','COMPANY_CONNECTION_UNAVAILABLE','COMPANY_CREDENTIAL_REFRESH_DENIED','COMPANY_CREDENTIAL_REFRESH_CONFLICT','COMPANY_MODEL_UNSUPPORTED','MODEL_UNSUPPORTED','MEMBERSHIP_CHANGED','AUDIENCE_CHANGED','SESSION_EXPIRED','SESSION_REVOKED','NATIVE_JWT_REQUIRED','NATIVE_JWT_INVALID','REQUESTING_HUMAN_NOT_CURRENT','SOURCE_MESSAGE_DENIED','MODEL_OUTPUT_INVALID','MODEL_OUTPUT_LIMIT','VISION_RUN_REQUIRED','VISION_SOURCE_DENIED','VISION_ATTACHMENT_UNSUPPORTED','VISION_ACCESS_DENIED','VISION_BOTS_REQUIRED','MODEL_DOES_NOT_SUPPORT_IMAGES','IMAGE_ATTACHMENT_LIMIT','IMAGE_ATTACHMENT_UNSUPPORTED','IMAGE_ATTACHMENT_INVALID','COMPANY_ATTACHMENT_DENIED','COMPANY_ATTACHMENT_BINDING_REQUIRED','COMPANY_ATTACHMENT_TRANSACTION_REQUIRED','COMPANY_ATTACHMENT_DATABASE_MISMATCH','ATTACHMENT_DENIED','MEMORY_SCOPE_CHANGED','MEMORY_RUN_SCOPE_CHANGED','MEMORY_RUN_UNAVAILABLE','MEMORY_AUDIENCE_DENIED','MEMORY_PRIVATE_AUDIENCE_REQUIRED','MEMORY_INVALID_CONTEXT','MEMORY_STORAGE_UNAVAILABLE','MEMORY_STORAGE_FULL','MEMORY_NOT_FOUND','MEMORY_CONFLICT','MEMORY_CONTENT_INVALID','MEMORY_PATH_INVALID','MEMORY_UNSAFE_PATH','MEMORY_TOOL_UNAVAILABLE','MEMORY_TOOL_ARGUMENTS_INVALID','MEMORY_TOOL_BINDING_INVALID','MEMORY_TOOL_ID_REUSED','AGENT_PROFILE_CHANGED','AGENT_PROFILE_INVALID','AGENT_PROFILE_UNAVAILABLE','DELEGATION_PARENT_STOPPED','DELEGATION_RUN_REVOKED','DELEGATION_DEPTH_LIMIT','DELEGATION_TURN_LIMIT','DELEGATION_NO_REPLAY','DELEGATION_DISPATCH_DENIED','DELEGATION_BOT_IDENTITY_CHANGED','DELEGATION_ROOM_CHANGED','DELEGATION_BOT_BUSY','DELEGATION_SELF_DENIED','OUTREACH_NATIVE_JWT_REQUIRED','OUTREACH_SCOPE_CHANGED','OUTREACH_POLICY_DENIED','OUTREACH_RUN_REVOKED','CHANNEL_SOURCE_SCOPE_CHANGED','CHANNEL_ACTOR_CHANGED','CHANNEL_RUN_REVOKED','CHANNEL_BOT_DISPATCH_DENIED','COMPANY_CHANNEL_NOT_FOUND','CHANNEL_CALL_CONFLICT','CHANNEL_DIRECTORY_PAGINATION_REQUIRED','ACTION_MESSAGE_CHANGED','ACTION_RECEIPT_NOT_FOUND','RECIPIENT_AMBIGUOUS','RECIPIENT_CHANGED','DIRECTORY_PAGINATION_REQUIRED','NATIVE_AUTHORITY_SCHEMA_REQUIRED','NATIVE_HUMAN_DIRECTORY_REQUIRED','COMPANY_TOOL_UNAVAILABLE','COMPANY_TOOL_ACCESS_DENIED','COMPANY_TOOL_ARGUMENTS_INVALID','COMPANY_TOOL_AUDIENCE_CHANGED','COMPANY_TOOL_BACKING_SERVICE_UNAVAILABLE','COMPANY_TOOL_BINDING_INVALID','COMPANY_TOOL_BOT_REMOVED','COMPANY_TOOL_CALL_COLLISION','COMPANY_TOOL_CONFIGURATION_CHANGED','COMPANY_TOOL_CONTEXT_CHANGED','COMPANY_TOOL_EVENT_INVALID','COMPANY_TOOL_FILE_LIMIT','COMPANY_TOOL_MEMBERSHIP_CHANGED','COMPANY_TOOL_REGISTRATION_INVALID','COMPANY_TOOL_RESOURCE_AUDIENCE_DENIED','COMPANY_TOOL_RESOURCE_COLLISION','COMPANY_TOOL_RESOURCE_KIND_DENIED','COMPANY_TOOL_RESULT_LIMIT','COMPANY_TOOL_REVISION_CONFLICT','COMPANY_TOOL_RUN_REVOKED','COMPANY_TOOL_SESSION_REVOKED','COMPANY_TOOL_SUCCESS_WITHOUT_RECEIPT','COMPANY_TOOL_UNCERTAIN_NO_RETRY','NATIVE_TOOL_SCOPE_REQUIRED','NATIVE_TOOL_SCOPE_MISMATCH']);
function safeRpcCode(code:unknown,fallback='NATIVE_AUTHORITY_DENIED'):string{
 return typeof code==='string'&&SAFE_RPC_CODES.has(code)?code:fallback;
}
// SAFE_PROVIDER_DIAGNOSTICS_START
function nativeFailureCode(result:any,last:any,rpcError?:string|null):string|undefined{
 if(result.status==='ANSWERED')return undefined;
 if(result.status==='DENIED')return safeRpcCode(rpcError,'NATIVE_AUTHORITY_DENIED');
 if(result.status==='INTERRUPTED'&&Array.isArray(result.inFlight)&&result.inFlight.length)return 'PI_NATIVE_TOOL_UNSETTLED';
 const raw=typeof last?.errorMessage==='string'?last.errorMessage:'';
 const message=raw.slice(0,16384).toLowerCase();
 if(/insufficient[_ -]quota|quota.*exceed|exceed.*quota|billing|credit balance|payment required|spend limit|usage limit/.test(message))return 'PI_NATIVE_PROVIDER_QUOTA';
 if(/rate[_ -]?limit|too many requests|\b429\b/.test(message))return 'PI_NATIVE_PROVIDER_RATE_LIMIT';
 if(/invalid.*api.?key|incorrect.*api.?key|authentication|unauthorized|invalid.*token|expired.*token|\b401\b/.test(message))return 'PI_NATIVE_PROVIDER_AUTH';
 if(/context[_ -]length|context window|too many tokens|maximum context|max.*input.*tokens/.test(message))return 'PI_NATIVE_PROVIDER_CONTEXT';
 if(/model.*(?:not found|does not exist|unsupported|not supported|not available)|unsupported.*model|unknown model|does not support.*(?:tool|function)|unsupported.*(?:tool|function)|not have access.*model/.test(message))return 'PI_NATIVE_PROVIDER_MODEL_UNSUPPORTED';
 if(/fetch failed|enotfound|econnreset|econnrefused|etimedout|timed? ?out|timeout|network|socket|dns|connection (?:closed|failed|reset)/.test(message))return 'PI_NATIVE_PROVIDER_NETWORK';
 if(/^[A-Z][A-Z0-9_]{1,79}$/.test(raw))return raw;
 if(result.status==='FAILED')return 'PI_NATIVE_PROVIDER_ERROR';
 if(result.status==='LIMIT_REACHED')return 'PI_NATIVE_TURN_DEADLINE';
 if(result.status==='INTERRUPTED')return 'PI_NATIVE_TURN_INTERRUPTED';
 if(result.status==='CANCELLED')return 'PI_NATIVE_TURN_CANCELLED';
 if(result.status==='PENDING')return 'PI_NATIVE_TURN_PENDING';
 return 'PI_NATIVE_TURN_INCOMPLETE';
}
// SAFE_PROVIDER_DIAGNOSTICS_END
const configuredSDK=process.env.STARLI_COMPANY_PI_SDK;
if(configuredSDK&&(!isAbsolute(configuredSDK)||configuredSDK.split(/[\\/]/).includes('..')))throw Error('COMPANY_SDK_PATH_INVALID');
const SDK=(configuredSDK||'/srv/starlidigital/mcp-workspace/codex-runtime/node_modules/@earendil-works');
const {Agent}=await import(SDK+'/pi-agent-core/dist/index.js');
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const send=(x:any)=>process.stdout.write(JSON.stringify(x)+'\n');
process.on('uncaughtException',(error:any)=>{const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.message)?error.message:'NATIVE_WORKER_FAILED';send({type:'error',code});process.exitCode=1;});
const first=await lines.next();if(first.done)throw Error('MISSING_JOB');const job=JSON.parse(first.value);
let sequence=0,tail:Promise<unknown>=Promise.resolve(),lastRpcError:string|null=null;
function rpc(operation:string,value:any={}){const pending=tail.then(async()=>{const id=++sequence;send({type:'rpc',id,operation,value});const line=await lines.next();if(line.done)throw Error('PARENT_DISCONNECTED');const result=JSON.parse(line.value);if(result.id!==id||result.ok!==true){const code=safeRpcCode(result?.code,'NATIVE_AUTHORITY_DENIED');lastRpcError=code;throw Error(code);}return result.result;});tail=pending.catch(()=>{});return pending;}
const profile=await import(pathToFileURL(process.argv[2]).href);
const controller=new AbortController();
const configured=await profile.configure(job.selection,controller.signal);
const journalId=(id:string)=>{
 if(typeof id!=='string'||id.length>400||!/^[A-Za-z0-9_.:|\-]+$/.test(id))throw Error('INVALID_TOOL_CALL_ID');
 return /^[A-Za-z0-9_.:-]{1,180}$/.test(id)?id:'pi_'+createHash('sha256').update(id).digest('hex');
};
const host=await createCompanyProviderHost({selection:job.selection,...configured,signal:controller.signal,
 checkCompanySelection:()=>rpc('authorize'),refreshCredential:async(credential:any)=>(await rpc('provider.refresh',{credential}))?.credentialSaved===true,
 loadMemory:(phase:string)=>rpc('memory.load',{phase}),checkMemory:(snapshot:any)=>rpc('memory.check',snapshot)});
const history=(job.history??[]).map((message:any)=>message.role==='user'?{role:'user',content:message.content,timestamp:Date.now()}:
 {role:'assistant',content:[{type:'text',text:message.content}],api:host.model.api,provider:host.model.provider,model:host.model.id,
 usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
try{
 const deadlineMs = Number(process.env.STARLI_COMPANY_TURN_MILLIS || 25000);
 if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 86400000) throw Error('INVALID_TURN_DEADLINE');
 const captured=await rpc('tools.catalogue');
 const aliases:Record<string,string>={'computer.status':'computer_status','computer.display_note':'computer_display_note','memory_read':'memory_read','memory_write':'memory_write','memory_search':'memory_search','memory_history':'memory_history','memory_delete':'memory_delete','company_files_list':'company_files_list','company_files_search':'company_files_search','company_file_read':'company_file_read','company_document_read':'company_document_read','company_document_create':'company_document_create','company_document_update':'company_document_update','company_tasks_list':'company_tasks_list','company_projects_list':'company_projects_list','company_knowledge_search':'company_knowledge_search','company_directory':'company_directory','company_message_send':'company_message_send','web_search':'web_search','web_fetch':'web_fetch','browser.navigate':'browser_navigate','browser.read':'browser_read','browser.observe':'browser_observe','browser.click':'browser_click','browser.type':'browser_type','browser.key':'browser_key','browser.scroll':'browser_scroll','browser.status':'browser_status'};
 const external=accountWireTools(captured);
 const legacyCanonical=Object.fromEntries(Object.entries(aliases).map(([name,alias])=>[alias,name]));
 const canonical=(name:string)=>external?external.canonical(name):legacyCanonical[name];
 const tools=external?external.declarations:captured.map((tool:any)=>{if(!aliases[tool.name])throw Error('TOOL_ALIAS_UNREGISTERED');return{...tool,name:aliases[tool.name]};});
 if(typeof configured.bindTools==='function')configured.bindTools(tools);
 const vision=await rpc('vision.load',{supportsImage:Array.isArray(host.model.input)&&host.model.input.includes('image')});
 const agent=createPiLiveAgent({Agent,model:host.model,streamFn:host.streamFn,promptImages:vision.images,initialMessages:history,
  systemPrompt:companyAgentSystemPrompt(job.selection),
  tools,execute:async(call:any)=>rpc('tool.execute',{toolCallId:journalId(call.toolCallId),name:canonical(call.name),args:call.args}),authorize:()=>rpc('authorize'),
  checkpoint:async()=>{await rpc('authorize');},onEvent:event=>send({type:'event',event:event.type==='tool'?{...event,toolCallId:journalId(event.toolCallId),name:canonical(event.name)??event.name}:event}),
  limits:{maxModelCalls:null,maxToolCalls:null,deadlineAt:Date.now()+deadlineMs}});
 const result=await agent.run(job.prompt);
 const last=[...result.newMessages].reverse().find(m=>m.role==='assistant');
 // The channel streams visible text from every model step into one reply.
 // Reconcile that complete reply even when the first step narrated a tool call.
 const answer=result.newMessages.filter(message=>message.role==='assistant')
  .flatMap(message=>message.content??[]).filter((part:any)=>part.type==='text')
  .map((part:any)=>part.text).join('');
 const code=nativeFailureCode(result,last,lastRpcError);
 const rawError=typeof last?.errorMessage==='string'?last.errorMessage:'';
 const safeReasons=new Set(['stop','length','toolUse','error','aborted','pending','deferred']);
 const providerDiagnostic={stopReason:safeReasons.has(last?.stopReason)?last.stopReason:'other',errorLength:rawError.length,errorSha256:rawError?createHash('sha256').update(rawError).digest('hex'):null,inFlightCount:Array.isArray(result.inFlight)?result.inFlight.length:0,rpcErrorCode:lastRpcError};
 send({type:'done',result:{status:result.status,answer,receipt:host.publicReceipt(),errorCode:code,providerDiagnostic}});
}finally{host.dispose();controller.abort();}
