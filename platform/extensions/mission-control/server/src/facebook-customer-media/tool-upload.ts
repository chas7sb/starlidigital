/** LCG6 private customer upload TOOL DATA-FLOW only. Never registers a route/tool.
 * LCG1 owns OAuth bearer+allowlist; LCG10 owns isolated customer MCP wiring.
 */
import {
  FACEBOOK_UPLOAD_MCP_CHUNK_BYTES,
  type FacebookImageUploadProgress,
  type StartFacebookImageUpload,
  type FacebookCustomerImageChunkService,
} from './chunks.js';
import {
  FACEBOOK_PUBLISH_MAX_BYTES,
  FacebookCustomerMediaError,
  type CustomerFacebookImageReceipt,
} from './service.js';

/** LCG1 must add this permission BEFORE the tool can ever be enabled to customers. */
export const FACEBOOK_CUSTOMER_UPLOAD_TOOL_NAME='facebook_media_upload' as const;
export const FACEBOOK_CUSTOMER_UPLOAD_TOOL_SCOPE='facebook.media.write' as const;
export const FACEBOOK_CUSTOMER_MCP_BODY_MAX_BYTES=131_072; // LCG1 MAX_MCP; NOT overriden.
export const FACEBOOK_CUSTOMER_MCP_CHUNK_BASE64_MAX=Math.ceil(FACEBOOK_UPLOAD_MCP_CHUNK_BYTES/3)*4;

type UploadMetadata=Omit<StartFacebookImageUpload,'chunkBytes'|'contentType'|'totalBytes'> & {
  contentType:'image/png'|'image/jpeg'; totalBytes:number;
};
/** No owner, tenant, auth, path, token or URL accepted in tool arguments. */
export type FacebookCustomerUploadToolAction =
  | ({action:'BEGIN'} & UploadMetadata)
  | {action:'CHUNK';uploadRef:string;partIndex:number;chunkBase64:string}
  | {action:'FINISH';uploadRef:string}
  | {action:'CANCEL';uploadRef:string};

export type FacebookCustomerUploadToolResult =
  | FacebookImageUploadProgress
  | CustomerFacebookImageReceipt
  | {uploadRef:string;state:'CANCELLED'|'COMPLETED'};

export interface VerifiedCustomerImageToolPrincipal {
  readonly source:'CUSTOMER_MCP';
  readonly audience:'starli-customer-facebook-mcp';
  readonly tenantId:string;
  readonly ownerId:string;
  readonly subjectId:string;
  readonly scopes:readonly string[];
  readonly expiresAt:number;
}
const deny=(code:FacebookCustomerMediaError['code'],message:string):never=>{
  throw new FacebookCustomerMediaError(code,message);
};

/**
 * Must be created inside a trusted LCG10 request context with the same bearer
 * used by LCG4 publish/read. This adapter reauthenticates on EACH invocation;
 * underlying LCG6 storage independently rechecks it again. No fake identities.
 */
export function createTrustedCustomerFacebookImageUploadToolPort(options:{
  chunks:FacebookCustomerImageChunkService;
  authorization:unknown;
  authenticateBearer:(authorization:unknown)=>VerifiedCustomerImageToolPrincipal;
}):{execute:(action:FacebookCustomerUploadToolAction)=>FacebookCustomerUploadToolResult} {
  if(!options||!options.chunks||typeof options.authenticateBearer!=='function')throw Error('Trusted customer upload dependencies required');
  function live(){
    let p:VerifiedCustomerImageToolPrincipal;
    try{p=options.authenticateBearer(options.authorization);}catch{return deny('UNAUTHENTICATED','Live customer MCP required');}
    if(!p||p.source!=='CUSTOMER_MCP'||p.audience!=='starli-customer-facebook-mcp'||
       typeof p.tenantId!=='string'||!p.tenantId||p.ownerId!==p.tenantId||p.subjectId!==p.tenantId||
       !Number.isFinite(p.expiresAt)||p.expiresAt<=Date.now())deny('UNAUTHENTICATED','Live customer MCP required');
    if(!Array.isArray(p.scopes)||!p.scopes.includes(FACEBOOK_CUSTOMER_UPLOAD_TOOL_SCOPE))deny('FORBIDDEN','Customer media-upload permission required');
  }
  return {execute(action){
    live();
    if(!action||typeof action!=='object')return deny('INVALID_MEDIA','Upload action required');
    switch(action.action){
      case 'BEGIN': {
        // A private-library upload may permit WebP/8 MiB, but Facebook Page
        // provider dispatch only accepts PNG/JPEG <=8,000,000 decimal bytes.
        if(!['image/png','image/jpeg'].includes(action.contentType) || !Number.isSafeInteger(action.totalBytes) || action.totalBytes<1 || action.totalBytes>FACEBOOK_PUBLISH_MAX_BYTES)
          return deny('INVALID_MEDIA','Facebook post requires PNG/JPEG of at most 8,000,000 bytes');
        return options.chunks.start(options.authorization,{
          idempotencyKey:action.idempotencyKey,contentType:action.contentType,
          totalBytes:action.totalBytes,sha256:action.sha256,
          ...(action.originClaim?{originClaim:action.originClaim}:{}),
          chunkBytes:FACEBOOK_UPLOAD_MCP_CHUNK_BYTES,
        });
      }
      case 'CHUNK':
        options.chunks.assertFacebookPostToolSession(options.authorization,action.uploadRef);
        if(typeof action.chunkBase64!=='string'||action.chunkBase64.length>FACEBOOK_CUSTOMER_MCP_CHUNK_BASE64_MAX)
          return deny('INVALID_MEDIA','Customer MCP image chunk exceeds safe request limit');
        return options.chunks.append(options.authorization,action.uploadRef,action.partIndex,action.chunkBase64);
      case 'FINISH':
        options.chunks.assertFacebookPostToolSession(options.authorization,action.uploadRef);
        return options.chunks.complete(options.authorization,action.uploadRef);
      case 'CANCEL':
        options.chunks.assertFacebookPostToolSession(options.authorization,action.uploadRef);
        return options.chunks.cancel(options.authorization,action.uploadRef);
      default:return deny('INVALID_MEDIA','Unknown customer media upload action');
    }
  }};
}
