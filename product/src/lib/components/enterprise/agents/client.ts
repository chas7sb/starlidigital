import {CompanyClient, botPath, WorkspaceError} from '$lib/utils/company-workspace';
export type AgentProfile = {version:'starli.company-agent-profile.v1';companyId:string;botId:string;revision:number;name:string;purpose:string;instructions:string;canManage:boolean;toolCapabilities:string[];updatedBy:string|null;updatedAt:string|null;avatarKey?:string|null;avatar?:string|null;source?:'directory'};
export type ProviderSelection = {version:'starli.company-provider.v1';companyId:string;botId:string;configurationRevision:number;connectionId:string|null;provider:string|null;model:string|null;status:string;mode?:'account_default'|'company_connection';accountReference?:{ownerUserId:string;followsDefault:true}};
export type ProviderOption = {connectionId:string|null;provider:string;models:string[];mode?:'account_default'|'company_connection'};
export type MemoryDocument = {revision:number;content:string};
const revision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
export class AgentClient {
 private client:CompanyClient;
 private controller=new AbortController();private initialToken:string;
 constructor(readonly companyId:string,readonly botId:string,private token:()=>string,private transport:typeof fetch=fetch){this.initialToken=token();this.client=new CompanyClient(companyId,token,transport);}
 close(){this.client.close();this.controller.abort();}
 private path(suffix:string){return botPath(this.botId)+suffix;}
 private scoped(v:any){if(v?.companyId!==this.companyId||v?.botId!==this.botId)throw new WorkspaceError(0,'Agent scope could not be verified.');return v;}
 private profileValue(value:any):AgentProfile{const v=this.scoped(value);if(v.version!=='starli.company-agent-profile.v1'||!revision(v.revision)||v.revision<1||!['name','purpose','instructions'].every(k=>typeof v[k]==='string')||typeof v.canManage!=='boolean'||!Array.isArray(v.toolCapabilities)||v.toolCapabilities.some((c:unknown)=>typeof c!=='string'))throw new WorkspaceError(0,'Agent profile is unavailable.');return v;}
 async profile(){try{return this.profileValue(await this.client.request(this.path('/profile')));}catch(e){if((e as WorkspaceError).status!==404)throw e;return this.directoryProfile();}}
 private async directoryProfile():Promise<AgentProfile>{
  const check=()=>{if(this.controller.signal.aborted||this.initialToken!==this.token())throw new WorkspaceError(401,'Your session changed. Reopen this workspace.');};check();
  const r=await this.transport('/api/v1/bot-directory/bots/'+encodeURIComponent(this.botId),{signal:this.controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+this.initialToken,Accept:'application/json'}});check();
  if(!r.ok)throw new WorkspaceError(r.status,'Agent profile is unavailable.');if(!r.headers.get('content-type')?.includes('application/json'))throw new WorkspaceError(0,'Agent profile is unavailable.');const d=await r.json();check();
  if(d?.version!=='starli.bot-directory.v1'||d.bot?.id!==this.botId||d.bot?.kind!=='company'||d.bot?.owner!==this.companyId||typeof d.bot?.name!=='string'||!revision(d.bot?.revision)||typeof d.config?.instructions!=='string')throw new WorkspaceError(0,'Agent directory scope could not be verified.');
  return {version:'starli.company-agent-profile.v1',companyId:this.companyId,botId:this.botId,revision:d.bot.revision,name:d.bot.name,purpose:'',instructions:d.config.instructions,canManage:false,toolCapabilities:[],updatedBy:null,updatedAt:null,source:'directory'};
 }
 async saveProfile(profile:AgentProfile,fields:{name:string;purpose:string;instructions:string}){return this.profileValue(await this.client.request(this.path('/profile'),'PUT',{expectedRevision:profile.revision,...fields}));}
 async saveAvatar(profile:AgentProfile,avatarKey:string){return this.profileValue(await this.client.request(this.path('/profile/avatar'),'PUT',{expectedRevision:profile.revision,avatarKey}));}
 async authority(){const v=await this.client.request('/capabilities','GET',undefined,undefined,true);if(v.company_id!==this.companyId||v.kind!=='person'||!Array.isArray(v.capabilities)||v.capabilities.some((c:unknown)=>typeof c!=='string'))throw new WorkspaceError(0,'Company permissions could not be verified.');return v.capabilities as string[];}
 async providers():Promise<{selection:ProviderSelection;options:ProviderOption[];optionsError?:string}>{
  const [selectionResult,optionResult]=await Promise.allSettled([this.client.request(this.path('/provider-selection')),this.client.request(this.path('/provider-options'),'GET',undefined,undefined,true)]);
  if(selectionResult.status==='rejected')throw selectionResult.reason;const v=this.scoped(selectionResult.value);
  if(v.version!=='starli.company-provider.v1'||!revision(v.configurationRevision)||typeof v.status!=='string'||!(v.provider===null||typeof v.provider==='string')||!(v.model===null||typeof v.model==='string'))throw new WorkspaceError(0,'Agent model settings are unavailable.');
  if(optionResult.status==='rejected')return {selection:v,options:[],optionsError:'Available models could not be loaded. Your saved selection is shown below. Reload to try again.'};
  const raw=optionResult.value;if(!Array.isArray(raw.options)||raw.options.some((o:any)=>!(o.connectionId===null||typeof o.connectionId==='string')||typeof o.provider!=='string'||!Array.isArray(o.models)||o.models.some((m:unknown)=>typeof m!=='string')))return {selection:v,options:[],optionsError:'The company model catalog returned an invalid response. Your saved selection is unchanged.'};
  return {selection:v,options:raw.options};
 }
 async saveProvider(selection:ProviderSelection,connectionId:string|null,model:string){await this.client.request(this.path('/provider-selection'),'PUT',{connectionId,model,expectedRevision:selection.configurationRevision},undefined,true);return this.providers();}
 private memoryPath(){return this.path('/memory?audienceKind=company&audienceId='+encodeURIComponent(this.companyId));}
 private memoryValue(v:any):MemoryDocument{this.scoped(v);if(v.version!=='starli.memory.view.v1'||v.audience?.kind!=='company'||v.audience?.id!==this.companyId||!revision(v.document?.revision)||typeof v.document?.content!=='string')throw new WorkspaceError(0,'Agent memory scope could not be verified.');return v.document;}
 async memory(){return this.memoryValue(await this.client.request(this.memoryPath()));}
 async saveMemory(document:MemoryDocument,content:string,writeId:string){return this.memoryValue(await this.client.request(this.memoryPath(),'PUT',{expectedRevision:document.revision,content,clientWriteId:writeId},writeId));}
}
