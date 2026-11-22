/** Trusted server-side LCG6 image-read adapter for LCG4's post-now dependency.
 * No HTTP route, MCP tool, Facebook token, Page selection or provider send.
 */
import type {FacebookCustomerMediaService} from './service.js';
import {FacebookCustomerMediaError,FACEBOOK_PUBLISH_MAX_BYTES} from './service.js';

const REF=/^fbimg-[a-f0-9]{32}$/;
const VALID_AUDIENCE='starli-customer-facebook-mcp';
const error=(code:FacebookCustomerMediaError['code'],message:string):never=>{
  throw new FacebookCustomerMediaError(code,message);
};

/** Structural match for LCG4's VerifiedMcpFacebookPublisher and LCG1's principal. */
export interface TrustedCustomerPublishPrincipal {
  readonly source:'CUSTOMER_MCP';
  readonly audience:'starli-customer-facebook-mcp';
  readonly tenantId:string;
  readonly ownerId:string;
  readonly subjectId:string;
  readonly scopes:readonly string[];
  readonly expiresAt:number;
}

/** Structural match for LCG4 VerifiedPostNowMediaBytes (image variant only). */
export interface TrustedOwnedFacebookImageBytes {
  tenantId:string;
  ownerUserId:string;
  ref:string;
  state:'READY';
  kind:'IMAGE';
  mimeType:'image/jpeg'|'image/png';
  sha256:string;
  bytes:Uint8Array;
}

export interface TrustedFacebookCustomerPublishReadPort {
  readOwnedForPublish(input:{principal:TrustedCustomerPublishPrincipal;mediaRef:string}):Promise<TrustedOwnedFacebookImageBytes>;
}

function checkedPrincipal(input:unknown):TrustedCustomerPublishPrincipal {
  const p=input as TrustedCustomerPublishPrincipal | undefined;
  if(!p||typeof p!=='object'||p.source!=='CUSTOMER_MCP'||p.audience!==VALID_AUDIENCE||
    typeof p.tenantId!=='string'||!p.tenantId||p.ownerId!==p.tenantId||p.subjectId!==p.tenantId||
    !Array.isArray(p.scopes)||!p.scopes.includes('facebook.pages.publish')||
    !Number.isFinite(p.expiresAt)||p.expiresAt<=Date.now()){
    return error('UNAUTHENTICATED','Live customer publishing permission required');
  }
  return p;
}

/**
 * Construct PER trusted request, using the actual server Authorization header
 * from LCG1's authenticated request context. Do not instantiate from JSON tool
 * input, raw principal objects, publicly supplied token strings or media URLs.
 *
 * LCG4 verifies the Page/grant and explicit command independently. This port
 * only resolves current same-tenant READY private bytes for that pipeline.
 */
export function createTrustedCustomerFacebookImagePublishReadPort(options:{
  media:FacebookCustomerMediaService;
  authorization:unknown;
  /** LCG1 CustomerFacebookMcpAuth.authenticateBearer: rechecks current token. */
  authenticateBearer:(authorization:unknown)=>TrustedCustomerPublishPrincipal;
}):TrustedFacebookCustomerPublishReadPort {
  if(!options?.media||typeof options.authenticateBearer!=='function')throw new Error('Trusted customer auth/media dependency required');
  return {
    async readOwnedForPublish(input){
      if(!input||typeof input!=='object'||typeof input.mediaRef!=='string'||!REF.test(input.mediaRef)){
        return error('MEDIA_NOT_FOUND','Customer image not found');
      }
      let current:TrustedCustomerPublishPrincipal;
      try{current=checkedPrincipal(options.authenticateBearer(options.authorization));}
      catch{ return error('UNAUTHENTICATED','Live customer publishing permission required'); }
      const claimed=checkedPrincipal(input.principal);
      if(claimed.tenantId!==current.tenantId||claimed.ownerId!==current.ownerId||claimed.subjectId!==current.subjectId){
        return error('FORBIDDEN','Customer publishing context changed');
      }
      // Second LCG1-authenticated check in the LCG6 media service itself;
      // it verifies owner/tenant/subject, revocation, filesystem and SHA256.
      const {media,bytes}=options.media.readImageForTrustedPublish(options.authorization,input.mediaRef);
      if(media.contentType!=='image/jpeg'&&media.contentType!=='image/png')return error('INVALID_MEDIA','Image format not supported for Facebook publish');
      if(bytes.length!==media.byteSize||bytes.length>FACEBOOK_PUBLISH_MAX_BYTES)return error('LIMIT_EXCEEDED','Image not valid for provider transfer');
      return {
        tenantId:current.tenantId,
        ownerUserId:current.subjectId,
        ref:media.mediaRef,
        state:'READY',kind:'IMAGE',
        mimeType:media.contentType,
        sha256:media.sha256,
        // Independent stable byte snapshot; never return a client URL/file path.
        bytes:Uint8Array.from(bytes),
      };
    },
  };
}
