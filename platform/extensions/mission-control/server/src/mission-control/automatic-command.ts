import type {Store} from '../store.js';
import {createLegacyCommandOutbox} from './legacy-command-outbox.js';

/** Standing device authorization replaces only per-command review. Queuing
 * still requires an authenticated operator; exact target/session is stamped
 * when requested, never inferred later from a reused numeric tab id. */
export function dispatchAutomaticCommand(store:Store,owner:string,id:string,sessionHash:string){
 const dispatch=createLegacyCommandOutbox(store,command=>{
  const device=store.get('browser_bridge_devices',command.deviceId);
  if(device?.automaticSendEnabled!==true)return;
  const user=store.user(owner);
  if(user?.role!=='ADMIN'||user.disabled||!store.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?')
   .get(sessionHash,owner,Date.now()))return;
  const grant=store.db.prepare(`SELECT session_epoch FROM mc_bridge_device_grants WHERE tenant=? AND user_id=? AND device_id=?
   AND session_hash=? AND revoked_at IS NULL AND expires_at>?`).get(owner,owner,command.deviceId,sessionHash,Date.now());
  const tab=store.db.prepare(`SELECT * FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?`)
   .get(owner,command.deviceId,Number(command.sessionId));
  const original=store.get('browser_bridge_commands',id),now=Date.now();
  if(!grant||!tab||!original||tab.session_hash!==sessionHash||tab.session_epoch!==grant.session_epoch||
   tab.session_id!==original.autoRequestedTabSessionId||tab.session_hash!==original.autoRequestedOperatorSessionHash||
   tab.session_epoch!==original.autoRequestedSessionEpoch||tab.expected_url!==command.expectedUrl||
   !['OPERATOR_CONFIRMED','TRUSTED_HOST_VERIFIED'].includes(String(tab.source))||
   !Number.isSafeInteger(tab.verified_at)||Number(tab.verified_at)>now||now-Number(tab.verified_at)>30000)return;
  return {tabId:Number(tab.tab_id),sessionId:String(tab.session_id),expectedUrl:String(tab.expected_url),
   operatorSessionHash:sessionHash,sessionEpoch:Number(tab.session_epoch)};
 });
 return dispatch(owner,id);
}
