import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {MissionEffectProof} from './legacy-effect-receipt.js';

/**
 * Offline proof-verification contract. A separately authorized browser witness
 * must hold the PRIVATE signing key, observe the actual submitted user bubble,
 * and independently attest the exact tab, conversation and command content.
 * Neither the MCP host nor the extension ACK may mint this evidence.
 * IMPORTANT: This factory does NOT install a receipt ingress or sign evidence.
 */
export type WitnessObservation={
 kind:'CHATGPT_SUBMITTED_USER_MESSAGE_VISIBLE';
 witnessId:string;observedAtMs:number;conversationUrl:string;textSha256:string;
 signature:string;
};
const canonical=(proof:Readonly<MissionEffectProof>,observation:WitnessObservation)=>
 JSON.stringify(['MISSION_CONTROL_EFFECT_WITNESS_V1',proof.receiptId,proof.commandId,
  proof.ownerId,proof.deviceId,proof.tabId,proof.sessionId,proof.nonce,
  proof.status,observation.kind,observation.witnessId,observation.observedAtMs,
  observation.conversationUrl,observation.textSha256]);

export function createIndependentEffectWitnessVerifier(
 trustedPublicKeyPem:string,expectedWitnessId:string,now:()=>number=Date.now,
): (proof:Readonly<MissionEffectProof>,command:Readonly<Record<string,unknown>>)=>boolean{
 let key:KeyObject;
 if(typeof trustedPublicKeyPem!=='string'||typeof expectedWitnessId!=='string'||
  !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(expectedWitnessId))
  throw Error('MISSION_WITNESS_TRUST_CONFIGURATION_REQUIRED');
 try{key=createPublicKey(trustedPublicKeyPem);}catch{throw Error('MISSION_WITNESS_KEY_INVALID');}
 if(key.asymmetricKeyType!=='ed25519')throw Error('MISSION_WITNESS_ED25519_REQUIRED');
 return (proof,command)=>{
  try{
   if(proof.status!=='done'||!command||command.action!=='send'||
    typeof command.text!=='string'||typeof command.expectedUrl!=='string'||
    !/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{8,128}$/.test(command.expectedUrl))return false;
   const o=proof.result as WitnessObservation|undefined;
   if(!o||typeof o!=='object'||Array.isArray(o)||
    o.kind!=='CHATGPT_SUBMITTED_USER_MESSAGE_VISIBLE'||o.witnessId!==expectedWitnessId||
    o.conversationUrl!==command.expectedUrl||typeof o.textSha256!=='string'||
    !/^[a-f0-9]{64}$/.test(o.textSha256)||
    o.textSha256!==createHash('sha256').update(command.text).digest('hex')||
    !Number.isSafeInteger(o.observedAtMs)||typeof o.signature!=='string'||
    !/^[A-Za-z0-9_-]{86}$/.test(o.signature))return false;
   const time=now();
   if(!Number.isSafeInteger(time)||time<o.observedAtMs||time-o.observedAtMs>300000||
    !Number.isSafeInteger(command.dispatchedAt)||
    o.observedAtMs<(command.dispatchedAt as number))return false;
   const signature=Buffer.from(o.signature,'base64url');
   return signature.length===64&&verify(null,Buffer.from(canonical(proof,o)),key,signature);
  }catch{return false;}
 };
}
// Test fixture may construct this exact canonical representation for offline
// signature validation. No signing private key is ever required by host runtime.
export const missionEffectWitnessCanonical=canonical;
