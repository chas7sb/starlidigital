/**
 * LCG4 owner-only, OFFLINE post-now composition seam for the Velour Facebook pilot.
 * It does not register a route, fetch credentials, instantiate Meta transport,
 * or enable external writes by itself. LCG10 owns the only HTTP/MCP assembly.
 * Every dependency is injected from a trusted server-only owner implementation.
 */
import {createHash} from 'node:crypto';
import type {Store} from '../store.js';
import {
  FacebookCustomerPostNowService,translateFacebookPilotAdapterReceipt,
  type FacebookCustomerPrincipal,type FacebookPostNowCommand,type FacebookPostNowPorts,
  type FacebookPageGrant,type FacebookMediaGrant,type FacebookPostNowReceipt,
} from './post-now.js';

export interface VerifiedMcpFacebookPublisher {
  readonly source:'CUSTOMER_MCP';
  readonly audience:'starli-customer-facebook-mcp';
  readonly tenantId:string;
  readonly ownerId:string;
  readonly subjectId:string;
  readonly scopes:readonly string[];
  readonly expiresAt:number;
}
export interface TrustedFacebookPageSelection {
  connectionId:string;
  pageId:string;
  connectionRevision:string;
}
export interface TrustedFacebookPageBinding {
  tenantId:string;
  pageId:string;
  verifiedPageId:string;
  /** Trusted fresh OAuth revision; cannot be copied from tool arguments. */
  connectionRevision:string;
  canCreateContent:boolean;
  scopes:readonly string[];
  /** Never emitted in receipts, audit or customer tools. */
  pageToken:string;
}
export interface VerifiedPostNowMediaBytes {
  tenantId:string;
  ownerUserId:string;
  ref:string;
  state:'READY';
  kind:'IMAGE'|'VIDEO';
  mimeType:'image/jpeg'|'image/png'|'video/mp4';
  sha256:string;
  bytes:Uint8Array;
}
export interface VerifiedPostNowProviderMedia {
  tenantId:string;
  kind:'IMAGE'|'VIDEO';
  mimeType:'image/jpeg'|'image/png'|'video/mp4';
  filename:string;
  bytes:Uint8Array;
}
export interface VerifiedPostNowProviderReceipt {
  state:'PUBLISHED'|'FAILED'|'NEEDS_REAUTH'|'UNCERTAIN';
  providerPostRef?:string;
  errorCode?:string;
}
export interface VerifiedFacebookPostNowDependencies {
  /** LCG1 CustomerFacebookMcpAuth.authenticateBearer + assertCustomerFacebookTool. */
  auth:{
    authenticateBearer(authorization:unknown):VerifiedMcpFacebookPublisher;
    assertPublishTool(principal:VerifiedMcpFacebookPublisher):void;
  };
  /** LCG3 CustomerFacebookPageSelection.requireSelectedPublishPage: fresh inventory, audit, revision. */
  pages:{requireSelectedPublishPage(customer:{tenantId:string;userId:string}):Promise<TrustedFacebookPageSelection>};
  /** LCG2/LCG3 protected Page-specific token resolution, current grant and verified Page tasks. */
  pageTokens:{resolveCurrentPageToken(input:{tenantId:string;userId:string;pageConnectionId:string;pageId:string;connectionRevision:string}):Promise<TrustedFacebookPageBinding>};
  /** LCG6/8 narrow, tenant-verified server-side bytes ONLY; no raw upload URL/path. */
  media:{readOwnedForPublish(input:{principal:VerifiedMcpFacebookPublisher;mediaRef:string}):Promise<VerifiedPostNowMediaBytes>};
  /** LCG8 FacebookPagesPilotAdapter.publishNow via a trusted one-attempt adapter. */
  provider:{publishNow(binding:TrustedFacebookPageBinding,cmd:{tenantId:string;pageId:string;commandId:string;mode:'NOW';caption:string;media?:VerifiedPostNowProviderMedia}):Promise<VerifiedPostNowProviderReceipt>};
}
const requiredScopes=['pages_show_list','pages_read_engagement','pages_manage_posts'];
const opaque=/^[A-Za-z0-9_.:-]{8,160}$/;
const mediaRefPattern=/^(?:fbimg-[a-f0-9]{32}|vrnd-[a-f0-9-]{1,100})$/;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function guard(cond:unknown,message:string):asserts cond {if(!cond)throw new Error(message);}
export function verifyOwnedFacebookMediaBytes(m:VerifiedPostNowMediaBytes,ref:string,p:Pick<VerifiedMcpFacebookPublisher,'tenantId'|'subjectId'>):{grant:FacebookMediaGrant;upload:VerifiedPostNowProviderMedia}{
  guard(m&&typeof m==='object'&&m.ref===ref&&m.tenantId===p.tenantId&&m.ownerUserId===p.subjectId&&m.state==='READY','MEDIA_ACCESS_DENIED');
  guard(m.bytes instanceof Uint8Array&&m.bytes.length>0,'MEDIA_BYTES_UNVERIFIED');
  // Pin a private byte snapshot; no injected media owner may mutate it between
  // verifying content and dispatching the one provider attempt.
  const sealedBytes=Uint8Array.from(m.bytes);
  guard(typeof m.sha256==='string'&&/^[a-f0-9]{64}$/.test(m.sha256)&&sha256(sealedBytes)===m.sha256,'MEDIA_HASH_MISMATCH');
  const image=m.kind==='IMAGE',video=m.kind==='VIDEO';
  guard((image||video)&&(image?ref.startsWith('fbimg-'):ref.startsWith('vrnd-')),'MEDIA_REF_KIND_MISMATCH');
  guard(image?sealedBytes.length<=8_000_000:sealedBytes.length<=100_000_000,'MEDIA_SIZE_DENIED');
  if(image){
    guard(m.mimeType==='image/png'||m.mimeType==='image/jpeg','MEDIA_MIME_UNSUPPORTED');
    if(m.mimeType==='image/png')guard(sealedBytes.length>=8&&Buffer.from(sealedBytes.subarray(0,8)).equals(Buffer.from('89504e470d0a1a0a','hex')),'MEDIA_FORMAT_INVALID');
    else guard(sealedBytes.length>=4&&sealedBytes[0]===255&&sealedBytes[1]===216&&sealedBytes[sealedBytes.length-2]===255&&sealedBytes[sealedBytes.length-1]===217,'MEDIA_FORMAT_INVALID');
  }else{
    guard(m.mimeType==='video/mp4'&&sealedBytes.length>=12&&Buffer.from(sealedBytes.subarray(4,8)).toString('ascii')==='ftyp','MEDIA_FORMAT_INVALID');
  }
  const mime=m.mimeType;
  const extension=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'mp4';
  return {grant:{tenantId:p.tenantId,ownerUserId:p.subjectId,ref,kind:m.kind,mimeType:mime,bytes:sealedBytes.length,sha256:m.sha256,state:'READY'},
    upload:{tenantId:p.tenantId,kind:m.kind,mimeType:mime,filename:`${ref}.${extension}`,bytes:sealedBytes}};
}

/**
 * The raw HTTP/MCP Authorization header and command ID MUST come from LCG1's
 * verified request context, never arbitrary JSON tool arguments. This class
 * only calls injected adapters. A valid explicit publish-now tool invocation
 * supplies customer intent; no redundant manual approval is introduced.
 */
export class VerifiedFacebookPostNow {
  constructor(
    private readonly store:Store,
    private readonly dependencies:VerifiedFacebookPostNowDependencies,
    private readonly options:{externalWritesEnabled?:boolean}={},
  ){}
  private verified(authorization:unknown):VerifiedMcpFacebookPublisher {
    const p=this.dependencies.auth.authenticateBearer(authorization);
    this.dependencies.auth.assertPublishTool(p);
    guard(p&&p.source==='CUSTOMER_MCP'&&p.audience==='starli-customer-facebook-mcp'&&p.subjectId===p.tenantId&&p.ownerId===p.tenantId&&
      Array.isArray(p.scopes)&&p.scopes.includes('facebook.pages.publish')&&Number.isFinite(p.expiresAt)&&p.expiresAt>Date.now(),
      'CUSTOMER_MCP_PUBLISH_DENIED');
    // A verified bearer can outlive account disablement/role changes. Never
    // trust a cached token claim as proof that the customer is live NOW.
    const user=this.store.user(p.subjectId);
    guard(user&&!user.disabled&&['USER','CUSTOMER'].includes(String(user.role)),'CUSTOMER_ACCOUNT_REQUIRED');
    return p;
  }
  /** No tokens, bytes, caption or IDs from client identity override fields. */
  async publishNow(input:{authorization:unknown;verifiedRequestId:string;command:FacebookPostNowCommand}):Promise<FacebookPostNowReceipt>{
    guard(this.options.externalWritesEnabled===true,'FACEBOOK_EXTERNAL_WRITES_DISABLED');
    guard(typeof input?.verifiedRequestId==='string'&&opaque.test(input.verifiedRequestId),'VERIFIED_REQUEST_ID_REQUIRED');
    const p=this.verified(input.authorization);
    const principal:FacebookCustomerPrincipal={tenantId:p.tenantId,userId:p.subjectId,audience:'customer-mcp',commandId:input.verifiedRequestId};
    const deps=this.dependencies;
    const authAgain=()=>{
      const fresh=this.verified(input.authorization);
      guard(fresh.tenantId===p.tenantId&&fresh.subjectId===p.subjectId,'CUSTOMER_MCP_CONTEXT_CHANGED');
      return fresh;
    };
    const selectedPage=async(pageConnectionId:string):Promise<FacebookPageGrant>=>{
      const current=authAgain();
      const selected=await deps.pages.requireSelectedPublishPage({tenantId:current.tenantId,userId:current.subjectId});
      guard(selected&&selected.connectionId===pageConnectionId&&typeof selected.pageId==='string'&&/^[0-9]{1,32}$/.test(selected.pageId)&&
        typeof selected.connectionRevision==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(selected.connectionRevision),'PAGE_SELECTION_DENIED');
      return {tenantId:current.tenantId,ownerUserId:current.subjectId,connectionId:selected.connectionId,pageId:selected.pageId,
        connectionRevision:selected.connectionRevision,targetType:'PAGE',status:'CONNECTED',tasks:['CREATE_CONTENT'],scopes:[...requiredScopes]};
    };
    const verifiedMedia=async(ref:string)=>{
      const current=authAgain();
      guard(typeof ref==='string'&&mediaRefPattern.test(ref),'MEDIA_REF_INVALID');
      const source=await deps.media.readOwnedForPublish({principal:current,mediaRef:ref});
      return verifyOwnedFacebookMediaBytes(source,ref,current);
    };
    const ports:FacebookPostNowPorts={
      authorizeExplicitCommand:async meta=>{
        const current=authAgain();
        return meta.commandId===input.verifiedRequestId&&meta.tenantId===current.tenantId&&meta.userId===current.subjectId&&
          meta.pageConnectionId===input.command.pageConnectionId&&/^[a-f0-9]{64}$/.test(meta.payloadHash);
      },
      resolvePage:async({tenantId,userId,pageConnectionId})=>{
        guard(tenantId===p.tenantId&&userId===p.subjectId,'PAGE_TENANT_DENIED');
        return selectedPage(pageConnectionId);
      },
      resolveMedia:async({tenantId,userId,mediaRef})=>{
        guard(tenantId===p.tenantId&&userId===p.subjectId,'MEDIA_TENANT_DENIED');
        return (await verifiedMedia(mediaRef)).grant;
      },
      provider:{publishNow:async({tenantId,userId,page,caption,media})=>{
        const current=authAgain();
        guard(current.tenantId===tenantId&&current.subjectId===userId,'PROVIDER_TENANT_DENIED');
        const refreshed=await selectedPage(page.connectionId);
        guard(refreshed.pageId===page.pageId&&refreshed.connectionRevision===page.connectionRevision,'PAGE_GRANT_ROTATED');
        const binding=await deps.pageTokens.resolveCurrentPageToken({tenantId,userId,pageConnectionId:page.connectionId,pageId:page.pageId,connectionRevision:page.connectionRevision});
        guard(binding&&binding.tenantId===tenantId&&binding.pageId===page.pageId&&binding.verifiedPageId===page.pageId&&
          binding.connectionRevision===page.connectionRevision&&binding.canCreateContent===true&&
          typeof binding.pageToken==='string'&&binding.pageToken.length>0&&Array.isArray(binding.scopes)&&requiredScopes.every(s=>binding.scopes.includes(s)),
          'PAGE_TOKEN_GRANT_DENIED');
        guard(media.length<=1,'MULTIPLE_MEDIA_UNSUPPORTED');
        let upload:VerifiedPostNowProviderMedia|undefined;
        if(media.length){
          const next=await verifiedMedia(media[0].ref);
          guard(next.grant.sha256===media[0].sha256&&next.grant.kind===media[0].kind&&next.grant.mimeType===media[0].mimeType&&next.grant.bytes===media[0].bytes,'MEDIA_CHANGED_BEFORE_SEND');
          upload=next.upload;
        }
        // OAuth/selected-Page grants may rotate during the async protected
        // Page-token or media lookup, even with an otherwise valid old token.
        // The trusted LCG3 selector verifies fresh task/selection ownership.
        const finalPage=await selectedPage(page.connectionId);
        guard(finalPage.pageId===page.pageId&&finalPage.connectionRevision===page.connectionRevision,
          'PAGE_GRANT_ROTATED');
        // One final LCG1 bearer AND persisted user-role/status check after
        // every asynchronous Page/token/media operation, right before Graph.
        authAgain();
        // One attempt, no retries. LCG8's video upload ID is never final PUBLISHED.
        const result=await deps.provider.publishNow(binding,{tenantId,pageId:page.pageId,commandId:input.verifiedRequestId,mode:'NOW',caption,...(upload?{media:upload}:{})});
        return translateFacebookPilotAdapterReceipt(result,upload?.kind||null);
      }},
    };
    return new FacebookCustomerPostNowService(this.store,ports,{externalWritesEnabled:true}).publishNow(principal,input.command);
  }
  /** Read-only customer receipt lookup; publishing still never retries UNCERTAIN. */
  getReceipt(input:{authorization:unknown;idempotencyKey:string}):FacebookPostNowReceipt|undefined {
    const p=this.verified(input.authorization);
    return new FacebookCustomerPostNowService(this.store,{
      authorizeExplicitCommand:async()=>false,
      resolvePage:async()=>undefined,
      resolveMedia:async()=>undefined,
      provider:{publishNow:async()=>({state:'SUBMITTED_UNCONFIRMED'})},
    }).getReceipt({tenantId:p.tenantId,userId:p.subjectId,audience:'customer-mcp',commandId:'read-only'},input.idempotencyKey);
  }
}
