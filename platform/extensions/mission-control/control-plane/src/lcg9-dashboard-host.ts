import type {IncomingMessage,ServerResponse} from "node:http";
import type {Store} from "../../server/src/store.js";
import {refresh,sessionContext} from "../../server/src/security.js";
import {createMissionControlHandler,type ReadStore,type AgentState,type JobState} from "../../server/src/mission-control/lcg7-dashboard-read-api.js";

/** Read-only host adapter to the SAME durable Store.db used by the MCP bridge.
 * No synthetic socket/device receipts, no controls, no browser send capability.
 * Missing durable schemas are errors, never interpreted as healthy empty data.
 */
export function createReadOnlyMissionControlDashboard(store:Store){
 const db=store.db;
 const required=(...tables:string[])=>{
  for(const table of tables){
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type=\x27table\x27 AND name=?").get(table))
    throw Error("MISSION_CONTROL_DURABLE_READ_UNAVAILABLE");
  }
 };
 const read:ReadStore={
  agents:(tenantId)=>{
   required("lcg1_roster");
   const rows=db.prepare("SELECT agentId,status,heartbeatAt,sessionEpoch FROM lcg1_roster WHERE tenantId=? ORDER BY agentId LIMIT 11").all(tenantId);
   const allowed=new Set(["IDLE","STARTING","BUSY","PAUSED","DONE","FAILED","UNKNOWN","WAITING_FOR_USER"]);
   return rows.map(row=>({id:String(row.agentId),tenantId,name:String(row.agentId),
    state:(allowed.has(String(row.status))?String(row.status):"UNKNOWN") as AgentState,
    lastHeartbeat:Number(row.heartbeatAt)>0?new Date(Number(row.heartbeatAt)).toISOString():null,
    epoch:Number(row.sessionEpoch),paused:String(row.status)==="STOPPED"}));
  },
  tasks:(tenantId)=>{
   required("mc_tasks");
   const rows=db.prepare("SELECT id,title,state,assigned_worker,updated_at,lease_until FROM mc_tasks WHERE tenant=? ORDER BY created_at DESC LIMIT 100").all(tenantId);
   const allowed=new Set(["QUEUED","CLAIMED","RUNNING","BLOCKED","DONE","FAILED","UNKNOWN"]);
   return rows.map(row=>({id:String(row.id),tenantId,title:String(row.title),
    state:(allowed.has(String(row.state))?String(row.state):"UNKNOWN") as JobState,
    assignedTo:row.assigned_worker==null?undefined:String(row.assigned_worker),
    updatedAt:new Date(Number(row.updated_at)).toISOString(),
    leaseExpiresAt:row.lease_until==null?undefined:new Date(Number(row.lease_until)).toISOString()}));
  },
  history:(tenantId,after,limit)=>{
   required("mc_events");
   const rows=db.prepare("SELECT seq,task_id,kind,actor,detail,at_ms FROM mc_events WHERE tenant=? AND seq>? ORDER BY seq ASC LIMIT ?").all(tenantId,after,limit);
   return rows.map(row=>({seq:Number(row.seq),tenantId,time:new Date(Number(row.at_ms)).toISOString(),
    agentId:String(row.actor),kind:String(row.kind),text:String(row.kind),taskId:String(row.task_id),
    evidence:undefined}));
  }
 };
 const handle=createMissionControlHandler({
  store:read,
  authenticate:(req:IncomingMessage)=>{
   // Deliberately refuse bearer/operator-token authentication on this browser page.
   // The existing first-party session MUST still be valid on every request.
   if(req.headers.authorization)return null;
   const ctx=refresh(sessionContext(store,String(req.headers.cookie??"")));
   if(!ctx.user||ctx.user.disabled||ctx.user.role!=="ADMIN"||!ctx.sessionHash||ctx.operatorTokenId)return null;
   const id=String(ctx.user.id);
   if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(id))return null;
   return {tenantId:id,userId:id,roles:["MISSION_CONTROL_READ"]};
  },
 });
 return (req:IncomingMessage,res:ServerResponse)=>handle(req,res);
}
