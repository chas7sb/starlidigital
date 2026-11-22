/** Offline-safe, resumable customer MCP image transport. No HTTP route or provider side effects. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import type {Store} from '../store.js';
import {
  FACEBOOK_IMAGE_MAX_BYTES,
  FACEBOOK_PUBLISH_MAX_BYTES,
  FacebookCustomerMediaError,
  type CustomerFacebookImageReceipt,
  type CustomerFacebookImageUpload,
  FacebookCustomerMediaService,
} from './service.js';

/** 262144 raw bytes expand to at most 349528 base64 characters per customer tool call. */
export const FACEBOOK_UPLOAD_CHUNK_BYTES = 256 * 1024; // Legacy internal-only default
export const FACEBOOK_UPLOAD_MAX_PARTS = FACEBOOK_IMAGE_MAX_BYTES / FACEBOOK_UPLOAD_CHUNK_BYTES;
/** A 64KiB chunk is <=87384 base64 characters, inside LCG1's 128KiB MCP body cap. */
export const FACEBOOK_UPLOAD_MCP_CHUNK_BYTES = 64 * 1024;
export const FACEBOOK_UPLOAD_MCP_MAX_PARTS = FACEBOOK_IMAGE_MAX_BYTES / FACEBOOK_UPLOAD_MCP_CHUNK_BYTES;
export const FACEBOOK_UPLOAD_TTL_MS = 30 * 60 * 1000;
export const FACEBOOK_UPLOAD_MAX_ACTIVE_PER_TENANT = 4;
const COLLECTION = 'facebook-customer-chunked-image-sessions';
const REF = /^fbup-[a-f0-9]{32}$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA = /^[a-f0-9]{64}$/;
type ImageMime = CustomerFacebookImageUpload['contentType'];
type OriginClaim = CustomerFacebookImageUpload['originClaim'];
type State = 'UPLOADING' | 'FINALIZING' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
interface Session {
  id:string; uploadRef:string; ownerId:string; tenantId:string; subjectId:string;
  idempotencyKey:string; contentType:ImageMime; originClaim?:OriginClaim;
  sha256:string; totalBytes:number; receivedBytes:number;chunkBytes?:number;
  parts: {sha256:string;bytes:number}[];
  state:State; createdAt:string;expiresAt:number;mediaRef?:string;
}
const deny=(code:FacebookCustomerMediaError['code'],message:string):never=>{throw new FacebookCustomerMediaError(code,message);};
const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
function safeDir(dir:string,create:boolean):void {
  if(create)fs.mkdirSync(dir,{recursive:true,mode:0o700});
  try{
    const stat=fs.lstatSync(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||fs.realpathSync(dir)!==path.resolve(dir))deny('MEDIA_CORRUPT','Untrusted private upload directory');
  }catch(error){if(error instanceof FacebookCustomerMediaError)throw error;deny('MEDIA_CORRUPT','Private upload directory unavailable');}
}
function strictBase64(input:unknown,maxBytes:number):Buffer {
  const maxEncoded=Math.ceil(maxBytes/3)*4;
  if(typeof input!=='string'||!input.length||input.length%4!==0||input.length>maxEncoded||!/^[A-Za-z0-9+/]+={0,2}$/.test(input))deny('INVALID_MEDIA','Expected bounded canonical base64 image chunk');
  const text=input as string;
  const bytes=Buffer.from(text,'base64');
  if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64')!==text)deny('INVALID_MEDIA','Invalid canonical image chunk');
  return bytes;
}
export type StartFacebookImageUpload = {
  /** Caller-set stable request key, scoped to server-verified tenant+subject. */
  idempotencyKey:string;
  contentType:ImageMime;
  totalBytes:number;
  /** Lowercase full SHA256, from original bytes; verified at completion. */
  sha256:string;
  originClaim?:OriginClaim;
  /** Safe fixed chunk mode selected at START; absent = historical 256KiB. */
  chunkBytes?:typeof FACEBOOK_UPLOAD_CHUNK_BYTES|typeof FACEBOOK_UPLOAD_MCP_CHUNK_BYTES;
};
export type FacebookImageUploadProgress={
  uploadRef:string;state:'UPLOADING'|'COMPLETED';receivedBytes:number;partsReceived:number;
  totalBytes:number;chunkBytes:number;expiresAt:string;mediaRef?:string;
};

/** All methods revalidate customer Bearer credentials through the existing secure image service.
 * Only LCG10's separately protected customer tool adapter may call this class.
 * Never mount this class behind the existing admin /mcp router.
 */
export class FacebookCustomerImageChunkService {
  private readonly root:string;
  constructor(private readonly options:{
    store:Store;
    media:FacebookCustomerMediaService;
    /** Explicit persistent private root; service account owns it, never an external URL or user path. */
    storageRoot:string;
    clock?:()=>number;
  }){
    if(!options.store||!options.media||typeof options.storageRoot!=='string'||!path.isAbsolute(options.storageRoot))throw new Error('Persistent absolute private upload root required');
    this.root=path.resolve(options.storageRoot);
  }
  private now(){return this.options.clock?.()??Date.now();}
  private chunkSize(record:{chunkBytes?:number}){return record.chunkBytes??FACEBOOK_UPLOAD_CHUNK_BYTES;}
  private principal(credential:unknown){return this.options.media.verifyUploadPrincipal(credential);}
  private dir(tenantId:string,create:boolean):string{
    safeDir(this.root,create);
    const dir=path.join(this.root,digest(`facebook-image-upload-tenant\0${tenantId}`));
    safeDir(dir,create);return dir;
  }
  private file(session:Session,create=false):string{
    if(!REF.test(session.uploadRef))deny('MEDIA_CORRUPT','Invalid private upload reference');
    return path.join(this.dir(session.tenantId,create),`${session.uploadRef}.part`);
  }
  private record(credential:unknown,uploadRef:unknown):Session {
    const who=this.principal(credential);
    if(typeof uploadRef!=='string'||!REF.test(uploadRef))deny('MEDIA_NOT_FOUND','Customer upload not found');
    const ref=uploadRef as string;
    const record=this.options.store.get(COLLECTION,ref) as Session|undefined;
    if(!record||record.id!==uploadRef||record.uploadRef!==uploadRef||record.ownerId!==who.tenantId||record.tenantId!==who.tenantId||record.subjectId!==who.subjectId||!['UPLOADING','FINALIZING','COMPLETED','CANCELLED','REJECTED','EXPIRED'].includes(record.state)||!SHA.test(record.sha256)||!Number.isSafeInteger(record.totalBytes)||record.totalBytes<1||record.totalBytes>FACEBOOK_IMAGE_MAX_BYTES||!Array.isArray(record.parts)||!Number.isSafeInteger(record.receivedBytes)||record.receivedBytes<0||record.receivedBytes>record.totalBytes||![FACEBOOK_UPLOAD_CHUNK_BYTES,FACEBOOK_UPLOAD_MCP_CHUNK_BYTES].includes(this.chunkSize(record))||record.parts.length>Math.ceil(record.totalBytes/this.chunkSize(record)))deny('MEDIA_NOT_FOUND','Customer upload not found');
    return record as Session;
  }
  /** LCG10 customer POST upload tool MAY act only on its own 64KiB, PNG/JPEG
   * <=8,000,000-byte sessions. A private library's 256KiB/WebP/8MiB session
   * must never be upgraded into a publish-ready MCP transfer by opaque ID.
   */
  assertFacebookPostToolSession(credential:unknown,uploadRef:string):void {
    const r=this.record(credential,uploadRef);
    if(this.chunkSize(r)!==FACEBOOK_UPLOAD_MCP_CHUNK_BYTES ||
       (r.contentType!=='image/png'&&r.contentType!=='image/jpeg') ||
       r.totalBytes>FACEBOOK_PUBLISH_MAX_BYTES)
      deny('MEDIA_NOT_FOUND','Customer Facebook upload session not found');
  }
  private progress(r:Session):FacebookImageUploadProgress{
    return{uploadRef:r.uploadRef,state:r.state==='COMPLETED'?'COMPLETED':'UPLOADING',receivedBytes:r.receivedBytes,partsReceived:r.parts.length,totalBytes:r.totalBytes,chunkBytes:this.chunkSize(r),expiresAt:new Date(r.expiresAt).toISOString(),...(r.state==='COMPLETED'&&r.mediaRef?{mediaRef:r.mediaRef}:{})};
  }
  private active(r:Session){if(r.state!=='UPLOADING'||r.expiresAt<=this.now())deny('MEDIA_NOT_FOUND','Customer upload unavailable or expired');}
  private readVerified(r:Session):Buffer{
    let fd:number|undefined;
    try{
      const name=this.file(r),stat=fs.lstatSync(name);
      if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size!==r.receivedBytes||fs.realpathSync(name)!==name)deny('MEDIA_CORRUPT','Upload file integrity failure');
      fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      if(fs.fstatSync(fd).size!==r.receivedBytes)deny('MEDIA_CORRUPT','Upload file integrity failure');
      const bytes=fs.readFileSync(fd);
      if(bytes.length!==r.receivedBytes)deny('MEDIA_CORRUPT','Upload file integrity failure');
      let offset=0;
      for(const part of r.parts){
        if(!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>this.chunkSize(r)||!SHA.test(part.sha256)||offset+part.bytes>bytes.length||digest(bytes.subarray(offset,offset+part.bytes))!==part.sha256)deny('MEDIA_CORRUPT','Upload chunk integrity failure');
        offset+=part.bytes;
      }
      if(offset!==bytes.length)deny('MEDIA_CORRUPT','Upload chunk list integrity failure');
      return bytes;
    }catch(error){if(error instanceof FacebookCustomerMediaError)throw error;return deny('MEDIA_CORRUPT','Customer upload unavailable or unsafe');}
    finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  /** Tenant-scoped expired staging cleanup; safe to call by a protected customer tool. */
  cleanupExpired(credential:unknown):number {
    const who=this.principal(credential);
    const db=this.options.store.db;
    let inTx=false,removed=0;
    try{
      db.exec('BEGIN IMMEDIATE');inTx=true;
      for(const row of this.options.store.list(COLLECTION,who.tenantId) as Session[]){
        if(row.tenantId!==who.tenantId||row.ownerId!==who.tenantId||row.subjectId!==who.subjectId||!REF.test(row.uploadRef)||row.state!=='UPLOADING'||row.expiresAt>this.now())continue;
        // Unlink only a server-derived path, never a persisted client path. A symlink
        // itself can be unlinked without traversing its target.
        const filename=this.file(row);
        try{fs.unlinkSync(filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        this.options.store.put(COLLECTION,{...row,state:'EXPIRED'},who.tenantId);
        removed++;
      }
      db.exec('COMMIT');inTx=false;
      return removed;
    }catch(error){if(inTx)try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  /** START creates a durable scoped session; same tenant/user/key/metadata retries return same reference. */
  start(credential:unknown,input:StartFacebookImageUpload):FacebookImageUploadProgress {
    const who=this.principal(credential);
    this.cleanupExpired(credential);
    if(!input||typeof input!=='object'||!IDEMPOTENCY.test(input.idempotencyKey)||!['image/png','image/jpeg','image/webp'].includes(input.contentType)||!Number.isSafeInteger(input.totalBytes)||input.totalBytes<1||input.totalBytes>FACEBOOK_IMAGE_MAX_BYTES||!SHA.test(input.sha256)||(input.chunkBytes!==undefined && ![FACEBOOK_UPLOAD_CHUNK_BYTES,FACEBOOK_UPLOAD_MCP_CHUNK_BYTES].includes(input.chunkBytes))||(input.originClaim!==undefined&&!['CHATGPT_GENERATED','USER_UPLOADED'].includes(input.originClaim)))deny('INVALID_MEDIA','Invalid bounded upload metadata');
    const sessionId=`fbup-${digest(`${who.tenantId}\0${who.subjectId}\0${input.idempotencyKey}`).slice(0,32)}`;
    const db=this.options.store.db;
    let inTx=false,createdFile:string|undefined;
    try{
      db.exec('BEGIN IMMEDIATE');inTx=true;
      const existing=this.options.store.get(COLLECTION,sessionId) as Session|undefined;
      if(existing){
        const r=this.record(credential,sessionId);
        if(r.idempotencyKey!==input.idempotencyKey||r.contentType!==input.contentType||r.totalBytes!==input.totalBytes||r.sha256!==input.sha256||(r.originClaim??'USER_UPLOADED')!==(input.originClaim??'USER_UPLOADED')||this.chunkSize(r)!==(input.chunkBytes??FACEBOOK_UPLOAD_CHUNK_BYTES))deny('IDEMPOTENCY_CONFLICT','Upload request key already used for different media');
        if(r.state==='COMPLETED'&&r.mediaRef){this.options.media.getReceipt(credential,r.mediaRef);db.exec('COMMIT');inTx=false;return this.progress(r);}
        this.active(r);this.readVerified(r);
        db.exec('COMMIT');inTx=false;
        return this.progress(r);
      }
      const sessions=this.options.store.list(COLLECTION,who.tenantId) as Session[];
      if(sessions.filter(r=>r.state==='FINALIZING'||(r.state==='UPLOADING'&&r.expiresAt>this.now())).length>=FACEBOOK_UPLOAD_MAX_ACTIVE_PER_TENANT)deny('LIMIT_EXCEEDED','Too many active customer uploads');
      const timestamp=this.now();
      const r:Session={id:sessionId,uploadRef:sessionId,ownerId:who.tenantId,tenantId:who.tenantId,subjectId:who.subjectId,idempotencyKey:input.idempotencyKey,contentType:input.contentType,sha256:input.sha256,totalBytes:input.totalBytes,receivedBytes:0,parts:[],state:'UPLOADING',createdAt:new Date(timestamp).toISOString(),expiresAt:timestamp+FACEBOOK_UPLOAD_TTL_MS,originClaim:input.originClaim??'USER_UPLOADED',...(input.chunkBytes&&input.chunkBytes!==FACEBOOK_UPLOAD_CHUNK_BYTES?{chunkBytes:input.chunkBytes}:{})};
      const filename=this.file(r,true);
      const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      createdFile=filename;
      fs.closeSync(fd);
      this.options.store.put(COLLECTION,r,who.tenantId);
      db.exec('COMMIT');inTx=false;
      return this.progress(r);
    }catch(error){
      if(inTx)try{db.exec('ROLLBACK');}catch{}
      if(createdFile)try{fs.unlinkSync(createdFile);}catch{}
      throw error;
    }
  }
  /** APPEND requires strict ordered chunks, with exact-byte digest recheck on retries. */
  append(credential:unknown,uploadRef:string,partIndex:number,chunkBase64:string):FacebookImageUploadProgress{
    const r=this.record(credential,uploadRef);
    this.active(r);
    const chunkBytes=this.chunkSize(r);
    if(!Number.isSafeInteger(partIndex)||partIndex<0||partIndex>=Math.ceil(FACEBOOK_IMAGE_MAX_BYTES/chunkBytes))deny('INVALID_MEDIA','Invalid bounded upload chunk index');
    const bytes=strictBase64(chunkBase64,chunkBytes);
    const maxPart=Math.ceil(r.totalBytes/chunkBytes);
    if(partIndex>=maxPart)deny('INVALID_MEDIA','Upload chunk index exceeds total size');
    const expected=partIndex===maxPart-1?r.totalBytes-chunkBytes*partIndex:chunkBytes;
    if(bytes.length!==expected)deny('INVALID_MEDIA','Upload chunk size mismatch');
    const db=this.options.store.db;
    let fd:number|undefined,inTx=false,willTruncate=false,offset=r.receivedBytes;
    try{
      db.exec('BEGIN IMMEDIATE');inTx=true;
      const current=this.record(credential,uploadRef);
      this.active(current);
      const stored=this.readVerified(current);
      if(partIndex<current.parts.length){
        const previous=current.parts[partIndex];
        if(previous.bytes!==bytes.length||previous.sha256!==digest(bytes))deny('IDEMPOTENCY_CONFLICT','Conflicting upload chunk retry');
        db.exec('COMMIT');inTx=false;
        return this.progress(current);
      }
      if(partIndex!==current.parts.length)deny('IDEMPOTENCY_CONFLICT','Upload chunks must arrive in order');
      if(current.receivedBytes+bytes.length>current.totalBytes)deny('LIMIT_EXCEEDED','Upload exceeds declared size');
      offset=current.receivedBytes;
      const filename=this.file(current);
      fd=fs.openSync(filename,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
      if(fs.fstatSync(fd).size!==current.receivedBytes||stored.length!==current.receivedBytes)deny('MEDIA_CORRUPT','Upload file changed during append');
      willTruncate=true;
      const n=fs.writeSync(fd,bytes,0,bytes.length,offset);
      if(n!==bytes.length)deny('MEDIA_CORRUPT','Incomplete chunk write');
      fs.fsyncSync(fd);
      const next={...current,parts:[...current.parts,{sha256:digest(bytes),bytes:bytes.length}],receivedBytes:current.receivedBytes+bytes.length};
      this.options.store.put(COLLECTION,next,current.tenantId);
      db.exec('COMMIT');inTx=false;willTruncate=false;
      return this.progress(next);
    }catch(error){
      if(inTx)try{db.exec('ROLLBACK');}catch{}
      if(willTruncate&&fd!==undefined)try{fs.ftruncateSync(fd,offset);fs.fsyncSync(fd);}catch{}
      throw error;
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  /** Definitively invalid image: terminally reject and reclaim staged bytes.
   * Transient failures must stay FINALIZING for safe idempotent retry.
   */
  private rejectInvalidFinalization(credential:unknown,uploadRef:string):void {
    const db=this.options.store.db;
    let inTx=false,filename:string|undefined;
    try {
      db.exec('BEGIN IMMEDIATE');inTx=true;
      const current=this.record(credential,uploadRef);
      if(current.state==='FINALIZING'&&!current.mediaRef){
        filename=this.file(current);
        this.options.store.put(COLLECTION,{...current,state:'REJECTED'},current.tenantId);
      }
      db.exec('COMMIT');inTx=false;
      if(filename)try{fs.unlinkSync(filename);}catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      }
    }catch(error){if(inTx)try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  /** COMPLETE first claims FINALIZING, so concurrent CANCEL cannot claim STOP after
   * media storage may begin. A crash can replay the existing idempotent media upload,
   * never duplicate provider sends (there are NO provider sends in this module).
   */
  complete(credential:unknown,uploadRef:string):CustomerFacebookImageReceipt{
    const db=this.options.store.db;
    let inTx=false;
    let r:Session;
    try{
      db.exec('BEGIN IMMEDIATE');inTx=true;
      r=this.record(credential,uploadRef);
      if(r.state==='COMPLETED'&&r.mediaRef){
        const receipt=this.options.media.getReceipt(credential,r.mediaRef);
        db.exec('COMMIT');inTx=false;return receipt;
      }
      if(r.state==='UPLOADING')this.active(r);
      else if(r.state!=='FINALIZING')deny('MEDIA_NOT_FOUND','Upload unavailable');
      if(r.receivedBytes!==r.totalBytes)deny('INVALID_MEDIA','Upload incomplete');
      const bytes=this.readVerified(r);
      if(bytes.length!==r.totalBytes||digest(bytes)!==r.sha256)deny('MEDIA_CORRUPT','Full uploaded image checksum mismatch');
      if(r.state==='UPLOADING'){
        this.options.store.put(COLLECTION,{...r,state:'FINALIZING'},r.tenantId);
        r={...r,state:'FINALIZING'};
      }
      db.exec('COMMIT');inTx=false;
      // The original image service alone owns private file, retry, audit and receipt.
      let receipt:CustomerFacebookImageReceipt;
      try {
        receipt=this.options.media.uploadImage(credential,{imageBase64:bytes.toString('base64'),contentType:r.contentType,idempotencyKey:r.idempotencyKey,originClaim:r.originClaim});
      }catch(error){
        // These errors happen before media-store commit, and are not retriable
        // with the same bytes. Do not leave permanent FINALIZING disk objects.
        if(error instanceof FacebookCustomerMediaError &&
           ['INVALID_MEDIA','LIMIT_EXCEEDED','IDEMPOTENCY_CONFLICT'].includes(error.code)){
          this.rejectInvalidFinalization(credential,uploadRef);
        }
        throw error;
      }
      db.exec('BEGIN IMMEDIATE');inTx=true;
      const current=this.record(credential,uploadRef);
      if(current.state!=='FINALIZING'&&current.state!=='COMPLETED')deny('MEDIA_CORRUPT','Upload finalization state changed');
      if(current.state==='COMPLETED'&&current.mediaRef!==receipt.mediaRef)deny('MEDIA_CORRUPT','Upload finalization receipt mismatch');
      this.options.store.put(COLLECTION,{...current,state:'COMPLETED',mediaRef:receipt.mediaRef},current.tenantId);
      db.exec('COMMIT');inTx=false;
      try{fs.unlinkSync(this.file(current));}catch{}
      return receipt;
    }catch(error){if(inTx)try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  /** CANCEL drops only the incomplete staged transfer; never deletes completed user media. */
  cancel(credential:unknown,uploadRef:string):{uploadRef:string;state:'CANCELLED'|'COMPLETED'} {
    const db=this.options.store.db;
    let inTx=false;
    try{
      db.exec('BEGIN IMMEDIATE');inTx=true;
      const r=this.record(credential,uploadRef);
      if(r.state==='COMPLETED'){db.exec('COMMIT');inTx=false;return{uploadRef,state:'COMPLETED'};}
      if(r.state==='FINALIZING')deny('IDEMPOTENCY_CONFLICT','Upload already finalizing and cannot be cancelled');
      if(r.state==='REJECTED'||r.state==='EXPIRED')deny('MEDIA_NOT_FOUND','Upload unavailable');
      if(r.state!=='CANCELLED')this.options.store.put(COLLECTION,{...r,state:'CANCELLED'},r.tenantId);
      db.exec('COMMIT');inTx=false;
      try{fs.unlinkSync(this.file(r));}catch{}
      return {uploadRef,state:'CANCELLED'};
    }catch(error){if(inTx)try{db.exec('ROLLBACK');}catch{}throw error;}
  }
}
