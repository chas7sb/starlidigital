/** Proposed web facade v1. Server routes must bind native session and fresh authority.
 * UI selection is a lookup hint, never a grant. No personal endpoint fallback.
 */
export type Audience = {kind:'company'|'channel'|'private'; id:string; label:string};
export type Bot = {id:string; name:string; role?:string; chatId?:string};
export type Workspace = {version:'starli.company.workspace.v1'; companyId:string; membershipRevision:number;
 members:{id:string;name:string;role:string}[]; agents:Bot[]; channels:{id:string;name:string}[]};
export class WorkspaceError extends Error { constructor(public status:number, message:string){super(message);} }
export class CompanyClient {
 private controller=new AbortController();
 private token:string;
 readonly root:string;
 constructor(readonly companyId:string, private tokenNow:()=>string, private transport:typeof fetch=fetch,private messaging=false){
  this.token=tokenNow();this.root=messaging?'/api/v1/starli/companies/'+encodeURIComponent(companyId)+'/messaging':'/api/v1/companies/'+encodeURIComponent(companyId);
 }
 close(){this.controller.abort();}
 async request<T=any>(suffix:string, method='GET', body?:unknown, writeId?:string, pathScopedResponse=false):Promise<T>{
  if(!/^\/[a-zA-Z0-9_/%?=&.~-]+$/.test(suffix)||suffix.includes('..'))throw new WorkspaceError(0,'Invalid company resource.');
  if(this.controller.signal.aborted||this.token!==this.tokenNow())throw new WorkspaceError(401,'Your session changed. Reopen this workspace.');
  const r=await this.transport(this.root+suffix,{method,signal:this.controller.signal,credentials:'same-origin',cache:'no-store',
   headers:{Authorization:'Bearer '+this.token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(writeId?{'Idempotency-Key':writeId}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(this.controller.signal.aborted||this.token!==this.tokenNow())throw new WorkspaceError(401,'Your session changed. Reopen this workspace.');
  if(!r.ok)throw new WorkspaceError(r.status,r.status===409?'This item changed. Reload before applying your draft.':r.status===401||r.status===403?'Access changed. Reopen this workspace.':'This company service is unavailable.');
  if(!r.headers.get('content-type')?.includes('application/json'))throw new WorkspaceError(0,'Company service returned an invalid response.');
  const data=await r.json();
  if(this.controller.signal.aborted||this.token!==this.tokenNow())throw new WorkspaceError(401,'Your session changed. Reopen this workspace.');
  if(!this.messaging&&!pathScopedResponse&&data?.companyId!==this.companyId||data?.companyId!==undefined&&data.companyId!==this.companyId)throw new WorkspaceError(0,'Company scope could not be verified.');
  return data;
 }
 async workspace():Promise<Workspace>{const d=await this.request<Workspace>('/workspace');if(d.version!=='starli.company.workspace.v1'||!Number.isSafeInteger(d.membershipRevision)||!Array.isArray(d.agents)||!Array.isArray(d.members)||!Array.isArray(d.channels))throw new WorkspaceError(0,'Company workspace contract is unavailable.');return d;}
}
export function botPath(botId:string){return '/bots/'+encodeURIComponent(botId);}
export function memoryLabel(bot:Bot,audience:Audience){return bot.name+' · '+audience.label;}
