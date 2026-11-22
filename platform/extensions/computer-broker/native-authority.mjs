/** Fixed native authority SDK. Caller supplies private service keys and a fixed local sender.
 * No browser/provider bearer, URL, header or command arguments are forwarded. */
import {createHmac,timingSafeEqual,randomBytes,createHash,sign as edSign,verify as edVerify} from 'node:crypto';
import {digest} from './company-note-jobs.mjs';
const canonical=v=>{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class SignedNativeChannel{
 constructor(key,clock=()=>Date.now()/1000){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('PRIVATE_COMPANY_KEY_REQUIRED');this.key=key;this.clock=clock}
 sign(purpose,payload){const message={purpose,payload,issued:Math.floor(this.clock()),nonce:randomBytes(16).toString('hex')};return {message,mac:createHmac('sha256',this.key).update(digest(message)).digest('hex')}}
 read(purpose,envelope){const m=envelope?.message;if(!m||Object.keys(envelope).sort().join()!=='mac,message'||Object.keys(m).sort().join()!=='issued,nonce,payload,purpose'||m.purpose!==purpose||!Number.isSafeInteger(m.issued)||this.clock()-m.issued>35||m.issued-this.clock()>3||!/^[a-f0-9]{32}$/.test(m.nonce)||!equal(envelope.mac,createHmac('sha256',this.key).update(digest(m)).digest('hex')))throw Error('NATIVE_SIGNATURE_DENIED');return m.payload}
}
export function nativeHooks({channel,send,verifyPhysical}){
 return {
  verifySubmission:envelope=>channel.read('submit',envelope),
  async authorize(job,phase,receipt){
   if(phase==='verify-physical-receipt'&&await verifyPhysical(job,receipt)!==true)return false;
   const payload={operationId:job.operationId,jobDigest:digest(job),phase,nonce:randomBytes(16).toString('hex')};
   const envelope=channel.sign('job.authorize',payload);
   const reply=await send('/internal/company-computer/job-authority',envelope);
   const ack=channel.read('job.authorize.reply',reply);
   return ack?.request===digest(envelope)&&canonical(ack.result)===canonical({...payload,authorized:true});
  },
  async resolveBinding(job){
   const payload={operationId:job.operationId,jobDigest:digest(job),phase:'binding',nonce:randomBytes(16).toString('hex')};
   const envelope=channel.sign('job.authorize',payload);
   const reply=await send('/internal/company-computer/job-authority',envelope);
   const ack=channel.read('job.authorize.reply',reply);
   if(ack?.request!==digest(envelope)||!ack.result?.scope)throw Error('NATIVE_BINDING_DENIED');
   const {scope,...binding}=ack.result;if(canonical(binding)!==canonical({...payload,authorized:true}))throw Error('NATIVE_BINDING_DENIED');
   return scope;
  }
 }
}
export function verifyEnrolledPhysical(job,receipt,enrollments){
 try{
  const raw=receipt.physicalReceipt,token=receipt.signedPhysicalReceipt;
  const fields=['state','company_id','actor_id','bot_id','room_id','run_id','assistant_message_id','tool_call_id','viewer_id','operation_id','computer_id','epoch','noteSha256','frameSha256','frame_receipt'];
  if(!raw||Object.keys(raw).sort().join()!==fields.sort().join()||typeof token!=='string'||token.length>8192)return false;
  const [body,sig,...extra]=token.split('.');if(extra.length||!body||!sig)return false;
  const signed=JSON.parse(Buffer.from(body,'base64url').toString());
  const enrolled=enrollments.get(signed.kid);
  if(!enrolled||enrolled.company!==job.companyId||enrolled.computer!==job.computerId||enrolled.key.length<32)return false;
  if(!equal(sig,createHmac('sha256',enrolled.key).update(body).digest('base64url')))return false;
  if(Object.keys(signed).sort().join()!==['aud','kid','clientNonce','requestDigest','resultDigest'].sort().join()||signed.aud!=='starli-company-response-v3'||signed.resultDigest!==digest(raw)||receipt.physicalReceiptDigest!==digest(raw))return false;
  const mapping={companyId:'company_id',computerId:'computer_id',actorUserId:'actor_id',botId:'bot_id',roomId:'room_id',runId:'run_id',assistantMessageId:'assistant_message_id',toolCallId:'tool_call_id',operationId:'operation_id',noteSha256:'noteSha256'};
  for(const [a,b]of Object.entries(mapping))if(raw[b]!==job[a])return false;
  if(raw.state!=='DISPLAYED'||!Number.isSafeInteger(raw.epoch)||raw.epoch<1||raw.epoch!==receipt.epoch||raw.viewer_id!==receipt.viewerId||raw.frameSha256!==receipt.frameSha256||typeof raw.frame_receipt!=='string'||!/^[a-f0-9]{64}$/.test(raw.frame_receipt))return false;
  return true;
 }catch{return false}
}

export function workerReplySigner(privateKey,kid){
 return (_principal,payload)=>{
  const message={purpose:'worker.reply',payload,issued:Math.floor(Date.now()/1000),nonce:randomBytes(16).toString('hex')};
  return {kid,message,signature:edSign(null,Buffer.from(canonical(message)),privateKey).toString('base64url')};
 };
}
export function verifyWorkerReply(envelope,publicKeys,{nonce,requestDigest,requestAgeMs}){
 try{
  if(!envelope||Object.keys(envelope).sort().join()!=='kid,message,signature')return false;
  const {message:m,kid,signature}=envelope,key=publicKeys.get(kid);
  if(!key||!m||Object.keys(m).sort().join()!=='issued,nonce,payload,purpose'||m.purpose!=='worker.reply'||!Number.isSafeInteger(m.issued)||!Number.isFinite(requestAgeMs)||requestAgeMs<0||requestAgeMs>20000||!/^[a-f0-9]{32}$/.test(m.nonce))return false;
  if(!edVerify(null,Buffer.from(canonical(m)),key,Buffer.from(signature,'base64url')))return false;
  return m.payload?.nonce===nonce&&m.payload?.requestDigest===requestDigest;
 }catch{return false}
}

export class PendingWorkerReplies{
 constructor(clock=()=>performance.now()){this.clock=clock;this.pending=new Map()}
 begin(message){
  if(!message||!/^[a-f0-9]{32}$/.test(message.nonce)||this.pending.has(message.nonce)||this.pending.size>=32)throw Error('PENDING_REQUEST_LIMIT');
  this.pending.set(message.nonce,{started:this.clock(),requestDigest:digest(message)});
 }
 accept(envelope,keys){
  const nonce=envelope?.message?.payload?.nonce,p=this.pending.get(nonce);if(!p)return false;
  this.pending.delete(nonce); // consume once, even on invalid reply
  return verifyWorkerReply(envelope,keys,{nonce,requestDigest:p.requestDigest,requestAgeMs:this.clock()-p.started});
 }
}

export function publisherIdentitySigner(privateKey,kid){
 return (_principal,payload)=>{
  const message={purpose:'publisher.identity',payload,issued:Math.floor(Date.now()/1000),nonce:randomBytes(16).toString('hex')};
  return {kid,message,signature:edSign(null,Buffer.from(canonical(message)),privateKey).toString('base64url')};
 };
}
