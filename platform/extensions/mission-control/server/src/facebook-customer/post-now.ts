/**
 * Facebook Pages customer MCP pilot — post-now orchestration only.
 * This module is deliberately NOT mounted in schema/MCP and defaults to OFF.
 * The injected auth/Page/media/provider implementations must be independently
 * reviewed by their assigned owners before integration or external use.
 */
import {createHash, randomUUID} from 'node:crypto';
import type {Store} from '../store.js';

const JOBS='facebook-customer-post-now';
const KEY_LOCKS='facebook-customer-post-now-key-locks';
const AUDIT='facebook-customer-post-now-audit';
const ALLOWED_PAGE_SCOPES=['pages_show_list','pages_read_engagement','pages_manage_posts'];
const ref=(v:string,label:string,max=128)=>{
  if(typeof v!=='string'||v.length<1||v.length>max||!/^[A-Za-z0-9_.:-]+$/.test(v))throw new Error(`INVALID_${label}`);
  return v;
};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const now=()=>new Date().toISOString();
const code=(s:unknown)=>typeof s==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(s)?s:'UNCLASSIFIED_PROVIDER_ERROR';
/**
 * Defense-in-depth only: the *trusted* LCG8 read-only Graph verifier must
 * first prove this is the exact Page's post ID, owner and permalink. Never
 * accept a URL from the MCP customer/tool input or invent one from the ID.
 */
function safeVerifiedFacebookPostUrl(candidate:unknown,postId:string):string|undefined{
  if(typeof candidate!=='string'||candidate.length>2048||!/^\d{1,30}_\d{1,30}$/.test(postId))return undefined;
  try{
    const url=new URL(candidate);
    if(url.protocol!=='https:'||!['facebook.com','www.facebook.com'].includes(url.hostname)||
      url.username||url.password||url.port||url.hash||url.pathname==='/'||url.href.length>2048)return undefined;
    return url.href;
  }catch{return undefined;}
}

/** Construct this identity from a verified customer MCP session, never from tool arguments. */
export interface FacebookCustomerPrincipal {
  tenantId:string;
  userId:string;
  audience:'customer-mcp';
  /** Immutable exact customer command/message, bound to the action by LCG1. */
  commandId:string;
}
export interface FacebookPostNowCommand {
  pageConnectionId:string;
  caption:string;
  /** Immutable opaque media IDs from LCG6, never URLs, local file paths or raw bytes. */
  mediaRefs?:string[];
  idempotencyKey:string;
}
export interface FacebookPageGrant {
  tenantId:string;
  ownerUserId:string;
  connectionId:string;
  pageId:string;
  /** Fresh LCG2 OAuth revision verified against LCG3 persisted selected Page. */
  connectionRevision:string;
  targetType:'PAGE';
  status:'CONNECTED'|'REAUTH_REQUIRED'|'DISCONNECTED';
  tasks:string[];
  scopes:string[];
}
export interface FacebookMediaGrant {
  tenantId:string;
  ownerUserId:string;
  ref:string;
  kind:'IMAGE'|'VIDEO';
  mimeType:string;
  bytes:number;
  sha256:string;
  state:'READY'|'PROCESSING'|'REVOKED';
}
export type FacebookPublishProviderResult =
  |{state:'PUBLISHED';providerPostId:string;providerPostUrl?:string;publishedAt?:string}
  |{state:'NOT_SENT';errorCode:string}
  |{state:'SUBMITTED_UNCONFIRMED';providerOperationRef?:string};
/**
 * Lossy/safe receipt bridge for LCG8's offline Meta Graph adapter.
 * Only a verified public Page post ref is publication proof. A Graph error,
 * auth rejection, media upload ID or missing acknowledgment can follow a
 * committed provider write; all such outcomes remain UNCERTAIN/no replay.
 * An owner-controlled adapter may return NOT_SENT separately only if it proves
 * no Graph write was initiated. This function NEVER infers NOT_SENT.
 */
export function translateFacebookPilotAdapterReceipt(
  receipt:unknown,
  mediaKind:'IMAGE'|'VIDEO'|null,
):FacebookPublishProviderResult {
  if(!receipt||typeof receipt!=='object')return {state:'SUBMITTED_UNCONFIRMED'};
  const r=receipt as {state?:unknown;providerPostRef?:unknown;providerPostUrl?:unknown;errorCode?:unknown};
  const safeRef=typeof r.providerPostRef==='string'&&/^[0-9_]{1,100}$/.test(r.providerPostRef)?r.providerPostRef:undefined;
  if(r.state==='PUBLISHED'&&mediaKind!=='VIDEO'&&safeRef){
    const providerPostUrl=safeVerifiedFacebookPostUrl(r.providerPostUrl,safeRef);
    return {state:'PUBLISHED',providerPostId:safeRef,...(providerPostUrl?{providerPostUrl}:{})};
  }
  return {state:'SUBMITTED_UNCONFIRMED',...(safeRef?{providerOperationRef:safeRef}:{})};
}

export interface FacebookPostNowPorts {
  /** Verify that an actual authenticated command explicitly asked to POST NOW for this exact payload. */
  authorizeExplicitCommand(input:FacebookCustomerPrincipal&{pageConnectionId:string;payloadHash:string}):Promise<boolean>;
  /** Must verify current Page and customer task/permission grants, not caller-supplied page/token. */
  resolvePage(input:{tenantId:string;userId:string;pageConnectionId:string}):Promise<FacebookPageGrant|undefined>;
  /** Must resolve only tenant-scoped READY internal media; no caller URLs or path traversal. */
  resolveMedia(input:{tenantId:string;userId:string;mediaRef:string}):Promise<FacebookMediaGrant|undefined>;
  /** Provider obtains Page tokens and media bytes through separate secure scoped dependencies. */
  provider:{publishNow(input:{tenantId:string;userId:string;page:FacebookPageGrant;caption:string;media:FacebookMediaGrant[];idempotencyKey:string}):Promise<FacebookPublishProviderResult>};
}
export type FacebookPostNowState='PUBLISHED'|'NOT_PUBLISHED'|'UNCERTAIN';
export interface FacebookPostNowReceipt {
  id:string;
  tenantId:string;
  userId:string;
  commandId:string;
  pageConnectionId:string;
  state:FacebookPostNowState;
  providerPostId?:string;
  /** Only populated from an upstream verified same-Page Graph permalink. */
  providerPostUrl?:string;
  providerOperationRef?:string;
  publishedAt?:string;
  errorCode?:string;
  createdAt:string;
  updatedAt:string;
}
interface StoredJob extends Omit<FacebookPostNowReceipt,'state'> {
  state:FacebookPostNowState|'SENDING';
  payloadHash:string;
  idempotencyKeyHash:string;
}
export class FacebookCustomerPostNowService {
  constructor(
    private readonly store:Store,
    private readonly ports:FacebookPostNowPorts,
    private readonly options:{externalWritesEnabled?:boolean}={},
  ){}

  private assertPrincipal(p:FacebookCustomerPrincipal){
    if(!p||p.audience!=='customer-mcp')throw new Error('CUSTOMER_MCP_REQUIRED');
    ref(p.userId,'USER_ID',200);ref(p.tenantId,'TENANT_ID',200);ref(p.commandId,'COMMAND_ID',160);
    // This initial pilot is one tenant per independent StarliDigital customer.
    if(p.tenantId!==p.userId)throw new Error('CUSTOMER_TENANT_MISMATCH');
    const user=this.store.user(p.userId);
    if(!user||user.disabled||!['USER','CUSTOMER'].includes(String(user.role)))throw new Error('CUSTOMER_ACCOUNT_REQUIRED');
  }
  private normalize(command:FacebookPostNowCommand){
    const pageConnectionId=ref(command.pageConnectionId,'PAGE_CONNECTION',160);
    const idempotencyKey=ref(command.idempotencyKey,'IDEMPOTENCY_KEY',160);
    if(idempotencyKey.length<8)throw new Error('IDEMPOTENCY_KEY_TOO_SHORT');
    if(typeof command.caption!=='string')throw new Error('INVALID_CAPTION');
    const caption=command.caption.trim();
    if(caption.length>5000||/\u0000/.test(caption))throw new Error('INVALID_CAPTION');
    if(command.mediaRefs!==undefined&&!Array.isArray(command.mediaRefs))throw new Error('INVALID_MEDIA_REFS');
    const mediaRefs=(command.mediaRefs||[]).map(v=>ref(v,'MEDIA_REF',160));
    if(mediaRefs.length>1||new Set(mediaRefs).size!==mediaRefs.length)throw new Error('INVALID_MEDIA_REFS');
    if(!caption&&!mediaRefs.length)throw new Error('EMPTY_POST');
    return {pageConnectionId,idempotencyKey,caption,mediaRefs};
  }
  private checkPage(p:FacebookCustomerPrincipal,connectionId:string,page:FacebookPageGrant|undefined){
    if(!page||page.tenantId!==p.tenantId||page.ownerUserId!==p.userId||page.connectionId!==connectionId||page.targetType!=='PAGE'||page.status!=='CONNECTED')throw new Error('PAGE_ACCESS_DENIED');
    ref(page.pageId,'PAGE_ID',100);
    ref(page.connectionRevision,'CONNECTION_REVISION',160);
    if(!page.tasks.includes('CREATE_CONTENT')||ALLOWED_PAGE_SCOPES.some(s=>!page.scopes.includes(s)))throw new Error('PAGE_PERMISSION_REQUIRED');
    return page;
  }
  private checkMedia(p:FacebookCustomerPrincipal,mediaRef:string,m:FacebookMediaGrant|undefined){
    if(!m||m.ref!==mediaRef||m.tenantId!==p.tenantId||m.ownerUserId!==p.userId||m.state!=='READY')throw new Error('MEDIA_ACCESS_DENIED');
    if(!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isInteger(m.bytes)||m.bytes<1)throw new Error('INVALID_MEDIA_METADATA');
    if(m.kind==='IMAGE'&&(!['image/jpeg','image/png'].includes(m.mimeType)||m.bytes>8_000_000))throw new Error('INVALID_IMAGE');
    if(m.kind==='VIDEO'&&(m.mimeType!=='video/mp4'||m.bytes>100_000_000))throw new Error('INVALID_VIDEO');
    return m;
  }
  private async preflight(p:FacebookCustomerPrincipal,c:ReturnType<FacebookCustomerPostNowService['normalize']>){
    const page=this.checkPage(p,c.pageConnectionId,await this.ports.resolvePage({tenantId:p.tenantId,userId:p.userId,pageConnectionId:c.pageConnectionId}));
    const media:FacebookMediaGrant[]=[];
    for(const mediaRef of c.mediaRefs){media.push(this.checkMedia(p,mediaRef,await this.ports.resolveMedia({tenantId:p.tenantId,userId:p.userId,mediaRef})));}
    if(media.some(m=>m.kind==='VIDEO')&&(media.length!==1||c.mediaRefs.length!==1))throw new Error('VIDEO_MUST_BE_SINGLE');
    return {page,media};
  }
  private recordId(tenantId:string,commandId:string){return `fbc-now-${hash(`${tenantId}\u0000cmd\u0000${commandId}`)}`;}
  private keyLockId(tenantId:string,key:string){return `fbc-key-${hash(`${tenantId}\u0000key\u0000${key}`)}`;}
  private getStored(tenantId:string,id:string):StoredJob|undefined{
    const found=this.store.get(JOBS,id) as StoredJob|undefined;
    return found?.tenantId===tenantId?found:undefined;
  }
  private receipt(job:StoredJob):FacebookPostNowReceipt{
    const {id,tenantId,userId,commandId,pageConnectionId,providerPostId,providerPostUrl,providerOperationRef,publishedAt,errorCode,createdAt,updatedAt}=job;
    const state=job.state==='SENDING'?'UNCERTAIN':job.state;
    const safeLink=state==='PUBLISHED'?safeVerifiedFacebookPostUrl(providerPostUrl,providerPostId||''):undefined;
    return {id,tenantId,userId,commandId,pageConnectionId,state,providerPostId,...(safeLink?{providerPostUrl:safeLink}:{}),providerOperationRef,publishedAt,errorCode:job.state==='SENDING'?'IN_FLIGHT_OR_LOST_RESULT':errorCode,createdAt,updatedAt};
  }
  private audit(job:StoredJob,action:string){
    this.store.put(AUDIT,{id:`fbc-audit-${randomUUID()}`,tenantId:job.tenantId,userId:job.userId,jobId:job.id,action,state:job.state,createdAt:now()},job.tenantId);
  }
  private finish(job:StoredJob,updates:Partial<StoredJob>):FacebookPostNowReceipt{
    const updated={...job,...updates,updatedAt:now()};
    this.store.put(JOBS,updated,job.tenantId);
    this.audit(updated,updated.state);
    return this.receipt(updated);
  }
  /**
   * Explicit customer POST NOW is its own authorization; never request an
   * additional platform approval. Host/tool confirmation requirements still apply.
   * Durable SENDING row precedes provider work; unknown outcomes MUST NOT replay.
   */
  async publishNow(principal:FacebookCustomerPrincipal,command:FacebookPostNowCommand):Promise<FacebookPostNowReceipt>{
    if(this.options.externalWritesEnabled!==true)throw new Error('FACEBOOK_EXTERNAL_WRITES_DISABLED');
    this.assertPrincipal(principal);
    const c=this.normalize(command);
    const payloadHash=hash(JSON.stringify([principal.commandId,c.pageConnectionId,c.caption,c.mediaRefs]));
    if(await this.ports.authorizeExplicitCommand({...principal,pageConnectionId:c.pageConnectionId,payloadHash})!==true)throw new Error('EXPLICIT_CUSTOMER_COMMAND_REQUIRED');
    const id=this.recordId(principal.tenantId,principal.commandId);
    const keyLockId=this.keyLockId(principal.tenantId,c.idempotencyKey);
    const existingByCommand=this.getStored(principal.tenantId,id);
    if(existingByCommand){
      if(existingByCommand.payloadHash!==payloadHash||existingByCommand.userId!==principal.userId)throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
      return this.receipt(existingByCommand);
    }
    // All local ownership checks must complete BEFORE the durable external attempt.
    const verified=await this.preflight(principal,c);
    const stamp=now();
    const claimed:StoredJob={id,tenantId:principal.tenantId,userId:principal.userId,commandId:principal.commandId,pageConnectionId:c.pageConnectionId,state:'SENDING',payloadHash,idempotencyKeyHash:hash(c.idempotencyKey),createdAt:stamp,updatedAt:stamp};
    // Atomic two-key claim: one immutable customer command can never publish
    // twice even with a newly generated request key, AND one request key cannot
    // be reused to send a different command. SQLite serializes rival processes.
    let claimedHere=false;
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.getStored(principal.tenantId,id);
      if(prior){
        if(prior.payloadHash!==payloadHash||prior.userId!==principal.userId)throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
      }else{
        const keyLock=this.store.get(KEY_LOCKS,keyLockId);
        if(keyLock)throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        this.store.db.prepare('INSERT INTO records(collection,id,owner,payload) VALUES(?,?,?,?)')
          .run(JOBS,id,principal.tenantId,JSON.stringify(claimed));
        this.store.db.prepare('INSERT INTO records(collection,id,owner,payload) VALUES(?,?,?,?)')
          .run(KEY_LOCKS,keyLockId,principal.tenantId,JSON.stringify({id:keyLockId,tenantId:principal.tenantId,jobId:id,payloadHash}));
        claimedHere=true;
      }
      this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    if(!claimedHere){
      const row=this.getStored(principal.tenantId,id);
      if(!row)throw new Error('IDEMPOTENCY_RECORD_UNAVAILABLE');
      return this.receipt(row);
    }
    this.audit(claimed,'CLAIMED');
    // Recheck both Page + media after claiming, immediately before dispatch.
    // A revoked permission/media is known NOT SENT; no provider call occurs.
    let current:{page:FacebookPageGrant;media:FacebookMediaGrant[]};
    try {
      current=await this.preflight(principal,c);
      if(current.page.pageId!==verified.page.pageId||current.page.connectionRevision!==verified.page.connectionRevision||current.media.some((m,i)=>m.sha256!==verified.media[i]?.sha256))throw new Error('PREFLIGHT_CHANGED');
    }catch{
      return this.finish(claimed,{state:'NOT_PUBLISHED',errorCode:'PREFLIGHT_CHANGED'});
    }
    // A USER can be disabled or promoted to ADMIN while async Page/media
    // verification runs. Re-read the actual persisted account immediately
    // before handing control to the provider port; a stale structural
    // principal or a previously authorized command is not live permission.
    try{this.assertPrincipal(principal);}catch{
      return this.finish(claimed,{state:'NOT_PUBLISHED',errorCode:'CUSTOMER_ACCOUNT_REVOKED'});
    }
    try {
      const out=await this.ports.provider.publishNow({tenantId:principal.tenantId,userId:principal.userId,page:current.page,caption:c.caption,media:current.media,idempotencyKey:c.idempotencyKey});
      if(out?.state==='PUBLISHED'&&typeof out.providerPostId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(out.providerPostId)){
        const publishedAt=out.publishedAt&&Number.isFinite(Date.parse(out.publishedAt))?new Date(out.publishedAt).toISOString():undefined;
        const providerPostUrl=out.providerPostId.startsWith(`${current.page.pageId}_`)?
          safeVerifiedFacebookPostUrl(out.providerPostUrl,out.providerPostId):undefined;
        return this.finish(claimed,{state:'PUBLISHED',providerPostId:out.providerPostId,...(providerPostUrl?{providerPostUrl}:{}),publishedAt});
      }
      if(out?.state==='NOT_SENT')return this.finish(claimed,{state:'NOT_PUBLISHED',errorCode:code(out.errorCode)});
      const providerOperationRef=out?.state==='SUBMITTED_UNCONFIRMED'&&out.providerOperationRef&&/^[A-Za-z0-9_.:-]{1,200}$/.test(out.providerOperationRef)?out.providerOperationRef:undefined;
      return this.finish(claimed,{state:'UNCERTAIN',providerOperationRef,errorCode:'PROVIDER_OUTCOME_UNCONFIRMED'});
    }catch{
      // A timeout, network error, process crash, or provider error MAY have
      // published; never retry this idempotency key or claim NOT_PUBLISHED.
      return this.finish(claimed,{state:'UNCERTAIN',errorCode:'PROVIDER_OUTCOME_UNCONFIRMED'});
    }
  }
  /** Read-only, customer-scoped receipt; no provider call and no retry. */
  getReceipt(principal:FacebookCustomerPrincipal,idempotencyKey:string):FacebookPostNowReceipt|undefined{
    this.assertPrincipal(principal);
    const key=ref(idempotencyKey,'IDEMPOTENCY_KEY',160);
    const lock=this.store.get(KEY_LOCKS,this.keyLockId(principal.tenantId,key));
    const row=lock?.tenantId===principal.tenantId?this.getStored(principal.tenantId,String(lock.jobId)):undefined;
    return row&&row.userId===principal.userId?this.receipt(row):undefined;
  }
}
