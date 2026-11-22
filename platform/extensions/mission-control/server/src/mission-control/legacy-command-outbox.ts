import {randomBytes} from 'node:crypto';
import type {Store} from '../store.js';
import {BrowserEventStore} from './lcg3-browser-transport.js';

const commands='browser_bridge_commands';
type Target={sessionId:string;tabId:number;expectedUrl:string;operatorSessionHash?:string;sessionEpoch?:number};

/** Uses the same SQLite connection as the MCP browser command store. The
 * caller must resolve current operator consent and the enrolled tab inside
 * authorize, synchronously under the transaction. */
export function createLegacyCommandOutbox(store:Store,authorize:(command:Readonly<{
 id:string;ownerId:string;deviceId:string;sessionId:string;expectedUrl:string;text:string;
}>)=>Target|undefined){
 const events=new BrowserEventStore(store.db);
 return (ownerId:string,commandId:string)=>{
  store.db.exec('BEGIN IMMEDIATE');
  try{
   const row=store.get(commands,commandId);
   if(!row||row.ownerId!==ownerId||row.status!=='queued'||row.action!=='send'||
    !/^[a-f0-9]{64}$/.test(commandId)||typeof row.text!=='string'||!row.text.trim()||row.text.length>2000||
    typeof row.expectedUrl!=='string'||!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(row.expectedUrl))
    throw Error('MISSION_CONTROL_COMMAND_UNAVAILABLE');
   if(store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(ownerId))
    throw Error('MISSION_CONTROL_STOPPED');
   const device=store.get('browser_bridge_devices',row.deviceId);
   if(device?.ownerId!==ownerId||device.active!==true||device.sendEnabled!==true||device.transport!=='mission-control')
    throw Error('MISSION_CONTROL_DEVICE_UNAVAILABLE');
   const target=authorize(Object.freeze({id:commandId,ownerId,deviceId:row.deviceId,
    sessionId:row.sessionId,expectedUrl:row.expectedUrl,text:row.text}));
   if(!target||target.expectedUrl!==row.expectedUrl||String(target.tabId)!==row.sessionId||
    !Number.isSafeInteger(target.tabId)||target.tabId<=0||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(target.sessionId))
    throw Error('MISSION_CONTROL_TAB_BINDING_UNVERIFIED');
   const nonce=randomBytes(24).toString('base64url');
   const event=events.publish({tenantId:ownerId,deviceId:row.deviceId,eventId:commandId,kind:'command.offer',
    body:{commandId,nonce,sessionId:target.sessionId,tabId:target.tabId,text:row.text}});
   const at=Date.now();
   // A dispatched row is invisible to legacy HTTP polling. Both changes
   // commit together or neither is visible to another process.
   store.put(commands,{...row,status:'dispatched',dispatchedAt:at,updatedAt:at,
    missionControlNonce:nonce,missionControlSessionId:target.sessionId,
    ...(target.operatorSessionHash?{missionControlOperatorSessionHash:target.operatorSessionHash,
      missionControlSessionEpoch:target.sessionEpoch}: {})},ownerId);
   store.db.exec('COMMIT');
   return event;
  }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
 };
}
