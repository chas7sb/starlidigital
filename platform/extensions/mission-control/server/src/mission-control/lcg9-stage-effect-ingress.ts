import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {createLegacyEffectReceiptConsumer,type MissionEffectProof} from './legacy-effect-receipt.js';
import {createIndependentEffectWitnessVerifier} from './lcg9-independent-effect-witness.js';

const path='/mission-control/witness/effect';
const maxBytes=20480;
/**
 * Optional LOOPBACK-ONLY staging receiver. The trusted witness public key is
 * pinned by the host before any requests, not supplied by the requester.
 * A signed, independently observed browser effect is consumed transactionally;
 * neither an HTTP/WSS ACK nor extension self-report is evidence. There is NO
 * production mount, auto-dispatch, public listener, or private signing key.
 */
export function createStageEffectReceiptIngress(store:Store,configuration:{
 witnessPublicKeyPem:string;witnessId:string;
}){
 if(!configuration||typeof configuration!=='object')throw Error('MISSION_EFFECT_STAGE_NOT_CONFIGURED');
 const verify=createIndependentEffectWitnessVerifier(
  configuration.witnessPublicKeyPem,configuration.witnessId);
 // The witness signature proves the external observation, not continued
 // authorization. Re-check the canonical durable tab grant and epoch INSIDE
 // the receipt consumer transaction immediately before one-use consumption.
 const verifyActiveProof=(proof:Readonly<MissionEffectProof>,command:Readonly<Record<string,unknown>>)=>{
  if(!verify(proof,command))return false;
  const db=store.db;
  const has=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if(!has('mc_verified_tab_bindings')||!has('mc_bridge_device_grants'))return false;
  const tab=db.prepare(`SELECT session_id,expected_url,session_hash,session_epoch,source FROM mc_verified_tab_bindings
   WHERE tenant=? AND device_id=? AND tab_id=?`).get(
    proof.ownerId,proof.deviceId,Number(proof.tabId)) as
   {session_id:string;expected_url:string;session_hash:string;session_epoch:number;source:string}|undefined;
  if(!tab||!['TRUSTED_HOST_VERIFIED','OPERATOR_CONFIRMED'].includes(tab.source)||tab.session_id!==proof.sessionId||
   tab.expected_url!==command.expectedUrl||typeof tab.session_hash!=='string'||
   !/^[a-f0-9]{64}$/.test(tab.session_hash)||!Number.isSafeInteger(tab.session_epoch))return false;
  const grant=db.prepare(`SELECT COUNT(*) AS count FROM mc_bridge_device_grants
   WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=? AND session_epoch=?
   AND revoked_at IS NULL AND expires_at>?`).get(
    proof.ownerId,proof.ownerId,proof.deviceId,tab.session_hash,tab.session_epoch,Date.now()) as {count:number};
  return grant.count===1;
 };
 const receive=createLegacyEffectReceiptConsumer(store,verifyActiveProof);
 const respond=(res:ServerResponse,status:number,value:unknown)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(value));return true;
 };
 return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
  if(req.url?.split('?')[0]!==path)return false;
  const remote=req.socket.remoteAddress;
  // No browser calls or credentials; this surface is exclusively for the
  // independent local witness process with its own offline private key.
  if(remote!=='127.0.0.1'&&remote!=='::1'&&remote!=='::ffff:127.0.0.1')
   return respond(res,403,{error:'LOOPBACK_ONLY'});
  if(req.method!=='POST'||req.headers.origin||req.headers.cookie||req.headers.authorization||
   String(req.headers['content-type']??'').split(';')[0]!=='application/json')
   return respond(res,403,{error:'SIGNED_WITNESS_REQUEST_REQUIRED'});
  let size=0;const chunks:Buffer[]=[];
  for await(const part of req){
   const chunk=Buffer.from(part);size+=chunk.length;
   if(size>maxBytes)return respond(res,413,{error:'EFFECT_PROOF_TOO_LARGE'});
   chunks.push(chunk);
  }
  let proof:MissionEffectProof;
  try{proof=JSON.parse(Buffer.concat(chunks).toString('utf8')) as MissionEffectProof;}
  catch{return respond(res,400,{error:'EFFECT_PROOF_INVALID_JSON'});}
  try{
   const verified=receive(proof);
   return respond(res,200,{receiptId:verified.receiptId,commandId:verified.commandId,
    state:'VERIFIED_EFFECT_COMMITTED',status:verified.status,verified:true});
  }catch{
   // Collapse all validation failures (including already-consumed/revoked)
   // to a generic negative so callers cannot probe active command IDs.
   return respond(res,409,{error:'EFFECT_PROOF_REJECTED_OR_ALREADY_CONSUMED'});
  }
 };
}
