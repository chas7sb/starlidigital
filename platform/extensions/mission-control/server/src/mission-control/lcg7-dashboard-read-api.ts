import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {URL} from 'node:url';

export type AgentState='IDLE'|'STARTING'|'BUSY'|'PAUSED'|'DONE'|'FAILED'|'UNKNOWN'|'WAITING_FOR_USER';
export type JobState='QUEUED'|'CLAIMED'|'RUNNING'|'BLOCKED'|'DONE'|'FAILED'|'UNKNOWN';
export type RotationPhase='NONE'|'REQUESTED'|'CHECKPOINTED'|'AWAITING_NEW_SESSION'|'ACKNOWLEDGED'|'UNKNOWN'|'BLOCKED';
export type RotationSnapshot={phase:RotationPhase;sessionEpoch:number;checkpointId?:string;
 requestedAt?:string;acknowledgedAt?:string;newSessionId?:string;lastError?:string;
 nextStep?:string;checkpointSha?:string;requiresManualRecovery?:boolean;};
export type ContinuityCheckpoint={agentId:string;tenantId:string;sessionEpoch:number;objective:string;
 updatedAt:string;ownedFiles?:string[];commitSha?:string;tests?:string;blockers?:string[];
 nextStep?:string;sessionId?:string;status?:string;};
export type ManualRecoveryRequest={tenantId:string;agentId:string;action:'REQUEST_RECOVERY';
 sessionEpoch:number;requestedBy:string;requestId:string;checkpointId?:string;};
export type ManualRecoveryResult='PENDING_APPROVAL'|'CONFLICT'|'DENIED';
export type AgentSnapshot={
 id:string;tenantId:string;name:string;state:AgentState;lastHeartbeat:string|null;
 taskId?:string;blockers?:string[];notes?:string[];evidence?:string[];
 paused?:boolean;epoch:number;rotation?:RotationSnapshot;
};
export type TaskSnapshot={
 id:string;tenantId:string;title:string;state:JobState;assignedTo?:string;
 blocker?:string;updatedAt:string;leaseExpiresAt?:string;
};
export type HistoryEvent={
 seq:number;tenantId:string;time:string;agentId:string;kind:string;
 text:string;taskId?:string;evidence?:string;
};
// These projections must be backed by the EXISTING durable bridge/MCP command stores.
 // A transport ACK is not an execution or provider-delivery receipt.
export type DeviceTabSnapshot={tenantId:string;deviceId:string;tabId:string;agentId?:string;
 conversationId?:string;lastSeenAt?:string;connected:boolean;bridge:'MCP_BROWSER'|'MISSION_CONTROL';
 sessionEpoch?:number;};
export type CommandSnapshot={tenantId:string;commandId:string;agentId?:string;deviceId?:string;
 tabId?:string;state:'QUEUED'|'OFFERED'|'ACKED'|'WAITING_FOR_USER'|'SUCCEEDED'|'FAILED'|'UNKNOWN';
 createdAt:string;updatedAt?:string;};
export type ReceiptSnapshot={tenantId:string;receiptId:string;commandId:string;deviceId?:string;
 tabId?:string;kind:'TRANSPORT_ACK'|'USER_APPROVAL'|'EXECUTION'|'UNKNOWN';
 status:string;createdAt:string;};
export type OperationalSnapshot={devices:DeviceTabSnapshot[];commands:CommandSnapshot[];receipts:ReceiptSnapshot[]};
export type ReadStore={
 agents:(tenantId:string)=>AgentSnapshot[];
 tasks:(tenantId:string)=>TaskSnapshot[];
 history:(tenantId:string,after:number,limit:number)=>HistoryEvent[];
 checkpoints?:(tenantId:string)=>ContinuityCheckpoint[];
 // Optional only for legacy callers. NEVER synthesize devices, commands, receipts from bridge ACKs.
 // Integration MUST read the same durable tenant-scoped source as browser_bridge_commands
 // and /mission-control/bridge, then supply an atomic snapshot or leave status UNAVAILABLE.
 operational?:(tenantId:string)=>OperationalSnapshot;
};
export type Actor={tenantId:string;userId:string;roles:readonly string[]};
export type ControlRequest={tenantId:string;agentId:string;action:'PAUSE'|'RESUME';expectedEpoch:number;requestedBy:string;requestId:string};
export type DashboardDeps={
 store:ReadStore;
 authenticate:(req:IncomingMessage)=>Promise<Actor|null>|Actor|null;
 proposeControl?:(request:ControlRequest)=>Promise<'PENDING_APPROVAL'|'CONFLICT'|'DENIED'>;
 proposeManualRecovery?:(request:ManualRecoveryRequest)=>Promise<ManualRecoveryResult>;
 // Host-owned, session-bound anti-CSRF verification. The caller's manual header is NOT a CSRF proof.
 verifyMutation?:(req:IncomingMessage,actor:Actor)=>Promise<boolean>|boolean;
};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
const bounded=(v:unknown,max=320)=>typeof v==='string'?v.slice(0,max):'';
const textList=(v:unknown,max=6)=>Array.isArray(v)?v.slice(0,max).map(x=>bounded(x)).filter(Boolean):[];
const allowedStates=new Set(['IDLE','STARTING','BUSY','PAUSED','DONE','FAILED','UNKNOWN','WAITING_FOR_USER']);
const rotationPhases=new Set(['NONE','REQUESTED','CHECKPOINTED','AWAITING_NEW_SESSION','ACKNOWLEDGED','UNKNOWN','BLOCKED']);
const allowedJobs=new Set(['QUEUED','CLAIMED','RUNNING','BLOCKED','DONE','FAILED','UNKNOWN']);
function projectAgent(a:AgentSnapshot){
 return {id:a.id,name:bounded(a.name,100),state:allowedStates.has(a.state)?a.state:'UNKNOWN',
  heartbeat:a.lastHeartbeat,taskId:a.taskId??null,blockers:textList(a.blockers),notes:textList(a.notes),
  evidence:textList(a.evidence,8),paused:a.paused===true,epoch:a.epoch,
  rotation:a.rotation?{
   phase:rotationPhases.has(a.rotation.phase)?a.rotation.phase:'UNKNOWN',
   sessionEpoch:a.rotation.sessionEpoch,checkpointId:bounded(a.rotation.checkpointId,120),
   requestedAt:bounded(a.rotation.requestedAt,60),acknowledgedAt:bounded(a.rotation.acknowledgedAt,60),
   lastError:bounded(a.rotation.lastError),nextStep:bounded(a.rotation.nextStep),
   checkpointSha:bounded(a.rotation.checkpointSha,64),
   requiresManualRecovery:a.rotation.requiresManualRecovery===true
  }:null};
}
function projectTask(t:TaskSnapshot){
 return {id:t.id,title:bounded(t.title),state:allowedJobs.has(t.state)?t.state:'UNKNOWN',
  assignedTo:t.assignedTo??null,blocker:bounded(t.blocker),updatedAt:t.updatedAt,leaseExpiresAt:t.leaseExpiresAt??null};
}
const projectCheckpoint=(c:ContinuityCheckpoint)=>({
 agentId:c.agentId,sessionEpoch:c.sessionEpoch,objective:bounded(c.objective,600),
 updatedAt:bounded(c.updatedAt,60),ownedFiles:textList(c.ownedFiles,20),
 commitSha:bounded(c.commitSha,64),tests:bounded(c.tests,240),
 blockers:textList(c.blockers,12),nextStep:bounded(c.nextStep,600),
 status:bounded(c.status,60)
});
const sanitizeEvent=(e:HistoryEvent)=>({seq:e.seq,time:e.time,agentId:e.agentId,kind:bounded(e.kind,60),
 text:bounded(e.text,500),taskId:e.taskId??null,evidence:bounded(e.evidence,250)});
const projectDevice=(d:DeviceTabSnapshot)=>({
 deviceId:bounded(d.deviceId,120),tabId:bounded(d.tabId,120),agentId:bounded(d.agentId,120),
 conversationId:bounded(d.conversationId,120),lastSeenAt:bounded(d.lastSeenAt,60),
 connected:d.connected===true,bridge:d.bridge==='MCP_BROWSER'?'MCP_BROWSER':'MISSION_CONTROL',
 sessionEpoch:Number.isSafeInteger(d.sessionEpoch)&&d.sessionEpoch!>=0?d.sessionEpoch:null
});
const projectCommand=(c:CommandSnapshot,executionReceipts:readonly ReceiptSnapshot[])=>({
 commandId:bounded(c.commandId,120),agentId:bounded(c.agentId,120),deviceId:bounded(c.deviceId,120),
 tabId:bounded(c.tabId,120),
 // A legacy/WS ACK or manual-copy receipt NEVER certifies effect success.
 // Require a correlated execution receipt from the authoritative operational snapshot.
 state:c.state==='SUCCEEDED'&&!executionReceipts.some(r=>
    r.commandId===c.commandId&&r.kind==='EXECUTION'&&r.status==='SUCCEEDED'&&
    (!c.deviceId||r.deviceId===c.deviceId)&&(!c.tabId||r.tabId===c.tabId))?'UNKNOWN':
  ['QUEUED','OFFERED','ACKED','WAITING_FOR_USER','SUCCEEDED','FAILED','UNKNOWN']
   .includes(c.state)?c.state:'UNKNOWN',
 createdAt:bounded(c.createdAt,60),updatedAt:bounded(c.updatedAt,60)
});
const projectReceipt=(r:ReceiptSnapshot)=>({
 receiptId:bounded(r.receiptId,120),commandId:bounded(r.commandId,120),
 deviceId:bounded(r.deviceId,120),tabId:bounded(r.tabId,120),
 kind:['TRANSPORT_ACK','USER_APPROVAL','EXECUTION'].includes(r.kind)?r.kind:'UNKNOWN',
 status:bounded(r.status,100),createdAt:bounded(r.createdAt,60)
});
const write=(res:ServerResponse,status:number,data:unknown,extra:Record<string,string>={})=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra});
 res.end(JSON.stringify(data));
};
const readBody=async(req:IncomingMessage,max=2048)=>{
 let raw='';for await(const chunk of req){raw+=chunk.toString();if(raw.length>max)throw Error('TOO_LARGE');}
 return JSON.parse(raw);
};
export const dashboardHtml=()=>`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>StarliDigital · Mission Control</title><style>
:root{color-scheme:dark;font:14px system-ui;background:#090b12;color:#f1f4fc}
body{max-width:1200px;margin:auto;padding:32px}h1{font-size:28px}h2{font-size:18px}
header{display:flex;justify-content:space-between;align-items:center}small{color:#a4afc8}
section{margin:22px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}
article{border:1px solid #33415a;background:#131a29;border-radius:12px;padding:16px;overflow-wrap:anywhere}
button{background:#242f48;color:#e9f1fc;border:1px solid #56729e;padding:7px 12px;border-radius:7px;cursor:pointer}
button:disabled{opacity:.4;cursor:not-allowed}.state{color:#90ddff}.warn{color:#ffc378}
ul{padding-left:18px}#error{color:#ffc378}#history{white-space:pre-wrap}
</style></head><body><header><div><h1>StarliDigital Mission Control</h1>
<small>Read-only agent telemetry · actions require explicit operator approval</small></div><div><span id="connection" role="status">HTTP telemetry: awaiting first poll (not WSS)</span> <span id="updated">Loading…</span></div></header>
<p id="error" role="alert"></p><section><h2>Boss + LCG1–10</h2><div class="grid" id="agents"></div></section>
<section><h2>Tasks and blockers</h2><div class="grid" id="tasks"></div></section>
<section><h2>Context continuity / rotation</h2><div class="grid" id="rotation"></div></section>
<section><h2>Device / tab mapping and durable commands</h2>
<div id="operations-status" role="status">Operator durable read: unavailable</div>
<div class="grid" id="devices"></div><div class="grid" id="commands"></div><div class="grid" id="receipts"></div></section>
<section><h2>History</h2><div id="history"></div></section>
<script src="/mission-control/dashboard.js" defer></script></body></html>`;
export const dashboardJs=()=>`const el=id=>document.getElementById(id);
const set=(node,value)=>{node.textContent=String(value??'');};
const item=(name,text)=>{const li=document.createElement('li');li.textContent=name+': '+text;return li;};
const card=()=>{const a=document.createElement('article');return a;};
function line(node,text){const p=document.createElement('p');set(p,text);node.append(p);}
// One-shot per rendered session: an unknown HTTP outcome must never create a second request ID.
const attemptedProposals=new Set();
let lastEpoch=new Map();
let dashboardGeneration=0;
let dashboardConnected=false;
async function refresh(){
 const generation=++dashboardGeneration;
 dashboardConnected=false;
 try{
 const response=await fetch('/mission-control/api/dashboard',{credentials:'same-origin',cache:'no-store'});
 if(generation!==dashboardGeneration)return;
 if(!response.ok)throw Error('Dashboard access denied or unavailable ('+response.status+')');
 const data=await response.json();
 if(generation!==dashboardGeneration)return;
 // Do not expose active controls or a healthy banner until history also completes.
 dashboardConnected=false;el('error').textContent='';
 el('agents').replaceChildren();lastEpoch=new Map();
 for(const a of data.agents){
  const box=card();const h=document.createElement('h3');set(h,a.name+' · '+a.state);box.append(h);
  line(box,'Last heartbeat: '+(a.heartbeat||'No heartbeat'));
  line(box,'Task: '+(a.taskId||'None'));
  for(const label of ['blockers','notes','evidence']){const h4=document.createElement('h4');set(h4,label);box.append(h4);
   const ul=document.createElement('ul');for(const value of a[label])ul.append(item('',value));box.append(ul);}
  const action=a.paused?'RESUME':'PAUSE';const button=document.createElement('button');
  const proposalKey='control:'+a.id+':'+a.epoch+':'+action;
  const waitingForUser=a.state==='WAITING_FOR_USER';
  const manualRecoveryRequired=a.state==='UNKNOWN'||
    a.rotation?.phase==='UNKNOWN'||a.rotation?.phase==='BLOCKED'||
    a.rotation?.requiresManualRecovery===true;
  const resumeBlocked=action==='RESUME'&&(waitingForUser||manualRecoveryRequired);
  if(waitingForUser)line(box,'Approval / input needed: waiting for user response; manual recovery and resume cannot bypass it.');
  else if(manualRecoveryRequired)line(box,'Manual recovery required: unknown session cannot be resumed directly.');
  set(button,action+' request');button.disabled=!data.canControl||
    resumeBlocked||attemptedProposals.has(proposalKey);
  button.addEventListener('click',async()=>{
   if(!dashboardConnected||generation!==dashboardGeneration||!data.canControl||
      attemptedProposals.has(proposalKey)||resumeBlocked)return;
   if(!confirm('Request '+action.toLowerCase()+' for '+a.name+'? This does not override worker safety gates.'))return;
   attemptedProposals.add(proposalKey);button.disabled=true;
   try{
    const result=await fetch('/mission-control/api/control-request',{method:'POST',credentials:'same-origin',
     headers:{'Content-Type':'application/json','X-Mission-Control-Intent':'manual'},
     body:JSON.stringify({agentId:a.id,action,expectedEpoch:a.epoch,requestId:crypto.randomUUID()})});
    if(!result.ok)throw Error('Not accepted: '+result.status);
    await refresh();
   }catch(e){set(el('error'),'Proposal outcome UNKNOWN; inspect durable history before retry: '+String(e));}
  });box.append(button);el('agents').append(box);
 }
 el('rotation').replaceChildren();
 for(const a of data.agents){
  const box=card();const h=document.createElement('h3');set(h,a.name);box.append(h);
  const rotation=a.rotation;
  line(box,'Rotation: '+(rotation?.phase||'NOT REPORTED'));
  line(box,'Session epoch: '+(rotation?.sessionEpoch??'UNKNOWN'));
  if(rotation?.checkpointId)line(box,'Checkpoint: '+rotation.checkpointId);
  if(rotation?.checkpointSha)line(box,'Checkpoint SHA: '+rotation.checkpointSha);
  if(rotation?.nextStep)line(box,'Next: '+rotation.nextStep);
  if(rotation?.lastError)line(box,'Error: '+rotation.lastError);
  const c=data.checkpoints.find(c=>c.agentId===a.id);
  if(c){line(box,'Objective: '+c.objective);line(box,'Checkpoint updated: '+c.updatedAt);
    if(c.tests)line(box,'Tests: '+c.tests);if(c.commitSha)line(box,'Commit: '+c.commitSha);
    if(c.nextStep)line(box,'Next step: '+c.nextStep);}
  const blocked=a.state!=='WAITING_FOR_USER'&&
    (a.state==='UNKNOWN'||rotation?.requiresManualRecovery===true||
    rotation?.phase==='UNKNOWN'||rotation?.phase==='BLOCKED');
  const recoveryKey='recovery:'+a.id+':'+(rotation?.sessionEpoch??'none');
  const recovery=document.createElement('button');set(recovery,'Request manual recovery');
  recovery.disabled=!data.canRecover||!blocked||!rotation||!Number.isSafeInteger(rotation.sessionEpoch)||
    attemptedProposals.has(recoveryKey);
  recovery.addEventListener('click',async()=>{
   if(!dashboardConnected||generation!==dashboardGeneration||
      !data.canRecover||!blocked||!rotation||!Number.isSafeInteger(rotation.sessionEpoch)||
      attemptedProposals.has(recoveryKey))return;
   if(!confirm('Request a fenced recovery review for '+a.name+'? This will NOT send or auto-continue.'))return;
   attemptedProposals.add(recoveryKey);recovery.disabled=true;
   try{const response=await fetch('/mission-control/api/recovery-request',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-Mission-Control-Intent':'manual'},
    body:JSON.stringify({agentId:a.id,sessionEpoch:rotation.sessionEpoch,
      checkpointId:rotation.checkpointId||undefined,requestId:crypto.randomUUID()})});
    if(!response.ok)throw Error('Recovery request refused: '+response.status);
    const outcome=await response.json();set(el('error'),'Recovery '+outcome.status+' — separate approval required');
   }catch(e){set(el('error'),'Recovery outcome UNKNOWN; inspect durable history before retry: '+String(e));}
  });box.append(recovery);el('rotation').append(box);
 }
 el('devices').replaceChildren();el('commands').replaceChildren();el('receipts').replaceChildren();
 const operational=data.operational;
 set(el('operations-status'),operational?.status==='DURABLE'?
  'Durable tenant-scoped read (not proof of execution)':'Operator durable read: unavailable');
 if(operational?.status==='DURABLE'){
  for(const d of operational.devices){
   const box=card();line(box,'Device '+d.deviceId+' · tab '+d.tabId);
   line(box,'Agent '+(d.agentId||'Unmapped')+' · '+d.bridge);
   line(box,'Connected: '+(d.connected?'reported':'not reported')+' · last seen '+(d.lastSeenAt||'Unknown'));
   el('devices').append(box);
  }
  for(const c of operational.commands){
   const box=card();line(box,'Command '+c.commandId+' · '+c.state);
   line(box,'Agent '+(c.agentId||'Unmapped')+' · tab '+(c.tabId||'Unknown'));
   if(c.state==='ACKED')line(box,'Transport ACK only — execution unverified');
   el('commands').append(box);
  }
  for(const r of operational.receipts){
   const box=card();line(box,'Receipt '+r.receiptId+' · '+r.kind);
   line(box,'Command '+r.commandId+' · '+r.status);
   if(r.kind==='TRANSPORT_ACK')line(box,'Transport-only receipt — NOT execution success');
   el('receipts').append(box);
  }
 }
 el('tasks').replaceChildren();
 for(const t of data.tasks){const box=card();const h=document.createElement('h3');set(h,t.title);box.append(h);
  line(box,t.state+' · '+(t.assignedTo||'Unassigned'));if(t.blocker)line(box,'Blocked: '+t.blocker);
  line(box,'Updated: '+t.updatedAt);el('tasks').append(box);}
 const history=await fetch('/mission-control/api/history?after=0&limit=50',{credentials:'same-origin',cache:'no-store'});
 if(generation!==dashboardGeneration)return;
 if(!history.ok)throw Error('History telemetry unavailable ('+history.status+')');
 const events=await history.json();if(generation!==dashboardGeneration)return;
 const list=document.createElement('ul');
 for(const event of events.events){list.append(item(event.time+' '+event.agentId+' '+event.kind,event.text));}
 el('history').replaceChildren(list);
 dashboardConnected=true;
 set(el('connection'),'HTTP telemetry: polling OK (not WSS)');
 set(el('updated'),'Updated '+new Date().toLocaleTimeString());
 }catch(e){if(generation!==dashboardGeneration)return;
  dashboardConnected=false;
  for(const id of ['agents','rotation','tasks','history','devices','commands','receipts'])el(id).replaceChildren();
  set(el('operations-status'),'Operator durable read: unavailable');
  set(el('error'),String(e));set(el('connection'),'HTTP telemetry: disconnected (not WSS)');
  set(el('updated'),'Disconnected · HTTP retry pending');}
}
refresh();setInterval(refresh,15000);`;
export function createMissionControlHandler(deps:DashboardDeps){
 return async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   const actor=await deps.authenticate(req);
   if(!actor || !validId(actor.tenantId) || !validId(actor.userId))return write(res,401,{error:'UNAUTHENTICATED'});
   const isOperator=actor.roles.includes('MISSION_CONTROL_OPERATOR');
   const isReader=isOperator||actor.roles.includes('MISSION_CONTROL_READ');
   if(!isReader)return write(res,403,{error:'FORBIDDEN'});
   const u=new URL(req.url??'/', 'http://localhost');
   if(req.method==='GET'&&u.pathname==='/mission-control'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
     'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
     'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"});
    return res.end(dashboardHtml());
   }
   if(req.method==='GET'&&u.pathname==='/mission-control/dashboard.js'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',
     'X-Content-Type-Options':'nosniff'});
    return res.end(dashboardJs());
   }
   if(req.method==='GET'&&u.pathname==='/mission-control/api/dashboard'){
    // This is deliberately operator-only: tab/session, commands and receipts expose
    // control-plane metadata beyond the standard read-only tenant dashboard.
    const operational=isOperator&&deps.store.operational?
      deps.store.operational(actor.tenantId):null;
    if(operational&&(!Array.isArray(operational.devices)||!Array.isArray(operational.commands)||
      !Array.isArray(operational.receipts)))throw Error('INVALID_DURABLE_SNAPSHOT');
    const tenantReceipts=operational?.receipts.filter(r=>r.tenantId===actor.tenantId)??[];
    // Only server-attested durable receipt rows can certify an effect.
    // Command identity alone does not bind a different tab/device execution.
    const executionReceipts=tenantReceipts.filter(r=>r.kind==='EXECUTION'&&
      r.status==='SUCCEEDED'&&validId(r.commandId));
    return write(res,200,{operational:operational?{
      status:'DURABLE',
      devices:operational.devices.filter(d=>d.tenantId===actor.tenantId).slice(0,100).map(projectDevice),
      commands:operational.commands.filter(c=>c.tenantId===actor.tenantId).slice(0,100)
        .map(c=>projectCommand(c,executionReceipts)),
      receipts:tenantReceipts.slice(0,100).map(projectReceipt)
    }:{status:'UNAVAILABLE',devices:[],commands:[],receipts:[]},agents:deps.store.agents(actor.tenantId).filter(a=>a.tenantId===actor.tenantId).map(projectAgent),
     tasks:deps.store.tasks(actor.tenantId).filter(t=>t.tenantId===actor.tenantId).map(projectTask),
     canControl:isOperator&&!!deps.proposeControl&&!!deps.verifyMutation,
     canRecover:isOperator&&!!deps.proposeManualRecovery&&!!deps.verifyMutation,
     checkpoints:(deps.store.checkpoints?.(actor.tenantId)??[])
      .filter(c=>c.tenantId===actor.tenantId).map(projectCheckpoint)});
   }
   if(req.method==='GET'&&u.pathname==='/mission-control/api/history'){
    const after=Number(u.searchParams.get('after')??0),limit=Number(u.searchParams.get('limit')??50);
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
      return write(res,400,{error:'INVALID_CURSOR'});
    return write(res,200,{events:deps.store.history(actor.tenantId,after,limit)
      .filter(e=>e.tenantId===actor.tenantId&&e.seq>after).slice(0,limit).map(sanitizeEvent)});
   }
   if(req.method==='POST'&&u.pathname==='/mission-control/api/recovery-request'){
    if(!isOperator||!deps.proposeManualRecovery||!deps.verifyMutation)return write(res,403,{error:'OPERATOR_APPROVAL_REQUIRED'});
    if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`)
      return write(res,403,{error:'ORIGIN_MISMATCH'});
    if(req.headers['x-mission-control-intent']!=='manual'||
       !String(req.headers['content-type']).startsWith('application/json'))
      return write(res,403,{error:'MANUAL_INTENT_REQUIRED'});
    if(!await deps.verifyMutation(req,actor))return write(res,403,{error:'CSRF_DENIED'});
    const raw=await readBody(req);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||
       !validId(raw.agentId)||!validId(raw.requestId)||
       !Number.isSafeInteger(raw.sessionEpoch)||raw.sessionEpoch<0||
       (raw.checkpointId!==undefined&&!validId(raw.checkpointId)))
      return write(res,400,{error:'INVALID_REQUEST'});
    const target=deps.store.agents(actor.tenantId).find(a=>a.tenantId===actor.tenantId&&a.id===raw.agentId);
    if(!target)return write(res,404,{error:'NOT_FOUND'});
    const rotation=target.rotation;
    if(!rotation||rotation.sessionEpoch!==raw.sessionEpoch||
       (raw.checkpointId!==undefined&&raw.checkpointId!==rotation.checkpointId))
      return write(res,409,{error:'STALE_SESSION_EPOCH'});
    // WAITING_FOR_USER is an explicit human-input barrier, not a stale-session condition.
    // A rotation flag must never authorize an operator to bypass the user's response.
    if(target.state==='WAITING_FOR_USER')
      return write(res,409,{error:'USER_INPUT_REQUIRED'});
    if(!(target.state==='UNKNOWN'||rotation.requiresManualRecovery===true||
       rotation.phase==='UNKNOWN'||rotation.phase==='BLOCKED'))
      return write(res,409,{error:'RECOVERY_NOT_REQUIRED'});
    // Re-verify session-bound CSRF after body await and immediately before proposing.
    if(!await deps.verifyMutation(req,actor))return write(res,403,{error:'CSRF_DENIED'});
    // LCG5/LCG2 own approval, lease fencing and deduplication. This endpoint ONLY proposes review.
    const result=await deps.proposeManualRecovery({
     tenantId:actor.tenantId,agentId:target.id,action:'REQUEST_RECOVERY',
     sessionEpoch:rotation.sessionEpoch,requestedBy:actor.userId,requestId:raw.requestId,
     ...(raw.checkpointId?{checkpointId:raw.checkpointId}:{})
    });
    return write(res,result==='PENDING_APPROVAL'?202:result==='CONFLICT'?409:403,{status:result});
   }
   if(req.method==='POST'&&u.pathname==='/mission-control/api/control-request'){
    if(!isOperator||!deps.proposeControl||!deps.verifyMutation)return write(res,403,{error:'OPERATOR_APPROVAL_REQUIRED'});
    if(req.headers.origin && req.headers.origin!==`https://${req.headers.host}`)
      return write(res,403,{error:'ORIGIN_MISMATCH'});
    if(req.headers['x-mission-control-intent']!=='manual'||!String(req.headers['content-type']).startsWith('application/json'))
      return write(res,403,{error:'MANUAL_INTENT_REQUIRED'});
    if(!await deps.verifyMutation(req,actor))return write(res,403,{error:'CSRF_DENIED'});
    const raw=await readBody(req);
    if(!raw||typeof raw!=='object'||!validId(raw.agentId)||!validId(raw.requestId)||
       !['PAUSE','RESUME'].includes(raw.action)||!Number.isSafeInteger(raw.expectedEpoch)||raw.expectedEpoch<0)
      return write(res,400,{error:'INVALID_REQUEST'});
    const target=deps.store.agents(actor.tenantId).find(a=>a.tenantId===actor.tenantId&&a.id===raw.agentId);
    if(!target)return write(res,404,{error:'NOT_FOUND'});
    if(target.epoch!==raw.expectedEpoch)return write(res,409,{error:'STALE_EPOCH'});
    if(target.state==='WAITING_FOR_USER'&&raw.action==='RESUME')
      return write(res,409,{error:'USER_INPUT_REQUIRED'});
    if(raw.action==='RESUME'&&(target.state==='UNKNOWN'||
       target.rotation?.phase==='UNKNOWN'||target.rotation?.phase==='BLOCKED'||
       target.rotation?.requiresManualRecovery===true))
      return write(res,409,{error:'MANUAL_RECOVERY_REQUIRED'});
    // Re-verify session-bound CSRF after body await and immediately before proposing.
    if(!await deps.verifyMutation(req,actor))return write(res,403,{error:'CSRF_DENIED'});
    // The server-side control adapter must require its own operator approval, fencing and idempotency.
    const result=await deps.proposeControl({tenantId:actor.tenantId,agentId:target.id,
     action:raw.action,expectedEpoch:target.epoch,requestedBy:actor.userId,requestId:raw.requestId});
    return write(res,result==='PENDING_APPROVAL'?202:result==='CONFLICT'?409:403,{status:result});
   }
   return write(res,404,{error:'NOT_FOUND'});
  }catch{return write(res,400,{error:'INVALID_REQUEST'});}
 };
}
export function createMissionControlLocalServer(deps:DashboardDeps){return createServer(createMissionControlHandler(deps));}
