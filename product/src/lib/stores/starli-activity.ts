import {assistantActivityBinding} from '../utils/starli-message-activity';
import {publicToolOutcome} from '../utils/starli-native-run-transport';
import { writable } from 'svelte/store';

export type StarliAgent = { id:string; name:string; role?:string; kind?:string; status?:string; chatId?:string|null; avatarColor?:string|null; avatarShape?:string|null; autonomousEnabled?:boolean };
export type ActivityStatus = 'RUNNING'|'COMPLETED'|'FAILED'|'DENIED'|'UNCERTAIN'|'PENDING'|'CANCELLED'|'UNKNOWN'|'STOPPING'|'NEEDS_INPUT'|'ANSWERED'|'EMPTY'|'RATE_LIMITED';
export type AgentActivity = { id:string; agentId:string; chatId:string; phase:string; label:string; running:boolean; failed:boolean; timestamp:number; taskId?:string; tool?:string; status:ActivityStatus; paths:string[]; assistantMessageId?:string;runId?:string;callId?:string;seq?:number };
export const starliRunDetails=writable<Record<string,{createdAt:number;updatedAt:number;status:string}>>({});
export const starliRunConnections=writable<Record<string,'connecting'|'live'|'reconnecting'|'unavailable'|'stopped'>>({});
export const starliAgents=writable<Record<string,StarliAgent>>({});
export const starliActivity=writable<Record<string,AgentActivity>>({});
export const starliActivityFeed=writable<AgentActivity[]>([]);
const palette=['#2563eb','#be185d','#0f766e','#7c3aed','#c2410c','#0369a1'];
export function agentColor(id:string,color?:string|null){
 if(color&&/^#[a-f0-9]{6}$/i.test(color))return color;
 let hash=0;for(const c of id)hash=(Math.imul(hash,31)+c.charCodeAt(0))|0;
 return palette[Math.abs(hash)%palette.length];
}
export function registerStarlis(agents:StarliAgent[]){starliAgents.set(Object.fromEntries(agents.filter(a=>a&&typeof a.id==='string').map(a=>[a.id,a])));}
export function resetStarliActivity(){starliRunDetails.set({});starliRunConnections.set({});starliAgents.set({});starliActivity.set({});starliActivityFeed.set([]);}
const tools:Record<string,string>={
 project_file_read:'Reading project files',project_files:'Inspecting project files',project_file_write:'Saving project changes',
 project_preview:'Checking the live preview',project_manage:'Updating the project',website_generate:'Building the website',
 crm_search_prospects:'Searching your CRM',crm_get_prospect:'Reading a client record',crm_upsert_prospect:'Updating your CRM',
 outreach_create_draft:'Preparing an email draft',outreach_get_thread:'Reading an email conversation',
 inbox_search:'Searching your mailbox',inbox_read:'Reading your mailbox',starlis_message:'Contacting a teammate',
 video_render_start:'Starting the video render',video_render_status:'Checking the video render',
 video_project_create:'Preparing a video project',video_project_apply_spec:'Composing the video',
 assets_list:'Finding project media',social_publish:'Preparing social publishing',social_schedule:'Preparing a scheduled post'
};
export function safeToolName(value:unknown){
 const name=typeof value==='string'?value.replace(/^platform\.call:/,''):'';
 return /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(name)&&!/(?:password|credential|secret|bearer)/i.test(name)?name:'';
}
export function safeActivityPaths(event:any){
 const args=event?.args&&typeof event.args==='object'?event.args:{};
 const values=[...(Array.isArray(event?.paths)?event.paths.slice(0,10):[]),args.path,args.filePath,args.file,...(Array.isArray(args.paths)?args.paths.slice(0,10):[])];
 return [...new Set(values.filter((value):value is string=>{
  if(typeof value!=='string'||!value||value.length>240||value.startsWith('/')||value.includes('\\')||value.includes(':')||/[\x00-\x1f]/.test(value))return false;
  if(value.split('/').some(v=>!v||v==='.'||v==='..'||v.startsWith('.')||v==='node_modules'))return false;
  return !/(?:credential|private-key|secret|password|access_token)/i.test(value)&&/\.(?:html?|css|[cm]?js|jsx|tsx?|svelte|json|md|py|sql|ya?ml|toml|txt|svg)$/i.test(value);
 }))].slice(0,10);
}
function toolLabel(value:unknown){
 const key=safeToolName(value).replaceAll('.','_');
 if(tools[key])return tools[key];
 if(/^(facebook|instagram|social)_/.test(key))return 'Working with your social account';
 if(/^video_/.test(key))return 'Working on your video';
 if(/^crm_/.test(key))return 'Working with your CRM';
 if(/^(inbox|mail|outreach)_/.test(key))return 'Working with your mailbox';
 if(/^(project|website)_/.test(key))return 'Working on the project';
 if(/^browser_/.test(key))return 'Checking the browser';
 return 'Using a connected tool';
}
export function activityStatus(value:unknown):ActivityStatus{
 const status=typeof value==='string'?value.toUpperCase().split(':')[0]:'';
 if(['STARTED','RUNNING','EXECUTING','IN_PROGRESS'].includes(status))return 'RUNNING';
 if(['FAILED','ERROR','REJECTED'].includes(status))return 'FAILED';
 if(['DENIED','UNAUTHORIZED','FORBIDDEN'].includes(status))return 'DENIED';
 if(['UNCERTAIN','UNKNOWN_OUTCOME'].includes(status))return 'UNCERTAIN';
 if(status==='CANCEL_REQUESTED')return 'STOPPING';
 if(['NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED'].includes(status))return 'NEEDS_INPUT';
 if(status==='ANSWERED')return 'ANSWERED';
 if(status==='EMPTY'||status==='RATE_LIMITED')return status;
 if(['QUEUED','PENDING','ACCEPTED'].includes(status))return 'PENDING';
 if(['CANCELLED','CANCELED','INTERRUPTED'].includes(status))return 'CANCELLED';
 return status==='COMPLETED'?'COMPLETED':'UNKNOWN';
}
function terminal(phase:string){return ['task_completed','task_failed','task_cancelled','mode_stopped'].includes(phase);}
const runLabels:Record<string,string>={RUNNING:'Working',QUEUED:'Work is queued',PENDING:'Work is pending',NEEDS_INPUT:'More information is needed',WAITING_INPUT:'Waiting for your input',BUDGET_EXHAUSTED:'Execution budget reached',CANCEL_REQUESTED:'Stopping',ANSWERED:'Answer ready',COMPLETED:'Task completed',FAILED:'Execution needs attention',DENIED:'Access denied',CANCELLED:'Stopped',INTERRUPTED:'Interrupted'};
export function receiveStarliActivity(event:any){
 if(event?.version==='starli.tool.v1'||event?.version==='starli.run.v1'){
  const binding=assistantActivityBinding(event);
  if(!binding||typeof event.agentId!=='string'||!Object.hasOwn(runLabels,event.type==='run.state'?event.status:'RUNNING'))return;
  if(event.type==='tool.lifecycle'){
   if(!binding.callId||!['running','succeeded','failed','cancelled'].includes(event.status))return;
   if(event.status!=='running'&&!['COMPLETED','QUEUED','PENDING','NEEDS_INPUT','DENIED','FAILED','CANCELLED','INTERRUPTED'].includes(event.resultCode))return;
   event={...binding,agentId:event.agentId,chatId:event.conversationId,taskId:event.taskId,phase:event.status==='running'?'tool_started':'tool_finished',tool:event.publicToolName,toolStatus:event.status==='running'?'RUNNING':publicToolOutcome(event)??event.resultCode,timestamp:event.timestamp};
  }else if(event.type==='run.state'){
   event={...binding,agentId:event.agentId,chatId:event.conversationId,taskId:event.taskId,phase:'run_state',status:event.status,timestamp:event.timestamp};
  }else return;
 }

 if(!event||typeof event.agentId!=='string'||event.agentId.length>180||typeof event.chatId!=='string'||event.chatId.length>180)return;
 const tool=safeToolName(event.tool);
 let phase=String(event.phase||'').slice(0,50);
 let status=activityStatus(event.toolStatus??event.status);
 if(['runtime.task','runtime.primary'].includes(tool)){
  phase=status==='COMPLETED'?'task_completed':status==='CANCELLED'?'task_cancelled':['FAILED','DENIED','UNCERTAIN'].includes(status)?'task_failed':'task_started';
 }
 const labels:Record<string,string>={task_started:'Started the assigned task',task_completed:'Task completed',task_failed:'Task needs attention',task_cancelled:'Task cancelled',working:'Working on the next step',mode_started:'Autonomous work enabled',mode_stopped:'Autonomous work stopped',message_delivered:'Message delivered',steering_received:'Applied your latest instruction'};
 let label=phase==='run_state'?runLabels[event.status]:labels[phase];
 if(phase==='tool_started'){label=toolLabel(tool);status='RUNNING';}
 if(phase==='tool_finished'){
  label=({COMPLETED:'Completed a tool step',EMPTY:'Search returned no results',RATE_LIMITED:'Search was rate limited',FAILED:'A tool step failed',DENIED:'A tool needs permission',UNCERTAIN:'A tool outcome needs checking',PENDING:'A tool step is queued',CANCELLED:'A tool step was cancelled',RUNNING:'A tool is still running',UNKNOWN:'Status unavailable',STOPPING:'Stopping a tool step',NEEDS_INPUT:'A tool needs your input',ANSWERED:'Answer ready'})[status];
 }
 if(!label)return;
 if(phase==='task_completed')status='COMPLETED';
 if(phase==='task_failed')status='FAILED';
 if(phase==='task_cancelled'||phase==='mode_stopped')status='CANCELLED';
 if(phase==='task_started'||phase==='working')status='RUNNING';
 const rawTime=typeof event.timestamp==='number'&&Number.isFinite(event.timestamp)?(event.timestamp<1e12?event.timestamp*1000:event.timestamp):Date.now();
 const timestamp=rawTime>0&&rawTime<Date.now()+86400000?rawTime:Date.now();
 const id=typeof event.id==='string'&&event.id.length<=180?event.id:[event.taskId||event.deliveryId||event.agentId,phase,tool,event.stepsCompleted||'',timestamp].join(':');
 const binding=assistantActivityBinding(event);
 const rowId=binding?[event.chatId,binding.assistantMessageId,binding.runId,binding.callId??'run'].join(':'):id;
 const next:AgentActivity={id:rowId,...(binding??{}),agentId:event.agentId,chatId:event.chatId,phase,label,running:!terminal(phase)&&['RUNNING','PENDING','STOPPING'].includes(status),failed:['FAILED','DENIED','UNCERTAIN'].includes(status),timestamp,taskId:typeof event.taskId==='string'?event.taskId:typeof event.runId==='string'?event.runId:undefined,tool:tool||undefined,status,paths:binding?[]:safeActivityPaths(event)};
 starliActivity.update(values=>{
  const previous=values[next.agentId];
  if(phase==='working'&&previous&&terminal(previous.phase)&&next.taskId&&previous.taskId===next.taskId)return values;
  if(previous&&next.runId&&previous.runId===next.runId&&typeof previous.seq==='number'&&typeof next.seq==='number'&&previous.seq>=next.seq)return values;
  if(previous&&!(next.runId&&previous.runId===next.runId&&typeof previous.seq==='number'&&typeof next.seq==='number')&&(previous.timestamp>next.timestamp||(previous.timestamp===next.timestamp&&terminal(previous.phase)&&!terminal(next.phase))))return values;
  return {...values,[next.agentId]:next};
 });
 // Real runtime heartbeats maintain liveness without inventing tool calls or
 // adding repeated rows to execution history.
 if(phase==='working')return;
 starliActivityFeed.update(rows=>{
  const index=rows.findIndex(v=>v.id===rowId);
  if(index>=0){
   const old=rows[index];
   if(typeof old.seq==='number'&&typeof next.seq==='number'&&old.seq>=next.seq)return rows;
   if(!(typeof old.seq==='number'&&typeof next.seq==='number')&&(old.timestamp>next.timestamp||(['COMPLETED','EMPTY','RATE_LIMITED','FAILED','DENIED','UNCERTAIN','CANCELLED'].includes(old.status)&&['RUNNING','PENDING'].includes(next.status)&&old.runId===next.runId)))return rows;
   const merged={...old,...next,timestamp:Math.max(old.timestamp,next.timestamp),paths:[...new Set([...(old.paths??[]),...next.paths])]};
   return rows.map((v,i)=>i===index?merged:v);
  }
  return [...rows,next].sort((a,b)=>a.timestamp-b.timestamp).slice(-5000);
 });
}
