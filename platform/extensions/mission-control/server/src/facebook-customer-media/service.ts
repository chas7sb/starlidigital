/** Customer-scoped, private Facebook Pages image handoff. No provider or MCP side effects. */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Store } from '../store.js';

export const FACEBOOK_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** LCG4 provider payload limit is decimal bytes, lower than private 8 MiB. */
export const FACEBOOK_PUBLISH_MAX_BYTES = 8_000_000;
export const FACEBOOK_IMAGE_MAX_DIMENSION = 4096;
export const FACEBOOK_IMAGE_MAX_TENANT_BYTES = 128 * 1024 * 1024;
export const FACEBOOK_IMAGE_MAX_TENANT_ITEMS = 128;
const IMAGE_COLLECTION = 'facebook-customer-image-records';
const REQUEST_COLLECTION = 'facebook-customer-image-requests';
const AUDIT_COLLECTION = 'facebook-customer-image-audit';
const MEDIA_REF_RE = /^fbimg-[a-f0-9]{32}$/;
const REQUEST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.:_-]{7,127}$/;
// Dedicated customer upload permission REQUIRED from future LCG1 owner allowlist;
// NOT in the current 6bf9c9c LCG1 OAuth grant set. Never substitute admin tools.
const CUSTOMER_SCOPE_READ = 'facebook.media.write';
const CUSTOMER_SCOPE_WRITE = 'facebook.media.write';
type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
type ImageOriginClaim = 'CHATGPT_GENERATED' | 'USER_UPLOADED';

export class FacebookCustomerMediaError extends Error {
  constructor(readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_MEDIA' | 'LIMIT_EXCEEDED' | 'IDEMPOTENCY_CONFLICT' | 'MEDIA_NOT_FOUND' | 'MEDIA_CORRUPT', message: string) {
    super(message);
    this.name = 'FacebookCustomerMediaError';
  }
}

/** Returned by the LCG1 customer-MCP credential verifier, NEVER supplied as an upload tool arg. */
export interface VerifiedFacebookMediaCustomer {
  source: 'CUSTOMER_MCP';
  audience: 'starli-customer-facebook-mcp';
  tenantId: string;
  ownerId: string;
  subjectId: string;
  scopes: readonly string[];
}
export interface CustomerFacebookImageUpload {
  /** Strict RFC4648 base64, not a URL, data URI, network fetch or arbitrary filesystem path. */
  imageBase64: string;
  contentType: ImageMime;
  /** Stable across retries. Unique per authenticated customer user and requested content. */
  idempotencyKey: string;
  /** Claim only; ChatGPT origin cannot be verified by this service. */
  originClaim?: ImageOriginClaim;
}
export interface CustomerFacebookImageReceipt {
  mediaRef: string;
  state: 'STORED_PRIVATE';
  sha256: string;
  contentType: ImageMime;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
  /** A private media handoff receipt, NOT a published/scheduled Facebook post. */
  publicationState: 'NOT_PUBLISHED';
}
interface StoredImage extends CustomerFacebookImageReceipt {
  id: string;
  kind: 'FACEBOOK_CUSTOMER_IMAGE';
  ownerId: string;
  tenantId: string;
  subjectId: string;
  originClaim: ImageOriginClaim;
  revokedAt?: string;
}
interface StoredRequest {
  id: string;
  ownerId: string;
  tenantId: string;
  subjectId: string;
  sha256: string;
  mediaRef: string;
}
interface SafeImage { contentType: ImageMime; width: number; height: number; bytes: Buffer; sha256: string }

function bad(code: FacebookCustomerMediaError['code'], message: string): never {
  throw new FacebookCustomerMediaError(code, message);
}
function digest(text: string | Buffer): string { return createHash('sha256').update(text).digest('hex'); }
function stableId(value: string): boolean { return typeof value === 'string' && value.length >= 1 && value.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/.test(value); }

function readStrictBase64(text: unknown): Buffer {
  if (typeof text !== 'string' || text.length < 16 || text.length > Math.ceil(FACEBOOK_IMAGE_MAX_BYTES / 3) * 4 + 4 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    bad('INVALID_MEDIA', 'Image must be bounded canonical base64 bytes, not a URL or data URI');
  }
  const bytes = Buffer.from(text, 'base64');
  if (!bytes.length || bytes.length > FACEBOOK_IMAGE_MAX_BYTES) bad('LIMIT_EXCEEDED', 'Image exceeds 8 MiB limit');
  if (bytes.toString('base64') !== text) bad('INVALID_MEDIA', 'Image base64 encoding is not canonical');
  return bytes;
}
// PNG CRC verifies that an accepted image is not just a spoofed header and length table.
const CRC_TABLE = Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;});
function crc32(bytes:Buffer,start:number,end:number):number {
  let crc=0xffffffff;
  for(let i=start;i<end;i++)crc=CRC_TABLE[(crc^bytes[i])&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > FACEBOOK_IMAGE_MAX_DIMENSION || height > FACEBOOK_IMAGE_MAX_DIMENSION || width * height > 16_777_216) {
    bad('LIMIT_EXCEEDED', 'Image dimensions must be between 1 and 4096 pixels');
  }
  return { width, height };
}
function imageDimensions(bytes: Buffer, mime: ImageMime): { width: number; height: number } {
  // The format structure is checked before accepting an uploaded file. No SVG/GIF/HTML/executable.
  if (mime === 'image/png') {
    if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      bad('INVALID_MEDIA', 'Invalid PNG header');
    }
    const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    let offset = 8, idat = false, end = false, chunks = 0;
    while (offset + 12 <= bytes.length && ++chunks < 1024) {
      const len = bytes.readUInt32BE(offset);
      if (len > FACEBOOK_IMAGE_MAX_BYTES || offset + 12 + len > bytes.length) bad('INVALID_MEDIA', 'Invalid PNG chunk length');
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!/^[A-Za-z]{4}$/.test(type)) bad('INVALID_MEDIA', 'Invalid PNG chunk type');
      if (bytes.readUInt32BE(offset+8+len)!==crc32(bytes,offset+4,offset+8+len)) bad('INVALID_MEDIA', 'PNG chunk checksum mismatch');
      if (type === 'IHDR' && offset !== 8) bad('INVALID_MEDIA', 'Duplicate PNG header');
      if (type === 'IDAT') {if(len === 0)bad('INVALID_MEDIA','Empty PNG data');idat = true;}
      if (type === 'IEND') { if (len !== 0 || offset + 12 !== bytes.length) bad('INVALID_MEDIA', 'Invalid PNG end'); end = true; break; }
      offset += 12 + len;
    }
    if (!idat || !end) bad('INVALID_MEDIA', 'Incomplete PNG image');
    return size;
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) bad('INVALID_MEDIA', 'Invalid JPEG structure');
    let off = 2, size: {width:number;height:number} | undefined;
    let sawScan = false;
    while (off < bytes.length - 2) {
      if (bytes[off++] !== 0xff) bad('INVALID_MEDIA', 'Invalid JPEG marker');
      while (bytes[off] === 0xff) off++;
      const marker = bytes[off++];
      if (marker === 0xda) {sawScan=true;break;} // SOS image payload follows, terminated by EOI already checked.
      if (marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (off + 2 > bytes.length) bad('INVALID_MEDIA', 'Invalid JPEG segment');
      const length = bytes.readUInt16BE(off);
      if (length < 2 || off + length > bytes.length) bad('INVALID_MEDIA', 'Invalid JPEG segment length');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 7) bad('INVALID_MEDIA', 'Invalid JPEG dimensions');
        size = dimensions(bytes.readUInt16BE(off + 5), bytes.readUInt16BE(off + 3));
      }
      off += length;
    }
    if (!size || !sawScan) bad('INVALID_MEDIA', 'Missing JPEG dimensions or scan');
    return size;
  }
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) bad('INVALID_MEDIA', 'Invalid WebP structure');
  const type = bytes.toString('ascii', 12, 16);
  const length = bytes.readUInt32LE(16);
  if (length + 20 > bytes.length) bad('INVALID_MEDIA', 'Invalid WebP chunk length');
  if (type === 'VP8X' && length >= 10) return dimensions(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
  if (type === 'VP8L' && length >= 5 && bytes[20] === 0x2f) return dimensions(1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), 1 + (((bytes[24] & 0xf) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)));
  if (type === 'VP8 ' && length >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return dimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  return bad('INVALID_MEDIA', 'Unsupported WebP encoding');
}
function validateImage(input: CustomerFacebookImageUpload): SafeImage {
  if (!['image/png','image/jpeg','image/webp'].includes(input.contentType)) bad('INVALID_MEDIA', 'Only PNG, JPEG and WebP images are allowed');
  const bytes = readStrictBase64(input.imageBase64);
  const type = input.contentType;
  const detected = bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' ? 'image/webp' : null;
  if (!detected || detected !== type) bad('INVALID_MEDIA', 'Declared MIME does not match image bytes');
  let size: {width:number;height:number};
  try {size=imageDimensions(bytes, detected);}
  catch (error) {
    if(error instanceof FacebookCustomerMediaError)throw error;
    return bad('INVALID_MEDIA', 'Invalid or truncated image structure');
  }
  return {bytes,contentType:detected,sha256:digest(bytes),...size};
}
function safeDirectory(directory: string, create: boolean): void {
  if (create) fs.mkdirSync(directory, {recursive:true,mode:0o700});
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0 || fs.realpathSync(directory) !== path.resolve(directory)) bad('MEDIA_CORRUPT', 'Untrusted customer media storage directory');
}
function imageExtension(type: ImageMime): string {return type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';}

export class FacebookCustomerMediaService {
  private readonly root: string;
  constructor(private readonly options: {
    store: Store;
    /** Mandatory: LCG1 must implement a REAL credential-verifying callback. */
    authenticate: (credential: unknown) => VerifiedFacebookMediaCustomer;
    storageRoot?: string;
  }) {
    if (typeof options.authenticate !== 'function') throw new Error('Customer MCP authentication callback required');
    this.root = path.resolve(options.storageRoot || process.env.FACEBOOK_CUSTOMER_MEDIA_DIR || path.resolve(process.cwd(), 'data', 'facebook-customer-media'));
  }
  private customer(credential: unknown, permission: string): VerifiedFacebookMediaCustomer {
    let principal: VerifiedFacebookMediaCustomer;
    try {principal = this.options.authenticate(credential);} catch {return bad('UNAUTHENTICATED', 'Authenticated customer MCP credentials required');}
    if (!principal || principal.source !== 'CUSTOMER_MCP' || principal.audience !== 'starli-customer-facebook-mcp' || !stableId(principal.tenantId) || !stableId(principal.ownerId) || !stableId(principal.subjectId) || principal.ownerId !== principal.tenantId || principal.subjectId !== principal.tenantId) {
      bad('UNAUTHENTICATED', 'Authenticated customer MCP credentials required');
    }
    if (!Array.isArray(principal.scopes) || !principal.scopes.includes(permission)) bad('FORBIDDEN', 'Customer media permission required');
    return principal;
  }
  /** Internal upload-transport bridge. Always revalidates the LCG1 customer token.
   * Never treat a serialized tool argument or caller-provided principal as authentication. */
  verifyUploadPrincipal(credential: unknown): Readonly<{tenantId:string;subjectId:string}> {
    const principal = this.customer(credential,CUSTOMER_SCOPE_WRITE);
    return Object.freeze({tenantId:principal.tenantId,subjectId:principal.subjectId});
  }
  private directory(tenantId: string, create: boolean): string {
    safeDirectory(this.root, create);
    const dir = path.join(this.root, digest(`facebook-media-tenant\0${tenantId}`));
    safeDirectory(dir, create);
    return dir;
  }
  private filename(tenantId: string, mediaRef: string, type: ImageMime, create = false): string {
    if (!MEDIA_REF_RE.test(mediaRef)) bad('MEDIA_NOT_FOUND', 'Customer media not found');
    return path.join(this.directory(tenantId, create), `${mediaRef}.${imageExtension(type)}`);
  }
  private checkedRecord(tenantId: string, mediaRef: string): StoredImage {
    if (typeof mediaRef !== 'string' || !MEDIA_REF_RE.test(mediaRef)) bad('MEDIA_NOT_FOUND', 'Customer media not found');
    const record = this.options.store.get(IMAGE_COLLECTION, mediaRef) as StoredImage | undefined;
    if (!record || record.id !== mediaRef || record.mediaRef !== mediaRef || record.kind !== 'FACEBOOK_CUSTOMER_IMAGE' || record.tenantId !== tenantId || record.ownerId !== tenantId || record.subjectId !== tenantId || record.state !== 'STORED_PRIVATE' || record.revokedAt || !['image/png','image/jpeg','image/webp'].includes(record.contentType) || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.byteSize) || record.byteSize < 1 || record.byteSize > FACEBOOK_IMAGE_MAX_BYTES) {
      bad('MEDIA_NOT_FOUND', 'Customer media not found');
    }
    return record;
  }
  private audit(principal: VerifiedFacebookMediaCustomer, event: string, mediaRef: string): void {
    this.options.store.put(AUDIT_COLLECTION, {
      id: `fbmedia-audit-${randomBytes(16).toString('hex')}`,ownerId:principal.tenantId,tenantId:principal.tenantId,
      subjectId:principal.subjectId,event,mediaRef,at:new Date().toISOString(),
    },principal.tenantId);
  }
  private receipt(record: StoredImage): CustomerFacebookImageReceipt {
    return {mediaRef:record.mediaRef,state:'STORED_PRIVATE',sha256:record.sha256,contentType:record.contentType,byteSize:record.byteSize,width:record.width,height:record.height,createdAt:record.createdAt,publicationState:'NOT_PUBLISHED'};
  }
  uploadImage(credential: unknown, input: CustomerFacebookImageUpload): CustomerFacebookImageReceipt {
    const principal = this.customer(credential,CUSTOMER_SCOPE_WRITE);
    if (!input || typeof input !== 'object' || typeof input.idempotencyKey !== 'string' || !REQUEST_RE.test(input.idempotencyKey)) bad('INVALID_MEDIA','A stable 8-128 character request key is required');
    if (input.originClaim !== undefined && !['CHATGPT_GENERATED','USER_UPLOADED'].includes(input.originClaim)) bad('INVALID_MEDIA','Unknown image origin claim');
    const validated = validateImage(input);
    const requestId = `fbmedia-request-${digest(`${principal.tenantId}\0${principal.subjectId}\0${input.idempotencyKey}`)}`;
    let fd: number | undefined;
    let filename: string | undefined;
    let fileCreated = false;
    let inTransaction = false;
    try {
      // Serializes concurrent duplicate requests across processes using the shared SQLite Store.
      // All metadata, idempotency and audit writes commit together (or none do).
      this.options.store.db.exec('BEGIN IMMEDIATE');inTransaction=true;
      const prior = this.options.store.get(REQUEST_COLLECTION,requestId) as StoredRequest | undefined;
      if (prior) {
        if (prior.id !== requestId || prior.ownerId !== principal.tenantId || prior.tenantId !== principal.tenantId || prior.subjectId !== principal.subjectId || prior.sha256 !== validated.sha256) bad('IDEMPOTENCY_CONFLICT','Upload key was already used for different media');
        const record=this.checkedRecord(principal.tenantId,prior.mediaRef);
        // Origin is an unverified customer claim, but immutable per request key:
        // the same digest must not silently change stored source metadata.
        // Omitted and explicit USER_UPLOADED are intentionally equivalent.
        if (record.originClaim !== (input.originClaim ?? 'USER_UPLOADED')) bad('IDEMPOTENCY_CONFLICT','Upload request key was already used with different origin metadata');
        this.verifyStoredFile(record);
        this.audit(principal,'IMAGE_REUSED',record.mediaRef);
        this.options.store.db.exec('COMMIT');inTransaction=false;
        return this.receipt(record);
      }
      const own = (this.options.store.list(IMAGE_COLLECTION,principal.tenantId) as StoredImage[]).filter(r=>!r.revokedAt);
      if (own.length >= FACEBOOK_IMAGE_MAX_TENANT_ITEMS || own.reduce((n,r)=>n+(Number.isFinite(r.byteSize)?r.byteSize:0),0)+validated.bytes.length > FACEBOOK_IMAGE_MAX_TENANT_BYTES) bad('LIMIT_EXCEEDED','Customer media quota exceeded');
      const mediaRef = `fbimg-${randomBytes(16).toString('hex')}`;
      filename = this.filename(principal.tenantId,mediaRef,validated.contentType,true);
      fd = fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      fileCreated = true;
      fs.writeFileSync(fd,validated.bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);fd=undefined;
      const createdAt = new Date().toISOString();
      const record: StoredImage = {id:mediaRef,kind:'FACEBOOK_CUSTOMER_IMAGE',ownerId:principal.tenantId,tenantId:principal.tenantId,subjectId:principal.subjectId,mediaRef,state:'STORED_PRIVATE',sha256:validated.sha256,contentType:validated.contentType,byteSize:validated.bytes.length,width:validated.width,height:validated.height,createdAt,publicationState:'NOT_PUBLISHED',originClaim:input.originClaim||'USER_UPLOADED'};
      this.options.store.put(IMAGE_COLLECTION,record,principal.tenantId);
      this.options.store.put(REQUEST_COLLECTION,{id:requestId,ownerId:principal.tenantId,tenantId:principal.tenantId,subjectId:principal.subjectId,sha256:validated.sha256,mediaRef},principal.tenantId);
      this.audit(principal,'IMAGE_STORED',mediaRef);
      this.options.store.db.exec('COMMIT');inTransaction=false;
      return this.receipt(record);
    } catch(error) {
      if(fd!==undefined)try{fs.closeSync(fd);}catch{}
      if(inTransaction)try{this.options.store.db.exec('ROLLBACK');}catch{}
      // Never leave an untracked file after a metadata/transaction failure.
      if(fileCreated&&filename)try{fs.unlinkSync(filename);}catch{}
      throw error;
    }
  }
  private verifyStoredFile(record: StoredImage): Buffer {
    let fd: number | undefined;
    try {
      const file = this.filename(record.tenantId,record.mediaRef,record.contentType);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || stat.size !== record.byteSize) bad('MEDIA_CORRUPT','Stored image integrity check failed');
      fd = fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const fresh = fs.fstatSync(fd);
      if (!fresh.isFile() || fresh.size !== record.byteSize) bad('MEDIA_CORRUPT','Stored image integrity check failed');
      const bytes = fs.readFileSync(fd);
      if (digest(bytes)!==record.sha256) bad('MEDIA_CORRUPT','Stored image integrity check failed');
      return bytes;
    } catch(error) {
      if (error instanceof FacebookCustomerMediaError) throw error;
      return bad('MEDIA_CORRUPT','Stored image unavailable or unsafe');
    } finally {if(fd!==undefined)fs.closeSync(fd);}
  }
  /** For an authenticated, same-tenant publisher after LCG4/LCG5 Page/command validation. Never return filesystem path or URL. */
  readImage(credential: unknown, mediaRef: string): {media: CustomerFacebookImageReceipt; bytes: Buffer} {
    const principal = this.customer(credential,CUSTOMER_SCOPE_READ);
    const record = this.checkedRecord(principal.tenantId,mediaRef);
    const bytes = this.verifyStoredFile(record);
    this.audit(principal,'IMAGE_READ_FOR_CUSTOMER',mediaRef);
    return {media:this.receipt(record),bytes};
  }
  /** SERVER-ONLY bridge for LCG4's explicit verified publish/schedule operation.
   * Requires a *fresh* customer bearer with facebook.pages.publish. Upload/read
   * tools continue to require facebook.media.write; these scopes are not mixed.
   * Never register this method as a user-callable MCP tool or raw media URL.
   */
  readImageForTrustedPublish(credential: unknown, mediaRef: string): {media:CustomerFacebookImageReceipt;bytes:Buffer} {
    const principal=this.customer(credential,'facebook.pages.publish');
    const record=this.checkedRecord(principal.tenantId,mediaRef);
    if(record.contentType!=='image/png'&&record.contentType!=='image/jpeg'){
      bad('INVALID_MEDIA','Facebook publish media accepts only PNG/JPEG');
    }
    // LCG4 currently enforces 8,000,000 bytes, smaller than the ingest 8 MiB.
    if(record.byteSize>FACEBOOK_PUBLISH_MAX_BYTES)bad('LIMIT_EXCEEDED','Image exceeds publish adapter byte limit');
    const bytes=this.verifyStoredFile(record);
    this.audit(principal,'IMAGE_READ_FOR_VERIFIED_PUBLISH',mediaRef);
    return {media:this.receipt(record),bytes};
  }
  /** Internal bridge. The caller must derive identity from MCP auth or an owned, approved job. */
  readOwnedImageForSocialPublish(owner:{tenantId:string;userId:string},mediaRef:string) {
    const user=this.options.store.user(owner.userId);
    if(owner.tenantId!==owner.userId||!user||user.disabled||user.role!=='USER')
      return bad('FORBIDDEN','Active Instagram customer required');
    const record=this.checkedRecord(owner.tenantId,mediaRef);
    if(record.subjectId!==owner.userId||!['image/png','image/jpeg'].includes(record.contentType)||
      record.byteSize>FACEBOOK_PUBLISH_MAX_BYTES)return bad('INVALID_MEDIA','Instagram image unavailable');
    return {media:this.receipt(record),bytes:this.verifyStoredFile(record)};
  }
  /** Server-only due-worker read. The trusted publisher checks original consent
   * separately. This read only accepts media bound to a currently claimed job. */
  readImageForScheduledPublish(input: {
    tenantId:string; userId:string; jobId:string; mediaRef:string;
    cipher:{open(ciphertext:string):string};
  }): {media:CustomerFacebookImageReceipt;bytes:Buffer} {
    const {tenantId,userId,jobId,mediaRef}=input;
    const job=this.options.store.get('facebook-customer-schedule',jobId);
    const user=this.options.store.user(userId);
    if(tenantId!==userId||!user||user.disabled||!['USER','CUSTOMER'].includes(String(user.role))||
       !job||job.id!==jobId||job.tenantId!==tenantId||job.userId!==userId||job.state!=='DISPATCHING'){
      return bad('FORBIDDEN','Claimed customer schedule required');
    }
    let payload;
    try{payload=JSON.parse(input.cipher.open(job.sealedPayload));}
    catch{return bad('FORBIDDEN','Customer schedule payload unavailable');}
    if(!payload||payload.tenantId!==tenantId||payload.userId!==userId||
       payload.commandId!==job.commandId||payload.pageConnectionId!==job.pageConnectionId||
       payload.scheduledAt!==job.scheduledAt||typeof payload.caption!=='string'||
       !Array.isArray(payload.mediaRefs)||!Array.isArray(payload.mediaHashes)||
       payload.mediaRefs.length!==payload.mediaHashes.length||
       digest(Buffer.from(JSON.stringify([tenantId,userId,job.commandId,job.pageConnectionId,
         payload.caption,payload.mediaRefs,job.scheduledAt])))!==job.payloadHash){
      return bad('FORBIDDEN','Customer schedule payload mismatch');
    }
    const index=payload.mediaRefs.indexOf(mediaRef);
    if(index<0||payload.mediaRefs.lastIndexOf(mediaRef)!==index){
      return bad('FORBIDDEN','Image is outside the claimed schedule');
    }
    const record=this.checkedRecord(tenantId,mediaRef);
    if(record.sha256!==payload.mediaHashes[index]||record.byteSize>FACEBOOK_PUBLISH_MAX_BYTES||
       (record.contentType!=='image/png'&&record.contentType!=='image/jpeg')){
      return bad('INVALID_MEDIA','Scheduled image integrity check failed');
    }
    const bytes=this.verifyStoredFile(record);
    this.options.store.put(AUDIT_COLLECTION,{
      id:`fbmedia-audit-${randomBytes(16).toString('hex')}`,ownerId:tenantId,tenantId,subjectId:userId,
      event:'IMAGE_READ_FOR_SCHEDULED_PUBLISH',jobId,mediaRef,at:new Date().toISOString(),
    },tenantId);
    return {media:this.receipt(record),bytes};
  }
  getReceipt(credential: unknown, mediaRef: string): CustomerFacebookImageReceipt {
    const principal=this.customer(credential,CUSTOMER_SCOPE_READ);
    const record=this.checkedRecord(principal.tenantId,mediaRef);
    this.verifyStoredFile(record);
    return this.receipt(record);
  }
  revokeImage(credential: unknown, mediaRef: string): {mediaRef:string;state:'REVOKED'} {
    const principal=this.customer(credential,CUSTOMER_SCOPE_WRITE);
    const record=this.checkedRecord(principal.tenantId,mediaRef);
    const file=this.filename(record.tenantId,mediaRef,record.contentType);
    this.verifyStoredFile(record);
    this.options.store.put(IMAGE_COLLECTION,{...record,revokedAt:new Date().toISOString()},principal.tenantId);
    fs.unlinkSync(file);
    this.audit(principal,'IMAGE_REVOKED',mediaRef);
    return {mediaRef,state:'REVOKED'};
  }
}
