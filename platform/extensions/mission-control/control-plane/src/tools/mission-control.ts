import {z} from 'zod';
import type {ToolContext} from './common.js';
import {errorResponse,jsonResponse} from './common.js';
import {Lcg1MissionRoster,Lcg1RegistryPrincipalAuthority} from '../../../server/src/mission-control/lcg1-agent-registry.js';
import type {MissionRosterId} from '../../../server/src/mission-control/lcg1-agent-registry.js';
import {Lcg2MissionControlQueue} from '../../../server/src/mission-control/lcg2-queue.js';
import {getMissionControlHealth} from '../../../server/src/mission-control/mc-health.js';

const agentId=z.enum(['ULTRA_BOSS','LCG1','LCG2','LCG3','LCG4','LCG5','LCG6','LCG7','LCG8','LCG9','LCG10']);
/** Canonical MCP registration; no browser dispatch, no synthetic completion.
 * Everything uses existing Store.db, including the original command records. */
export function registerMissionControlTools(ctx:ToolContext){
 const {server,principal,store,auditCall}=ctx;
 const allowed=()=>principal.role==='admin'&&(principal.scopes.includes('admin')||principal.scopes.includes('*'));
 const principalId=principal.id;
 const invoke=(name:string,mutation:boolean,fn:()=>unknown)=>{
  const started=Date.now();
  if(!allowed()||!store){
   auditCall(name,undefined,started,'DENIED');
   return errorResponse('Authenticated admin and canonical Store required','DENIED');
  }
  try{
   const value=fn();
   auditCall(name,undefined,started,'SUCCESS',undefined,{mutation});
   return jsonResponse(value);
  }catch(error){
   const reason=error instanceof Error?error.message:'MISSION_CONTROL_UNAVAILABLE';
   auditCall(name,undefined,started,'FAILED',undefined,undefined,reason);
   return errorResponse(reason,'MISSION_CONTROL_DENIED');
  }
 };
 const roster=()=>{
  if(!store)throw Error('MISSION_CONTROL_STORE_UNAVAILABLE');
  const authority=new Lcg1RegistryPrincipalAuthority();
  const actor=authority.issue({tenantId:principalId,subjectId:principalId,operator:true});
  const registry=new Lcg1MissionRoster(store.db,Date.now,authority.verifyOperator);
  return {registry,actor};
 };
 const queue=(fn:(q:Lcg2MissionControlQueue)=>unknown)=>{
  if(!store)throw Error('MISSION_CONTROL_STORE_UNAVAILABLE');
  const data=store.db.prepare('PRAGMA database_list').all() as Array<{name:string;file:string}>;
  const path=data.find(x=>x.name==='main')?.file;
  if(!path||path===':memory:')throw Error('MISSION_CONTROL_DURABLE_WAL_REQUIRED');
  const q=new Lcg2MissionControlQueue(path);
  try{return fn(q);}finally{q.close();}
 };
 server.tool('mission_control_get_health','Fail-closed read-only canonical Mission Control health; UNKNOWN is not execution evidence.',{},async()=>invoke('mission_control_get_health',false,()=>{
  if(!store)throw Error('MISSION_CONTROL_STORE_UNAVAILABLE');
  return getMissionControlHealth(store.db,principalId);
 }));
 server.tool('mission_control_get_agents','Read the persisted tenant-scoped Mission Control roster. Declared status is not proof of browser execution.',{},async()=>invoke('mission_control_get_agents',false,()=>{
  const {registry,actor}=roster();
  return {agents:registry.list(actor),source:'DURABLE_ROSTER',executionEvidence:false};
 }));
 server.tool('mission_control_set_working_status','Declare agent status using exact optimistic revision; never marks external effects complete.',{
  agentId,status:z.enum(['IDLE','WORKING','WAITING','BLOCKED','REVIEW']),epoch:z.number().int().nonnegative(),
  revision:z.number().int().nonnegative(),eventKey:z.string().min(2).max(95)
 },async a=>invoke('mission_control_set_working_status',true,()=>{
  const {registry,actor}=roster();
  return {agent:registry.transition(actor,{agentId:a.agentId,epoch:a.epoch,revision:a.revision,status:a.status,eventKey:a.eventKey}),statusKind:'DECLARED_ONLY'};
 }));
 server.tool('mission_control_get_task','Read one canonical tenant-scoped durable task and its CAS coordination revision.',{
  taskId:z.string().min(1).max(120)
 },async a=>invoke('mission_control_get_task',false,()=>queue(q=>q.getTaskStatus(principalId,a.taskId))));
 server.tool('mission_control_list_tasks','List canonical durable task graph and states; does not dispatch work.',{
  limit:z.number().int().min(1).max(100).default(50)
 },async a=>invoke('mission_control_list_tasks',false,()=>queue(q=>({tasks:q.graph(principalId,a.limit).nodes,summary:q.bossStatus(principalId)}))));
 server.tool('mission_control_assign_task','CAS-assign an existing queued task to a registered tenant agent; no Chrome send.',{
  taskId:z.string().min(1).max(120),agentId,expectedRevision:z.number().int().nonnegative()
 },async a=>invoke('mission_control_assign_task',true,()=>{
  const {registry,actor}=roster();
  const agent=registry.get(actor,a.agentId as MissionRosterId);
  if(!agent||agent.status==='STOPPED')throw Error('MISSION_CONTROL_AGENT_UNAVAILABLE');
  return queue(q=>q.assignTask(principalId,a.taskId,a.agentId,a.expectedRevision));
 }));
 server.tool('mission_control_command_status','Read the existing canonical browser_bridge_commands record. Transport ACK is not execution.',{
  commandId:z.string().regex(/^[a-f0-9]{64}$/)
 },async a=>invoke('mission_control_command_status',false,()=>{
  if(!store)throw Error('MISSION_CONTROL_STORE_UNAVAILABLE');
  const r=store.get('browser_bridge_commands',a.commandId);
  if(!r||r.ownerId!==principalId)throw Error('MISSION_CONTROL_COMMAND_NOT_FOUND');
  return {commandId:r.id,status:r.status,deviceId:r.deviceId,updatedAt:r.updatedAt??r.createdAt,
   result:r.status==='done'||r.status==='failed'?r.result:undefined,
   executionVerified:false,transportAcknowledgementIsExecution:false};
 }));
}
