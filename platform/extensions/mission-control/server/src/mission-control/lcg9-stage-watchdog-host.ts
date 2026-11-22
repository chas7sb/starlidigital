import type {Store} from "../store.js";
import {WatchdogModel,startTrustedWatchdogStopMonitor} from "./lcg6-watchdog.js";

/** Isolated staging WSS host; never dispatches an effect.
 * Uses the same durable WAL connection as the authenticated bridge. With the
 * staging bridge exposing only a whole-fleet close, any STOP/revoke closes ALL
 * local sockets, not just the affected tenant; never fail open.
 */
export function startStageWatchdogHost(store:Store,closeAllSockets:()=>void){
 if(typeof closeAllSockets!=="function")throw Error("MC_STAGE_CLOSE_CALLBACK_REQUIRED");
 const db=store.db;
 const exists=(table:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type=\x27table\x27 AND name=?").get(table);
 const tenantIds=()=>{
  if(!exists("mc_tenant_stop")||!exists("mc_bridge_device_grants"))throw Error("MC_STAGE_FLEET_STORE_UNAVAILABLE");
  const rows=db.prepare(`SELECT tenant FROM mc_tenant_stop UNION
   SELECT tenant FROM mc_bridge_device_grants ORDER BY tenant`).all() as Array<{tenant:string}>;
  return rows.map(row=>String(row.tenant));
 };
 const watchdog=new WatchdogModel();
 watchdog.attachTrustedFleetReader((tenantId)=>{
  if(!exists("mc_tenant_stop")||!exists("mc_bridge_device_grants"))throw Error("MC_STAGE_FLEET_STORE_UNAVAILABLE");
  const stopped=db.prepare("SELECT at_ms FROM mc_tenant_stop WHERE tenant=?").get(tenantId) as {at_ms:number}|undefined;
  const grants=db.prepare(`SELECT COUNT(*) AS total,
   SUM(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END) AS active,
   MAX(COALESCE(revoked_at,0)) AS latestRevocation
   FROM mc_bridge_device_grants WHERE tenant=?`).get(Date.now(),tenantId) as
   {total:number;active:number|null;latestRevocation:number|null};
  if(!stopped&&grants.total===0)throw Error("MC_STAGE_UNKNOWN_TENANT");
  // Timestamp-based fence may only advance. The model refuses rollback; STOP
  // itself latches independently, regardless of generation value.
  const generation=Math.max(0,Number(stopped?.at_ms??0),Number(grants.latestRevocation??0));
  if(!Number.isSafeInteger(generation))throw Error("MC_STAGE_INVALID_GENERATION");
  // With no per-device socket-close primitive, ANY revoked or expired grant
  // fences the whole tenant and closes the staged bridge fleet. Never keep
  // a revoked device socket alive because another grant remains active.
  return {tenantId,generation,stopped:!!stopped,
   revoked:grants.total>0&&Number(grants.active??0)<grants.total};
 });
 const monitor=startTrustedWatchdogStopMonitor({watchdog,tenantIds,
  // Conservative stage closure: no per-tenant transport capability exists yet.
  closeTenantSockets:()=>closeAllSockets(),closeAllSockets,intervalMs:1000});
 monitor.poll();
 return {poll:monitor.poll,close:monitor.close};
}
