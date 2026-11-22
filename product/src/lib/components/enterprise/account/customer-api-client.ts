/** Native account session transport. Customer secrets never enter persistent storage. */
export const CUSTOMER_VERSION='starli.customer-api.v1';
export const TOKEN_ROOT='/api/v1/starli/api-tokens';
export const SCOPES=['bots:read','conversations:read','messages:send','runs:read','runs:cancel'] as const;
export type Scope=typeof SCOPES[number];
export type BotAccess={mode:'all_owned'}|{mode:'selected';botIds:string[]};
export type TokenRecord={id:string;name:string;scopes:Scope[];botAccess:BotAccess;createdAt:number;expiresAt:number;lastUsedAt:number|null;revokedAt:number|null};
export type ApiBot={id:string;name:string;kind?:string;companyId?:string};
export type TokenDraft={name:string;expiresAt:number;scopes:Scope[];botAccess:BotAccess};
export class CustomerApiError extends Error{constructor(public status:number,message:string){super(message);}}
function record(d:any):TokenRecord{
 if(!d||typeof d.id!=='string'||!d.id||typeof d.name!=='string'||!Array.isArray(d.scopes)||!d.scopes.every((s:Scope)=>SCOPES.includes(s))||!Number.isSafeInteger(d.createdAt)||!Number.isSafeInteger(d.expiresAt)||!(d.lastUsedAt===null||Number.isSafeInteger(d.lastUsedAt))||!(d.revokedAt===null||Number.isSafeInteger(d.revokedAt))||!d.botAccess||!['all_owned','selected'].includes(d.botAccess.mode)||d.botAccess.mode==='selected'&&(!Array.isArray(d.botAccess.botIds)||!d.botAccess.botIds.every((s:unknown)=>typeof s==='string')))throw new CustomerApiError(0,'Token details could not be verified. Reload this page.');
 // Explicit projection keeps any accidental secret out of token-list state.
 return {id:d.id,name:d.name,scopes:[...d.scopes],botAccess:d.botAccess.mode==='all_owned'?{mode:'all_owned'}:{mode:'selected',botIds:[...d.botAccess.botIds]},createdAt:d.createdAt,expiresAt:d.expiresAt,lastUsedAt:d.lastUsedAt,revokedAt:d.revokedAt};
}
export class CustomerApiClient{
 private controller=new AbortController();private nativeSession:string;
 constructor(private sessionNow:()=>string,private transport:typeof fetch=(input,init)=>globalThis.fetch(input,init)){this.nativeSession=sessionNow();}
 close(){this.controller.abort();this.nativeSession='';}
 private check(){if(this.controller.signal.aborted||!this.nativeSession||this.sessionNow()!==this.nativeSession)throw new CustomerApiError(401,'Your session changed. Reopen API settings.');}
 private async request(suffix='',method='GET',body?:unknown){
  this.check();const response=await this.transport(TOKEN_ROOT+suffix,{method,credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{Authorization:'Bearer '+this.nativeSession,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});this.check();
  if(!response.ok)throw new CustomerApiError(response.status,response.status===401||response.status===403?'Your account access changed. Sign in again.':response.status===404||response.status===503?'Customer API is not available on this deployment.':response.status===422?'Check the token name, expiry, permissions and selected bots.':response.status===429?'Token limit reached or too many requests. Revoke an unused token or wait before retrying.':'The change could not be confirmed. Reload the token list before trying again.');
  if(!response.headers.get('content-type')?.includes('application/json'))throw new CustomerApiError(503,'Customer API is not available on this deployment.');
  const data=await response.json();this.check();if(data?.version!==CUSTOMER_VERSION)throw new CustomerApiError(503,'Customer API version could not be verified.');return data;
 }
 async list():Promise<TokenRecord[]>{const d=await this.request();if(!Array.isArray(d.data))throw new CustomerApiError(0,'Token list is unavailable.');return d.data.map(record);}
 async bots():Promise<ApiBot[]>{const d=await this.request('/bots');if(!Array.isArray(d.items)||d.items.some((b:any)=>typeof b.id!=='string'||typeof b.name!=='string'))throw new CustomerApiError(0,'Bot directory is unavailable.');return d.items.map((b:any)=>({id:b.id,name:b.name,kind:b.kind,companyId:b.companyId}));}
 async create(draft:TokenDraft):Promise<{record:TokenRecord;secret:string}>{const d=await this.request('','POST',draft);const metadata=record(d);if(typeof d.token!=='string'||!/^stli_[a-f0-9]{32}\.[A-Za-z0-9_-]+$/.test(d.token))throw new CustomerApiError(0,'Token receipt could not be verified. Reload and revoke this token before creating another.');return {record:metadata,secret:d.token};}
 async revoke(id:string){const d=await this.request('/'+encodeURIComponent(id),'DELETE');if(d.revoked!==true)throw new CustomerApiError(0,'Revocation could not be confirmed. Reload before retrying.');}
}
