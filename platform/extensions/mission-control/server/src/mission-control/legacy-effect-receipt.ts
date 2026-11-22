import type {Store} from '../store.js';

export type MissionEffectProof={
 receiptId:string;commandId:string;ownerId:string;deviceId:string;
 tabId:string;sessionId:string;nonce:string;
 status:'done'|'failed'|'uncertain';result:unknown;
};
/** A trusted server-side receiver must attest actual browser effect provenance.
 * NEVER call from a bare transport ACK or unverified model/client payload. */
export function createLegacyEffectReceiptConsumer(store:Store,verifyProof:
 (proof:Readonly<MissionEffectProof>,command:Readonly<Record<string,unknown>>)=>boolean){
 if(typeof verifyProof!=='function')throw Error('MISSION_EFFECT_VERIFIER_REQUIRED');
 store.db.exec(`CREATE TABLE IF NOT EXISTS mc_verified_effect_receipts(
  receipt_id TEXT PRIMARY KEY,command_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,device_id TEXT NOT NULL,status TEXT NOT NULL,
  consumed_at INTEGER NOT NULL
 );`);
 return (proof:MissionEffectProof)=>{
  if(!proof||!/^[A-Za-z0-9_.:-]{8,128}$/.test(proof.receiptId)||
   !/^[a-f0-9]{64}$/.test(proof.commandId)||
   !/^[A-Za-z0-9_.:-]{1,128}$/.test(proof.ownerId)||
   !/^[A-Za-z0-9_.:-]{1,128}$/.test(proof.deviceId)||
   !/^[0-9]{1,12}$/.test(proof.tabId)||
   !/^[A-Za-z0-9_.:-]{8,128}$/.test(proof.sessionId)||
   !/^[A-Za-z0-9_-]{32}$/.test(proof.nonce)||
   !['done','failed','uncertain'].includes(proof.status))throw Error('MISSION_EFFECT_PROOF_INVALID');
  const serialized=JSON.stringify(proof.result??null);
  if(!serialized||Buffer.byteLength(serialized)>16000)throw Error('MISSION_EFFECT_RESULT_INVALID');
  store.db.exec('BEGIN IMMEDIATE');
  try{
   const row=store.get('browser_bridge_commands',proof.commandId);
   if(!row||row.ownerId!==proof.ownerId||row.deviceId!==proof.deviceId||
    row.sessionId!==proof.tabId||row.missionControlSessionId!==proof.sessionId||
    row.missionControlNonce!==proof.nonce||row.status!=='dispatched')
    throw Error('MISSION_EFFECT_COMMAND_FENCE');
   // Missing shared STOP schema must fail closed.
   if(!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get())
    throw Error('MISSION_EFFECT_STOP_STORE_MISSING');
   if(store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(proof.ownerId))
    throw Error('MISSION_EFFECT_TENANT_STOPPED');
   const device=store.get('browser_bridge_devices',proof.deviceId);
   if(!device||device.ownerId!==proof.ownerId||device.active!==true||
    device.transport!=='mission-control'||device.sendEnabled!==true)
    throw Error('MISSION_EFFECT_DEVICE_REVOKED');
   // Fail closed on absent Mission Control grant store. A signature attests
   // observation, never continued right to finalize after device revocation.
   if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_bridge_device_grants'").get())
    throw Error('MISSION_EFFECT_GRANT_STORE_MISSING');
   const grant=store.db.prepare(`SELECT COUNT(*) AS count FROM mc_bridge_device_grants
    WHERE tenant=? AND user_id=? AND device_id=?
    AND revoked_at IS NULL AND expires_at>?`).get(
     proof.ownerId,proof.ownerId,proof.deviceId,Date.now()) as {count:number};
   if(grant.count!==1)throw Error('MISSION_EFFECT_GRANT_REVOKED');
   if(verifyProof(Object.freeze({...proof,result:JSON.parse(serialized)}),Object.freeze({...row}))!==true)
    throw Error('MISSION_EFFECT_UNVERIFIED');
   const timestamp=Date.now();
   store.db.prepare('INSERT INTO mc_verified_effect_receipts VALUES(?,?,?,?,?,?)')
    .run(proof.receiptId,proof.commandId,proof.ownerId,proof.deviceId,proof.status,timestamp);
   store.put('browser_bridge_commands',{...row,status:proof.status,result:JSON.parse(serialized),updatedAt:timestamp,
    missionControlVerifiedReceiptId:proof.receiptId},proof.ownerId);
   store.db.exec('COMMIT');
   return {commandId:proof.commandId,status:proof.status,receiptId:proof.receiptId,verified:true};
  }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
 };
}
