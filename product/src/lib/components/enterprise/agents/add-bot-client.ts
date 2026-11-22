import {CompanyClient,WorkspaceError} from '$lib/utils/company-workspace';
export type BotTemplate={id:string;version:number;name:string;role?:string;personality?:string;instructions:string;useCases?:string[]};
export type NewBot={templateId:string;name:string;purpose:string;instructions:string};
export type CreatedBot={version:'starli.company-agent-created.v1';companyId:string;botId:string;templateId:string;profile:{botId:string;companyId:string;name:string;revision:number};setupRequired:string[]};
// An unconfirmed request survives component navigation, but never crosses sessions.
const pending=new Map<string,{draft:NewBot;key:string}>();
export class AddBotClient {
 private company:CompanyClient;private abort=new AbortController();private session:string;
 constructor(readonly companyId:string,private token:()=>string,private transport:typeof fetch=fetch){this.session=token();this.company=new CompanyClient(companyId,token,transport);}
 private cacheKey(){return JSON.stringify([this.companyId,this.session]);}
 close(){this.company.close();this.abort.abort();}
 forgetSession(){pending.delete(this.cacheKey());this.close();}
 resume(){const p=pending.get(this.cacheKey());return p?{...p,draft:{...p.draft}}:null;}
 async templates():Promise<BotTemplate[]>{
  const check=()=>{if(this.abort.signal.aborted||this.token()!==this.session)throw new WorkspaceError(401,'Your session changed. Reopen your company.');};check();
  const r=await this.transport('/api/v1/bot-directory/templates',{signal:this.abort.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+this.session,Accept:'application/json'}});check();
  if(!r.ok)throw new WorkspaceError(r.status,'Bot templates could not be loaded.');if(!r.headers.get('content-type')?.includes('application/json'))throw new WorkspaceError(0,'Invalid template response.');const d=await r.json();check();
  if(!Array.isArray(d.templates)||d.templates.some((t:any)=>typeof t.id!=='string'||!t.id||typeof t.name!=='string'||typeof t.instructions!=='string'||!Number.isSafeInteger(t.version)||t.version<1))throw new WorkspaceError(0,'Bot templates could not be verified.');return d.templates;
 }
 async access(){const d=await this.company.request('/capabilities','GET',undefined,undefined,true);if(d.company_id!==this.companyId||d.kind!=='person'||!['owner','admin','member'].includes(d.role)||!Number.isSafeInteger(d.membership_revision))throw new WorkspaceError(0,'Company access could not be verified.');return {canCreate:['owner','admin'].includes(d.role),revision:d.membership_revision};}
 async create(draft:NewBot):Promise<CreatedBot>{
  const cache=this.cacheKey(),prior=pending.get(cache);
  if(prior&&JSON.stringify(prior.draft)!==JSON.stringify(draft))throw new WorkspaceError(409,'A previous creation is unconfirmed. Retry its original details first.');
  const request=prior||{draft:{...draft},key:crypto.randomUUID()};pending.set(cache,request);
  try{
   const d=await this.company.request('/bots','POST',{...request.draft,requestKey:request.key});
   if(d.version!=='starli.company-agent-created.v1'||typeof d.botId!=='string'||!d.botId||d.templateId!==draft.templateId||d.profile?.botId!==d.botId||d.profile?.companyId!==this.companyId||typeof d.profile?.name!=='string'||!Number.isSafeInteger(d.profile?.revision)||!Array.isArray(d.setupRequired))throw new WorkspaceError(0,'Bot creation could not be verified. Retry to reconcile the original request.');
   pending.delete(cache);return d;
  }catch(e){if([400,401,403,404,409,422].includes((e as WorkspaceError).status))pending.delete(cache);throw e;}
 }
}
